//! Diagnostic adapter over the existing bound Workspace, not another file store.
use crate::store_fixture::{branch, Fixture, BINDING, CURSOR};
use layerfs_content::{filesystem::PathName, ContentError};
use layerfs_overlay::{Capture, CapturedReader, Inode, KernelDirectory, KernelMount, OpenFile};
use layerfs_store_service::{store::BoundWorkspace, write::mutation::Mutation, StoreService};
use layerfs_workspace::{
    KernelReadDecision, KernelReadOperation, Operation, Position, ViewStat, VisitFacts,
    WorkspaceError,
};
use std::{collections::BTreeMap, path::Path, sync::Arc};

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
    e.map_err(|e| Error {
        status: match e.code.as_str() {
            "NoSuchPath" => 0xc0000034u32,
            "Exists" => 0xc0000035,
            "NotDirectory" => 0xc0000103,
            "NotEmpty" => 0xc0000101,
            _ => 0xc0000001,
        } as i32,
        detail: format!("{}: {}", e.code, e.message),
    })
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
}
impl Session {
    pub fn create(path: &Path) -> Result<Self> {
        let fixture = Fixture::create(path).map_err(failed)?;
        let service = StoreService::open_direct(
            &fixture.store,
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
    pub fn stat_path(&self, path: &str) -> Result<Stat> {
        validate(path)?;
        self.with(|m| {
            m.resolve(path).map(Stat::from).map_err(|e| Error {
                status: if e.code == "NoSuchPath" {
                    0xc0000034u32 as i32
                } else {
                    0xc0000001u32 as i32
                },
                detail: e.message,
            })
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
        let name = PathName::new(
            path.strip_prefix('/')
                .ok_or_else(|| failed("absolute name"))?,
        )
        .map_err(failed)?;
        let op = self.bound.operation().map_err(workspace_error)?;
        let mut facts = VisitFacts::default();
        loop {
            let visit = op
                .workspace()
                .kernel_read_visit(
                    op.resident(),
                    self.mount,
                    self.root,
                    None,
                    KernelReadOperation::Lookup {
                        parent: self.root,
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
        validate(path)?;
        let name = PathName::new(path.trim_start_matches('/')).map_err(failed)?;
        let root = self.root;
        self.with(|m| {
            mutation_error(
                m.apply(Operation::Create {
                    parent: root,
                    name,
                    mode: 0o600,
                })
                .map(|_| ()),
            )
        })?;
        self.publications += 1;
        self.open(path, true)
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
        let root = self.root;
        self.with(|m| {
            mutation_error(
                m.apply(Operation::Rename {
                    parent: root,
                    name: PathName::new(from.trim_start_matches('/')).map_err(failed)?,
                    new_parent: root,
                    new_name: PathName::new(to.trim_start_matches('/')).map_err(failed)?,
                    replace,
                    destination_path: None,
                })
                .map(|_| ()),
            )
        })?;
        self.publications += 1;
        Ok(())
    }
    pub fn unlink(&mut self, path: &str) -> Result<()> {
        validate(path)?;
        let root = self.root;
        self.with(|m| {
            mutation_error(
                m.apply(Operation::Unlink {
                    parent: root,
                    name: PathName::new(path.trim_start_matches('/')).map_err(failed)?,
                })
                .map(|_| ()),
            )
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
    pub fn list_next(&self, after: Option<&[u8]>) -> Result<Option<(Vec<u8>, Stat)>> {
        let mut cursor = after.map(Vec::from);
        loop {
            let (entry, continuation) = self.with(|m| {
                let page = m
                    .view
                    .list(m.op.overlay(), self.root, cursor.as_deref())
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
    pub fn finish(&mut self) -> Result<()> {
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
        println!("OVERLAY_CLOSED real_overlay=true store_commit=false");
        Ok(())
    }
}
fn validate(path: &str) -> Result<()> {
    if path == "/" {
        return Ok(());
    }
    let name = path
        .strip_prefix('/')
        .ok_or_else(|| refused(0xc000000d, "absolute path required"))?;
    if name.contains('/') || name.is_empty() {
        return Err(refused(
            0xc00000bb,
            "diagnostic currently serves root entries only",
        ));
    }
    crate::saved::validate_name(name).map_err(|e| refused(0xc000000d, &e))
}
