//! Product native Windows process: safe Session parent plus concrete WinFsp child.
use super::{
    bootstrap, control, port,
    wire::{Fields, Frame},
    Session,
};
use layerfs_fuse::{MountRequests, RequestDisposition};
use std::{
    io,
    path::PathBuf,
    process::{ChildStdin, Command, ExitCode, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
pub(super) struct Unmount {
    pub id: u64,
    pub clean: bool,
}
pub(super) struct Shared {
    pub session: Mutex<Option<Session>>,
    pub child_input: Mutex<Option<ChildStdin>>,
    pub failures: Mutex<Vec<Box<dyn std::error::Error + Send + Sync>>>,
    pub served: AtomicBool,
    pub pending_frame: Mutex<Option<Arc<Frame>>>,
    pub output: Mutex<()>,
    pub unmount: Mutex<Option<Unmount>>,
    pub lost: AtomicBool,
}
#[derive(Debug)]
struct Delivery {
    cause: io::Error,
    request: Arc<Frame>,
    response: Frame,
}
impl std::fmt::Display for Delivery {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "native response delivery: {} (request {}, opcode {}, response bytes {})",
            self.cause,
            self.request.id,
            self.request.opcode,
            self.response.bytes.len()
        )
    }
}
impl std::error::Error for Delivery {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.cause)
    }
}
impl Shared {
    pub(super) fn keep(&self, failure: Box<dyn std::error::Error + Send + Sync>) {
        self.failures
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(failure);
    }
    pub(super) fn lose(&self) {
        self.lost.store(true, Ordering::Release);
        // EOF wakes the child, which reports no graceful detach on this path.
        // No failed operation is resent and no native owner is silently revoked.
        self.child_input
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
    }
}
fn reply(shared: &Shared, request: &Arc<Frame>, status: i32, body: Vec<u8>) -> io::Result<Frame> {
    let mut bytes = Vec::with_capacity(4 + body.len());
    bytes.extend_from_slice(&status.to_le_bytes());
    bytes.extend(body);
    let response = Frame {
        id: request.id,
        opcode: request.opcode | 0x80000000,
        bytes,
    };
    let mut output = shared
        .child_input
        .lock()
        .map_err(|_| io::Error::other("child input poisoned"))?;
    let sent = output
        .as_mut()
        .ok_or_else(|| io::Error::other("native input closed"))
        .and_then(|out| response.write(out));
    if let Err(cause) = sent {
        let failure = Delivery {
            cause,
            request: request.clone(),
            response,
        };
        shared.keep(Box::new(failure));
        return Err(io::Error::other("original native response retained"));
    }
    Ok(response)
}
fn serve_callback(shared: &Shared, lane: &MountRequests, request: Arc<Frame>) -> io::Result<()> {
    let owner = lane
        .receive()
        .map_err(io::Error::other)?
        .request(request.bytes.len())
        .map_err(|e| io::Error::other(format!("native input admission: {e:?}")))?;
    let mut failed = false;
    let mut returned = false;
    owner
        .serve_sync(|| {
            let answer = (|| {
                let mut s = shared
                    .session
                    .lock()
                    .map_err(|_| super::failed("Session poisoned"))?;
                let s = s.as_mut().ok_or_else(|| super::failed("Session closed"))?;
                port::dispatch(s, request.opcode, &request.bytes)
            })();
            let (status, body, error) = match answer {
                Ok(v) => (0, v, None),
                Err(e) => (e.status, Vec::new(), Some(e)),
            };
            let response = Frame {
                id: request.id,
                opcode: request.opcode | 0x80000000,
                bytes: {
                    let mut v = status.to_le_bytes().to_vec();
                    v.extend(body);
                    v
                },
            };
            let sent = shared
                .child_input
                .lock()
                .map_err(|_| io::Error::other("child input poisoned"))
                .and_then(|mut o| {
                    o.as_mut()
                        .ok_or_else(|| io::Error::other("native input closed"))
                        .and_then(|out| response.write(out))
                });
            if let Err(cause) = sent {
                failed = true;
                returned = true;
                return RequestDisposition::Retained(Box::new(Delivery {
                    cause,
                    request,
                    response,
                }));
            }
            if status == 0xc0000001u32 as i32 {
                failed = true;
                returned = true;
                return RequestDisposition::Retained(Box::new(Delivery {
                    cause: io::Error::other(error.expect("unknown error")),
                    request,
                    response,
                }));
            }
            returned = true;
            RequestDisposition::Complete
        })
        .map_err(io::Error::other)?;
    if failed || !returned {
        shared.lose();
        return Err(io::Error::other(
            "original native callback outcome retained",
        ));
    }
    Ok(())
}
fn run() -> io::Result<()> {
    let args = std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    if !(5..=6).contains(&args.len())
        || args[..5].iter().any(|p| !p.is_absolute())
        || (args.len() == 6
            && !args[5]
                .as_os_str()
                .to_string_lossy()
                .starts_with("S-1-5-21-"))
    {
        return Err(io::Error::new(io::ErrorKind::InvalidInput,"usage: layerfs-native <absolute-native-host> <WinFsp-dll> <existing-store> <fresh-work> <fresh-mount>; binding on stdin"));
    }
    for p in &args[..3] {
        if !p.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "native executable/library/Store input is not a file",
            ));
        }
    }
    if args[4].exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "native mount already exists",
        ));
    }
    let startup = bootstrap::read(&mut io::stdin().lock()).map_err(io::Error::other)?;
    let session = match startup.named {
        Some((stack, name)) => {
            Session::bind_registered(&args[2], &args[3], startup.binding, stack, name)
        }
        None => Session::bind_existing(&args[2], &args[3], startup.binding),
    }
    .map_err(io::Error::other)?;
    let root = session.mount().root_serial();
    let lane = session.requests();
    let mut launch = Command::new(&args[0]);
    launch
        .arg(&args[1])
        .arg(&args[4])
        .arg(root.to_string())
        .arg(
            args[2]
                .parent()
                .ok_or_else(|| io::Error::other("Store parent"))?,
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    if args.len() == 6 {
        launch.arg(&args[5]);
    }
    let mut child = launch.spawn()?;
    let child_input = child
        .stdin
        .take()
        .ok_or_else(|| io::Error::other("native stdin missing"))?;
    let mut input = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("native stdout missing"))?;
    let shared = Arc::new(Shared {
        session: Mutex::new(Some(session)),
        child_input: Mutex::new(Some(child_input)),
        failures: Mutex::new(Vec::new()),
        served: AtomicBool::new(false),
        pending_frame: Mutex::new(None),
        output: Mutex::new(()),
        unmount: Mutex::new(None),
        lost: AtomicBool::new(false),
    });
    // The native child has no external endpoint or credentials: only these private
    // inherited handles. Its owned process receipt must confirm terminal detach.
    let controls = shared.clone();
    std::thread::spawn(move || control::run(controls));
    let mut previous = 0u64;
    let mut served = false;
    let mut finished = false;
    let result = (|| loop {
        let request = Arc::new(Frame::read(&mut input)?.ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "native process channel ended without terminal receipt",
            )
        })?);
        *shared
            .pending_frame
            .lock()
            .map_err(|_| io::Error::other("pending frame poisoned"))? = Some(request.clone());
        if request.id == 0 {
            match request.opcode {
                101 if !served => {
                    let mut f = Fields::new(&request.bytes);
                    let observed = f.u64().map_err(io::Error::other)?;
                    f.end().map_err(io::Error::other)?;
                    if observed != root {
                        return Err(io::Error::other("native served another root"));
                    }
                    served = true;
                    shared.served.store(true, Ordering::Release);
                    control::emit(
                        &shared,
                        &format!(
                            "NATIVE_SERVICE_ROOT_SERVED root={root} sdk_ready=false native=true"
                        ),
                    )?;
                }
                102 if served && !finished => {
                    let mut f = Fields::new(&request.bytes);
                    let status = f.u32().map_err(io::Error::other)?;
                    let _ = f.u32().map_err(io::Error::other)?;
                    f.end().map_err(io::Error::other)?;
                    if status != 0x80000011 && status != super::lifecycle::STATUS_DIRTY {
                        return Err(io::Error::other("native unmount refusal changed outcome"));
                    }
                    let original = shared
                        .unmount
                        .lock()
                        .map_err(|_| io::Error::other("unmount state poisoned"))?
                        .take()
                        .ok_or_else(|| io::Error::other("uncorrelated unmount refusal"))?;
                    if status == super::lifecycle::STATUS_DIRTY && !original.clean {
                        return Err(io::Error::other(
                            "discard unmount returned foreign Dirty outcome",
                        ));
                    }
                    let id = original.id;
                    control::emit(
                        &shared,
                        &format!(
                            "NATIVE_SERVICE_REFUSED id={id} status={status:08x} service_kept=true"
                        ),
                    )?;
                }
                103 if finished => {
                    let mut f = Fields::new(&request.bytes);
                    if f.u32().map_err(io::Error::other)? != 0 {
                        return Err(io::Error::other("native terminal failure"));
                    }
                    let raw = f.u32().map_err(io::Error::other)?;
                    f.end().map_err(io::Error::other)?;
                    let exit = child.wait()?;
                    if !exit.success() {
                        return Err(io::Error::other("native process failed after close"));
                    }
                    let id = shared
                        .unmount
                        .lock()
                        .map_err(|_| io::Error::other("unmount state poisoned"))?
                        .take()
                        .ok_or_else(|| io::Error::other("uncorrelated native close"))?
                        .id;
                    let closed = shared
                        .session
                        .lock()
                        .map_err(|_| io::Error::other("Session poisoned"))?
                        .take();
                    drop(closed);
                    control::emit(&shared,&format!("NATIVE_SERVICE_UNMOUNTED id={id} native_exit=0 dispatcher_exit={raw:08x} overlay_closed=true"))?;
                    shared
                        .pending_frame
                        .lock()
                        .map_err(|_| io::Error::other("pending frame poisoned"))?
                        .take();
                    return Ok(());
                }
                104 => {
                    shared.keep(Box::new(io::Error::other(format!(
                        "native failure event: {:02x?}",
                        request.bytes
                    ))));
                    return Err(io::Error::other(
                        "native child retained original mount failure",
                    ));
                }
                _ => return Err(io::Error::other("native event state/correlation")),
            }
        } else {
            if previous.checked_add(1) != Some(request.id) {
                return Err(io::Error::other("native request sequence"));
            }
            previous = request.id;
            if shared.lost.load(Ordering::Acquire) {
                return Err(io::Error::other(
                    "native control lost; original Session retained",
                ));
            }
            match request.opcode {
                1..=16 => serve_callback(&shared, &lane, request)?,
                20 | 21 => {
                    let end = request.opcode == 21;
                    if !request.bytes.is_empty()
                        || finished
                        || !served
                        || shared
                            .unmount
                            .lock()
                            .map_err(|_| io::Error::other("unmount state poisoned"))?
                            .is_none()
                    {
                        return Err(io::Error::other("native terminal request shape/state"));
                    }
                    let answer = {
                        let mut s = shared
                            .session
                            .lock()
                            .map_err(|_| io::Error::other("Session poisoned"))?;
                        let s = s
                            .as_mut()
                            .ok_or_else(|| io::Error::other("Session closed"))?;
                        if end {
                            s.finish_after_native_drain()
                        } else {
                            let clean = shared
                                .unmount
                                .lock()
                                .map_err(|_| io::Error::other("unmount state poisoned"))?
                                .as_ref()
                                .is_some_and(|v| v.clean);
                            if clean {
                                s.prepare_clean_close()
                            } else {
                                s.prepare_close()
                            }
                        }
                    };
                    let status = match answer {
                        Ok(()) => {
                            if end {
                                finished = true;
                            }
                            0
                        }
                        Err(e) => e.status,
                    };
                    let transfer = reply(&shared, &request, status, Vec::new());
                    if transfer.is_err() {
                        std::mem::forget(request);
                        return Err(io::Error::other(
                            "original terminal response retained after transfer failure",
                        ));
                    }
                    if status == 0xc0000001u32 as i32 {
                        return Err(io::Error::other("native terminal outcome retained"));
                    }
                }
                _ => return Err(io::Error::other("unsupported native request")),
            }
        }
        shared
            .pending_frame
            .lock()
            .map_err(|_| io::Error::other("pending frame poisoned"))?
            .take();
    })();
    match result {
        Ok(()) => Ok(()),
        Err(cause) => {
            let original = Arc::new(cause);
            shared.keep(Box::new(original.clone()));
            shared.lose();
            std::mem::forget(shared);
            std::mem::forget(child);
            Err(io::Error::other(original))
        }
    }
}
pub fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("NATIVE_SERVICE_FAILED {e}; retained=true no_replay=true");
            ExitCode::FAILURE
        }
    }
}
