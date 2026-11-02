//! One kernel name lookup over current Workspace rows and scoped Store facts.
pub use super::kernel_observation::KernelReadCause as KernelLookupCause;
use super::StoreOperation;
use layerfs_content::filesystem::PathName;
use layerfs_overlay::{Inode, KernelMount};
use layerfs_workspace::{KernelReadDecision, KernelReadOperation, KernelReadOutcome, Refusal};
use std::{fmt, sync::Arc};

/// A positive lookup and its original observation. The caller now owns one
/// kernel lookup reference on the inode until an explicit kernel forget.
/// Dropping this receipt does not release that reference or close a file.
pub struct KernelLookup {
    pub inode: Inode,
    pub original: Arc<KernelReadOutcome>,
    operation: StoreOperation,
}
impl KernelLookup {
    pub fn operation(&self) -> &StoreOperation {
        &self.operation
    }
}
impl fmt::Debug for KernelLookup {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("KernelLookup")
            .field("inode", &self.inode)
            .field("original", &self.original)
            .finish_non_exhaustive()
    }
}
/// The failed lookup retains its original operation scope and last observation.
pub struct KernelLookupFailure {
    pub mount: KernelMount,
    pub parent: u64,
    pub name: PathName,
    pub cause: KernelLookupCause,
    pub original: Option<Arc<KernelReadOutcome>>,
    operation: StoreOperation,
}
impl KernelLookupFailure {
    /// A semantic refusal is definitive only after successful observation.
    pub fn refusal(&self) -> Option<Refusal> {
        super::kernel_observation::refusal(&self.original)
    }
    /// Original provider scope and owner/backing stay with this failure.
    pub fn operation(&self) -> &StoreOperation {
        &self.operation
    }
}
impl fmt::Debug for KernelLookupFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("KernelLookupFailure")
            .field("mount", &self.mount)
            .field("parent", &self.parent)
            .field("name", &self.name)
            .field("cause", &self.cause)
            .field("original", &self.original)
            .finish_non_exhaustive()
    }
}
impl fmt::Display for KernelLookupFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "kernel lookup: {self:?}")
    }
}
impl std::error::Error for KernelLookupFailure {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.cause.source(&self.original)
    }
}

impl StoreOperation {
    /// Looks up one name beneath a parent already referenced by this mount.
    /// Each owner visit is one atomic job. An undecided visit changed nothing:
    /// its immutable facts are supplied outside the Overlay lock, then evaluation
    /// continues. A failed/uncertain step is never replayed. This is not a path
    /// walker, kernel attach, permission check or SDK mount operation.
    pub fn kernel_lookup(
        self,
        mount: KernelMount,
        parent: u64,
        name: PathName,
    ) -> Result<KernelLookup, Box<KernelLookupFailure>> {
        match self.kernel_observe(
            mount,
            KernelReadOperation::Lookup {
                parent,
                name: name.clone(),
            },
            None,
        ) {
            Ok(original)
                if original.open_candidate.is_none() && original.directory_candidate.is_none() =>
            {
                let Some(KernelReadDecision::Value(inode)) = original.decision.as_ref() else {
                    unreachable!("checked original decision")
                };
                Ok(KernelLookup {
                    inode: inode.clone(),
                    original,
                    operation: self,
                })
            }
            result => {
                let (cause, original) = match result {
                    Ok(original) => (
                        KernelLookupCause::Observation("lookup unexpectedly acquired a descriptor"),
                        Some(original),
                    ),
                    Err(failure) => (failure.cause, failure.original),
                };
                Err(Box::new(KernelLookupFailure {
                    mount,
                    parent,
                    name,
                    cause,
                    original,
                    operation: self,
                }))
            }
        }
    }
}
