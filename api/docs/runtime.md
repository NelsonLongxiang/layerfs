# Using `@layerfs/runtime`

> **Status:** Current implementation guide for `@layerfs/runtime` in LayerFS
> 1.1.0; not a release receipt. Part of the
> [JavaScript packages wiki](../README.md).

`@layerfs/runtime` runs LayerFS on a machine for an integration: it initializes
and removes projects, starts the worker on macOS and Windows, and finds and
cleans up Sandboxes and volumes. It works on a LayerFS home, not a project.
Agents don't import it; a host that runs projects for its users does.

## Calls

```js
import { LayerFSRuntime } from "@layerfs/runtime";
const runtime = await LayerFSRuntime.open({ home, image, daemon, bundle, docker, containerPrefix });
try {
  await runtime.status();                  // { platform, missing, docker, worker, disk, sweep }
  const job = await runtime.project.start_init("shop", "/src/shop", { timeout }); // timeout optional: LayerFS.init's 300 s default
  await runtime.project.get_init(job.id);  // { step, scanned, totals, imported, project, error, ended }
  await runtime.project.list();            // [{ name, volume, image, source, created, initialized }]
  await runtime.project.get_state("shop", since);
  await runtime.sandbox.reclaim("shop");   // { reclaimed: [ids] }
  await runtime.sandbox.list_leftovers();
  await runtime.sandbox.clean_leftovers(["layerfs-old-1"]);
  await runtime.sandbox.list();            // [{ name, project, sandbox, state, running, startedAt, finishedAt, image, ports, scratch, owned }]
  await runtime.sandbox.sweep();           // { reclaimed: { project: [ids] }, failed: [{ project, code, message }] }
  await runtime.volume.list();             // [{ name, size, containers, owner, project, live, removable }]
  await runtime.volume.remove(["layerfs-shop-store-k2"]); // { results: [{ name, ok, message? }] }
  for await (const event of runtime.events.subscribe({ project: "shop" })) { /* a trace line + actor */ }
  await runtime.project.remove("shop", { confirm: "shop", stopSandboxes: false });
} finally {
  await runtime.close();
}
```

## Opening and settings

