//! Read-only section lifetime control. No writes, flush or access after unmap.
use super::{
    api::{failed, Result},
    mapped::View,
};
use std::{fs::File, io::Read, path::Path};

pub fn mapping_lifetime(path: &Path, mode: &str) -> Result<()> {
    if std::env::var_os("LAYERFS_PROJFS_PROBE_CHILD_ROOT").as_deref() != Some(path.as_os_str()) {
        return Err(failed("mapping lifetime child requires diagnostic parent"));
    }
    if !matches!(mode, "read" | "view-first" | "file-first") {
        return Err(failed("unknown lifetime order"));
    }
    let mut file = File::open(path).map_err(failed)?;
    if mode == "read" {
        let mut byte = [0];
        file.read_exact(&mut byte).map_err(failed)?;
        drop(file);
        println!(
            "MAPPING_LIFETIME mode=read byte={} file_closed=true",
            byte[0]
        );
        return Ok(());
    }
    let view = View::open(&file, false)?;
    let byte = view.byte();
    if mode == "file-first" {
        drop(file);
        println!("MAPPING_LIFETIME mode=file-first byte={byte} file_closed=true view_live=true");
        if view.byte() != byte {
            return Err(failed("read-only view changed"));
        }
        view.close()?;
    } else {
        view.close()?;
        drop(file);
    }
    println!("MAPPING_LIFETIME mode={mode} view_unmapped=true file_closed=true no_flush=true");
    Ok(())
}
