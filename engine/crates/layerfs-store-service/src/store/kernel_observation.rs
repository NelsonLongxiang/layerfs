//! Shared current-row kernel observation; immutable demands run outside the owner lock.
use super::StoreOperation;
use crate::OwnerError;
use layerfs_overlay::KernelMount;
use layerfs_workspace::{
    KernelReadDecision, KernelReadOperation, KernelReadOutcome, Refusal, VisitFacts, WorkspaceError,
};
use std::sync::Arc;

/// The original failed boundary, separate from any deciding transaction value.
#[derive(Debug)]
pub enum KernelReadCause {
    Workspace(WorkspaceError),
    Owner(OwnerError),
    Observation(&'static str),
}
impl KernelReadCause {
    pub(super) fn source<'a>(
        &'a self,
        original: &'a Option<Arc<KernelReadOutcome>>,
    ) -> Option<&'a (dyn std::error::Error + 'static)> {
        match self {
            Self::Workspace(error) => Some(error),
            Self::Owner(error) => Some(error),
            Self::Observation(_) => match original.as_deref() {
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
pub(super) struct Failure {
    pub cause: KernelReadCause,
    pub original: Option<Arc<KernelReadOutcome>>,
}
pub(super) fn refusal(original: &Option<Arc<KernelReadOutcome>>) -> Option<Refusal> {
    match original.as_deref() {
        Some(KernelReadOutcome {
            result: Ok(None),
            decision: Some(KernelReadDecision::Refused(value)),
            ..
        }) if original
            .as_ref()
            .is_some_and(|r| r.open_candidate.is_none() && r.directory_candidate.is_none()) =>
        {
            Some(*value)
        }
        _ => None,
    }
}
impl StoreOperation {
    pub(super) fn kernel_observe(
        &self,
        mount: KernelMount,
        operation: KernelReadOperation,
        request: Option<u64>,
    ) -> Result<Arc<KernelReadOutcome>, Failure> {
        let mut facts = VisitFacts::default();
        let mut original = None;
        let result = (|| loop {
            let visit = match (&operation, request) {
                (KernelReadOperation::Lookup { parent, .. }, None) => {
                    self.workspace().kernel_read_visit(
                        self.resident(),
                        mount,
                        *parent,
                        None,
                        operation.clone(),
                        Arc::new(facts.clone()),
                    )
                }
                (KernelReadOperation::Open { serial, writable }, Some(request)) => {
                    self.workspace().kernel_open_visit(
                        self.resident(),
                        mount,
                        request,
                        *serial,
                        *writable,
                        Arc::new(facts.clone()),
                    )
                }
                (KernelReadOperation::Opendir { serial }, Some(request)) => {
                    self.workspace().kernel_opendir_visit(
                        self.resident(),
                        mount,
                        request,
                        *serial,
                        Arc::new(facts.clone()),
                    )
                }
                _ => {
                    return Err(KernelReadCause::Observation(
                        "invalid kernel observation request",
                    ))
                }
            }
            .map_err(KernelReadCause::Workspace)?;
            let receipt = self
                .overlay()
                .kernel_observe_visit(self.workspace().route(), Box::new(visit))
                .map_err(KernelReadCause::Owner)?;
            original = Some(receipt.clone());
            match (&receipt.result, receipt.decision.as_ref()) {
                (Ok(None), Some(KernelReadDecision::Value(_))) => return Ok(receipt),
                (Ok(None), Some(KernelReadDecision::Needs(needs)))
                    if !needs.is_empty()
                        && receipt.open_candidate.is_none()
                        && receipt.directory_candidate.is_none() =>
                {
                    let base = self
                        .workspace()
                        .base()
                        .map_err(KernelReadCause::Workspace)?;
                    facts
                        .supply(&base, needs, None)
                        .map_err(KernelReadCause::Workspace)?;
                }
                (Ok(None), Some(KernelReadDecision::Refused(_))) => {
                    return Err(KernelReadCause::Observation("kernel observation refused"))
                }
                _ => {
                    return Err(KernelReadCause::Observation(
                        "kernel observation has no usable original answer",
                    ))
                }
            }
        })();
        result.map_err(|cause| Failure { cause, original })
    }
}
