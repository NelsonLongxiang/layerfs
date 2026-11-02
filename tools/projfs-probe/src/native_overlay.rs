//! Diagnostic fixture, captured/history reads and observations over product native Session.
use crate::{native_binding::Binding, store_fixture::Fixture};
pub use layerfs_daemon::native::{
    failed, refused, CloseState, CommitCompletion, CommitScope, CommitWork, Error, Result, Stat,
};
use layerfs_daemon::native::{BindCause, CommitReceipt, Session as NativeSession};
use layerfs_history::{CommitId, CommitOutcome, HistoryCatalog};
use layerfs_overlay::{Capture, CapturedReader};
use std::{
    ops::{Deref, DerefMut},
    path::{Path, PathBuf},
};

pub struct Session {
    native: NativeSession,
    capture: Option<(Capture, CapturedReader)>,
    store_path: PathBuf,
    binding: Binding,
    commits: Vec<CommitId>,
    retained_receipts: Vec<CommitReceipt>,
}
impl Deref for Session {
    type Target = NativeSession;
    fn deref(&self) -> &NativeSession {
        &self.native
    }
}
impl DerefMut for Session {
    fn deref_mut(&mut self) -> &mut NativeSession {
        &mut self.native
    }
}
impl Session {
    pub fn create(path: &Path) -> Result<Self> {
        let fixture = Fixture::create(path).map_err(failed)?;
        Self::bind_existing(
            &fixture.store,
            &path.join("native-work"),
            crate::store_fixture::native_binding()?,
        )
    }
    pub fn reopen(store: &Path, work: &Path) -> Result<Self> {
        Self::bind_existing(store, work, crate::store_fixture::native_binding()?)
    }
    pub fn bind_existing(store: &Path, work: &Path, binding: Binding) -> Result<Self> {
        let authority = layerfs_daemon::native::Binding::new(
            binding.catalog.clone(),
            binding.cursor,
            binding.branch,
            binding.workspace,
        )?;
        let native = NativeSession::bind_existing(store, work, authority).map_err(|failure| {
            let status = match failure.cause {
                BindCause::MissingBranch => 0xc0000034u32,
                BindCause::ProtectedBranch => 0xc0000022,
                BindCause::Invalid(_) => 0xc000000d,
                _ => 0xc0000001,
            };
            Error {
                status: status as i32,
                detail: failure.to_string(),
                source: Some(std::sync::Arc::new(failure)),
            }
        })?;
        let root = native.mount().root_serial();
        println!("STORE_REBOUND existing=true init=false");
        println!(
            "NATIVE_BINDING branch={} workspace={:?} explicit_parameters=true",
            binding.branch, binding.workspace
        );
        println!("OVERLAY_BOUND root={root} source=real_Store profile=Disposable overlay=MEMORY_OFF_EXCLUSIVE");
        Ok(Self {
            native,
            capture: None,
            store_path: store.into(),
            binding,
            commits: Vec::new(),
            retained_receipts: Vec::new(),
        })
    }
    fn diagnostic_admission(&self) -> Result<()> {
        if !self.retained_receipts.is_empty() {
            return Err(failed(
                "independent diagnostic receipt verification retained",
            ));
        }
        let state = self.native.close_state();
        if state.prepared != 0 {
            return Err(refused(0x80000011, "terminal close prepared"));
        }
        if state.retained != 0 {
            return Err(failed("original product Session failure retained"));
        }
        Ok(())
    }
    pub fn begin_commit(&mut self, scope: CommitScope) -> Result<CommitWork> {
        if scope == CommitScope::Published {
            self.diagnostic_admission()?;
        }
        self.native.begin_commit(scope)
    }
    pub fn complete_commit(&mut self, completion: CommitCompletion) -> Result<bool> {
        let receipt = self.native.complete_commit(completion)?;
        let checked = (|| {
            match &receipt.success.history {
                Some(CommitOutcome::Committed{record,..})=>{
                    let handles=layerfs_persistence::Handles::open_read_only(layerfs_persistence::PersistenceConfig::sqlite(&self.store_path).with_sqlite_profile(layerfs_persistence::SqlitePersistenceProfile::Disposable),&self.binding.catalog,self.binding.cursor).map_err(failed)?;
                    let stored=handles.history.commit(record.id).map_err(failed)?.ok_or_else(||failed("published Commit absent on independent reopen"))?;
                    if stored!=**record{return Err(failed("independent immutable history differs from original publication"));}
                    println!("OVERLAY_COMMIT kind=Committed scope=published id={:?} root={:?} parent={:?} via=Workspace saved_bytes={} open_handles={}",record.id,record.root,record.parent,receipt.success.saved.stored_bytes,receipt.open_handles);
                    self.commits.push(record.id);
                }
                Some(CommitOutcome::UpToDate{head,root})=>println!("OVERLAY_COMMIT kind=UpToDate scope=published head={head:?} root={root:?} new_commit=false"),
                None=>return Err(failed("receipt has no known publication")),
            }
            println!(
                "OVERLAY_COMMIT_INSTALLED active={} revision={} captures_released=true",
                receipt.frontier.active.number(),
                receipt.frontier.revision
            );
            Ok(receipt.changed)
        })();
        if checked.is_err() {
            self.retained_receipts.push(receipt);
        }
        checked
    }
    pub fn commit(&mut self, scope: CommitScope) -> Result<bool> {
        let work = self.begin_commit(scope)?;
        self.complete_commit(work.run())
    }
    pub fn close_state(&self) -> CloseState {
        let mut value = self.native.close_state();
        if !self.retained_receipts.is_empty() {
            value.retained = 1;
        }
        value
    }
    pub fn prepare_close(&mut self) -> Result<()> {
        self.diagnostic_admission()?;
        self.native.prepare_close()?;
        println!("NORMAL_CLOSE_PREPARED tracked_references=0 commit=false capture=false admission_fenced=true");
        Ok(())
    }
    pub fn end_close_coordination(&mut self, token: u64, prepare: bool) -> Result<()> {
        self.native.end_close_coordination(token, prepare)?;
        if prepare {
            println!("NORMAL_CLOSE_PREPARED tracked_references=0 commit=false capture=false admission_fenced=true");
        }
        Ok(())
    }
    pub fn observe(&self) -> Result<()> {
        let state = self.native.status()?;
        let op = self.native.operation()?;
        let resources = op.overlay().resources().map_err(failed)?;
        println!("OVERLAY_STATE revision={} active={} captured={:?} payload_bytes={} inode_rows={} handles={} publications={}",state.frontier.revision,state.frontier.active.number(),state.frontier.captured.map(|g|g.number()),resources.counts.payload_bytes,resources.counts.inode_rows,state.handles,state.publications);
        Ok(())
    }
    pub fn finish(&mut self) -> Result<()> {
        if self.native.close_state().prepared == 0 {
            self.prepare_close()?;
        }
        self.observe()?;
        let requests = self.native.requests();
        self.native.finish_after_native_drain()?;
        let work = requests.work().map_err(failed)?;
        println!(
            "NATIVE_REQUESTS_DRAINED active={} retained={} requests={} completed={} terminal={}",
            work.active, work.retained, work.requests, work.completed, work.terminal
        );
        println!(
            "OVERLAY_CLOSED real_overlay=true commits={}",
            self.commits.len()
        );
        Ok(())
    }
    pub fn published_byte(&self, path: &str) -> Result<u8> {
        self.diagnostic_admission()?;
        validate(path)?;
        let stat = self.native.stat_path(path)?;
        let mut bytes = Vec::new();
        self.native.read_published(stat.serial, 0, 1, &mut bytes)?;
        bytes
            .first()
            .copied()
            .ok_or_else(|| refused(0xc0000011, "published file empty"))
    }
    pub fn latest_commit_index(&self) -> Result<usize> {
        self.commits
            .len()
            .checked_sub(1)
            .ok_or_else(|| refused(0xc000000d, "no Commit"))
    }

