// One call through this process's binding (transport/index.js: the native
// addon in this process, or the worker client). The binding resolves
// `{ value }` or `{ refused }` (plus `telemetry` when traced); a refusal
// becomes a LayerFSError. Nothing is retried.
import { binding, servesDaemonCalls, isLocalBinding } from "./transport/index.js";

/** The binding a client was made with (see transport/index.js). */
export const transportOf = (client) => client[STATE].transport;
import { LayerFSError } from "./errors.js";
import { traced } from "./trace.js";

/** A client's private state: `{ closed, transport }`. */
export const STATE = Symbol("layerfs.client");

/** Names on the binding's backend table (#428), refused by the public one. */
export const BACKEND = /^(backend|runtime)\./;

/** Runs one operation once and returns its value or throws its refusal;
 * `options` are the client's settings, whose `trace` selects its trace file;
 * `transport` is the client's binding (default: the one a new client would use). */
export async function invoke(op, args, options, transport = binding()) {
  return outcome(await traced(options, op, args, (scope) => {
    if (BACKEND.test(op)) throw new LayerFSError("UnknownMethod", "backend and runtime methods are @layerfs/backend's and @layerfs/runtime's", null);
    return transport.call(op, observed(args, scope));
  }));
}

/** One call on the binding's backend table (`backend.*`, `runtime.*`). */
export async function invokeBackend(op, args, options, transport = binding()) {
  return outcome(await traced(options, op, args, (scope) => transport.backendCall(op, observed(args, scope))));
}

/** A traced call carries its scope; the binding removes it before dispatch. */
const observed = (args, scope) => (scope ? { ...args, observe: scope } : args);

/** A binding answer's value, or its refusal thrown as a LayerFSError. */
export function outcome(answer) {
  if (answer.refused) {
    const { code, message, detail } = answer.refused;
    throw new LayerFSError(code, message, detail);
  }
  return answer.value;
}

/** The call fields of a Workspace, `{ sandbox, path }` as `workspace.mount` returned it. */
export function workspaceArgs(ws) {
  if (!ws || typeof ws.sandbox !== "string" || !ws.sandbox || typeof ws.path !== "string" || !ws.path) {
    throw new LayerFSError("InvalidInput", "a Workspace { sandbox, path } from workspace.mount is required", null);
  }
  return { sandbox: ws.sandbox, path: ws.path };
}

/** A Sandbox's number, as `project.list_sandboxes` and `workspace.mount` name it. */
export function sandboxArg(sandbox) {
  if (typeof sandbox !== "string" || !/^[1-9][0-9]{0,9}$/.test(sandbox)) {
    throw new LayerFSError("InvalidInput", "a Sandbox is its number as a string, such as \"1\"", null);
  }
  return sandbox;
}

/** Deployment settings from the client options, else the environment
 * (LAYERFS_<NAME>). A Workspace's Sandbox needs
 * every one but the container prefix and daemon host. */
/** Refuses a daemon-backed call before any argument is examined, exactly as the
 *  native table refuses it: on the Windows-native Store route (and anywhere else
 *  without a daemon or worker) the family answers Unsupported rather than an
 *  InvalidInput about deployment settings that route never uses. */
export function requireDaemon(what) {
  if (!servesDaemonCalls()) {
    throw new LayerFSError(
      "Unsupported",
      `${what} needs a daemon; the Windows-native Store route serves project, fs and branch calls in-process`,
      null,
    );
  }
}

export function deployment(options = {}) {
  const env = (name) => process.env[`LAYERFS_${name}`] || undefined;
  const deploy = {
    docker: options.docker ?? env("DOCKER") ?? "/var/run/docker.sock",
    image: options.image ?? env("IMAGE"),
    volume: options.volume ?? env("VOLUME"),
    daemon: options.daemon ?? env("DAEMON"),
    containerPrefix: options.containerPrefix ?? env("CONTAINER_PREFIX"),
    daemonHost: options.daemonHost ?? env("DAEMON_HOST"),
  };
  for (const [name, value] of Object.entries(deploy)) {
    if (name === "containerPrefix" || name === "daemonHost") continue;
    if (!value) {
      // A daemon-less route (the Windows-native Store route) can never serve this
      // family, so an unconfigured deployment field there is Unsupported, not a
      // InvalidInput aimed at the caller. A daemon route keeps the exact code.
      if (!servesDaemonCalls()) {
        throw new LayerFSError(
          "Unsupported",
          `${name} is not configured (LAYERFS_${name.toUpperCase()}), and this route has no daemon: the Windows-native Store route serves project, fs and branch calls in-process`,
          null,
        );
      }
      throw new LayerFSError("InvalidInput", `deploy.${name} is not configured (LAYERFS_${name.toUpperCase()})`, null);
    }
  }
  if (!deploy.containerPrefix) delete deploy.containerPrefix;
  if (!deploy.daemonHost) delete deploy.daemonHost;
  return deploy;
}

