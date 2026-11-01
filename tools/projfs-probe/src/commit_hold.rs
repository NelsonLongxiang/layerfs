//! Bounded test coordination through the public History publication lane.
//! CLI hold-lane <existing-control-dir>; caller guard required, never a product path.
use crate::store_fixture::{BINDING, CURSOR};
use layerfs_history::HistoryCatalog;
use layerfs_persistence::{Handles, PersistenceConfig, SqlitePersistenceProfile};
use std::{
    fs::OpenOptions,
    path::Path,
    time::{Duration, Instant},
};
pub fn hold(control: &Path) -> Result<(), String> {
    if std::env::var_os("LAYERFS_PROJFS_PROBE_CHILD_ROOT").as_deref() != Some(control.as_os_str()) {
        return Err("lane child requires its diagnostic parent".into());
    }
    let handles = Handles::open_writable(
        PersistenceConfig::sqlite(control.join("store/store.sqlite"))
            .with_sqlite_profile(SqlitePersistenceProfile::Disposable),
        BINDING,
        CURSOR,
    )
    .map_err(|e| e.to_string())?;
    let lane = handles.history.publish_lane().map_err(|e| e.to_string())?;
    drop(
        OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(control.join("lane-ready"))
            .map_err(|e| e.to_string())?,
    );
    println!("LANE_HELD existing_public_port=true history_publications=0");
    let deadline = Instant::now() + Duration::from_secs(15);
    let released = loop {
        if control
            .join("lane-release")
            .try_exists()
            .map_err(|e| e.to_string())?
        {
            break true;
        }
        if Instant::now() >= deadline {
            break false;
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    drop(lane);
    handles.shutdown();
    if !released {
        return Err("lane readiness timeout; hold released without publication".into());
    }
    println!("LANE_RELEASED requested=true");
    Ok(())
}
