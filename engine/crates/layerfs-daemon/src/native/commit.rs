//! One explicit captured Commit; construction runs outside Session admission.
use super::session::State;
use super::types::workspace_error;
use super::{failed, refused, CommitScope, Result};
use layerfs_history::{BranchSnapshot, CommitOutcome, CommitVia};
use layerfs_store_service::store::{BoundWorkspace, CommitFailure, CommitOptions, CommitSuccess};
use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    sync::Arc,
};
#[must_use = "run and return the original completion to its Session"]
pub struct CommitWork {
    bound: Arc<BoundWorkspace>,
    token: u64,
    before: BranchSnapshot,
    options: CommitOptions,
}
#[must_use = "settle the original completion without replay"]
pub struct CommitCompletion {
    original: Option<Box<Completion>>,
}
struct Completion {
    bound: Arc<BoundWorkspace>,
    token: u64,
    before: BranchSnapshot,
    options: CommitOptions,
    outcome: std::thread::Result<std::result::Result<CommitSuccess, Arc<CommitFailure>>>,
}
pub struct CommitReceipt {
    pub success: CommitSuccess,
    pub before: BranchSnapshot,
    pub installed: BranchSnapshot,
    pub frontier: layerfs_overlay::WorkspaceState,
    pub open_handles: usize,
    pub changed: bool,
}
impl CommitWork {
    pub fn run(self) -> CommitCompletion {
        let options = self.options;
        let outcome = catch_unwind(AssertUnwindSafe(|| {
            self.bound.commit_captured(&options).map_err(Arc::from)
        }));
        CommitCompletion {
            original: Some(Box::new(Completion {
                bound: self.bound,
                token: self.token,
                before: self.before,
                options,
                outcome,
            })),
        }
    }
}
impl Drop for CommitCompletion {
    fn drop(&mut self) {
        if let Some(original) = self.original.take() {
            // A lost caller establishes neither disposal nor rollback. Keep the
            // original result and its bound provider scope without replay.
            std::mem::forget(original);
        }
    }
}
impl State {
    pub(super) fn begin_commit(&mut self, scope: CommitScope) -> Result<CommitWork> {
        self.begin_commit_message(scope, Some("Windows published Workspace frontier".into()))
    }
    pub(super) fn begin_commit_message(
        &mut self,
        scope: CommitScope,
        message: Option<String>,
    ) -> Result<CommitWork> {
        self.begin_commit_with(
            scope,
            CommitOptions {
                force: false,
                message,
            },
        )
    }
    pub(super) fn begin_commit_with(
        &mut self,
        scope: CommitScope,
        mut options: CommitOptions,
    ) -> Result<CommitWork> {
        let mut metadata = layerfs_history::CommitMeta::new(CommitVia::Workspace);
        metadata.message = options.message.take();
        metadata
            .check()
            .map_err(|e| refused(0xc000000d, &e.to_string()))?;
        if scope == CommitScope::ApplicationVisible {
            return Err(refused(0xc00000bb,"application-visible cache/section capture is not supported; explicitly request published-frontier semantics"));
        }
        self.namespace_admission()?;
        if self.pending_commit.is_some() {
            return Err(refused(0x80000011, "Commit already admitted"));
        }
        if self.frontier()?.captured.is_some() {
            return Err(refused(0x80000011, "capture already owned"));
        }
        if self.retained_commit.is_some() || !self.retained_completions.is_empty() {
            return Err(failed("prior Commit custody retained"));
        }
        let before = self.bound.snapshot().map_err(workspace_error)?;
        let token = self.sequence()?;
        self.pending_commit = Some(token);
        Ok(CommitWork {
            bound: self.bound.clone(),
            token,
            before,
            options: CommitOptions {
                message: metadata.message,
                ..options
            },
        })
    }
    pub(super) fn retain_completion(&mut self, completion: CommitCompletion) {
        self.retained_completions.push(completion);
    }
    pub(super) fn complete_commit(
        &mut self,
        mut completion: CommitCompletion,
    ) -> Result<CommitReceipt> {
        let original = completion
            .original
            .as_ref()
            .expect("original completion present");
        if self.pending_commit != Some(original.token) || !Arc::ptr_eq(&self.bound, &original.bound)
        {
            self.retain_completion(completion);
            return Err(failed("foreign Commit completion retained"));
        }
        if self.failure.lock().map_or(true, |e| e.is_some()) {
            self.retain_completion(completion);
            return Err(failed(
                "original native failure retained; Commit completion kept without settlement",
            ));
        }
        if original.outcome.is_err() {
            self.retain_completion(completion);
            return Err(failed("Commit panicked; original ownership retained"));
        }
        let success = match original.outcome.as_ref().expect("panic retained") {
            Ok(success) => success,
            Err(original) => {
                let original = original.clone();
                let error = super::Error {
                    status: 0xc0000001u32 as i32,
                    detail: original.to_string(),
                    source: Some(original.clone()),
                };
                self.retained_commit = Some(original);
                self.retain_completion(completion);
                return Err(error);
            }
        };
        let before = &original.before;
        let options = &original.options;
        let checked = (|| {
            if success
                .namespace
                .as_ref()
                .is_some_and(|n| n.retained() || n.release_error.is_some())
            {
                return Err(failed("Commit construction custody retained"));
            }
            let installed = self.bound.snapshot().map_err(workspace_error)?;
            let expected_parent = match &success.merge {
                Some(m) => {
                    if options.force
                        || m.from != before.branch.head_commit
                        || !m.conflicts.is_empty()
                    {
                        return Err(failed("unexpected merge provenance"));
                    }
                    m.head
                }
                None => before.branch.head_commit,
            };
            let changed = match &success.history {
                Some(CommitOutcome::Committed { record, displaced }) => {
                    if options
                        .message
                        .as_deref()
                        .is_some_and(|text| record.meta.message.as_deref() != Some(text))
                        || record.meta.displaced != *displaced
                        || (!options.force && displaced.is_some())
                        || record.meta.via != CommitVia::Workspace
                        || record.parent != expected_parent
                        || record.meta.branch != Some(self.binding.branch)
                        || installed.branch.head_commit != Some(record.id)
                        || installed.effective_root != record.root
                        || success.capture.is_none()
                        || success.namespace.as_ref().is_none_or(|n| n.work.is_none())
                    {
                        return Err(failed("unexpected publication/install receipt"));
                    }
                    true
                }
                Some(CommitOutcome::UpToDate { head, root }) => {
                    if *head != installed.branch.head_commit || *root != installed.effective_root {
                        return Err(failed("unexpected UpToDate receipt"));
                    }
                    false
                }
                None => return Err(failed("conflicted Commit, not a publication")),
            };
            let frontier = self.frontier()?;
            if frontier.captured.is_some()
                || frontier.base_root != installed.effective_root.to_bytes()
            {
                return Err(failed("known Commit not installed locally"));
            }
            Ok((installed, frontier, changed))
        })();
        let (installed, frontier, changed) = match checked {
            Ok(v) => v,
            Err(e) => {
                self.retain_completion(completion);
                return Err(e);
            }
        };
        let Completion {
            before, outcome, ..
        } = *completion
            .original
            .take()
            .expect("checked completion present");
        let success = outcome.expect("panic checked").expect("failure checked");
        self.pending_commit = None;
        Ok(CommitReceipt {
            success,
            before,
            installed,
            frontier,
            open_handles: self.handles.len(),
            changed,
        })
    }
}
