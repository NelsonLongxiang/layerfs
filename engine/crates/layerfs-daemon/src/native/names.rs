//! Native Workspace operations through existing typed Store/Overlay ports.
use super::session::{Handle, State};
use super::types::{coded, mutation_error, validate, workspace_error};
use super::{failed, refused, Result, Stat};
use layerfs_content::filesystem::PathName;
use layerfs_overlay::Inode;
use layerfs_workspace::{Operation, WorkspaceError};
impl State {
    fn reference(&mut self, path: &str) -> Result<Inode> {
        let parts: Vec<_> = path.trim_start_matches('/').split('/').collect();
        let op = self.bound.operation().map_err(workspace_error)?;
        let mut parent = self.root;
        let mut held_parent = false;
        for (index, part) in parts.iter().enumerate() {
            let result =
                self.reference_child(parent, PathName::new(part).map_err(super::types::sourced)?);
            // Unknown owner outcomes retain every possibly acquired reference.
            if held_parent
                && !result
                    .as_ref()
                    .is_err_and(|e| e.status == 0xc0000001u32 as i32)
            {
                op.overlay()
                    .kernel_forget(self.bound.route(), self.mount, parent, 1)
                    .map_err(super::types::sourced)?;
            }
            let row = result?;
            if index + 1 == parts.len() {
                return Ok(row);
            }
            if row.kind != layerfs_overlay::InodeKind::Directory {
                op.overlay()
                    .kernel_forget(self.bound.route(), self.mount, row.serial, 1)
                    .map_err(super::types::sourced)?;
                return Err(refused(0xc0000103, "intermediate entry is not a directory"));
            }
            parent = row.serial;
            held_parent = true;
        }
        Err(refused(0xc000000d, "root needs no lookup"))
    }

    fn reference_child(&mut self, parent: u64, name: PathName) -> Result<Inode> {
        let op = self.bound.operation().map_err(workspace_error)?;
        match op.kernel_lookup(self.mount, parent, name) {
            Ok(value) => Ok(value.inode.clone()),
            Err(failure) => {
                if let Some(refusal) = failure.refusal() {
                    return Err(workspace_error(WorkspaceError::Refused(refusal)));
                }
                let original: std::sync::Arc<layerfs_store_service::store::KernelLookupFailure> =
                    failure.into();
                let error = super::Error {
                    status: 0xc0000001u32 as i32,
                    detail: original.to_string(),
                    source: Some(original.clone()),
                };
                self.retained_lookup = Some(original);
                Err(error)
            }
        }
    }

    pub fn open_windows(&mut self, path: &str, access: u32) -> Result<(u64, Stat)> {
        if access & !7 != 0 {
            return Err(refused(0xc000000d, "invalid native access"));
        }
        if access != 0 {
            self.namespace_admission()?;
        }
        let data_writable = access & 1 != 0;
        let attributes_writable = access & 2 != 0;
        validate(path)?;
        let stat = self.stat_path(path)?;
        let lookup = path != "/";
        if lookup {
            let row = self.reference(path)?;
            if row.serial != stat.serial {
                return Err(failed("name changed during native open"));
            }
        }
        let request = self.sequence()?;
        let op = self.bound.operation().map_err(workspace_error)?;
        let kind = if stat.directory != 0 {
            layerfs_store_service::store::KernelOpenKind::Directory
        } else {
            layerfs_store_service::store::KernelOpenKind::File {
                writable: data_writable || attributes_writable,
            }
        };
        let opened = match op.kernel_open(self.mount, request, stat.serial, kind) {
            Ok(value) => value,
            Err(failure) => {
                if let Some(refusal) = failure.refusal() {
                    if lookup {
                        failure
                            .operation()
                            .overlay()
                            .kernel_forget(self.bound.route(), self.mount, stat.serial, 1)
                            .map_err(super::types::sourced)?;
                    }
                    return Err(workspace_error(WorkspaceError::Refused(refusal)));
                }
                let original: std::sync::Arc<layerfs_store_service::store::KernelOpenFailure> =
                    failure.into();
                let error = super::Error {
                    status: 0xc0000001u32 as i32,
                    detail: original.to_string(),
                    source: Some(original.clone()),
                };
                self.retained_open = Some(original);
                return Err(error);
            }
        };
        let (file, directory) = match opened.descriptor {
            layerfs_store_service::store::KernelDescriptor::File(file) => (Some(file), None),
            layerfs_store_service::store::KernelDescriptor::Directory(directory) => {
                (None, Some(directory))
            }
        };
        let held = Handle {
            serial: stat.serial,
            file,
            directory,
            lookup,
            data_writable,
            attributes_writable,
            delete_access: access & 4 != 0,
            cleaned: false,
            path: Some(path.to_owned()),
        };
        self.handles.insert(request, held);
        Ok((request, stat))
    }

