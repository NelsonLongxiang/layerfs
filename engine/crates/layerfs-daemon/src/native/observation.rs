//! One indexed native-handle observation with a bounded path byte window.
//! This is neither a kernel-reference inventory nor permission to release custody.
use super::{refused, Result, Session};
use std::ops::Bound::{Excluded, Unbounded};
/// Original owner facts at this call. Later windows are new observations, not a
/// pinned snapshot. A caller must not silently stitch changed identities together.
#[derive(Debug, Clone)]
pub struct ReferenceWindow {
    pub handle: u64,
    pub serial: u64,
    pub file: bool,
    pub directory: bool,
    pub lookup: bool,
    pub cleaned: bool,
    pub data_writable: bool,
    pub attributes_writable: bool,
    pub delete_access: bool,
    pub path_length: Option<u64>,
    pub path: Vec<u8>,
    pub next_offset: Option<u64>,
}
impl Session {
    /// Observe the first owned handle after the supplied cursor. Copy at most
    /// 1024 path bytes, without Store I/O, namespace scan, sequence allocation,
    /// admission change or release. No owner is pinned by this observation.
    pub fn reference(&self, after: u64, offset: u64) -> Result<Option<ReferenceWindow>> {
        let Some((&handle, held)) = self
            .inner()
            .handles
            .range((Excluded(after), Unbounded))
            .next()
        else {
            return Ok(None);
        };
        let (path_length, path, next_offset) = if let Some(path) = held.path.as_ref() {
            let bytes = path.as_bytes();
            let start = usize::try_from(offset)
                .ok()
                .filter(|n| *n <= bytes.len())
                .ok_or_else(|| {
                    refused(
                        0xc000000d,
                        "reference path offset is beyond this observed path",
                    )
                })?;
            let end = start.saturating_add(1024).min(bytes.len());
            (
                Some(bytes.len() as u64),
                bytes[start..end].to_vec(),
                (end < bytes.len()).then_some(end as u64),
            )
        } else {
            if offset != 0 {
                return Err(refused(0xc000000d, "reference has no remembered path"));
            }
            (None, Vec::new(), None)
        };
        Ok(Some(ReferenceWindow {
            handle,
            serial: held.serial,
            file: held.file.is_some(),
            directory: held.directory.is_some(),
            lookup: held.lookup,
            cleaned: held.cleaned,
            data_writable: held.data_writable,
            attributes_writable: held.attributes_writable,
            delete_access: held.delete_access,
            path_length,
            path,
            next_offset,
        }))
    }
}
