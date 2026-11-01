//! Ordinary Windows lifetime client. Refused close must leave mounted operations usable.
use super::{
    api::{failed, Result},
    mapped::{View, LENGTH},
};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Seek, SeekFrom},
    os::windows::fs::OpenOptionsExt,
    path::Path,
    time::{Duration, Instant},
};
use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_BACKUP_SEMANTICS;
fn phase(root: &Path, index: u32, deadline: Instant) -> Result<()> {
    drop(
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(root.join("control").join(format!("close-attempt-{index}")))
            .map_err(failed)?,
    );
    let ack = root.join("control").join(format!("close-refused-{index}"));
    loop {
        if ack.try_exists().map_err(failed)? {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(failed(format!("close refusal deadline phase {index}")));
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}
pub fn close_child(root: &Path) -> Result<()> {
    if std::env::var_os("LAYERFS_PROJFS_PROBE_CHILD_ROOT").as_deref() != Some(root.as_os_str()) {
        return Err(failed("close child requires diagnostic parent"));
    }
    let deadline = Instant::now() + Duration::from_secs(25);
    let mount = root.join("mount");
    let mut file = OpenOptions::new()
        .read(true)
        .open(mount.join("alpha.txt"))
        .map_err(failed)?;
    phase(root, 0, deadline)?;
    let mut data = Vec::new();
    file.read_to_end(&mut data).map_err(failed)?;
    if data != b"old immutable Store version\n" {
        return Err(failed("file read after refused close differs"));
    }
    println!("CLOSE_CLIENT phase=0 file_held=true io_after_refusal=true");
    drop(file);
    let directory = OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(mount.join("many"))
        .map_err(failed)?;
    phase(root, 1, deadline)?;
    if fs::read_dir(mount.join("many")).map_err(failed)?.count() != 80 {
        return Err(failed("directory read after refusal differs"));
    }
    println!("CLOSE_CLIENT phase=1 directory_held=true io_after_refusal=true");
    drop(directory);
    let path = mount.join("close-mapped.bin");
    fs::write(&path, vec![65; LENGTH]).map_err(failed)?;
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .map_err(failed)?;
    let mut view = View::open(&file, true)?;
    view.set(66)?;
    phase(root, 2, deadline)?;
    if view.byte() != 66 {
        return Err(failed("mapped byte after refused close differs"));
    }
    file.seek(SeekFrom::Start(0)).map_err(failed)?;
    println!("CLOSE_CLIENT phase=2 view_held=true file_held=true section_handle_closed=true io_after_refusal=true");
    drop(file);
    phase(root, 3, deadline)?;
    view.set(67)?;
    println!("CLOSE_CLIENT phase=3 view_only=true file_and_section_closed=true mapped_write_after_refusal=true");
    view.close()?;
    let final_bytes = fs::read(&path).map_err(failed)?;
    if final_bytes.len() != LENGTH
        || final_bytes[0] != 67
        || final_bytes[1..].iter().any(|b| *b != 65)
    {
        return Err(failed("final file after unmap differs"));
    }
    println!("CLOSE_CLIENT_PASS phases=4 references_released=true ordinary_read_after_unmap=true no_flush=true");
    Ok(())
}