    pub fn create_file(&mut self, path: &str) -> Result<(u64, Stat)> {
        self.create_entry(path, false)
    }

    pub fn create_directory(&mut self, path: &str) -> Result<(u64, Stat)> {
        self.create_entry(path, true)
    }

    fn create_entry(&mut self, path: &str, directory: bool) -> Result<(u64, Stat)> {
        self.create_windows(path, directory, 0, !directory, true)
    }

    pub fn create_windows(
        &mut self,
        path: &str,
        directory: bool,
        attributes: u32,
        data_writable: bool,
        attributes_writable: bool,
    ) -> Result<(u64, Stat)> {
        validate(path)?;
        self.namespace_admission()?;
        if attributes & !0xb7 != 0 || attributes & 0x10 != 0 && !directory {
            return Err(refused(0xc00000bb, "unrepresented creation attributes"));
        }
        if path == "/" {
            return Err(refused(0xc0000035, "root exists"));
        }
        self.with(|m| {
            let (parent, name) = m.parent(path).map_err(|e| coded(&e.code, e.message))?;
            let operation = Operation::CreateWindows {
                parent,
                name,
                directory,
                attributes: attributes & 0x27,
            };
            mutation_error(m.apply(operation).map(|_| ()))
        })?;
        self.publications += 1;
        self.open_access(path, data_writable, attributes_writable)
    }

    pub fn rename(&mut self, from: &str, to: &str, replace: bool) -> Result<()> {
        self.namespace_admission()?;
        validate(from)?;
        validate(to)?;
        if from == "/" || to == "/" {
            return Err(refused(0xc0000022, "cannot rename root"));
        }
        self.with(|m| {
            let (parent, name) = m.parent(from).map_err(|e| coded(&e.code, e.message))?;
            let (new_parent, new_name) = m.parent(to).map_err(|e| coded(&e.code, e.message))?;
            let destination = to
                .rsplit_once('/')
                .ok_or_else(|| failed("destination parent"))?
                .0;
            let destination_path = destination
                .split('/')
                .filter(|p| !p.is_empty())
                .map(PathName::new)
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(super::types::sourced)?;
            mutation_error(
                m.apply(Operation::Rename {
                    parent,
                    name,
                    new_parent,
                    new_name,
                    replace,
                    destination_path: Some(destination_path),
                })
                .map(|_| ()),
            )
        })?;
        self.renamed_hints(from, to);
        self.publications += 1;
        Ok(())
    }

    pub fn can_delete(&self, path: &str) -> Result<()> {
        self.namespace_admission()?;
        validate(path)?;
        if path == "/" {
            return Err(refused(0xc0000022, "cannot delete root"));
        }
        self.with(|m| {
            let stat = m.resolve(path).map_err(|e| coded(&e.code, e.message))?;
            if stat.kind == layerfs_content::object::inode_leaf::InodeKind::Directory {
                let mut after = None;
                loop {
                    let page = m
                        .view
                        .list(m.op.overlay(), stat.serial, after.as_deref())
                        .map_err(workspace_error)?;
                    if !page.entries.is_empty() {
                        return Err(refused(0xc0000101, "directory not empty"));
                    }
                    match page.continuation {
                        Some(next) if after.as_ref().is_none_or(|old| *old < next) => {
                            after = Some(next)
                        }
                        Some(_) => return Err(failed("delete-check cursor did not advance")),
                        None => break,
                    }
                }
            }
            Ok(())
        })
    }

    pub fn unlink(&mut self, path: &str) -> Result<()> {
        self.namespace_admission()?;
        validate(path)?;
        if path == "/" {
            return Err(refused(0xc0000022, "cannot delete root"));
        }
        self.with(|m| {
            let stat = m.resolve(path).map_err(|e| coded(&e.code, e.message))?;
            let (parent, name) = m.parent(path).map_err(|e| coded(&e.code, e.message))?;
            let operation =
                if stat.kind == layerfs_content::object::inode_leaf::InodeKind::Directory {
                    Operation::Rmdir { parent, name }
                } else {
                    Operation::Unlink { parent, name }
                };
            mutation_error(m.apply(operation).map(|_| ()))
        })?;
        self.unlinked_hints(path);
        self.publications += 1;
        Ok(())
    }
}
