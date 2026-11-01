//! Independent read-only process verification of the native Commit smoke fixture.
use crate::{
    saved::Saved,
    store_fixture::{branch, BINDING, CURSOR},
};
use layerfs_history::{CommitHistoryRequest, CommitVia, HistoryCatalog};
use layerfs_persistence::{Handles, PersistenceConfig, SqlitePersistenceProfile};
use std::path::Path;
pub fn verify(path: &Path) -> Result<(), String> {
    let handles = Handles::open_read_only(
        PersistenceConfig::sqlite(path).with_sqlite_profile(SqlitePersistenceProfile::Disposable),
        BINDING,
        CURSOR,
    )
    .map_err(|e| e.to_string())?;
    let history = handles
        .history
        .commit_history(&CommitHistoryRequest {
            branch: branch(),
            start: None,
            cursor: None,
            limit: 10,
        })
        .map_err(|e| e.to_string())?;
    if history.records.len() != 2 || history.continuation.is_some() {
        return Err("expected exactly two Workspace Commits".into());
    }
    let newer = &history.records[0];
    let older = &history.records[1];
    if newer.parent != Some(older.id)
        || older.parent.is_some()
        || newer.root == older.root
        || history
            .records
            .iter()
            .any(|c| c.meta.via != CommitVia::Workspace)
    {
        return Err("Commit ancestry/provenance differs".into());
    }
    let snapshot = handles
        .history
        .branch_snapshot(branch())
        .map_err(|e| e.to_string())?
        .ok_or("Branch absent")?;
    if snapshot.branch.head_commit != Some(newer.id) || snapshot.effective_root != newer.root {
        return Err("head differs from last Commit".into());
    }
    drop(handles);
    for (record, expected) in [
        (older, b"after! capture".as_slice()),
        (newer, b"final! capture".as_slice()),
    ] {
        let mut saved = Saved::open_commit(path, BINDING, CURSOR, record.id)?;
        if saved.list("")?.len() != if record.id == older.id { 9 } else { 10 }
            || saved.list("many")?.len() != 80
        {
            return Err("complete base membership changed".into());
        }
        let nested = if record.id == older.id {
            b"nested first"
        } else {
            b"nested final"
        };
        if saved
            .entry("archive/moved/keep.txt")?
            .ok_or("nested file absent")?
            .size
            != 12
            || saved.read("archive/moved/keep.txt", 0, 12)? != nested
            || saved.entry("work")?.is_some()
            || saved.entry("archive/moved/temp.txt")?.is_some()
        {
            return Err("nested directory rename/write/delete differs".into());
        }
        if record.id == older.id && saved.entry("archive/new")?.is_some() {
            return Err("late directory leaked into old Commit".into());
        }
        if record.id == newer.id
            && (saved
                .entry("archive/new/late.txt")?
                .ok_or("late nested file absent")?
                .size
                != 11
                || saved.read("archive/new/late.txt", 0, 11)? != b"nested late")
        {
            return Err("late nested file differs".into());
        }
        if saved
            .entry("capture.txt")?
            .ok_or("capture file absent")?
            .size
            != expected.len() as u64
            || saved.read("capture.txt", 0, expected.len() as u32)? != expected
        {
            return Err("immutable Commit bytes differ".into());
        }
        if saved.read(
            "alpha.txt",
            0,
            b"old immutable Store version\n".len() as u32,
        )? != b"old immutable Store version\n"
        {
            return Err("base file changed".into());
        }
        if saved
            .entry("probe.bin")?
            .ok_or("recreated file absent")?
            .size
            != 9
            || saved.read("probe.bin", 0, 9)? != b"new inode"
            || saved.entry("renamed.bin")?.is_some()
        {
            return Err("rename/delete/recreate membership differs".into());
        }
        if record.id == older.id && saved.entry("late.txt")?.is_some() {
            return Err("post-Commit creation leaked into first snapshot".into());
        }
        if record.id == newer.id
            && (saved.entry("late.txt")?.ok_or("late file absent")?.size != 12
                || saved.read("late.txt", 0, 12)? != b"after commit")
        {
            return Err("post-Commit creation absent from second snapshot".into());
        }
    }
    println!("REOPEN_COMMIT_PASS commits=2 via=Workspace ancestry=true old_snapshot_stable=true later_creation=true head_exact=true readonly=true");
    println!("REOPEN_IDS first={:?} second={:?}", older.id, newer.id);
    Ok(())
}
