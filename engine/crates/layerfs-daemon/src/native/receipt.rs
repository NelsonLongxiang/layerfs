//! Bounded identity receipts from the original installed Session/outcome, not a
//! fresh History lookup that could observe a different concurrent publication.
use super::{CommitReceipt, Result, Session};
use layerfs_bridge::sdk_values::hex;
use layerfs_history::{CommitId, CommitOutcome};
fn head(value: Option<CommitId>) -> String {
    value
        .map(|v| hex(v.as_slice()))
        .unwrap_or_else(|| "-".into())
}
pub(super) fn state(session: &Session, id: u64) -> Result<String> {
    let status = session.status()?;
    let snapshot = session.snapshot()?;
    let close = session.close_state();
    Ok(format!("NATIVE_SERVICE_STATE id={id} workspace={} branch={} head={} base={} root={} revision={} dirty_inodes={} dirty_entries={} handles={} active={} retained={} prepared={} pending_commit={} pending_merge={}",
        hex(status.workspace.as_slice()), hex(status.branch.as_slice()), head(snapshot.branch.head_commit),
        hex(snapshot.branch.base_layer.as_slice()), hex(snapshot.effective_root.as_bytes()), status.frontier.revision,
        status.frontier.dirty_inodes,status.frontier.dirty_directory_entries,status.handles,status.requests.active,status.retained,status.prepared,close.pending_commit,status.frontier.base_root != *snapshot.effective_root.as_bytes()))
}
pub(super) fn commit(receipt: &CommitReceipt, id: u64) -> String {
    let (parent, displaced) = match receipt.success.history.as_ref() {
        Some(CommitOutcome::Committed { record, displaced }) => (record.parent, *displaced),
        _ => (None, None),
    };
    let merge = receipt.success.merge.as_ref();
    format!("NATIVE_SERVICE_PUBLICATION id={id} changed={} revision={} head={} base={} root={} parent={} displaced={} merge_from={} merge_head={} published=true",
        receipt.changed,receipt.frontier.revision,head(receipt.installed.branch.head_commit),
        hex(receipt.installed.branch.base_layer.as_slice()),hex(receipt.installed.effective_root.as_bytes()),
        head(parent),head(displaced),head(merge.and_then(|m|m.from)),head(merge.and_then(|m|m.head)))
}
