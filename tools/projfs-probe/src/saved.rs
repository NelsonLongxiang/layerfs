//! Immutable root reads through public LayerFS ports; no SQL or OS projection here.
use layerfs_content::{
    compare::TreeTable,
    file,
    filesystem::{
        directory::read::{list_after, DirectoryReadWork},
        path::PathName,
        sorted::DirectoryRoot,
        FilesystemRootId,
    },
    object::inode_leaf::{InodeKind, InodeValue},
    ObjectId,
};
use layerfs_history::{BranchId, HistoryCatalog};
use layerfs_persistence::{Handles, PersistenceConfig, SqlitePersistenceProfile};
use layerfs_storage::{Diagnostics, Storage};
use layerfs_telemetry::timer::Timing;
use std::{collections::BTreeSet, path::Path};

pub type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Debug)]
pub struct Entry {
    pub name: String,
    pub directory: bool,
    pub size: u64,
}
/// A diagnostic cap on a single directory, never on a production Workspace.
pub const DIRECTORY_LIMIT: usize = 1024;
pub struct Saved {
    storage: Storage,
    handles: Handles,
    pub root: ObjectId,
    tree: TreeTable,
    pub directory_reads: u64,
    pub range_reads: u64,
    pub emitted_bytes: u64,
    pub files_read: BTreeSet<String>,
}
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
impl Saved {
    pub fn open(path: &Path, binding: &[u8], key: [u8; 32], branch: BranchId) -> Result<Self> {
        let handles = Handles::open_read_only(
            PersistenceConfig::sqlite(path)
                .with_sqlite_profile(SqlitePersistenceProfile::Disposable),
            binding,
            key,
        )
        .map_err(error)?;
        let snapshot = handles
            .history
            .branch_snapshot(branch)
            .map_err(error)?
            .ok_or("branch absent")?;
        let root = snapshot.effective_root;
        let storage = Storage::new(handles.storage.clone()).map_err(error)?;
        let tree = TreeTable::open(&storage.reader().map_err(error)?, FilesystemRootId(root))
            .map_err(error)?;
        Ok(Self {
            storage,
            handles,
            root,
            tree,
            directory_reads: 0,
            range_reads: 0,
            emitted_bytes: 0,
            files_read: BTreeSet::new(),
        })
    }
    pub fn diagnostics(&self) -> Diagnostics {
        self.storage.diagnostics()
    }
    pub fn current_root(&self, branch: BranchId) -> Result<ObjectId> {
        Ok(self
            .handles
            .history
            .branch_snapshot(branch)
            .map_err(error)?
            .ok_or("branch absent")?
            .effective_root)
    }
    fn inode(&self, path: &str) -> Result<Option<InodeValue>> {
        let reader = self.storage.reader().map_err(error)?;
        let mut serial = self.tree.root_serial();
        if !path.is_empty() {
            for name in path.split('/') {
                validate_name(name)?;
                let key = PathName::new(name).map_err(error)?;
                let Some(next) = self.tree.lookup(&reader, serial, &key).map_err(error)? else {
                    return Ok(None);
                };
                serial = next;
            }
        }
        self.tree.value(&reader, serial).map_err(error)
    }
    fn entry_value(&self, name: String, value: &InodeValue) -> Result<Entry> {
        match value.kind {
            InodeKind::Directory => Ok(Entry {
                name,
                directory: true,
                size: 0,
            }),
            InodeKind::RegularFile => {
                let sizes = self
                    .storage
                    .reader()
                    .map_err(error)?
                    .file_lengths(&[value.content_root])
                    .map_err(error)?;
                Ok(Entry {
                    name,
                    directory: false,
                    size: *sizes.first().ok_or("file size absent")?,
                })
            }
            InodeKind::Symlink => {
                Err("diagnostic does not project symlinks; no silent omission".into())
            }
        }
    }
    pub fn entry(&self, path: &str) -> Result<Option<Entry>> {
        self.inode(path)?
            .map(|v| self.entry_value(path.rsplit('/').next().unwrap_or("").into(), &v))
            .transpose()
    }
    pub fn list(&mut self, path: &str) -> Result<Vec<Entry>> {
        let dir = self.inode(path)?.ok_or("directory missing")?;
        if dir.kind != InodeKind::Directory {
            return Err("not a directory".into());
        }
        self.directory_reads += 1;
        let reader = self.storage.reader().map_err(error)?;
        let mut entries = Vec::new();
        let mut after = None;
        loop {
            let page = list_after(
                &reader,
                DirectoryRoot(dir.content_root),
                after.as_ref(),
                64,
                16384,
                &mut DirectoryReadWork::default(),
            )
            .map_err(error)?;
            let serials: Vec<_> = page.entries.iter().map(|(_, s)| *s).collect();
            let values = self.tree.values(&reader, &serials).map_err(error)?;
            for ((name, _), value) in page.entries.iter().zip(values) {
                let text = std::str::from_utf8(name.as_bytes())
                    .map_err(|_| "diagnostic requires UTF-8 names")?;
                validate_name(text)?;
                if entries.len() == DIRECTORY_LIMIT {
                    return Err(
                        "diagnostic directory cap reached; refusing truncated listing".into(),
                    );
                }
                entries.push(self.entry_value(text.into(), &value.ok_or("inode missing")?)?);
            }
            match page.continuation {
                Some(next) => after = Some(next),
                None => break,
            }
        }
        Ok(entries)
    }
    pub fn read(&mut self, path: &str, offset: u64, length: u32) -> Result<Vec<u8>> {
        let entry = self.inode(path)?.ok_or("file missing")?;
        if entry.kind != InodeKind::RegularFile {
            return Err("not a regular file".into());
        }
        let end = offset
            .checked_add(u64::from(length))
            .ok_or("range overflow")?;
        // Fixed 1 MiB diagnostic demand cap; callback chunks large requests rather than truncating.
        if length > 1024 * 1024 {
            return Err("diagnostic read demand exceeds 1 MiB".into());
        }
        let reader = self.storage.reader().map_err(error)?;
        let mut bytes = Vec::with_capacity(length as usize);
        Timing::disabled("projfs.saved.read", |scope| {
            file::read_range(
                &reader,
                entry.content_root,
                offset..end,
                &mut bytes,
                scope.child("range"),
            )
        })
        .0
        .map_err(error)?;
        if bytes.len() != length as usize {
            return Err("range cardinality mismatch".into());
        }
        self.range_reads += 1;
        self.emitted_bytes += bytes.len() as u64;
        self.files_read.insert(path.into());
        Ok(bytes)
    }
}
/// Explicit narrow diagnostic namespace. Never normalize two stored names to one.
pub fn validate_name(name: &str) -> Result<()> {
    PathName::new(name).map_err(error)?;
    if name.contains([':', '<', '>', '"', '|', '?', '*'])
        || name.chars().any(|c| c < ' ')
        || name.ends_with(['.', ' '])
    {
        return Err("unsupported Win32 diagnostic name".into());
    }
    let base = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((base.starts_with("COM") || base.starts_with("LPT"))
            && base.len() == 4
            && matches!(base.as_bytes()[3], b'1'..=b'9'))
    {
        return Err("reserved Win32 diagnostic name".into());
    }
    Ok(())
}
