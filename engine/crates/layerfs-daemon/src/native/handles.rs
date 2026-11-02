//! Native Workspace operations through existing typed Store/Overlay ports.
use super::session::State;
use super::types::workspace_error;
use super::{failed, refused, Result, Stat};
impl State {
    pub fn close_file(&mut self, handle: u64) -> Result<()> {
        self.accepting()?;
        let held = self
            .handles
            .get(&handle)
            .ok_or_else(|| refused(0xc0000008, "stale close"))?;
        let op = self.bound.operation().map_err(workspace_error)?;
        if let Some(f) = held.file {
            op.overlay()
                .kernel_close_file(self.bound.route(), self.mount, held.serial, f.owner_id())
                .map_err(super::types::sourced)?;
        }
        if let Some(d) = held.directory {
            op.overlay()
                .kernel_directory_close(self.bound.route(), self.mount, held.serial, d.owner_id())
                .map_err(super::types::sourced)?;
        }
        if held.lookup {
            op.overlay()
                .kernel_forget(self.bound.route(), self.mount, held.serial, 1)
                .map_err(super::types::sourced)?;
        }
        self.handles.remove(&handle);
        Ok(())
    }

    pub fn directory_dot(&self, handle: u64, parent: bool) -> Result<Option<Stat>> {
        let held = self
            .handles
            .get(&handle)
            .ok_or_else(|| refused(0xc0000008, "stale directory handle"))?;
        let directory = held
            .directory
            .ok_or_else(|| refused(0xc0000103, "not a directory handle"))?;
        if held.serial == self.root {
            return Ok(None);
        }
        let serial = if parent {
            let op = self.bound.operation().map_err(workspace_error)?;
            let visit = op
                .workspace()
                .kernel_directory_visit(
                    op.resident(),
                    self.mount,
                    held.serial,
                    directory.owner_id(),
                    0,
                    None,
                )
                .map_err(workspace_error)?;
            op.overlay()
                .kernel_directory_visit(self.bound.route(), visit)
                .map_err(super::types::sourced)?
                .page
                .parent()
                .ok_or_else(|| failed("directory parent absent"))?
        } else {
            held.serial
        };
        self.with(|m| {
            m.view
                .stat(m.op.overlay(), serial)
                .map(Stat::from)
                .map_err(workspace_error)
        })
        .map(Some)
    }

    pub fn list_next(&self, handle: u64, after: Option<&[u8]>) -> Result<Option<(Vec<u8>, Stat)>> {
        let held = self
            .handles
            .get(&handle)
            .ok_or_else(|| refused(0xc0000008, "stale directory handle"))?;
        if held.directory.is_none() {
            return Err(refused(0xc0000103, "not a directory handle"));
        }
        let parent = held.serial;
        let mut cursor = after.map(Vec::from);
        loop {
            let (entry, continuation) = self.with(|m| {
                let page = m
                    .view
                    .list(m.op.overlay(), parent, cursor.as_deref())
                    .map_err(workspace_error)?;
                let first = page
                    .entries
                    .into_iter()
                    .next()
                    .map(|(name, serial)| {
                        m.view
                            .stat(m.op.overlay(), serial)
                            .map(|stat| (name, Stat::from(stat)))
                            .map_err(workspace_error)
                    })
                    .transpose()?;
                Ok((first, page.continuation))
            })?;
            if entry.is_some() {
                return Ok(entry);
            }
            match continuation {
                Some(next) if cursor.as_ref().is_none_or(|old| *old < next) => cursor = Some(next),
                Some(_) => return Err(failed("directory continuation did not advance")),
                None => return Ok(None),
            }
        }
    }
}
