//! Explicit authority; credentials have no Debug or Display implementation.
use super::{refused, Result};
use layerfs_history::{BranchId, CatalogId, WorkspaceId};
#[derive(Clone)]
pub struct Binding {
    pub(super) catalog: Vec<u8>,
    pub(super) cursor: [u8; 32],
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
}
