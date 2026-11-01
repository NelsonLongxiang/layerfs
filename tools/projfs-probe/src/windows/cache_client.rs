//! Ordinary Windows cache/mapping client; no Store or Overlay calls here.
use super::{
    api::{failed, Result},
    mapped::{View, LENGTH},
};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
    time::{Duration, Instant},
};
fn phase(root: &Path, index: u32, visible: u8, deadline: Instant) -> Result<()> {
    println!("CACHE_CLIENT phase={index} visible={visible} explicit_flush=false");
    let path = root.join("control").join(format!("cache-{index}"));
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(failed)?;
    drop(file);
    let ack = root.join("control").join(format!("cache-ack-{index}"));
    loop {
        if ack.try_exists().map_err(failed)? {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(failed(format!("cache handshake timeout phase {index}")));
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}
pub fn cache_child(root: &Path) -> Result<()> {
    if std::env::var_os("LAYERFS_PROJFS_PROBE_CHILD_ROOT").as_deref() != Some(root.as_os_str()) {
        return Err(failed("cache child requires its diagnostic parent"));
    }
    let deadline = Instant::now() + Duration::from_secs(25);
    let path = root.join("mount/cache.bin");
    let mut seed = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(failed)?;
    seed.write_all(&vec![65; LENGTH]).map_err(failed)?;
    drop(seed);
    phase(root, 0, 65, deadline)?;
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .map_err(failed)?;
    file.write_all(&[66]).map_err(failed)?;
    file.seek(SeekFrom::Start(0)).map_err(failed)?;
    let mut byte = [0];
    file.read_exact(&mut byte).map_err(failed)?;
    if byte[0] != 66 {
        return Err(failed("ordinary cached write not visible to same handle"));
    }
    phase(root, 1, byte[0], deadline)?; // file still open; application write already returned
    drop(file);
    phase(root, 2, 66, deadline)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .map_err(failed)?;
    let mut view = View::open(&file, true)?;
    view.set(67)?;
    phase(root, 3, view.byte(), deadline)?; // file and view alive; section HANDLE already closed
    drop(file);
    phase(root, 4, view.byte(), deadline)?; // view alone; native Cleanup may have run, Close must not
    view.set(68)?;
    phase(root, 5, view.byte(), deadline)?; // view remains writable across real Commit
    view.close()?;
    phase(root, 6, 68, deadline)?;
    let contents = fs::read(&path).map_err(failed)?;
    if contents.len() != LENGTH || contents[0] != 68 || contents[1..].iter().any(|&b| b != 65) {
        return Err(failed("ordinary final read lost mapped bytes"));
    }
    phase(root, 7, contents[0], deadline)?;
    println!("CACHE_CLIENT_PASS stages=8 file_and_section_closed_before_last_view_write=true flush_api_called=false");
    Ok(())
}
