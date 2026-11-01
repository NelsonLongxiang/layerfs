//! Creates only new diagnostic data, then reads through the actual published ports.
use crate::saved::{Result, Saved};
use layerfs_history::{BranchId, HistoryCatalogConfig, HistoryName, LayerStackId};
use layerfs_persistence::{PersistenceConfig, SqlitePersistenceProfile};
use layerfs_project::store::{InitRequest, ProjectApi};
use layerfs_storage::StoragePolicy;
use layerfs_store_service::{
    windows_acl,
    write::files::{self, Change},
    StoreService,
};
use layerfs_telemetry::timer::Timing;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

pub const BINDING: &[u8] = b"projfs-store-probe-v1";
pub const CURSOR: [u8; 32] = [71; 32];
pub fn branch() -> BranchId {
    BranchId::from_authority([2; 16])
}
/// Legacy single-session fixture convenience; explicit binding callers never use these defaults.
pub fn native_binding() -> crate::native_overlay::Result<crate::native_binding::Binding> {
    crate::native_binding::Binding::new(
        BINDING.to_vec(),
        CURSOR,
        branch(),
        layerfs_history::WorkspaceId::from_authority([85; 32])
            .map_err(crate::native_overlay::failed)?,
    )
}
pub const LARGE: usize = 4 * 1024 * 1024 + 31;
pub const DEFERRED: usize = 2 * 1024 * 1024;
pub fn pattern(i: usize) -> u8 {
    ((i.wrapping_mul(31) + i / 251) % 251) as u8
}
pub fn bytes(size: usize) -> Vec<u8> {
    (0..size).map(pattern).collect()
}
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub struct Fixture {
    pub directory: PathBuf,
    pub store: PathBuf,
    pub source: PathBuf,
}
impl Fixture {
    pub fn create(directory: &Path) -> Result<Self> {
        Self::create_with(
            directory,
            &HistoryCatalogConfig {
                binding_key: BINDING.to_vec(),
                cursor_key: CURSOR,
                incarnation: 1,
            },
            branch(),
        )
    }
    /// Test data through the same Project Init, with explicit non-default authority.
    pub fn create_with(
        directory: &Path,
        catalog: &HistoryCatalogConfig,
        branch: BranchId,
    ) -> Result<Self> {
        catalog.check().map_err(error)?;
        if !directory.is_absolute() {
            return Err("fixture root must be absolute".into());
        }
        fs::create_dir(directory).map_err(error)?;
        windows_acl::restrict_to_owner(directory).map_err(error)?;
        let source = directory.join("input");
        fs::create_dir(&source).map_err(error)?;
        fs::create_dir(source.join("nested")).map_err(error)?;
        fs::write(source.join("alpha.txt"), b"old immutable Store version\n").map_err(error)?;
        fs::write(source.join("nested/data.bin"), bytes(LARGE)).map_err(error)?;
        fs::write(source.join("never.bin"), bytes(DEFERRED)).map_err(error)?;
        fs::write(source.join("empty.txt"), []).map_err(error)?;
        fs::write(source.join("中文.txt"), "来自真实 Store\n").map_err(error)?;
        // A paged directory exceeds a single 64-entry metadata window.
        fs::create_dir(source.join("many")).map_err(error)?;
        for n in 0..80 {
            fs::write(
                source.join(format!("many/e{n:03}.txt")),
                format!("entry {n}\n"),
            )
            .map_err(error)?;
        }
        let store = directory.join("store.sqlite");
        let request = InitRequest {
            source: source.clone(),
            store: PersistenceConfig::sqlite(&store)
                .with_sqlite_profile(SqlitePersistenceProfile::Disposable),
            locator: "/layerfs-store/global/store.sqlite".into(),
            policy: StoragePolicy::frozen_default(),
            catalog: catalog.clone(),
            stack: LayerStackId::from_authority([1; 16]),
            stack_name: HistoryName::new("probe").map_err(error)?,
            branch,
            branch_name: HistoryName::new("work").map_err(error)?,
            scope_seed: [3; 32],
            deadline: Instant::now() + Duration::from_secs(40),
        };
        let sealed = Timing::disabled("probe.init", |scope| ProjectApi::new().init(request, scope))
            .0
            .map_err(error)?;
        println!(
            "STORE_CREATED entries={} bytes={} root={:?}",
            sealed.initialized.entries, sealed.store.bytes, sealed.initialized.root
        );
        windows_acl::restrict_to_owner(&store).map_err(error)?;
        // Prove projection cannot accidentally fall back to the original folder.
        fs::rename(&source, directory.join("input-retained-not-used")).map_err(error)?;
        Ok(Self {
            directory: directory.into(),
            store,
            source,
        })
    }
    pub fn saved(&self) -> Result<Saved> {
        Saved::open(&self.store, BINDING, CURSOR, branch())
    }
    pub fn advance_branch(&self) -> Result<()> {
        let service = StoreService::open_direct(
            &self.store,
            BINDING,
            CURSOR,
            &self.directory.join("writer-overlay.sqlite"),
        )
        .map_err(|e| format!("StoreService open: {e:?}"))?;
        let result = files::commit(
            &service,
            "probe",
            Ok("work"),
            &[Ok(Change::Write {
                path: "/alpha.txt".into(),
                bytes: b"new branch head after projection was pinned\n",
                mode: None,
            })],
            Some("advance test branch after pin"),
        );
        let closed = service.close();
        let answer = result.map_err(|e| format!("{}: {}", e.code, e.message))?;
        closed?;
        println!("BRANCH_ADVANCED {answer:?}");
        Ok(())
    }
}
