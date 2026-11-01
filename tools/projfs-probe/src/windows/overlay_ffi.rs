//! Narrow C ABI for the diagnostic native host. Unsafe never leaves windows/.
use crate::native_overlay::{failed, Error, Session, Stat};
use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
};
static SESSION: OnceLock<Mutex<Option<Session>>> = OnceLock::new();
static RETAINED: AtomicBool = AtomicBool::new(false);
fn call(action: impl FnOnce(&mut Session) -> Result<(), Error>) -> i32 {
    // ponytail: serializes this diagnostic across callbacks/control, not the
    // product owner lock. Replace with request-local ownership before production.
    let result = catch_unwind(AssertUnwindSafe(|| {
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
    }));
    match result {
        Ok(Ok(())) => 0,
        Ok(Err(e)) => {
            eprintln!("OVERLAY_REFUSAL {:08x}: {}", e.status as u32, e.detail);
            e.status
        }
        Err(_) => {
            RETAINED.store(true, Ordering::Release);
            eprintln!("OVERLAY_PANIC retained; no replay");
            0xc0000001u32 as i32
        }
    }
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
        *slot = Some(Session::create(&root)?);
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
        *slot = Some(Session::reopen(Path::new(&store), &work)?);
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
pub unsafe extern "C" fn lf_stat(ptr: *const u16, len: u32, out: *mut Stat) -> i32 {
    call(|s| unsafe { put(out, s.stat_path(&path(ptr, len)?)?) })
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
    call(|s| {
        if handle.is_null() || out.is_null() {
            return Err(failed("null open outputs"));
        }
        let name = unsafe { path(ptr, len) }?;
        let (h, stat) = match create {
            0 => s.open(&name, writable != 0)?,
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
pub unsafe extern "C" fn lf_info(handle: u64, out: *mut Stat) -> i32 {
    call(|s| unsafe { put(out, s.stat_handle(handle)?) })
}
#[no_mangle]
pub unsafe extern "C" fn lf_read(
    handle: u64,
    offset: u64,
    out: *mut u8,
    length: u32,
    count: *mut u32,
) -> i32 {
    call(|s| {
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
    call(|s| {
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
pub unsafe extern "C" fn lf_resize(handle: u64, size: u64, out: *mut Stat) -> i32 {
    call(|s| unsafe { put(out, s.resize(handle, size)?) })
}
#[no_mangle]
pub unsafe extern "C" fn lf_rename(
    from: *const u16,
    flen: u32,
    to: *const u16,
    tlen: u32,
    replace: u32,
) -> i32 {
    call(|s| {
        s.rename(
            &unsafe { path(from, flen) }?,
            &unsafe { path(to, tlen) }?,
            replace != 0,
        )
    })
}
#[no_mangle]
pub unsafe extern "C" fn lf_can_delete(ptr: *const u16, len: u32) -> i32 {
    call(|s| s.can_delete(&unsafe { path(ptr, len) }?))
}
#[no_mangle]
pub unsafe extern "C" fn lf_unlink(ptr: *const u16, len: u32) -> i32 {
    call(|s| s.unlink(&unsafe { path(ptr, len) }?))
}
#[no_mangle]
pub extern "C" fn lf_close(handle: u64) -> i32 {
    call(|s| s.close_file(handle))
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
    call(|s| {
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
pub unsafe extern "C" fn lf_commit(changed: *mut u32) -> i32 {
    call(|s| {
        if changed.is_null() {
            return Err(failed("null commit output"));
        }
        let value = s.commit()?;
        unsafe { put(changed, u32::from(value)) }
    })
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
pub extern "C" fn lf_observe() -> i32 {
    call(|s| s.observe())
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
