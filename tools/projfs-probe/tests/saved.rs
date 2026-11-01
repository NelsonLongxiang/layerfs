#![cfg(windows)]
use layerfs_native_probe::{
    saved::{validate_name, Saved},
    store_fixture::{branch, pattern, Fixture, BINDING, CURSOR, DEFERRED, LARGE},
};
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

fn fresh() -> PathBuf {
    let parent = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tmp/projfs-store-tests");
    fs::create_dir_all(&parent).unwrap();
    // Win32 verbatim ACL paths must not contain unresolved dot segments.
    parent.canonicalize().unwrap().join(format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

#[test]
fn unsupported_names_refuse_instead_of_aliasing() {
    for name in [
        "", ".", "..", "a/b", "a\\b", "a:stream", "NUL", "COM1.txt", "a.", "a ", "wild*", "x\0y",
    ] {
        assert!(validate_name(name).is_err(), "{name:?}");
    }
    for name in ["alpha.txt", "中文.txt", "LPT0", "nul-like", ".git"] {
        validate_name(name).unwrap();
    }
}

#[test]
fn real_store_is_pinned_paged_and_read_only_at_the_storage_port() {
    let root = fresh();
    let fixture = Fixture::create(&root).unwrap();
    println!("retained fixture: {}", root.display());
    assert!(
        !fixture.source.exists(),
        "original source path must not be used"
    );
    assert!(
        Fixture::create(&root).is_err(),
        "must not reuse an existing root"
    );
    assert!(Saved::open(&fixture.store, b"wrong-authority", CURSOR, branch()).is_err());
    let mut saved = Saved::open(&fixture.store, BINDING, CURSOR, branch()).unwrap();
    let pinned = saved.root;
    assert_eq!(
        (
            saved.directory_reads,
            saved.range_reads,
            saved.emitted_bytes
        ),
        (0, 0, 0)
    );
    assert_eq!(
        saved.diagnostics().payload_reads,
        0,
        "pin opens metadata, not payload"
    );
    let root_names = saved
        .list("")
        .unwrap()
        .into_iter()
        .map(|e| e.name)
        .collect::<Vec<_>>();
    assert_eq!(
        root_names,
        [
            "alpha.txt",
            "empty.txt",
            "many",
            "nested",
            "never.bin",
            "中文.txt"
        ]
    );
    assert_eq!(
        saved.list("many").unwrap().len(),
        80,
        "must cross a 64-entry metadata page"
    );
    assert_eq!(
        saved.entry("never.bin").unwrap().unwrap().size,
        DEFERRED as u64
    );
    assert_eq!(saved.range_reads, 0, "list/stat never ask for file ranges");
    assert!(saved.entry("missing.txt").unwrap().is_none());
    for path in [
        "../alpha.txt",
        "/alpha.txt",
        "nested//data.bin",
        "nested/../alpha.txt",
        "alpha.txt:stream",
    ] {
        assert!(saved.entry(path).is_err(), "{path}");
    }
    assert!(saved.read("nested", 0, 1).is_err());
    assert!(saved.read("nested/data.bin", LARGE as u64, 1).is_err());
    assert!(saved.read("nested/data.bin", 0, 1024 * 1024 + 1).is_err());
    assert_eq!(
        saved.range_reads, 0,
        "refused ranges are not reported successful"
    );
    for (offset, length) in [(4093, 23), (2 * 1024 * 1024 + 37, 4097), (LARGE - 31, 31)] {
        assert_eq!(
            saved
                .read("nested/data.bin", offset as u64, length as u32)
                .unwrap(),
            (offset..offset + length).map(pattern).collect::<Vec<_>>()
        );
    }
    assert!(saved.read("empty.txt", 0, 0).unwrap().is_empty());
    fixture.advance_branch().unwrap();
    assert_ne!(saved.current_root(branch()).unwrap(), pinned);
    assert_eq!(saved.root, pinned);
    assert_eq!(
        saved.read("alpha.txt", 0, 28).unwrap(),
        b"old immutable Store version\n"
    );
    let mut current = fixture.saved().unwrap();
    assert_ne!(current.root, pinned);
    let size = current.entry("alpha.txt").unwrap().unwrap().size;
    assert_eq!(
        current.read("alpha.txt", 0, size as u32).unwrap(),
        b"new branch head after projection was pinned\n"
    );
    assert!(!saved.files_read.contains("never.bin"));
    assert_eq!(
        saved.diagnostics().pack_write_bytes,
        0,
        "projection reader must not publish"
    );
}