The runtime opens on a LayerFS home, not a project, so it works before the
first project exists, after one is removed and while the worker is down.
Agents don't import it. Settings (`settings.js`): `home` (required), `image`,
`daemon` (default the bundle's), `bundle`, `docker` (default `/var/run/docker.sock`;
on macOS Docker Desktop's `~/.docker/run/docker.sock` when only that one exists,
checked once at `open`), `volumes` (Linux),
`traceDir` (default `<home>/traces`), `containerPrefix`, `stateDir` (default
`<home>/.runtime`, the runtime's project records), `sweep`
(default true) and on Windows `wsl: { distribution, user, node, home }`. A
missing setting does not refuse `open`: `status().missing` lists it.

## Explicit Windows-native filesystem Sessions

With `native: true` on Windows, `runtime.native` is an explicit host-owned
filesystem process API. The default agent SDK container path is unchanged. An
integration may explicitly bind one original running native instance to an
already-open local SDK client, as described below; an unbound Windows-native
client still refuses daemon calls. No container image or WSL/Linux worker is
selected. Native Sessions can launch ordinary commands as described below.

```js
const runtime = await LayerFSRuntime.open({ home, native: true, sweep: false });
const session = await runtime.native.open({
  executable, // absolute product layerfs-native.exe
  host,       // absolute product layerfs-winfsp.exe
  winfsp,     // absolute installed winfsp-x64.dll
  store,      // existing absolute NTFS Store path
  work,       // fresh absolute path; parent must exist
  path,       // fresh absolute mountpoint; parent must exist
  catalog,    // Uint8Array, 1–128 bytes; supplied by the authority holder
  cursor,     // Uint8Array, exactly 32 bytes, not all zero
  branch,     // explicit Branch id, 34 hex digits including tag 11
  readyTimeoutMs: 15000, // optional readiness wait only; 1–120000
});
// Ordinary local processes may now use session.path; they need no Exec identity.
const state = await session.status();
const publication = await session.commit("published");
const terminal = await session.unmount();
await runtime.close();
```

Paths are explicit local drive paths. Existing mount/work objects and overlapping
ownership are refused; the Store is opened by the product Session, not served
through JavaScript. Binding bytes are copied synchronously, travel only through
inherited stdin and are removed from the temporary frame after its write callback.
They never enter argv, list observations or errors. Temporary clearing is not a
cryptographic erasure guarantee. Executables are explicitly trusted caller inputs;
this API is not a protection boundary against a malicious same-user binary or a
filesystem path substitution race.

`open` resolves only after the product's actual native root-service receipt, with
`{ id, path, status(), state(), reference(after, offset), commit(scope), unmount(), exec(executable, args, options) }`. The handle is immutable;
`root`, revision/count fields from `status` and Commit revision are `bigint`
so 64-bit values are not rounded. `commit("published")` returns
`{ changed, revision, scope: "published", published: true }`. No omitted/default
scope, force or application-visible mapping capture is inferred. An optional third
argument on `commit("published", details, message)` supplies the same bounded
message as the SDK. Omitting that third argument preserves the legacy native
default; explicitly passing `undefined` selects the Store Workspace default.

### Native reference observation

`session.reference(after = 0n, offset = 0n)` reads the first still-owned native
handle strictly greater than `after`. Both arguments must be u64 `bigint` values.
An empty result is `{ found: false, after, offset }`. Otherwise the result includes
`handle`, `serial`, `file`, `directory`, `lookup`, `cleaned`, `dataWritable`,
`attributesWritable`, `deleteAccess`, `pathBytes`, `path` and `nextOffset`.
Identity/length/offset numbers are `bigint`; `path` is a Buffer of at most 1024
raw UTF-8 bytes. `pathBytes: null` means no remembered path. A non-null
`nextOffset` requests another byte window with the same `after`, not with the
returned handle; use `after = handle, offset = 0n` to advance to another owner.
Offsets beyond the currently observed path are refused InvalidInput.

Each call is a new observation under the original Session mutex, not a pinned
snapshot. Handles may close and path hints may change between calls. Compare the
returned handle/serial/flags/length before joining windows; even equal headers
do not prove a path stayed unchanged. Decode only after joining raw bytes, since
a window may split a code point. A remembered path is not a new namespace lookup
or authoritative current name. The query performs one indexed handle lookup and
one bounded copy; it neither scans the tree nor allocates a second owner registry.

The existing inherited channel carries this reply only to the original native
Session caller. It exposes no Store binding, host/backend path, OS handle or
Exec ownership. It does not release, pin, coordinate or close anything, change
admission, infer kernel/section references or establish normal-close readiness.
Malformed/cross-correlated replies retain original custody without replay, as
with the existing control operations. See the [reference observation record](../../core/docs/issues/352/WINDOWS-NATIVE-REFERENCES-2026-11-03.md).

### Native cache-reference close coordination

An explicit unmount fences complete ordinary WinFsp callbacks, while original
Cleanup/Close callbacks remain admitted. Under the original Session lock, close
coordination accepts only cleaned, named, read-only file owners with no attribute
write or delete access, no pending Commit/capture/retained outcome and, for clean
close, no unpublished frontier or pending base change. Before-effect refusals
restore ordinary callback admission; no caller descriptor or mapping is closed.

The native host takes one indexed, serial/name-validated candidate at a time and
requests one WinFsp cache invalidation with zero notification Filter/Action. This
reports no synthetic filesystem change, does not reopen/read a file, change token
or ACL, or access Mount Manager. Invalidation submission is asynchronous and is
not a release receipt. Only original Close removes the Session's file owner.
The host observes original handle/request counts and whole callback completion
within a fixed 10-second readiness window. It never repeats an invalidation.
If an active view or other owner remains, the transaction returns Busy, releases
only its coordination admission and keeps the filesystem serving. A later explicit
request after the caller releases its original view is a new operation, not an
automatic retry. Lost/unknown protocol outcomes retain custody without recovery.

Only zero actual owners/requests and completed callbacks permit the original
clean/discard prepare, native stop/join/detach, product finish and process receipt.
Functional evidence covers the pinned minimal Git object workload, isolated
read-only-view refusal and focused trusted-local and restricted SDK Git roundtrips.
Both roundtrips preserve complete staged/working/index/ignored state across two
publications and two byte-exact remounts, followed by three original normal
unmounts. The restricted SDK run uses one original resident through its checked
token/desktop terminal. This does not qualify arbitrary kernel references, writable
mappings, forced teardown or the prior full Git workload. See the
[coordinated-close evidence](../../core/docs/issues/352/WINDOWS-NATIVE-CLOSE-2026-11-03.md),
[trusted-local roundtrip](../../core/docs/issues/352/WINDOWS-NATIVE-GIT-ROUNDTRIP-2026-11-03.md)
and [restricted SDK roundtrip](../../core/docs/issues/352/WINDOWS-NATIVE-SDK-GIT-ROUNDTRIP-2026-11-03.md).

Only a correctly correlated terminal acknowledgement **and** the original parent
process's successful close resolve `unmount()`. The result includes string command
`id`, `nativeExit`, raw `dispatcherExit`, `overlayClosed`,
`processExit` and `processSignal`. A Busy refusal leaves the handle serving;
a later explicit request after actual owner release is a different operation,
not an automatic retry. Unmount is refused locally while original calls remain
pending and blocks later admission once sent. It closes no caller-owned files,
mappings or commands to make a Busy result succeed.

`runtime.native.list()` returns process-local observations
`{ id, path, work, state, pid, root, commands, executionRetained }`; the optional root is a decimal string,
not a general Ready or kernel-drain proof. States include starting, serving,
unmounting, closed (while a command still owns completion), and retained. A failed start with no process is removed. A process
which started but failed, lost its reply stream, sent malformed/cross-correlated
answers or missed readiness retains its original custody. Errors are sanitized
`Unknown`; original requests/bytes/cause and the process remain held internally,
with a bounded stderr diagnostic tail. There is no kill, reconnect, resend,
admitted-operation timeout or automatic unmount. The caller may inspect the
retained observation, but no recovery/re-adoption API is implemented.

`runtime.close()` refuses Busy with starting/active native Sessions or Unknown
with retained ones, before closing clients or changing its closed flag. Unmount
explicitly first; a finally-block close must not hide the original Busy/Unknown.
Dropping a handle is not release evidence. SDK `LayerFS.close()` and its
container Workspace ownership semantics remain unchanged. Multiple runtimes have
independent process-local observations; this is not machine-wide discovery.

The public native API has direct WinFsp functional evidence in the
[dated implementation report](../../core/docs/issues/352/WINDOWS-RUNTIME-NATIVE-2026-11-02.md).
It does not qualify complete SDK Ready, arbitrary mappings/kernel references,
crash recovery or public endpoint authentication. Store calls remain in-process
on the native route; no Store worker is introduced.

### Bind an existing SDK client to a running native instance

An integration may opt one open in-process SDK client into the original native
instance it already created:

```js
const client = await LayerFS.open(project); // original direct Store binding
const registration = await runtime.native.bindClient(client, instance, {
  commitScope: "published",
});
const ws = await client.workspace.mount(registration.sandbox, "feature");
const state = await LayerFSBackend.of(client).daemon.workspace.status(ws);
const publication = await client.workspace.commit(ws);
await client.workspace.unmount(ws);
await client.sandbox.close(registration.sandbox);
await client.close();
```

bindClient starts nothing. It requires the exact original instance handle from
this runtime, a live local client selecting the same project/home/Store, and
explicit commitScope: "published". It does not replace the client’s Store binding,
use a worker, open another Store or switch global transport. Wrong instance or
project selection refuses before effects. A client registers once; another client
can explicitly register the same original instance and use its still-owned paths.
SDK and direct instance.mount calls resolve the same original Session owners,
including mounts created before client registration. Direct unmount removes that
mount from SDK listings; SDK unmount closes the same handle returned directly.
A client not registered remains on its original route. This registration is
process-local, not machine discovery or cross-process credentials.

The returned { sandbox, image: null, mode: "windows-restricted" } names this
instance on those clients. project.list_sandboxes and sandbox.list_workspaces
report it explicitly in that native mode. It is not a container-image creation:
sandbox.create(image) stays Unsupported. workspace.exec’s Bash command contract,
background process APIs, forced unmount and force-Commit remain Unsupported.
Commit messages use the ordinary SDK validation and semantics described below. Explicit native command objects below delegate the original
Session command owner; the SDK registration does not pretend that Windows
argument-vector execution is Bash.

workspace.mount requires that named original instance still running, uses its
existing mount implementation and admits at most 16 original Workspace owners
across both SDK and direct entrypoints, including pending admissions. The shared
owner claims capacity before awaiting, rather than each caller counting its own
registry. A closed filesystem whose command streams remain owned is not listed
as a mounted Workspace; it still occupies original ownership and prevents close.
It never creates, restarts or changes instance placement. Mounts, incomplete
admissions and command completion retain their original lifecycle; an unknown
admission cannot be presented as an empty list or silently deleted.

Native status returns mode plus actual bound workspace/branch identity, base head,
baseLayer/root and observed dirty counts as bigint. Detailed native counters are
under native. Unobserved current Store head and headMovedSinceMount are null,
not guessed false; versioned container delta-read models are not fabricated.
A prepared/committing observation is not complete Ready or kernel-drain evidence.

workspace.commit returns kind Committed or UpToDate, original head/baseLayer/root,
parent/displacedHead/merged identities, revision bigint and explicit
scope: "published", published: true. These are the original product completion
receipt, not a post-hoc latest-History query. The native subset does not synthesize
the container Commit record’s storage/timing/message/LWW fields; read History or
Store storage separately if those are needed. No automatic Commit or retry occurs.

SDK workspace.commit(ws, message) now preserves an explicit message exactly through
the original native CommitWork and the Store's existing CommitOptions. Validation
is the ordinary SDK UTF-8 limit of 4096 bytes, with no controls except newline/tab;
null, non-text, unpaired surrogates and over-limit messages refuse InvalidInput
before native admission. Empty text stays empty. Omitted or undefined SDK messages
use the Store's existing "Commit Workspace changes" default, not the former native
hard-coded description. A message alone never creates a Commit: UpToDate keeps the
same head/root and History. Force remains Unsupported.

The same inherited owner channel carries one length-bounded ASCII control record:
hex encodes the message so newline/tab cannot become commands. The processing
window is 128 bytes of command overhead plus two times the public 4096-byte field
bound (8320 bytes total); it is not a new file/Workspace/flow limit. No multipart
upload state, temporary message file, network listener, Store RPC, decoder fallback
or failed-operation replay is added. Native History validation is reused before
capture. The original completion keeps the selected message and outcome together
through failure/uncertainty; known publication checks its explicit message before
releasing that owner. Read History for actual persisted metadata; the native
publication receipt's identity fields are not reconstructed from a later lookup.
See the [message implementation record](../../core/docs/issues/352/WINDOWS-NATIVE-COMMIT-MESSAGE-2026-11-03.md).

Normal SDK unmount defaults to discard: false. After fencing complete native
callbacks, the product Session refuses Dirty before receive-stop/terminal effects
if locally published mutations or pending base changes remain. Dirty and Busy
restore ordinary callback service; a status preflight in JavaScript cannot replace
that atomic admission. Explicit discard: true permits dropping uncommitted local
changes. The old standalone Session.unmount() default remains its original explicit
terminal behavior. Force never bypasses the native implementation.

An SDK client.close releases only its original Store client; it does not unmount
or stop the runtime’s instance. After normal unmount, another explicit mount can
read published state; after sandbox.close on that registered instance, later mount
refuses NoSuchSandbox and cannot autostart it. The original terminal receipts and
process exits are still required. Lost/wrong status or publication replies keep
Unknown, original frames and runtime ownership without resend, including an
admission that never returned a Workspace to its SDK caller.

See the [SDK native binding proof](../../core/docs/issues/352/WINDOWS-NATIVE-CLIENT-2026-11-02.md).

### Explicit native SDK execution

An explicitly native-bound local client may pass a tagged command object to the
existing workspace.exec call. This is a separate native input/result contract,
not an interpretation of the existing Bash string:

```js
const child = await client.workspace.exec(ws, {
  mode: "windows-native",
  executable: process.execPath, // explicit absolute local executable
  args: ["-e", "process.stdin.pipe(process.stdout)"],
  env: { CASE_VALUE: "explicit" }, // optional, no arbitrary host inheritance
});
// Start draining BOTH outputs before a writer can block on their backpressure.
const outputs = Promise.all([consume(child.stdout), consume(child.stderr)]);
child.stdin.end(inputBytes); // only the caller ends input
const root = await child.exited;
const completion = await child.finished;
await outputs;
```

consume above is the caller’s byte-stream consumer, not a LayerFS output spool.
The exact existing immutable command handle is returned after the original target
start acknowledgement: id, pid, restricted, stdin, stdout, stderr, exited,
finished and cancel(). Standard streams remain live Node streams with bounded
processing windows and backpressure. No output decoding, total-output cap, auto
stdin EOF, implicit Commit/unmount or default execution deadline is introduced.

The object accepts only mode, executable, args and optional env. All execution
selection is copied before awaiting the original resident status. Invalid values,
sparse argv, unknown options, shell/cwd/deadline/image fields and case-duplicate
environment names refuse before target creation. Native message/sinks/spool options
do not apply and refuse rather than being silently ignored. Ordinary native input
validation and environment filtering remain in the existing command owner.

Unbound or worker clients refuse native command objects before serializing them to
their binding. A native-bound client still refuses Bash strings; existing container
Bash execution and its text/sink results stay unchanged. The layerfs CLI remains on
that string contract. Native calls require the named original running instance and
serving Workspace. They do not create or restart one or open another Store.

Root exit, launcher close, output consumption and filesystem drain stay separate.
Closing the SDK client does not end a returned command or revoke its cancellation
handle. cancel() requests only the original root once; it does not terminate the
filesystem or descendants. Abandoned/failed output retains Unknown and original
command custody without replay, guessed cleanup or normal-close acknowledgement.

Tracing records native args as mode plus argv count only, not executable code,
argv content or env values. Successful call return is execution: "started", with
commandId and pid. It is not command completion or exit0; the original exited and
finished receipts remain authoritative.

The native object form is an implemented opt-in shape, not an owner-ratified
unified platform API. See the [functional execution record](../../core/docs/issues/352/WINDOWS-NATIVE-SDK-EXEC-2026-11-03.md).

### Resident native execution instances

runtime.native.create(options) starts one real Windows resident process owning a
restricted primary token and random private desktop before any mount is admitted.
It takes project, executable, host, winfsp, restrictedLauncher, a fresh absolute
work path, and optional readyTimeoutMs (default 15000; range 1–120000). The project
must already have this runtime's installed record; it fixes the Store selected at
creation. No Store is created/imported or mounted by create. No image, container,
WSL worker, automatic placement or machine-wide discovery is implied.

The returned immutable instance has id, project, mode: "windows-restricted", and
status(), mount(branch), close(). mount accepts one existing non-main Branch name.
It uses only the original running instance and returns the existing native Session
handle. Numbered backend work stays beneath the protected instance work directory.
Each fresh mount junction instead lives beside that directory, under its existing
parent, with a bounded component name derived from the instance UUID and mount
sequence. The original NativeSessions owner still claims both paths before awaiting;
existing targets and overlapping owners are refused, not replaced. This avoids
forcing path-normalization APIs to enumerate the protected instance directory.
Applications needing Win32 long-path normalization must choose a work parent whose
existing ancestor metadata is accessible to the restricted token. No ancestor ACL
is probed-and-repaired or broadened automatically. A private ancestor further up
that caller-selected chain can still cause normalization to fail.
It does not start or replace an instance. Two Sessions can coexist and use the same
original token and private desktop. runtime.native.open remains available for an
explicit standalone Session; overlapping instance paths are reserved and refuse
Busy instead of creating a competing owner.

runtime.native.instances() returns process-local observations with id, project,
work, mode, state, pid and sessions. Starting, running, closing and retained are
observed states, not a complete kernel/service Ready guarantee. status checks the
original resident control and returns its current local ownership observation;
it never settles a prior unknown result. New instance mounts and commands refuse
after loss or terminal admission. There is no automatic restart, idle close,
reattachment or fallback to a newly created token.

The resident process itself creates target commands with its original restricted
token. A command owner establishes bounded private anonymous request/response
streams and transfers only its three standard data handles, explicit argv/env/cwd
and original process incarnation. Windows PID plus creation time is checked before
any cross-process handle duplication. The runtime forwards the one prepared-handle
selection to the original resident control; no public listener is introduced.
Successful target creation transfers the original target process handle back to
that command owner, which still owns exit, stream completion and explicit root
cancellation. JavaScript receives neither the token handle nor desktop authority.
No target gets runtime control, instance receipt or backend handles. This is a
same-build Windows-x64 private protocol, not a portable or authenticated remote ABI.

Two original outcomes are needed before exec reports a started target: resident
handoff acknowledgement and the target owner's start evidence. Their delivery can
arrive in either order. Contradictory creation outcomes, partial transfer or lost
receipts retain Unknown and original custody without resend. A definite creation
refusal has its own original acknowledgement; the still-running instance is not
replaced. Actual process completion and stream EOF remain independent.

close refuses MountsActive while an original Session, mount attempt or command
completion remains owned; an uncertain Session returns Unknown. It never unmounts
or kills commands to succeed. An outstanding control call returns Busy. After
explicit unmounts, close releases and checks the original token/desktop handles,
then requires the correlated close receipt and original resident exit0 before it
resolves. A repeat on that closed handle returns the recorded result, not a second
stop attempt. A failed handle-close is not attempted again by the destructor.
The work directory is retained; global project history is not deleted. Root exit,
command count or successful token-handle release do not enumerate all descendant
or kernel/mapping references.

runtime.close refuses an active instance before closing project clients. A caller
must explicitly unmount Sessions and close the original instance. Losing a caller
or reaching a readiness deadline does not authorize a kill/restart or a normal-close
claim. Original malformed reply bytes, pending requests, causes and a bounded stderr
tail remain held process-locally; this is not crash recovery.

The agent SDK's current Sandbox contract selects a container image and owns an
acknowledged container. The native mode selects this restricted Windows context,
not an OCI image or equivalent host confinement. The default native SDK table still refuses these operations. Explicit client
registration above exposes native mount/status/Published Commit/normal unmount,
not container creation or Bash Exec; image is null and the native mode is named
rather than silently accepting and ignoring an image. See the
[resident-instance implementation proof](../../core/docs/issues/352/WINDOWS-NATIVE-INSTANCE-2026-11-02.md).

### Trusted host commands in a native mount

An explicit native Session supports ordinary same-user host execution through
session.exec(executable, args, { env? }). The executable is an explicit absolute
local file, args are copied, and cwd is the mount root. No shell or command
runtime deadline is inferred. The call resolves only after the original process
has started, returning an immutable handle with id, pid, stdin, stdout, stderr,
exited, finished and cancel().

Stdin is a normal Writable. Stdout/stderr are independent byte streams with
bounded processing windows and backpressure, not whole-output strings or an
arbitrary total-output cap. Start draining BOTH outputs before awaiting finished,
and explicitly end stdin when no more input is intended. Caller-owned sinks
must retain/report their own failures; the runtime never owns or ends a sink.

The exited promise preserves the root's actual { exitCode, signal }, including
nonzero/null codes without substituting success. The finished promise additionally
requires original process close, raw output EOF and both exposed output streams
consumed to EOF. Its receipt also carries command, pid, stdoutEnded, stderrEnded
and cancellationRequested. Neither receipt proves every descendant or filesystem
reference is gone. Node's root-exit stdio drain cannot discard a late consumer's
unread output: bounded PassThrough streams retain it and continue backpressure.
Not reading can intentionally block a command or finished; destroying output
early retains Unknown rather than claiming complete delivery. A failed stream or
process is not replayed or automatically terminated.

cancel() explicitly requests termination of only this original root ChildProcess
once, using Node's Windows SIGTERM implementation (not a POSIX graceful-signal
guarantee). It returns { requested, rootExited }. A second pending request is
Busy; an already exited root returns requested: false. It never signals a process
tree, unrelated pid, filesystem process or all processes with a name. Descendants
can survive; cancellation never proves their exit or safe unmount. There is no
automatic cancellation, Commit or unmount, even after nonzero exit.

