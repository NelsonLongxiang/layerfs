//! One Commit command on the original inherited owner channel. The public
//! metadata bound determines the encoded field window; no multipart owner exists.
use super::{control::emit, process::Shared, CommitScope};
use layerfs_bridge::sdk_values::unhex;
use layerfs_history::MAXIMUM_MESSAGE_BYTES;
use layerfs_store_service::store::CommitOptions;
use std::io;
pub(super) const CONTROL_BYTES: usize = 128 + MAXIMUM_MESSAGE_BYTES * 2;
fn message(text: &str) -> Option<Option<String>> {
    match text {
        "none" => Some(None),
        "-" => Some(Some(String::new())),
        _ if text.len() <= MAXIMUM_MESSAGE_BYTES * 2 => {
            String::from_utf8(unhex(text)?).ok().map(Some)
        }
        _ => None,
    }
}
pub(super) fn run(shared: &Shared, id: u64, words: &[&str]) -> io::Result<()> {
    let (words, force) = match words {
        [body @ .., "force", "true"] => (body, true),
        [body @ .., "force", "false"] => (body, false),
        _ => (words, false),
    };
    let selected = match words {
        [_, "commit", "published"] => {
            Some((false, Some("Windows published Workspace frontier".into())))
        }
        [_, "commit", "published", "identity"] => {
            Some((true, Some("Windows published Workspace frontier".into())))
        }
        [_, "commit", "published", "message", text] => message(text).map(|m| (false, m)),
        [_, "commit", "published", "identity", "message", text] => message(text).map(|m| (true, m)),
        _ => None,
    };
    let Some((identity, message)) = selected else {
        return emit(
            shared,
            &format!("NATIVE_SERVICE_REFUSED id={id} status=c000000d"),
        );
    };
    let work = {
        let mut session = shared
            .session
            .lock()
            .map_err(|_| io::Error::other("Session poisoned"))?;
        session
            .as_mut()
            .ok_or_else(|| io::Error::other("Session closed"))?
            .begin_commit_with(CommitScope::Published, CommitOptions { force, message })
    };
    let work = match work {
        Ok(work) => work,
        Err(error) => {
            return emit(
                shared,
                &format!(
                    "NATIVE_SERVICE_REFUSED id={id} status={:08x}",
                    error.status as u32
                ),
            )
        }
    };
    let completion = work.run();
    let answer = {
        let mut session = shared
            .session
            .lock()
            .map_err(|_| io::Error::other("Session poisoned"))?;
        session
            .as_mut()
            .ok_or_else(|| io::Error::other("Session closed"))?
            .complete_commit(completion)
    };
    match answer {
        Ok(receipt) => {
            let line = if identity {
                super::receipt::commit(&receipt, id)
            } else {
                format!(
                    "NATIVE_SERVICE_COMMIT id={id} changed={} revision={} published=true",
                    receipt.changed, receipt.frontier.revision
                )
            };
            if let Err(error) = emit(shared, &line) {
                std::mem::forget(receipt);
                return Err(error);
            }
            Ok(())
        }
        Err(error) => emit(
            shared,
            &format!(
                "NATIVE_SERVICE_REFUSED id={id} status={:08x}",
                error.status as u32
            ),
        ),
    }
}
