//! Workspace calls from the already-owned native child, not Store RPC or an SDK.
use super::{
    refused,
    wire::{stat, Fields},
    Result, Session,
};
pub fn dispatch(session: &mut Session, opcode: u32, bytes: &[u8]) -> Result<Vec<u8>> {
    let mut f = Fields::new(bytes);
    let mut out = Vec::new();
    match opcode {
        1 => {
            let p = f.path()?;
            f.end()?;
            stat(&mut out, session.stat_path(&p)?);
        }
        2 => {
            let p = f.path()?;
            let access = f.u32()?;
            f.end()?;
            let (h, s) = session.open_windows(&p, access)?;
            out.extend_from_slice(&h.to_le_bytes());
            stat(&mut out, s);
        }
        3 => {
            let h = f.u64()?;
            f.end()?;
            stat(&mut out, session.stat_handle(h)?);
        }
        4 => {
            let p = f.path()?;
            let directory = f.u32()?;
            let access = f.u32()?;
            let attrs = f.u32()?;
            f.end()?;
            if directory > 1 {
                return Err(refused(0xc000000d, "native create kind"));
            }
            let (h, s) = session.create_native(&p, directory != 0, attrs, access)?;
            out.extend_from_slice(&h.to_le_bytes());
            stat(&mut out, s);
        }
        5 => {
            let h = f.u64()?;
            let offset = f.u64()?;
            let length = f.u32()?;
            f.end()?;
            let bytes = session.read(h, offset, length)?;
            out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
            out.extend(bytes);
        }
        6 => {
            let h = f.u64()?;
            let offset = f.u64()?;
            let flags = f.u32()?;
            let length = f.u32()? as usize;
            if length > layerfs_overlay::WRITE_WINDOW || flags & !3 != 0 {
                return Err(refused(0xc000000d, "native write window/flags"));
            }
            let data = f.take(length)?;
            f.end()?;
            stat(
                &mut out,
                session.write(h, offset, data, flags & 1 != 0, flags & 2 != 0)?,
            );
        }
        7 => {
            let h = f.u64()?;
            let size = f.u64()?;
            f.end()?;
            stat(&mut out, session.resize(h, size)?);
        }
        8 => {
            let h = f.u64()?;
            let attrs = f.u32()?;
            let replace = f.u32()?;
            f.end()?;
            if replace > 1 {
                return Err(refused(0xc000000d, "native replace flag"));
            }
            stat(&mut out, session.overwrite_windows(h, attrs, replace != 0)?);
        }
        9 => {
            let h = f.u64()?;
            let attrs = f.u32()?;
            let times = [f.u64()?, f.u64()?, f.u64()?, f.u64()?];
            f.end()?;
            stat(&mut out, session.basic_info(h, attrs, times)?);
        }
        10 => {
            let a = f.path()?;
            let b = f.path()?;
            let replace = f.u32()?;
            f.end()?;
            if replace > 1 {
                return Err(refused(0xc000000d, "native rename flag"));
            }
            session.rename(&a, &b, replace != 0)?;
        }
        11 => {
            let p = f.path()?;
            f.end()?;
            session.can_delete(&p)?;
        }
        12 => {
            let h = f.u64()?;
            let parent = f.u32()?;
            f.end()?;
            if parent > 1 {
                return Err(refused(0xc000000d, "native dot flag"));
            }
            if let Some(s) = session.directory_dot(h, parent != 0)? {
                out.extend_from_slice(&1u32.to_le_bytes());
                stat(&mut out, s);
            } else {
                out.extend_from_slice(&0u32.to_le_bytes());
            }
        }
        13 => {
            let p = f.path()?;
            f.end()?;
            session.unlink(&p)?;
        }
        14 => {
            let h = f.u64()?;
            f.end()?;
            session.close_file(h)?;
        }
        15 => {
            let h = f.u64()?;
            let marker = f.path()?;
            f.end()?;
            let after = if marker.is_empty() {
                None
            } else {
                Some(marker.as_bytes())
            };
            if let Some((name, s)) = session.list_next(h, after)? {
                let text = std::str::from_utf8(&name)
                    .map_err(|_| refused(0xc00000bb, "native directory name encoding"))?;
                let units = text.encode_utf16().collect::<Vec<_>>();
                if units.len() > 255 {
                    return Err(refused(0xc00000bb, "native directory name window"));
                }
                out.extend_from_slice(&(units.len() as u32).to_le_bytes());
                for u in units {
                    out.extend_from_slice(&u.to_le_bytes());
                }
                stat(&mut out, s);
            } else {
                out.extend_from_slice(&0u32.to_le_bytes());
            }
        }
        16 => {
            let h = f.u64()?;
            f.end()?;
            session.cleanup_file(h)?;
        }
        20 => {
            f.end()?;
            session.prepare_close()?;
        }
        _ => return Err(refused(0xc000000d, "unsupported native opcode")),
    }
    Ok(out)
}
