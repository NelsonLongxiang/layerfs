# ProjFS feasibility probe

> Status: Experimental diagnostic; not a product contract or Workspace implementation.

Four bounded experiments share the same ProjFS callbacks. `live` serves a 96 KiB
fixed sample and exercises local mutations. `store-live` creates a new Disposable
LayerFS Store, pins one published root, and reads directory metadata and binary
ranges through public Persistence/Storage/Content ports. It then advances the
Branch with a separate normal Store call and verifies the projection still reads
the pinned version. Original input is retained at a different path, never used
by callbacks. Roots and failures are retained.

The tool uses existing first-party libraries and windows-sys 0.61.2; registry
versions/checksums in its independent lock match the product lock. ProjFS is
dynamically loaded only from System32, so absent components refuse explicitly.

Build first, then run each test invocation with a wall timeout <=120 seconds:

```powershell
cargo +1.85.1 build --manifest-path tools/projfs-probe/Cargo.toml --offline --locked --target-dir tmp/projfs-probe-target
cargo +1.85.1 test --manifest-path tools/projfs-probe/Cargo.toml --offline --locked --target-dir tmp/projfs-probe-target --no-run
# Run the built test binary under a <=120-second ceiling.
tmp/projfs-probe-target/debug/layerfs-projfs-probe.exe check
tmp/projfs-probe-target/debug/layerfs-projfs-probe.exe live D:/workspace/layerfs/tmp/projfs-proof-<unique>
```

The reproducible CLI smoke covers bad arguments, guarded internal-child mode, API load,
relative-root refusal, existing-root refusal with byte-exact sentinel preservation,
and one fresh live projection. It keeps every receipt and does not delete the roots:

```powershell
node tools/projfs-probe/tests/smoke.mjs tmp/projfs-probe-target/debug/layerfs-projfs-probe.exe tmp/projfs-proof-<unique>
```

Exit 0: the selected probe passed. Exit 2: ProjFS unavailable. Exit 1: failed proof
or invalid input. The live child has a 15-second bound; run the provider itself
under an explicit <=120-second wall timeout too. Never reuse a failed root.

The `live` mode alone proves no Store integration. The `store-live` mode proves
only a pinned read-only Store source for this fixture, not a writable Workspace
or capture-to-Commit. Hydrated/full files live on NTFS; notifications do not
establish a stable Overlay frontier.
No Docker, WSL, Windows feature installation, mount on an existing project, or host
restart is performed. Do not label compilation or unit tests as a live mount PASS.

The explicit unavailable path is implemented via System32-only dynamic loading.
It is not synthetically forced: the final host has ProjFS available, so a missing-DLL
execution is NOT_RUN at that final state. Do not disable the system feature to test it.
The probe uses re-execution of its own binary as an ordinary native child, not a shell
sandbox; it launches no descendants. The separate capture-live counterexample below
checks mapped-write lifetime, not a stable capture implementation.
Notification storage is capped at 1024 only for this bounded diagnostic and overflow fails
the proof. It is not a proposed production cap. The original, renamed and other local
files remain under the test-owned root after stopping the provider.

Toolchain: builds/tests/Clippy use 1.85.1; formatting used the installed default
rustfmt because the 1.85.1 rustfmt component was absent. No toolchain was installed.
The initial overflow test accidentally addressed exact EOF (a legitimate no-op);
it now tests an overflowing length from inside the range and separately asserts EOF.
The original failure is retained in the issue-352 test receipts.

Live result and exact limits: [2026-11-01 probe record](../../core/docs/issues/352/PROJFS-PROBE-2026-11-01.md).

## Real Store read projection

Fixed-source live proof: [Store read result](../../core/docs/issues/352/PROJFS-STORE-READ-2026-11-01.md).

```powershell
tmp/projfs-probe-target/debug/layerfs-projfs-probe.exe store-live D:/workspace/layerfs/tmp/store-projection-<unique>
node tools/projfs-probe/tests/store-smoke.mjs tmp/projfs-probe-target/debug/layerfs-projfs-probe.exe tmp/store-proof-<unique>
```

