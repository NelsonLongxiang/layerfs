//! Windows flag persistence through real Overlay capture/orphan/install domains.
mod payload_support;
use layerfs_overlay::*;
use payload_support::{File, Temp};

#[test]
fn windows_flags_follow_capture_and_orphan_ownership() {
    let temp = Temp::new();
    let db = temp.db();
    db.open_workspace([76; 32]).unwrap();
    assert_eq!(db.profile().schema_version, 40);
    let source = db.acquire_base_source(1).unwrap();
    let f = File::new(&db, source, 7, Vec::new());
    let mut inode = f.inode(0);
    inode.windows_attributes = 0x22;
    let p = db
        .apply(
            source,
            &Changes {
                inodes: vec![inode.clone()],
                ..Changes::default()
            },
        )
        .unwrap();
    db.reply_attempted(p).unwrap();
    let open = db.open_file(source, 9, &inode, true).unwrap();
    db.release_base_source(source).unwrap();
    let captured = db.capture().unwrap();
    let reader = db.acquire_captured_reader(captured, 2).unwrap();
    let source = db.acquire_base_source(3).unwrap();
    inode.windows_attributes = 0x04;
    let p = db
        .apply(
            source,
            &Changes {
                inodes: vec![inode.clone()],
                ..Changes::default()
            },
        )
        .unwrap();
    db.reply_attempted(p).unwrap();
    assert_eq!(
        db.reader_inode(reader, 7)
            .unwrap()
            .unwrap()
            .windows_attributes,
        0x22
    );
    assert_eq!(
        db.source_inode(source, 7)
            .unwrap()
            .unwrap()
            .windows_attributes,
        0x04
    );
    let before = db.state().unwrap();
    let mut bad = inode.clone();
    bad.windows_attributes = 0x800;
    assert!(db
        .apply(
            source,
            &Changes {
                inodes: vec![bad],
                ..Changes::default()
            }
        )
        .is_err());
    assert_eq!(db.state().unwrap(), before);
    inode.nlink = 0;
    let p = db
        .apply(
            source,
            &Changes {
                detached: Some(7),
                inodes: vec![inode],
                ..Changes::default()
            },
        )
        .unwrap();
    db.reply_attempted(p).unwrap();
    assert_eq!(
        db.source_inode(source, 7)
            .unwrap()
            .unwrap()
            .windows_attributes,
        0x04,
        "orphan INSERT retains flags"
    );
    db.release_base_source(source).unwrap();
    db.install(captured, [77; 32]).unwrap();
    db.release_captured_reader(reader).unwrap();
    let source = db.acquire_base_source(4).unwrap();
    let mut orphan = db.source_inode(source, 7).unwrap().unwrap();
    orphan.windows_attributes = 0;
    let p = db
        .apply(
            source,
            &Changes {
                open: Some(open),
                inodes: vec![orphan],
                ..Changes::default()
            },
        )
        .unwrap();
    db.reply_attempted(p).unwrap();
    assert_eq!(
        db.source_inode(source, 7)
            .unwrap()
            .unwrap()
            .windows_attributes,
        0
    );
    db.close_file(open).unwrap();
    db.release_base_source(source).unwrap();
    db.close().unwrap();
    db.close_database().unwrap();
}
