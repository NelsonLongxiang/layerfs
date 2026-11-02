# Authenticated Workspace control over the direct Store

> **Status:** Implemented pre-S8 control composition after `9041f338d`; functional
> evidence is recorded in [F13](../issues/307/PRE-S8-F13-20261007.md). Kernel mount
> readiness and Bash Exec remain S8; live namespace normalization remains S10.

## Explicit JavaScript runtime consumer (2026-11-02)

[LayerFSRuntime.native](../../../api/runtime/src/index.js) now consumes the
standalone native product through its original inherited control streams. The
[manager](../../../api/runtime/src/platform/native-windows/sessions.js) validates
explicit executable/Store/work/mount and authority, claims per-runtime ownership
before awaiting, and creates a fresh Workspace identity. It does not create or
impersonate an SDK Sandbox, automatically mount from the agent SDK, or route Store
calls through a worker. Existing SDK Workspace/Sandbox refusals are unchanged.

The [process client](../../../api/runtime/src/platform/native-windows/session.js)
accepts actual root-service evidence, strictly correlates id/kind replies and
preserves all u64 fields as BigInt. Published Commit requires an explicit scope.
Native Busy keeps service usable; unmount resolves only after both terminal
acknowledgement and the exact original product process's successful close. A
readiness deadline, malformed/foreign/duplicate reply, stream EOF, unknown outcome
or failed terminal exit retains original inputs/results/process references with
sanitized errors. There is no implicit close, kill, retry or reattachment path.
A bounded diagnostic tail is not an exact stderr archive.

