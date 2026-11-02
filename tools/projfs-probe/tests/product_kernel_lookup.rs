//! Real StoreService kernel lookup ports, exercised independently of diagnostic Session.
#![cfg(windows)]
use layerfs_content::filesystem::PathName;
use layerfs_history::WorkspaceId;
use layerfs_native_probe::store_fixture::{self, Fixture};
use layerfs_store_service::{
    store::{BoundWorkspace, KernelLookupCause},
    StoreService,
};
use layerfs_telemetry::timer::Timing;
use layerfs_workspace::{KernelReadDecision, Refusal, WorkspaceError};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

fn fresh(label: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tmp")
        .canonicalize()
        .unwrap()
        .join(format!(
            "product-kernel-lookup-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
}
fn setup(label: &str) -> (PathBuf, StoreService, Arc<BoundWorkspace>) {
    let root = fresh(label);
    let fixture = Fixture::create(&root).unwrap();
    let service = StoreService::open_direct(
        &fixture.store,
        store_fixture::BINDING,
        store_fixture::CURSOR,
        &root.join("port-template.sqlite"),
    )
    .unwrap();
    let bound = bind(&service, 91);
    (root, service, bound)
}
fn bind(service: &StoreService, id: u8) -> Arc<BoundWorkspace> {
    Timing::disabled("test.kernel.bind", |t| {
        service.bind(
            WorkspaceId::from_authority([id; 32]).unwrap(),
            store_fixture::branch(),
            t,
        )
    })
    .0
    .unwrap()
}
fn mount(bound: &BoundWorkspace) -> layerfs_overlay::KernelMount {
    let op = bound.operation().unwrap();
    let root = op.workspace().base().unwrap().root().root_inode().serial();
    op.overlay().kernel_mount(bound.route(), root).unwrap()
}
#[test]
fn positive_lookup_keeps_one_kernel_reference_until_explicit_forget() {
    let (root, service, bound) = setup("positive");
    let mount = mount(&bound);
    let receipt = bound
        .operation()
        .unwrap()
        .kernel_lookup(mount, mount.root_serial(), PathName::new("nested").unwrap())
        .unwrap();
    let parent = receipt.inode.serial;
    assert!(receipt.original.result.is_ok());
    assert!(
        matches!(receipt.original.decision,Some(KernelReadDecision::Value(ref inode)) if inode.serial==parent)
    );
    assert_eq!(receipt.operation().workspace().route(), bound.route());
    assert!(
        receipt.original.open_candidate.is_none() && receipt.original.directory_candidate.is_none()
    );
    drop(receipt); // Does not forget the directory: it remains a valid next parent.
    let file = bound
        .operation()
        .unwrap()
        .kernel_lookup(mount, parent, PathName::new("data.bin").unwrap())
        .unwrap();
    let serial = file.inode.serial;
    assert_eq!(file.inode.size, store_fixture::LARGE as u64);
    let again = bound
        .operation()
        .unwrap()
        .kernel_lookup(mount, parent, PathName::new("data.bin").unwrap())
        .unwrap();
    assert_eq!(again.inode.serial, serial);
    drop(file);
    drop(again);
    let op = bound.operation().unwrap();
    op.overlay()
        .kernel_forget(bound.route(), mount, serial, 1)
        .unwrap();
    // The second successful lookup retained a second reference, independently.
    op.overlay()
        .kernel_forget(bound.route(), mount, serial, 1)
        .unwrap();
    op.overlay()
        .kernel_forget(bound.route(), mount, parent, 1)
        .unwrap();
    op.overlay().kernel_revoke(bound.route(), mount).unwrap();
    drop(op);
    service.release(&bound).unwrap();
    drop(bound);
    service.close().unwrap();
    println!(
        "PRODUCT_LOOKUP_REFERENCE_PASS root={} explicit_forget=true",
        root.display()
    );
}
#[test]
fn negative_lookup_and_nondirectory_keep_original_definite_refusal() {
    let (root, service, bound) = setup("refused");
    let mount = mount(&bound);
    let fail = bound
        .operation()
        .unwrap()
        .kernel_lookup(mount, mount.root_serial(), PathName::new("absent").unwrap())
        .unwrap_err();
    assert_eq!(fail.refusal(), Some(Refusal::Missing));
    assert_eq!(fail.mount, mount);
    assert_eq!(fail.parent, mount.root_serial());
    assert_eq!(fail.name.as_str(), "absent");
    assert!(fail.original.as_ref().unwrap().result.is_ok());
    assert_eq!(fail.operation().workspace().route(), bound.route());
    assert!(matches!(fail.cause, KernelLookupCause::Observation(_)));
    drop(fail);
    let file = bound
        .operation()
        .unwrap()
        .kernel_lookup(
            mount,
            mount.root_serial(),
            PathName::new("alpha.txt").unwrap(),
        )
        .unwrap();
    let serial = file.inode.serial;
    drop(file);
    let fail = bound
        .operation()
        .unwrap()
        .kernel_lookup(mount, serial, PathName::new("child").unwrap())
        .unwrap_err();
    assert_eq!(fail.refusal(), Some(Refusal::NotDirectory));
    assert!(fail.original.as_ref().unwrap().result.is_ok());
    drop(fail);
    let op = bound.operation().unwrap();
    op.overlay()
        .kernel_forget(bound.route(), mount, serial, 1)
        .unwrap();
    op.overlay().kernel_revoke(bound.route(), mount).unwrap();
    drop(op);
    service.release(&bound).unwrap();
    drop(bound);
    service.close().unwrap();
    println!(
        "PRODUCT_LOOKUP_REFUSAL_PASS root={} original_observation=true",
        root.display()
    );
}
#[test]
fn foreign_and_revoked_mount_keep_failures_without_success_or_replay() {
    let (root, service, bound) = setup("fence");
    let mounted = mount(&bound);
    let other = bind(&service, 92);
    let other_mount = mount(&other);
    let fail = other
        .operation()
        .unwrap()
        .kernel_lookup(
            mounted,
            mounted.root_serial(),
            PathName::new("alpha.txt").unwrap(),
        )
        .unwrap_err();
    assert_eq!(fail.refusal(), None);
    assert!(fail.original.is_none());
    assert!(matches!(
        fail.cause,
        KernelLookupCause::Workspace(WorkspaceError::Overlay(
            layerfs_overlay::OverlayError::Stale
        ))
    ));
    assert_eq!(fail.operation().workspace().route(), other.route());
    drop(fail);
    let op = bound.operation().unwrap();
    op.overlay().kernel_revoke(bound.route(), mounted).unwrap();
    drop(op);
    let fail = bound
        .operation()
        .unwrap()
        .kernel_lookup(
            mounted,
            mounted.root_serial(),
            PathName::new("alpha.txt").unwrap(),
        )
        .unwrap_err();
    assert_eq!(fail.refusal(), None);
    assert!(fail.original.as_ref().unwrap().result.is_err());
    assert!(std::error::Error::source(fail.as_ref()).is_some());
    drop(fail);
    let healthy = other
        .operation()
        .unwrap()
        .kernel_lookup(
            other_mount,
            other_mount.root_serial(),
            PathName::new("alpha.txt").unwrap(),
        )
        .unwrap();
    let serial = healthy.inode.serial;
    drop(healthy);
    let op = other.operation().unwrap();
    op.overlay()
        .kernel_forget(other.route(), other_mount, serial, 1)
        .unwrap();
    op.overlay()
        .kernel_revoke(other.route(), other_mount)
        .unwrap();
    drop(op);
    service.release(&bound).unwrap();
    service.release(&other).unwrap();
    drop(bound);
    drop(other);
    service.close().unwrap();
    println!(
        "PRODUCT_LOOKUP_FENCE_PASS root={} foreign_refused=true other_workspace_usable=true",
        root.display()
    );
}
