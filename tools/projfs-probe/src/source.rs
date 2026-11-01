//! Two concrete sources for the diagnostic provider, never a new product port.
use crate::{
    saved::{Entry, Result, Saved},
    NAME,
};

pub(crate) enum Source {
    Fixture(Vec<u8>),
    Saved(Box<Saved>),
}
impl Source {
    pub fn entry(&self, path: &str) -> Result<Option<Entry>> {
        match self {
            Self::Saved(saved) => saved.entry(path),
            Self::Fixture(bytes) => Ok(if path.is_empty() {
                Some(Entry {
                    name: String::new(),
                    directory: true,
                    size: 0,
                })
            } else if path.eq_ignore_ascii_case(NAME) {
                Some(Entry {
                    name: NAME.into(),
                    directory: false,
                    size: bytes.len() as u64,
                })
            } else {
                None
            }),
        }
    }
    pub fn list(&mut self, path: &str) -> Result<Vec<Entry>> {
        match self {
            Self::Saved(saved) => saved.list(path),
            Self::Fixture(_) if path.is_empty() => {
                Ok(vec![self.entry(NAME)?.ok_or("fixture missing")?])
            }
            Self::Fixture(_) => Err("fixture has no nested directory".into()),
        }
    }
    pub fn read(&mut self, path: &str, offset: u64, length: u32) -> Result<Vec<u8>> {
        match self {
            Self::Saved(saved) => saved.read(path, offset, length),
            Self::Fixture(bytes) => {
                if !path.eq_ignore_ascii_case(NAME) {
                    return Err("fixture file missing".into());
                }
                let start = usize::try_from(offset).map_err(|_| "offset overflow")?;
                let end = start
                    .checked_add(length as usize)
                    .ok_or("length overflow")?;
                bytes
                    .get(start..end)
                    .map(|s| s.to_vec())
                    .ok_or_else(|| "fixture range outside file".into())
            }
        }
    }
    pub fn store(&self) -> Option<&Saved> {
        match self {
            Self::Saved(saved) => Some(saved),
            _ => None,
        }
    }
}
