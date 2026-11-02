//! Before-effect close admission and one terminal product close after native drain.
use super::session::State;
use super::types::workspace_error;
use super::{failed, refused, Result};
use layerfs_history::{BranchId, WorkspaceId};
// Customer NTSTATUS on the private protocol: not a Win32 system error.
pub(super) const STATUS_DIRTY: u32 = 0xe0f50001;
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CloseState {
    pub files: u64,
    pub directories: u64,
    pub pending_commit: u32,
    pub capture: u32,
    pub retained: u32,
    pub prepared: u32,
}
#[derive(Clone, Copy, Debug)]
pub struct SessionStatus {
    pub workspace: WorkspaceId,
    pub branch: BranchId,
    pub root: u64,
    pub frontier: layerfs_overlay::WorkspaceState,
    pub requests: layerfs_fuse::MountWork,
    pub handles: u64,
    pub publications: u64,
    pub prepared: bool,
    pub finishing: bool,
    pub coordinating: bool,
    pub retained: bool,
}
impl State {
    pub(super) fn sequence(&mut self) -> Result<u64> {
        self.next = self
            .next
            .checked_add(1)
            .ok_or_else(|| failed("request identity exhausted"))?;
        Ok(self.next)
    }
    pub(super) fn accepting(&self) -> Result<()> {
        if self.retained_commit.is_some()
            || self.retained_success.is_some()
            || !self.retained_completions.is_empty()
            || self.retained_lookup.is_some()
            || self.retained_open.is_some()
            || self.finish_error.is_some()
            || self.failure.lock().map_or(true, |e| e.is_some())
            || self.requests.work().map_or(true, |w| w.retained != 0)
        {
            return Err(failed("original native failure retained"));
        }
        if self.closing {
            return Err(refused(
                0x80000011,
                "terminal close prepared; new work refused",
            ));
        }
        if self.service.is_none() {
            return Err(refused(0xc0000128, "Session already closed"));
        }
        Ok(())
    }
    pub(super) fn frontier(&self) -> Result<layerfs_overlay::WorkspaceState> {
        let op = self.bound.operation().map_err(workspace_error)?;
        op.overlay()
            .state(self.bound.route())
            .map_err(super::types::sourced)
    }
    pub(super) fn close_state(&self) -> CloseState {
        let frontier = if self.service.is_some() {
            Some(self.frontier())
        } else {
            None
        };
        CloseState {
            files: self.handles.values().filter(|h| h.file.is_some()).count() as u64,
            directories: self
                .handles
                .values()
                .filter(|h| h.directory.is_some())
                .count() as u64,
            pending_commit: u32::from(self.pending_commit.is_some()),
            capture: u32::from(
                frontier
                    .as_ref()
                    .is_some_and(|s| s.as_ref().is_ok_and(|s| s.captured.is_some())),
            ),
            retained: u32::from(
                self.retained_commit.is_some()
                    || self.retained_success.is_some()
                    || !self.retained_completions.is_empty()
                    || self.retained_lookup.is_some()
                    || self.retained_open.is_some()
                    || self.finish_error.is_some()
                    || self.failure.lock().map_or(true, |e| e.is_some())
                    || frontier.is_some_and(|s| s.is_err())
                    || self.requests.work().map_or(true, |w| w.retained != 0),
            ),
            prepared: u32::from(self.closing),
        }
    }
    pub(super) fn status(&self) -> Result<SessionStatus> {
        let close = self.close_state();
        Ok(SessionStatus {
            workspace: self.binding.workspace,
            branch: self.binding.branch,
            root: self.root,
            frontier: self.frontier()?,
            requests: self.requests.work().map_err(super::types::sourced)?,
            handles: self.handles.len() as u64,
            publications: self.publications,
            prepared: self.closing,
            finishing: self.finish_started,
            coordinating: self.coordinating.is_some(),
            retained: close.retained != 0,
        })
    }
    pub(super) fn prepare_close(&mut self) -> Result<()> {
        self.prepare_close_with(false)
    }
    pub(super) fn prepare_clean_close(&mut self) -> Result<()> {
        self.prepare_close_with(true)
    }
    fn prepare_close_with(&mut self, clean: bool) -> Result<()> {
        self.accepting()?;
        if self.coordinating.is_some() {
            return Err(refused(0x80000011, "close coordination still owned"));
        }
        let state = self.close_state();
        if state.retained != 0 {
            return Err(failed("unknown outcome retained; no normal close"));
        }
        if state.pending_commit != 0 {
            return Err(refused(0x80000011, "Commit still owns the bound Workspace"));
        }
        if state.capture != 0 {
            return Err(refused(
                0x80000011,
                "captured reader still owned; release explicitly",
            ));
        }
        if !self.handles.is_empty() {
            return Err(refused(
                0x80000011,
                "native file/directory references still owned until Close",
            ));
        }
        // The transport fences complete native callbacks before this control.
        // The Session lock serializes Commit admission; no JS status probe can
        // replace this before-effect decision. Dirty leaves ordinary service live.
        if clean {
            self.require_clean_close()?;
        }
        self.requests.try_stop_receive().map_err(|e| match e {
            layerfs_fuse::DispatchError::Busy => {
                refused(0x80000011, "native callbacks still active or retained")
            }
            _ => failed(e),
        })?;
        self.closing = true;
        Ok(())
    }
    pub(super) fn require_clean_close(&self) -> Result<()> {
        let state = self.frontier()?;
        if state.dirty_inodes != 0
            || state.dirty_directory_entries != 0
            || state.base_root
                != *self
                    .bound
                    .snapshot()
                    .map_err(workspace_error)?
                    .effective_root
                    .as_bytes()
        {
            return Err(refused(
                STATUS_DIRTY,
                "uncommitted published changes; explicit discard required",
            ));
        }
        Ok(())
    }
    pub(super) fn finish_after_native_drain(&mut self) -> Result<()> {
        if !self.closing {
            return Err(refused(
                0x80000011,
                "terminal close must be prepared before native drain",
            ));
        }
        if self.service.is_none() {
            return Err(refused(0xc0000128, "Session already closed"));
        }
        if self.finish_started {
            return Err(failed("terminal finish already attempted; no replay"));
        }
        if self.close_state().retained != 0 {
            return Err(failed("original failure retained after close admission"));
        }
        self.finish_started = true;
        let result = (|| {
            self.requests.finish().map_err(super::types::sourced)?;
            let op = self.bound.operation().map_err(workspace_error)?;
            op.overlay()
                .kernel_revoke(self.bound.route(), self.mount)
                .map_err(super::types::sourced)?;
            drop(op);
            self.service
                .as_ref()
                .expect("opened")
                .release(&self.bound)
                .map_err(failed)?;
            self.service.take().expect("opened").close().map_err(failed)
        })();
        if let Err(e) = &result {
            self.finish_error = Some(e.clone());
        }
        result
    }
}
