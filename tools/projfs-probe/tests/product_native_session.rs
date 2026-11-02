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

#[test]
fn product_coordination_preserves_busy_rights_and_original_name_identity() {
    let (_root, _fixture, mut s) = start("coordination-rights");
    for access in [1, 2, 4] {
        let (held, _) = s.open_windows("/alpha.txt", access).unwrap();
        s.cleanup_file(held).unwrap();
        let before = s.close_state();
        assert_eq!(
            s.begin_close_coordination().unwrap_err().status as u32,
            0x80000011
        );
        assert_eq!(s.close_state(), before);
        s.close_file(held).unwrap();
    }
    let (directory, _) = s.open("/many", false).unwrap();
    s.cleanup_file(directory).unwrap();
    assert_eq!(
        s.begin_close_coordination().unwrap_err().status as u32,
        0x80000011
    );
    s.close_file(directory).unwrap();
    let (held, _) = s.open("/alpha.txt", false).unwrap();
    assert_eq!(
        s.begin_close_coordination().unwrap_err().status as u32,
        0x80000011
    );
    s.cleanup_file(held).unwrap();
    let (other, _) = s.create_file("/replacement").unwrap();
    s.close_file(other).unwrap();
    s.rename("/replacement", "/alpha.txt", true).unwrap();
    assert_eq!(
        s.begin_close_coordination().unwrap_err().status as u32,
        0x80000011
    );
    assert_eq!(s.read(held, 0, 3).unwrap(), b"old");
    s.close_file(held).unwrap();
    finish(&mut s);
}
#[test]
fn product_coordination_is_reversible_and_close_remains_the_release_authority() {
    let (_root, _fixture, mut s) = start("coordination-close");
    let (held, stat) = s.open("/alpha.txt", false).unwrap();
    s.cleanup_file(held).unwrap();
    let frontier = s.frontier().unwrap();
    let token = s.begin_close_coordination().unwrap();
    assert!(s.status().unwrap().coordinating);
    assert_eq!(
        s.next_close_candidate(token, 0).unwrap(),
        Some((held, stat.serial, "/alpha.txt".into()))
    );
    assert_eq!(
        s.rename("/alpha.txt", "/changed", false)
            .unwrap_err()
            .status as u32,
        0x80000011
    );
    assert_eq!(
        s.begin_commit(CommitScope::Published).err().unwrap().status as u32,
        0x80000011
    );
    assert!(s.next_close_candidate(token + 1, 0).is_err());
    assert!(s.end_close_coordination(token + 1, false).is_err());
    assert_eq!(
        s.end_close_coordination(token, true).unwrap_err().status as u32,
        0x80000011
    );
    assert!(!s.status().unwrap().coordinating);
    assert_eq!(s.read(held, 0, 3).unwrap(), b"old");
    assert_eq!(s.frontier().unwrap(), frontier);
    let token = s.begin_close_coordination().unwrap();
    s.close_file(held).unwrap();
    assert!(s.next_close_candidate(token, 0).unwrap().is_none());
    s.end_close_coordination(token, true).unwrap();
    s.finish_after_native_drain().unwrap();
}

#[test]
fn product_commit_message_is_exact_bounded_and_does_not_create_uptodate_history() {
    let (_root, _fixture, mut s) = start("commit-message");
    let messages = [
        Some("Unicode 雪😀\n\t 1 unmount discard".to_string()),
        Some(String::new()),
        Some(format!("{}x", "界".repeat(1365))),
        None,
    ];
    for (index, message) in messages.into_iter().enumerate() {
        let (file, _) = s.create_file(&format!("/message-{index}")).unwrap();
        s.write(file, 0, b"original payload", false, false).unwrap();
        s.close_file(file).unwrap();
        let work = s
            .begin_commit_message(CommitScope::Published, message.clone())
            .unwrap();
        assert_eq!(s.close_state().pending_commit, 1);
        let receipt = s.complete_commit(work.run()).unwrap();
        let expected = message.as_deref().unwrap_or("Commit Workspace changes");
        match receipt.success.history.as_ref().unwrap() {
            CommitOutcome::Committed { record, .. } => {
                assert_eq!(record.meta.message.as_deref(), Some(expected))
            }
            other => panic!("expected publication, got {other:?}"),
        }
        assert!(receipt.changed);
        let head = receipt.installed.branch.head_commit;
        let work = s
            .begin_commit_message(
                CommitScope::Published,
                Some("metadata-only is not a Commit".into()),
            )
            .unwrap();
        let next = s.complete_commit(work.run()).unwrap();
        assert!(!next.changed);
        assert_eq!(next.installed.branch.head_commit, head);
        assert!(matches!(
            next.success.history,
            Some(CommitOutcome::UpToDate { .. })
        ));
    }
    let before = s.close_state();
    let frontier = s.frontier().unwrap();
    for invalid in [
        "x".repeat(4097),
        "bad\0message".into(),
        "bad\rmessage".into(),
        "\u{85}".into(),
    ] {
        let error = s
            .begin_commit_message(CommitScope::Published, Some(invalid))
            .err()
            .unwrap();
        assert_eq!(error.status as u32, 0xc000000d);
        assert_eq!(s.close_state(), before);
        assert_eq!(s.frontier().unwrap(), frontier);
    }
    let (file, _) = s.create_file("/legacy-default").unwrap();
    s.close_file(file).unwrap();
    let work = s.begin_commit(CommitScope::Published).unwrap();
    let receipt = s.complete_commit(work.run()).unwrap();
    match receipt.success.history.as_ref().unwrap() {
        CommitOutcome::Committed { record, .. } => assert_eq!(
            record.meta.message.as_deref(),
            Some("Windows published Workspace frontier")
        ),
        other => panic!("expected legacy publication, got {other:?}"),
    }
    finish(&mut s);
}
#[test]
fn native_failure_retains_original_commit_completion_and_message_without_release_or_replay() {
    use layerfs_store_service::store::CommitOptions;
    for force in [false, true] {
        let (_root, _fixture, mut s) = start(if force {
            "forced-message-retained"
        } else {
            "commit-message-retained"
        });
        let (file, _) = s.create_file("/uncertain").unwrap();
        s.close_file(file).unwrap();
        let work = s
            .begin_commit_with(
                CommitScope::Published,
                CommitOptions {
                    force,
                    message: Some("retain original metadata 雪".into()),
                },
            )
            .unwrap();
        let op = s.operation().unwrap();
        op.overlay()
            .kernel_revoke(op.workspace().route(), s.mount())
            .unwrap();
        drop(op);
        let failure = s.open("/alpha.txt", false).err().unwrap();
        assert_eq!(failure.status as u32, 0xc0000001);
        assert!(std::error::Error::source(&failure).is_some());
        let error = s.complete_commit(work.run()).err().unwrap();
        assert_eq!(error.status as u32, 0xc0000001);
        assert_eq!(s.close_state().retained, 1);
        assert_eq!(s.close_state().pending_commit, 1);
        for next_force in [false, true] {
            assert_eq!(
                s.begin_commit_with(
                    CommitScope::Published,
                    CommitOptions {
                        force: next_force,
                        message: Some("must not replay".into())
                    }
                )
                .err()
                .unwrap()
                .status as u32,
                0xc0000001
            );
        }
        assert!(s.prepare_close().is_err());
        assert!(s.finish_after_native_drain().is_err());
    }
}

