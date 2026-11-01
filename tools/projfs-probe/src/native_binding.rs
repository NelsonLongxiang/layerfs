//! Caller-owned Store binding and Workspace incarnation. No credential defaults.
use crate::native_overlay::{failed, refused, Result};
use layerfs_history::{BranchId, CatalogId, WorkspaceId};
use std::io::Read;

/// Keys are deliberately not Debug/Display. This is input, not authority generation.
#[derive(Clone)]
pub struct Binding {
    pub(crate) catalog: Vec<u8>,
    pub(crate) cursor: [u8; 32],
    pub branch: BranchId,
    pub workspace: WorkspaceId,
}
impl Binding {
    pub fn new(
        catalog: Vec<u8>,
        cursor: [u8; 32],
        branch: BranchId,
        workspace: WorkspaceId,
    ) -> Result<Self> {
        CatalogId::derive(&catalog)
            .map_err(|_| refused(0xc000000d, "invalid catalog binding width"))?;
        if cursor == [0; 32] {
            return Err(refused(0xc000000d, "empty cursor capability"));
        }
        Ok(Self {
            catalog,
            cursor,
            branch,
            workspace,
        })
    }
    /// One bounded bootstrap frame: magic, LE u16 catalog length, catalog bytes,
    /// cursor32, tagged Branch17, Workspace32; EOF required. No text/argv secrets.
    pub fn read_from(reader: impl Read) -> Result<Self> {
        let mut bytes = Vec::new();
        reader
            .take(220)
            .read_to_end(&mut bytes)
            .map_err(|_| failed("binding input read failed"))?;
        if bytes.len() < 10 || &bytes[..8] != b"LFSBND01" {
            return Err(refused(0xc000000d, "invalid binding frame"));
        }
        let n = usize::from(u16::from_le_bytes([bytes[8], bytes[9]]));
        if !(1..=128).contains(&n) || bytes.len() != 91 + n {
            return Err(refused(0xc000000d, "invalid binding frame width"));
        }
        let catalog = bytes[10..10 + n].to_vec();
        let cursor = bytes[10 + n..42 + n]
            .try_into()
            .expect("checked cursor width");
        let branch = BranchId::from_slice(&bytes[42 + n..59 + n])
            .map_err(|_| refused(0xc000000d, "invalid Branch identity"))?;
        let workspace = WorkspaceId::from_slice(&bytes[59 + n..91 + n])
            .map_err(|_| refused(0xc000000d, "invalid Workspace identity"))?;
        // This is not a cryptographic erasure guarantee; no copy is printed or persisted.
        bytes.fill(0);
        Self::new(catalog, cursor, branch, workspace)
    }
}