runtime.native.list reports process-local Session observations; runtime.close
refuses active/retained native ownership before closing clients. This runtime
surface is an explicit integration-host adapter, not workspace.mount in a running
Sandbox, remote authentication/discovery, command isolation or complete kernel
readiness. Full public contract and remaining limits are in the
[runtime guide](../../../api/docs/runtime.md#explicit-windows-native-filesystem-sessions).

## Standalone Windows inherited-stream entry (2026-11-02)

The product [layerfs-native](../../../engine/crates/layerfs-daemon/src/bin/layerfs-native.rs)
process now runs the safe Session and opens the existing Store directly. Its
[process owner](../../../engine/crates/layerfs-daemon/src/native/process.rs)
starts one explicit absolute C++ native companion and owns its process receipt.
No diagnostic DLL, fixture, host-mediated Store or Linux worker is in this route.
Catalog/cursor authority enters only the bounded inherited stdin bootstrap frame;
only mount/library paths, root serial and backing-volume path go to the child.

[Bootstrap](../../../engine/crates/layerfs-daemon/src/native/bootstrap.rs) reads
LFSBND01 once without EOF (the same stream then carries control), validates explicit
identities and zeroes its temporary capability frame. It does not promise secure
erasure. Only holders of the inherited streams can issue commands: there is no
public listener, endpoint discovery, reconnection or remote authentication claim.
After native root-service evidence, strictly increasing nonzero command ids admit
status, commit published, and unmount; each reply carries the original id. Control
records have a 128-byte processing bound; path/data transfers use separate bounded
frames, not a total Workspace/file/flow limit. A failed command is never replayed.

The private child channel uses versioned, length-bounded LFSRPC01 frames and
monotonic request/response identity. [Workspace dispatch](../../../engine/crates/layerfs-daemon/src/native/port.rs)
uses the existing Session operations, while control Commit constructs outside the
Session mutex. Output delivery likewise runs outside Session bookkeeping. Partial
input, original failed request/response bytes, typed delivery errors and uncertain
Commit receipts retain custody. Loss or protocol failure closes the inherited
child input to wake it, fences admission and returns failure, never a normal
unmount. Retention is process-local, not crash recovery or a reattachment API.

Unmount first reaches the native child. It atomically fences whole callbacks only
when idle; a Busy probe leaves callbacks usable. Session then probes descriptor,
Commit/capture/retained/request ownership. Its Busy restores native admission.
After acknowledged preparation, the companion really stops/joins and detaches the
filesystem, then requests product finish, releases native owners and sends its
terminal receipt. The parent also waits for the original child exit before
acknowledging unmount and releasing its closed Session. Zero handles alone is not
OS drain. SDK Sandbox registration, workspace.mount and ordinary Exec are still
unconnected; this is an explicit process entry, not the old Linux daemon deployment
format or Windows Service installation.

## Native Windows logical Session (2026-11-02)

[daemon::native::Session](../../../engine/crates/layerfs-daemon/src/native/session.rs)
now owns a real direct Store binding, one bound Workspace/Overlay, the logical
KernelMount, MountRequests, file/directory handle map, Commit admission and
terminal lifecycle. [Binding](../../../engine/crates/layerfs-daemon/src/native/binding.rs)
requires explicit catalog/cursor/Branch/Workspace authority. The
[startup attempt](../../../engine/crates/layerfs-daemon/src/native/startup.rs)
opens only an existing absolute Store, claims a fresh owner-only local work
directory, refuses missing/protected-main Branches, and uses the existing bounded
root bind plus kernel association. It does not import, scan or copy a Store.
BindFailure keeps the original phase/cause/intent and any initialized owners;
dropping it never guesses that partial startup can be disposed.

Native operations reuse StoreOperation lookup/Open, Workspace mutations and
bounded read/directory ports. The adapter preserves separate data/attribute/delete
access and independent lookup/Open/Cleanup/Close ownership. A typed first unknown
error and original lookup/Open failure stay shared with the caller and Session;
later admission is fenced without replay. Status observes logical binding,
frontier, requests, handle/publication counts and control flags. It proves neither
WinFsp Ready nor an arbitrary kernel section inventory. Multiple Sessions can be
held independently in one Rust process; ABI export/discovery remain separate.

[Commit](../../../engine/crates/layerfs-daemon/src/native/commit.rs) consumes one
explicit published-frontier admission, runs commit_captured outside the Session
mutex, and returns the exact completion to its original Session. Known results
retain the original CommitSuccess and installed binding/frontier in CommitReceipt.
Foreign/panicked/failed completions remain kept; dropping an unconsumed completion
retains the original result and provider instead of disposing it speculatively.
Application-visible/cache-section capture still refuses before effects. There is
no Init fallback, second producer/encoder or independent history refresh in the
product Commit path; diagnostic immutable reopen verification stays in tools.

[Normal close](../../../engine/crates/layerfs-daemon/src/native/lifecycle.rs) is
before-effect Busy while file/directory, capture, Commit, coordination, request or
retained ownership remains. Success fences receives. Only after the caller has
actually drained/detached its OS service may finish_after_native_drain check product
request finish, revoke the logical mount and close/retire the Overlay and Store.
This safe Rust method cannot establish the external native-drain precondition.
It is attempted once; incomplete/failed/live Session destruction deliberately
keeps the whole state until process exit. No forced file release or guessed
publication/rollback is added.

The WinFsp diagnostic now uses this product Session and retains only fixture setup,
explicit bootstrap framing, captured/history checks and observation logs. Its old
private Commit/close/metadata/coordination implementations are removed. The daemon
library now compiles on Windows; the old Unix-protected deployment configuration
reader remains platform-gated and explicitly Unsupported elsewhere. The inherited
stream entry above supplies an explicit native process pair; authenticated public
IPC, SDK Sandbox registration and workspace.mount remain unconnected.

Bridge control records carry typed Content/History identities and one original
correlation. They support mount binding, Store-half Commit, status, terminal
unmount, fork and bounded Commit-history pages. A history window holds at most32
records inside one8192-byte control record and resumes using the existing
160-byte authenticated cursor. These are processing windows, not ancestry/file
caps. There is no object, file-length, inode-reservation or Save data RPC.

SDK Control owns one authenticated Connection. A call encodes once, sends once
and receives the original reply once. Before-effect encoding refusal leaves the
channel alone. Failed delivery or malformed/cross-correlated replies retain the
request, attempt phase, original received answer and failed fence independently;
they never reconnect, resend, refresh history or infer rollback. Remote Busy and
other typed refusals leave the channel usable for a later explicitly requested
operation. Concurrent callers can own separate control channels.

Daemon Service uses the existing Owner's configured Workspace capacity, currently
16 by default. Brief registry admission selects an exact Workspace incarnation
and the original positive i64 namespace. A stale token never redirects to another
namespace. The mutex never spans Store reads, construction, publication or queue
waits. Commit and normal unmount arbitrate through explicit local activity state;
one wins and the other returns a typed refusal. Ordinary local projection obtains
a fresh scoped StoreOperation rather than access to bypass control Commit admission.

Mount runs the existing coherent snapshot/bounded root check/local Open and returns
Reply::Bound with the original token and binding. This is the Store/engine half of
mount; it does not claim a kernel attachment or execution directory. S8 attaches
FUSE and supplies full mount readiness. No whole-root qualification occurs here.

R8b update, 2026-10-10 (specification 4.2, D-13): registry admission of a new
incarnation, after the duplicate and capacity checks and before the entry is
created, reads the owner's retained first maintenance failure
(`OwnerClient::maintenance_failure`, a mutex read and no owner job). While one
is retained, Mount is refused `Capacity` with phase `mount:debt` and the
original error as bounded detail; no entry is created, no History or Store
read is made and no owner job is submitted. A stopped or poisoned owner keeps
its existing answer. Already bound Workspaces are not touched by this check.
Not implemented: a declared debt headroom, and maintenance failure in Status.
Proof and its scope: `layerfs-daemon/tests/mount_debt.rs`, where the retained
failure is `Quarantined` after a foreground write met a changed backing-file
identity; a maintenance turn that is itself first to meet a failing resource
is not staged.

Commit forwards the existing Content producer callback over the original capture
and saved base. No test-selected product constructor or Init cleanup exists.
Before S8, an application can build the intended changes directly through Content;
S10 supplies live Workspace normalization. The original capture/Save/history/local
install completions remain in Success or Failure independently of reply delivery.
Known publication stays known after failed local install, and unknown custody
blocks another Commit and normal unmount. An observer never resolves an unknown.

Status copies binding, control activity, known publication and diagnostic epoch
coherently under the registry owner. It then obtains one indexed engine State row,
with its own revision, generation and maintained counters. These observations
have separate scopes; the result is not an atomic snapshot of the whole daemon.
The row's values are copied and its completion is dropped before the reply is
sent, so an answered Status holds no Lifecycle slot (R6); only a failed
observation keeps its original completion with the reply.
If the engine is unavailable, its fields are absent with the original typed
observation refusal, while known control publication remains visible. The server
keeps the original failed observation receipt. There is no Store statement,
Branch refresh, payload read, checkpoint or cleanup hidden in status. Saturating
diagnostic epochs do not refuse operations.

Normal unmount refuses active or unresolved Commit custody. Otherwise it submits
one terminal Close and removes routing only after original known success. The
existing engine owns automatic bounded cleanup. The result does not claim that
all physical rows are gone or that the overlay file shrank. It never deletes
shared history. For an attached Workspace the same unmount first runs the
reversible kernel probe, connection drain and revocation described in
[native mount session](76-native-mount-session.md#normal-unmount). The explicit
force policy is a separate request, `ForceUnmount`, described in
[forced teardown](80-forced-teardown.md); normal unmount never falls back to it.

serve_one executes one authenticated request and sends one result. Served keeps
the original product outcome; ServeFailure retains it when encoding/delivery
fails. The embedding daemon owns connection admission and serving lifetimes.
No host application assembly, restart custody or remote Save runtime is added.

Concrete bootstrap exposes cumulative diagnostics for its already-open writer
and fixed readers, using Persistence's existing session counters without SQL.
This remains outside provider-independent store/. It lets the status proof count
all Store statements, including history, rather than only object demands.

The current Branch publication policy is overwrite-only: two completed candidates
from the same captured head may both publish, with the last database effect
defining the head. Each candidate retains its captured ancestry; displaced
Commits remain immutable. Native replies preserve that known result or original
unknown independently. See the [owner decision and proofs](../issues/307/BRANCH-OVERWRITE-DECISION-20261007.md);
the earlier F13 HeadMoved receipts are historical evidence only.

## Next native integration boundary

At verified R1 product tree e3a61dfd814a579b58f56b63754ec3dbce83d67e, this control
service still supplies logical Bound and the Store-half Commit composition. The
[reviewed R2–R5 target](../issues/307/R2-R5-SOURCE-OWNERSHIP-REVIEW-20261008.md)
assigns the full native connection/request service to Fuse and leaves this daemon
registry/control owner responsible for overall Ready/terminal unmount and existing
Commit admission. Attach, Locate, Ready and per-Workspace normal drain are now
implemented in that owner; see [native mount session](76-native-mount-session.md).
No daemon-wide aggregate drain exists.

## Forced unmount records

R6 adds these control records. Every earlier request and reply keeps its tag
and bytes; an unknown tag, value or boolean is refused as before.

| Record | Encoding | Sent when |
| --- | --- | --- |
| `Request::ForceUnmount { token, relinquish_unknown }` | request tag 11: token, one strict boolean byte | the caller forces one attached Workspace |
| `Reply::ForceUnmounted { token, outcome }` | reply tag 14: token, forced facts, `MountWork`, cleanup byte | the forced teardown completed and the entry left routing |
| `Reply::Retained` with `forced: Some(ForcedFacts)` | reply tag 15: the tag 12 body, then the facts | a forced teardown stopped after an effect, or a later Unmount, ForceUnmount or Attach met that stored custody |
| `Reply::Retained` with `forced: None` | reply tag 12, unchanged | a normal unmount or an Attach stopped after an effect |
| `ForcedFacts { abort, detach, commit, fenced }` | abort byte, detach byte, Commit knowledge (`Absent`; `Published` with the existing outcome encoding; `Unknown`), `u64` | inside tags 14 and 15 |
| `MountPhase::Stopping` | value 7 in the native status block | status while a forced unmount owns the session |
| `TeardownStage::Abort` | value 9, valid only with forced facts | the abort write was short or failed |

A refusal before any effect is the existing `Reply::Refused` with phase
`force:admission`, `force:custody` or `force:capability`. The daemon routes
the request in [`control/operations.rs`](../../crates/layerfs-daemon/src/control/operations.rs)
to [`control/force.rs`](../../crates/layerfs-daemon/src/control/force.rs); the
current public SDK operation is `WorkspaceApi::unmount(token, true)`. It retains
forced outcome facts and passes false for unknown-custody relinquishment. The
original explicit relinquishment flag remains in the hidden component-proof
helper; see [the SDK surface](../../../docs/general/sdk.md).

A Commit failure that leaves the registry `Uncertain` always answers `Unknown`:
besides an unreleased reader or owner, that now includes a definite failure
with no publication whose one local resolution of the capture is not known
done (for example `Busy` when the Save begins, then a resolution that could
not be submitted). A failed install after a known publication (`LocalFailure`)
keeps answering its own code with the publication attached.

R5, after `bb5b3c220`: `execute_control` no longer refuses Commit. It runs the
captured namespace producer through the unchanged driver
([product Commit](79-product-commit.md)). The paragraph above that says no
product constructor exists describes the earlier source.

## Explicit operator observations

The R7 source amendment after planning identity `980c169e6` adds request tag 12,
`Request::Observed { scope, request }`. It carries a caller-selected 32-byte
nonzero public scope followed by exactly one ordinary request tag and body.
Encoding and decoding refuse a zero scope, another Observed layer, Hello or
EndSession before parsing or allocating an inner wrapper. Every earlier control
record keeps its original bytes and the observed operation returns its ordinary
existing reply. Application owns the diagnostic sink; a direct Service call
refuses an unprocessed wrapper. The operation executes once and its original
known result, failure or unknown survives diagnostic transfer failure.

`WorkspaceApi::with_observations(&mut Control, &scope)` selects the wrapper through the
same private exchange used by ordinary facade methods. Its one caller-owned
scope reference lives only in that borrowed facade alongside its Control
reference; the facade remains two pointers. `WorkspaceApi::new` retains the
ordinary request encoding. The daemon retains no observation preference; a later
ordinary request on the same channel has ordinary behavior. SDK reply matching
validates one checked layer and preserves exact token/correlation checks. The
caller supplies a fresh scope for each observed channel/run. The daemon stores
no used-scope registry or connection nonce. Evidence groups use existing daemon
instance plus caller scope plus call as identity; slot is attribution only and
may be reused. An evidence consumer rejects duplicate complete identities.

### SDK-traced observations (#333)

Request tag 21 is the same wrapper with `traced: true`; tag 12 keeps
`traced: false` and its original bytes. The JavaScript SDK sends it only while
its per-call trace is on: `internal::trace(&mut Control, Some(scope))` makes
`Control::call` wrap each later ordinary request (never Hello, EndSession or an
existing wrapper) until `trace(None)`. A traced request is answered with reply
tag 23, `Reply::Observed { reply, telemetry }`: the operation's own reply,
unchanged, and an SDK value beside it. `Control::call` validates correlation
against the inner reply, keeps the telemetry (at most 16 values) for
`internal::take_telemetry`, and returns the inner reply, so every typed facade
method is unchanged. A traced request and its reply are never nested.

The daemon records phase timing only for a traced request: a thread-local flag
set through the `layerfs_daemon::telemetry::Recording` guard, which clears it on
every exit including unwinding. Product roots call `telemetry::timed`; untraced
it is `Timing::disabled`. Telemetry holds `timing` (pre-order nodes
`[name, parent, microseconds, outcome, incomplete]`, at most 256, with an
`omitted` count; root reports keep the telemetry crate's node limits),
`sql` (#352: the request's Store SQL work, `writer` and `readers`, each the
27 scalar `SqlWork` counters of that session group's totals after the request
minus before it; reader totals are live plus retired readers summed under one
registry turn; concurrent requests' work on the same sessions is included and
an unavailable group is left out; `call`, #367, the same counters for the work
the request's own thread ran on any Store session, which excludes concurrent
requests and any helper thread), `delta` (#352: on a call that finished a
Save, the daemon's Save selection totals after it minus before it: payload
selection counts with `depth_capped` and `work_exceeded` refusals and the
whole-file and chunk depth histograms, and the pooled metadata leaves' counts
and depth histogram; a histogram ends at its last nonzero slot and its 32nd
slot counts depth 31 and above), `fuse` (#352, Linux: on a traced status or
unmount of an attached Workspace, its 39 kernel opcode counts since attach,
the four frame dispositions, forget and store units and the largest READ and
WRITE sizes), `storage` (the Commit's 42 Storage Diagnostics, section 16 order) and
`construction` (the Commit's 31 captured namespace work fields, section 15
order) when the operation committed, and `diagnosticError` (`kind`, `message`)
when the numeric record write failed. On the traced route that failure is
reported there and the connection keeps serving; the untraced route keeps its
original close-after-reply custody. Telemetry that does not fit the reply frame
is replaced by an `Oversized` `diagnosticError`, then by the plain reply; it
never fails the answer. Timing roots: `commit` (phases `capture`, `producer`,
`begin`, `construct` with `captured.namespace`, `head` with `markers` while a
conflict is pending, `merge` with `merge`, `logical.known`, `finish`, `logical.count`, `validate`, `publish`,
`install`), `sandbox.mount.bind` (`store.bind`), `sandbox.mount.attach`
(`kernel.attach`), `files.bind`, `sdk.read`, `sdk.lines`, `branch.merge` and
`blame.compare`.

Cleanup is a separate explicit observation, `WorkspaceApi::cleanup(token)`:
request tag 13 carries the existing WorkspaceToken, and reply tag 16 carries the
same token followed by one strict state byte (1 Live, 2 Held, 3 Queued, 4 Gone).
It observes indexed existing namespace/incarnation and terminal-queue state in
the current daemon's allocated namespace domain. It does not recreate a Route,
retain the removed control binding, advance maintenance, repeat Unmount or
resolve an original unknown. A live row requires exact incarnation agreement;
an absent valid allocated row is Gone. Invalid/unallocated namespaces retain a
typed refusal. Logical Unmounted and physical Gone remain distinct outcomes.

Existing Store SQL observations can now be copied one writer/reader at a time
without constructing an additional reader vector. The application observation
schema and its separate epochs are described in
[daemon application](70-daemon-application-startup-control.md#numeric-observation-schema).
This instrumentation is source behavior, not qualification or a measured
optimization result. Its owning external tests include additive literal bytes,
malicious nesting, observed facade scope, and authentic Linux binary observations.


## SDK facade and Branch pages — 2026-10-12

The [implemented SDK](../../../docs/general/sdk.md) folds bind/attach into mount and normal/
forced teardown into unmount(force). Raw control, recovery and diagnostic borrows
remain hidden for component proofs and benchmark count attribution. This changes
no earlier request/reply tag or publication/ownership semantics.
Public Project commits renames history and sends the unchanged History request.
Public branches adds request tag 14 and reply tag 17. The request carries one
LayerStackId, the existing optional authenticated cursor and a limit of 1 to 32.
The reply carries bounded BranchRecords and continuation. Its one dispatch arm
calls the existing HistoryCatalog::branches port in name order, without a hidden
scan or Branch refresh. All original control records and golden vectors remain.
The [SDK branches method](../../crates/layerfs-api/src/project/list_branches.rs)
checks stack identity, ordering, page size and continuation shape on the original
sequential channel. These source changes establish no performance qualification.

Current Bridge source terminology (#320): attachment records use MountPhase,
MountReceipt, MountStatus and MountWork from control_mount. The authenticated
channel is layerfs_bridge::duplex (feature duplex). Encoded attach tags and
fields, and the fixed authentication domain bytes, are unchanged. Source tests
follow in the separate test pass; historical receipts keep their original names.


## Issue #327 internal operator boundary (2026-10-15)

The operator read model moved from `sdk/inspect.rs` to the daemon's `operator/`
module. Public `layerfs-api::call` rejects `operator.*` before encoding/sending;
`layerfs_api::operator::call` admits its own table. The native addon likewise
exports separate `call` and `operatorCall` entry points. Both use the existing
authenticated control record channel; the daemon routes the operator prefix to
its separate table, while public SDK dispatch has no operator or inspect arm.
The control registry still supplies the Workspace observations in a snapshot.

The JS package exposed this through `@layerfs/sdk/operator`, independently of
its main entry point (since #428: `@layerfs/backend` and the `backend.*` names;
see [the SDK call channel](82-sdk-call-channel.md)). Process list/cancel route only to the native executor;
they do not enter the filesystem daemon. The demo server uses both entry points,
with HTTP confined to that server. This split does not implement persistent
Sandbox discovery, new statistics or cross-process command ownership; those
remain tracked in the [#327 plan](../issues/327/IMPLEMENTATION-PLAN.md).
