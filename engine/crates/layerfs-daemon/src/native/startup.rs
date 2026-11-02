//! One native logical bind; failures retain their original initialized owners.
use super::session::State;
use super::{Binding, Session};
use layerfs_store_service::{store::BoundWorkspace, OpenRefusal, OwnerError, StoreService};
use layerfs_workspace::WorkspaceError;
use std::{
    fmt,
    path::{Path, PathBuf},
    sync::Arc,
};
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BindPhase {
    Input,
    Directory,
    Store,
    Branch,
    Workspace,
    Root,
    Kernel,
}
#[derive(Debug)]
pub enum BindCause {
    Invalid(&'static str),
    Io(std::io::Error),
    Open(OpenRefusal),
    MissingBranch,
    ProtectedBranch,
    Bind(String),
    Workspace(WorkspaceError),
    Owner(OwnerError),
}
pub struct BindFailure {
    pub phase: BindPhase,
    pub cause: BindCause,
    pub binding: Binding,
    pub named: Option<(layerfs_history::LayerStackId, layerfs_history::HistoryName)>,
    pub store_path: PathBuf,
    pub work_path: PathBuf,
    service: Option<StoreService>,
    bound: Option<Arc<BoundWorkspace>>,
}
impl BindFailure {
    pub fn service_retained(&self) -> bool {
        self.service.is_some()
    }
    pub fn workspace_retained(&self) -> bool {
        self.bound.is_some()
    }
}
impl Drop for BindFailure {
    fn drop(&mut self) {
        if let Some(service) = self.service.take() {
            std::mem::forget(service);
        }
        if let Some(bound) = self.bound.take() {
            std::mem::forget(bound);
        }
    }
}
impl fmt::Debug for BindFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NativeBindFailure")
            .field("phase", &self.phase)
            .field("cause", &self.cause)
            .field("branch", &self.binding.branch)
            .field("named", &self.named)
            .field("workspace", &self.binding.workspace)
            .field("service_retained", &self.service_retained())
            .field("workspace_retained", &self.workspace_retained())
            .finish_non_exhaustive()
    }
}
impl fmt::Display for BindFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "native bind: {self:?}")
    }
}
impl std::error::Error for BindFailure {}
impl Session {
    pub fn bind_existing(
        store: &Path,
        work: &Path,
        binding: Binding,
    ) -> std::result::Result<Self, Box<BindFailure>> {
        Self::bind_selected(store, work, binding, None)
    }
    pub fn bind_registered(
        store: &Path,
        work: &Path,
        binding: Binding,
        stack: layerfs_history::LayerStackId,
        name: layerfs_history::HistoryName,
    ) -> std::result::Result<Self, Box<BindFailure>> {
        Self::bind_selected(store, work, binding, Some((stack, name)))
    }
    fn bind_selected(
        store: &Path,
        work: &Path,
        binding: Binding,
        named: Option<(layerfs_history::LayerStackId, layerfs_history::HistoryName)>,
    ) -> std::result::Result<Self, Box<BindFailure>> {
        let mut failure = Box::new(BindFailure {
            phase: BindPhase::Input,
            cause: BindCause::Invalid("unattempted"),
            binding,
            named,
            store_path: store.into(),
            work_path: work.into(),
            service: None,
            bound: None,
        });
        let attempted = (|| {
            if !store.is_absolute() || !work.is_absolute() || !store.is_file() {
                return Err(BindCause::Invalid(
                    "existing absolute Store and fresh absolute work path required",
                ));
            }
            failure.phase = BindPhase::Directory;
            std::fs::create_dir(work).map_err(BindCause::Io)?;
            layerfs_store_service::windows_acl::restrict_to_owner(work).map_err(BindCause::Io)?;
            failure.phase = BindPhase::Store;
            failure.service = Some(
                StoreService::open_direct(
                    store,
                    &failure.binding.catalog,
                    failure.binding.cursor,
                    &work.join("native-template.sqlite"),
                )
                .map_err(BindCause::Open)?,
            );
            let service = failure.service.as_ref().expect("opened");
            failure.phase = BindPhase::Branch;
            if let Some((stack, name)) = &failure.named {
                let branch = service
                    .store
                    .history()
                    .branch_named(*stack, name)
                    .map_err(|e| BindCause::Bind(e.to_string()))?
                    .ok_or(BindCause::MissingBranch)?;
                failure.binding.branch = branch.id;
            }
            let branch = service
                .store
                .history()
                .branch(failure.binding.branch)
                .map_err(|e| BindCause::Bind(e.to_string()))?;
            match branch {
                None => return Err(BindCause::MissingBranch),
                Some(b) if b.name.as_str() == "main" => return Err(BindCause::ProtectedBranch),
                _ => {}
            }
            failure.phase = BindPhase::Workspace;
            let bound = layerfs_telemetry::timer::Timing::disabled("native.bind", |t| {
                service.bind(failure.binding.workspace, failure.binding.branch, t)
            })
            .0
            .map_err(BindCause::Bind)?;
            failure.bound = Some(bound.clone());
            failure.phase = BindPhase::Root;
            let op = bound.operation().map_err(BindCause::Workspace)?;
            let root = op
                .workspace()
                .base()
                .map_err(BindCause::Workspace)?
                .root()
                .root_inode()
                .serial();
            failure.phase = BindPhase::Kernel;
            let mount = op
                .overlay()
                .kernel_mount(bound.route(), root)
                .map_err(BindCause::Owner)?;
            drop(op);
            Ok((root, mount))
        })();
        let (root, mount) = match attempted {
            Ok(value) => value,
            Err(cause) => {
                failure.cause = cause;
                return Err(failure);
            }
        };
        let state = State {
            service: failure.service.take(),
            bound: failure.bound.take().expect("bound"),
            mount,
            requests: layerfs_fuse::MountRequests::new(mount),
            root,
            next: 100,
            handles: Default::default(),
            publications: 0,
            binding: failure.binding.clone(),
            pending_commit: None,
            closing: false,
            finish_started: false,
            finish_error: None,
            failure: Default::default(),
            coordinating: None,
            retained_completions: Vec::new(),
            retained_commit: None,
            retained_lookup: None,
            retained_open: None,
        };
        Ok(Self {
            state: Some(Box::new(state)),
        })
    }
}
