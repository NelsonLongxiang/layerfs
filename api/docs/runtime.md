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
filesystem process API. It is **not** the agent SDK Sandbox/Workspace family:
`workspace.mount(sandbox, branch)` still names an already-running Sandbox and
remains unsupported on the Windows-native SDK route. This API does not register
one, choose a container image, or start a WSL/Linux worker. Explicit native
Sessions can launch ordinary commands as described below.

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
`{ id, path, status(), commit(scope), unmount(), exec(executable, args, options) }`. The handle is immutable;
`root`, revision/count fields from `status` and Commit revision are `bigint`
so 64-bit values are not rounded. `commit("published")` returns
`{ changed, revision, scope: "published", published: true }`. No omitted/default
scope, force, message or application-visible mapping capture is inferred.

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
It uses only the original running instance, creates fresh numbered work/mount paths
beneath the instance's work root, and returns the existing native Session handle.
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
not an OCI image or equivalent host confinement. Therefore sandbox.create and
workspace.mount/exec on the native SDK table remain Unsupported: exposing this
mode there requires an explicit platform contract rather than silently accepting
and ignoring image. See the
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
this helper for untrusted code. SDK workspace.exec remains unsupported natively.

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
integrity label so commands can write there. Owner-only Store, Overlay and SDK
project authority files are not granted to it. Real native access checks cover
both reading and WRITE_DAC/WRITE_OWNER attempts plus process-memory access to the
runtime, native product parent and unrestricted launcher. This does not deny all
host resources: system and other publicly-readable objects can remain readable,
and there is no network, registry, process-tree, quota or general host isolation
claim. Do not represent this local boundary as complete support for untrusted
code or an isolated SDK Sandbox.

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