Only PATH, PATHEXT, SYSTEMROOT, WINDIR, TEMP, TMP and COMSPEC are inherited. Other
environment values are explicit and Windows case-unique. LayerFS deployment or
capability variables and arbitrary host environment secrets are not automatically
forwarded. This is environment hygiene, **not isolation**: commands run as the
caller's Windows user and can access everything that user can. No token lowering,
image, Job object, AppContainer or Sandbox registration is claimed. Do not use
this helper for untrusted code. SDK Bash strings remain unsupported natively;
explicitly native-bound clients can use the tagged executable/argv form above.

The runtime owns command launch, streams, exit and explicit root cancellation;
its daemon never receives Exec control. Ordinary external processes need no Exec
identity to use a mount. Unmount still probes actual filesystem custody, not
command count. A surviving descendant holding a file makes it Busy after root
exit; a command without filesystem references need not block unmount. After a
successful unmount, the runtime retains a closed Session observation while a
command still owns completion. runtime.close refuses Busy then, or Unknown for
retained command failure, without silently dropping/killing/replaying it. Command
count is not a descendant inventory or kernel-drain proof.

See the [native execution proof](../../core/docs/issues/352/WINDOWS-NATIVE-EXEC-2026-11-02.md).

### Restricted command access boundary (explicit opt-in)