The source is a read-only SQLite session using explicit Disposable/WAL/OFF.
Opening a pin reads a small metadata root, not zero physical I/O. Before ordinary
file access, directory-list and file-range counters must remain zero. The live
proof checks 80 directory names (crossing the 64-row Content page), nested binary
ranges, a Unicode name and an empty file. It leaves a 2 MiB file unrequested and
unmaterialized. OS read-ahead may hydrate the **entire opened file**: four small
application reads do not imply four small provider reads or a cold-cache claim.

Read-only refers to the Store source, not a security sandbox. Projected existing
file writes/rename/delete are refused, but new local NTFS files are allowed and
retained; the test verifies they do not enter the Store. This is not writeback.
The separately advanced Branch is an ordinary `files::commit` used to challenge
pin stability, never claimed as Commit of projected changes.

Diagnostic limits: up to 1024 entries per listed directory, up to 1 MiB per Content
range read (larger callback demands are chunked), one source mutex, 1024 notification
records. Reaching a bound fails rather than truncates. This slice supports exact
UTF-8 spellings, regular files and directories. Symlinks, unpaired surrogates,
Win32-special names and duplicate ProjFS ordering refuse; case aliasing, hard-link
semantics, GC under concurrent ownership and general repository projection are
not qualified. No root/API/engine files or manifests are changed.

## NTFS capture and mapped-view boundary

The separate `capture-live` mode uses the mutable fixed fixture, not the read-only
Store source. It probes one ordinary file under a new NTFS projection:

```powershell
node tools/projfs-probe/tests/capture-smoke.mjs tmp/projfs-probe-target/debug/layerfs-projfs-probe.exe tmp/capture-proof-<unique>
```

- A read handle with only FILE_SHARE_READ refuses while an external writer or
  writable mapping exists (Win32 32). In the mapping case both the child's File
  and section HANDLE are closed; only its mapped view remains.
- When that handle is acquired with no writer, a new writer in both parent and
  child is refused. The held handle reads the same byte again. This is a bounded
  **per-file** input-admission control, not a namespace capture or active COW.
- A separate permissive read plus LockFileEx does **not** freeze the child's
  writable view. The parent observes the changed byte through its own read-only
  mapped view. File length/mtime and notification counts are observations only.
- PrjStopVirtualizing returns while the child still owns its mapping. A subsequent
  mapped store is visible although no new callback runs. Provider drain is not an
  external-reference fence. The local full file is retained after stop.

There is no FlushViewOfFile, fsync, Durable run, user-process cancellation or
mapping-enumeration heuristic. File-view accesses use raw volatile one-byte
operations within a 4 KiB view; no Rust reference to externally mutable memory is
created. Anonymous section handles are dropped after mapping, and views are
explicitly unmapped with checked outcomes. Only the owned diagnostic child may be
cancelled on failure; all roots and phase markers are retained.
The two-process handshake has a 15-second absolute deadline per participant;
each CLI child has a 30-second bound and the suite uses an explicit <=120s bound.
This is not a performance measurement or power-loss persistence proof.

A successful restrictive open can admit stable bytes for this one known regular
file; it does not freeze directory membership, collect an atomic multi-file
frontier, allow later writes into a new Overlay generation or implement full
repository semantics. **Do not pass permissively opened or post-stop mutable
NTFS files as captured input to Save.** A sharing refusal remains a refusal, not
an automatic wait/retry or a reason to switch to the permissive counterexample.
Workspace capture/Commit remain Unsupported and W2/W3/W4 are not promoted.

## Namespace guard boundary

The separate namespace-live mode retains a read + FILE_SHARE_READ directory
handle and one protected file handle, then launches an ordinary process. The
protected file write and a root-level rename refuse Win32 32. Creating a
subdirectory/file, writing another file, deleting another file and renaming a
nested file still succeed. A directory handle is not a recursive snapshot.

```powershell
node tools/projfs-probe/tests/namespace-smoke.mjs <probe-exe> <fresh-output-directory>
```

