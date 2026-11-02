//! Native basic information backed by the existing typed Workspace mutation.
use super::{mutation_error, refused, Result, Session, Stat};
use layerfs_workspace::{Operation, Time};
impl Session {
    pub fn overwrite_windows(
        &mut self,
        handle: u64,
        attributes: u32,
        replace: bool,
    ) -> Result<Stat> {
        self.namespace_admission()?;
        if attributes & !0xa7 != 0 {
            return Err(refused(0xc00000bb, "unsupported overwrite attributes"));
        }
        let h = self
            .handles
            .get(&handle)
            .ok_or_else(|| refused(0xc0000008, "stale overwrite handle"))?;
        if !h.data_writable {
            return Err(refused(0xc0000022, "overwrite requires data write access"));
        }
        let file = h
            .file
            .ok_or_else(|| refused(0xc00000ba, "cannot overwrite directory"))?;
        self.with(|m| {
            mutation_error(
                m.apply(Operation::OverwriteWindows {
                    file,
                    attributes: attributes & 0x27,
                    replace,
                })
                .map(|_| ()),
            )
        })?;
        self.publications += 1;
        self.stat_handle(handle)
    }
    pub fn basic_info(&mut self, handle: u64, attributes: u32, times: [u64; 4]) -> Result<Stat> {
        self.namespace_admission()?;
        let [creation, access, write, change] = times;
        let current = self.stat_handle(handle)?;
        let h = self
            .handles
            .get(&handle)
            .ok_or_else(|| refused(0xc0000008, "stale metadata handle"))?;
        if !h.attributes_writable {
            return Err(refused(0xc0000022, "handle lacks write-attributes access"));
        }
        // Unsupported fields are refused before publishing any represented field.
        let attrs = if attributes == u32::MAX {
            None
        } else {
            if attributes & !0xb7 != 0 || attributes & 0x10 != 0 && current.directory == 0 {
                return Err(refused(0xc00000bb, "unrepresented Windows file attributes"));
            }
            Some(attributes & 0x27)
        };
        let old = current
            .mtime
            .checked_add(11644473600)
            .and_then(|v| u64::try_from(v).ok())
            .and_then(|v| v.checked_mul(10_000_000))
            .and_then(|v| v.checked_add(u64::from(current.nanos / 100)));
        let desired = if write == 0 { old } else { Some(write) };
        if [creation, access, change]
            .iter()
            .any(|t| *t != 0 && Some(*t) != desired)
        {
            return Err(refused(
                0xc00000bb,
                "independent creation/access/change time unsupported",
            ));
        }
        let mtime = if write == 0 {
            None
        } else {
            Some(Time {
                seconds: (write / 10_000_000) as i64 - 11644473600,
                nanoseconds: ((write % 10_000_000) * 100) as u32,
            })
        };
        let operation = match h.file {
            Some(file) => Operation::SetOpenWindowsAttributes {
                file,
                attributes: attrs,
                mtime,
            },
            None => Operation::SetWindowsAttributes {
                serial: h.serial,
                attributes: attrs,
                mtime,
            },
        };
        self.with(|m| mutation_error(m.apply(operation).map(|_| ())))?;
        self.publications += 1;
        self.stat_handle(handle)
    }
}
