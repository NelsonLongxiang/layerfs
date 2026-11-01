// Real Store + Overlay integration test, no WinFsp kernel needed for this layer.
#[cfg(windows)]
#[test]
fn public_overlay_bridge_preserves_capture_and_open_custody() {
    use layerfs_native_probe::native_overlay::{CommitScope, Session};
    let parent = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tmp")
        .canonicalize()
        .unwrap();
    let root = parent.join(format!(
        "native-overlay-unit-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut s = Session::create(&root).unwrap();
    let (base, _) = s.open("/alpha.txt", false).unwrap();
    assert_eq!(
        s.read(base, 0, 4096).unwrap(),
        b"old immutable Store version\n"
    );
    assert!(s.write(base, 0, b"not allowed", false, false).is_err());
    assert_eq!(
        s.read(base, 0, 4096).unwrap(),
        b"old immutable Store version\n"
    );
    assert_eq!(
        s.stat_path("/nested/data.bin").unwrap().size,
        layerfs_native_probe::store_fixture::LARGE as u64
    );
    assert!(s.stat_path("/nested/../alpha.txt").is_err());
    s.close_file(base).unwrap();
    let (h, stat) = s.create_file("/capture.txt").unwrap();
    assert!(stat.serial > 0);
    assert!(s.create_file("/capture.txt").is_err());
    s.write(h, 0, b"before capture", false, false).unwrap();
    s.capture().unwrap();
    assert_eq!(
        s.commit(CommitScope::Published).unwrap_err().status as u32,
        0x80000011
    );
    s.write(h, 0, b"after!", false, false).unwrap();
    assert_eq!(s.captured_bytes("/capture.txt").unwrap(), b"before capture");
    assert_eq!(s.read(h, 0, 4096).unwrap(), b"after! capture");
    s.resize(h, 6).unwrap();
    s.rename("/capture.txt", "/renamed.txt", false).unwrap();
    assert_eq!(s.read(h, 0, 4096).unwrap(), b"after!");
    s.unlink("/renamed.txt").unwrap();
    assert_eq!(s.read(h, 0, 4096).unwrap(), b"after!");
    s.write(h, 0, b"orphan", false, false).unwrap();
    assert_eq!(s.read(h, 0, 4096).unwrap(), b"orphan");
    assert_eq!(s.captured_bytes("/capture.txt").unwrap(), b"before capture");
    s.close_file(h).unwrap();
    assert!(s.read(h, 0, 1).is_err());
    assert_eq!(s.prepare_close().unwrap_err().status as u32, 0x80000011);
    s.release_capture().unwrap();
    s.finish().unwrap();
    println!("OVERLAY_UNIT_PASS retained_root={}", root.display());
}

#[cfg(windows)]
#[test]
fn captured_commit_installs_and_keeps_open_descriptor_usable() {
    use layerfs_native_probe::native_overlay::{CommitScope, Session};
    let parent = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tmp")
        .canonicalize()
        .unwrap();
    let root = parent.join(format!(
        "native-commit-unit-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut s = Session::create(&root).unwrap();
    assert!(
        layerfs_native_probe::commit_reopen::verify(&root.join("store.sqlite")).is_err(),
        "empty history must not pass native Commit checker"
    );
    let (h, _) = s.create_file("/capture.txt").unwrap();
    s.write(h, 0, b"committed one", false, false).unwrap();
    assert!(s.commit(CommitScope::Published).unwrap());
    assert_eq!(
        s.committed_bytes(0, "/capture.txt").unwrap(),
        b"committed one"
    );
    assert_eq!(s.read(h, 0, 4096).unwrap(), b"committed one");
    s.write(h, 0, b"committed two", false, false).unwrap();
    assert_eq!(s.read(h, 0, 4096).unwrap(), b"committed two");
    assert_eq!(
        s.committed_bytes(0, "/capture.txt").unwrap(),
        b"committed one"
    );
    assert!(s.commit(CommitScope::Published).unwrap());
    assert_eq!(
        s.committed_bytes(1, "/capture.txt").unwrap(),
        b"committed two"
    );
    assert!(
        !s.commit(CommitScope::Published).unwrap(),
        "unchanged frontier creates no Commit"
    );
    assert!(
        layerfs_native_probe::commit_reopen::verify(&root.join("store.sqlite")).is_err(),
        "two Commits with wrong exact fixture bytes must not pass"
    );
    assert_eq!(s.read(h, 0, 4096).unwrap(), b"committed two");
    s.close_file(h).unwrap();
    s.finish().unwrap();
    let mut reopened = layerfs_native_probe::saved::Saved::open(
        &root.join("store.sqlite"),
        layerfs_native_probe::store_fixture::BINDING,
        layerfs_native_probe::store_fixture::CURSOR,
        layerfs_native_probe::store_fixture::branch(),
    )
    .unwrap();
    assert_eq!(
        reopened.read("capture.txt", 0, 13).unwrap(),
        b"committed two"
    );
    println!("NATIVE_COMMIT_UNIT_PASS root={}", root.display());
}

#[cfg(windows)]
#[test]
fn nested_directory_moves_and_same_store_rebind_use_existing_ports() {
    use layerfs_native_probe::native_overlay::{CommitScope, Session};
    fn names(s: &Session, h: u64) -> Vec<String> {
        let mut result = Vec::new();
        let mut after = None;
        while let Some((name, _)) = s.list_next(h, after.as_deref()).unwrap() {
            assert!(after.as_ref().is_none_or(|old| *old < name));
            result.push(String::from_utf8(name.clone()).unwrap());
            after = Some(name);
        }
        result
    }
    let parent = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tmp")
        .canonicalize()
        .unwrap();
    let root = parent.join(format!(
        "native-nested-unit-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut s = Session::create(&root).unwrap();
    for path in ["/work", "/archive", "/work/src"] {
        let (h, stat) = s.create_directory(path).unwrap();
        assert_eq!(stat.directory, 1);
        s.close_file(h).unwrap();
    }
    let (h, _) = s.create_file("/work/src/a.txt").unwrap();
    s.write(h, 0, b"nested", false, false).unwrap();
    s.close_file(h).unwrap();
    let (dir, _) = s.open("/work/src", false).unwrap();
    assert_eq!(names(&s, dir), ["a.txt"]);
    s.close_file(dir).unwrap();
    assert_eq!(
        s.can_delete("/work/src").unwrap_err().status as u32,
        0xc0000101
    );
    assert_eq!(s.unlink("/work/src").unwrap_err().status as u32, 0xc0000101);
    assert!(s.rename("/work", "/work/src/cycle", false).is_err());
    assert!(s.stat_path("/work/src/a.txt/child").is_err());
    s.rename("/work/src", "/archive/moved", false).unwrap();
    assert!(s.stat_path("/work/src").is_err());
    let (h, _) = s.open("/archive/moved/a.txt", false).unwrap();
    assert_eq!(s.read(h, 0, 100).unwrap(), b"nested");
    s.close_file(h).unwrap();
    s.can_delete("/work").unwrap();
    s.unlink("/work").unwrap();
    let (dir, _) = s.open("/many", false).unwrap();
    assert_eq!(names(&s, dir).len(), 80);
    s.close_file(dir).unwrap();
    assert!(s.commit(CommitScope::Published).unwrap());
    s.finish().unwrap();
    drop(s);
    let work = root.join("rebound");
    let mut rebound = Session::reopen(&root.join("store.sqlite"), &work).unwrap();
    let (h, _) = rebound.open("/archive/moved/a.txt", false).unwrap();
    assert_eq!(rebound.read(h, 0, 100).unwrap(), b"nested");
    rebound.close_file(h).unwrap();
    let (dir, _) = rebound.open("/archive/moved", false).unwrap();
    assert_eq!(names(&rebound, dir), ["a.txt"]);
    rebound.close_file(dir).unwrap();
    assert!(!rebound.commit(CommitScope::Published).unwrap());
    rebound.finish().unwrap();
    println!("NESTED_REBIND_UNIT_PASS root={}", root.display());
}

#[cfg(windows)]
#[test]
fn published_observer_and_constrained_stores_preserve_capture_and_eof() {
    use layerfs_native_probe::native_overlay::{CommitScope, Session};
    let parent = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tmp")
        .canonicalize()
        .unwrap();
    let root = parent.join(format!(
        "native-cache-unit-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut s = Session::create(&root).unwrap();
    let (h, _) = s.create_file("/cache.bin").unwrap();
    assert!(s.published_byte("/cache.bin").is_err());
    s.write(h, 0, &[65; 4096], false, false).unwrap();
    assert_eq!(s.published_byte("/cache.bin").unwrap(), 65);
    s.capture().unwrap();
    s.write(h, 0, &[66], false, true).unwrap();
    assert_eq!(s.published_byte("/cache.bin").unwrap(), 66);
    assert_eq!(s.captured_bytes("/cache.bin").unwrap(), [65; 4096]);
    s.release_capture().unwrap();
    assert!(s.commit(CommitScope::Published).unwrap());
    assert_eq!(s.committed_bytes(0, "/cache.bin").unwrap()[0], 66);
    s.resize(h, 2).unwrap();
    s.write(h, 1, b"XYZ", false, true).unwrap();
    assert_eq!(s.read(h, 0, 100).unwrap(), b"BX");
    s.write(h, 4096, b"ignored", false, true).unwrap();
    assert_eq!(s.stat_handle(h).unwrap().size, 2);
    assert_eq!(s.read(h, 0, 100).unwrap(), b"BX");
    assert_eq!(s.committed_bytes(0, "/cache.bin").unwrap().len(), 4096);
    s.close_file(h).unwrap();
    assert!(s.write(h, 0, b"stale", false, true).is_err());
    s.finish().unwrap();
    println!("CACHE_STORE_UNIT_PASS root={}", root.display());
}

#[cfg(windows)]
#[test]
fn unimplemented_commit_guarantees_refuse_before_capture_or_history_effect() {
    use layerfs_history::HistoryCatalog;
    use layerfs_native_probe::native_overlay::{CommitScope, Session};
    use layerfs_native_probe::store_fixture::{branch, BINDING, CURSOR};
    use layerfs_persistence::{Handles, PersistenceConfig, SqlitePersistenceProfile};
    let parent = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tmp")
        .canonicalize()
        .unwrap();
    let root = parent.join(format!(
        "native-scope-unit-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut s = Session::create(&root).unwrap();
    let (h, _) = s.create_file("/scope.txt").unwrap();
    s.write(h, 0, b"not yet committed", false, false).unwrap();
    let catalog = Handles::open_read_only(
        PersistenceConfig::sqlite(root.join("store.sqlite"))
            .with_sqlite_profile(SqlitePersistenceProfile::Disposable),
        BINDING,
        CURSOR,
    )
    .unwrap();
    for captured in [false, true] {
        if captured {
            s.capture().unwrap();
        }
        let frontier = s.frontier().unwrap();
        let snapshot = catalog.history.branch_snapshot(branch()).unwrap();
        assert_eq!(
            s.commit(CommitScope::ApplicationVisible)
                .unwrap_err()
                .status as u32,
            0xc00000bb
        );
        assert_eq!(
            s.frontier().unwrap(),
            frontier,
            "refusal cannot capture, install or change revision"
        );
        assert_eq!(
            catalog.history.branch_snapshot(branch()).unwrap(),
            snapshot,
            "refusal cannot publish History"
        );
        assert_eq!(s.read(h, 0, 100).unwrap(), b"not yet committed");
        if captured {
            assert_eq!(
                s.captured_bytes("/scope.txt").unwrap(),
                b"not yet committed"
            );
            s.release_capture().unwrap();
        }
    }
    for code in [0, 3, u32::MAX] {
        assert_eq!(
            CommitScope::try_from(code).unwrap_err().status as u32,
            0xc000000d
        );
    }
    assert!(
        s.commit(CommitScope::Published).unwrap(),
        "existing published route remains available with open handle"
    );
    let frontier = s.frontier().unwrap();
    let snapshot = catalog.history.branch_snapshot(branch()).unwrap();
    assert_eq!(
        s.commit(CommitScope::ApplicationVisible)
            .unwrap_err()
            .status as u32,
        0xc00000bb
    );
    assert_eq!(s.frontier().unwrap(), frontier);
    assert_eq!(catalog.history.branch_snapshot(branch()).unwrap(), snapshot);
    assert!(!s.commit(CommitScope::Published).unwrap());
    s.write(h, 0, b"later", false, false).unwrap();
    assert!(s.commit(CommitScope::Published).unwrap());
    s.close_file(h).unwrap();
    drop(catalog);
    s.finish().unwrap();
    println!(
        "COMMIT_SCOPE_UNIT_PASS refusal_before_effect=true published_route_kept=true root={}",
        root.display()
    );
}

#[cfg(windows)]
#[test]
fn captured_commit_allows_later_published_writes_before_install() {
    use layerfs_history::HistoryCatalog;
    use layerfs_native_probe::native_overlay::{CommitScope, Session};
    use layerfs_native_probe::store_fixture::{BINDING, CURSOR};
    use layerfs_persistence::{Handles, PersistenceConfig, SqlitePersistenceProfile};
    use std::{
        sync::mpsc,
        time::{Duration, Instant},
    };
    let parent = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tmp")
        .canonicalize()
        .unwrap();
    let root = parent.join(format!(
        "native-concurrent-unit-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut s = Session::create(&root).unwrap();
    let (h, _) = s.create_file("/concurrent.txt").unwrap();
    s.write(h, 0, b"before commit", false, false).unwrap();
    // Public writer admission is a test-only interleaving control, not normal wiring.
    let gate = Handles::open_writable(
        PersistenceConfig::sqlite(root.join("store.sqlite"))
            .with_sqlite_profile(SqlitePersistenceProfile::Disposable),
        BINDING,
        CURSOR,
    )
    .unwrap();
    let lane = gate.history.publish_lane().unwrap();
    let work = s.begin_commit(CommitScope::Published).unwrap();
    assert_eq!(
        s.begin_commit(CommitScope::Published).err().unwrap().status as u32,
        0x80000011
    );
    assert_eq!(s.capture().unwrap_err().status as u32, 0x80000011);
    assert_eq!(s.finish().unwrap_err().status as u32, 0x80000011);
    let (tx, rx) = mpsc::sync_channel(1);
    let worker = std::thread::spawn(move || {
        let result = work.run();
        if let Err(original) = tx.send(result) {
            std::mem::forget(original.0);
        }
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    let captured = loop {
        let state = s.frontier().unwrap();
        if state.captured.is_some() {
            break state;
        }
        assert!(Instant::now() < deadline, "capture readiness deadline");
        std::thread::sleep(Duration::from_millis(5));
    };
    assert!(
        !worker.is_finished(),
        "lane must hold publication until explicit release"
    );
    s.write(h, 0, b"during commit", false, false).unwrap();
    let (late, _) = s.create_file("/late-during.txt").unwrap();
    s.write(late, 0, b"new generation", false, false).unwrap();
    s.close_file(late).unwrap();
    let later = s.frontier().unwrap();
    assert_eq!(later.captured, captured.captured);
    assert!(later.revision > captured.revision);
    assert_eq!(s.read(h, 0, 100).unwrap(), b"during commit");
    drop(lane);
    drop(gate);
    let completion = rx
        .recv_timeout(Duration::from_secs(15))
        .expect("Commit completion deadline");
    worker.join().unwrap();
    // The worker has finished but its exact result is not yet returned to Session.
    // Close/re-capture/another Commit still cannot steal this ownership window.
    assert_eq!(
        s.begin_commit(CommitScope::Published).err().unwrap().status as u32,
        0x80000011
    );
    assert_eq!(s.capture().unwrap_err().status as u32, 0x80000011);
    assert_eq!(s.finish().unwrap_err().status as u32, 0x80000011);
    assert!(s.complete_commit(completion).unwrap());
    assert_eq!(
        s.committed_bytes(0, "/concurrent.txt").unwrap(),
        b"before commit"
    );
    assert_eq!(
        s.committed_bytes(0, "/late-during.txt").unwrap_err().status as u32,
        0xc0000034
    );
    assert_eq!(s.read(h, 0, 100).unwrap(), b"during commit");
    let installed = s.frontier().unwrap();
    assert!(installed.captured.is_none());
    assert!(installed.dirty_inodes > 0);
    s.write(h, 0, b"after! commit", false, false).unwrap();
    assert!(s.commit(CommitScope::Published).unwrap());
    assert_eq!(
        s.committed_bytes(1, "/concurrent.txt").unwrap(),
        b"after! commit"
    );
    assert_eq!(
        s.committed_bytes(1, "/late-during.txt").unwrap(),
        b"new generation"
    );
    assert_eq!(
        s.committed_bytes(0, "/concurrent.txt").unwrap(),
        b"before commit"
    );
    s.close_file(h).unwrap();
    s.finish().unwrap();
    println!("CONCURRENT_COMMIT_UNIT_PASS capture_revision={} later_revision={} old_root_fixed=true install_kept_later=true root={}",captured.revision,later.revision,root.display());
}

#[cfg(windows)]
#[test]
fn abandoned_or_misrouted_commit_keeps_admission_and_original_result() {
    use layerfs_native_probe::native_overlay::{CommitScope, Session};
    let parent = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tmp")
        .canonicalize()
        .unwrap();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let mut original =
        Session::create(&parent.join(format!("native-custody-a-{}-{stamp}", std::process::id())))
            .unwrap();
    let mut other =
        Session::create(&parent.join(format!("native-custody-b-{}-{stamp}", std::process::id())))
            .unwrap();
    let work = original.begin_commit(CommitScope::Published).unwrap();
    let before = original.frontier().unwrap();
    let completion = work.run(); // UpToDate: no fixture mutation required to exercise ownership.
    assert!(other.complete_commit(completion).is_err());
    assert_eq!(original.frontier().unwrap(), before);
    assert_eq!(original.finish().unwrap_err().status as u32, 0x80000011);
    assert_eq!(
        original
            .begin_commit(CommitScope::Published)
            .err()
            .unwrap()
            .status as u32,
        0x80000011
    );
    assert!(
        other.finish().is_err(),
        "receiver must keep the foreign completion, not discard it"
    );
    // Both stores intentionally remain in retained failure custody. This diagnostic
    // performs no guessed recovery, and process exit releases OS resources.
    std::mem::forget(original);
    std::mem::forget(other);
    let mut dropped =
        Session::create(&parent.join(format!("native-custody-c-{}-{stamp}", std::process::id())))
            .unwrap();
    let before = dropped.frontier().unwrap();
    drop(dropped.begin_commit(CommitScope::Published).unwrap());
    assert_eq!(dropped.frontier().unwrap(), before);
    assert_eq!(dropped.capture().unwrap_err().status as u32, 0x80000011);
    assert_eq!(dropped.finish().unwrap_err().status as u32, 0x80000011);
    std::mem::forget(dropped);
    println!(
        "COMMIT_CUSTODY_UNIT_PASS dropped_work_retains_admission=true foreign_result_retained=true"
    );
}

#[cfg(windows)]
#[test]
fn normal_close_refuses_owned_references_then_fences_new_admission() {
    use layerfs_native_probe::native_overlay::{CommitScope, Session};
    let parent = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tmp")
        .canonicalize()
        .unwrap();
    let root = parent.join(format!(
        "native-close-unit-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut s = Session::create(&root).unwrap();
    let (file, _) = s.open("/alpha.txt", false).unwrap();
    let state = s.close_state();
    let frontier = s.frontier().unwrap();
    assert_eq!(s.prepare_close().unwrap_err().status as u32, 0x80000011);
    assert_eq!(s.close_state(), state);
    assert_eq!(s.frontier().unwrap(), frontier);
    assert_eq!(
        s.read(file, 0, 100).unwrap(),
        b"old immutable Store version\n"
    );
    s.close_file(file).unwrap();
    let (dir, _) = s.open("/many", false).unwrap();
    let state = s.close_state();
    assert_eq!(state.directories, 1);
    assert_eq!(s.prepare_close().unwrap_err().status as u32, 0x80000011);
    assert_eq!(s.close_state(), state);
    assert!(s.list_next(dir, None).unwrap().is_some());
    s.close_file(dir).unwrap();
    let (f, _) = s.create_file("/new.txt").unwrap();
    s.write(f, 0, b"kept", false, false).unwrap();
    s.close_file(f).unwrap();
    s.capture().unwrap();
    let state = s.close_state();
    let frontier = s.frontier().unwrap();
    assert_eq!(s.prepare_close().unwrap_err().status as u32, 0x80000011);
    assert_eq!(s.close_state(), state);
    assert_eq!(s.frontier().unwrap(), frontier);
    s.release_capture().unwrap();
    let work = s.begin_commit(CommitScope::Published).unwrap();
    let state = s.close_state();
    assert_eq!(s.prepare_close().unwrap_err().status as u32, 0x80000011);
    assert_eq!(s.close_state(), state);
    let completion = work.run();
    assert_eq!(s.prepare_close().unwrap_err().status as u32, 0x80000011);
    s.complete_commit(completion).unwrap();
    let frontier = s.frontier().unwrap();
    s.prepare_close().unwrap();
    assert_eq!(s.close_state().prepared, 1);
    assert_eq!(
        s.frontier().unwrap(),
        frontier,
        "prepare only fences adapter admission, no detach/revoke/close yet"
    );
    assert_eq!(
        s.open("/alpha.txt", false).err().unwrap().status as u32,
        0x80000011
    );
    assert_eq!(
        s.create_file("/rejected.txt").err().unwrap().status as u32,
        0x80000011
    );
    assert_eq!(
        s.begin_commit(CommitScope::Published).err().unwrap().status as u32,
        0x80000011
    );
    assert_eq!(s.capture().unwrap_err().status as u32, 0x80000011);
    assert_eq!(s.prepare_close().unwrap_err().status as u32, 0x80000011);
    s.finish().unwrap();
    assert!(s.finish().is_err());
    let mut saved = layerfs_native_probe::saved::Saved::open(
        &root.join("store.sqlite"),
        layerfs_native_probe::store_fixture::BINDING,
        layerfs_native_probe::store_fixture::CURSOR,
        layerfs_native_probe::store_fixture::branch(),
    )
    .unwrap();
    assert_eq!(saved.read("new.txt", 0, 4).unwrap(), b"kept");
    assert!(saved.entry("rejected.txt").unwrap().is_none());
    println!("NORMAL_CLOSE_UNIT_PASS refusals_unchanged=true admission_fenced=true history_kept=true root={}",root.display());
}
