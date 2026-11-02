//! Private inherited-stdio framing for the native mount process. No public listener.
use super::{refused, Result, Stat};
use std::io::{self, Read, Write};
pub const MAX_FRAME: usize = 262144;
#[derive(Clone, Debug)]
pub struct Frame {
    pub id: u64,
    pub opcode: u32,
    pub bytes: Vec<u8>,
}
impl Frame {
    pub fn read(input: &mut impl Read) -> io::Result<Option<Self>> {
        let mut bytes = vec![0u8; 24];
        let mut filled = 0;
        let attempt = (|| {
            while filled < 24 {
                let n = input.read(&mut bytes[filled..24])?;
                if n == 0 {
                    if filled == 0 {
                        return Ok(None);
                    }
                    return Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "partial native header",
                    ));
                }
                filled += n;
            }
            if &bytes[..8] != b"LFSRPC01" {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "native frame version",
                ));
            }
            let id = u64::from_le_bytes(bytes[8..16].try_into().expect("width"));
            let opcode = u32::from_le_bytes(bytes[16..20].try_into().expect("width"));
            let size = u32::from_le_bytes(bytes[20..24].try_into().expect("width")) as usize;
            if size > MAX_FRAME {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "native frame processing window",
                ));
            }
            bytes.resize(24 + size, 0);
            while filled < bytes.len() {
                let n = input.read(&mut bytes[filled..])?;
                if n == 0 {
                    return Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "partial native body",
                    ));
                }
                filled += n;
            }
            Ok(Some((id, opcode)))
        })();
        match attempt {
            Ok(Some((id, opcode))) => Ok(Some(Self {
                id,
                opcode,
                bytes: bytes.split_off(24),
            })),
            Ok(None) => Ok(None),
            Err(cause) => {
                bytes.truncate(filled);
                let kind = cause.kind();
                Err(io::Error::new(kind, ReadFailure { cause, bytes }))
            }
        }
    }
    pub fn write(&self, out: &mut impl Write) -> io::Result<()> {
        if self.bytes.len() > MAX_FRAME {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "native frame processing window",
            ));
        }
        let mut frame = Vec::with_capacity(24 + self.bytes.len());
        frame.extend_from_slice(b"LFSRPC01");
        frame.extend_from_slice(&self.id.to_le_bytes());
        frame.extend_from_slice(&self.opcode.to_le_bytes());
        frame.extend_from_slice(&(self.bytes.len() as u32).to_le_bytes());
        frame.extend_from_slice(&self.bytes);
        // Continue positive short writes within this one transfer. An error or
        // zero progress ends it; never restart a failed frame/operation.
        let mut at = 0;
        while at < frame.len() {
            let n = out.write(&frame[at..])?;
            if n == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::WriteZero,
                    "native frame write",
                ));
            }
            at += n;
        }
        out.flush()
    }
}
#[derive(Debug)]
struct ReadFailure {
    cause: io::Error,
    bytes: Vec<u8>,
}
impl std::fmt::Display for ReadFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} ({} original native bytes retained)",
            self.cause,
            self.bytes.len()
        )
    }
}
impl std::error::Error for ReadFailure {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.cause)
    }
}
pub struct Fields<'a> {
    bytes: &'a [u8],
}
impl<'a> Fields<'a> {
    pub fn new(bytes: &'a [u8]) -> Self {
        Self { bytes }
    }
    pub fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        if n > self.bytes.len() {
            return Err(refused(0xc000000d, "truncated native input"));
        }
        let (v, rest) = self.bytes.split_at(n);
        self.bytes = rest;
        Ok(v)
    }
    pub fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().expect("width")))
    }
    pub fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().expect("width")))
    }
    pub fn path(&mut self) -> Result<String> {
        let n = self.u32()? as usize;
        if n > 32768 {
            return Err(refused(0xc000000d, "native path window"));
        }
        let bytes = self.take(n * 2)?;
        let units = bytes
            .chunks_exact(2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .collect::<Vec<_>>();
        String::from_utf16(&units)
            .map(|p| p.replace('\\', "/"))
            .map_err(|_| refused(0xc000000d, "invalid native UTF16"))
    }
    pub fn end(self) -> Result<()> {
        if self.bytes.is_empty() {
            Ok(())
        } else {
            Err(refused(0xc000000d, "trailing native input"))
        }
    }
}
pub fn stat(out: &mut Vec<u8>, s: Stat) {
    out.extend_from_slice(&s.serial.to_le_bytes());
    out.extend_from_slice(&s.size.to_le_bytes());
    out.extend_from_slice(&s.mtime.to_le_bytes());
    for n in [s.nanos, s.mode, s.directory, s.attributes] {
        out.extend_from_slice(&n.to_le_bytes());
    }
}
