//! Product OPEN/OPENDIR custody through real Store/Overlay public ports.
#![cfg(windows)]
use layerfs_content::filesystem::PathName;
use layerfs_history::WorkspaceId;
use layerfs_native_probe::store_fixture::{self, Fixture};
use layerfs_overlay::{KernelMount, OpenFile};
use layerfs_store_service::{
    store::{BoundWorkspace, KernelDescriptor, KernelOpenCause, KernelOpenKind},
    write::mutation::Mutation,
    StoreService,
};
use layerfs_telemetry::timer::Timing;
use layerfs_workspace::{Operation, Position, Refusal, WorkspaceError};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

fn setup(label: &str) -> (PathBuf, StoreService, Arc<BoundWorkspace>, KernelMount) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tmp")
        .canonicalize()
        .unwrap()
        .join(format!(
            "product-kernel-open-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
    let fixture = Fixture::create(&root).unwrap();
    let service = StoreService::open_direct(
        &fixture.store,
        store_fixture::BINDING,
        store_fixture::CURSOR,
        &root.join("template.sqlite"),
    )
    .unwrap();
    let bound = bind(&service, 93);
    let mount = mount(&bound);
    (root, service, bound, mount)
}
fn bind(service: &StoreService, id: u8) -> Arc<BoundWorkspace> {
    Timing::disabled("test.kernel.open", |t| {
        service.bind(
            WorkspaceId::from_authority([id; 32]).unwrap(),
            store_fixture::branch(),
            t,
        )
    })
    .0
    .unwrap()
}
fn mount(bound: &BoundWorkspace) -> KernelMount {
    let op = bound.operation().unwrap();
    let root = op.workspace().base().unwrap().root().root_inode().serial();
    op.overlay().kernel_mount(bound.route(), root).unwrap()
}
fn lookup(bound: &BoundWorkspace, mount: KernelMount, name: &str) -> u64 {
    bound
        .operation()
        .unwrap()
        .kernel_lookup(mount, mount.root_serial(), PathName::new(name).unwrap())
        .unwrap()
        .inode
        .serial
}
fn file(
    bound: &BoundWorkspace,
    mount: KernelMount,
    request: u64,
    serial: u64,
    writable: bool,
) -> OpenFile {
    let opened = bound
        .operation()
        .unwrap()
        .kernel_open(mount, request, serial, KernelOpenKind::File { writable })
        .unwrap();
    assert_eq!(opened.inode.serial, serial);
    assert!(opened.original.result.is_ok());
    assert!(opened.original.directory_candidate.is_none());
    assert_eq!(opened.operation().workspace().route(), bound.route());
    let KernelDescriptor::File(file) = opened.descriptor else {
        panic!("expected file descriptor")
    };
    assert_eq!(Some(file), opened.original.open_candidate);
    assert_eq!(file.writable(), writable);
    drop(opened); // The actual open descriptor remains until the explicit Close below.
    file
}
fn read(bound: &BoundWorkspace, mount: KernelMount, file: OpenFile) -> Vec<u8> {
    let op = bound.operation().unwrap();
    let visit = op
        .workspace()
        .kernel_data_visit(
            op.resident(),
            mount,
            file.serial(),
            Some(file.owner_id()),
            0,
            100,
        )
        .unwrap();
    let window = op
        .overlay()
        .kernel_read_visit(bound.route(), Box::new(visit))
        .unwrap();
    let base = op.workspace().base().unwrap();
    (*window)
        .clone()
        .finish(Some(&base), file.serial(), 0, 100, false)
        .unwrap()
        .unwrap()
}
fn close(bound: &BoundWorkspace, mount: KernelMount, file: OpenFile) {
    bound
        .operation()
        .unwrap()
        .overlay()
        .kernel_close_file(bound.route(), mount, file.serial(), file.owner_id())
        .unwrap();
}
fn forget(bound: &BoundWorkspace, mount: KernelMount, serial: u64) {
    bound
        .operation()
        .unwrap()
        .overlay()
        .kernel_forget(bound.route(), mount, serial, 1)
        .unwrap();
}
fn revoke(bound: &BoundWorkspace, mount: KernelMount) {
    bound
        .operation()
        .unwrap()
        .overlay()
        .kernel_revoke(bound.route(), mount)
        .unwrap();
}
#[test]
fn open_and_lookup_survive_independently_and_unlinked_file_reopens_by_serial() {
    let (root, service, bound, mount) = setup("orphan");
    let serial = lookup(&bound, mount, "alpha.txt");
    let first = file(&bound, mount, 701, serial, true);
    let mut mutation = Mutation::new(&bound).unwrap();
    mutation
        .apply(Operation::Unlink {
            parent: mount.root_serial(),
            name: PathName::new("alpha.txt").unwrap(),
        })
        .unwrap();
    mutation.finish().unwrap();
    // The still-held lookup permits opening the removed serial, with no path lookup.
    let second = file(&bound, mount, 702, serial, false);
    assert_ne!(first.owner_id(), second.owner_id());
    forget(&bound, mount, serial);
    assert_eq!(
        read(&bound, mount, first),
        b"old immutable Store version
"
    );
    let mut mutation = Mutation::new(&bound).unwrap();
    mutation
        .apply(Operation::WriteOpen {
            file: first,
            position: Position::At(0),
            data: b"NEW".as_slice().into(),
        })
        .unwrap();
    mutation.finish().unwrap();
    let mut mutation = Mutation::new(&bound).unwrap();
    assert!(mutation
        .apply(Operation::WriteOpen {
            file: second,
            position: Position::At(0),
            data: b"bad".as_slice().into()
        })
        .is_err());
    mutation.finish().unwrap();
    close(&bound, mount, first);
    assert_eq!(
        read(&bound, mount, second),
        b"NEW immutable Store version
"
    );
    close(&bound, mount, second);
    revoke(&bound, mount);
    service.release(&bound).unwrap();
    drop(bound);
    service.close().unwrap();
    println!(
        "PRODUCT_OPEN_ORPHAN_PASS root={} lookup_open_independent=true exact_close=true",
        root.display()
    );
}
#[test]
fn directory_descriptor_remains_after_forget_and_type_refusals_are_original() {
    let (root, service, bound, mount) = setup("directory");
    let serial = lookup(&bound, mount, "nested");
    let fail = bound
        .operation()
        .unwrap()
        .kernel_open(mount, 801, serial, KernelOpenKind::File { writable: false })
        .unwrap_err();
    assert_eq!(fail.refusal(), Some(Refusal::IsDirectory));
    assert!(fail.original.as_ref().unwrap().open_candidate.is_none());
    drop(fail);
    let opened = bound
        .operation()
        .unwrap()
        .kernel_open(mount, 802, serial, KernelOpenKind::Directory)
        .unwrap();
    let KernelDescriptor::Directory(directory) = opened.descriptor else {
        panic!("expected directory descriptor")
    };
    assert_eq!(directory.mount(), mount);
    assert_eq!(directory.serial(), serial);
    assert_eq!(Some(directory), opened.original.directory_candidate);
    drop(opened);
    forget(&bound, mount, serial);
    let op = bound.operation().unwrap();
    let visit = op
        .workspace()
        .kernel_directory_visit(op.resident(), mount, serial, directory.owner_id(), 0, None)
        .unwrap();
    let page = op
        .overlay()
        .kernel_directory_visit(bound.route(), visit)
        .unwrap();
    assert_eq!(page.page.directory(), directory);
    drop(page);
    op.overlay()
        .kernel_directory_close(bound.route(), mount, serial, directory.owner_id())
        .unwrap();
    drop(op);
    let serial = lookup(&bound, mount, "alpha.txt");
    let fail = bound
        .operation()
        .unwrap()
        .kernel_open(mount, 803, serial, KernelOpenKind::Directory)
        .unwrap_err();
    assert_eq!(fail.refusal(), Some(Refusal::NotDirectory));
    assert!(fail
        .original
        .as_ref()
        .unwrap()
        .directory_candidate
        .is_none());
    drop(fail);
    forget(&bound, mount, serial);
    revoke(&bound, mount);
    service.release(&bound).unwrap();
    drop(bound);
    service.close().unwrap();
    println!(
        "PRODUCT_OPENDIR_PASS root={} forget_does_not_close=true type_refusals=true",
        root.display()
    );
}
#[test]
fn foreign_revoked_and_unreferenced_serials_never_produce_adoptable_success() {
    let (root, service, bound, mounted) = setup("fences");
    let serial = lookup(&bound, mounted, "alpha.txt");
    let other = bind(&service, 94);
    let other_mount = mount(&other);
    let fail = other
        .operation()
        .unwrap()
        .kernel_open(
            mounted,
            901,
            serial,
            KernelOpenKind::File { writable: false },
        )
        .unwrap_err();
    assert_eq!(fail.refusal(), None);
    assert!(fail.original.is_none());
    assert!(matches!(
        fail.cause,
        KernelOpenCause::Workspace(WorkspaceError::Overlay(
            layerfs_overlay::OverlayError::Stale
        ))
    ));
    drop(fail);
    // This mount has never LOOKUP'd serial: another Workspace's reference grants nothing.
    let fail = other
        .operation()
        .unwrap()
        .kernel_open(
            other_mount,
            902,
            serial,
            KernelOpenKind::File { writable: false },
        )
        .unwrap_err();
    assert_eq!(fail.refusal(), None);
    assert!(fail.original.as_ref().unwrap().result.is_err());
    assert!(fail.original.as_ref().unwrap().open_candidate.is_none());
    drop(fail);
    let healthy_serial = lookup(&other, other_mount, "alpha.txt");
    let healthy = file(&other, other_mount, 903, healthy_serial, false);
    forget(&bound, mounted, serial);
    revoke(&bound, mounted);
    let fail = bound
        .operation()
        .unwrap()
        .kernel_open(
            mounted,
            904,
            serial,
            KernelOpenKind::File { writable: false },
        )
        .unwrap_err();
    assert_eq!(fail.refusal(), None);
    assert!(fail.original.as_ref().unwrap().result.is_err());
    assert_eq!(fail.request, 904);
    assert_eq!(fail.serial, serial);
    assert_eq!(fail.operation().workspace().route(), bound.route());
    assert!(std::error::Error::source(fail.as_ref()).is_some());
    drop(fail);
    assert_eq!(
        read(&other, other_mount, healthy),
        b"old immutable Store version
"
    );
    close(&other, other_mount, healthy);
    forget(&other, other_mount, healthy_serial);
    revoke(&other, other_mount);
    service.release(&bound).unwrap();
    service.release(&other).unwrap();
    drop(bound);
    drop(other);
    service.close().unwrap();
    println!(
        "PRODUCT_OPEN_FENCE_PASS root={} original_failures=true sibling_usable=true",
        root.display()
    );
}