The first diagnostic expected the root rename to succeed and failed; its root
and output are retained. The corrected test asserts the exact observed operations,
not a universal claim about every rename path or Windows version. It does not
implement multi-file capture, mutation generations or Commit. See the
[native request-path result and next step](../../core/docs/issues/352/WINDOWS-NATIVE-REQUEST-PATH-2026-11-01.md).

## WinFsp -> real Rust Workspace/Overlay bridge

The diagnostic library is now named layerfs_native_probe (rlib + cdylib), keeping
its PDB name distinct from the existing layerfs-projfs-probe CLI on Windows.
Existing ProjFS CLI modes are unchanged. The first-party dependencies are the
already locked layerfs-workspace and layerfs-overlay crates, not a new database
or filesystem encoder. Root manifests/lock and product sources are unchanged.

The C++ native host in ../winfsp-probe.cpp now delegates its state to this Rust
library: one real Disposable Store fixture, one bound Workspace and the existing
MEMORY/OFF/EXCLUSIVE Overlay owner. No C++ file-content array remains. The bridge
uses public StoreService/BoundWorkspace, Mutation and native kernel read/open/close
ports. File identities and serial ranges come from those ports, never a local
inode counter. FFI request tokens are not inode identities.

Build this library/CLI as above, then the native host using ../winfsp-build.ps1.
Run (from repository root) under a <=120-second ceiling:

```powershell
node tools/winfsp-smoke.mjs <native-host-exe> <installed-WinFsp-dll> <target>/debug/layerfs_native_probe.dll <target>/debug/layerfs-projfs-probe.exe <fresh-output>
```

The ordinary Windows process reads an existing Store file, writes/reads 300KB
through bounded Overlay windows, truncates, renames, deletes and recreates with a
new inode. A descriptor remains open across capture; after a later write the live
file changes while the retained captured reader still yields the old bytes.
The first write is closed before capture so the test does not pretend dirty kernel
cache bytes have already been published. Cleanup keeps descriptor ownership;
Close releases its exact OpenFile/KernelDirectory and lookup reference.
The direct Rust integration tests additionally read/write an unlinked open file,
move a directory between parents, reject nonempty deletion and cycles, enumerate
80 base entries, and rebind the same Store after releasing the first owner.
The small captured-byte control remains intentionally limited to one newly created
root file; actual nested Commit construction belongs to CapturedNamespace.

This is a non-shipped integration slice, not the product Workspace API. Exact
UTF-8 nested paths, mkdir, cross-directory rename, rmdir and handle-scoped directory
listing use existing Workspace ports. Links, complete Windows metadata/security
changes and mapped writes remain unqualified. Ordinary file callbacks and short
control bookkeeping still serialize through the diagnostic Session mutex; the
long captured Commit construction/Save/publication now runs outside that mutex.
The deterministic post-capture mutation proof below covers this one interleaving,
not arbitrary concurrent callbacks or every native callback reply/capture order.
The existing Mutation reply-attempt boundary is reused.
Unknown owner errors latch refusal and retain custody instead of cleanup/replay.

The independent diagnostic capture is explicitly released/resolved with no history
publication. Then commit_captured takes its own new capture and runs the existing
CapturedNamespace -> Save::finish -> History -> local install. Two real Commits are
read back by History id while native descriptors stay open across publication;
a later write and a new file appear only in the second immutable snapshot. An
unchanged third call must return UpToDate without adding a Commit. After the
provider exits, the supplied checker process reopens the Store read-only and
checks both versions' exact sizes/bytes, parent relation, via=Workspace, head and
unchanged base directory membership. The harness then starts a second native
provider process over that exact Store path, with a fresh local Overlay owner and
mount. Session::reopen calls no Fixture::create/Project Init: it reads the committed
nested tree and its no-change Commit returns UpToDate. Both owned mounts must be
removed after stop; no extra History record is created. This is not a power-loss
or concurrent-mount proof. These legacy fixture wrappers retain a fixed synthetic
Workspace authority only for their sequential use; the explicit-binding path below
takes independent caller-owned identities and proves a bounded dual-mount scenario.

