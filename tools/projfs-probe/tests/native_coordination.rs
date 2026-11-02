//! Admission and namespace identity controls; not a WinFsp section inventory.
#![cfg(windows)]
use layerfs_native_probe::native_overlay::{CommitScope, Session};
use std::path::PathBuf;
fn root(label: &str) -> PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tmp")
        .canonicalize()
        .unwrap()
        .join(format!(
            "native-coordinate-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
}
fn busy<T>(r: layerfs_native_probe::native_overlay::Result<T>) {
    assert_eq!(r.err().expect("must refuse").status as u32, 0x80000011);
}
#[test]
fn coordination_is_reversible_and_original_close_is_required() {
    let mut s = Session::create(&root("admission")).unwrap();
    let (held, stat) = s.open("/alpha.txt", false).unwrap();
    let before = s.frontier().unwrap();
    busy(s.begin_close_coordination());
    assert_eq!(s.frontier().unwrap(), before);
    s.cleanup_file(held).unwrap();
    let token = s.begin_close_coordination().unwrap();
    assert_eq!(
        s.next_close_candidate(token, 0).unwrap(),
        Some((held, stat.serial, "/alpha.txt".into()))
    );
    busy(s.begin_close_coordination());
    busy(s.prepare_close());
    busy(s.rename("/alpha.txt", "/changed", false));
    busy(s.unlink("/alpha.txt"));
    busy(s.create_file("/bad"));
    busy(s.open_windows("/alpha.txt", 1));
    busy(s.open_windows("/alpha.txt", 4));
    busy(s.capture());
    busy(s.begin_commit(CommitScope::Published));
    let (new, _) = s.open("/alpha.txt", false).unwrap();
    assert!(new > token);
    s.close_file(new).unwrap();
    assert!(s.next_close_candidate(token, held).unwrap().is_none());
    assert!(s.end_close_coordination(token + 1, false).is_err());
    busy(s.end_close_coordination(token, true)); // This releases only the reversible admission.
    assert_eq!(
        s.read(held, 0, 100).unwrap(),
        b"old immutable Store version\n"
    );
    assert_eq!(s.frontier().unwrap(), before);
    let token = s.begin_close_coordination().unwrap();
    s.close_file(held).unwrap();
    assert!(s.next_close_candidate(token, 0).unwrap().is_none());
    s.end_close_coordination(token, true).unwrap();
    s.finish().unwrap();
}
#[test]
fn paths_track_directory_moves_and_replacement_never_selects_new_inode() {
    let mut s = Session::create(&root("names")).unwrap();
    let (dir, _) = s.create_directory("/from").unwrap();
    s.close_file(dir).unwrap();
    let (file, _) = s.create_file("/from/item").unwrap();
    s.write(file, 0, b"old", false, false).unwrap();
    s.close_file(file).unwrap();
    let (old, stat) = s.open("/from/item", false).unwrap();
    s.cleanup_file(old).unwrap();
    s.rename("/from", "/moved", false).unwrap();
    let token = s.begin_close_coordination().unwrap();
    assert_eq!(
        s.next_close_candidate(token, 0).unwrap(),
        Some((old, stat.serial, "/moved/item".into()))
    );
    s.end_close_coordination(token, false).unwrap();
    let (replacement, _) = s.create_file("/new").unwrap();
    s.write(replacement, 0, b"new", false, false).unwrap();
    s.close_file(replacement).unwrap();
    s.rename("/new", "/moved/item", true).unwrap();
    assert_ne!(s.stat_path("/moved/item").unwrap().serial, stat.serial);
    busy(s.begin_close_coordination());
    assert_eq!(s.read(old, 0, 3).unwrap(), b"old");
    s.close_file(old).unwrap();
    let (old, _) = s.open("/moved/item", false).unwrap();
    s.cleanup_file(old).unwrap();
    s.unlink("/moved/item").unwrap();
    let (other, _) = s.create_file("/moved/item").unwrap();
    s.close_file(other).unwrap();
    busy(s.begin_close_coordination());
    s.close_file(old).unwrap();
    s.finish().unwrap();
}
#[test]
fn write_delete_directory_and_commit_custody_refuse_before_coordination() {
    let mut s = Session::create(&root("rights")).unwrap();
    for access in [1, 2, 4] {
        let (h, _) = s.open_windows("/alpha.txt", access).unwrap();
        s.cleanup_file(h).unwrap();
        busy(s.begin_close_coordination());
        s.close_file(h).unwrap();
    }
    let (h, _) = s.open("/many", false).unwrap();
    s.cleanup_file(h).unwrap();
    busy(s.begin_close_coordination());
    s.close_file(h).unwrap();
    s.capture().unwrap();
    busy(s.begin_close_coordination());
    s.release_capture().unwrap();
    let work = s.begin_commit(CommitScope::Published).unwrap();
    busy(s.begin_close_coordination());
    s.complete_commit(work.run()).unwrap();
    let token = s.begin_close_coordination().unwrap();
    assert!(s.next_close_candidate(token, 0).unwrap().is_none());
    s.end_close_coordination(token, true).unwrap();
    s.finish().unwrap();
}
