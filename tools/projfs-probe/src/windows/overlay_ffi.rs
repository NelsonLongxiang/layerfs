//! Narrow C ABI for the diagnostic native host. Unsafe never leaves windows/.
use crate::native_overlay::{failed, CloseState, CommitScope, Error, Session, Stat};
use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
};
static SESSION: OnceLock<Mutex<Option<Session>>> = OnceLock::new();
static REQUESTS: Mutex<Option<layerfs_fuse::MountRequests>> = Mutex::new(None);
static RETAINED: AtomicBool = AtomicBool::new(false);
fn install(slot: &mut Option<Session>, session: Session) -> Result<(), Error> {
    let requests = session.requests();
    *slot = Some(session);
    *REQUESTS
        .lock()
        .map_err(|_| failed("request registry poisoned; Session retained"))? = Some(requests);
    Ok(())
}
fn invoke(action: impl FnOnce(&mut Session) -> Result<(), Error>) -> Result<(), Error> {
    // Session bookkeeping is short; Commit construction is still run outside it.
    let mut state = SESSION
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| failed("bridge poisoned; retained"))?;
    if RETAINED.load(Ordering::Acquire) {
        return Err(failed("prior unknown outcome retained; no further calls"));
    }
    let answer = action(state.as_mut().ok_or_else(|| failed("bridge not started"))?);
    if answer
        .as_ref()
        .is_err_and(|e| e.status == 0xc0000001u32 as i32)
    {
        RETAINED.store(true, Ordering::Release);
    }
    answer
}
// Short control operations do not represent native filesystem callbacks. In
// particular, terminal preparation must not count itself as an active callback.
fn call(action: impl FnOnce(&mut Session) -> Result<(), Error>) -> i32 {
    match catch_unwind(AssertUnwindSafe(|| invoke(action))) {
        Ok(Ok(())) => 0,
        Ok(Err(e)) => {
            eprintln!("OVERLAY_REFUSAL {:08x}: {}", e.status as u32, e.detail);
            e.status
        }
        Err(payload) => {
            RETAINED.store(true, Ordering::Release);
            // Preserve the original control panic, as well as the poisoned Session.
            std::mem::forget(payload);
            eprintln!("OVERLAY_PANIC retained; no replay");
            0xc0000001u32 as i32
        }
    }
}
fn callback(action: impl FnOnce(&mut Session) -> Result<(), Error>) -> i32 {
    let admission = (|| {
        let requests = REQUESTS
            .lock()
            .map_err(|_| failed("request registry poisoned"))?
            .clone()
            .ok_or_else(|| failed("native request lane not installed"))?;
        let received = requests.receive().map_err(|error| match error {
            layerfs_fuse::DispatchError::Stopped | layerfs_fuse::DispatchError::Stale => {
                crate::native_overlay::refused(0xc0000128, "native callback admission stopped")
            }
            _ => failed(error),
        })?;
        // No copied request frame is owned here; the ABI callback validates its
        // caller-owned spans and data windows. The product lane owns lifetime.
        received
            .request(0)
            .map_err(|failure| failed(failure.reason))
    })();
    let request = match admission {
        Ok(request) => request,
        Err(e) => {
            if e.status == 0xc0000001u32 as i32 {
                RETAINED.store(true, Ordering::Release);
            }
            eprintln!(
                "NATIVE_CALLBACK_REFUSED {:08x}: {}",
                e.status as u32, e.detail
            );
            return e.status;
        }
    };
    let mut status = 0xc0000001u32 as i32;
    let mut returned = false;
    let answer = request.serve_sync(|| {
        let disposition = match invoke(action) {
            Ok(()) => {
                status = 0;
                layerfs_fuse::RequestDisposition::Complete
            }
            Err(e) => {
                status = e.status;
                eprintln!("OVERLAY_REFUSAL {:08x}: {}", e.status as u32, e.detail);
                if status == 0xc0000001u32 as i32 {
                    layerfs_fuse::RequestDisposition::Retained(Box::new(e))
                } else {
                    layerfs_fuse::RequestDisposition::Complete
                }
            }
        };
        returned = true;
        disposition
    });
    if !returned || answer.is_err() {
        RETAINED.store(true, Ordering::Release);
        eprintln!("NATIVE_CALLBACK_PANIC_OR_DRAIN_FAILURE retained; no replay");
        return 0xc0000001u32 as i32;
    }
    status
}
unsafe fn text(ptr: *const u16, len: u32) -> Result<String, Error> {
    if ptr.is_null() || len == 0 || len > 32768 {
        return Err(failed("invalid UTF16 span"));
    }
    // Host supplies a live UTF-16 buffer of len units throughout this call.
    String::from_utf16(unsafe { std::slice::from_raw_parts(ptr, len as usize) }).map_err(failed)
}
unsafe fn path(ptr: *const u16, len: u32) -> Result<String, Error> {
    Ok(unsafe { text(ptr, len) }?.replace('\\', "/"))
}
unsafe fn put<T: Copy>(ptr: *mut T, value: T) -> Result<(), Error> {
    if ptr.is_null() {
        return Err(failed("null output"));
    }
    // Host owns writable aligned output storage for exactly one T.
    unsafe { ptr.write(value) };
    Ok(())
}
#[no_mangle]
pub unsafe extern "C" fn lf_start(ptr: *const u16, len: u32) -> i32 {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let spelling = unsafe { text(ptr, len) }?;
        let root = super::instance::new_root(Path::new(&spelling)).map_err(failed)?;
        let mut slot = SESSION
            .get_or_init(|| Mutex::new(None))
            .lock()
            .map_err(|_| failed("bridge poisoned"))?;
        if slot.is_some() {
            return Err(failed("already started"));
        }
        install(&mut slot, Session::create(&root)?)?;
        Ok::<_, Error>(())
    }));
    match result {
        Ok(Ok(())) => 0,
        Ok(Err(e)) => {
            eprintln!("OVERLAY_START_FAIL {e}");
            e.status
        }
        Err(_) => 0xc0000001u32 as i32,
    }
}
#[no_mangle]
pub unsafe extern "C" fn lf_reopen(
    store: *const u16,
    slen: u32,
    work: *const u16,
    wlen: u32,
) -> i32 {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let store = unsafe { text(store, slen) }?;
        let work = unsafe { text(work, wlen) }?;
        let work = super::instance::new_root(Path::new(&work)).map_err(failed)?;
        let mut slot = SESSION
            .get_or_init(|| Mutex::new(None))
            .lock()
            .map_err(|_| failed("bridge poisoned"))?;
        if slot.is_some() || RETAINED.load(Ordering::Acquire) {
            return Err(failed("session already present or retained"));
        }
        install(&mut slot, Session::reopen(Path::new(&store), &work)?)?;
        Ok::<_, Error>(())
    }));
    match result {
        Ok(Ok(())) => 0,
        Ok(Err(e)) => {
            eprintln!("OVERLAY_REOPEN_FAIL {e}");
            e.status
        }
        Err(_) => 0xc0000001u32 as i32,
    }
}
#[no_mangle]
pub unsafe extern "C" fn lf_bind_stdin(
    store: *const u16,
    slen: u32,
    work: *const u16,
    wlen: u32,
) -> i32 {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let store = unsafe { text(store, slen) }?;
        let work = unsafe { text(work, wlen) }?;
        let work = super::instance::new_root(Path::new(&work)).map_err(failed)?;
        let binding = crate::native_binding::Binding::read_from(std::io::stdin().lock())?;
        let mut slot = SESSION
            .get_or_init(|| Mutex::new(None))
            .lock()
            .map_err(|_| failed("bridge poisoned"))?;
        if slot.is_some() || RETAINED.load(Ordering::Acquire) {
            return Err(failed("session already present or retained"));
        }
        install(
            &mut slot,
            Session::bind_existing(Path::new(&store), &work, binding)?,
        )?;
        Ok::<_, Error>(())
    }));
    match result {
        Ok(Ok(())) => 0,
        Ok(Err(e)) => {
            eprintln!("OVERLAY_BIND_FAIL status={:08x}", e.status as u32);
            e.status
        }
        Err(_) => 0xc0000001u32 as i32,
    }
}
#[no_mangle]
pub unsafe extern "C" fn lf_stat(ptr: *const u16, len: u32, out: *mut Stat) -> i32 {
    callback(|s| unsafe { put(out, s.stat_path(&path(ptr, len)?)?) })
}
#[no_mangle]
pub unsafe extern "C" fn lf_open(
    ptr: *const u16,
    len: u32,
    create: u32,
    writable: u32,
    handle: *mut u64,
    out: *mut Stat,
) -> i32 {
    callback(|s| {
        if handle.is_null() || out.is_null() {
            return Err(failed("null open outputs"));
        }
        let name = unsafe { path(ptr, len) }?;
        let (h, stat) = match create {
            0 => s.open_windows(&name, writable)?,
            1 => s.create_file(&name)?,
            2 => s.create_directory(&name)?,
            _ => {
                return Err(crate::native_overlay::refused(
                    0xc000000d,
                    "invalid create kind",
                ))
            }
        };
        unsafe {
            put(handle, h)?;
            put(out, stat)
        }
    })
}
#[no_mangle]
pub unsafe extern "C" fn lf_create(
    ptr: *const u16,
    len: u32,
    directory: u32,
    access: u32,
    attributes: u32,
    handle: *mut u64,
    out: *mut Stat,
) -> i32 {
    callback(|s| {
        if handle.is_null() || out.is_null() {
            return Err(failed("null create output"));
        }
        let (h, stat) = s.create_native(
            &unsafe { path(ptr, len) }?,
            directory != 0,
            attributes,
            access,
        )?;
        unsafe {
            put(handle, h)?;
            put(out, stat)
        }
    })
}
#[no_mangle]
pub unsafe extern "C" fn lf_info(handle: u64, out: *mut Stat) -> i32 {
    callback(|s| unsafe { put(out, s.stat_handle(handle)?) })
}
#[no_mangle]
pub unsafe extern "C" fn lf_read(
    handle: u64,
    offset: u64,
    out: *mut u8,
    length: u32,
    count: *mut u32,
) -> i32 {
    callback(|s| {
        if out.is_null() || count.is_null() {
            return Err(failed("null read output"));
        }
        let bytes = s.read(handle, offset, length)?;
        if bytes.len() > length as usize {
            return Err(failed("read output too large"));
        }
        // Request-owned buffer remains live until this synchronous callback returns.
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, bytes.len());
            put(count, bytes.len() as u32)
        }
    })
}
#[no_mangle]
pub unsafe extern "C" fn lf_write(
    handle: u64,
    offset: u64,
    data: *const u8,
    length: u32,
    flags: u32,
    out: *mut Stat,
) -> i32 {
    callback(|s| {
        if data.is_null() || out.is_null() || length as usize > layerfs_overlay::WRITE_WINDOW {
            return Err(failed("invalid write buffer/window"));
        }
        // Input is borrowed only for this call; WriteData takes its own bounded copy.
        let bytes = unsafe { std::slice::from_raw_parts(data, length as usize) };
        let stat = s.write(handle, offset, bytes, flags & 1 != 0, flags & 2 != 0)?;
        unsafe { put(out, stat) }
    })
}
#[no_mangle]
pub unsafe extern "C" fn lf_basic_info(
    handle: u64,
    attributes: u32,
    creation: u64,
    access: u64,
    write: u64,
    change: u64,
    out: *mut Stat,
) -> i32 {
    callback(|s| {
        if out.is_null() {
            return Err(failed("null basic info output"));
        }
        let stat = s.basic_info(handle, attributes, [creation, access, write, change])?;
        unsafe { put(out, stat) }
    })
}
#[no_mangle]
pub unsafe extern "C" fn lf_overwrite(
    handle: u64,
    attributes: u32,
    replace: u32,
    out: *mut Stat,
) -> i32 {
    callback(|s| {
        if out.is_null() {
            return Err(failed("null overwrite output"));
        }
        let stat = s.overwrite_windows(handle, attributes, replace != 0)?;
        unsafe { put(out, stat) }
    })
}
#[no_mangle]
pub unsafe extern "C" fn lf_resize(handle: u64, size: u64, out: *mut Stat) -> i32 {
    callback(|s| unsafe { put(out, s.resize(handle, size)?) })
}
#[no_mangle]
pub unsafe extern "C" fn lf_rename(
    from: *const u16,
    flen: u32,
    to: *const u16,
    tlen: u32,
    replace: u32,
) -> i32 {
    callback(|s| {
        s.rename(
            &unsafe { path(from, flen) }?,
            &unsafe { path(to, tlen) }?,
            replace != 0,
        )
    })
}
#[no_mangle]
pub unsafe extern "C" fn lf_dot(handle: u64, parent: u32, found: *mut u32, out: *mut Stat) -> i32 {
    callback(|s| {
        if found.is_null() || out.is_null() {
            return Err(failed("null dot output"));
        }
        let value = s.directory_dot(handle, parent != 0)?;
        if let Some(stat) = value {
            unsafe {
                put(out, stat)?;
            }
        }
        unsafe { put(found, u32::from(value.is_some())) }
    })
}
#[no_mangle]
pub unsafe extern "C" fn lf_can_delete(ptr: *const u16, len: u32) -> i32 {
    callback(|s| s.can_delete(&unsafe { path(ptr, len) }?))
}
#[no_mangle]
pub unsafe extern "C" fn lf_unlink(ptr: *const u16, len: u32) -> i32 {
    callback(|s| s.unlink(&unsafe { path(ptr, len) }?))
}
#[no_mangle]
pub extern "C" fn lf_close(handle: u64) -> i32 {
    callback(|s| s.close_file(handle))
}
#[no_mangle]
pub unsafe extern "C" fn lf_next(
    handle: u64,
    after: *const u16,
    alen: u32,
    name: *mut u16,
    capacity: u32,
    length: *mut u32,
    out: *mut Stat,
) -> i32 {
    callback(|s| {
        if name.is_null() || length.is_null() || out.is_null() {
            return Err(failed("null list output"));
        }
        let after = if alen == 0 {
            None
        } else {
            Some(unsafe { text(after, alen) }?)
        };
        match s.list_next(handle, after.as_ref().map(|s| s.as_bytes()))? {
            None => unsafe { put(length, 0) },
            Some((key, stat)) => {
                let text = std::str::from_utf8(&key).map_err(failed)?;
                let wide: Vec<u16> = text.encode_utf16().collect();
                if wide.is_empty() || wide.len() > capacity as usize {
                    return Err(failed("name output capacity"));
                }
                unsafe {
                    std::ptr::copy_nonoverlapping(wide.as_ptr(), name, wide.len());
                    put(length, wide.len() as u32)?;
                    put(out, stat)
                }
            }
        }
    })
}
#[no_mangle]
pub extern "C" fn lf_capture() -> i32 {
    call(|s| s.capture())
}
#[no_mangle]
pub unsafe extern "C" fn lf_captured(
    ptr: *const u16,
    len: u32,
    out: *mut u8,
    capacity: u32,
    length: *mut u32,
) -> i32 {
    call(|s| {
        if out.is_null() || length.is_null() {
            return Err(failed("null captured output"));
        }
        let bytes = s.captured_bytes(&unsafe { path(ptr, len) }?)?;
        if bytes.len() > capacity as usize {
            return Err(failed("captured output capacity"));
        }
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, bytes.len());
            put(length, bytes.len() as u32)
        }
    })
}
#[no_mangle]
pub extern "C" fn lf_release_capture() -> i32 {
    call(|s| s.release_capture())
}
#[no_mangle]
pub unsafe extern "C" fn lf_commit_scoped(scope: u32, changed: *mut u32) -> i32 {
    let mut admitted = None;
    let status = call(|s| {
        if changed.is_null() {
            return Err(failed("null commit output"));
        }
        admitted = Some(s.begin_commit(CommitScope::try_from(scope)?)?);
        Ok(())
    });
    if status != 0 {
        return status;
    }
    // Own the entire result while the Session lock is released. File callbacks
    // may run on the same bound Workspace; close/another Commit cannot steal it.
    let mut completion = Some(admitted.expect("successful admission").run());
    let status = call(|s| {
        let value = s.complete_commit(completion.take().expect("one completion"))?;
        unsafe { put(changed, u32::from(value)) }
    });
    if let Some(original) = completion {
        // An unrelated callback may already have retained an unknown outcome.
        // Do not let that latch silently drop this independently completed work.
        let mut original = Some(original);
        if let Ok(mut slot) = SESSION.get_or_init(|| Mutex::new(None)).lock() {
            if let Some(session) = slot.as_mut() {
                session.retain_completion(original.take().expect("one original"));
            }
        }
        if let Some(kept) = original {
            std::mem::forget(kept);
        }
    }
    status
}
#[no_mangle]
pub unsafe extern "C" fn lf_committed(
    index: u32,
    ptr: *const u16,
    len: u32,
    out: *mut u8,
    capacity: u32,
    length: *mut u32,
) -> i32 {
    call(|s| {
        if out.is_null() || length.is_null() {
            return Err(failed("null Commit read output"));
        }
        let bytes = s.committed_bytes(index as usize, &unsafe { path(ptr, len) }?)?;
        if bytes.len() > capacity as usize {
            return Err(failed("Commit read output capacity"));
        }
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, bytes.len());
            put(length, bytes.len() as u32)
        }
    })
}
#[no_mangle]
pub unsafe extern "C" fn lf_published_byte(ptr: *const u16, len: u32, out: *mut u32) -> i32 {
    call(|s| unsafe { put(out, u32::from(s.published_byte(&path(ptr, len)?)?)) })
}
#[no_mangle]
pub unsafe extern "C" fn lf_latest_byte(ptr: *const u16, len: u32, out: *mut u32) -> i32 {
    call(|s| {
        let bytes = s.committed_bytes(s.latest_commit_index()?, &unsafe { path(ptr, len) }?)?;
        let byte = *bytes
            .first()
            .ok_or_else(|| failed("empty latest snapshot"))?;
        unsafe { put(out, u32::from(byte)) }
    })
}
#[no_mangle]
pub unsafe extern "C" fn lf_frontier(
    captured: *mut u64,
    revision: *mut i64,
    active: *mut u64,
) -> i32 {
    call(|s| {
        if captured.is_null() || revision.is_null() || active.is_null() {
            return Err(failed("null frontier output"));
        }
        let state = s.frontier()?;
        unsafe {
            put(
                captured,
                state.captured.map(|g| g.number() as u64).unwrap_or(0),
            )?;
            put(revision, state.revision)?;
            put(active, state.active.number() as u64)
        }
    })
}
#[no_mangle]
pub extern "C" fn lf_observe() -> i32 {
    call(|s| s.observe())
}
#[no_mangle]
pub unsafe extern "C" fn lf_close_state(out: *mut CloseState) -> i32 {
    call(|s| unsafe { put(out, s.close_state()) })
}
#[no_mangle]
pub extern "C" fn lf_cleanup(handle: u64) -> i32 {
    callback(|s| s.cleanup_file(handle))
}
#[no_mangle]
pub unsafe extern "C" fn lf_coordinate_begin(token: *mut u64) -> i32 {
    call(|s| {
        if token.is_null() {
            return Err(failed("null coordination token"));
        }
        let value = s.begin_close_coordination()?;
        unsafe { put(token, value) }
    })
}
#[no_mangle]
pub unsafe extern "C" fn lf_coordinate_next(
    token: u64,
    after: u64,
    handle: *mut u64,
    serial: *mut u64,
    name: *mut u16,
    capacity: u32,
    length: *mut u32,
) -> i32 {
    call(|s| {
        if handle.is_null() || serial.is_null() || name.is_null() || length.is_null() {
            return Err(failed("null coordination output"));
        }
        match s.next_close_candidate(token, after)? {
            None => unsafe { put(length, 0) },
            Some((id, inode, path)) => {
                let wide: Vec<u16> = path.encode_utf16().collect();
                if wide.len() >= capacity as usize {
                    return Err(crate::native_overlay::refused(
                        0x80000011,
                        "coordination name capacity",
                    ));
                }
                // Host owns the writable UTF16 span, including the terminal NUL.
                unsafe {
                    std::ptr::copy_nonoverlapping(wide.as_ptr(), name, wide.len());
                    name.add(wide.len()).write(0);
                    put(handle, id)?;
                    put(serial, inode)?;
                    put(length, wide.len() as u32)
                }
            }
        }
    })
}
#[no_mangle]
pub extern "C" fn lf_coordinate_end(token: u64, prepare: u32) -> i32 {
    call(|s| s.end_close_coordination(token, prepare != 0))
}
#[no_mangle]
pub extern "C" fn lf_prepare_close() -> i32 {
    call(|s| s.prepare_close())
}
#[no_mangle]
pub extern "C" fn lf_finish() -> i32 {
    let status = call(|s| s.finish());
    if status == 0 {
        if let Ok(mut slot) = SESSION.get_or_init(|| Mutex::new(None)).lock() {
            *slot = None;
        }
    }
    status
}