No fs.apply, re-Init after mutation, native-tree scan/copy, manual SQL or alternate
content encoding is used. A failed Commit retains its exact original failure;
a failed post-publication audit retains the known success receipt too. The host
never retries an uncertain publication. Product Workspace API, general concurrency,
mapped writes and full-repository qualification remain NOT_RUN.

## WinFsp cache / writable-view boundary

The native host's optional --cache-boundary mode observes eight ordinary-process
checkpoints. The client performs one ordinary write and two writable-view stores,
closes File and section HANDLE separately from the view, then unmaps and reopens.
It never calls FlushViewOfFile, FlushFileBuffers, sync_all or a Store API.

Run under an explicit <=120-second wall ceiling from the repository root:

```powershell
node tools/winfsp-cache-test.mjs <native-host-exe> <installed-WinFsp-dll> <target>/debug/layerfs_native_probe.dll <target>/debug/layerfs-projfs-probe.exe <fresh-output>
node tools/winfsp-cache-test.mjs --self-test <fresh-output>/result.json
```

The host reads published bytes through SourceView::read, not through Windows
file APIs, and reads saved bytes through an independently opened immutable
Commit. Its phase labels for application values are cross-checked against the
ordinary client's actual read/view values. Observations retain all three values
separately. The parser checks exact phases, captured content, known written byte
ordering, actual same-handle Cleanup/Close ordering and Commit/frontier agreement;
ten falsifying variants must reject, including missing/refused guarantee checks.
A separate read-only process verifies the
History chain, all 4096-byte snapshots, exact unchanged tails and final byte.

Current actual evidence shows a writable mapping can expose 67/68 to the application
while published Overlay and Commit still contain 66. File/section closure and
Unmap alone do not establish publication; after a later ordinary open/read/close,
a constrained Write arrived after Cleanup but before Close and published 68.
This describes the retained trace, not a deterministic flush trigger or a timing
promise. No extra sleep, retry or explicit flush was added to obtain it.

A PASS here means the bounded observation/consistency checks passed. It is **not**
mapped-write qualification. UpToDate is relative to the published frontier,
not proof of no dirty kernel pages. The existing StoreOpen clipping and retained
OpenFile custody are tested separately: cached writes cannot extend EOF, writes
beyond EOF are no-ops, and stale handles refuse. ConstrainedIo means no extension;
it is not, by itself, proof that a request originated from a mapping.

Keep this limitation in any product-readiness claim. Do not silently add a blocking
flush while holding the bridge mutex, infer dirty-view absence from descriptor
counts, or declare an arbitrary delay a drain. Mapping admission/coherence and
concurrent capture/reply semantics remain separate engineering work.

## Explicit Commit guarantee admission

There is no default diagnostic Commit guarantee. Session::commit takes CommitScope;
the C ABI is lf_commit_scoped(scope, changed), replacing the old unscoped symbol.
This is an internal diagnostic ABI change, not a product SDK contract change.

- scope=1 / Published runs the existing captured Commit over the locally published
  Overlay frontier. Both Committed and UpToDate explicitly report scope=published.
  Open file handles remain permitted; this is not a new all-handles-closed gate.
- scope=2 / ApplicationVisible requests all application-visible cache/mapping bytes.
  It returns STATUS_NOT_SUPPORTED (0xc00000bb) before capture, Save or History,
  even when no current handle happens to be visible. No fallback or implicit flush.
- 0 and unknown codes return STATUS_INVALID_PARAMETER (0xc000000d). Rejected calls
  leave the caller's output sentinel untouched. A later explicit Published request
  is a different guarantee, not replay of the refused operation.

The cache experiment requests/refuses the stronger guarantee at all eight real
lifetime phases, then explicitly requests the existing published-frontier behavior.
Direct Rust tests compare the exact Overlay generation/revision/capture state and
History snapshot before/after refusal, before/after publication and while a separate
capture exists. No guess about dirty sections is derived from descriptor counts.

