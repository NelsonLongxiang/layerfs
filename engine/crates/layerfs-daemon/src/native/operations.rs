//! Native Workspace operations through existing typed Store/Overlay ports.
use super::session::State;
use super::types::{coded, mutation_error, validate, workspace_error};
use super::{failed, refused, Result, Stat};
use layerfs_store_service::write::mutation::Mutation;
use layerfs_workspace::{Operation, Position, WorkspaceError};
impl State {
    pub(super) fn with<T>(&self, run: impl FnOnce(&mut Mutation<'_>) -> Result<T>) -> Result<T> {
        self.accepting()?;
        let mut mutation =
            Mutation::new(&self.bound).map_err(|e| failed(format!("{}: {}", e.code, e.message)))?;
        let answer = run(&mut mutation);
        // A known pre-effect refusal can end its source window. Unknown owner
        // failure keeps the operation/source intact; never guess release or replay.
        if answer
            .as_ref()
            .is_err_and(|e| e.status == 0xc0000001u32 as i32)
        {
            std::mem::forget(mutation);
            return answer;
        }
        let end = mutation_error(mutation.finish());
        match (answer, end) {
            (Ok(v), Ok(())) => Ok(v),
            (Err(e), Ok(())) => Err(e),
            (_, Err(e)) => Err(e),
        }
    }

    pub fn stat_path(&self, path: &str) -> Result<Stat> {
        validate(path)?;
        self.with(|m| {
            m.resolve(path)
                .map(Stat::from)
                .map_err(|e| coded(&e.code, e.message))
        })
    }

    pub fn stat_handle(&self, handle: u64) -> Result<Stat> {
        let held = self
            .handles
            .get(&handle)
            .ok_or_else(|| refused(0xc0000008, "stale native handle"))?;
        self.with(|m| {
            m.view
                .stat(m.op.overlay(), held.serial)
                .map(Stat::from)
                .map_err(workspace_error)
        })
    }

    pub fn read(&self, handle: u64, offset: u64, length: u32) -> Result<Vec<u8>> {
        self.accepting()?;
        let held = self
            .handles
            .get(&handle)
            .ok_or_else(|| refused(0xc0000008, "stale native handle"))?;
        let file = held
            .file
            .ok_or_else(|| refused(0xc00000ba, "read directory"))?;
        if length as usize > layerfs_overlay::READ_WINDOW {
            return Err(refused(0xc000000d, "read window"));
        }
        let op = self.bound.operation().map_err(workspace_error)?;
        let visit = op
            .workspace()
            .kernel_data_visit(
                op.resident(),
                self.mount,
                held.serial,
                Some(file.owner_id()),
                offset,
                length,
            )
            .map_err(workspace_error)?;
        let window = op
            .overlay()
            .kernel_read_visit(self.bound.route(), Box::new(visit))
            .map_err(super::types::sourced)?;
        let base = op.workspace().base().map_err(workspace_error)?;
        (*window)
            .clone()
            .finish(Some(&base), held.serial, offset, length, false)
            .map_err(workspace_error)?
            .map_err(|e| workspace_error(WorkspaceError::Refused(e)))
    }

    pub fn write(
        &mut self,
        handle: u64,
        offset: u64,
        bytes: &[u8],
        append: bool,
        cached: bool,
    ) -> Result<Stat> {
        if !cached {
            self.namespace_admission()?;
        }
        if bytes.len() > layerfs_overlay::WRITE_WINDOW {
            return Err(refused(0xc000000d, "write window"));
        }
        let file = self
            .handles
            .get(&handle)
            .and_then(|h| h.file)
            .ok_or_else(|| refused(0xc0000008, "stale file handle"))?;
        if !cached && !self.handles.get(&handle).is_some_and(|h| h.data_writable) {
            return Err(refused(0xc0000022, "descriptor is read-only"));
        }
        let operation = if cached {
            Operation::StoreOpen {
                file,
                offset,
                data: bytes.into(),
            }
        } else {
            Operation::WriteOpen {
                file,
                position: if append {
                    Position::End
                } else {
                    Position::At(offset)
                },
                data: bytes.into(),
            }
        };
        self.with(|m| mutation_error(m.apply(operation).map(|_| ())))?;
        self.publications += 1;
        self.stat_handle(handle)
    }

    pub fn resize(&mut self, handle: u64, size: u64) -> Result<Stat> {
        self.namespace_admission()?;
        let file = self
            .handles
            .get(&handle)
            .and_then(|h| h.file)
            .ok_or_else(|| refused(0xc0000008, "stale file handle"))?;
        if !self.handles.get(&handle).is_some_and(|h| h.data_writable) {
            return Err(refused(0xc0000022, "descriptor is read-only"));
        }
        self.with(|m| {
            mutation_error(
                m.apply(Operation::SetOpenAttributes {
                    file,
                    mode: None,
                    mtime: None,
                    size: Some(size),
                })
                .map(|_| ()),
            )
        })?;
        self.publications += 1;
        self.stat_handle(handle)
    }
}