/** Refuses every call on a closed client (or one no factory opened). */
export function live(client) {
  if (client?.[STATE]?.closed !== false) {
    throw new LayerFSError("InvalidInput", `this LayerFS client of ${client?.projectName} is closed; open another with LayerFS.open`, null);
  }
}

// Per-client opt-in: Store calls always keep their original local binding.
const NATIVE_CONTROL = new Set(["project.list_sandboxes", "sandbox.list_workspaces", "sandbox.close", "sandbox.create", "workspace.mount", "workspace.commit", "workspace.unmount", "workspace.exec"]);
export function bindClientControl(client, control) {
  live(client);
  if (!isLocalBinding(transportOf(client))) throw new LayerFSError("Unsupported", "native instance registration requires this client's in-process Store binding", null);
  if (client[STATE].control) throw new LayerFSError("InvalidInput", "this client already has its explicit native control; open another client for another registration", null);
  if (!control || typeof control.call !== "function" || typeof control.backendCall !== "function") throw new LayerFSError("InvalidInput", "native client control is incomplete", null);
  client[STATE].control = Object.freeze({ call: control.call, backendCall: control.backendCall });
}
function controlOf(client, op) {
  const selected = client[STATE].control;
  if (selected && (NATIVE_CONTROL.has(op) || op.startsWith("backend.daemon."))) return selected;
  return transportOf(client);
}

/** One call of an open client, with its deployment selection, discovery
 * home and the Store this process opened. */
export function invokeClient(client, op, args) {
  live(client);
  return invoke(op, { ...projectArgs(client), ...storeArgs(client), ...args }, client.options, controlOf(client, op));
}

/** One backend-table call of an open client, with the same fields. */
export function invokeClientBackend(client, op, args) {
  live(client);
  return invokeBackend(op, { ...projectArgs(client), ...storeArgs(client), ...args }, client.options, controlOf(client, op));
}

/** A call's project fields: the project, discovery home and the client's
 * deployment, whose daemonHost the binding dials when it reopens a Sandbox
 * from its record and whose settings start a new one. */
export function projectArgs(client) {
  return { project: client.projectName, home: client.options.home, deploy: client.options.deploy };
}

export const storeArgs = (client) => (client.options.storePath ? { storePath: client.options.storePath } : {});

/** Opens the client's Store in this process (one more client of it). */
export async function storeOpen(client) {
  return outcome(await transportOf(client).storeOpen({ project: client.projectName, home: client.options.home, ...storeArgs(client) }));
}

/** Releases the client's Store; the last client of the process closes it. */
export async function storeClose(client) {
  return outcome(await transportOf(client).storeClose({ project: client.projectName, home: client.options.home, ...storeArgs(client) }));
}

export function page(pageSize = 50, pagePos = 0) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000 || !Number.isSafeInteger(pagePos) || pagePos < 0) {
    throw new LayerFSError("InvalidInput", "pageSize must be 1..1000 and pagePos a nonnegative safe integer", null);
  }
  return { pageSize, pagePos };
}

/** One page of `items`, a whole list a call returned: `{ items, hasMore, nextPagePos }`. */
export function pageOf(items, { pageSize, pagePos }) {
  const end = pagePos + pageSize;
  return { items: items.slice(pagePos, end), hasMore: end < items.length, nextPagePos: end < items.length ? end : null };
}

export function diffOptions({ cursor, hunks } = {}) {
  if ((cursor !== undefined && cursor !== null && typeof cursor !== "string") || (hunks !== undefined && typeof hunks !== "boolean")) {
    throw new LayerFSError("InvalidInput", "cursor must be a path string and hunks a boolean", null);
  }
  return { ...(cursor == null ? {} : { cursor }), ...(hunks === undefined ? {} : { hunks }) };
}

export function checkedMessage(message) {
  if (message === undefined) return undefined;
  if (typeof message !== "string" || Buffer.byteLength(message) > 4096 || [...message].some((c) => (c.codePointAt(0) < 32 && c !== "\n" && c !== "\t") || (c.codePointAt(0) >= 127 && c.codePointAt(0) <= 159) || (c.codePointAt(0) >= 0xd800 && c.codePointAt(0) <= 0xdfff))) {
    throw new LayerFSError("InvalidInput", "message must be UTF-8, at most 4096 bytes, with no controls except newline/tab", null);
  }
  return message;
}

/** A write's last argument as call fields: a Commit message string, or
 * `{ message?, mode? }` where `mode` is the permission bits (e.g. `0o755`).
 * The engine checks `mode`; other option names are ignored. */
export function writeOptions(options) {
  if (options === undefined || typeof options === "string") return { message: checkedMessage(options) };
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new LayerFSError("InvalidInput", "options must be a message string or { message, mode }", null);
  }
  const { message, mode } = options;
  return { message: checkedMessage(message), ...(mode === undefined ? {} : { mode }) };
}