Pinned WinFsp v2.2B5 source explains why changing DisableCache is not a mapping gate:
create.c assigns SectionObjectPointer independently of FO_CACHE_SUPPORTED, and only
sets FO_CACHE_SUPPORTED for FileInfoTimeout=INFINITE plus allowed per-open caching.
Our FileInfoTimeout=0 already takes the noncached ordinary I/O route. The native
section callbacks in callbacks.c synchronize kernel resources without a user-mode
per-section admission callback. A share-denying open can detect writable sections
for that one file; it is not a recursive namespace snapshot or a complete capture
boundary. This is not a claim that no Windows mechanism could ever solve the gap.

The implementation rejects an unimplemented stronger guarantee. It does not prevent
mapped stores, synchronize dirty mappings, improve crash recovery or qualify the
product Workspace. Revisit those capabilities only with their own executable proof.

## Published Commit with post-capture native mutations

Commit admission returns one owned CommitWork containing the bound Workspace and
its before-snapshot; running it consumes the work and returns one CommitCompletion.
Only the admitting Session can settle that original result. The FFI releases the
Session mutex during the unchanged commit_captured call, then reacquires it for
settlement. Ordinary file operations can proceed while that Commit owns its captured
frontier. Another Commit, explicit capture or terminal close returns STATUS_DEVICE_BUSY
(0x80000011) until settlement, including after the worker has completed but before its
result is settled. Unknown/panicked/foreign results retain original ownership instead
of replay or guessed cleanup. Dropping work does not silently cancel its admission.

The previous diagnostic 0xc00000aa used as Busy was incorrect (Windows defines it
as STATUS_INSTRUCTION_MISALIGNMENT). Current code and assertions use the actual
STATUS_DEVICE_BUSY; historical receipts remain unchanged.

Run the first-party integration test binary under <=120 seconds, and native proof:

```powershell
node tools/winfsp-concurrent-test.mjs <native-host-exe> <installed-WinFsp-dll> <target>/debug/layerfs_native_probe.dll <target>/debug/layerfs-projfs-probe.exe <fresh-output>
```

A guarded child opens the existing Disposable Store and holds its public History
publication lane for at most 15 seconds. No new product lock, test hook or alternate
constructor is added. This is a deliberate test-only Store-writer contention control,
not normal wiring or a performance measurement; writable open still pays its ordinary
setup. The unchanged Commit captures, then cannot publish until this lane is released.
The host observes capture through public Overlay state, not a guessed sleep.

While that first Commit is pending, ordinary Windows calls write the already-open file
and create another file. The host confirms active generation/revision progressed while
the captured generation stayed fixed and the worker had not finished. Only then does
the test release the lane. First Commit bytes remain old; known Install keeps the later
active bytes and creation. A second explicit Commit includes them. An independent
read-only process checks both exact historical versions and base membership.

This qualifies a bounded one-Workspace/one-Commit-versus-mutation interleaving, not
multiple concurrent publishers, arbitrary callback concurrency, cache/section drain,
crash recovery or ApplicationVisible semantics. No forced caller unmap or flush is used.

## Normal close admission before native stop

StopDispatcher/STOP0 is not a reversible busy probe: the pinned native driver
stops its request queue, drains dispatcher threads and then cancels remaining IRPs.
The diagnostic now calls prepare_close before any stop or detach. Under the same
Session admission mutex it refuses retained failure, pending/unsettled Commit,
owned capture, or any tracked OpenFile/KernelDirectory. A refusal leaves the
Session and mounted service unchanged. Application File closure is not used in
place of the exact native Close callback, including when a mapped view remains.

When admission succeeds, closing fences subsequent file/open/create/capture/Commit
operations before the mutex is released. The host then performs dispatcher stop,
mount removal, kernel revoke and Overlay close. finish_started prevents a second
terminal attempt after any partial result; uncertainty is retained, not replayed.
The independent diagnostic capture must now be explicitly released first, never
silently discarded by finish. This preserves the distinction from a real Commit.

The host consumes each stop request once. A Busy response does not invoke stop or
unmount, and subsequent ordinary file access must still work. After the external
owner releases its references, a **new explicit request** may close. Tests can ask
close-inspect to observe adapter Close receipts, but that observation is not close
admission: prepare_close rechecks and fences atomically, so new opens can still
make the later request Busy. No fixed sleep/retry or forced caller cancellation.