Pass an absolute product restrictedLauncher executable to runtime.native.open to
select restricted commands for that Session. Existing trusted same-user mode is
unchanged when it is omitted. The Session generates a fresh restricting SID,
passes it to the product native mount owner, and uses it for every command in
that Session. This is not an SDK Sandbox registration or a promise of full host
isolation.

The product launcher creates a restricted token with maximum privileges disabled
(except Windows' traversal privilege), the Administrators SID deny-only, an
additional restricting SID check and low integrity. It creates a random private
desktop, prepares child-only token/default-object ACLs, and starts the command
with an explicit standard-handle inheritance list. No original process token,
backend file, runtime control or lifecycle receipt handle is given to the
command. There is no global account, driver, user profile or service change.

Only the selected mount's data access is granted to this policy SID, with a low
integrity label so commands can write there. A directory mount also creates an
NTFS junction, separate from its mounted root. The new junction receives an
explicit protected owner/policy descriptor through FspFileSystemSetMountPointEx:
policy read/traverse only (0x1200a9), low label, no inheritable grant or write/ACL
control on the junction. Its private parent is not granted access. Without a
policy, the original inherited junction behavior remains unchanged. Owner-only
Store, Overlay and SDK project authority files are not granted to it. Real native access checks cover
both reading and WRITE_DAC/WRITE_OWNER attempts plus process-memory access to the
runtime, native product parent and unrestricted launcher. This does not deny all
host resources: system and other publicly-readable objects can remain readable,
and there is no network, registry, process-tree, quota or general host isolation
claim. Do not represent this local boundary as complete support for untrusted
code or an isolated SDK Sandbox.

Git for Windows path normalization is a separate compatibility requirement. With
the new resident sibling-junction layout and an already accessible work-parent
chain, the pinned Git2.46.0.windows.1 build can use its GetLongPathNameW fallback
without enumerating protected backend work. Restricted SDK Git init/add/commit/show
and a separate complete staged/working/index/ignored roundtrip with two explicit
publications, two byte-exact remounts and three normal closes have scoped functional
evidence. The latter uses the original resident and closes its token/desktop; it
does not create a container image or make named IPC work. GetFinalPathNameByHandleW DOS naming still returns error1005:
this is not general DOS-volume identity support, all Git configuration/symlink
paths or arbitrary private-ancestor compatibility. No token/ancestor ACL widening
or Mount Manager registration is used. See the [cwd topology fix](../../core/docs/issues/352/WINDOWS-NATIVE-GIT-CWD-2026-11-03.md).

The [old Git record](../../core/docs/issues/352/WINDOWS-NATIVE-SDK-GIT-2026-11-03.md)
keeps its original cwd exit128 and 13-reference FAIL. Later trusted-local
[multi-publication evidence](../../core/docs/issues/352/WINDOWS-NATIVE-GIT-ROUNDTRIP-2026-11-03.md)
and restricted sibling-layout evidence are separate inputs, not revisions of those
old outcomes or general kernel/mapping qualification.

Named IPC pipes are a separate access boundary. On the pinned Node24.12.0/libuv
1.51.0 Windows build, a restricted command’s child_process IPC setup creates a
pipe server but fails opening the client with Win32 error5, reported by Node as
spawn EPERM before child creation. The observed pipe DACL grants Everyone read
only and does not contain the command policy SID, despite that SID being in the
token default DACL; its low integrity label is already correct. Token defaults
do not establish the security descriptor of every object an application creates.
No automatic policy broadening, user-SID restriction bypass, library patch or
plain-token fallback is made for this limitation. Inherited standard streams and
ordinary descendants remain usable; this is not Node IPC support. See the
[IPC access-boundary record](../../core/docs/issues/352/WINDOWS-NATIVE-IPC-2026-11-03.md).

The launcher reports its original target PID and raw Windows DWORD exit code on
a private inherited receipt pipe, separate from command stdout/stderr. A command
cannot fake completion by printing a receipt line. The command handle/finished
receipt add restricted: true, exited preserves exitCode and signal: null. An
explicit root cancel goes once through a separate inherited control pipe and
uses TerminateProcess on the original target handle (cancellation code 1223).
There is no PID rediscovery, process-tree kill or filesystem supervision. A
cancel request is not proof of termination; the original exit and owner close
receipts decide. No plain-token launch, reconnect or resend follows a restricted
startup failure. A before-process failure becomes Failed only with the original
launcher acknowledgement and exit; missing or malformed observations retain
Unknown. The runtime still owns streams and waits for their EOF independently.

The standalone build entry is tools/build-restricted-windows.ps1, with locked
native build inputs explicit; the helper is part of the product Sandbox engine,
not a diagnostic executable or Rust unsafe exemption. The current proof is in
[the restricted-access report](../../core/docs/issues/352/WINDOWS-RESTRICTED-EXEC-2026-11-02.md).

### Open an installed runtime project without exporting authority

For a project initialized by this runtime, use the same operation with project
and Branch names instead of Store/catalog/cursor values:

```js
const session = await runtime.native.open({
  executable, host, winfsp, work, path,
  project: "my-project",
  branch: "feature", // existing non-main Branch name, not an identity
});
```

The runtime's installed-project record selects the volume's Store path. The
product process itself reads the existing owner-private SDK project record from
this runtime's home, checks the original/installed manifests and Disposable
profile, and selects the Branch by its name in that project's LayerStack through
the History index. It then binds through the same direct Store/Session path.
There is no whole-project scan, source re-import or credential-export method.
Do not combine project mode with store/catalog/cursor: that ambiguity refuses
before spawning. main is protected; use an existing fork. Missing runtime
registration refuses NoSuchProject; failures after a process starts retain the
original process observation rather than guessing a safe retry.

JavaScript does not parse or receive the catalog/cursor bytes in this mode. They
remain inside the product process and its direct Store. The startup frame carries
only the home, project/Branch names and fresh Workspace identity. Native Session
list observations add project and branch when selected this way. This relies on
the existing owner-private home/project/record checks, not the runtime's JSON
record as an authority grant. A substituted Store still must open with the
project's catalog binding. The manifest's original root is an Init identity,
not a requirement that a live Branch remain at that root.

Both SDK discovery and native startup use the same protected project record
reader. It rejects wrong record identity/kind/trailing bytes, widened owner
privacy, over-window input and installed metadata that differs from its original
sealed project except for the acknowledged SQLite version. No new FFI is used.
Equally privileged path substitution races remain outside this guarantee.

This connects registered projects to an explicit native filesystem Session; it
still does **not** register an SDK Sandbox, launch commands, autostart a Sandbox or
change workspace.mount's running-Sandbox contract. See the
[registered-project implementation report](../../core/docs/issues/352/WINDOWS-REGISTERED-NATIVE-2026-11-02.md).

## Init

`start_init(name, folder, { image, timeout })` refuses a bad name, folder,
image or timeout and a taken name before anything changes; then it counts the
source, makes the volume and runs one Init. `timeout` (milliseconds, a
positive whole number) is passed unchanged to `LayerFS.init(name, folder,
timeout)` and bounds the Init itself, not the count or volume steps; the
runtime has no default of its own, so an omitted one gets `LayerFS.init`'s
300 s. A Deadline is a failed Init like any other. A failed Init removes the
volume and the home entry it made; an uncertain one (`Unknown`, or any failure
on Windows) keeps everything and is recorded in
`<stateDir>/init-failures.jsonl`.

`runtime.project.get_init` (native; `@layerfs/runtime`) reads the project's Init while `project.init` runs in the
same process, without a Sandbox: `{ step, entries, files, bytes }`, or null when
no Init runs. `step` is `scan` (reading the source), `files` (constructing each
regular file), `tree` (building the namespace), `publish` (genesis Layer) or
`seal` (first Branch and sealing). `entries` counts source entries scanned,
including the root; `files` and `bytes` count regular-file identities
constructed and their bytes, a hardlinked file once. The counts say how far
Init has come, not its totals; a caller that wants a fraction counts the source
itself. Init then installs the Store into the volume in the same process.

## Removing a project

`remove` needs `confirm` equal to the project's name and refuses `Busy` while
a running container uses the volume, unless `stopSandboxes`.

## Events

`events.subscribe` reads the trace folder's `*.jsonl` files every `pollMs`:
lines from now on, or from `since`, each with `actor`, its trace file's name.

## Disk the home holds in Docker (#423)

- `sandbox.list` lists this home's Sandbox containers, running or not, with
  `scratch`, the bytes of the container's writable layer (what commands wrote
  outside every Workspace), its ports and whether a project of this home owns
  it. One `docker ps` and one `docker inspect --size`; it changes nothing.
