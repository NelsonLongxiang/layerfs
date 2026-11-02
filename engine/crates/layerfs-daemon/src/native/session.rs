//! Safe native Workspace ownership independent of the OS callback transport.
use super::{
    Binding, CloseState, CommitCompletion, CommitReceipt, CommitScope, CommitWork, Result, Stat,
};
use layerfs_history::BranchSnapshot;
use layerfs_overlay::{KernelDirectory, KernelMount, OpenFile};
use layerfs_store_service::{
    store::{BoundWorkspace, CommitFailure, StoreOperation},
    StoreService,
};
use std::{collections::BTreeMap, sync::Arc};
pub(super) struct Handle {
    pub(super) serial: u64,
    pub(super) file: Option<OpenFile>,
    pub(super) directory: Option<KernelDirectory>,
    pub(super) lookup: bool,
    pub(super) data_writable: bool,
    pub(super) attributes_writable: bool,
    pub(super) delete_access: bool,
    pub(super) cleaned: bool,
    pub(super) path: Option<String>,
}
pub(super) struct State {
    pub(super) service: Option<StoreService>,
    pub(super) bound: Arc<BoundWorkspace>,
    pub(super) mount: KernelMount,
    pub(super) requests: layerfs_fuse::MountRequests,
    pub(super) root: u64,
    pub(super) next: u64,
    pub(super) handles: BTreeMap<u64, Handle>,
    pub(super) publications: u64,
    pub(super) binding: Binding,
    pub(super) pending_commit: Option<u64>,
    pub(super) closing: bool,
    pub(super) finish_started: bool,
    pub(super) finish_error: Option<super::Error>,
    pub(super) failure: std::sync::Mutex<Option<super::Error>>,
    pub(super) coordinating: Option<u64>,
    pub(super) retained_completions: Vec<CommitCompletion>,
    pub(super) retained_commit: Option<Arc<CommitFailure>>,
    pub(super) retained_lookup: Option<Arc<layerfs_store_service::store::KernelLookupFailure>>,
    pub(super) retained_open: Option<Arc<layerfs_store_service::store::KernelOpenFailure>>,
}