```powershell
node tools/winfsp-close-test.mjs <native-host-exe> <installed-WinFsp-dll> <target>/debug/layerfs_native_probe.dll <target>/debug/layerfs-projfs-probe.exe <fresh-output>
node tools/winfsp-close-test.mjs --self-test <fresh-output>/result.json
```

The ordinary client retains a file, then directory, then writable view with File
open, then view-only after File and section HANDLE close. Each normal-close probe
must refuse before effect, and reads/enumeration/view writes remain usable. A real
stop request with another external file open must also refuse; after release, a
new stop request has an ordered prepared -> dispatcher drain -> Overlay close trace.
C++ drain output is flushed before calling Rust finish so receipt order is causal.

CloseState is an adapter reference inventory, not a universal kernel section or
cache-dirty inventory. The tests know which external references they created and
verify their release; they do not qualify every hidden mapping/cache/ref race,
forced teardown, crash recovery or full product Workspace. Error/timeout exit is
reported as DIAGNOSTIC_EXIT_NOT_NORMAL rather than claiming a successful close.

## Explicit existing-Store binding and independent Workspaces

Session::bind_existing takes a validated Binding: catalog binding bytes, cursor
capability, tagged Branch identity and caller-owned Workspace incarnation. The
core bind, immutable Commit reads and publication checks use that binding, not
fixture constants. The caller is responsible for a distinct nonzero Workspace
incarnation; this adapter does not derive authority from a mount path or provide
a fleet-wide duplicate-incarnation registry. Missing Branch, protected main,
wrong catalog, malformed input and existing work roots refuse without fallback.
Legacy Session::create/reopen and the original host fixture modes remain test-only
conveniences; they explicitly pass the synthetic fixture binding to the same core.

The host mode is:

```text
winfsp-probe.exe <installed-WinFsp-dll> <fresh-mount> <fresh-control> <Rust-dll> --bind-stdin <existing-Store>
```

Send exactly one binary bootstrap frame to stdin then close the pipe: ASCII magic
LFSBND01 (8 bytes), little-endian u16 catalog length (1–128), catalog bytes, cursor
capability (32 bytes), tagged Branch ID (17 bytes), Workspace ID (32 nonzero bytes).
The maximum valid frame is 219 bytes; one extra byte is read to reject oversized
input. Wrong width/tag, empty cursor and zero Workspace are refused. No input frame
or capability is logged, placed in argv, or written to a bootstrap file; the backing
Store retains its ordinary catalog identity, not an extra credential copy. This
is not an authenticated remote protocol or a cryptographic memory-erasure claim.
The caller owns stdin completion; test subprocesses have explicit wall deadlines.

```powershell
node tools/winfsp-binding-test.mjs <native-host-exe> <installed-WinFsp-dll> <target>/debug/layerfs_native_probe.dll <target>/debug/layerfs-projfs-probe.exe <fresh-output>
```

The test initializes one fresh synthetic Store through existing Project Init with
non-default catalog/cursor/Branch input. Two native processes bind that exact Store
with different Workspace incarnations, separate template/Overlay files and separate
handles. Ordinary writes remain local until each explicit Published Commit. B's
clean merge incorporates A's published change; A's mounted view remains at its own
installed base. Closing A removes only A's Overlay; B's open descriptor still reads,
writes and commits. A third fresh native mount sees the latest committed tree and
its UpToDate adds no History. An independent read-only process checks all three
versions, exact bytes, parent chain, branch and unchanged base membership.

A safe Rust case deliberately lets B advance the global head before A settles an
already completed Commit. Settlement now validates the returned merge parent,
immutable History record and this Workspace's known install, not a moving global
head. This corrects a diagnostic false failure; it does not change product merge
semantics, force-overwrite policy or retry an operation. Conflict/unknown custody
still retains the original result. Simultaneous Commit construction, conflicting
edits, cross-process duplicate identities, kernel cache coherence for all merges,
crash recovery, mappings and product SDK integration remain outside this proof.

## Native basic metadata and ordinary Git

