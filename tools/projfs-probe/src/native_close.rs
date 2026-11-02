//! Before-effect close admission, separate from irreversible native dispatcher stop.
use super::{failed, refused, Result, Session};
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
impl Session {
    /// One product request lane; this observes no operating-system mount state.
    pub fn requests(&self) -> layerfs_fuse::MountRequests {
        self.requests.clone()
    }
    pub(super) fn accepting(&self) -> Result<()> {
        if self.retained_lookup.is_some() || self.retained_open.is_some() {
            return Err(failed(
                "original kernel read/open failure retained; no further admission",
            ));
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
    /// Observed adapter-owned references, NOT a general kernel section inventory.
    pub fn close_state(&self) -> CloseState {
        CloseState {
            files: self.handles.values().filter(|h| h.file.is_some()).count() as u64,
            directories: self
                .handles
                .values()
                .filter(|h| h.directory.is_some())
                .count() as u64,
            pending_commit: u32::from(self.pending_commit.is_some()),
            capture: u32::from(self.capture.is_some()),
            retained: u32::from(
                self.retained_commit.is_some()
                    || self.retained_success.is_some()
                    || !self.retained_completions.is_empty()
                    || self.retained_lookup.is_some()
                    || self.retained_open.is_some()
                    || self.requests.work().map_or(true, |work| work.retained != 0),
            ),
            prepared: u32::from(self.closing),
        }
    }
    /// Caller holds Session admission mutex. Refusal changes nothing. Acceptance
    /// fences new work; the native host must then drain/stop before finish/revoke.
    pub fn prepare_close(&mut self) -> Result<()> {
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
        self.requests
            .try_stop_receive()
            .map_err(|error| match error {
                layerfs_fuse::DispatchError::Busy => {
                    refused(0x80000011, "native callbacks still active or retained")
                }
                _ => failed(error),
            })?;
        self.closing = true;
        println!("NORMAL_CLOSE_PREPARED tracked_references=0 commit=false capture=false admission_fenced=true");
        Ok(())
    }
}
