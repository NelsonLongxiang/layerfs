//! Callbacks for a fixture or fixed Store root; state lives through Stop.
use super::api::{Api, BUFFER_FULL, INVALID, NOT_FOUND, NO_MEMORY, UNEXPECTED};
use crate::{read_window, saved::Entry, source::Source};
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use windows_sys::core::{GUID, HRESULT, PCWSTR};
use windows_sys::Win32::Storage::FileSystem::{
    FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_READONLY,
};
use windows_sys::Win32::Storage::ProjectedFileSystem::*;

struct Enumeration {
    entries: Vec<(Vec<u16>, PRJ_FILE_BASIC_INFO)>,
    at: usize,
}
pub(super) struct State {
    pub api: Api,
    pub source: Mutex<Source>,
    pub readonly: bool,
    enums: Mutex<HashMap<u128, Enumeration>>,
    pub notifications: Mutex<Vec<(i32, String, String)>>,
    pub first_error: Mutex<Option<String>>,
    pub enumeration_calls: AtomicU64,
    pub placeholder_calls: AtomicU64,
    pub read_calls: AtomicU64,
    pub read_bytes: AtomicU64,
    pub callback_panics: AtomicU64,
    pub notification_overflow: AtomicU64,
}
impl State {
    pub fn new(api: Api, source: Source) -> Self {
        fn assert_send<T: Send>() {}
        assert_send::<Source>(); // callback threads share it only through this Mutex
        let readonly = matches!(source, Source::Saved(_));
        Self {
            api,
            source: Mutex::new(source),
            readonly,
            enums: Mutex::new(HashMap::new()),
            notifications: Mutex::new(Vec::new()),
            first_error: Mutex::new(None),
            enumeration_calls: AtomicU64::new(0),
            placeholder_calls: AtomicU64::new(0),
            read_calls: AtomicU64::new(0),
            read_bytes: AtomicU64::new(0),
            callback_panics: AtomicU64::new(0),
            notification_overflow: AtomicU64::new(0),
        }
    }
    fn fail(&self, error: impl std::fmt::Display) -> HRESULT {
        if let Ok(mut slot) = self.first_error.lock() {
            if slot.is_none() {
                *slot = Some(error.to_string());
            }
        }
        UNEXPECTED
    }
    fn basic(&self, entry: &Entry) -> Result<PRJ_FILE_BASIC_INFO, String> {
        Ok(PRJ_FILE_BASIC_INFO {
            IsDirectory: entry.directory,
            FileSize: i64::try_from(entry.size).map_err(|_| "file too large for ProjFS")?,
            FileAttributes: if entry.directory {
                FILE_ATTRIBUTE_DIRECTORY
            } else if self.readonly {
                FILE_ATTRIBUTE_READONLY
            } else {
                FILE_ATTRIBUTE_NORMAL
            },
            ..Default::default()
        })
    }
}
fn guid_key(g: &GUID) -> u128 {
    ((g.data1 as u128) << 96)
        | ((g.data2 as u128) << 80)
        | ((g.data3 as u128) << 64)
        | u64::from_be_bytes(g.data4) as u128
}
/// OS callback pointers are valid for the call. The immovable State and its
/// synchronized fields outlive every callback; Stop completes before drop.
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
            state.fail("callback panic")
        }
    }
}
unsafe fn path_text(path: PCWSTR) -> Result<String, String> {
    if path.is_null() {
        return Err("missing callback path".into());
    }
    let mut len = 0;
    while len < 32768 && *path.add(len) != 0 {
        len += 1;
    }
    if len == 32768 {
        return Err("callback path too long".into());
    }
    // This diagnostic refuses non-UTF-8 names instead of collapsing two names.
    String::from_utf16(std::slice::from_raw_parts(path, len))
        .map(|s| s.replace('\\', "/"))
        .map_err(|_| "diagnostic refuses unpaired surrogate path".into())
}
unsafe extern "system" fn start_enum(data: *const PRJ_CALLBACK_DATA, id: *const GUID) -> HRESULT {
    call(data, |d, s| {
        if id.is_null() {
            return INVALID;
        }
        let path = match path_text(d.FilePathName) {
            Ok(p) => p,
            Err(e) => return s.fail(e),
        };
        let listed = match s.source.lock() {
            Ok(mut source) => source.list(&path),
            Err(e) => return s.fail(e),
        };
        let listed = match listed {
            Ok(v) => v,
            Err(e) => return s.fail(e),
        };
        let mut entries = Vec::with_capacity(listed.len());
        for entry in listed {
            let basic = match s.basic(&entry) {
                Ok(v) => v,
                Err(e) => return s.fail(e),
            };
            entries.push((
                entry.name.encode_utf16().chain([0]).collect::<Vec<_>>(),
                basic,
            ));
        }
        entries.sort_by(|(a, _), (b, _)| (s.api.compare)(a.as_ptr(), b.as_ptr()).cmp(&0));
        if entries
            .windows(2)
            .any(|w| (s.api.compare)(w[0].0.as_ptr(), w[1].0.as_ptr()) == 0)
        {
            return s.fail("two Store names collide in ProjFS ordering");
        }
        let Ok(mut sessions) = s.enums.lock() else {
            return UNEXPECTED;
        };
        sessions.insert(guid_key(&*id), Enumeration { entries, at: 0 });
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
        let Some(session) = sessions.get_mut(&guid_key(&*id)) else {
            return INVALID;
        };
        if d.Flags & PRJ_CB_DATA_FLAG_ENUM_RESTART_SCAN != 0 {
            session.at = 0;
        }
        s.enumeration_calls.fetch_add(1, Ordering::Relaxed);
        while let Some((name, basic)) = session.entries.get(session.at) {
            if !search.is_null() && !(s.api.matches)(name.as_ptr(), search) {
                session.at += 1;
                continue;
            }
            let result = (s.api.fill)(name.as_ptr(), basic, buffer);
            if result == BUFFER_FULL {
                return 0;
            } // resume this exact entry next call
            if result < 0 {
                return result;
            }
            session.at += 1;
            if d.Flags & PRJ_CB_DATA_FLAG_ENUM_RETURN_SINGLE_ENTRY != 0 {
                break;
            }
        }
        0
    })
}
unsafe extern "system" fn placeholder(data: *const PRJ_CALLBACK_DATA) -> HRESULT {
    call(data, |d, s| {
        let path = match path_text(d.FilePathName) {
            Ok(p) => p,
            Err(e) => return s.fail(e),
        };
        let source = match s.source.lock() {
            Ok(v) => v,
            Err(e) => return s.fail(e),
        };
        let entry = match source.entry(&path) {
            Ok(Some(e)) => e,
            Ok(None) => return NOT_FOUND,
            Err(e) => return s.fail(e),
        };
        let basic = match s.basic(&entry) {
            Ok(v) => v,
            Err(e) => return s.fail(e),
        };
        let mut info = PRJ_PLACEHOLDER_INFO {
            FileBasicInfo: basic,
            ..Default::default()
        };
        info.VersionInfo.ProviderID[0] = 1;
        if let Some(saved) = source.store() {
            info.VersionInfo.ContentID[..32].copy_from_slice(saved.root.as_bytes());
        } else {
            info.VersionInfo.ContentID[0] = 1;
        }
        drop(source);
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
        let path = match path_text(d.FilePathName) {
            Ok(p) => p,
            Err(e) => return s.fail(e),
        };
        let mut source = match s.source.lock() {
            Ok(v) => v,
            Err(e) => return s.fail(e),
        };
        let entry = match source.entry(&path) {
            Ok(Some(e)) if !e.directory => e,
            Ok(_) => return NOT_FOUND,
            Err(e) => return s.fail(e),
        };
        let size = match usize::try_from(entry.size) {
            Ok(v) => v,
            Err(_) => return INVALID,
        };
        let mut info = PRJ_VIRTUALIZATION_INSTANCE_INFO::default();
        let result = (s.api.info)(d.NamespaceVirtualizationContext, &mut info);
        if result < 0 {
            return result;
        }
        let Some((mut begin, end)) = read_window(offset, length, size, info.WriteAlignment) else {
            return INVALID;
        };
        let unit = info.WriteAlignment as usize;
        let window = (1024 * 1024 / unit) * unit;
        if window == 0 {
            return INVALID;
        }
        while begin < end {
            let count = window.min(end - begin);
            let bytes = match source.read(&path, begin as u64, count as u32) {
                Ok(v) => v,
                Err(e) => return s.fail(e),
            };
            if bytes.len() != count {
                return s.fail("source range length mismatch");
            }
            let buffer = (s.api.allocate)(d.NamespaceVirtualizationContext, count);
            if buffer.is_null() {
                return NO_MEMORY;
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), buffer as *mut u8, count);
            let result = (s.api.data)(
                d.NamespaceVirtualizationContext,
                &d.DataStreamId,
                buffer,
                begin as u64,
                count as u32,
            );
            (s.api.release)(buffer);
            if result < 0 {
                return result;
            }
            s.read_bytes.fetch_add(count as u64, Ordering::Relaxed);
            begin += count;
        }
        s.read_calls.fetch_add(1, Ordering::Relaxed);
        0
    })
}
unsafe extern "system" fn query(data: *const PRJ_CALLBACK_DATA) -> HRESULT {
    call(data, |d, s| {
        let path = match path_text(d.FilePathName) {
            Ok(p) => p,
            Err(e) => return s.fail(e),
        };
        match s.source.lock() {
            Ok(source) => match source.entry(&path) {
                Ok(Some(_)) => 0,
                Ok(None) => NOT_FOUND,
                Err(e) => s.fail(e),
            },
            Err(e) => s.fail(e),
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
        let path = match path_text(d.FilePathName) {
            Ok(p) => p,
            Err(e) => return s.fail(e),
        };
        let dest = if destination.is_null() {
            String::new()
        } else {
            match path_text(destination) {
                Ok(p) => p,
                Err(e) => return s.fail(e),
            }
        };
        let Ok(mut events) = s.notifications.lock() else {
            return UNEXPECTED;
        };
        if events.len() >= 1024 {
            s.notification_overflow.fetch_add(1, Ordering::Relaxed);
        } else {
            events.push((kind, path, dest));
        }
        if s.readonly
            && matches!(
                kind,
                PRJ_NOTIFICATION_PRE_DELETE
                    | PRJ_NOTIFICATION_PRE_RENAME
                    | PRJ_NOTIFICATION_PRE_SET_HARDLINK
                    | PRJ_NOTIFICATION_FILE_PRE_CONVERT_TO_FULL
            )
        {
            return 0x80070005u32 as i32; // before-effect access denied, never write Store
        }
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
