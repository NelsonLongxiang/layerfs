//! Native metadata uses public Workspace/Overlay ports; no WinFsp kernel in these cases.
#![cfg(windows)]
use layerfs_native_probe::native_overlay::{CommitScope, Session};
use std::path::{Path, PathBuf};
fn root(label: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tmp")
        .canonicalize()
        .unwrap()
        .join(format!(
            "native-metadata-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
}
#[test]
fn persisted_flags_capture_rights_unlink_and_rebind() {
    let root = root("roundtrip");
    let mut s = Session::create(&root).unwrap();
    let before_create = s.frontier().unwrap();
    assert_eq!(
        s.create_windows("/invalid", false, 0x800, true, true)
            .err()
            .unwrap()
            .status as u32,
        0xc00000bb
    );
    assert_eq!(s.frontier().unwrap(), before_create);
    let (dir, initial) = s
        .create_windows("/.hidden", true, 0x12, false, true)
        .unwrap();
    assert_eq!(initial.attributes, 2);
    s.close_file(dir).unwrap();
    let (file, _) = s.create_file("/.hidden/file").unwrap();
    s.write(file, 0, b"kept", false, false).unwrap();
    let timestamp = 116444736000000000u64 + 1700000000u64 * 10000000 + 1234567;
    let changed = s
        .basic_info(file, 0x26, [0, timestamp, timestamp, 0])
        .unwrap();
    assert_eq!((changed.mtime, changed.nanos), (1700000000, 123456700));
    assert_eq!(s.stat_handle(file).unwrap().attributes, 0x26);
    let before = s.frontier().unwrap();
    assert_eq!(
        s.basic_info(file, 0x800, [0, 0, 0, 0])
            .err()
            .unwrap()
            .status as u32,
        0xc00000bb
    );
    assert_eq!(s.frontier().unwrap(), before);
    assert_eq!(
        s.basic_info(file, 0, [1, 0, 0, 0]).err().unwrap().status as u32,
        0xc00000bb
    );
    assert_eq!(s.frontier().unwrap(), before);
    let work = s.begin_commit(CommitScope::Published).unwrap();
    let done = work.run();
    s.basic_info(file, 0x04, [0, 0, 0, 0]).unwrap();
    s.complete_commit(done).unwrap();
    assert_eq!(s.stat_handle(file).unwrap().attributes, 4);
    s.close_file(file).unwrap();
    let mut first = Session::reopen(&root.join("store.sqlite"), &root.join("first")).unwrap();
    assert_eq!(first.stat_path("/.hidden").unwrap().attributes, 2);
    assert_eq!(first.stat_path("/.hidden/file").unwrap().attributes, 0x26);
    first.finish().unwrap();
    let (ro, _) = s.open_access("/.hidden/file", false, false).unwrap();
    let before = s.frontier().unwrap();
    assert_eq!(
        s.basic_info(ro, 0, [0, 0, 0, 0]).err().unwrap().status as u32,
        0xc0000022
    );
    assert_eq!(s.frontier().unwrap(), before);
    s.close_file(ro).unwrap();
    let (meta, _) = s.open_access("/.hidden/file", false, true).unwrap();
    assert_eq!(
        s.write(meta, 0, b"no", false, false).err().unwrap().status as u32,
        0xc0000022
    );
    s.basic_info(meta, 1, [0, 0, 0, 0]).unwrap();
    s.close_file(meta).unwrap();
    let (meta, _) = s.open_access("/.hidden/file", false, true).unwrap();
    s.basic_info(meta, 0, [0, 0, 0, 0]).unwrap();
    assert_eq!(s.stat_handle(meta).unwrap().attributes, 0);
    s.close_file(meta).unwrap();
    assert!(s.commit(CommitScope::Published).unwrap());
    let (over, _) = s
        .create_windows("/overwrite", false, 0x22, true, true)
        .unwrap();
    s.write(over, 0, b"discard", false, false).unwrap();
    let before = s.frontier().unwrap();
    assert_eq!(
        s.overwrite_windows(over, 0x800, true).err().unwrap().status as u32,
        0xc00000bb
    );
    assert_eq!(s.frontier().unwrap(), before);
    assert_eq!(s.read(over, 0, 10).unwrap(), b"discard");
    let merged = s.overwrite_windows(over, 4, false).unwrap();
    assert_eq!((merged.attributes, merged.size), (0x26, 0));
    s.write(over, 0, b"discard", false, false).unwrap();
    let replaced = s.overwrite_windows(over, 0x20, true).unwrap();
    assert_eq!((replaced.attributes, replaced.size), (0x20, 0));
    s.close_file(over).unwrap();
    let (orphan, _) = s.create_file("/orphan").unwrap();
    s.basic_info(orphan, 2, [0, 0, 0, 0]).unwrap();
    s.unlink("/orphan").unwrap();
    assert_eq!(s.stat_handle(orphan).unwrap().attributes, 2);
    s.basic_info(orphan, 4, [0, 0, 0, 0]).unwrap();
    assert_eq!(s.stat_handle(orphan).unwrap().attributes, 4);
    s.close_file(orphan).unwrap();
    s.finish().unwrap();
    let mut reopened = Session::reopen(&root.join("store.sqlite"), &root.join("second")).unwrap();
    assert_eq!(reopened.stat_path("/.hidden").unwrap().attributes, 2);
    assert_eq!(reopened.stat_path("/.hidden/file").unwrap().attributes, 0);
    let (f, _) = reopened.open("/.hidden/file", false).unwrap();
    assert_eq!(reopened.read(f, 0, 4).unwrap(), b"kept");
    reopened.close_file(f).unwrap();
    reopened.finish().unwrap();
    println!("METADATA_ROUNDTRIP_PASS captured_flags=true removal=true orphan=true rights=true readonly_reopen=true");
}
#[test]
fn dot_parent_tracks_directory_move_and_empty_listing() {
    let root = root("dot");
    let mut s = Session::create(&root).unwrap();
    let (p, ps) = s.create_directory("/parent").unwrap();
    let (c, cs) = s.create_directory("/child").unwrap();
    assert!(s.list_next(c, None).unwrap().is_none());
    assert_eq!(
        s.directory_dot(c, false).unwrap().unwrap().serial,
        cs.serial
    );
    s.rename("/child", "/parent/child", false).unwrap();
    assert_eq!(s.directory_dot(c, true).unwrap().unwrap().serial, ps.serial);
    s.close_file(c).unwrap();
    s.close_file(p).unwrap();
    s.finish().unwrap();
}
