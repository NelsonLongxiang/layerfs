// Explicit native authority and concurrent local ownership through public ports.
#![cfg(windows)]
use layerfs_history::{
    BranchId, CommitHistoryRequest, HistoryCatalog, HistoryCatalogConfig, WorkspaceId,
};
use layerfs_native_probe::{
    native_binding::Binding,
    native_overlay::{CommitScope, Session},
    saved::Saved,
    store_fixture::Fixture,
};
use layerfs_persistence::{Handles, PersistenceConfig, SqlitePersistenceProfile};
use std::path::{Path, PathBuf};
fn fresh(label: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tmp")
        .canonicalize()
        .unwrap()
        .join(format!(
            "native-binding-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
}
fn config() -> HistoryCatalogConfig {
    HistoryCatalogConfig {
        binding_key: b"explicit-native-binding-test-v1".to_vec(),
        cursor_key: [91; 32],
        incarnation: 7,
    }
}
fn bind(c: &HistoryCatalogConfig, b: BranchId, w: u8) -> Binding {
    Binding::new(
        c.binding_key.clone(),
        c.cursor_key,
        b,
        WorkspaceId::from_authority([w; 32]).unwrap(),
    )
    .unwrap()
}
fn overlays(path: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(path)
        .unwrap()
        .map(|x| x.unwrap().path())
        .filter(|p| {
            p.extension().is_some_and(|s| s == "sqlite")
                && p.file_name().unwrap() != "native-template.sqlite"
        })
        .collect()
}

#[test]
fn binding_frame_refuses_malformed_or_implicit_authority() {
    let c = config();
    let b = BranchId::from_authority([41; 16]);
    let mut frame = b"LFSBND01".to_vec();
    frame.extend((c.binding_key.len() as u16).to_le_bytes());
    frame.extend(&c.binding_key);
    frame.extend(c.cursor_key);
    frame.extend(b.to_bytes());
    frame.extend([77; 32]);
    let parsed = Binding::read_from(frame.as_slice()).unwrap();
    assert_eq!(parsed.branch, b);
    assert_eq!(
        parsed.workspace,
        WorkspaceId::from_authority([77; 32]).unwrap()
    );
    for bad in [
        Vec::new(),
        frame[..frame.len() - 1].to_vec(),
        [frame.clone(), vec![1]].concat(),
        vec![0; 220],
    ] {
        assert_eq!(
            Binding::read_from(bad.as_slice()).err().unwrap().status as u32,
            0xc000000d
        );
    }
    let n = c.binding_key.len();
    let mut zero_cursor = frame.clone();
    zero_cursor[10 + n..42 + n].fill(0);
    assert!(Binding::read_from(zero_cursor.as_slice()).is_err());
    let mut zero_workspace = frame.clone();
    zero_workspace[59 + n..].fill(0);
    assert!(Binding::read_from(zero_workspace.as_slice()).is_err());
    let mut bad_tag = frame.clone();
    bad_tag[42 + n] = 0;
    assert!(Binding::read_from(bad_tag.as_slice()).is_err());
    assert!(Binding::new(vec![], c.cursor_key, b, parsed.workspace).is_err());
    assert!(Binding::new(vec![1; 129], c.cursor_key, b, parsed.workspace).is_err());
    println!("BINDING_FRAME_UNIT_PASS explicit_only=true malformed_refused=true");
}

#[test]
fn explicit_same_store_bindings_keep_views_close_and_publication_separate() {
    let root = fresh("dual");
    let c = config();
    let branch = BranchId::from_authority([41; 16]);
    let fixture = Fixture::create_with(&root, &c, branch).unwrap();
    let pa = root.join("a");
    let pb = root.join("b");
    let mut a = Session::bind_existing(&fixture.store, &pa, bind(&c, branch, 77)).unwrap();
    let mut b = Session::bind_existing(&fixture.store, &pb, bind(&c, branch, 78)).unwrap();
    assert_eq!(
        a.frontier().unwrap().base_root,
        b.frontier().unwrap().base_root
    );
    let ao = overlays(&pa);
    let bo = overlays(&pb);
    assert_eq!(ao.len(), 1);
    assert_eq!(bo.len(), 1);
    assert_ne!(ao, bo);
    let (ha, _) = a.create_file("/a.txt").unwrap();
    a.write(ha, 0, b"alpha", false, false).unwrap();
    let (hb, _) = b.create_file("/b.txt").unwrap();
    b.write(hb, 0, b"bravo", false, false).unwrap();
    assert_eq!(
        b.stat_path("/a.txt").err().unwrap().status as u32,
        0xc0000034
    );
    assert_eq!(
        a.stat_path("/b.txt").err().unwrap().status as u32,
        0xc0000034
    );
    let work = a.begin_commit(CommitScope::Published).unwrap();
    let first = work.run();
    assert_eq!(
        b.stat_path("/a.txt").err().unwrap().status as u32,
        0xc0000034,
        "other install must not replace this local base"
    );
    assert!(b.commit(CommitScope::Published).unwrap()); // Clean merge through the unchanged driver.
                                                        // B advanced global head before A settles its already-known outcome. Do not
                                                        // reclassify A as failure by comparing its result to the now-later head.
    assert!(a.complete_commit(first).unwrap());
    assert_eq!(a.committed_bytes(0, "/a.txt").unwrap(), b"alpha");
    assert!(a.committed_bytes(0, "/b.txt").is_err());
    assert_eq!(b.committed_bytes(0, "/a.txt").unwrap(), b"alpha");
    assert_eq!(b.committed_bytes(0, "/b.txt").unwrap(), b"bravo");
    assert!(a.stat_path("/b.txt").is_err());
    assert_eq!(a.read(ha, 0, 10).unwrap(), b"alpha");
    assert_eq!(a.prepare_close().unwrap_err().status as u32, 0x80000011);
    a.close_file(ha).unwrap();
    a.prepare_close().unwrap();
    a.finish().unwrap();
    drop(a);
    assert!(!ao[0].exists());
    assert!(bo[0].exists());
    assert_eq!(b.read(hb, 0, 10).unwrap(), b"bravo");
    b.write(hb, 0, b"after", false, false).unwrap();
    assert!(b.commit(CommitScope::Published).unwrap());
    assert_eq!(b.committed_bytes(0, "/b.txt").unwrap(), b"bravo");
    b.close_file(hb).unwrap();
    b.finish().unwrap();
    drop(b);
    assert!(!bo[0].exists());
    let h = Handles::open_read_only(
        PersistenceConfig::sqlite(&fixture.store)
            .with_sqlite_profile(SqlitePersistenceProfile::Disposable),
        &c.binding_key,
        c.cursor_key,
    )
    .unwrap();
    let history = h
        .history
        .commit_history(&CommitHistoryRequest {
            branch,
            start: None,
            cursor: None,
            limit: 10,
        })
        .unwrap();
    assert_eq!(history.records.len(), 3);
    assert!(history.continuation.is_none());
    assert_eq!(history.records[0].parent, Some(history.records[1].id));
    assert_eq!(history.records[1].parent, Some(history.records[2].id));
    assert!(history.records[2].parent.is_none());
    drop(h);
    let mut saved = Saved::open(&fixture.store, &c.binding_key, c.cursor_key, branch).unwrap();
    assert_eq!(saved.read("a.txt", 0, 5).unwrap(), b"alpha");
    assert_eq!(saved.read("b.txt", 0, 5).unwrap(), b"after");
    println!("EXPLICIT_DUAL_UNIT_PASS same_store=true independent_overlay=true late_settle=true close_isolated=true commits=3 root={}",root.display());
}

#[test]
fn missing_and_main_branch_are_refused_without_default_fallback() {
    let root = fresh("refusals");
    let c = config();
    let branch = BranchId::from_authority([41; 16]);
    let fixture = Fixture::create_with(&root, &c, branch).unwrap();
    assert!(Session::bind_existing(
        &fixture.store,
        &root.join("missing"),
        bind(&c, BranchId::from_authority([99; 16]), 77)
    )
    .is_err());
    let h = Handles::open_writable(
        PersistenceConfig::sqlite(&fixture.store)
            .with_sqlite_profile(SqlitePersistenceProfile::Disposable),
        &c.binding_key,
        c.cursor_key,
    )
    .unwrap();
    let snap = h.history.branch_snapshot(branch).unwrap().unwrap();
    h.history
        .fork(&layerfs_history::ForkRequest {
            stack: snap.branch.stack,
            branch: BranchId::from_authority([42; 16]),
            name: layerfs_history::HistoryName::new("main").unwrap(),
            source: layerfs_history::ForkSource::Layer(snap.branch.base_layer),
        })
        .unwrap();
    let main = h
        .history
        .branch_named(
            snap.branch.stack,
            &layerfs_history::HistoryName::new("main").unwrap(),
        )
        .unwrap()
        .unwrap();
    drop(h);
    assert_eq!(
        Session::bind_existing(&fixture.store, &root.join("main"), bind(&c, main.id, 78))
            .err()
            .unwrap()
            .status as u32,
        0xc0000022
    );
    let wrong = Binding::new(
        b"wrong-catalog".to_vec(),
        c.cursor_key,
        branch,
        WorkspaceId::from_authority([79; 32]).unwrap(),
    )
    .unwrap();
    assert!(Session::bind_existing(&fixture.store, &root.join("wrong"), wrong).is_err());
    let mut good =
        Session::bind_existing(&fixture.store, &root.join("good"), bind(&c, branch, 80)).unwrap();
    assert!(!good.commit(CommitScope::Published).unwrap());
    good.finish().unwrap();
    println!("BINDING_REFUSAL_UNIT_PASS missing=true main=true wrong_catalog=true no_default=true");
}
