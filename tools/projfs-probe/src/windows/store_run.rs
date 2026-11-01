//! Integration proof: public Store reads -> ProjFS -> ordinary native process.
use super::{
    api::{failed, Api, Result},
    instance::{child, new_root, Namespace},
};
use crate::{
    source::Source,
    store_fixture::{branch, Fixture, DEFERRED},
};
use std::{fs, path::Path, sync::atomic::Ordering};

pub fn live_store(path: &Path) -> Result<()> {
    let api = Api::load()?;
    let root = new_root(path)?;
    let fixture = Fixture::create(&root).map_err(failed)?;
    let saved = fixture.saved().map_err(failed)?;
    let pinned = saved.root;
    if saved.range_reads != 0
        || saved.directory_reads != 0
        || saved.emitted_bytes != 0
        || saved.diagnostics().payload_reads != 0
    {
        return Err(failed("Store was eagerly scanned/read before projection"));
    }
    println!(
        "STORE_PIN root={pinned:?} directory_reads=0 range_reads=0 emitted=0 physical={:?}",
        saved.diagnostics()
    );
    let projection = root.join("projection");
    let mut namespace = Namespace::start(api, &projection, Source::Saved(Box::new(saved)))?;
    {
        let source = namespace.state.source.lock().map_err(failed)?;
        let saved = source.store().ok_or_else(|| failed("wrong source"))?;
        if saved.range_reads != 0
            || saved.directory_reads != 0
            || saved.diagnostics().payload_reads != 0
        {
            return Err(failed("startup eagerly materialized Store"));
        }
    }
    println!("PROJECTION_READY no_directory_scan=true no_file_ranges=true");
    // Change the mutable Branch after pinning but before any file hydration.
    // This is a normal Store call on a separate writer, not a projected writeback.
    fixture.advance_branch().map_err(failed)?;
    {
        let source = namespace.state.source.lock().map_err(failed)?;
        let saved = source.store().ok_or_else(|| failed("wrong source"))?;
        let current = saved.current_root(branch()).map_err(failed)?;
        if current == pinned {
            return Err(failed("test Branch did not advance"));
        }
        println!("PIN_STABLE pinned={pinned:?} current={current:?}");
    }
    let outcome = child(&projection, "store-child");
    namespace.stop();
    let state = &namespace.state;
    let errors = state.first_error.lock().map_err(failed)?;
    if let Some(e) = errors.as_ref() {
        return Err(failed(format!("provider error: {e}")));
    }
    let source = state.source.lock().map_err(failed)?;
    let saved = source.store().ok_or_else(|| failed("wrong source"))?;
    let calls = state.read_calls.load(Ordering::Relaxed);
    let panics = state.callback_panics.load(Ordering::Relaxed);
    let overflow = state.notification_overflow.load(Ordering::Relaxed);
    println!(
        "STORE_COUNTS directories={} ranges={} emitted={} files={:?} physical={:?}",
        saved.directory_reads,
        saved.range_reads,
        saved.emitted_bytes,
        saved.files_read,
        saved.diagnostics()
    );
    println!("CALLBACK_COUNTS reads={calls} panics={panics} overflow={overflow}");
    outcome?;
    if calls == 0 || panics != 0 || overflow != 0 || saved.files_read.contains("never.bin") {
        return Err(failed("lazy Store proof missing or poisoned"));
    }
    if projection.join("never.bin").exists() {
        return Err(failed("untouched file materialized on disk"));
    }
    if fixture.source.exists() {
        return Err(failed(
            "source fixture still reachable at its original path",
        ));
    }
    // The source is NTFS's published Store, never the renamed input directory.
    let mut latest = fixture.saved().map_err(failed)?;
    if latest.entry("local-only.txt").map_err(failed)?.is_some() {
        return Err(failed("local NTFS creation unexpectedly entered the Store"));
    }
    if fs::read(projection.join("local-only.txt")).map_err(failed)?
        != b"local NTFS file, not a Store Commit\n"
    {
        return Err(failed("local-only bytes did not survive provider stop"));
    }
    println!("READ_ONLY_SCOPE store_reader=true projected_existing_mutations_refused=true local_new_files_allowed=true writeback=false");
    let entry = latest
        .entry("alpha.txt")
        .map_err(failed)?
        .ok_or_else(|| failed("current file absent"))?;
    let bytes = latest
        .read("alpha.txt", 0, entry.size as u32)
        .map_err(failed)?;
    if bytes != b"new branch head after projection was pinned\n" {
        return Err(failed("latest Store head lost the test change"));
    }
    println!("STORE_PROJECTION_PASS pinned_root=true binary_exact=true nested=true paged_directory=true untouched_file_bytes={DEFERRED} untouched_file_read=false source_folder_absent=true");
    println!("NOT_RUN overlay_capture commit_writeback sandbox_isolation open_mapping_lifecycle");
    // No removal: the Store, source evidence, local hydrated cache and errors are retained.
    fs::metadata(&fixture.store).map_err(failed)?;
    Ok(())
}