SetBasicInfo now maps represented fields to public Workspace operations rather
than succeeding with a process-local flag table. CreateWindows initializes flags
atomically; OverwriteWindows truncates and replaces/merges them in one publication.
Hidden/System/Archive survive capture and Commit in Content's opaque attribute tree,
with generation-owned storage in Overlay schema40; ReadOnly maps to portable mode.
Attribute-only handles do not acquire data-write permission at the native bridge.
The four reported Windows times remain projections of one portable mtime: a request
for distinct creation/access/change times is refused before any effect. This is not
full NTFS metadata support. Project Init's original metadata-import scope is unchanged.

Non-root directory enumeration returns dot entries from the exact directory owner
and its retained current parent, including empty and moved directories. It does not
persist dot names into the namespace or infer parents by scanning paths.

The bounded ordinary Git harness uses a new synthetic Store and test repository,
explicit stdin binding, isolated per-process Git config/template/identity, and real
Windows Git file calls. It never alters global Git configuration or existing repos:

```powershell
node tools/winfsp-git-test.mjs <native-host> <installed-WinFsp-dll> <Rust-dll> <checker-exe> <git-exe> <fresh-output>
```

Git init/add/two commits/status/fsck and LayerFS Commit plus exact file-hash remount
checks have run, including .git/index, objects, refs and ignored content. The complete
harness is still FAIL if its second mount cannot close: in the retained final run,
eight files had Cleanup but not Close after Git exited. It keeps the data checkpoint
separate from normal-close qualification and does not relax the close guard, force
flush/unmap, extend waits or reinterpret test-process cancellation as normal unmount.
See the [metadata/Git result](../../core/docs/issues/352/WINFSP-GIT-METADATA-2026-11-02.md).

## Read-only section lifetime diagnosis

The Git close failure is now correlated by native token: one index and seven loose
object handles were opened read-only, each received Cleanup, and none received
Close within the unchanged ten-second readiness window. The Rust bridge correctly
retains those exact OpenFile owners; this observation alone is not a full kernel
section inventory or proof of which internal component owns the remaining reference.

Set LAYERFS_NATIVE_TRACE_HANDLES=1 on the diagnostic host to record token, serial,
access/cleanup flags, name and sequence for open/create/Cleanup/Close. Output is
capped at 20,000 events with an explicit saturation marker; this is a trace cap, not
a filesystem admission limit. The audit refuses saturated or incomplete traces.
Native provider logs go directly to task-local files in the Git harness. Draining
a provider pipe on the same Node event loop that synchronously runs Git can block
the native callbacks when the pipe fills; file-backed output avoids that test bug.

```powershell
node tools/winfsp-mapping-lifetime-test.mjs <native-host> <installed-WinFsp-dll> <Rust-dll> <client-exe> <fresh-output>
node tools/winfsp-handle-trace.mjs <result.json>
node tools/winfsp-handle-trace.mjs <result.json> --self-test
```

The minimal caller reads the same existing Store-backed file in three separate
mounts: ordinary read, readonly mapping released before File closure, and File
closed while its readonly view remains before UnmapViewOfFile. The first two close
normally. The third has application exit0 yet one Cleanup without Close, so a new
normal-stop request returns Busy and the isolated test provider is cancelled after
the recorded refusal. Harness exit0 means the observation completed and audited,
NOT that every arm closed normally. Host timeouts, missing outcomes and forged
completion are rejected. No flush, forced caller unmap or early Rust release occurs.

Pinned Git-for-Windows source uses the third ordering for loose objects. The result
is reproducible without Git, mutations or Commit, but the missing Close has not
been traced inside the kernel; the cause remains narrower than a general driver
leak claim. Ordinary cached access, notifications and irreversible STOP are not
promoted to reliable drain/fence mechanisms by this evidence. The original Git
qualification stays FAIL; [lifetime report](../../core/docs/issues/352/WINFSP-READONLY-LIFETIME-2026-11-02.md).

## Ordinary readonly reopen: observed Close coordination

A further isolated test keeps the File-first readonly view alive while normal stop
returns Busy, then reads the same file through a second ordinary handle. Both that
read and the original view remain valid; the original token still has no Close.
The view owner then unmaps and exits. No original Close arrives during the unchanged
ten-second readiness observation. One new readonly open/read/close on that exact
file is followed by the real Close callback for the original token; only then does
a distinct normal-stop request prepare, drain and detach. No backend or host
lifecycle code changes for this experiment.