    pub fn capture(&mut self) -> Result<()> {
        self.diagnostic_admission()?;
        if self.native.status()?.coordinating {
            return Err(refused(
                0x80000011,
                "close coordination holds name admission",
            ));
        }
        if self.native.close_state().pending_commit != 0 {
            return Err(refused(0x80000011, "Commit already admitted"));
        }
        if self.capture.is_some() {
            return Err(refused(0x80000011, "capture already held"));
        }
        let op = self.native.operation()?;
        let capture = op
            .overlay()
            .capture(op.workspace().route())
            .map_err(failed)?;
        let reader = op
            .overlay()
            .acquire_captured_reader(op.workspace().route(), capture, 9001)
            .map_err(failed)?;
        println!(
            "OVERLAY_CAPTURE generation={} revision={}",
            capture.generation.number(),
            capture.revision
        );
        self.capture = Some((capture, reader));
        Ok(())
    }

    pub fn captured_bytes(&self, path: &str) -> Result<Vec<u8>> {
        validate(path)?;
        // This small control read checks one newly created root file only; real
        // nested Commit construction is handled by CapturedNamespace, not here.
        if path == "/" || path.trim_start_matches('/').contains('/') {
            return Err(refused(
                0xc00000bb,
                "diagnostic captured read admits a new root file only",
            ));
        }
        let (_, reader) = self.capture.ok_or_else(|| failed("no capture"))?;
        let op = self.native.operation()?;
        let entry = op
            .overlay()
            .reader_directory_entry(
                op.workspace().route(),
                reader,
                self.native.mount().root_serial(),
                path.trim_start_matches('/').as_bytes().to_vec(),
            )
            .map_err(failed)?
            .ok_or_else(|| failed("captured new name missing"))?;
        let serial = entry.serial.ok_or_else(|| failed("captured whiteout"))?;
        let read = op
            .overlay()
            .captured_read(
                op.workspace().route(),
                reader,
                serial,
                0,
                layerfs_overlay::READ_WINDOW as u32,
            )
            .map_err(failed)?
            .ok_or_else(|| failed("captured new payload missing"))?;
        if read.span.is_some() || !read.references.is_empty() {
            return Err(failed("new-file capture unexpectedly inherited"));
        }
        Ok(read.data)
    }

