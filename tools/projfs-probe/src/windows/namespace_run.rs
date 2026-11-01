//! An NTFS directory sharing guard is not a recursive namespace capture.
use super::{
    api::{failed, Api, Result},
    instance::{child, new_root, Namespace},
};
use crate::{seed, source::Source, NAME};
use std::sync::atomic::Ordering;
use std::{
    fs::{self, OpenOptions},
    io::Read,
    os::windows::fs::OpenOptionsExt,
    path::Path,
};
use windows_sys::Win32::Storage::FileSystem::{FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_READ};

pub fn namespace_child(root: &Path) -> Result<()> {
    if std::env::var_os("LAYERFS_PROJFS_PROBE_CHILD_ROOT").as_deref() != Some(root.as_os_str()) {
        return Err(failed("namespace child requires live provider"));
    }
    match OpenOptions::new().write(true).open(root.join(NAME)) {
        Err(e) if e.raw_os_error() == Some(32) => println!("GUARDED_FILE_WRITE_REFUSED win32=32"),
        Err(e) => return Err(failed(e)),
        Ok(_) => return Err(failed("guarded-file writer unexpectedly accepted")),
    }
    fs::create_dir(root.join("added")).map_err(failed)?;
    fs::write(root.join("added/created.txt"), b"new child").map_err(failed)?;
    fs::rename(root.join("added/created.txt"), root.join("added/kept.txt")).map_err(failed)?;
    fs::write(root.join("mutable.txt"), b"after").map_err(failed)?;
    fs::remove_file(root.join("removable.txt")).map_err(failed)?;
    // MoveFileEx may need a write open on the root itself: unlike nested rename,
    // that exact operation conflicts with the retained directory guard.
    match fs::rename(root.join("renamable.txt"), root.join("renamed.txt")) {
        Err(e) if e.raw_os_error() == Some(32) => println!("ROOT_RENAME_REFUSED win32=32"),
        Err(e) => return Err(failed(e)),
        Ok(()) => return Err(failed("root rename unexpectedly accepted")),
    }
    println!("NAMESPACE_CHILD_PASS mkdir=true create=true write=true nested_rename=true delete=true root_rename_refused=true");
    Ok(())
}
pub fn namespace_live(path: &Path) -> Result<()> {
    let api = Api::load()?;
    let root = new_root(path)?;
    let mut ns = Namespace::start(api, &root, Source::Fixture(seed()))?;
    fs::write(root.join("mutable.txt"), b"before").map_err(failed)?;
    fs::write(root.join("removable.txt"), b"remove").map_err(failed)?;
    fs::write(root.join("renamable.txt"), b"rename").map_err(failed)?;
    let mut guarded = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(root.join(NAME))
        .map_err(failed)?;
    let mut bytes = Vec::new();
    guarded.read_to_end(&mut bytes).map_err(failed)?;
    if bytes != seed() {
        return Err(failed("initial projected bytes differ"));
    }
    // A handle denying share WRITE/DELETE protects this directory object, not all
    // descendant entries. This control is NOT a recursive lock or snapshot.
    let directory = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(&root)
        .map_err(failed)?;
    println!("DIRECTORY_GUARD_HELD share_read_only=true file_guard_held=true");
    let outcome = child(&root, "namespace-child");
    let mut unchanged = Vec::new();
    use std::io::{Seek, SeekFrom};
    guarded.seek(SeekFrom::Start(0)).map_err(failed)?;
    guarded.read_to_end(&mut unchanged).map_err(failed)?;
    let mutated = fs::read(root.join("mutable.txt")).map_err(failed)? == b"after"
        && fs::read(root.join("added/kept.txt")).map_err(failed)? == b"new child"
        && !root.join("removable.txt").try_exists().map_err(failed)?
        && !root.join("renamed.txt").try_exists().map_err(failed)?
        && fs::read(root.join("renamable.txt")).map_err(failed)? == b"rename";
    drop(directory);
    drop(guarded);
    ns.stop();
    outcome?;
    let panics = ns.state.callback_panics.load(Ordering::Relaxed);
    let overflow = ns.state.notification_overflow.load(Ordering::Relaxed);
    let error = ns.state.first_error.lock().map_err(failed)?;
    if !mutated || unchanged != bytes || panics != 0 || overflow != 0 || error.is_some() {
        return Err(failed("namespace boundary proof missing/poisoned"));
    }
    let events = ns.state.notifications.lock().map_err(failed)?;
    for (kind, path, dest) in events.iter() {
        println!("NAMESPACE_NOTIFY {kind} {path:?} -> {dest:?}");
    }
    println!("NAMESPACE_BOUNDARY_PASS guarded_bytes_stable=true descendants_mutated=true directory_guard_not_snapshot=true panics=0 overflow=0");
    println!("NOT_RUN atomic_namespace_capture generation_writeback workspace_commit");
    Ok(())
}
