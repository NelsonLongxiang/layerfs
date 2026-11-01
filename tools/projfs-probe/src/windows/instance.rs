//! Namespace ownership and a bounded external-process proof.
use super::api::{empty_path, failed, hr, wide, Api, Result};
use super::callbacks::{self, State};
use crate::{seed, NAME};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::ptr::{null, null_mut};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use windows_sys::core::GUID;
use windows_sys::Win32::Storage::FileSystem::{
    GetDriveTypeW, GetVolumeInformationW, GetVolumePathNameW,
};
use windows_sys::Win32::Storage::ProjectedFileSystem::*;
use windows_sys::Win32::System::Com::CoCreateGuid;

pub fn check() -> Result<()> {
    let _api = Api::load()?;
    println!("API_LOAD_OK live_mount_verified=false exports=12");
    Ok(())
}
fn new_root(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute() {
        return Err(failed("live root must be absolute"));
    }
    if path.exists() {
        return Err(failed("refusing existing root; use a new task directory"));
    }
    let name = path
        .file_name()
        .ok_or_else(|| failed("missing root name"))?;
    let parent = path
        .parent()
        .ok_or_else(|| failed("missing parent"))?
        .canonicalize()
        .map_err(failed)?;
    let spelling = parent.to_string_lossy();
    if spelling.starts_with(r"\\?\UNC\")
        || (spelling.starts_with(r"\\") && !spelling.starts_with(r"\\?\"))
    {
        return Err(failed("network roots are not supported"));
    }
    let parent_wide = wide(&parent)?;
    let mut volume = [0u16; 32768];
    let mut format = [0u16; 32];
    // Buffers are full-sized writable arrays; optional volume outputs are null.
    unsafe {
        if GetVolumePathNameW(
            parent_wide.as_ptr(),
            volume.as_mut_ptr(),
            volume.len() as u32,
        ) == 0
        {
            return Err(failed(std::io::Error::last_os_error()));
        }
        if GetDriveTypeW(volume.as_ptr()) != 3 {
            return Err(failed("probe requires a local fixed NTFS volume"));
        }
        if GetVolumeInformationW(
            volume.as_ptr(),
            null_mut(),
            0,
            null_mut(),
            null_mut(),
            null_mut(),
            format.as_mut_ptr(),
            format.len() as u32,
        ) == 0
        {
            return Err(failed(std::io::Error::last_os_error()));
        }
    }
    let n = format.iter().position(|v| *v == 0).unwrap_or(format.len());
    if String::from_utf16_lossy(&format[..n]) != "NTFS" {
        return Err(failed("probe requires NTFS"));
    }
    Ok(parent.join(name))
}
struct Namespace {
    state: Box<State>,
    handle: PRJ_NAMESPACE_VIRTUALIZATION_CONTEXT,
    _callbacks: Box<PRJ_CALLBACKS>,
    _mapping: Box<PRJ_NOTIFICATION_MAPPING>,
    _notification_root: Box<[u16; 1]>,
}
impl Namespace {
    fn start(api: Api, root: &Path) -> Result<Self> {
        let root_wide = wide(root)?;
        let mut id = GUID::default();
        // CoCreateGuid needs no COM apartment and fills this caller-owned GUID.
        hr(unsafe { CoCreateGuid(&mut id) }, "CoCreateGuid")?;
        std::fs::create_dir(root).map_err(failed)?;
        println!(
            "ROOT_CREATED {} (retained on success and failure)",
            root.display()
        );
        hr(
            unsafe { (api.mark)(root_wide.as_ptr(), empty_path(), null(), &id) },
            "PrjMarkDirectoryAsPlaceholder",
        )?;
        let state = Box::new(State::new(api, seed()));
        let table = Box::new(callbacks::table());
        let notification_root = Box::new([0u16; 1]);
        let mut mapping = Box::new(PRJ_NOTIFICATION_MAPPING {
            NotificationBitMask: PRJ_NOTIFY_FILE_OPENED
                | PRJ_NOTIFY_NEW_FILE_CREATED
                | PRJ_NOTIFY_FILE_OVERWRITTEN
                | PRJ_NOTIFY_PRE_DELETE
                | PRJ_NOTIFY_PRE_RENAME
                | PRJ_NOTIFY_FILE_RENAMED
                | PRJ_NOTIFY_FILE_HANDLE_CLOSED_FILE_MODIFIED
                | PRJ_NOTIFY_FILE_HANDLE_CLOSED_FILE_DELETED
                | PRJ_NOTIFY_FILE_PRE_CONVERT_TO_FULL,
            NotificationRoot: notification_root.as_ptr(),
        });
        let options = PRJ_STARTVIRTUALIZING_OPTIONS {
            PoolThreadCount: 2,
            ConcurrentThreadCount: 2,
            NotificationMappings: &mut *mapping,
            NotificationMappingsCount: 1,
            ..Default::default()
        };
        let mut namespace = Self {
            state,
            handle: null_mut(),
            _callbacks: table,
            _mapping: mapping,
            _notification_root: notification_root,
        };
        // Boxes remain at stable addresses until stop synchronously drains callbacks.
        hr(
            unsafe {
                (namespace.state.api.start)(
                    root_wide.as_ptr(),
                    &*namespace._callbacks,
                    (&*namespace.state as *const State).cast(),
                    &options,
                    &mut namespace.handle,
                )
            },
            "PrjStartVirtualizing",
        )?;
        Ok(namespace)
    }
    fn stop(&mut self) {
        if !self.handle.is_null() {
            unsafe {
                (self.state.api.stop)(self.handle);
            }
            self.handle = null_mut();
        }
    }
    fn state_of(&self, path: &Path) -> Result<i32> {
        let name = wide(path)?;
        let mut flags = 0;
        hr(
            unsafe { (self.state.api.state)(name.as_ptr(), &mut flags) },
            "PrjGetOnDiskFileState",
        )?;
        Ok(flags)
    }
}
impl Drop for Namespace {
    fn drop(&mut self) {
        self.stop();
    }
}
fn child(root: &Path) -> Result<()> {
    let mut child = Command::new(std::env::current_exe().map_err(failed)?)
        .arg("child")
        .arg(root)
        .env("LAYERFS_PROJFS_PROBE_CHILD_ROOT", root)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(failed)?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    Ok(())
                } else {
                    Err(failed(format!("native child: {status}")))
                }
            }
            Ok(None) if started.elapsed() < Duration::from_secs(15) => {
                std::thread::sleep(Duration::from_millis(10))
            }
            status => {
                // Only the child handle created above is cancelled; never kill by name.
                let _ = child.kill();
                let _ = child.wait();
                return Err(failed(format!(
                    "native child deadline or wait failure: {status:?}"
                )));
            }
        }
    }
}
pub fn live(path: &Path) -> Result<()> {
    // Missing component is a before-effect refusal: no test directory exists yet.
    let api = Api::load()?;
    let root = new_root(path)?;
    let mut namespace = Namespace::start(api, &root)?;
    println!("PROJECTION_STARTED {}", root.display());
    let work = child(&root);
    // Surface full-file/tombstone observations before closing the provider.
    let renamed = namespace.state_of(&root.join("renamed.txt"));
    println!("FILE_STATE renamed.txt {renamed:?}");
    namespace.stop();
    let state = &namespace.state;
    let reads = state.read_calls.load(Ordering::Relaxed);
    let bytes = state.read_bytes.load(Ordering::Relaxed);
    let placeholders = state.placeholder_calls.load(Ordering::Relaxed);
    let enums = state.enumeration_calls.load(Ordering::Relaxed);
    let panics = state.callback_panics.load(Ordering::Relaxed);
    let overflow = state.notification_overflow.load(Ordering::Relaxed);
    let events = state.notifications.lock().map_err(failed)?;
    for (kind, path, dest) in events.iter() {
        println!("NOTIFY {kind} {path:?} -> {dest:?}");
    }
    println!("COUNTERS enumeration={enums} placeholder={placeholders} read={reads} bytes={bytes} notifications={} panics={panics} overflow={overflow}", events.len());
    work?;
    if renamed? & PRJ_FILE_STATE_FULL == 0 {
        return Err(failed("native write did not produce a full local file"));
    }
    if reads == 0
        || bytes < seed().len() as u64
        || placeholders == 0
        || enums == 0
        || panics != 0
        || overflow != 0
    {
        return Err(failed("callback proof missing, panicked or overflowed"));
    }
    for expected in [
        PRJ_NOTIFICATION_NEW_FILE_CREATED,
        PRJ_NOTIFICATION_FILE_RENAMED,
        PRJ_NOTIFICATION_FILE_HANDLE_CLOSED_FILE_MODIFIED,
        PRJ_NOTIFICATION_FILE_HANDLE_CLOSED_FILE_DELETED,
    ] {
        if !events.iter().any(|(kind, _, _)| *kind == expected) {
            return Err(failed(format!("missing required notification {expected}")));
        }
    }
    println!("LIVE_PROJECTION_PASS file={NAME} child=read-write-rename-delete stop=drained");
    println!("NOT_RUN overlay_capture commit sandbox_isolation open_mapping_lifecycle");
    Ok(())
}
