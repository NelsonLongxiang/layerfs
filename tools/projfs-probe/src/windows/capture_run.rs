//! Bounded counterexample: NTFS sharing/byte locks and ProjFS stop are not capture.
use super::{
    api::{failed, Api, Result},
    instance::{new_root, Namespace},
    mapped::{self, View},
};
use crate::{seed, source::Source, NAME};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::windows::fs::OpenOptionsExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::ERROR_SHARING_VIOLATION;
use windows_sys::Win32::Storage::FileSystem::{
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
};

const SHARE: u32 = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
fn mark(root: &Path, phase: &str) -> Result<()> {
    // create_new gives each phase one effect; no rewrite/replay of uncertain writes.
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(root.join("control").join(phase))
        .map_err(failed)?;
    drop(file);
    Ok(())
}
fn wait(root: &Path, phase: &str, deadline: Instant, child: Option<&mut Child>) -> Result<()> {
    let mut child = child;
    loop {
        if root
            .join("control")
            .join(phase)
            .try_exists()
            .map_err(failed)?
        {
            return Ok(());
        }
        if let Some(c) = child.as_deref_mut() {
            if let Some(status) = c.try_wait().map_err(failed)? {
                return Err(failed(format!("child exited before {phase}: {status}")));
            }
        }
        if Instant::now() >= deadline {
            return Err(failed(format!("handshake deadline: {phase}")));
        }
        // Bounded readiness wait, not a retry of a file mutation or provider request.
        std::thread::sleep(Duration::from_millis(5));
    }
}
fn reader(path: &Path, deny_write: bool) -> std::io::Result<File> {
    OpenOptions::new()
        .read(true)
        .share_mode(if deny_write { FILE_SHARE_READ } else { SHARE })
        .open(path)
}
fn byte(file: &mut File) -> Result<u8> {
    file.seek(SeekFrom::Start(0)).map_err(failed)?;
    let mut value = [0];
    file.read_exact(&mut value).map_err(failed)?;
    Ok(value[0])
}
fn expect(value: bool, reason: &str) -> Result<()> {
    if value {
        Ok(())
    } else {
        Err(failed(reason))
    }
}
fn sharing_refused(result: std::io::Result<File>, label: &str) -> Result<()> {
    match result {
        Err(e) if e.raw_os_error() == Some(ERROR_SHARING_VIOLATION as i32) => {
            println!("SHARING_REFUSED {label} win32={ERROR_SHARING_VIOLATION}");
            Ok(())
        }
        Err(e) => Err(failed(format!("{label}: wrong error {e}"))),
        Ok(_) => Err(failed(format!("{label}: unexpectedly opened"))),
    }
}
fn notifications(ns: &Namespace, stage: &str) -> Result<usize> {
    let events = ns.state.notifications.lock().map_err(failed)?;
    let relevant: Vec<_> = events.iter().filter(|(_, path, _)| path == NAME).collect();
    println!(
        "CAPTURE_NOTIFICATIONS stage={stage} count={} events={relevant:?}",
        relevant.len()
    );
    Ok(relevant.len())
}

pub fn capture_child(root: &Path) -> Result<()> {
    if std::env::var_os("LAYERFS_PROJFS_PROBE_CHILD_ROOT").as_deref() != Some(root.as_os_str()) {
        return Err(failed("capture child requires its live parent"));
    }
    let deadline = Instant::now() + Duration::from_secs(15);
    let path = root.join("projection").join(NAME);
    expect(
        fs::read(&path).map_err(failed)? == seed(),
        "child initial hydration differs",
    )?;
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(SHARE)
        .open(&path)
        .map_err(failed)?;
    file.write_all(&[0x41]).map_err(failed)?;
    mark(root, "writer-held")?;
    wait(root, "close-writer", deadline, None)?;
    drop(file);
    mark(root, "writer-closed")?;
    wait(root, "guard-held", deadline, None)?;
    sharing_refused(
        OpenOptions::new().write(true).share_mode(SHARE).open(&path),
        "child-writer-blocked-by-capture-open",
    )?;
    mark(root, "guard-observed")?;
    wait(root, "begin-map", deadline, None)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(SHARE)
        .open(&path)
        .map_err(failed)?;
    let mut view = View::open(&file, true)?;
    view.set(0x42)?;
    drop(file); // only the mapped view survives, not a File/section HANDLE
    mark(root, "map-only")?;
    wait(root, "write-under-lock", deadline, None)?;
    view.set(0x43)?;
    mark(root, "mapped-write")?;
    wait(root, "write-after-stop", deadline, None)?;
    view.set(0x44)?;
    mark(root, "post-stop-write")?;
    wait(root, "release-map", deadline, None)?;
    view.close()?;
    mark(root, "map-released")?;
    println!("CAPTURE_CHILD_PASS ordinary_write=true file_handle_closed=true section_handle_closed=true mapped_after_stop=true");
    Ok(())
}

