//! Real owner-private records shared by SDK discovery and native startup.
#![cfg(windows)]
use layerfs_bridge::{
    control::{Answer, Reply, SdkValue},
    provision::{ProviderKind, StoreManifest, StoreProfile},
};
use layerfs_store_service::{
    windows_acl::restrict_to_owner,
    windows_project::{read, ReadError},
};
use std::path::{Path, PathBuf};
fn home(label: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "layerfs-project-record-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(root.join("example")).unwrap();
    restrict_to_owner(&root).unwrap();
    restrict_to_owner(&root.join("example")).unwrap();
    root
}
fn manifest() -> StoreManifest {
    StoreManifest {
        provider: ProviderKind::Sqlite,
        locator: "/layerfs-store/global/store.sqlite".into(),
        profile: StoreProfile::Disposable,
        binding: b"registered-project-test-v1".to_vec(),
        cursor_key: [7; 32],
        stack: [9; 17],
        branch: [11; 17],
        root: [3; 32],
        bytes: 4096,
        host_sqlite: "3.46.0".into(),
        daemon_sqlite: None,
    }
}
fn save(root: &Path, id: u64, original: &StoreManifest, installed: Option<&StoreManifest>) {
    let value = SdkValue::map([
        ("manifest", SdkValue::Bytes(original.encode().unwrap())),
        (
            "installed",
            installed
                .map(|m| SdkValue::Bytes(m.encode().unwrap()))
                .unwrap_or(SdkValue::Null),
        ),
    ]);
    let path = root.join("example/project.record");
    std::fs::write(
        &path,
        Answer {
            id,
            reply: Reply::Sdk(value),
        }
        .encode()
        .unwrap(),
    )
    .unwrap();
    restrict_to_owner(&path).unwrap();
}
#[test]
fn completed_install_and_uninstalled_init_record_keep_exact_authority() {
    let root = home("complete");
    let m = manifest();
    save(&root, 1, &m, None);
    let r = read(&root, "example").unwrap();
    assert_eq!(r.manifest, m);
    assert!(r.installed.is_none());
    let mut installed = m.clone();
    installed.daemon_sqlite = Some("3.46.1".into());
    save(&root, 1, &m, Some(&installed));
    let r = read(&root, "example").unwrap();
    assert_eq!(r.manifest, m);
    assert_eq!(r.installed, Some(installed));
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn installed_authority_or_identity_cannot_be_substituted() {
    let root = home("mismatch");
    let m = manifest();
    let mut installed = m.clone();
    installed.daemon_sqlite = Some("3.46.1".into());
    installed.cursor_key = [8; 32];
    save(&root, 1, &m, Some(&installed));
    assert!(matches!(
        read(&root, "example"),
        Err(ReadError::Invalid(
            "installed authority differs from sealed project"
        ))
    ));
    installed = m.clone();
    installed.daemon_sqlite = Some("3.46.1".into());
    installed.root = [6; 32];
    save(&root, 1, &m, Some(&installed));
    assert!(matches!(read(&root, "example"), Err(ReadError::Invalid(_))));
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn record_id_and_trailing_bytes_are_not_ignored() {
    let root = home("framing");
    let m = manifest();
    save(&root, 2, &m, None);
    assert!(matches!(
        read(&root, "example"),
        Err(ReadError::Invalid("record identity"))
    ));
    save(&root, 1, &m, None);
    let path = root.join("example/project.record");
    let mut bytes = std::fs::read(&path).unwrap();
    bytes.push(0);
    std::fs::write(&path, bytes).unwrap();
    assert!(matches!(read(&root, "example"), Err(ReadError::Codec(_))));
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn shared_record_is_refused_before_decoding() {
    let root = home("privacy");
    let m = manifest();
    save(&root, 1, &m, None);
    let path = root.join("example/project.record");
    let granted = std::process::Command::new("icacls")
        .arg(&path)
        .args(["/grant", "*S-1-1-0:(R)"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap();
    assert!(granted.success());
    assert!(matches!(
        read(&root, "example"),
        Err(ReadError::Unauthorized)
    ));
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn directory_instead_of_record_and_path_escape_are_refused() {
    let root = home("kind");
    std::fs::create_dir(root.join("example/project.record")).unwrap();
    assert!(matches!(
        read(&root, "example"),
        Err(ReadError::Unauthorized)
    ));
    for name in ["../example", "example/child", "example:stream", "."] {
        assert!(matches!(read(&root, name), Err(ReadError::Invalid(_))));
    }
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn oversized_record_window_refuses_before_codec() {
    let root = home("window");
    let path = root.join("example/project.record");
    std::fs::write(&path, vec![0u8; 65536]).unwrap();
    restrict_to_owner(&path).unwrap();
    assert!(matches!(
        read(&root, "example"),
        Err(ReadError::Invalid("record processing window"))
    ));
    std::fs::remove_dir_all(root).unwrap();
}
