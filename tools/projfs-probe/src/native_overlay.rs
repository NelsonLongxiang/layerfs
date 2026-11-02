//! Diagnostic adapter over the existing bound Workspace, not another file store.
use crate::{native_binding::Binding, store_fixture::Fixture};
use layerfs_content::{filesystem::PathName, ContentError};
use layerfs_history::CommitId;
#[path = "native_commit.rs"]
mod commit;
pub use commit::{CommitCompletion, CommitWork};
#[path = "native_close.rs"]
mod close;
#[path = "native_coordination.rs"]
mod coordination;
#[path = "native_metadata.rs"]
mod metadata;
pub use close::CloseState;
use layerfs_overlay::{Capture, CapturedReader, Inode, KernelDirectory, KernelMount, OpenFile};
use layerfs_store_service::{
    store::{BoundWorkspace, CommitFailure},
    write::mutation::Mutation,
    StoreService,
};
use layerfs_workspace::{Operation, Position, ViewStat, WorkspaceError};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Arc,
};

pub type Result<T> = std::result::Result<T, Error>;
/// An explicit guarantee request, not an inferred state of the Windows cache.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommitScope {
    Published,
    ApplicationVisible,
}
impl TryFrom<u32> for CommitScope {
    type Error = Error;
    fn try_from(value: u32) -> Result<Self> {
        match value {
            1 => Ok(Self::Published),
            2 => Ok(Self::ApplicationVisible),
            _ => Err(refused(
                0xc000000d,
                "Commit scope must be explicit: 1=published, 2=application-visible",
            )),
        }
    }
}
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
    pub attributes: u32,
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
            attributes: s.windows_attributes,
        }
    }
}
struct Handle {
    serial: u64,
    file: Option<OpenFile>,
    directory: Option<KernelDirectory>,
    lookup: bool,
    data_writable: bool,
    attributes_writable: bool,
    delete_access: bool,
    cleaned: bool,
    path: Option<String>,
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
    binding: Binding,
    commits: Vec<CommitId>,
    pending_commit: Option<u64>,
    closing: bool,
    finish_started: bool,
    coordinating: Option<u64>,
    retained_completions: Vec<CommitCompletion>,
    retained_commit: Option<Box<CommitFailure>>,
    retained_success: Option<Box<layerfs_store_service::store::CommitSuccess>>,
    retained_lookup: Option<Box<layerfs_store_service::store::KernelLookupFailure>>,
    retained_open: Option<Box<layerfs_store_service::store::KernelOpenFailure>>,
}
impl Session {
    pub fn create(path: &Path) -> Result<Self> {
        let fixture = Fixture::create(path).map_err(failed)?;
        Self::bind_store(fixture.store, path, crate::store_fixture::native_binding()?)
    }
    /// New local owner over the exact existing Store: no fixture import or Init.
    pub fn reopen(store: &Path, work: &Path) -> Result<Self> {
        Self::bind_existing(store, work, crate::store_fixture::native_binding()?)
    }
    /// Explicit existing Store and caller-owned authority; never creates or copies a Store.
    pub fn bind_existing(store: &Path, work: &Path, binding: Binding) -> Result<Self> {
        if !store.is_absolute() || !work.is_absolute() || !store.is_file() {
            return Err(refused(
                0xc000000d,
                "existing absolute Store and fresh absolute work path required",
            ));
        }
        std::fs::create_dir(work).map_err(failed)?;
        layerfs_store_service::windows_acl::restrict_to_owner(work).map_err(failed)?;
        println!("STORE_REBOUND existing=true init=false");
        Self::bind_store(store.to_path_buf(), work, binding)
    }
    fn bind_store(store_path: PathBuf, path: &Path, binding: Binding) -> Result<Self> {
        let service = StoreService::open_direct(
            &store_path,
            &binding.catalog,
            binding.cursor,
            &path.join("native-template.sqlite"),
        )
        .map_err(|e| failed(format!("{e:?}")))?;
        let branch = service
            .store
            .history()
            .branch(binding.branch)
            .map_err(failed)?;
        if branch.as_ref().is_none_or(|b| b.name.as_str() == "main") {
            let status = if branch.is_none() {
                0xc0000034
            } else {
                0xc0000022
            };
            service.close().map_err(failed)?;
            return Err(refused(status, "Branch missing or protected main"));
        }
        let bound = layerfs_telemetry::timer::Timing::disabled("native.bind", |scope| {
            service.bind(binding.workspace, binding.branch, scope)
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
        println!(
            "NATIVE_BINDING branch={} workspace={:?} explicit_parameters=true",
            binding.branch, binding.workspace
        );
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
            binding,
            commits: Vec::new(),
            pending_commit: None,
            closing: false,
            finish_started: false,
            coordinating: None,
            retained_completions: Vec::new(),
            retained_commit: None,
            retained_success: None,
            retained_lookup: None,
            retained_open: None,
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
        self.accepting()?;
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
    fn reference(&mut self, path: &str) -> Result<Inode> {
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
    fn reference_child(&mut self, parent: u64, name: PathName) -> Result<Inode> {
        let op = self.bound.operation().map_err(workspace_error)?;
        match op.kernel_lookup(self.mount, parent, name) {
            Ok(value) => Ok(value.inode.clone()),
            Err(failure) => {
                if let Some(refusal) = failure.refusal() {
                    return Err(workspace_error(WorkspaceError::Refused(refusal)));
                }
                let error = failed(&failure);
                self.retained_lookup = Some(failure);
                Err(error)
            }
        }
    }
    pub fn open(&mut self, path: &str, writable: bool) -> Result<(u64, Stat)> {
        self.open_access(path, writable, writable)
    }
    pub fn open_windows(&mut self, path: &str, access: u32) -> Result<(u64, Stat)> {
        if access & !7 != 0 {
            return Err(refused(0xc000000d, "invalid native access"));
        }
        if access != 0 {
            self.namespace_admission()?;
        }
        let data_writable = access & 1 != 0;
        let attributes_writable = access & 2 != 0;
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
        let kind = if stat.directory != 0 {
            layerfs_store_service::store::KernelOpenKind::Directory
        } else {
            layerfs_store_service::store::KernelOpenKind::File {
                writable: data_writable || attributes_writable,
            }
        };
        let opened = match op.kernel_open(self.mount, request, stat.serial, kind) {
            Ok(value) => value,
            Err(failure) => {
                if let Some(refusal) = failure.refusal() {
                    if lookup {
                        failure
                            .operation()
                            .overlay()
                            .kernel_forget(self.bound.route(), self.mount, stat.serial, 1)
                            .map_err(failed)?;
                    }
                    return Err(workspace_error(WorkspaceError::Refused(refusal)));
                }
                let error = failed(&failure);
                self.retained_open = Some(failure);
                return Err(error);
            }
        };
        let (file, directory) = match opened.descriptor {
            layerfs_store_service::store::KernelDescriptor::File(file) => (Some(file), None),
            layerfs_store_service::store::KernelDescriptor::Directory(directory) => {
                (None, Some(directory))
            }
        };
        let held = Handle {
            serial: stat.serial,
            file,
            directory,
            lookup,
            data_writable,
            attributes_writable,
            delete_access: access & 4 != 0,
            cleaned: false,
            path: Some(path.to_owned()),
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
        self.create_windows(path, directory, 0, !directory, true)
    }
    pub fn create_windows(
        &mut self,
        path: &str,
        directory: bool,
        attributes: u32,
        data_writable: bool,
        attributes_writable: bool,
    ) -> Result<(u64, Stat)> {
        validate(path)?;
        self.namespace_admission()?;
        if attributes & !0xb7 != 0 || attributes & 0x10 != 0 && !directory {
            return Err(refused(0xc00000bb, "unrepresented creation attributes"));
        }
        if path == "/" {
            return Err(refused(0xc0000035, "root exists"));
        }
        self.with(|m| {
            let (parent, name) = m.parent(path).map_err(|e| coded(&e.code, e.message))?;
            let operation = Operation::CreateWindows {
                parent,
                name,
                directory,
                attributes: attributes & 0x27,
            };
            mutation_error(m.apply(operation).map(|_| ()))
        })?;
        self.publications += 1;
        self.open_access(path, data_writable, attributes_writable)
    }
    pub fn read(&self, handle: u64, offset: u64, length: u32) -> Result<Vec<u8>> {
        self.accepting()?;
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
        if !cached {
            self.namespace_admission()?;
        }
        if bytes.len() > layerfs_overlay::WRITE_WINDOW {
            return Err(refused(0xc000000d, "write window"));
        }
        let file = self
            .handles
            .get(&handle)
            .and_then(|h| h.file)
            .ok_or_else(|| refused(0xc0000008, "stale file handle"))?;
        if !cached && !self.handles.get(&handle).is_some_and(|h| h.data_writable) {
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
        self.namespace_admission()?;
        let file = self
            .handles
            .get(&handle)
            .and_then(|h| h.file)
            .ok_or_else(|| refused(0xc0000008, "stale file handle"))?;
        if !self.handles.get(&handle).is_some_and(|h| h.data_writable) {
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
        self.namespace_admission()?;
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
        self.renamed_hints(from, to);
        self.publications += 1;
        Ok(())
    }
    pub fn can_delete(&self, path: &str) -> Result<()> {
        self.namespace_admission()?;
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
        self.namespace_admission()?;
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
        self.unlinked_hints(path);
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
    pub fn directory_dot(&self, handle: u64, parent: bool) -> Result<Option<Stat>> {
        let held = self
            .handles
            .get(&handle)
            .ok_or_else(|| refused(0xc0000008, "stale directory handle"))?;
        let directory = held
            .directory
            .ok_or_else(|| refused(0xc0000103, "not a directory handle"))?;
        if held.serial == self.root {
            return Ok(None);
        }
        let serial = if parent {
            let op = self.bound.operation().map_err(workspace_error)?;
            let visit = op
                .workspace()
                .kernel_directory_visit(
                    op.resident(),
                    self.mount,
                    held.serial,
                    directory.owner_id(),
                    0,
                    None,
                )
                .map_err(workspace_error)?;
            op.overlay()
                .kernel_directory_visit(self.bound.route(), visit)
                .map_err(failed)?
                .page
                .parent()
                .ok_or_else(|| failed("directory parent absent"))?
        } else {
            held.serial
        };
        self.with(|m| {
            m.view
                .stat(m.op.overlay(), serial)
                .map(Stat::from)
                .map_err(workspace_error)
        })
        .map(Some)
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
        self.namespace_admission()?;
        if self.pending_commit.is_some() {
            return Err(refused(0x80000011, "Commit already admitted"));
        }
        if self.capture.is_some() {
            return Err(refused(0x80000011, "capture already held"));
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
    /// Exact current published generation/revision for diagnostic boundary checks.
    pub fn frontier(&self) -> Result<layerfs_overlay::WorkspaceState> {
        self.bound
            .operation()
            .map_err(workspace_error)?
            .overlay()
            .state(self.bound.route())
            .map_err(failed)
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
    /// Reopens an actual immutable Commit using its retained History id.
    pub fn committed_bytes(&self, index: usize, path: &str) -> Result<Vec<u8>> {
        validate(path)?;
        let id = *self
            .commits
            .get(index)
            .ok_or_else(|| refused(0xc000000d, "Commit index absent"))?;
        let mut saved = crate::saved::Saved::open_commit(
            &self.store_path,
            &self.binding.catalog,
            self.binding.cursor,
            id,
        )
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
        // Native host calls prepare_close before irreversible dispatcher stop.
        // Direct Rust callers have no WinFsp mount and can prepare here.
        if !self.closing {
            self.prepare_close()?;
        }
        if self.service.is_none() {
            return Err(refused(0xc0000128, "Session already closed"));
        }
        if self.finish_started {
            return Err(failed(
                "terminal finish already attempted; retain custody without replay",
            ));
        }
        self.finish_started = true;
        self.observe()?;
        let op = self.bound.operation().map_err(workspace_error)?;
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