fn experiment(root: &Path, ns: &mut Namespace, child: &mut Child) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(15);
    let path = root.join("projection").join(NAME);
    wait(root, "writer-held", deadline, Some(child))?;
    sharing_refused(reader(&path, true), "live-writer-blocks-capture-open")?;
    mark(root, "close-writer")?;
    wait(root, "writer-closed", deadline, Some(child))?;
    let mut closed = reader(&path, true).map_err(failed)?;
    expect(
        byte(&mut closed)? == 0x41,
        "ordinary write not visible after handle close",
    )?;
    sharing_refused(
        OpenOptions::new().write(true).share_mode(SHARE).open(&path),
        "capture-open-blocks-new-writer",
    )?;
    mark(root, "guard-held")?;
    wait(root, "guard-observed", deadline, Some(child))?;
    expect(
        byte(&mut closed)? == 0x41,
        "held guard did not retain ordinary byte",
    )?;
    println!("CLOSED_HANDLE_CONTROL read_byte=65 deny_write_open=true new_writer_refused=true external_writer_refused=true replay_byte=65");
    drop(closed);
    mark(root, "begin-map")?;
    wait(root, "map-only", deadline, Some(child))?;
    sharing_refused(reader(&path, true), "map-only-blocks-capture-open")?;
    println!("MAP_ONLY_SHARING deny_write_open=false win32={ERROR_SHARING_VIOLATION}");
    // Separate counterexample, not a fallback capture: the restrictive capture
    // attempt above stays refused. This read explicitly shares WRITE and DELETE.
    let mut file = reader(&path, false).map_err(failed)?;
    let before = file.metadata().map_err(failed)?;
    let observer = View::open(&file, false)?;
    expect(observer.byte() == 0x42, "mapped baseline differs")?;
    mapped::lock(&file)?;
    let before_events = notifications(ns, "map-only")?;
    mark(root, "write-under-lock")?;
    wait(root, "mapped-write", deadline, Some(child))?;
    expect(
        observer.byte() == 0x43,
        "mapped write did not cross locked range",
    )?;
    let after = file.metadata().map_err(failed)?;
    let after_events = notifications(ns, "mapped-write")?;
    println!("LOCK_COUNTEREXAMPLE lock_held=true mapped_before=66 mapped_after=67 read_file={} size_same={} mtime_same={} notifications_before={before_events} notifications_after={after_events}",byte(&mut file)?,before.len()==after.len(),before.modified().map_err(failed)?==after.modified().map_err(failed)?);
    ns.stop(); // this drains provider callbacks, not this external mapping
    expect(
        child.try_wait().map_err(failed)?.is_none(),
        "child ended before stop",
    )?;
    let stop_events = notifications(ns, "stopped")?;
    println!("STOP_RETURNED child_alive=true mapping_alive=true lock_held=true");
    mark(root, "write-after-stop")?;
    wait(root, "post-stop-write", deadline, Some(child))?;
    expect(
        observer.byte() == 0x44,
        "mapping no longer writable after provider stop",
    )?;
    let post_events = notifications(ns, "post-stop-write")?;
    expect(stop_events == post_events, "callback arrived after stop")?;
    println!("STOP_COUNTEREXAMPLE mapped_before=67 mapped_after=68 callbacks_after_stop={} lock_held=true",post_events-stop_events);
    mark(root, "release-map")?;
    wait(root, "map-released", deadline, Some(child))?;
    observer.close()?;
    mapped::unlock(&file)?;
    drop(file);
    while child.try_wait().map_err(failed)?.is_none() {
        if Instant::now() >= deadline {
            return Err(failed("child exit deadline"));
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    expect(
        child.wait().map_err(failed)?.success(),
        "child failed after release",
    )?;
    let mut final_file = reader(&path, true).map_err(failed)?;
    let final_byte = byte(&mut final_file)?;
    println!(
        "FINAL_OBSERVATION read_file={final_byte} expected_mapped_byte=68 durability_claim=false"
    );
    expect(
        final_byte == 0x44,
        "final read did not observe last mapped byte",
    )?;
    Ok(())
}
pub fn capture_live(path: &Path) -> Result<()> {
    let api = Api::load()?;
    let root = new_root(path)?;
    fs::create_dir(&root).map_err(failed)?;
    fs::create_dir(root.join("control")).map_err(failed)?;
    let mut ns = Namespace::start(api, &root.join("projection"), Source::Fixture(seed()))?;
    let mut child = Command::new(std::env::current_exe().map_err(failed)?)
        .arg("capture-child")
        .arg(&root)
        .env("LAYERFS_PROJFS_PROBE_CHILD_ROOT", &root)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(failed)?;
    let result = experiment(&root, &mut ns, &mut child);
    if result.is_err() {
        // Exact child handle created by this diagnostic; no user processes/descendants.
        if matches!(child.try_wait(), Ok(None)) {
            let _ = child.kill();
        }
        let _ = child.wait();
    }
    ns.stop();
    result?;
    let panics = ns.state.callback_panics.load(Ordering::Relaxed);
    let overflow = ns.state.notification_overflow.load(Ordering::Relaxed);
    expect(
        ns.state.first_error.lock().map_err(failed)?.is_none(),
        "provider error",
    )?;
    expect(panics == 0 && overflow == 0, "callback panic/overflow")?;
    println!("CAPTURE_BOUNDARY_PASS byte_lock_not_snapshot=true provider_stop_not_mapping_fence=true panics={panics} overflow={overflow}");
    println!("NOT_RUN stable_overlay_capture commit_writeback product_workspace complete_mapping_detection");
    Ok(())
}
