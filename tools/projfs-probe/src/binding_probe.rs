//! Guarded test setup and read-only verification for explicit native bindings.
use crate::{native_binding::Binding, saved::Saved, store_fixture::Fixture};
use layerfs_history::{CommitHistoryRequest, CommitVia, HistoryCatalog, HistoryCatalogConfig};
use layerfs_persistence::{Handles, PersistenceConfig, SqlitePersistenceProfile};
use std::path::Path;

pub fn run(mode: &str, path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("absolute diagnostic path required".into());
    }
    if mode == "binding-setup"
        && std::env::var_os("LAYERFS_PROJFS_PROBE_CHILD_ROOT").as_deref() != Some(path.as_os_str())
    {
        return Err("binding setup requires diagnostic parent".into());
    }
    let binding = Binding::read_from(std::io::stdin().lock())
        .map_err(|_| "invalid explicit binding input")?;
    if mode == "binding-setup" {
        Fixture::create_with(
            path,
            &HistoryCatalogConfig {
                binding_key: binding.catalog,
                cursor_key: binding.cursor,
                incarnation: 1,
            },
            binding.branch,
        )?;
        println!("EXPLICIT_STORE_SETUP initialized_once=true synthetic_input=true");
        return Ok(());
    }
    let handles = Handles::open_read_only(
        PersistenceConfig::sqlite(path).with_sqlite_profile(SqlitePersistenceProfile::Disposable),
        &binding.catalog,
        binding.cursor,
    )
    .map_err(|e| e.to_string())?;
    let page = handles
        .history
        .commit_history(&CommitHistoryRequest {
            branch: binding.branch,
            start: None,
            cursor: None,
            limit: 10,
        })
        .map_err(|e| e.to_string())?;
    if page.records.len() != 3 || page.continuation.is_some() {
        return Err("expected three explicit-binding Commits".into());
    }
    let records: Vec<_> = page.records.iter().rev().collect();
    for (i, r) in records.iter().enumerate() {
        if r.parent
            != if i == 0 {
                None
            } else {
                Some(records[i - 1].id)
            }
            || r.meta.via != CommitVia::Workspace
            || r.meta.branch != Some(binding.branch)
        {
            return Err("explicit-binding Commit provenance/parent mismatch".into());
        }
    }
    let head = handles
        .history
        .branch_snapshot(binding.branch)
        .map_err(|e| e.to_string())?
        .ok_or("Branch absent")?;
    if head.branch.head_commit != Some(records[2].id) || head.effective_root != records[2].root {
        return Err("explicit-binding head mismatch".into());
    }
    drop(handles);
    for (i, r) in records.iter().enumerate() {
        let mut saved = Saved::open_commit(path, &binding.catalog, binding.cursor, r.id)?;
        if saved.read("a.txt", 0, 5)? != b"alpha" {
            return Err("A publication changed".into());
        }
        if i == 0 {
            if saved.entry("b.txt")?.is_some() {
                return Err("B uncommitted view leaked into A Commit".into());
            }
        } else {
            let expected = if i == 1 { b"bravo" } else { b"after" };
            if saved.read("b.txt", 0, 5)? != expected
                || saved.entry("b.txt")?.ok_or("B missing")?.size != 5
            {
                return Err("B publication differs".into());
            }
        }
        if saved.entry("a.txt")?.ok_or("A missing")?.size != 5
            || saved.list("many")?.len() != 80
            || saved.read("alpha.txt", 0, 28)? != b"old immutable Store version\n"
        {
            return Err("base or A length differs".into());
        }
        println!(
            "BINDING_HISTORY index={i} id={:?} parent={:?} via=Workspace",
            r.id, r.parent
        );
    }
    println!("REOPEN_BINDING_PASS commits=3 same_branch=true isolated_before_commit=true merged_publications=true readonly=true");
    Ok(())
}
