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
    assert!(s.stat_path("/nested/data.bin").is_err());
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
