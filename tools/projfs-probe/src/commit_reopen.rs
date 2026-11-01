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

/// Independent read-only check for the eight-phase mapping fixture, not a flush.
pub fn verify_cache(path: &Path) -> Result<(), String> {
    let handles = Handles::open_read_only(
        PersistenceConfig::sqlite(path).with_sqlite_profile(SqlitePersistenceProfile::Disposable),
        BINDING,
        CURSOR,
    )
    .map_err(|e| e.to_string())?;
    let page = handles
        .history
        .commit_history(&CommitHistoryRequest {
            branch: branch(),
            start: None,
            cursor: None,
            limit: 10,
        })
        .map_err(|e| e.to_string())?;
    if page.records.is_empty() || page.continuation.is_some() || page.records.len() > 6 {
        return Err("cache fixture History count outside attempted Commit phases".into());
    }
    let head = handles
        .history
        .branch_snapshot(branch())
        .map_err(|e| e.to_string())?
        .ok_or("Branch absent")?;
    if head.branch.head_commit != Some(page.records[0].id)
        || head.effective_root != page.records[0].root
    {
        return Err("cache fixture head differs".into());
    }
    drop(handles);
    let mut previous = None;
    let mut last = 0;
    for record in page.records.iter().rev() {
        if record.parent != previous || record.meta.via != CommitVia::Workspace {
            return Err("cache history ancestry/provenance differs".into());
        }
        let mut saved = Saved::open_commit(path, BINDING, CURSOR, record.id)?;
        if saved.entry("cache.bin")?.ok_or("cache file absent")?.size != 4096 {
            return Err("cache length differs".into());
        }
        let bytes = saved.read("cache.bin", 0, 4096)?;
        if !(65..=68).contains(&bytes[0]) || bytes[0] < last || bytes[1..].iter().any(|&b| b != 65)
        {
            return Err("cache snapshot bytes differ from staged single-byte protocol".into());
        }
        println!(
            "CACHE_HISTORY id={:?} byte={} parent={:?} via=Workspace",
            record.id, bytes[0], record.parent
        );
        previous = Some(record.id);
        last = bytes[0];
    }
    if last != 68 {
        return Err("latest Commit has not captured final application byte".into());
    }
    println!(
        "REOPEN_CACHE_PASS commits={} final_byte=68 tail_exact=true head_exact=true readonly=true",
        page.records.len()
    );
    Ok(())
}

/// Read-only historical check for deterministic native post-capture mutation.
pub fn verify_concurrent(path: &Path) -> Result<(), String> {
    let handles = Handles::open_read_only(
        PersistenceConfig::sqlite(path).with_sqlite_profile(SqlitePersistenceProfile::Disposable),
        BINDING,
        CURSOR,
    )
    .map_err(|e| e.to_string())?;
    let page = handles
        .history
        .commit_history(&CommitHistoryRequest {
            branch: branch(),
            start: None,
            cursor: None,
            limit: 10,
        })
        .map_err(|e| e.to_string())?;
    if page.records.len() != 2 || page.continuation.is_some() {
        return Err("expected two concurrent-fixture Commits".into());
    }
    let latest = &page.records[0];
    let first = &page.records[1];
    if first.parent.is_some()
        || latest.parent != Some(first.id)
        || page
            .records
            .iter()
            .any(|c| c.meta.via != CommitVia::Workspace)
    {
        return Err("concurrent-fixture history ancestry/provenance".into());
    }
    let head = handles
        .history
        .branch_snapshot(branch())
        .map_err(|e| e.to_string())?
        .ok_or("Branch absent")?;
    if head.branch.head_commit != Some(latest.id) || head.effective_root != latest.root {
        return Err("concurrent-fixture head mismatch".into());
    }
    drop(handles);
    for (record, expected) in [
        (first, b"before commit".as_slice()),
        (latest, b"after! commit".as_slice()),
    ] {
        let mut saved = Saved::open_commit(path, BINDING, CURSOR, record.id)?;
        if saved
            .entry("concurrent.txt")?
            .ok_or("concurrent file absent")?
            .size
            != expected.len() as u64
            || saved.read("concurrent.txt", 0, expected.len() as u32)? != expected
        {
            return Err("captured old or later file bytes differ".into());
        }
        if record.id == first.id && saved.entry("late-during.txt")?.is_some() {
            return Err("post-capture creation leaked into first Commit".into());
        }
        if record.id == latest.id
            && (saved
                .entry("late-during.txt")?
                .ok_or("later created file absent")?
                .size
                != 14
                || saved.read("late-during.txt", 0, 14)? != b"new generation")
        {
            return Err("later created file differs".into());
        }
        if saved.list("many")?.len() != 80
            || saved.read("alpha.txt", 0, 28)? != b"old immutable Store version\n"
        {
            return Err("immutable base membership/content differs".into());
        }
    }
    println!("REOPEN_CONCURRENT_PASS commits=2 old_commit_fixed=true later_creation=true head_exact=true readonly=true");
    println!(
        "REOPEN_CONCURRENT_IDS first={:?} second={:?}",
        first.id, latest.id
    );
    Ok(())
}
