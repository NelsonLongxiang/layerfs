//! Diagnostic adapter over the existing bound Workspace, not another file store.
use crate::store_fixture::{branch, Fixture, BINDING, CURSOR};
use layerfs_content::{filesystem::PathName, ContentError};
use layerfs_history::{CommitId, CommitOutcome, CommitVia, HistoryCatalog};
use layerfs_overlay::{Capture, CapturedReader, Inode, KernelDirectory, KernelMount, OpenFile};
use layerfs_store_service::{
    store::{BoundWorkspace, CommitFailure, CommitOptions},
    write::mutation::Mutation,
    StoreService,
};
use layerfs_workspace::{
    KernelReadDecision, KernelReadOperation, Operation, Position, ViewStat, VisitFacts,
    WorkspaceError,
};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Arc,
};

pub type Result<T> = std::result::Result<T, Error>;
#[derive(Debug)]
pub struct Error {
    pub status: i32,
    pub detail: String,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.detail)
    }
}
impl std::error::Error for Error {}
pub fn failed(e: impl std::fmt::Display) -> Error {
    Error {
        status: 0xc0000001u32 as i32,
        detail: e.to_string(),
    }
}
pub fn refused(status: u32, detail: &str) -> Error {
    Error {
        status: status as i32,
        detail: detail.into(),
    }
}
fn workspace_error(e: WorkspaceError) -> Error {
    let status: u32 = match &e {
        WorkspaceError::Content(ContentError::PathNotFound)
        | WorkspaceError::Refused(layerfs_workspace::Refusal::Missing) => 0xc0000034,
        WorkspaceError::Refused(layerfs_workspace::Refusal::Exists) => 0xc0000035,
        WorkspaceError::Refused(layerfs_workspace::Refusal::NotDirectory) => 0xc0000103,
        WorkspaceError::Refused(layerfs_workspace::Refusal::NotEmpty) => 0xc0000101,
        WorkspaceError::Refused(layerfs_workspace::Refusal::NotPermitted) => 0xc0000022,
        _ => 0xc0000001,
    };
    Error {
        status: status as i32,
        detail: e.to_string(),
    }
}
fn mutation_error(e: layerfs_store_service::write::mutation::Result<()>) -> Result<()> {
    e.map_err(|e| coded(&e.code, e.message))
}
fn coded(code: &str, message: String) -> Error {
    Error {
        status: match code {
            "NoSuchPath" => 0xc0000034u32,
            "Exists" => 0xc0000035,
            "NotDirectory" => 0xc0000103,
            "NotEmpty" => 0xc0000101,
            "InvalidInput" => 0xc000000d,
            "IsDirectory" => 0xc00000ba,
            "NotFile" => 0xc00000bb,
            _ => 0xc0000001,
        } as i32,
        detail: format!("{code}: {message}"),
    }
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Stat {
    pub serial: u64,
    pub size: u64,
    pub mtime: i64,
    pub nanos: u32,
    pub mode: u32,
    pub directory: u32,
    pub reserved: u32,
}
impl From<ViewStat> for Stat {
    fn from(s: ViewStat) -> Self {
        Self {
            serial: s.serial,
            size: s.logical_len,
            mtime: s.metadata.mtime_seconds,
            nanos: s.metadata.mtime_nanoseconds,
            mode: s.metadata.mode,
            directory: u32::from(
                s.kind == layerfs_content::object::inode_leaf::InodeKind::Directory,
            ),
            reserved: 0,
        }
    }
}
struct Handle {
    serial: u64,
    file: Option<OpenFile>,
    directory: Option<KernelDirectory>,
    lookup: bool,
}
pub struct Session {
    service: Option<StoreService>,
    bound: Arc<BoundWorkspace>,
    mount: KernelMount,
    root: u64,
    next: u64,
    handles: BTreeMap<u64, Handle>,
    capture: Option<(Capture, CapturedReader)>,
    pub publications: u64,
    store_path: PathBuf,
    commits: Vec<CommitId>,
    retained_commit: Option<Box<CommitFailure>>,
    retained_success: Option<Box<layerfs_store_service::store::CommitSuccess>>,
}
impl Session {
    pub fn create(path: &Path) -> Result<Self> {
        let fixture = Fixture::create(path).map_err(failed)?;
        Self::bind_store(fixture.store, path)
    }
    /// New local owner over the exact existing Store: no fixture import or Init.
    pub fn reopen(store: &Path, work: &Path) -> Result<Self> {
        if !store.is_absolute() || !work.is_absolute() || !store.is_file() {
            return Err(refused(
                0xc000000d,
                "existing absolute Store and fresh absolute work path required",
            ));
        }
        std::fs::create_dir(work).map_err(failed)?;
        layerfs_store_service::windows_acl::restrict_to_owner(work).map_err(failed)?;
        println!("STORE_REBOUND existing=true init=false");
        Self::bind_store(store.to_path_buf(), work)
    }
    fn bind_store(store_path: PathBuf, path: &Path) -> Result<Self> {
        let service = StoreService::open_direct(
            &store_path,
            BINDING,
            CURSOR,
            &path.join("native-template.sqlite"),
        )
        .map_err(|e| failed(format!("{e:?}")))?;
        let identity = layerfs_history::WorkspaceId::from_authority([85; 32]).map_err(failed)?;
        let bound = layerfs_telemetry::timer::Timing::disabled("native.bind", |scope| {
            service.bind(identity, branch(), scope)
        })
        .0
        .map_err(failed)?;
        let op = bound.operation().map_err(workspace_error)?;
        let root = op
            .workspace()
            .base()
            .map_err(workspace_error)?
            .root()
            .root_inode()
            .serial();
        let mount = op
            .overlay()
            .kernel_mount(bound.route(), root)
            .map_err(failed)?;
        println!("OVERLAY_BOUND root={root} source=real_Store profile=Disposable overlay=MEMORY_OFF_EXCLUSIVE");
        Ok(Self {
            service: Some(service),
            bound,
            mount,
            root,
            next: 100,
            handles: BTreeMap::new(),
            capture: None,
            publications: 0,
            store_path,
            commits: Vec::new(),
            retained_commit: None,
            retained_success: None,
        })
    }
    fn sequence(&mut self) -> Result<u64> {
        self.next = self
            .next
            .checked_add(1)
            .ok_or_else(|| failed("request id exhausted"))?;
        Ok(self.next)
    }
    fn with<T>(&self, run: impl FnOnce(&mut Mutation<'_>) -> Result<T>) -> Result<T> {
        let mut mutation =
            Mutation::new(&self.bound).map_err(|e| failed(format!("{}: {}", e.code, e.message)))?;
        let answer = run(&mut mutation);
        // A known pre-effect refusal can end its source window. Unknown owner
        // failure keeps the operation/source intact; never guess release or replay.
        if answer
            .as_ref()
            .is_err_and(|e| e.status == 0xc0000001u32 as i32)
        {
            std::mem::forget(mutation);
            return answer;
        }
        let end = mutation_error(mutation.finish());
        match (answer, end) {
            (Ok(v), Ok(())) => Ok(v),
            (Err(e), Ok(())) => Err(e),
            (_, Err(e)) => Err(e),
        }
    }
    /// Reads the locally published view directly, never the Windows file cache.
    pub fn published_byte(&self, path: &str) -> Result<u8> {
        validate(path)?;
        self.with(|m| {
            let stat = m.resolve(path).map_err(|e| coded(&e.code, e.message))?;
            let mut bytes = Vec::new();
            m.view
                .read(m.op.overlay(), stat.serial, 0, 1, &mut bytes)
                .map_err(workspace_error)?;
            bytes
                .first()
                .copied()
                .ok_or_else(|| refused(0xc0000011, "published file empty"))
        })
    }
    pub fn latest_commit_index(&self) -> Result<usize> {
        self.commits
            .len()
            .checked_sub(1)
            .ok_or_else(|| refused(0xc000000d, "no Commit"))
    }
    pub fn stat_path(&self, path: &str) -> Result<Stat> {
        validate(path)?;
        self.with(|m| {
            m.resolve(path)
                .map(Stat::from)
                .map_err(|e| coded(&e.code, e.message))
        })
    }
    pub fn stat_handle(&self, handle: u64) -> Result<Stat> {
        let held = self
            .handles
            .get(&handle)
            .ok_or_else(|| refused(0xc0000008, "stale native handle"))?;
        self.with(|m| {
            m.view
                .stat(m.op.overlay(), held.serial)
                .map(Stat::from)
                .map_err(workspace_error)
        })
    }
    fn reference(&self, path: &str) -> Result<Inode> {
        let parts: Vec<_> = path.trim_start_matches('/').split('/').collect();
        let op = self.bound.operation().map_err(workspace_error)?;
        let mut parent = self.root;
        let mut held_parent = false;
        for (index, part) in parts.iter().enumerate() {
            let result = self.reference_child(parent, PathName::new(part).map_err(failed)?);
            // Unknown owner outcomes retain every possibly acquired reference.
            if held_parent
                && !result
                    .as_ref()
                    .is_err_and(|e| e.status == 0xc0000001u32 as i32)
            {
                op.overlay()
                    .kernel_forget(self.bound.route(), self.mount, parent, 1)
                    .map_err(failed)?;
            }
            let row = result?;
            if index + 1 == parts.len() {
                return Ok(row);
            }
            if row.kind != layerfs_overlay::InodeKind::Directory {
                op.overlay()
                    .kernel_forget(self.bound.route(), self.mount, row.serial, 1)
                    .map_err(failed)?;
                return Err(refused(0xc0000103, "intermediate entry is not a directory"));
            }
            parent = row.serial;
            held_parent = true;
        }
        Err(refused(0xc000000d, "root needs no lookup"))
    }
    fn reference_child(&self, parent: u64, name: PathName) -> Result<Inode> {
        let op = self.bound.operation().map_err(workspace_error)?;
        let mut facts = VisitFacts::default();
        loop {
            let visit = op
                .workspace()
                .kernel_read_visit(
                    op.resident(),
                    self.mount,
                    parent,
                    None,
                    KernelReadOperation::Lookup {
                        parent,
                        name: name.clone(),
                    },
                    Arc::new(facts.clone()),
                )
                .map_err(workspace_error)?;
            let observed = op
                .overlay()
                .kernel_observe_visit(self.bound.route(), Box::new(visit))
                .map_err(failed)?;
            observed.result.as_ref().map_err(failed)?;
            match observed.decision.as_ref() {
                Some(KernelReadDecision::Value(inode)) => return Ok(inode.clone()),
                Some(KernelReadDecision::Needs(needs)) => facts
                    .supply(
                        &op.workspace().base().map_err(workspace_error)?,
                        needs,
                        None,
                    )
                    .map_err(workspace_error)?,
                Some(KernelReadDecision::Refused(r)) => {
                    return Err(workspace_error(WorkspaceError::Refused(*r)))
                }
                other => return Err(failed(format!("lookup outcome {other:?}"))),
            }
        }
    }
    pub fn open(&mut self, path: &str, writable: bool) -> Result<(u64, Stat)> {
        validate(path)?;
        let stat = self.stat_path(path)?;
        let lookup = path != "/";
        if lookup {
            let row = self.reference(path)?;
            if row.serial != stat.serial {
                return Err(failed("name changed during diagnostic open"));
            }
        }
        let request = self.sequence()?;
        let op = self.bound.operation().map_err(workspace_error)?;
        let mut facts = VisitFacts::default();
        let result = (|| loop {
            let visit = if stat.directory != 0 {
                op.workspace().kernel_opendir_visit(
                    op.resident(),
                    self.mount,
                    request,
                    stat.serial,
                    Arc::new(facts.clone()),
                )
            } else {
                op.workspace().kernel_open_visit(
                    op.resident(),
                    self.mount,
                    request,
                    stat.serial,
                    writable,
                    Arc::new(facts.clone()),
                )
            }
            .map_err(workspace_error)?;
            let observed = op
                .overlay()
                .kernel_observe_visit(self.bound.route(), Box::new(visit))
                .map_err(failed)?;
            observed.result.as_ref().map_err(failed)?;
            match observed.decision.as_ref() {
                Some(KernelReadDecision::Value(_)) => {
                    return Ok(Handle {
                        serial: stat.serial,
                        file: observed.open_candidate,
                        directory: observed.directory_candidate,
                        lookup,
                    })
                }
                Some(KernelReadDecision::Needs(needs)) => facts
                    .supply(
                        &op.workspace().base().map_err(workspace_error)?,
                        needs,
                        None,
                    )
                    .map_err(workspace_error)?,
                Some(KernelReadDecision::Refused(r)) => {
                    return Err(workspace_error(WorkspaceError::Refused(*r)))
                }
                other => return Err(failed(format!("open outcome {other:?}"))),
            }
        })();
        let held = match result {
            Ok(v) => v,
            Err(e) => {
                if lookup && e.status != 0xc0000001u32 as i32 {
                    op.overlay()
                        .kernel_forget(self.bound.route(), self.mount, stat.serial, 1)
                        .map_err(failed)?;
                }
                return Err(e);
            }
        };
        self.handles.insert(request, held);
        Ok((request, stat))
    }
    pub fn create_file(&mut self, path: &str) -> Result<(u64, Stat)> {
        self.create_entry(path, false)
    }
    pub fn create_directory(&mut self, path: &str) -> Result<(u64, Stat)> {
        self.create_entry(path, true)
    }
    fn create_entry(&mut self, path: &str, directory: bool) -> Result<(u64, Stat)> {
        validate(path)?;
        if path == "/" {
            return Err(refused(0xc0000035, "root exists"));
        }
        self.with(|m| {
            let (parent, name) = m.parent(path).map_err(|e| coded(&e.code, e.message))?;
            let operation = if directory {
                Operation::Mkdir {
                    parent,
                    name,
                    mode: 0o700,
                }
            } else {
                Operation::Create {
                    parent,
                    name,
                    mode: 0o600,
                }
            };
            mutation_error(m.apply(operation).map(|_| ()))
        })?;
        self.publications += 1;
        self.open(path, !directory)
    }
    pub fn read(&self, handle: u64, offset: u64, length: u32) -> Result<Vec<u8>> {
        let held = self
            .handles
            .get(&handle)
            .ok_or_else(|| refused(0xc0000008, "stale native handle"))?;
        let file = held
            .file
            .ok_or_else(|| refused(0xc00000ba, "read directory"))?;
        if length as usize > layerfs_overlay::READ_WINDOW {
            return Err(refused(0xc000000d, "read window"));
        }
        let op = self.bound.operation().map_err(workspace_error)?;
        let visit = op
            .workspace()
            .kernel_data_visit(
                op.resident(),
                self.mount,
                held.serial,
                Some(file.owner_id()),
                offset,
                length,
            )
            .map_err(workspace_error)?;
        let window = op
            .overlay()
            .kernel_read_visit(self.bound.route(), Box::new(visit))
            .map_err(failed)?;
        let base = op.workspace().base().map_err(workspace_error)?;
        (*window)
            .clone()
            .finish(Some(&base), held.serial, offset, length, false)
            .map_err(workspace_error)?
            .map_err(|e| workspace_error(WorkspaceError::Refused(e)))
    }
    pub fn write(
        &mut self,
        handle: u64,
        offset: u64,
        bytes: &[u8],
        append: bool,
        cached: bool,
    ) -> Result<Stat> {
        if bytes.len() > layerfs_overlay::WRITE_WINDOW {
            return Err(refused(0xc000000d, "write window"));
        }
        let file = self
            .handles
            .get(&handle)
            .and_then(|h| h.file)
            .ok_or_else(|| refused(0xc0000008, "stale file handle"))?;
        if !cached && !file.writable() {
            return Err(refused(0xc0000022, "descriptor is read-only"));
        }
        let operation = if cached {
            Operation::StoreOpen {
                file,
                offset,
                data: bytes.into(),
            }
        } else {
            Operation::WriteOpen {
                file,
                position: if append {
                    Position::End
                } else {
                    Position::At(offset)
                },
                data: bytes.into(),
            }
        };
        self.with(|m| mutation_error(m.apply(operation).map(|_| ())))?;
        self.publications += 1;
        self.stat_handle(handle)
    }
    pub fn resize(&mut self, handle: u64, size: u64) -> Result<Stat> {
        let file = self
            .handles
            .get(&handle)
            .and_then(|h| h.file)
            .ok_or_else(|| refused(0xc0000008, "stale file handle"))?;
        if !file.writable() {
            return Err(refused(0xc0000022, "descriptor is read-only"));
        }
        self.with(|m| {
            mutation_error(
                m.apply(Operation::SetOpenAttributes {
                    file,
                    mode: None,
                    mtime: None,
                    size: Some(size),
                })
                .map(|_| ()),
            )
        })?;
        self.publications += 1;
        self.stat_handle(handle)
    }
    pub fn rename(&mut self, from: &str, to: &str, replace: bool) -> Result<()> {
        validate(from)?;
        validate(to)?;
        if from == "/" || to == "/" {
            return Err(refused(0xc0000022, "cannot rename root"));
        }
        self.with(|m| {
            let (parent, name) = m.parent(from).map_err(|e| coded(&e.code, e.message))?;
            let (new_parent, new_name) = m.parent(to).map_err(|e| coded(&e.code, e.message))?;
            let destination = to
                .rsplit_once('/')
                .ok_or_else(|| failed("destination parent"))?
                .0;
            let destination_path = destination
                .split('/')
                .filter(|p| !p.is_empty())
                .map(PathName::new)
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(failed)?;
            mutation_error(
                m.apply(Operation::Rename {
                    parent,
                    name,
                    new_parent,
                    new_name,
                    replace,
                    destination_path: Some(destination_path),
                })
                .map(|_| ()),
            )
        })?;
        self.publications += 1;
        Ok(())
    }
    pub fn can_delete(&self, path: &str) -> Result<()> {
        validate(path)?;
        if path == "/" {
            return Err(refused(0xc0000022, "cannot delete root"));
        }
        self.with(|m| {
            let stat = m.resolve(path).map_err(|e| coded(&e.code, e.message))?;
            if stat.kind == layerfs_content::object::inode_leaf::InodeKind::Directory {
                let mut after = None;
                loop {
                    let page = m
                        .view
                        .list(m.op.overlay(), stat.serial, after.as_deref())
                        .map_err(workspace_error)?;
                    if !page.entries.is_empty() {
                        return Err(refused(0xc0000101, "directory not empty"));
                    }
                    match page.continuation {
                        Some(next) if after.as_ref().is_none_or(|old| *old < next) => {
                            after = Some(next)
                        }
                        Some(_) => return Err(failed("delete-check cursor did not advance")),
                        None => break,
                    }
                }
            }
            Ok(())
        })
    }
    pub fn unlink(&mut self, path: &str) -> Result<()> {
        validate(path)?;
        if path == "/" {
            return Err(refused(0xc0000022, "cannot delete root"));
        }
        self.with(|m| {
            let stat = m.resolve(path).map_err(|e| coded(&e.code, e.message))?;
            let (parent, name) = m.parent(path).map_err(|e| coded(&e.code, e.message))?;
            let operation =
                if stat.kind == layerfs_content::object::inode_leaf::InodeKind::Directory {
                    Operation::Rmdir { parent, name }
                } else {
                    Operation::Unlink { parent, name }
                };
            mutation_error(m.apply(operation).map(|_| ()))
        })?;
        self.publications += 1;
        Ok(())
    }
    pub fn close_file(&mut self, handle: u64) -> Result<()> {
        let held = self
            .handles
            .get(&handle)
            .ok_or_else(|| refused(0xc0000008, "stale close"))?;
        let op = self.bound.operation().map_err(workspace_error)?;
        if let Some(f) = held.file {
            op.overlay()
                .kernel_close_file(self.bound.route(), self.mount, held.serial, f.owner_id())
                .map_err(failed)?;
        }
        if let Some(d) = held.directory {
            op.overlay()
                .kernel_directory_close(self.bound.route(), self.mount, held.serial, d.owner_id())
                .map_err(failed)?;
        }
        if held.lookup {
            op.overlay()
                .kernel_forget(self.bound.route(), self.mount, held.serial, 1)
                .map_err(failed)?;
        }
        self.handles.remove(&handle);
        Ok(())
    }
    pub fn list_next(&self, handle: u64, after: Option<&[u8]>) -> Result<Option<(Vec<u8>, Stat)>> {
        let held = self
            .handles
            .get(&handle)
            .ok_or_else(|| refused(0xc0000008, "stale directory handle"))?;
        if held.directory.is_none() {
            return Err(refused(0xc0000103, "not a directory handle"));
        }
        let parent = held.serial;
        let mut cursor = after.map(Vec::from);
        loop {
            let (entry, continuation) = self.with(|m| {
                let page = m
                    .view
                    .list(m.op.overlay(), parent, cursor.as_deref())
                    .map_err(workspace_error)?;
                let first = page
                    .entries
                    .into_iter()
                    .next()
                    .map(|(name, serial)| {
                        m.view
                            .stat(m.op.overlay(), serial)
                            .map(|stat| (name, Stat::from(stat)))
                            .map_err(workspace_error)
                    })
                    .transpose()?;
                Ok((first, page.continuation))
            })?;
            if entry.is_some() {
                return Ok(entry);
            }
            match continuation {
                Some(next) if cursor.as_ref().is_none_or(|old| *old < next) => cursor = Some(next),
                Some(_) => return Err(failed("directory continuation did not advance")),
                None => return Ok(None),
            }
        }
    }
    pub fn capture(&mut self) -> Result<()> {
        if self.capture.is_some() {
            return Err(refused(0xc00000aa, "capture already held"));
        }
        let op = self.bound.operation().map_err(workspace_error)?;
        let capture = op.overlay().capture(self.bound.route()).map_err(failed)?;
        let reader = op
            .overlay()
            .acquire_captured_reader(self.bound.route(), capture, 9001)
            .map_err(failed)?;
        println!(
            "OVERLAY_CAPTURE generation={} revision={}",
            capture.generation.number(),
            capture.revision
        );
        self.capture = Some((capture, reader));
        Ok(())
    }
    pub fn captured_bytes(&self, path: &str) -> Result<Vec<u8>> {
        validate(path)?;
        // This small control read checks one newly created root file only; real
        // nested Commit construction is handled by CapturedNamespace, not here.
        if path == "/" || path.trim_start_matches('/').contains('/') {
            return Err(refused(
                0xc00000bb,
                "diagnostic captured read admits a new root file only",
            ));
        }
        let (_, reader) = self.capture.ok_or_else(|| failed("no capture"))?;
        let op = self.bound.operation().map_err(workspace_error)?;
        let entry = op
            .overlay()
            .reader_directory_entry(
                self.bound.route(),
                reader,
                self.root,
                path.trim_start_matches('/').as_bytes().to_vec(),
            )
            .map_err(failed)?
            .ok_or_else(|| failed("captured new name missing"))?;
        let serial = entry.serial.ok_or_else(|| failed("captured whiteout"))?;
        let read = op
            .overlay()
            .captured_read(
                self.bound.route(),
                reader,
                serial,
                0,
                layerfs_overlay::READ_WINDOW as u32,
            )
            .map_err(failed)?
            .ok_or_else(|| failed("captured new payload missing"))?;
        if read.span.is_some() || !read.references.is_empty() {
            return Err(failed("new-file capture unexpectedly inherited"));
        }
        Ok(read.data)
    }
    pub fn observe(&self) -> Result<()> {
        let op = self.bound.operation().map_err(workspace_error)?;
        let state = op.overlay().state(self.bound.route()).map_err(failed)?;
        let resources = op.overlay().resources().map_err(failed)?;
        println!("OVERLAY_STATE revision={} active={} captured={:?} payload_bytes={} inode_rows={} handles={} publications={}",state.revision,state.active.number(),state.captured.map(|g|g.number()),resources.counts.payload_bytes,resources.counts.inode_rows,self.handles.len(),self.publications);
        Ok(())
    }
    /// Ends only the independent diagnostic capture. This is not a publication.
    pub fn release_capture(&mut self) -> Result<()> {
        let (capture, reader) = self
            .capture
            .ok_or_else(|| refused(0xc000000d, "no diagnostic capture"))?;
        let op = self.bound.operation().map_err(workspace_error)?;
        op.overlay()
            .release_captured_reader(self.bound.route(), reader)
            .map_err(failed)?;
        op.overlay()
            .resolve_failed(self.bound.route(), capture)
            .map_err(failed)?;
        self.capture = None;
        println!("DIAGNOSTIC_CAPTURE_RELEASED publication=false");
        Ok(())
    }
    /// One real Workspace Commit. It calls the existing constructor/Save/History driver.
    pub fn commit(&mut self) -> Result<bool> {
        if self.capture.is_some() {
            return Err(refused(
                0xc00000aa,
                "diagnostic capture still owned; release explicitly first",
            ));
        }
        if self.retained_commit.is_some() || self.retained_success.is_some() {
            return Err(failed("prior Commit custody retained"));
        }
        let before = self.bound.snapshot().map_err(workspace_error)?;
        let success = match self.bound.commit_captured(&CommitOptions {
            force: false,
            message: Some("native Windows published Overlay frontier".into()),
        }) {
            Ok(success) => success,
            Err(original) => {
                let error = failed(format!(
                    "{original}; phase={:?} locally_settled={} published={:?}",
                    original.phase, original.locally_settled, original.published
                ));
                self.retained_commit = Some(original); // no guessed retry or cleanup
                return Err(error);
            }
        };
        if success
            .namespace
            .as_ref()
            .is_some_and(|n| n.retained() || n.release_error.is_some())
        {
            self.retained_success = Some(Box::new(success));
            return Err(failed(
                "Commit published with retained construction custody",
            ));
        }
        let checked = (|| {
            let changed = match &success.history {
                Some(CommitOutcome::Committed { record, .. }) => {
                    if success.capture.is_none()
                        || success.namespace.as_ref().is_none_or(|n| n.work.is_none())
                    {
                        return Err(failed("missing captured namespace construction receipt"));
                    }
                    if record.meta.via != CommitVia::Workspace
                        || record.parent != before.branch.head_commit
                    {
                        return Err(failed("unexpected Workspace Commit provenance/parent"));
                    }
                    let handles = layerfs_persistence::Handles::open_read_only(
                        layerfs_persistence::PersistenceConfig::sqlite(&self.store_path)
                            .with_sqlite_profile(
                                layerfs_persistence::SqlitePersistenceProfile::Disposable,
                            ),
                        BINDING,
                        CURSOR,
                    )
                    .map_err(failed)?;
                    let stored = handles
                        .history
                        .commit(record.id)
                        .map_err(failed)?
                        .ok_or_else(|| failed("published Commit absent on independent reopen"))?;
                    let branch = handles
                        .history
                        .branch_snapshot(branch())
                        .map_err(failed)?
                        .ok_or_else(|| failed("published Branch absent"))?;
                    if stored != **record
                        || branch.branch.head_commit != Some(record.id)
                        || branch.effective_root != record.root
                    {
                        return Err(failed(
                            "independent history reopen differs from publication",
                        ));
                    }
                    println!("OVERLAY_COMMIT kind=Committed id={:?} root={:?} parent={:?} via=Workspace saved_bytes={} open_handles={}", record.id, record.root, record.parent, success.saved.stored_bytes, self.handles.len());
                    self.commits.push(record.id);
                    true
                }
                Some(CommitOutcome::UpToDate { head, root }) => {
                    if *head != before.branch.head_commit || *root != before.effective_root {
                        return Err(failed("unexpected UpToDate identity"));
                    }
                    println!(
                        "OVERLAY_COMMIT kind=UpToDate head={head:?} root={root:?} new_commit=false"
                    );
                    false
                }
                None => {
                    return Err(failed("conflicted Commit, not a publication"));
                }
            };
            let op = self.bound.operation().map_err(workspace_error)?;
            let state = op.overlay().state(self.bound.route()).map_err(failed)?;
            if state.captured.is_some()
                || state.base_root
                    != self
                        .bound
                        .snapshot()
                        .map_err(workspace_error)?
                        .effective_root
                        .to_bytes()
            {
                return Err(failed("known Commit not installed locally"));
            }
            println!(
                "OVERLAY_COMMIT_INSTALLED active={} revision={} captures_released=true",
                state.active.number(),
                state.revision
            );
            Ok(changed)
        })();
        if checked.is_err() {
            self.retained_success = Some(Box::new(success));
        }
        checked
    }
    /// Reopens an actual immutable Commit using its retained History id.
    pub fn committed_bytes(&self, index: usize, path: &str) -> Result<Vec<u8>> {
        validate(path)?;
        let id = *self
            .commits
            .get(index)
            .ok_or_else(|| refused(0xc000000d, "Commit index absent"))?;
        let mut saved = crate::saved::Saved::open_commit(&self.store_path, BINDING, CURSOR, id)
            .map_err(failed)?;
        let name = path.trim_start_matches('/');
        let entry = saved
            .entry(name)
            .map_err(failed)?
            .ok_or_else(|| refused(0xc0000034, "committed path absent"))?;
        if entry.directory || entry.size > 1024 * 1024 {
            return Err(refused(0xc00000bb, "diagnostic snapshot read scope"));
        }
        saved.read(name, 0, entry.size as u32).map_err(failed)
    }
    pub fn finish(&mut self) -> Result<()> {
        if self.retained_commit.is_some() || self.retained_success.is_some() {
            return Err(failed("original Commit custody retained; no close/replay"));
        }
        if !self.handles.is_empty() {
            return Err(failed("native handles remain; retain Workspace"));
        }
        self.observe()?;
        let op = self.bound.operation().map_err(workspace_error)?;
        if let Some((capture, reader)) = self.capture {
            op.overlay()
                .release_captured_reader(self.bound.route(), reader)
                .map_err(failed)?;
            // Diagnostic capture is not a Commit attempt: resolve without publication,
            // preserving the live view, before terminal explicit close.
            op.overlay()
                .resolve_failed(self.bound.route(), capture)
                .map_err(failed)?;
            self.capture = None;
        }
        op.overlay()
            .kernel_revoke(self.bound.route(), self.mount)
            .map_err(failed)?;
        drop(op);
        self.service
            .as_ref()
            .ok_or_else(|| failed("service closed"))?
            .release(&self.bound)
            .map_err(failed)?;
        self.service
            .take()
            .ok_or_else(|| failed("service closed"))?
            .close()
            .map_err(failed)?;
        println!(
            "OVERLAY_CLOSED real_overlay=true commits={}",
            self.commits.len()
        );
        Ok(())
    }
}
fn validate(path: &str) -> Result<()> {
    if path == "/" {
        return Ok(());
    }
    let rest = path
        .strip_prefix('/')
        .ok_or_else(|| refused(0xc000000d, "absolute path required"))?;
    if rest.is_empty() {
        return Err(refused(0xc000000d, "empty path"));
    }
    for name in rest.split('/') {
        crate::saved::validate_name(name).map_err(|e| refused(0xc000000d, &e))?;
    }
    Ok(())
}
