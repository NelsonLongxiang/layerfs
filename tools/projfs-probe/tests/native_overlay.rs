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
