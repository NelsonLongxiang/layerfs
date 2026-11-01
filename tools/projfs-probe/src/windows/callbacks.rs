//! Callbacks for exactly one immutable file; all context dies after Stop returns.
use super::api::{Api, BUFFER_FULL, INVALID, NOT_FOUND, NO_MEMORY, UNEXPECTED};
use crate::{read_window, NAME};
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use windows_sys::core::{GUID, HRESULT, PCWSTR};
use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL;
use windows_sys::Win32::Storage::ProjectedFileSystem::*;

pub(super) struct State {
    pub api: Api,
    pub content: Vec<u8>,
    pub name: Vec<u16>,
    pub enums: Mutex<HashMap<u128, bool>>,
    pub notifications: Mutex<Vec<(i32, String, String)>>,
    pub enumeration_calls: AtomicU64,
    pub placeholder_calls: AtomicU64,
    pub read_calls: AtomicU64,
    pub read_bytes: AtomicU64,
    pub callback_panics: AtomicU64,
    pub notification_overflow: AtomicU64,
}
impl State {
    pub fn new(api: Api, content: Vec<u8>) -> Self {
        Self {
            api,
            content,
            name: NAME.encode_utf16().chain([0]).collect(),
            enums: Mutex::new(HashMap::new()),
            notifications: Mutex::new(Vec::new()),
            enumeration_calls: AtomicU64::new(0),
            placeholder_calls: AtomicU64::new(0),
            read_calls: AtomicU64::new(0),
            read_bytes: AtomicU64::new(0),
            callback_panics: AtomicU64::new(0),
            notification_overflow: AtomicU64::new(0),
        }
    }
    fn basic(&self) -> PRJ_FILE_BASIC_INFO {
        PRJ_FILE_BASIC_INFO {
            FileSize: self.content.len() as i64,
            FileAttributes: FILE_ATTRIBUTE_NORMAL,
            ..Default::default()
        }
    }
    fn is_file(&self, path: PCWSTR) -> bool {
        !path.is_null() && unsafe { (self.api.compare)(path, self.name.as_ptr()) == 0 }
    }
}
fn guid_key(g: &GUID) -> u128 {
    ((g.data1 as u128) << 96)
        | ((g.data2 as u128) << 80)
        | ((g.data3 as u128) << 64)
        | u64::from_be_bytes(g.data4) as u128
}
/// ProjFS owns callback pointers for the duration of the call. Context points
/// to an immovable Box<State>; its fields use atomics/locks; Stop drains users.
unsafe fn call(
    data: *const PRJ_CALLBACK_DATA,
    f: impl FnOnce(&PRJ_CALLBACK_DATA, &State) -> HRESULT,
) -> HRESULT {
    let Some(data) = data.as_ref() else {
        return INVALID;
    };
    let Some(state) = (data.InstanceContext as *const State).as_ref() else {
        return INVALID;
    };
    match catch_unwind(AssertUnwindSafe(|| f(data, state))) {
        Ok(result) => result,
        Err(_) => {
            state.callback_panics.fetch_add(1, Ordering::Relaxed);
            UNEXPECTED
        }
    }
}
unsafe fn path_text(path: PCWSTR) -> String {
    if path.is_null() {
        return String::new();
    }
    // SDK promises a nul-terminated path; keep the diagnostic copy bounded.
    let mut len = 0;
    while len < 32768 && *path.add(len) != 0 {
        len += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(path, len))
}
unsafe extern "system" fn start_enum(data: *const PRJ_CALLBACK_DATA, id: *const GUID) -> HRESULT {
    call(data, |d, s| {
        if id.is_null() || d.FilePathName.is_null() {
            return INVALID;
        }
        if *d.FilePathName != 0 {
            return NOT_FOUND;
        }
        let Ok(mut sessions) = s.enums.lock() else {
            return UNEXPECTED;
        };
        sessions.insert(guid_key(&*id), false);
        0
    })
}
unsafe extern "system" fn end_enum(data: *const PRJ_CALLBACK_DATA, id: *const GUID) -> HRESULT {
    call(data, |_, s| {
        if id.is_null() {
            return INVALID;
        }
        let Ok(mut sessions) = s.enums.lock() else {
            return UNEXPECTED;
        };
        sessions.remove(&guid_key(&*id));
        0
    })
}
unsafe extern "system" fn get_enum(
    data: *const PRJ_CALLBACK_DATA,
    id: *const GUID,
    search: PCWSTR,
    buffer: PRJ_DIR_ENTRY_BUFFER_HANDLE,
) -> HRESULT {
    call(data, |d, s| {
        if id.is_null() || buffer.is_null() {
            return INVALID;
        }
        let Ok(mut sessions) = s.enums.lock() else {
            return UNEXPECTED;
        };
        let Some(done) = sessions.get_mut(&guid_key(&*id)) else {
            return INVALID;
        };
        if d.Flags & PRJ_CB_DATA_FLAG_ENUM_RESTART_SCAN != 0 {
            *done = false;
        }
        s.enumeration_calls.fetch_add(1, Ordering::Relaxed);
        if *done {
            return 0;
        }
        if !search.is_null() && !(s.api.matches)(s.name.as_ptr(), search) {
            *done = true;
            return 0;
        }
        let result = (s.api.fill)(s.name.as_ptr(), &s.basic(), buffer);
        // A full OS buffer is a continuation, not permission to lose the entry.
        if result == BUFFER_FULL {
            return 0;
        }
        if result >= 0 {
            *done = true;
        }
        result
    })
}
unsafe extern "system" fn placeholder(data: *const PRJ_CALLBACK_DATA) -> HRESULT {
    call(data, |d, s| {
        if !s.is_file(d.FilePathName) {
            return NOT_FOUND;
        }
        let mut info = PRJ_PLACEHOLDER_INFO {
            FileBasicInfo: s.basic(),
            ..Default::default()
        };
        info.VersionInfo.ProviderID[0] = 1;
        info.VersionInfo.ContentID[0] = 1;
        s.placeholder_calls.fetch_add(1, Ordering::Relaxed);
        (s.api.placeholder)(
            d.NamespaceVirtualizationContext,
            d.FilePathName,
            &info,
            std::mem::size_of::<PRJ_PLACEHOLDER_INFO>() as u32,
        )
    })
}
unsafe extern "system" fn file_data(
    data: *const PRJ_CALLBACK_DATA,
    offset: u64,
    length: u32,
) -> HRESULT {
    call(data, |d, s| {
        if !s.is_file(d.FilePathName) {
            return NOT_FOUND;
        }
        let mut info = PRJ_VIRTUALIZATION_INSTANCE_INFO::default();
        let result = (s.api.info)(d.NamespaceVirtualizationContext, &mut info);
        if result < 0 {
            return result;
        }
        let Some((begin, end)) = read_window(offset, length, s.content.len(), info.WriteAlignment)
        else {
            return INVALID;
        };
        if begin == end {
            return 0;
        }
        let count = end - begin;
        let buffer = (s.api.allocate)(d.NamespaceVirtualizationContext, count);
        if buffer.is_null() {
            return NO_MEMORY;
        }
        // Aligned allocation is count bytes; the checked range is inside content.
        std::ptr::copy_nonoverlapping(s.content[begin..end].as_ptr(), buffer as *mut u8, count);
        let result = (s.api.data)(
            d.NamespaceVirtualizationContext,
            &d.DataStreamId,
            buffer,
            begin as u64,
            count as u32,
        );
        (s.api.release)(buffer);
        if result >= 0 {
            s.read_calls.fetch_add(1, Ordering::Relaxed);
            s.read_bytes.fetch_add(count as u64, Ordering::Relaxed);
        }
        result
    })
}
unsafe extern "system" fn query(data: *const PRJ_CALLBACK_DATA) -> HRESULT {
    call(data, |d, s| {
        if s.is_file(d.FilePathName) {
            0
        } else {
            NOT_FOUND
        }
    })
}
unsafe extern "system" fn notification(
    data: *const PRJ_CALLBACK_DATA,
    _directory: bool,
    kind: PRJ_NOTIFICATION,
    destination: PCWSTR,
    _parameters: *mut PRJ_NOTIFICATION_PARAMETERS,
) -> HRESULT {
    call(data, |d, s| {
        let Ok(mut events) = s.notifications.lock() else {
            return UNEXPECTED;
        };
        if events.len() >= 1024 {
            s.notification_overflow.fetch_add(1, Ordering::Relaxed);
        } else {
            events.push((kind, path_text(d.FilePathName), path_text(destination)));
        }
        // A diagnostic observes; it must not pretend this is Overlay persistence.
        0
    })
}
pub(super) fn table() -> PRJ_CALLBACKS {
    PRJ_CALLBACKS {
        StartDirectoryEnumerationCallback: Some(start_enum),
        EndDirectoryEnumerationCallback: Some(end_enum),
        GetDirectoryEnumerationCallback: Some(get_enum),
        GetPlaceholderInfoCallback: Some(placeholder),
        GetFileDataCallback: Some(file_data),
        QueryFileNameCallback: Some(query),
        NotificationCallback: Some(notification),
        CancelCommandCallback: None,
    }
}
