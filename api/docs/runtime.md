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
one, choose an image, launch commands, or start a WSL/Linux worker.

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
`{ id, path, status(), commit(scope), unmount() }`. The handle is immutable;
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
`{ id, path, work, state, pid, root }`; the optional root is a decimal string,
not a general Ready or kernel-drain proof. States include starting, serving,
unmounting and retained. A failed start with no process is removed. A process
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
