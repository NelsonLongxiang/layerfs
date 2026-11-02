//! Kernel OPEN and OPENDIR over the existing atomic Workspace visit.
pub use super::kernel_observation::KernelReadCause as KernelOpenCause;
use super::{kernel_observation, StoreOperation};
use layerfs_overlay::{Inode, InodeKind, KernelDirectory, KernelMount, OpenFile};
use layerfs_workspace::{KernelReadDecision, KernelReadOperation, KernelReadOutcome, Refusal};
use std::{fmt, sync::Arc};

/// File access is the kernel's already-authorized write capability, not a path
/// permission check. A directory has its own descriptor and Close operation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum KernelOpenKind {
    File { writable: bool },
    Directory,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum KernelDescriptor {
    File(OpenFile),
    Directory(KernelDirectory),
}
/// One original successful OPEN. Dropping this receipt closes nothing; the
/// kernel adapter must explicitly close the exact descriptor after its release.
pub struct KernelOpened {
    pub inode: Inode,
    pub descriptor: KernelDescriptor,
    pub original: Arc<KernelReadOutcome>,
    operation: StoreOperation,
}
impl KernelOpened {
    pub fn operation(&self) -> &StoreOperation {
        &self.operation
    }
}
impl fmt::Debug for KernelOpened {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("KernelOpened")
            .field("inode", &self.inode)
            .field("descriptor", &self.descriptor)
            .field("original", &self.original)
            .finish_non_exhaustive()
    }
}
/// Original request and operation scope, including candidates in an unsuccessful
/// observation. Candidates are evidence only: never adopt or close them on a guess.
pub struct KernelOpenFailure {
    pub mount: KernelMount,
    pub request: u64,
    pub serial: u64,
    pub kind: KernelOpenKind,
    pub cause: KernelOpenCause,
    pub original: Option<Arc<KernelReadOutcome>>,
    operation: StoreOperation,
}
impl KernelOpenFailure {
    pub fn refusal(&self) -> Option<Refusal> {
        kernel_observation::refusal(&self.original)
    }
    pub fn operation(&self) -> &StoreOperation {
        &self.operation
    }
}
impl fmt::Debug for KernelOpenFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("KernelOpenFailure")
            .field("mount", &self.mount)
            .field("request", &self.request)
            .field("serial", &self.serial)
            .field("kind", &self.kind)
            .field("cause", &self.cause)
            .field("original", &self.original)
            .finish_non_exhaustive()
    }
}
impl fmt::Display for KernelOpenFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "kernel open: {self:?}")
    }
}
impl std::error::Error for KernelOpenFailure {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.cause.source(&self.original)
    }
}
fn descriptor(
    original: &KernelReadOutcome,
    mount: KernelMount,
    serial: u64,
    kind: KernelOpenKind,
) -> Option<KernelDescriptor> {
    let Some(KernelReadDecision::Value(inode)) = &original.decision else {
        return None;
    };
    if inode.serial != serial {
        return None;
    }
    match (
        kind,
        inode.kind,
        original.open_candidate,
        original.directory_candidate,
    ) {
        (KernelOpenKind::File { writable }, InodeKind::File, Some(file), None)
            if file.engine() == mount.engine()
                && file.serial() == serial
                && file.writable() == writable =>
        {
            Some(KernelDescriptor::File(file))
        }
        (KernelOpenKind::Directory, InodeKind::Directory, None, Some(directory))
            if directory.mount() == mount && directory.serial() == serial =>
        {
            Some(KernelDescriptor::Directory(directory))
        }
        _ => None,
    }
}
impl StoreOperation {
    /// Opens the serial this kernel mount already references, independently of
    /// any current pathname. Does not acquire or forget a lookup reference.
    /// Each Needs visit is effect-free and supplied outside the Overlay lock;
    /// failure/unknown completion is returned once with original custody.
    pub fn kernel_open(
        self,
        mount: KernelMount,
        request: u64,
        serial: u64,
        kind: KernelOpenKind,
    ) -> Result<KernelOpened, Box<KernelOpenFailure>> {
        let action = match kind {
            KernelOpenKind::File { writable } => KernelReadOperation::Open { serial, writable },
            KernelOpenKind::Directory => KernelReadOperation::Opendir { serial },
        };
        let answer = self.kernel_observe(mount, action, Some(request));
        if let Ok(original) = &answer {
            if let Some(descriptor) = descriptor(original, mount, serial, kind) {
                let Some(KernelReadDecision::Value(inode)) = &original.decision else {
                    unreachable!("checked original")
                };
                return Ok(KernelOpened {
                    inode: inode.clone(),
                    descriptor,
                    original: original.clone(),
                    operation: self,
                });
            }
        }
        let (cause, original) = match answer {
            Ok(original) => (
                KernelOpenCause::Observation("open descriptor does not match its original request"),
                Some(original),
            ),
            Err(failure) => (failure.cause, failure.original),
        };
        Err(Box::new(KernelOpenFailure {
            mount,
            request,
            serial,
            kind,
            cause,
            original,
            operation: self,
        }))
    }
}
