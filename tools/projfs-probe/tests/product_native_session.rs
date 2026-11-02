//! Direct product native Session ownership, independent of the ABI and OS host.
#![cfg(windows)]
use layerfs_daemon::native::{BindCause, BindPhase, Binding, CommitScope, Session};
use layerfs_history::{BranchId, CommitOutcome, WorkspaceId};
use layerfs_native_probe::store_fixture::{self, Fixture};
use std::path::{Path, PathBuf};
fn fresh(label: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tmp")
        .canonicalize()
        .unwrap()
        .join(format!(
            "product-native-session-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
}
fn binding(id: u8) -> Binding {
    Binding::new(
        store_fixture::BINDING.to_vec(),
        store_fixture::CURSOR,
        store_fixture::branch(),
        WorkspaceId::from_authority([id; 32]).unwrap(),
    )
    .unwrap()
}
fn start(label: &str) -> (PathBuf, Fixture, Session) {
    let root = fresh(label);
    let fixture = Fixture::create(&root).unwrap();
    let session = Session::bind_existing(&fixture.store, &root.join("work"), binding(95)).unwrap();
    (root, fixture, session)
}
fn overlays(root: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(root)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| {
            p.extension().is_some_and(|e| e == "sqlite")
                && p.file_name().unwrap() != "native-template.sqlite"
        })
        .collect()
}
fn finish(s: &mut Session) {
    s.prepare_close().unwrap();
    s.finish_after_native_drain().unwrap();
}
#[test]
fn product_status_commit_orphan_and_explicit_terminal_close() {
    let (root, _fixture, mut s) = start("ownership");
    let status = s.status().unwrap();
    assert_eq!(status.workspace, binding(95).workspace);
    assert_eq!(status.branch, store_fixture::branch());
    assert_eq!(status.root, s.mount().root_serial());
    assert!(!status.prepared);
    assert!(!status.retained);
    let frontier = s.frontier().unwrap();
    assert_eq!(
        s.begin_commit(CommitScope::ApplicationVisible)
            .err()
            .unwrap()
            .status as u32,
        0xc00000bb
    );
    assert_eq!(s.frontier().unwrap(), frontier);
    assert_eq!(
        s.finish_after_native_drain().unwrap_err().status as u32,
        0x80000011
    );
    let (file, _) = s.create_file("/product.txt").unwrap();
    s.write(file, 0, b"published", false, false).unwrap();
    let work = s.begin_commit(CommitScope::Published).unwrap();
    let before = s.close_state();
    assert_eq!(s.prepare_close().unwrap_err().status as u32, 0x80000011);
    assert_eq!(s.close_state(), before);
    let completion = work.run();
    // Publication is already fixed; a later active write is not included in it.
    s.write(file, 0, b"later", false, false).unwrap();
    let receipt = s.complete_commit(completion).unwrap();
    assert!(receipt.changed);
    assert!(matches!(
        receipt.success.history,
        Some(CommitOutcome::Committed { .. })
    ));
    assert_eq!(
        receipt.installed.effective_root.to_bytes(),
        receipt.frontier.base_root
    );
    assert_eq!(s.read(file, 0, 100).unwrap(), b"latershed");
    s.unlink("/product.txt").unwrap();
    assert_eq!(s.read(file, 0, 100).unwrap(), b"latershed");
    assert_eq!(s.prepare_close().unwrap_err().status as u32, 0x80000011);
    s.close_file(file).unwrap();
    let paths = overlays(&root.join("work"));
    assert_eq!(paths.len(), 1);
    s.prepare_close().unwrap();
    assert_eq!(s.close_state().prepared, 1);
    assert_eq!(
        s.open("/alpha.txt", false).err().unwrap().status as u32,
        0x80000011
    );
    s.finish_after_native_drain().unwrap();
    assert!(s.finish_after_native_drain().is_err());
    drop(s);
    assert!(
        !paths[0].exists(),
        "acknowledged close followed by last state release deletes its own Overlay"
    );
}
#[test]
fn product_request_admission_busy_has_no_effect_and_sessions_are_independent() {
    let (root, fixture, mut a) = start("requests");
    let mut b = Session::bind_existing(&fixture.store, &root.join("peer"), binding(96)).unwrap();
    let request = a.requests().receive().unwrap().request(0).unwrap();
    let before = a.frontier().unwrap();
    assert_eq!(a.prepare_close().unwrap_err().status as u32, 0x80000011);
    assert_eq!(a.frontier().unwrap(), before);
    assert_eq!(a.close_state().prepared, 0);
    let (file, _) = a.open("/alpha.txt", false).unwrap();
    assert_eq!(a.read(file, 0, 3).unwrap(), b"old");
    a.close_file(file).unwrap();
    request
        .serve_sync(|| layerfs_fuse::RequestDisposition::Complete)
        .unwrap();
    let lanes = a.requests();
    finish(&mut a);
    assert!(matches!(
        lanes.receive(),
        Err(layerfs_fuse::DispatchError::Stale)
    ));
    let (peer, _) = b.open("/alpha.txt", false).unwrap();
    assert_eq!(b.read(peer, 0, 3).unwrap(), b"old");
    b.close_file(peer).unwrap();
    let work = b.begin_commit(CommitScope::Published).unwrap();
    assert!(!b.complete_commit(work.run()).unwrap().changed);
    finish(&mut b);
}
#[test]
fn product_bind_failure_retains_exact_phase_and_never_defaults_authority() {
    let root = fresh("bind-failure");
    let fixture = Fixture::create(&root).unwrap();
    let failure = Session::bind_existing(&fixture.store, &root, binding(95))
        .err()
        .unwrap();
    assert_eq!(failure.phase, BindPhase::Directory);
    assert!(matches!(failure.cause, BindCause::Io(_)));
    assert!(!failure.service_retained());
    assert!(!failure.workspace_retained());
    let mut missing = binding(96);
    missing.branch = BranchId::from_authority([87; 16]);
    let failure = Session::bind_existing(&fixture.store, &root.join("missing"), missing)
        .err()
        .unwrap();
    assert_eq!(failure.phase, BindPhase::Branch);
    assert!(matches!(failure.cause, BindCause::MissingBranch));
    assert!(failure.service_retained());
    assert!(!failure.workspace_retained());
    let mut valid =
        Session::bind_existing(&fixture.store, &root.join("good"), binding(97)).unwrap();
    finish(&mut valid);
}
#[test]
fn revoked_mount_keeps_typed_failure_and_fences_release_replay() {
    let (_root, _fixture, mut s) = start("revoked");
    let op = s.operation().unwrap();
    op.overlay()
        .kernel_revoke(op.workspace().route(), s.mount())
        .unwrap();
    drop(op);
    let failure = s.open("/alpha.txt", false).err().unwrap();
    assert_eq!(failure.status as u32, 0xc0000001);
    assert!(std::error::Error::source(&failure).is_some());
    assert_eq!(s.close_state().retained, 1);
    assert_eq!(
        s.create_file("/must-not-publish").err().unwrap().status as u32,
        0xc0000001
    );
    assert!(s.prepare_close().is_err());
    assert!(s.finish_after_native_drain().is_err());
    assert_eq!(s.close_state().prepared, 0);
}
#[test]
fn abandoned_live_product_owner_does_not_dispose_its_overlay() {
    let (root, _fixture, s) = start("abandon");
    let paths = overlays(&root.join("work"));
    assert_eq!(paths.len(), 1);
    drop(s);
    assert!(
        paths[0].exists(),
        "drop is not permission to revoke a live kernel owner"
    );
}

#[test]
fn product_reference_observation_is_readonly_and_keeps_original_cleanup_custody() {
    let (_root, _fixture, mut s) = start("reference");
    assert!(s.reference(0, 0).unwrap().is_none());
    assert!(s.reference(u64::MAX, 0).unwrap().is_none());
    let (file, stat) = s.open("/alpha.txt", false).unwrap();
    let (directory, _) = s.open("/many", false).unwrap();
    let before = s.close_state();
    let frontier = s.frontier().unwrap();
    let row = s.reference(0, 0).unwrap().unwrap();
    assert_eq!((row.handle, row.serial), (file, stat.serial));
    assert!(row.file && !row.directory && row.lookup && !row.cleaned);
    assert!(!row.data_writable && !row.attributes_writable && !row.delete_access);
    assert_eq!(row.path_length, Some(10));
    assert_eq!(row.path, b"/alpha.txt");
    assert_eq!(row.next_offset, None);
    let tail = s.reference(0, 10).unwrap().unwrap();
    assert!(tail.path.is_empty());
    assert_eq!(tail.path_length, Some(10));
    assert_eq!(s.reference(0, 11).unwrap_err().status as u32, 0xc000000d);
    let row = s.reference(file, 0).unwrap().unwrap();
    assert!(row.directory && !row.file);
    assert_eq!(row.handle, directory);
    assert!(s.reference(directory, 0).unwrap().is_none());
    assert_eq!(s.close_state(), before);
    assert_eq!(s.frontier().unwrap(), frontier);
    let (writable, _) = s.open_windows("/alpha.txt", 7).unwrap();
    assert_eq!(
        writable,
        directory + 1,
        "observation allocates no handle identity"
    );
    let row = s.reference(directory, 0).unwrap().unwrap();
    assert!(row.data_writable && row.attributes_writable && row.delete_access);
    s.close_file(writable).unwrap();
    s.cleanup_file(file).unwrap();
    assert!(s.reference(0, 0).unwrap().unwrap().cleaned);
    assert_eq!(s.prepare_close().unwrap_err().status as u32, 0x80000011);
    s.close_file(file).unwrap();
    assert_eq!(s.reference(0, 0).unwrap().unwrap().handle, directory);
    s.close_file(directory).unwrap();
    assert!(s.reference(0, 0).unwrap().is_none());
    finish(&mut s);
}
#[test]
fn product_reference_observation_tracks_hints_without_pinning_namespace_or_owner() {
    let (_root, _fixture, mut s) = start("reference-hints");
    let (file, stat) = s.open("/alpha.txt", false).unwrap();
    s.cleanup_file(file).unwrap();
    let old = s.reference(0, 0).unwrap().unwrap();
    s.rename("/alpha.txt", "/moved.txt", false).unwrap();
    let moved = s.reference(0, 0).unwrap().unwrap();
    assert_eq!((moved.handle, moved.serial), (file, stat.serial));
    assert_eq!(moved.path, b"/moved.txt");
    assert_eq!(
        old.path, b"/alpha.txt",
        "previous observation is copied data"
    );
    s.unlink("/moved.txt").unwrap();
    let unlinked = s.reference(0, 0).unwrap().unwrap();
    assert_eq!((unlinked.handle, unlinked.serial), (file, stat.serial));
    assert!(unlinked.cleaned && unlinked.lookup && unlinked.file);
    assert_eq!(unlinked.path_length, None);
    assert!(unlinked.path.is_empty());
    assert_eq!(unlinked.next_offset, None);
    assert_eq!(s.reference(0, 1).unwrap_err().status as u32, 0xc000000d);
    assert_eq!(s.read(file, 0, 3).unwrap(), b"old");
    assert_eq!(s.prepare_close().unwrap_err().status as u32, 0x80000011);
    s.close_file(file).unwrap();
    assert!(s.reference(0, 0).unwrap().is_none());
    finish(&mut s);
}
