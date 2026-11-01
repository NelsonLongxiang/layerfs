//! OS file-view and range-lock probes. No production unsafe allowance changes.
use super::api::{failed, Result};
use std::fs::File;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::ptr::null;
use windows_sys::Win32::Storage::FileSystem::{
    LockFileEx, UnlockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
};
use windows_sys::Win32::System::Memory::{
    CreateFileMappingW, MapViewOfFile, UnmapViewOfFile, FILE_MAP_READ, FILE_MAP_WRITE,
    MEMORY_MAPPED_VIEW_ADDRESS, PAGE_READONLY, PAGE_READWRITE,
};
use windows_sys::Win32::System::IO::OVERLAPPED;

pub(super) const LENGTH: usize = 4096;
pub(super) struct View {
    address: MEMORY_MAPPED_VIEW_ADDRESS,
    writable: bool,
}
impl View {
    pub fn open(file: &File, writable: bool) -> Result<Self> {
        if file.metadata().map_err(failed)?.len() < LENGTH as u64 {
            return Err(failed("mapping fixture shorter than one page"));
        }
        // File is valid and remains open throughout creation; null name makes the
        // section unnamed, with no name-based discovery (views of the same local
        // file remain coherent across processes).
        let raw = unsafe {
            CreateFileMappingW(
                file.as_raw_handle(),
                null(),
                if writable {
                    PAGE_READWRITE
                } else {
                    PAGE_READONLY
                },
                0,
                0,
                null(),
            )
        };
        if raw.is_null() {
            return Err(failed(std::io::Error::last_os_error()));
        }
        // Adopt exactly this new handle; MapView retains the section independently.
        let mapping = unsafe { OwnedHandle::from_raw_handle(raw) };
        let address = unsafe {
            MapViewOfFile(
                mapping.as_raw_handle(),
                if writable {
                    FILE_MAP_WRITE
                } else {
                    FILE_MAP_READ
                },
                0,
                0,
                LENGTH,
            )
        };
        if address.Value.is_null() {
            return Err(failed(std::io::Error::last_os_error()));
        }
        drop(mapping); // child retains neither the mapping handle nor, later, the File
        Ok(Self { address, writable })
    }
    pub fn byte(&self) -> u8 {
        // Valid first byte of the live view. No Rust reference aliases mapped storage;
        // cross-process writes are sequenced by the external test handshake.
        unsafe { std::ptr::read_volatile(self.address.Value.cast::<u8>()) }
    }
    pub fn set(&mut self, value: u8) -> Result<()> {
        if !self.writable {
            return Err(failed("write to read-only diagnostic view"));
        }
        // One-byte in-bounds store; only this process writes and the handshake places
        // the observer after it. No FlushViewOfFile/fsync or durability claim.
        unsafe {
            std::ptr::write_volatile(self.address.Value.cast::<u8>(), value);
        }
        if self.byte() != value {
            return Err(failed("mapped byte did not change"));
        }
        Ok(())
    }
    pub fn close(mut self) -> Result<()> {
        let address = std::mem::take(&mut self.address);
        // Unmap this sole owned view exactly once; failure is surfaced, never retried.
        if unsafe { UnmapViewOfFile(address) } == 0 {
            return Err(failed(std::io::Error::last_os_error()));
        }
        Ok(())
    }
}
impl Drop for View {
    fn drop(&mut self) {
        if !self.address.Value.is_null() {
            // Error cleanup only: the OS also releases views on this child exiting.
            if unsafe { UnmapViewOfFile(self.address) } == 0 {
                eprintln!(
                    "mapping cleanup failed: {}",
                    std::io::Error::last_os_error()
                );
            }
        }
    }
}
pub(super) fn lock(file: &File) -> Result<()> {
    let mut overlapped = OVERLAPPED::default();
    // Synchronous File and FAIL_IMMEDIATELY mean no deferred OVERLAPPED lifetime.
    if unsafe {
        LockFileEx(
            file.as_raw_handle(),
            LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
            0,
            LENGTH as u32,
            0,
            &mut overlapped,
        )
    } == 0
    {
        return Err(failed(std::io::Error::last_os_error()));
    }
    Ok(())
}
pub(super) fn unlock(file: &File) -> Result<()> {
    let mut overlapped = OVERLAPPED::default();
    // Same handle, exact offset 0/length as the one successful lock.
    if unsafe { UnlockFileEx(file.as_raw_handle(), 0, LENGTH as u32, 0, &mut overlapped) } == 0 {
        return Err(failed(std::io::Error::last_os_error()));
    }
    Ok(())
}