/// A process-local native Workspace. Dropping an unfinished owner retains its
/// complete state; only acknowledged terminal completion permits disposal.
pub struct Session {
    pub(super) state: Option<Box<State>>,
}
impl Drop for Session {
    fn drop(&mut self) {
        if let Some(state) = self.state.take() {
            if state.service.is_some() || state.finish_error.is_some() {
                std::mem::forget(state);
            }
        }
    }
}
impl Session {
    fn observe_result<T>(&self, result: Result<T>) -> Result<T> {
        self.inner().observe_result(result)
    }
    fn attempt<T>(&mut self, run: impl FnOnce(&mut State) -> Result<T>) -> Result<T> {
        let result = run(self.inner_mut());
        self.observe_result(result)
    }
    pub(super) fn inner(&self) -> &State {
        self.state
            .as_deref()
            .expect("native state present until drop")
    }
    pub(super) fn inner_mut(&mut self) -> &mut State {
        self.state
            .as_deref_mut()
            .expect("native state present until drop")
    }
    pub fn operation(&self) -> Result<StoreOperation> {
        self.inner()
            .bound
            .operation()
            .map_err(super::types::workspace_error)
    }
    pub fn snapshot(&self) -> Result<BranchSnapshot> {
        self.inner()
            .bound
            .snapshot()
            .map_err(super::types::workspace_error)
    }
    pub fn mount(&self) -> KernelMount {
        self.inner().mount
    }
    pub fn requests(&self) -> layerfs_fuse::MountRequests {
        self.inner().requests.clone()
    }
    pub fn publications(&self) -> u64 {
        self.inner().publications
    }
    pub fn status(&self) -> Result<super::SessionStatus> {
        self.inner().status()
    }
    pub fn frontier(&self) -> Result<layerfs_overlay::WorkspaceState> {
        self.inner().frontier()
    }
    pub fn close_state(&self) -> CloseState {
        self.inner().close_state()
    }
    /// Like prepare_close, after the caller fences complete native callbacks;
    /// also refuse unpublished changes before any receive/terminal effect.
    pub fn prepare_clean_close(&mut self) -> Result<()> {
        self.attempt(|s| s.prepare_clean_close())
    }
    pub fn prepare_close(&mut self) -> Result<()> {
        self.attempt(|s| s.prepare_close())
    }
    /// The caller has already stopped/detached its native dispatcher and drained
    /// every OS consumer. This checks only product ownership, not OS evidence.
    pub fn finish_after_native_drain(&mut self) -> Result<()> {
        self.attempt(|s| s.finish_after_native_drain())
    }
    pub fn begin_commit(&mut self, scope: CommitScope) -> Result<CommitWork> {
        self.attempt(|s| s.begin_commit(scope))
    }
    /// Admit one explicit message without changing Published capture or force policy.
    /// None uses the Store's existing Workspace default; empty text stays empty.
    pub fn begin_commit_message(
        &mut self,
        scope: CommitScope,
        message: Option<String>,
    ) -> Result<CommitWork> {
        self.attempt(|s| s.begin_commit_message(scope, message))
    }
    /// Use the original Store publication policy without bypassing Session admission.
    pub fn begin_commit_with(
        &mut self,
        scope: CommitScope,
        options: layerfs_store_service::store::CommitOptions,
    ) -> Result<CommitWork> {
        self.attempt(|s| s.begin_commit_with(scope, options))
    }
    pub fn complete_commit(&mut self, completion: CommitCompletion) -> Result<CommitReceipt> {
        self.attempt(|s| s.complete_commit(completion))
    }
    pub fn retain_completion(&mut self, completion: CommitCompletion) {
        self.inner_mut().retain_completion(completion);
    }
    /// Bounded read of the locally published view, not application cache state.
    pub fn read_published(
        &self,
        serial: u64,
        offset: u64,
        length: u32,
        bytes: &mut Vec<u8>,
    ) -> Result<u64> {
        self.observe_result(self.inner().with(|m| {
            m.view
                .read(m.op.overlay(), serial, offset, length, bytes)
                .map_err(super::types::workspace_error)
        }))
    }
    pub fn stat_path(&self, path: &str) -> Result<Stat> {
        self.observe_result(self.inner().stat_path(path))
    }
    pub fn stat_handle(&self, handle: u64) -> Result<Stat> {
        self.observe_result(self.inner().stat_handle(handle))
    }
    pub fn open_windows(&mut self, path: &str, access: u32) -> Result<(u64, Stat)> {
        self.attempt(|s| s.open_windows(path, access))
    }
    pub fn open_access(&mut self, path: &str, data: bool, attrs: bool) -> Result<(u64, Stat)> {
        self.attempt(|s| s.open_access(path, data, attrs))
    }
    pub fn open(&mut self, path: &str, writable: bool) -> Result<(u64, Stat)> {
        self.open_access(path, writable, writable)
    }
    pub fn create_file(&mut self, path: &str) -> Result<(u64, Stat)> {
        self.attempt(|s| s.create_file(path))
    }
    pub fn create_directory(&mut self, path: &str) -> Result<(u64, Stat)> {
        self.attempt(|s| s.create_directory(path))
    }
    pub fn create_native(
        &mut self,
        path: &str,
        directory: bool,
        attributes: u32,
        access: u32,
    ) -> Result<(u64, Stat)> {
        self.attempt(|s| s.create_native(path, directory, attributes, access))
    }
    pub fn create_windows(
        &mut self,
        path: &str,
        directory: bool,
        attributes: u32,
        data_writable: bool,
        attributes_writable: bool,
    ) -> Result<(u64, Stat)> {
        self.attempt(|s| {
            s.create_windows(
                path,
                directory,
                attributes,
                data_writable,
                attributes_writable,
            )
        })
    }
    pub fn read(&self, handle: u64, offset: u64, length: u32) -> Result<Vec<u8>> {
        self.observe_result(self.inner().read(handle, offset, length))
    }
    pub fn write(
        &mut self,
        handle: u64,
        offset: u64,
        bytes: &[u8],
        append: bool,
        cached: bool,
    ) -> Result<Stat> {
        self.attempt(|s| s.write(handle, offset, bytes, append, cached))
    }
    pub fn resize(&mut self, handle: u64, size: u64) -> Result<Stat> {
        self.attempt(|s| s.resize(handle, size))
    }
    pub fn rename(&mut self, from: &str, to: &str, replace: bool) -> Result<()> {
        self.attempt(|s| s.rename(from, to, replace))
    }
    pub fn can_delete(&self, path: &str) -> Result<()> {
        self.observe_result(self.inner().can_delete(path))
    }
    pub fn unlink(&mut self, path: &str) -> Result<()> {
        self.attempt(|s| s.unlink(path))
    }
    pub fn close_file(&mut self, handle: u64) -> Result<()> {
        self.attempt(|s| s.close_file(handle))
    }
    pub fn directory_dot(&self, handle: u64, parent: bool) -> Result<Option<Stat>> {
        self.observe_result(self.inner().directory_dot(handle, parent))
    }
    pub fn list_next(&self, handle: u64, after: Option<&[u8]>) -> Result<Option<(Vec<u8>, Stat)>> {
        self.observe_result(self.inner().list_next(handle, after))
    }
    pub fn overwrite_windows(
        &mut self,
        handle: u64,
        attributes: u32,
        replace: bool,
    ) -> Result<Stat> {
        self.attempt(|s| s.overwrite_windows(handle, attributes, replace))
    }
    pub fn basic_info(&mut self, handle: u64, attributes: u32, times: [u64; 4]) -> Result<Stat> {
        self.attempt(|s| s.basic_info(handle, attributes, times))
    }
    pub fn cleanup_file(&mut self, handle: u64) -> Result<()> {
        self.attempt(|s| s.cleanup_file(handle))
    }
    pub(super) fn begin_native_close(&mut self, clean: bool) -> Result<u64> {
        self.attempt(|s| s.begin_native_close(clean))
    }
    pub(super) fn close_coordination_progress(&self, token: u64) -> Result<(u64, u64)> {
        self.observe_result(self.inner().close_coordination_progress(token))
    }
    pub(super) fn finish_native_close(
        &mut self,
        token: u64,
        prepare: bool,
        clean: bool,
    ) -> Result<()> {
        self.attempt(|s| s.finish_native_close(token, prepare, clean))
    }
    pub fn begin_close_coordination(&mut self) -> Result<u64> {
        self.attempt(|s| s.begin_close_coordination())
    }
    pub fn next_close_candidate(
        &self,
        token: u64,
        after: u64,
    ) -> Result<Option<(u64, u64, String)>> {
        self.observe_result(self.inner().next_close_candidate(token, after))
    }
    pub fn end_close_coordination(&mut self, token: u64, prepare: bool) -> Result<()> {
        self.attempt(|s| s.end_close_coordination(token, prepare))
    }
}

impl State {
    pub(super) fn observe_result<T>(&self, result: Result<T>) -> Result<T> {
        if let Err(error) = &result {
            if error.status == 0xc0000001u32 as i32 {
                let mut kept = self.failure.lock().unwrap_or_else(|e| e.into_inner());
                if kept.is_none() {
                    *kept = Some(error.clone());
                }
            }
        }
        result
    }
}
