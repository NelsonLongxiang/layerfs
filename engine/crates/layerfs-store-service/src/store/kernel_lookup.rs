//! One kernel name lookup over current Workspace rows and scoped Store facts.
use super::StoreOperation;
use crate::OwnerError;
use layerfs_content::filesystem::PathName;
use layerfs_overlay::{Inode, KernelMount};
use layerfs_workspace::{
    KernelReadDecision, KernelReadOperation, KernelReadOutcome, Refusal, VisitFacts, WorkspaceError,
};
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
/// Original failed boundary; the deciding observation is retained separately
/// from transaction completion, never interpreted as permission to guess success.
#[derive(Debug)]
pub enum KernelLookupCause {
    Workspace(WorkspaceError),
    Owner(OwnerError),
    Observation(&'static str),
}
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
        match self.original.as_deref() {
            Some(KernelReadOutcome {
                result: Ok(_),
                decision: Some(KernelReadDecision::Refused(value)),
                ..
            }) => Some(*value),
            _ => None,
        }
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
        match &self.cause {
            KernelLookupCause::Workspace(error) => Some(error),
            KernelLookupCause::Owner(error) => Some(error),
            KernelLookupCause::Observation(_) => match self.original.as_deref() {
                Some(KernelReadOutcome {
                    result: Err(error), ..
                }) => Some(error),
                Some(KernelReadOutcome {
                    decision: Some(KernelReadDecision::Failed(error)),
                    ..
                }) => Some(error),
                _ => None,
            },
        }
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
        let mut facts = VisitFacts::default();
        let mut original = None;
        let answer = (|| loop {
            let visit = self
                .workspace()
                .kernel_read_visit(
                    self.resident(),
                    mount,
                    parent,
                    None,
                    KernelReadOperation::Lookup {
                        parent,
                        name: name.clone(),
                    },
                    Arc::new(facts.clone()),
                )
                .map_err(KernelLookupCause::Workspace)?;
            let receipt = self
                .overlay()
                .kernel_observe_visit(self.workspace().route(), Box::new(visit))
                .map_err(KernelLookupCause::Owner)?;
            original = Some(receipt.clone());
            if receipt.result.is_err() {
                return Err(KernelLookupCause::Observation("lookup observation failed"));
            }
            match receipt.decision.as_ref() {
                Some(KernelReadDecision::Value(inode)) => return Ok(inode.clone()),
                Some(KernelReadDecision::Needs(needs)) => {
                    let base = self
                        .workspace()
                        .base()
                        .map_err(KernelLookupCause::Workspace)?;
                    facts
                        .supply(&base, needs, None)
                        .map_err(KernelLookupCause::Workspace)?;
                }
                Some(KernelReadDecision::Refused(_)) => {
                    return Err(KernelLookupCause::Observation("lookup refused"))
                }
                Some(KernelReadDecision::Failed(_)) => {
                    return Err(KernelLookupCause::Observation("lookup decision failed"))
                }
                None => return Err(KernelLookupCause::Observation("lookup has no decision")),
            }
        })();
        match answer {
            Ok(inode) => Ok(KernelLookup {
                inode,
                original: original.expect("successful observation"),
                operation: self,
            }),
            Err(cause) => Err(Box::new(KernelLookupFailure {
                mount,
                parent,
                name,
                cause,
                original,
                operation: self,
            })),
        }
    }
}
