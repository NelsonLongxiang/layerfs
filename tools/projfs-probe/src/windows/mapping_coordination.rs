//! Caller-controlled readonly view used to test close refusal and ordinary reopen.
use super::{
    api::{failed, Result},
    mapped::View,
};
use std::{
    fs::{File, OpenOptions},
    path::Path,
    time::{Duration, Instant},
};

pub fn mapping_coordination(root: &Path) -> Result<()> {
    if std::env::var_os("LAYERFS_PROJFS_PROBE_CHILD_ROOT").as_deref() != Some(root.as_os_str()) {
        return Err(failed("mapping coordination requires diagnostic parent"));
    }
    let control = root.join("control");
    let deadline = Instant::now() + Duration::from_secs(25);
    let mark = |name: &str| -> Result<()> {
        drop(
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(control.join(name))
                .map_err(failed)?,
        );
        Ok(())
    };
    let wait = |name: &str| -> Result<()> {
        while !control.join(name).try_exists().map_err(failed)? {
            if Instant::now() >= deadline {
                return Err(failed(format!("mapping coordination deadline: {name}")));
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        Ok(())
    };
    let file = File::open(root.join("mount/nested/data.bin")).map_err(failed)?;
    let view = View::open(&file, false)?;
    let initial = view.byte();
    drop(file);
    println!("VIEW_COORDINATION file_closed=true view_live=true initial={initial}");
    mark("view-live")?;
    wait("check-view")?;
    if view.byte() != initial {
        return Err(failed("live readonly view changed after refusal/reopen"));
    }
    println!("VIEW_COORDINATION after_busy_and_reopen=true view_readable=true byte={initial}");
    mark("view-checked")?;
    wait("release-view")?;
    view.close()?;
    println!("VIEW_COORDINATION released_by_owner=true unmapped=true no_flush=true");
    mark("view-released")?;
    Ok(())
}
