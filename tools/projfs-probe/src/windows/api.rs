//! Load only the OS component; no static ProjFS import can prevent a clean refusal.
use std::ffi::c_void;
use std::ptr::{null, null_mut};
use windows_sys::core::{GUID, HRESULT, PCWSTR};
use windows_sys::Win32::Foundation::{FreeLibrary, HMODULE};
use windows_sys::Win32::Storage::ProjectedFileSystem::*;
use windows_sys::Win32::System::LibraryLoader::{
    GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_SYSTEM32,
};

pub enum ProbeError {
    Unavailable(String),
    Failed(String),
}
impl std::fmt::Display for ProbeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unavailable(s) => write!(f, "Unavailable: {s}"),
            Self::Failed(s) => write!(f, "Failed: {s}"),
        }
    }
}
impl std::fmt::Debug for ProbeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Display::fmt(self, f)
    }
}
pub type Result<T> = std::result::Result<T, ProbeError>;
pub fn failed(e: impl std::fmt::Display) -> ProbeError {
    ProbeError::Failed(e.to_string())
}
pub fn hr(value: HRESULT, label: &str) -> Result<()> {
    if value < 0 {
        Err(failed(format!("{label}: HRESULT 0x{:08x}", value as u32)))
    } else {
        Ok(())
    }
}

type Mark = unsafe extern "system" fn(
    PCWSTR,
    PCWSTR,
    *const PRJ_PLACEHOLDER_VERSION_INFO,
    *const GUID,
) -> HRESULT;
type Start = unsafe extern "system" fn(
    PCWSTR,
    *const PRJ_CALLBACKS,
    *const c_void,
    *const PRJ_STARTVIRTUALIZING_OPTIONS,
    *mut PRJ_NAMESPACE_VIRTUALIZATION_CONTEXT,
) -> HRESULT;
type Stop = unsafe extern "system" fn(PRJ_NAMESPACE_VIRTUALIZATION_CONTEXT);
type Placeholder = unsafe extern "system" fn(
    PRJ_NAMESPACE_VIRTUALIZATION_CONTEXT,
    PCWSTR,
    *const PRJ_PLACEHOLDER_INFO,
    u32,
) -> HRESULT;
type Data = unsafe extern "system" fn(
    PRJ_NAMESPACE_VIRTUALIZATION_CONTEXT,
    *const GUID,
    *const c_void,
    u64,
    u32,
) -> HRESULT;
type Allocate =
    unsafe extern "system" fn(PRJ_NAMESPACE_VIRTUALIZATION_CONTEXT, usize) -> *mut c_void;
type Release = unsafe extern "system" fn(*const c_void);
type Fill = unsafe extern "system" fn(
    PCWSTR,
    *const PRJ_FILE_BASIC_INFO,
    PRJ_DIR_ENTRY_BUFFER_HANDLE,
) -> HRESULT;
type Matches = unsafe extern "system" fn(PCWSTR, PCWSTR) -> bool;
type Compare = unsafe extern "system" fn(PCWSTR, PCWSTR) -> i32;
type Info = unsafe extern "system" fn(
    PRJ_NAMESPACE_VIRTUALIZATION_CONTEXT,
    *mut PRJ_VIRTUALIZATION_INSTANCE_INFO,
) -> HRESULT;
type State = unsafe extern "system" fn(PCWSTR, *mut PRJ_FILE_STATE) -> HRESULT;

struct Library(HMODULE);
impl Drop for Library {
    fn drop(&mut self) {
        // Owned LoadLibrary reference; called only after all namespace callbacks drain.
        unsafe {
            FreeLibrary(self.0);
        }
    }
}
pub(super) struct Api {
    _library: Library,
    pub mark: Mark,
    pub start: Start,
    pub stop: Stop,
    pub placeholder: Placeholder,
    pub data: Data,
    pub allocate: Allocate,
    pub release: Release,
    pub fill: Fill,
    pub matches: Matches,
    pub compare: Compare,
    pub info: Info,
    pub state: State,
}
impl Api {
    pub fn load() -> Result<Self> {
        let name: Vec<u16> = "ProjectedFSLib.dll\0".encode_utf16().collect();
        // Search System32 only, never cwd/PATH. The owned handle outlives every function pointer.
        let raw =
            unsafe { LoadLibraryExW(name.as_ptr(), null_mut(), LOAD_LIBRARY_SEARCH_SYSTEM32) };
        if raw.is_null() {
            return Err(ProbeError::Unavailable(format!(
                "Client-ProjFS cannot be loaded from System32: {}",
                std::io::Error::last_os_error()
            )));
        }
        let library = Library(raw);
        macro_rules! symbol {
            ($name:literal, $ty:ty) => {{
                // Exact exported SDK signature from the pinned windows-sys binding.
                let address = unsafe { GetProcAddress(raw, concat!($name, "\0").as_ptr()) }
                    .ok_or_else(|| {
                        ProbeError::Unavailable(concat!("missing ProjFS export: ", $name).into())
                    })?;
                unsafe { std::mem::transmute::<unsafe extern "system" fn() -> isize, $ty>(address) }
            }};
        }
        Ok(Self {
            mark: symbol!("PrjMarkDirectoryAsPlaceholder", Mark),
            start: symbol!("PrjStartVirtualizing", Start),
            stop: symbol!("PrjStopVirtualizing", Stop),
            placeholder: symbol!("PrjWritePlaceholderInfo", Placeholder),
            data: symbol!("PrjWriteFileData", Data),
            allocate: symbol!("PrjAllocateAlignedBuffer", Allocate),
            release: symbol!("PrjFreeAlignedBuffer", Release),
            fill: symbol!("PrjFillDirEntryBuffer", Fill),
            matches: symbol!("PrjFileNameMatch", Matches),
            compare: symbol!("PrjFileNameCompare", Compare),
            info: symbol!("PrjGetVirtualizationInstanceInfo", Info),
            state: symbol!("PrjGetOnDiskFileState", State),
            _library: library,
        })
    }
}
pub(super) fn wide(path: &std::path::Path) -> Result<Vec<u16>> {
    use std::os::windows::ffi::OsStrExt;
    let mut value: Vec<u16> = path.as_os_str().encode_wide().collect();
    if value.contains(&0) {
        return Err(failed("path contains NUL"));
    }
    value.push(0);
    Ok(value)
}
pub(super) const NOT_FOUND: HRESULT = 0x80070002u32 as i32;
pub(super) const INVALID: HRESULT = 0x80070057u32 as i32;
pub(super) const UNEXPECTED: HRESULT = 0x8000ffffu32 as i32;
pub(super) const NO_MEMORY: HRESULT = 0x8007000eu32 as i32;
pub(super) const BUFFER_FULL: HRESULT = 0x8007007au32 as i32;
pub(super) fn empty_path() -> PCWSTR {
    null()
}
