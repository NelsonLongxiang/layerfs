//! Commands on inherited owner stdin; no network listener or Sandbox autostart.
use super::{process::Shared, wire::Frame, CommitScope};
use std::{
    io::{self, BufRead, Read, Write},
    sync::{atomic::Ordering, Arc},
};
#[derive(Debug)]
struct ControlFailure {
    id: u64,
    input: Vec<u8>,
    cause: io::Error,
}
impl std::fmt::Display for ControlFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "control {}: {} ({} original input bytes retained)",
            self.id,
            self.cause,
            self.input.len()
        )
    }
}
impl std::error::Error for ControlFailure {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.cause)
    }
}
pub(super) fn emit(shared: &Shared, line: &str) -> io::Result<()> {
    let _guard = shared
        .output
        .lock()
        .map_err(|_| io::Error::other("control output poisoned"))?;
    let mut out = io::stdout().lock();
    out.write_all(line.as_bytes())?;
    out.write_all(b"\n")?;
    out.flush()
}
pub(super) fn run(shared: Arc<Shared>) {
    let input = io::stdin();
    let mut input = input.lock();
    let mut previous = 0u64;
    loop {
        let mut line = Vec::new();
        let read = (&mut input).take(129).read_until(b'\n', &mut line);
        if !matches!(read,Ok(n) if n>0) || line.len() > 128 || !line.ends_with(b"\n") {
            shared.keep(Box::new(io::Error::other(format!(
                "control input ended or invalid: bytes={line:02x?}, result={read:?}"
            ))));
            shared.lose();
            let _ = emit(
                &shared,
                "NATIVE_SERVICE_CONTROL_LOST retained=true no_implicit_unmount=true",
            );
            return;
        }
        let text = match std::str::from_utf8(&line) {
            Ok(t) => t,
            Err(_) => {
                shared.lose();
                return;
            }
        };
        let words = text.split_whitespace().collect::<Vec<_>>();
        let id = words
            .first()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|v| *v > previous);
        let Some(id) = id else {
            shared.lose();
            let _ = emit(&shared, "NATIVE_SERVICE_CONTROL_PROTOCOL retained=true");
            return;
        };
        previous = id;
        if shared.lost.load(Ordering::Acquire) {
            let _ = emit(
                &shared,
                &format!("NATIVE_SERVICE_REFUSED id={id} status=c0000001"),
            );
            continue;
        }
        if !shared.served.load(Ordering::Acquire) {
            if emit(
                &shared,
                &format!("NATIVE_SERVICE_REFUSED id={id} status=80000011"),
            )
            .is_err()
            {
                shared.lose();
                return;
            }
            continue;
        }
        let result = (|| -> io::Result<()> {
            match words.as_slice() {
                [_, "status"] => {
                    let observation = {
                        let session = shared
                            .session
                            .lock()
                            .map_err(|_| io::Error::other("Session poisoned"))?;
                        let s = session
                            .as_ref()
                            .ok_or_else(|| io::Error::other("Session closed"))?;
                        s.status().map(|state| (state, s.close_state()))
                    };
                    let line = match observation {
                        Ok((v, close)) => format!("NATIVE_SERVICE_STATUS id={id} root={} revision={} handles={} requests={} active={} retained={} prepared={} pending_commit={} files={} directories={}", v.root,v.frontier.revision,v.handles,v.requests.requests,v.requests.active,v.retained,v.prepared,close.pending_commit,close.files,close.directories),
                        Err(e) => format!("NATIVE_SERVICE_REFUSED id={id} status={:08x}",e.status as u32),
                    };
                    emit(&shared, &line)
                }
                [_, "commit", "published"] => {
                    let work = {
                        let mut s = shared
                            .session
                            .lock()
                            .map_err(|_| io::Error::other("Session poisoned"))?;
                        s.as_mut()
                            .ok_or_else(|| io::Error::other("Session closed"))?
                            .begin_commit(CommitScope::Published)
                    };
                    let work = match work {
                        Ok(w) => w,
                        Err(e) => {
                            return emit(
                                &shared,
                                &format!(
                                    "NATIVE_SERVICE_REFUSED id={id} status={:08x}",
                                    e.status as u32
                                ),
                            )
                        }
                    };
                    let completion = work.run();
                    let answer = {
                        let mut s = shared
                            .session
                            .lock()
                            .map_err(|_| io::Error::other("Session poisoned"))?;
                        s.as_mut()
                            .ok_or_else(|| io::Error::other("Session closed"))?
                            .complete_commit(completion)
                    };
                    match answer {
                        Ok(receipt) => {
                            let line=format!("NATIVE_SERVICE_COMMIT id={id} changed={} revision={} published=true",receipt.changed,receipt.frontier.revision);
                            if let Err(e) = emit(&shared, &line) {
                                std::mem::forget(receipt);
                                return Err(e);
                            }
                            Ok(())
                        }
                        Err(e) => emit(
                            &shared,
                            &format!(
                                "NATIVE_SERVICE_REFUSED id={id} status={:08x}",
                                e.status as u32
                            ),
                        ),
                    }
                }
                [_, "unmount"] => {
                    let mut pending = shared
                        .unmount
                        .lock()
                        .map_err(|_| io::Error::other("unmount state poisoned"))?;
                    if pending.is_some() {
                        return emit(
                            &shared,
                            &format!("NATIVE_SERVICE_REFUSED id={id} status=80000011"),
                        );
                    }
                    *pending = Some(id);
                    drop(pending);
                    let mut out = shared
                        .child_input
                        .lock()
                        .map_err(|_| io::Error::other("child input poisoned"))?;
                    Frame {
                        id: 0,
                        opcode: 100,
                        bytes: Vec::new(),
                    }
                    .write(
                        out.as_mut()
                            .ok_or_else(|| io::Error::other("native input closed"))?,
                    )
                }
                _ => emit(
                    &shared,
                    &format!("NATIVE_SERVICE_REFUSED id={id} status=c000000d"),
                ),
            }
        })();
        if let Err(cause) = result {
            shared.keep(Box::new(ControlFailure {
                id,
                input: line,
                cause,
            }));
            shared.lose();
            return;
        }
    }
}
