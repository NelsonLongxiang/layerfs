//! Calling-thread service, exact retained failure and bounded per-mount drain.
use layerfs_fuse::{DispatchError, FailureView, MountRequests, RequestDisposition};
use layerfs_overlay::{Overlay, ProfileConfig};
use std::{
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    task::{Context, Poll, Waker},
    time::{Duration, Instant},
};
struct Fixture {
    directory: std::path::PathBuf,
    _db: Vec<Overlay>,
    mounts: Vec<MountRequests>,
}
impl Fixture {
    fn new(label: &str) -> Self {
        let directory =
            std::env::temp_dir().join(format!("layerfs-request-{}-{label}", std::process::id()));
        std::fs::create_dir(&directory).unwrap();
        let mut dbs = Vec::new();
        let mut mounts = Vec::new();
        for tag in [1, 2] {
            let db = Overlay::create(
                &directory.join(format!("{tag}.sqlite")),
                ProfileConfig::default(),
            )
            .unwrap();
            db.open_workspace([8; 32]).unwrap();
            mounts.push(MountRequests::new(db.create_kernel_mount(1).unwrap()));
            dbs.push(db);
        }
        Self {
            directory,
            _db: dbs,
            mounts,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}
#[derive(Default)]
struct Event(Mutex<(bool, Option<Waker>)>);
impl Event {
    fn fire(&self) {
        let waker = {
            let mut state = self.0.lock().unwrap();
            state.0 = true;
            state.1.take()
        };
        if let Some(waker) = waker {
            waker.wake();
        }
    }
}
struct Release(Arc<Event>);
impl Drop for Release {
    fn drop(&mut self) {
        self.0.fire();
    }
}
struct Wait {
    event: Arc<Event>,
    entered: Option<mpsc::SyncSender<std::thread::ThreadId>>,
    fence: Option<layerfs_fuse::ports::Fence>,
}
impl Future for Wait {
    type Output = RequestDisposition;
    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let mut state = self.event.0.lock().unwrap();
        if state.0 || self.fence.as_ref().is_some_and(|fence| fence.stopped()) {
            return Poll::Ready(RequestDisposition::Complete);
        }
        state.1 = Some(cx.waker().clone());
        drop(state);
        if let Some(entered) = self.entered.take() {
            entered.send(std::thread::current().id()).unwrap();
        }
        Poll::Pending
    }
}
#[test]
fn original_wakeup_resumes_the_receiving_thread_and_drain_waits_for_it() {
    let f = Fixture::new("wake");
    let mount = f.mounts[0].clone();
    let event = Arc::new(Event::default());
    let release = Release(event.clone());
    let (entered, receive) = mpsc::sync_channel(1);
    let (done, joined) = mpsc::sync_channel(1);
    let worker = std::thread::spawn(move || {
        let id = std::thread::current().id();
        mount
            .receive()
            .unwrap()
            .request(0)
            .unwrap()
            .serve(Box::pin(Wait {
                event,
                entered: Some(entered),
                fence: None,
            }))
            .unwrap();
        done.send(id).unwrap();
    });
    let id = receive.recv_timeout(Duration::from_secs(3)).unwrap();
    assert_eq!(f.mounts[0].work().unwrap().active, 1);
    f.mounts[0].stop_receive().unwrap();
    assert_eq!(f.mounts[0].finish(), Err(DispatchError::Busy));
    drop(release);
    assert_eq!(joined.recv_timeout(Duration::from_secs(3)).unwrap(), id);
    worker.join().unwrap();
    let work = f.mounts[0]
        .wait_quiescent(Instant::now() + Duration::from_secs(3))
        .unwrap();
    assert_eq!((work.active, work.completed, work.retained), (0, 1, 0));
    f.mounts[0].finish().unwrap();
}
#[test]
fn forced_stop_wakes_an_unattempted_wait_without_a_dispatcher() {
    let f = Fixture::new("fence");
    let mount = f.mounts[0].clone();
    let fence = mount.fence();
    let event = Arc::new(Event::default());
    let _release = Release(event.clone());
    let (entered, receive) = mpsc::sync_channel(1);
    let (done, joined) = mpsc::sync_channel(1);
    let worker = std::thread::spawn(move || {
        mount
            .receive()
            .unwrap()
            .request(0)
            .unwrap()
            .serve(Box::pin(Wait {
                event,
                entered: Some(entered),
                fence: Some(fence),
            }))
            .unwrap();
        done.send(()).unwrap();
    });
    receive.recv_timeout(Duration::from_secs(3)).unwrap();
    f.mounts[0].stop_service().unwrap();
    joined.recv_timeout(Duration::from_secs(3)).unwrap();
    worker.join().unwrap();
    assert_eq!(f.mounts[0].work().unwrap().active, 0);
    f.mounts[0].finish().unwrap();
}
#[test]
fn panic_keeps_its_original_future_and_leaves_the_peer_usable() {
    struct Panics(Arc<AtomicUsize>);
    impl Future for Panics {
        type Output = RequestDisposition;
        fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Self::Output> {
            std::panic::panic_any("original request panic")
        }
    }
    impl Drop for Panics {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }
    let f = Fixture::new("panic");
    let drops = Arc::new(AtomicUsize::new(0));
    f.mounts[0]
        .receive()
        .unwrap()
        .request(0)
        .unwrap()
        .serve(Box::pin(Panics(drops.clone())))
        .unwrap();
    assert_eq!(drops.load(Ordering::SeqCst), 0);
    f.mounts[0]
        .inspect_failure(0, |failure| match failure {
            FailureView::Panic(payload) => assert_eq!(
                payload.downcast_ref::<&str>(),
                Some(&"original request panic")
            ),
            _ => panic!("wrong original"),
        })
        .unwrap();
    assert_eq!(
        (
            f.mounts[0].work().unwrap().active,
            f.mounts[0].work().unwrap().retained
        ),
        (0, 1)
    );
    assert_eq!(f.mounts[0].finish(), Err(DispatchError::Busy));
    f.mounts[1]
        .receive()
        .unwrap()
        .request(0)
        .unwrap()
        .serve(Box::pin(async { RequestDisposition::Complete }))
        .unwrap();
    assert_eq!(f.mounts[1].work().unwrap().completed, 1);
}

#[test]
fn synchronous_receive_and_idle_stop_share_one_atomic_admission() {
    let f = Fixture::new("sync-stop");
    let mount = &f.mounts[0];
    let request = mount.receive().unwrap().request(0).unwrap();
    let before = mount.work().unwrap();
    assert_eq!(mount.try_stop_receive(), Err(DispatchError::Busy));
    assert_eq!(mount.work().unwrap(), before);
    mount
        .receive()
        .unwrap()
        .request(0)
        .unwrap()
        .serve_sync(|| {
            assert_eq!(mount.work().unwrap().active, 2);
            assert_eq!(mount.try_stop_receive(), Err(DispatchError::Busy));
            RequestDisposition::Complete
        })
        .unwrap();
    assert_eq!(mount.work().unwrap().active, 1);
    request.serve_sync(|| RequestDisposition::Complete).unwrap();
    let stopped = mount.try_stop_receive().unwrap();
    assert_eq!(
        (stopped.active, stopped.retained, stopped.completed),
        (0, 0, 2)
    );
    assert!(stopped.terminal);
    assert!(matches!(mount.receive(), Err(DispatchError::Stopped)));
    assert_eq!(mount.try_stop_receive(), Err(DispatchError::Stopped));
    mount.finish().unwrap();
    assert!(matches!(mount.receive(), Err(DispatchError::Stale)));
    assert_eq!(mount.try_stop_receive(), Err(DispatchError::Stale));
    f.mounts[1]
        .receive()
        .unwrap()
        .request(0)
        .unwrap()
        .serve_sync(|| RequestDisposition::Complete)
        .unwrap();
    assert_eq!(f.mounts[1].work().unwrap().completed, 1);
}

#[test]
fn synchronous_failure_and_panic_keep_original_custody_per_mount() {
    let f = Fixture::new("sync-retain");
    f.mounts[0]
        .receive()
        .unwrap()
        .request(0)
        .unwrap()
        .serve_sync(|| {
            RequestDisposition::Retained(Box::new(std::io::Error::other(
                "original synchronous failure",
            )))
        })
        .unwrap();
    f.mounts[0]
        .inspect_failure(0, |failure| match failure {
            FailureView::Request(error) => {
                assert_eq!(error.to_string(), "original synchronous failure")
            }
            _ => panic!("lost original failure"),
        })
        .unwrap();
    assert_eq!(f.mounts[0].work().unwrap().retained, 1);
    assert_eq!(f.mounts[0].try_stop_receive(), Err(DispatchError::Busy));
    assert_eq!(f.mounts[0].finish(), Err(DispatchError::Busy));
    assert!(matches!(f.mounts[0].receive(), Err(DispatchError::Stopped)));
    f.mounts[1]
        .receive()
        .unwrap()
        .request(0)
        .unwrap()
        .serve_sync(|| std::panic::panic_any("original synchronous panic"))
        .unwrap();
    f.mounts[1]
        .inspect_failure(0, |failure| match failure {
            FailureView::Panic(payload) => assert_eq!(
                payload.downcast_ref::<&str>(),
                Some(&"original synchronous panic")
            ),
            _ => panic!("lost original panic"),
        })
        .unwrap();
    assert_eq!(
        (
            f.mounts[1].work().unwrap().active,
            f.mounts[1].work().unwrap().retained
        ),
        (0, 1)
    );
    assert_eq!(f.mounts[1].try_stop_receive(), Err(DispatchError::Busy));
    assert_eq!(f.mounts[1].finish(), Err(DispatchError::Busy));
}
#[test]
fn completed_future_is_disposed_before_request_admission_becomes_idle() {
    struct Completes(MountRequests, Arc<AtomicUsize>);
    impl Future for Completes {
        type Output = RequestDisposition;
        fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Self::Output> {
            Poll::Ready(RequestDisposition::Complete)
        }
    }
    impl Drop for Completes {
        fn drop(&mut self) {
            // The ready future still owns a consumer during its destructor;
            // normal-close admission must remain Busy through that disposal.
            let active = self.0.work().unwrap().active;
            self.1.store(active, Ordering::SeqCst);
            assert_eq!(self.0.try_stop_receive(), Err(DispatchError::Busy));
        }
    }
    let f = Fixture::new("future-disposal");
    let at_drop = Arc::new(AtomicUsize::new(usize::MAX));
    f.mounts[0]
        .receive()
        .unwrap()
        .request(0)
        .unwrap()
        .serve(Box::pin(Completes(f.mounts[0].clone(), at_drop.clone())))
        .unwrap();
    assert_eq!(at_drop.load(Ordering::SeqCst), 1);
    assert_eq!(f.mounts[0].work().unwrap().active, 0);
    f.mounts[0].try_stop_receive().unwrap();
    f.mounts[0].finish().unwrap();
}
