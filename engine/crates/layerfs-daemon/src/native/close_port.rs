//! Native close transaction on the same inherited mount channel. Only the
//! original Session owns admission and original Close callbacks release files.
use super::{refused, wire::Fields, Result, Session};
pub(super) fn dispatch(
    session: &mut Session,
    clean: bool,
    opcode: u32,
    bytes: &[u8],
) -> Result<Vec<u8>> {
    let mut f = Fields::new(bytes);
    let mut out = Vec::new();
    match opcode {
        22 => {
            f.end()?;
            out.extend_from_slice(&session.begin_native_close(clean)?.to_le_bytes());
        }
        23 => {
            let token = f.u64()?;
            let after = f.u64()?;
            f.end()?;
            if let Some((handle, serial, path)) = session.next_close_candidate(token, after)? {
                let units: Vec<_> = path.encode_utf16().take(32769).collect();
                if units.len() > 32768 {
                    return Err(refused(0xc00000bb, "native close path window"));
                }
                out.extend_from_slice(&handle.to_le_bytes());
                out.extend_from_slice(&serial.to_le_bytes());
                out.extend_from_slice(&(units.len() as u32).to_le_bytes());
                for unit in units {
                    out.extend_from_slice(&unit.to_le_bytes());
                }
            } else {
                out.extend_from_slice(&0u64.to_le_bytes());
                out.extend_from_slice(&0u64.to_le_bytes());
                out.extend_from_slice(&0u32.to_le_bytes());
            }
        }
        24 => {
            let token = f.u64()?;
            let prepare = f.u32()?;
            f.end()?;
            if prepare > 1 {
                return Err(refused(0xc000000d, "native close completion flag"));
            }
            session.finish_native_close(token, prepare != 0, clean)?;
        }
        25 => {
            let token = f.u64()?;
            f.end()?;
            let (handles, active) = session.close_coordination_progress(token)?;
            out.extend_from_slice(&handles.to_le_bytes());
            out.extend_from_slice(&active.to_le_bytes());
        }
        _ => return Err(refused(0xc000000d, "unsupported native close opcode")),
    }
    Ok(out)
}
