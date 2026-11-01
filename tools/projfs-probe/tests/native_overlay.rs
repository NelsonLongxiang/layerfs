// Real Store + Overlay integration test, no WinFsp kernel needed for this layer.
#[cfg(windows)]
#[test]
fn public_overlay_bridge_preserves_capture_and_open_custody() {
    use layerfs_native_probe::native_overlay::Session;
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
    assert_eq!(s.commit().unwrap_err().status as u32, 0xc00000aa);
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
    s.finish().unwrap();
    println!("OVERLAY_UNIT_PASS retained_root={}", root.display());
}

#[cfg(windows)]
#[test]
fn captured_commit_installs_and_keeps_open_descriptor_usable() {
    use layerfs_native_probe::native_overlay::Session;
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
    assert!(s.commit().unwrap());
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
    assert!(s.commit().unwrap());
    assert_eq!(
        s.committed_bytes(1, "/capture.txt").unwrap(),
        b"committed two"
    );
    assert!(!s.commit().unwrap(), "unchanged frontier creates no Commit");
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
    use layerfs_native_probe::native_overlay::Session;
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
    assert!(s.commit().unwrap());
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
    assert!(!rebound.commit().unwrap());
    rebound.finish().unwrap();
    println!("NESTED_REBIND_UNIT_PASS root={}", root.display());
}

#[cfg(windows)]
#[test]
fn published_observer_and_constrained_stores_preserve_capture_and_eof() {
    use layerfs_native_probe::native_overlay::Session;
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
    assert!(s.commit().unwrap());
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
