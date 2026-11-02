//! One owned Commit attempt. Admission/settlement use the bridge lock; construction does not.
use super::{failed, refused, workspace_error, CommitScope, Result, Session};
use layerfs_history::{BranchSnapshot, CommitOutcome, CommitVia, HistoryCatalog};
use layerfs_store_service::store::{BoundWorkspace, CommitFailure, CommitOptions, CommitSuccess};
use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    sync::Arc,
};

/// Created once by one Session. Moving it to a worker does not move the file-handle map.
#[must_use = "an admitted Commit must be run and its completion returned to the owning Session"]
pub struct CommitWork {
    bound: Arc<BoundWorkspace>,
    token: u64,
    before: BranchSnapshot,
}
/// Owns the original result until the Session settles it. Never Clone/replay this value.
#[must_use = "return this original completion to its admitting Session"]
pub struct CommitCompletion {
    bound: Arc<BoundWorkspace>,
    token: u64,
    before: BranchSnapshot,
    outcome: std::thread::Result<std::result::Result<CommitSuccess, Box<CommitFailure>>>,
}
impl CommitWork {
    /// Runs the unchanged public captured constructor outside the diagnostic Session mutex.
    pub fn run(self) -> CommitCompletion {
        let outcome = catch_unwind(AssertUnwindSafe(|| {
            self.bound.commit_captured(&CommitOptions {
                force: false,
                message: Some("native Windows published Overlay frontier".into()),
            })
        }));
        CommitCompletion {
            bound: self.bound,
            token: self.token,
            before: self.before,
            outcome,
        }
    }
}
impl Session {
    /// Holds one explicit admission while allowing ordinary operations on the same Workspace.
    pub fn begin_commit(&mut self, scope: CommitScope) -> Result<CommitWork> {
        if scope == CommitScope::ApplicationVisible {
            return Err(refused(0xc00000bb,"application-visible cache/section capture is not supported; explicitly request published-frontier semantics"));
        }
        self.namespace_admission()?;
        if self.pending_commit.is_some() {
            return Err(refused(0x80000011, "Commit already admitted"));
        }
        if self.capture.is_some() {
            return Err(refused(
                0x80000011,
                "diagnostic capture still owned; release explicitly first",
            ));
        }
        if self.retained_commit.is_some()
            || self.retained_success.is_some()
            || !self.retained_completions.is_empty()
        {
            return Err(failed("prior Commit custody retained"));
        }
        let before = self.bound.snapshot().map_err(workspace_error)?;
        let token = self.sequence()?;
        self.pending_commit = Some(token);
        Ok(CommitWork {
            bound: self.bound.clone(),
            token,
            before,
        })
    }
    /// Bookkeeping only after another request failed. It does not replay or drop a result.
    pub fn retain_completion(&mut self, completion: CommitCompletion) {
        self.retained_completions.push(completion);
    }
    pub fn complete_commit(&mut self, completion: CommitCompletion) -> Result<bool> {
        if self.pending_commit != Some(completion.token)
            || !Arc::ptr_eq(&self.bound, &completion.bound)
        {
            self.retain_completion(completion);
            return Err(failed("foreign Commit completion retained"));
        }
        if completion.outcome.is_err() {
            self.retain_completion(completion);
            return Err(failed("Commit panicked; original ownership retained"));
        }
        let CommitCompletion {
            before, outcome, ..
        } = completion;
        let success = match outcome.expect("panic already retained") {
            Ok(success) => success,
            Err(original) => {
                let error = failed(format!(
                    "{original}; phase={:?} locally_settled={} published={:?}",
                    original.phase, original.locally_settled, original.published
                ));
                self.retained_commit = Some(original);
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
            let installed = self.bound.snapshot().map_err(workspace_error)?;
            let expected_parent = match &success.merge {
                Some(merge) => {
                    if merge.from != before.branch.head_commit || !merge.conflicts.is_empty() {
                        return Err(failed("unexpected merge provenance"));
                    }
                    merge.head
                }
                None => before.branch.head_commit,
            };
            let changed = match &success.history {
                Some(CommitOutcome::Committed { record, .. }) => {
                    if success.capture.is_none()
                        || success.namespace.as_ref().is_none_or(|n| n.work.is_none())
                    {
                        return Err(failed("missing captured namespace construction receipt"));
                    }
                    if record.meta.via != CommitVia::Workspace
                        || record.parent != expected_parent
                        || record.meta.branch != Some(self.binding.branch)
                    {
                        return Err(failed("unexpected Workspace Commit provenance/parent"));
                    }
                    let handles = layerfs_persistence::Handles::open_read_only(
                        layerfs_persistence::PersistenceConfig::sqlite(&self.store_path)
                            .with_sqlite_profile(
                                layerfs_persistence::SqlitePersistenceProfile::Disposable,
                            ),
                        &self.binding.catalog,
                        self.binding.cursor,
                    )
                    .map_err(failed)?;
                    let stored = handles
                        .history
                        .commit(record.id)
                        .map_err(failed)?
                        .ok_or_else(|| failed("published Commit absent on independent reopen"))?;
                    // Immutable publication and this Workspace install are authoritative.
                    // Another Workspace may advance the global Branch before this read.
                    if stored != **record
                        || installed.branch.head_commit != Some(record.id)
                        || installed.effective_root != record.root
                    {
                        return Err(failed(
                            "immutable history or local install differs from publication",
                        ));
                    }
                    println!("OVERLAY_COMMIT kind=Committed scope=published id={:?} root={:?} parent={:?} via=Workspace saved_bytes={} open_handles={}", record.id, record.root, record.parent, success.saved.stored_bytes, self.handles.len());
                    self.commits.push(record.id);
                    true
                }
                Some(CommitOutcome::UpToDate { head, root }) => {
                    if *head != installed.branch.head_commit || *root != installed.effective_root {
                        return Err(failed("unexpected UpToDate identity"));
                    }
                    println!(
                        "OVERLAY_COMMIT kind=UpToDate scope=published head={head:?} root={root:?} new_commit=false"
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
        if checked.is_ok() {
            self.pending_commit = None;
        }
        checked
    }

    /// Synchronous helper for direct Rust callers; FFI uses the split lifecycle.
    pub fn commit(&mut self, scope: CommitScope) -> Result<bool> {
        let work = self.begin_commit(scope)?;
        self.complete_commit(work.run())
    }
}