- `sandbox.sweep` runs `sandbox.reclaim` for every project of the home that
  has an exited or dead Sandbox container. The project's records and lock
  decide what goes, so a container of another home, or one starting now, is
  never touched; containers no project records stay for `list_leftovers`.
  `open` runs it once in the background unless `sweep: false`;
  `status().sweep` is `null`, `{ state: "running" }` or
  `{ state: "done" | "failed", at, … }`, and `close` waits for it.
- Init labels a project's volume `layerfs.role=store`, `layerfs.home=<home>`
  and `layerfs.project=<name>` (Docker sets labels only at create).
  `volume.list` lists every volume on the engine with Docker's size, the
  containers that use it and its `owner`: `"this"` (labelled with this home
  or named by a project record), `"other"` (another home's label) or
  `"unknown"` (no label and no record: made before labels or by another
  tool). `live` is true while this home has the owning project; an uncertain
  Init, which keeps a home entry and no record, counts as live. Docker's own
  "reclaimable" figure counts every idle project's Store and is not used.
- `volume.remove(names)` removes only volumes that `volume.list` marks
  `removable`: this home's, no longer a project's, and used by no container.
  Anything else is refused by name; one `docker volume rm` each, no retry.

## Platforms and the worker

Each platform folder implements one interface (`endpoint`, `status`,
`start`, `restart`, `init`, `path` and the Docker, home and disk helpers):

- **Linux** runs Store calls in this process. There is no worker:
  `worker.start` and `worker.restart` are refused `InvalidInput`. Init
  installs the Store under Docker's volumes directory, so the process must be
  able to write it (`init` checks first).
- **macOS** runs the worker as one container per home, `<prefix>worker`
  (label `layerfs.role=worker`), with the bundle's `worker/server.js`; Init
  runs in a container of its own with the source folder mounted read-only.
  `worker.start()` takes no options and starts or reuses `<prefix>worker`
  only; it stops or removes no other container. `worker.restart({ confirm:
  "restart" })` restarts the worker, which cuts off every project's Store
  calls meanwhile. The worker's secret reaches `docker
  run` through its environment, never its command line.
- **Windows** runs the worker as a Node process in a WSL2 distribution
  (`server.js --stdin`); Init runs in the worker, which maps the folder with
  `wslpath`. This process owns the worker through its stdin: `close()` drains
  and ends it. This is the worker route; it coexists with the **Windows-native
  Store route** (owner, 2026-10-25), where the in-process addon opens a local
  NTFS Store directly and no worker is involved. The native route is the
  default when no worker endpoint is set (`LAYERFS_WORKER_ENDPOINT` or
  `useWorker`): setting a worker sends the calls to the worker instead, and
  the worker's paths are then inside its WSL2 Linux.

The runtime starts a worker only on macOS and Windows. The worker route is
open to any integration (owner, 2026-10-24): on those platforms the runtime
hands its endpoint to `@layerfs/agent` (`useWorker(endpoint)`, without
changing the environment), so every client made after `open` in its process
uses the worker; a client made before keeps its in-process binding. One
worker per process: a second runtime of another home is refused. Another
process, such as an agent's command, uses the worker when its
`LAYERFS_WORKER_ENDPOINT` names the endpoint file; the integration that runs
it sets that. Such a process also needs the project's settings: make the
project with `project.start_init`, which creates and records its volume, then
set `LAYERFS_VOLUME` to the volume `project.list` gives,
`LAYERFS_STORE_PATH` to `/var/lib/docker/volumes/<volume>/_data/global/store.sqlite`,
and `LAYERFS_IMAGE` and `LAYERFS_DAEMON` for its Sandboxes (on macOS, the
bundle's `layerfs-daemon`). A volume made outside the runtime works for Store
calls, but `project.list` shows the project with `volume: null` and
`volume.list` marks the volume `unknown`. The endpoint is `<home>/worker/endpoint.json`, `{ home, port,
secret, build, daemonHost?, docker?, init? }`, readable by its user only. On macOS
`docker` is the engine's socket inside its VM, `/var/run/docker.sock`, which the
worker and Init's container mount; it replaces every call's `deploy.docker`, so the
Mac's own socket (`LAYERFS_DOCKER`) never reaches Linux. The worker
checks every file of the bundle's `manifest.json` before it listens.

## Docker

The runtime calls the `docker` CLI, as the dsh Host did. It has no command
line of its own: the `lfs` command it carried is retired (owner 2026-10-23).
Agents use the `layerfs` command instead, described in [the agent guide](agent.md#the-layerfs-command).
