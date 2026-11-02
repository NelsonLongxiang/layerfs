//! One explicit, reversible close coordination; hints never replace namespace identity.
use super::session::State as Session;
use super::{refused, Result, Stat};
use std::ops::Bound::{Excluded, Included};

impl Session {
    pub fn open_access(&mut self, path: &str, data: bool, attrs: bool) -> Result<(u64, Stat)> {
        self.open_windows(path, u32::from(data) | (u32::from(attrs) << 1))
    }
    pub fn create_native(
        &mut self,
        path: &str,
        directory: bool,
        attributes: u32,
        access: u32,
    ) -> Result<(u64, Stat)> {
        if access & !7 != 0 {
            return Err(refused(0xc000000d, "invalid native access"));
        }
        let (h, stat) = self.create_windows(
            path,
            directory,
            attributes,
            access & 1 != 0,
            access & 2 != 0,
        )?;
        self.handles
            .get_mut(&h)
            .expect("created handle")
            .delete_access = access & 4 != 0;
        Ok((h, stat))
    }
    pub(super) fn namespace_admission(&self) -> Result<()> {
        self.accepting()?;
        if self.coordinating.is_some() {
            return Err(refused(
                0x80000011,
                "close coordination holds name admission",
            ));
        }
        Ok(())
    }
    /// Cleanup is a fact, not permission to release an OpenFile or a view.
    pub fn cleanup_file(&mut self, handle: u64) -> Result<()> {
        self.accepting()?;
        self.handles
            .get_mut(&handle)
            .ok_or_else(|| refused(0xc0000008, "stale cleanup"))?
            .cleaned = true;
        Ok(())
    }
    pub(super) fn renamed_hints(&mut self, from: &str, to: &str) {
        if from == to {
            return;
        }
        for h in self.handles.values_mut() {
            if let Some(p) = h.path.as_deref() {
                if let Some(suffix) = component_suffix(p, from) {
                    h.path = Some(format!("{to}{suffix}"));
                } else if component_suffix(p, to).is_some() {
                    h.path = None;
                }
            }
        }
    }
    pub(super) fn unlinked_hints(&mut self, path: &str) {
        for h in self.handles.values_mut() {
            if h.path
                .as_deref()
                .is_some_and(|p| component_suffix(p, path).is_some())
            {
                h.path = None;
            }
        }
    }
    /// Returned token is both the unique request owner and the upper handle cursor.
    /// No native OS call may run under the caller's Session mutex.
    pub fn begin_close_coordination(&mut self) -> Result<u64> {
        self.namespace_admission()?;
        let state = self.close_state();
        if state.pending_commit != 0 || state.capture != 0 || state.retained != 0 {
            return Err(refused(
                0x80000011,
                "Commit/capture/retained custody prevents coordination",
            ));
        }
        if self.handles.values().any(|h| {
            !h.cleaned
                || h.file.is_none()
                || h.data_writable
                || h.attributes_writable
                || h.delete_access
                || h.path.is_none()
        }) {
            return Err(refused(
                0x80000011,
                "only cleaned, named, readonly files admit coordination",
            ));
        }
        let token = self.sequence()?;
        self.coordinating = Some(token);
        Ok(token)
    }
    pub(super) fn begin_native_close(&mut self, clean: bool) -> Result<u64> {
        // Candidate/unknown admission is unchanged; clean rejection must precede
        // any kernel invalidation while the transport has fenced callbacks.
        let token = self.begin_close_coordination()?;
        if clean {
            if let Err(error) = self.require_clean_close() {
                self.end_close_coordination(token, false)?;
                return Err(error);
            }
        }
        Ok(token)
    }
    pub fn next_close_candidate(
        &self,
        token: u64,
        after: u64,
    ) -> Result<Option<(u64, u64, String)>> {
        if self.coordinating != Some(token) || after >= token {
            return Err(refused(0xc000000d, "foreign coordination cursor"));
        }
        let Some((&id, h)) = self
            .handles
            .range((Excluded(after), Included(token)))
            .next()
        else {
            return Ok(None);
        };
        let p = h
            .path
            .as_deref()
            .ok_or_else(|| refused(0x80000011, "file has no verified name"))?;
        let stat = self.stat_path(p).map_err(|e| {
            if matches!(e.status as u32, 0xc0000034 | 0xc0000103) {
                refused(0x80000011, "held file has no current matching path")
            } else {
                e
            }
        })?;
        if stat.serial != h.serial || stat.directory != 0 {
            return Err(refused(0x80000011, "name no longer identifies held serial"));
        }
        Ok(Some((id, h.serial, p.to_owned())))
    }
    pub(super) fn close_coordination_progress(&self, token: u64) -> Result<(u64, u64)> {
        self.accepting()?;
        if self.coordinating != Some(token) {
            return Err(refused(0xc000000d, "foreign coordination observation"));
        }
        let work = self.requests.work().map_err(super::types::sourced)?;
        Ok((self.handles.len() as u64, work.active as u64))
    }
    pub(super) fn finish_native_close(
        &mut self,
        token: u64,
        prepare: bool,
        clean: bool,
    ) -> Result<()> {
        self.end_close_coordination(token, false)?;
        if prepare {
            if clean {
                self.prepare_clean_close()
            } else {
                self.prepare_close()
            }
        } else {
            Ok(())
        }
    }
    /// Release only this coordination admission. Actual handles end only in Close.
    pub fn end_close_coordination(&mut self, token: u64, prepare: bool) -> Result<()> {
        if self.coordinating != Some(token) {
            return Err(refused(0xc000000d, "foreign coordination completion"));
        }
        self.coordinating = None;
        if prepare {
            self.prepare_close()
        } else {
            Ok(())
        }
    }
}
fn component_suffix<'a>(path: &'a str, prefix: &str) -> Option<&'a str> {
    path.strip_prefix(prefix)
        .filter(|suffix| suffix.is_empty() || suffix.starts_with('/'))
}
