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
    pub(super) fn accepting(&self) -> Result<()> {
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
                    || !self.retained_completions.is_empty(),
            ),
            prepared: u32::from(self.closing),
        }
    }
    /// Caller holds Session admission mutex. Refusal changes nothing. Acceptance
    /// fences new work; the native host must then drain/stop before finish/revoke.
    pub fn prepare_close(&mut self) -> Result<()> {
        self.accepting()?;
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
        self.closing = true;
        println!("NORMAL_CLOSE_PREPARED tracked_references=0 commit=false capture=false admission_fenced=true");
        Ok(())
    }
}
