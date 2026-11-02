//! Commands on inherited owner stdin; no network listener or Sandbox autostart.
use super::{process::Shared, wire::Frame};
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
        let maximum = super::control_commit::CONTROL_BYTES;
        let read = (&mut input)
            .take(maximum as u64 + 1)
            .read_until(b'\n', &mut line);
        if !matches!(read,Ok(n) if n>0) || line.len() > maximum || !line.ends_with(b"\n") {
            shared.keep(Box::new(ControlFailure {
                id: 0,
                input: line,
                cause: io::Error::other(format!("control input ended or invalid: {read:?}")),
            }));
            shared.lose();
            let _ = emit(
                &shared,
                "NATIVE_SERVICE_CONTROL_LOST retained=true no_implicit_unmount=true",
            );
            return;
        }
        let text = match std::str::from_utf8(&line) {
            Ok(t) => t,
            Err(cause) => {
                shared.keep(Box::new(ControlFailure {
                    id: 0,
                    input: line,
                    cause: io::Error::new(io::ErrorKind::InvalidData, cause),
                }));
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
            shared.keep(Box::new(ControlFailure {
                id: 0,
                input: line,
                cause: io::Error::other("control identity did not advance"),
            }));
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
                [_, "reference", after, offset] => {
                    let line = match (after.parse::<u64>(), offset.parse::<u64>()) {
                        (Ok(after), Ok(offset)) => {
                            let s = shared
                                .session
                                .lock()
                                .map_err(|_| io::Error::other("Session poisoned"))?;
                            super::receipt::reference(
                                s.as_ref()
                                    .ok_or_else(|| io::Error::other("Session closed"))?,
                                id,
                                after,
                                offset,
                            )
                        }
                        _ => Err(super::refused(
                            0xc000000d,
                            "reference needs u64 cursor and byte offset",
                        )),
                    };
                    match line {
                        Ok(line) => emit(&shared, &line),
                        Err(e) => emit(
                            &shared,
                            &format!(
                                "NATIVE_SERVICE_REFUSED id={id} status={:08x}",
                                e.status as u32
                            ),
                        ),
                    }
                }
                [_, "state"] => {
                    let line = {
                        let s = shared
                            .session
                            .lock()
                            .map_err(|_| io::Error::other("Session poisoned"))?;
                        super::receipt::state(
                            s.as_ref()
                                .ok_or_else(|| io::Error::other("Session closed"))?,
                            id,
                        )
                    };
                    match line {
                        Ok(line) => emit(&shared, &line),
                        Err(e) => emit(
                            &shared,
                            &format!(
                                "NATIVE_SERVICE_REFUSED id={id} status={:08x}",
                                e.status as u32
                            ),
                        ),
                    }
                }
                [_, "commit", "published", ..] => super::control_commit::run(&shared, id, &words),
                [_, "unmount"] | [_, "unmount", "clean"] | [_, "unmount", "discard"] => {
                    let clean = words.get(2).is_some_and(|s| *s == "clean");
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
                    *pending = Some(super::process::Unmount { id, clean });
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