```powershell
node tools/winfsp-reopen-test.mjs <native-host> <installed-WinFsp-dll> <Rust-dll> <client-exe> <fresh-output>
node tools/winfsp-reopen-test.mjs --self-test <fresh-output>/result.json
```

This is a measured single-file sequence, not a universal kernel fence. The test
knows the exact unchanged filename, original token, and when its own view is
released; rename/unlink, writable mappings, foreign owners and concurrent namespace
changes remain outside the evidence. The adapter cannot infer the owner's Unmap
from Cleanup or turn a path reopen into permission to discard original custody.
The installed FlushAndPurgeOnCleanup setting may perform its existing kernel cleanup
work; the caller issues no explicit flush, notification or forced Unmap. No automatic
reopen sweep is installed in normal close. General-close qualification stays false,
and the original Git full-lifecycle FAIL remains until independently fixed and rerun.
See the [reopen coordination result](../../core/docs/issues/352/WINFSP-READONLY-REOPEN-2026-11-02.md).

## Explicit identity-checked coordinated close

The native host now accepts `stop-coordinate` as a separate explicit terminal
request. The existing `stop` path is unchanged: it refuses owned references before
effects and does not silently select the new operation. A Busy coordination request
is consumed once; an owner may release its view and issue a distinct
`stop-coordinate-after-release` request. No candidate is reopened in a retry loop.

Session records Cleanup independently from Close and keeps a path hint only while
it names a known handle. Admission requires all remaining handles to be cleaned,
named readonly files, with no Commit/capture/unknown custody. A request token fences
name changes, new write/delete/control opens, ordinary mutations and capture/Commit
while allowing reads and actual Cleanup/Close. Candidates stream by original token
up to the request's fixed upper cursor; new readonly opens are not added to the pass.
Rename updates open-handle hints by path component, and unlink/replacement invalidates
the displaced owner's hint. This costs a linear pass over open state, not a whole
namespace scan; large-open-state latency is not qualified by these small fixtures.

For each candidate Session resolves its current name and serial while the name
admission is held. Outside the Session mutex, the host opens read-only, checks the
native volume marker and index against that serial, rejects reparse/directory data,
reads at most one byte and closes the temporary handle. It never releases the original
Rust owner. Only real Close callbacks can remove original tokens. Readiness remains
bounded to ten seconds; Busy restores the reversible admission without detach.
Successful completion atomically prepares terminal close and then uses the existing
stop/drain/detach/Overlay-close path. The ten-second budget is not a cancellation or
latency guarantee for individual synchronous Windows calls.

```powershell
node tools/winfsp-coordinate-test.mjs <host> <installed-WinFsp-dll> <Rust-dll> <client> <fresh-output>
node tools/winfsp-coordinate-test.mjs --self-test <fresh-output>/result.json
# Explicitly choose this host operation for the ordinary Git workload:
$env:LAYERFS_NATIVE_COORDINATED_CLOSE = '1'
node tools/winfsp-git-test.mjs <host> <installed-WinFsp-dll> <Rust-dll> <client> <git-exe> <fresh-output>
```

The ordinary Git workload now passes with this explicitly selected close path,
including both normal provider exits and independently saved before/after file
manifests. The historical default-close FAIL and verifier snapshots stay unchanged.
Kernel tests also cover a live readonly view retaining Busy and readable I/O, and a
directory rename followed by a replacement at the old path. A mapped-source delete
returns EPERM in this WinFsp setup; that refusal is not successful-unlink coverage.
Unlink/replacement invalidation is separately covered through the Rust public port.
Unlinked, writable, metadata-writable, delete/control or active-directory owners still
refuse coordination. This does not establish complete section inventory, generic
mapping synchronization, crash recovery, or product SDK Windows Workspace support.
See the [coordinated-close result](../../core/docs/issues/352/WINFSP-COORDINATED-CLOSE-2026-11-02.md).