#[test]
fn product_force_uses_original_publication_policy_and_preserves_admission() {
    use layerfs_store_service::store::CommitOptions;
    for force in [false, true] {
        let (root, fixture, mut a) = start(if force {
            "force-overwrite"
        } else {
            "force-merge"
        });
        let (held, _) = a.create_file("/seed-marker").unwrap();
        a.close_file(held).unwrap();
        let work = a.begin_commit(CommitScope::Published).unwrap();
        let seed = a
            .complete_commit(work.run())
            .unwrap()
            .installed
            .branch
            .head_commit;
        let mut b =
            Session::bind_existing(&fixture.store, &root.join("second"), binding(96)).unwrap();
        let (head, _) = a.create_file("/head-only").unwrap();
        a.write(head, 0, b"head", false, false).unwrap();
        a.close_file(head).unwrap();
        let work = a.begin_commit(CommitScope::Published).unwrap();
        let first = a.complete_commit(work.run()).unwrap();
        let (local, _) = b.create_file("/local-only").unwrap();
        b.write(local, 0, b"local", false, false).unwrap();
        b.close_file(local).unwrap();
        let options = CommitOptions {
            force,
            message: Some("original policy 雪".into()),
        };
        let before = b.close_state();
        assert_eq!(
            b.begin_commit_with(CommitScope::ApplicationVisible, options.clone())
                .err()
                .unwrap()
                .status as u32,
            0xc00000bb
        );
        assert_eq!(b.close_state(), before);
        let token = b.begin_close_coordination().unwrap();
        assert_eq!(
            b.begin_commit_with(CommitScope::Published, options.clone())
                .err()
                .unwrap()
                .status as u32,
            0x80000011
        );
        b.end_close_coordination(token, false).unwrap();
        let work = b
            .begin_commit_with(CommitScope::Published, options.clone())
            .unwrap();
        let admitted = b.close_state();
        assert_eq!(admitted.pending_commit, 1);
        assert_eq!(
            b.begin_commit_with(CommitScope::Published, options)
                .err()
                .unwrap()
                .status as u32,
            0x80000011
        );
        assert_eq!(b.close_state(), admitted);
        let receipt = b.complete_commit(work.run()).unwrap();
        match receipt.success.history.as_ref().unwrap() {
            CommitOutcome::Committed { record, displaced } => {
                assert_eq!(record.meta.message.as_deref(), Some("original policy 雪"));
                assert_eq!(
                    record.parent,
                    if force {
                        seed
                    } else {
                        first.installed.branch.head_commit
                    }
                );
                assert_eq!(
                    *displaced,
                    if force {
                        first.installed.branch.head_commit
                    } else {
                        None
                    }
                );
                assert_eq!(record.meta.displaced, *displaced);
            }
            other => panic!("expected original publication, got {other:?}"),
        }
        assert_eq!(receipt.success.merge.is_none(), force);
        if force {
            assert_eq!(
                b.stat_path("/head-only").err().unwrap().status as u32,
                0xc0000034
            );
        } else {
            assert_eq!(b.stat_path("/head-only").unwrap().size, 4);
        }
        let head = receipt.installed.branch.head_commit;
        let work = b
            .begin_commit_with(
                CommitScope::Published,
                CommitOptions {
                    force: true,
                    message: Some("no metadata-only force".into()),
                },
            )
            .unwrap();
        let unchanged = b.complete_commit(work.run()).unwrap();
        assert!(!unchanged.changed);
        assert_eq!(unchanged.installed.branch.head_commit, head);
        finish(&mut a);
        finish(&mut b);
    }
}