    pub fn release_capture(&mut self) -> Result<()> {
        let (capture, reader) = self
            .capture
            .ok_or_else(|| refused(0xc000000d, "no diagnostic capture"))?;
        let op = self.native.operation()?;
        op.overlay()
            .release_captured_reader(op.workspace().route(), reader)
            .map_err(failed)?;
        op.overlay()
            .resolve_failed(op.workspace().route(), capture)
            .map_err(failed)?;
        self.capture = None;
        println!("DIAGNOSTIC_CAPTURE_RELEASED publication=false");
        Ok(())
    }

    pub fn committed_bytes(&self, index: usize, path: &str) -> Result<Vec<u8>> {
        validate(path)?;
        let id = *self
            .commits
            .get(index)
            .ok_or_else(|| refused(0xc000000d, "Commit index absent"))?;
        let mut saved = crate::saved::Saved::open_commit(
            &self.store_path,
            &self.binding.catalog,
            self.binding.cursor,
            id,
        )
        .map_err(failed)?;
        let name = path.trim_start_matches('/');
        let entry = saved
            .entry(name)
            .map_err(failed)?
            .ok_or_else(|| refused(0xc0000034, "committed path absent"))?;
        if entry.directory || entry.size > 1024 * 1024 {
            return Err(refused(0xc00000bb, "diagnostic snapshot read scope"));
        }
        saved.read(name, 0, entry.size as u32).map_err(failed)
    }
}
fn validate(path: &str) -> Result<()> {
    if path == "/" {
        return Ok(());
    }
    let rest = path
        .strip_prefix('/')
        .ok_or_else(|| refused(0xc000000d, "absolute path required"))?;
    if rest.is_empty() {
        return Err(refused(0xc000000d, "empty path"));
    }
    for name in rest.split('/') {
        crate::saved::validate_name(name).map_err(|e| refused(0xc000000d, &e))?;
    }
    Ok(())
}
