// One original native product process. No reconnect, replay, implicit Commit,
// process kill or operation timeout; the deadline bounds readiness only.
import { spawn } from "node:child_process";
import { LayerFSError } from "@layerfs/agent";
import { checkedMessage } from "@layerfs/agent/internal";
import { NativeCommands } from "./commands.js";

const MAX_LINE = 4096;
const MAX_U64 = (1n << 64n) - 1n;
const retained = new Set(); // A lost caller does not establish owner release.
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function uint(text) {
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error("native integer grammar");
  const n = BigInt(text);
  if (n > MAX_U64) throw new Error("native integer overflow");
  return n;
}
function flag(text) {
  if (text !== "true" && text !== "false") throw new Error("native boolean grammar");
  return text === "true";
}
const CODES = { "80000011": "Busy", c000000d: "InvalidInput", c00000bb: "Unsupported", c0000128: "NotMounted", e0f50001: "Dirty" };

export class NativeSession {
  #options;
  #released;
  #commands;
  #child;
  #state = "starting";
  #root;
  #boundBranch;
  #handle;
  #ready = deferred();
  #timer;
  #line = Buffer.alloc(0);
  #next = 0n;
  #pending = new Map();
  #terminal;
  #failure;
  #last;
  #stderr = Buffer.alloc(0); // Diagnostic tail, not a complete error archive.
  #stderrTruncated = false;
  constructor(options, released) {
    this.#options = options; this.#released = released;
    this.#commands = new NativeCommands(options.path, () => this.#releaseClosed(), options.restricted);
  }
  #releaseClosed() {
    if (this.#state === "closed" && this.#commands.idle) this.#released();
  }
  get path() { return this.#options.path; }
  get work() { return this.#options.work; }
  get instance() { return this.#options.instance; }
  get branch() { return this.#options.branch; }
  handle() {
    if (this.#state === "retained") throw this.#failure.error;
    if (["closed", "failed"].includes(this.#state)) throw new LayerFSError("NotMounted", "this original native Workspace is no longer mounted", { session: this.#options.id });
    if (this.#state !== "serving") throw new LayerFSError("Busy", "original native Workspace is starting or terminating", { session: this.#options.id });
    return this.#handle;
  }
  observation() {
    return { id: this.#options.id, path: this.path, work: this.work, ...(this.#options.instance ? { instance: this.#options.instance } : {}), ...(this.#options.project ? { project: this.#options.project, branch: this.#options.branch } : {}), ...this.#commands.observation(), restricted: Boolean(this.#options.restricted), state: this.#state, pid: this.#child?.pid ?? null, root: this.#root?.toString() ?? null };
  }
  async start() {
    const o = this.#options;
    try { this.#child = spawn(o.executable, [o.host, o.winfsp, o.store, o.work, o.path, ...(o.restricted ? [o.restricted.sid] : [])], { stdio: ["pipe", "pipe", "pipe"], shell: false, windowsHide: true }); }
    catch (cause) { this.#notStarted(cause); return this.#ready.promise; }
    const child = this.#child;
    child.stdout.on("data", (chunk) => this.#data(chunk));
    child.stdout.on("error", (cause) => this.#retain("native reply stream failed", cause));
    child.stdout.on("end", () => {
      if (!this.#terminal || this.#line.length) this.#retain("native reply stream ended without a complete original terminal acknowledgement", new Error("native reply EOF"));
    });
    child.stderr.on("error", (cause) => this.#retain("native diagnostic stream failed", cause));
    child.stderr.on("data", (chunk) => {
      const bytes = Buffer.concat([this.#stderr, chunk]);
      this.#stderrTruncated ||= bytes.length > MAX_LINE;
      this.#stderr = bytes.subarray(-MAX_LINE);
    });
    child.stdin.on("error", (cause) => { if (child.pid) this.#retain("native control stream failed; original operation not replayed", cause); });
    child.on("error", (cause) => {
      if (!child.pid && this.#state === "starting") this.#notStarted(cause);
      else this.#retain("native product process error", cause);
    });
    child.on("close", (code, signal) => this.#closed(code, signal));
    this.#timer = setTimeout(() => this.#retain("native root-service readiness was not established; process retained without restart", new Error("native readiness deadline")), o.readyTimeoutMs);
    try {
      child.stdin.write(o.frame, (cause) => {
        o.frame.fill(0);
        if (cause && child.pid) this.#retain("native binding transfer failed; no restart or resend", cause);
      });
    } catch (cause) {
      o.frame.fill(0);
      if (child.pid) this.#retain("native binding transfer failed; no restart or resend", cause);
      else this.#notStarted(cause);
    }
    return this.#ready.promise;
  }
  #notStarted(cause) {
    if (this.#state !== "starting") return;
    clearTimeout(this.#timer); this.#options.frame.fill(0);
    this.#state = "failed"; this.#released();
    const error = new LayerFSError("Failed", "native product process could not start", { session: this.#options.id, phase: "spawn" });
    this.#failure = { error, cause };
    this.#ready.reject(error);
  }
  #retain(message, cause, original = this.#last ?? this.#line) {
    if (["closed", "failed", "retained"].includes(this.#state)) return;
    clearTimeout(this.#timer); this.#state = "retained";
    const error = new LayerFSError("Unknown", message, { session: this.#options.id, path: this.path, pid: this.#child?.pid ?? null, retained: true });
    // Raw child text and credentials never enter user-facing message/detail.
    this.#failure = { error, cause, original, pending: [...this.#pending.values()], stderr: this.#stderr, stderrTruncated: this.#stderrTruncated };
    retained.add(this);
    this.#ready.reject(error);
    for (const p of this.#pending.values()) p.reject(error);
    // Retain the process, stream objects and original requests. No end/kill.
  }
  #data(chunk) {
    if (["retained", "failed", "closed"].includes(this.#state)) return;
    let at = 0;
    try {
      while (at < chunk.length) {
        const end = chunk.indexOf(10, at), stop = end < 0 ? chunk.length : end;
        if (this.#line.length + stop - at > MAX_LINE) {
          this.#retain("native reply exceeded its processing window", new Error("native line size"), { prefix: this.#line, chunk }); return;
        }
        this.#line = Buffer.concat([this.#line, chunk.subarray(at, stop)]);
        if (end < 0) return;
        const raw = this.#line; this.#line = Buffer.alloc(0); this.#last = raw;
        if (raw.some((b) => b > 127)) throw new Error("native reply ASCII grammar");
        this.#reply(raw.toString("ascii").replace(/\r$/, ""));
        if (this.#state === "retained") return;
        at = end + 1;
      }
    } catch (cause) { this.#retain("native reply did not match the original request; custody retained", cause); }
  }
  #reply(line) {
    let match = /^NATIVE_SERVICE_ROOT_SERVED root=([0-9]+) sdk_ready=false native=true$/.exec(line);
    if (match) {
      if (this.#state !== "starting") throw new Error("duplicate native readiness");
      this.#root = uint(match[1]); if (!this.#root) throw new Error("zero root");
      clearTimeout(this.#timer); this.#state = "serving";
      this.#handle = Object.freeze({ id: this.#options.id, path: this.path,
        status: () => this.#call("status"),
        state: () => this.#call("state"),
        reference: (after = 0n, offset = 0n) => {
          if ([after, offset].some((n) => typeof n !== "bigint" || n < 0n || n > MAX_U64)) return Promise.reject(new LayerFSError("InvalidInput", "native reference cursor and path byte offset must be u64 bigint values", null));
          return this.#call("reference", { after, offset });
        },
        commit: (scope, details = false, ...metadata) => {
          if (scope !== "published" || typeof details !== "boolean") return Promise.reject(new LayerFSError("Unsupported", "native Session commit requires explicit published scope; application-visible mapping capture is unsupported", null));
          if (metadata.length > 2) return Promise.reject(new LayerFSError("InvalidInput", "native Commit takes optional message and force", null));
          let fields = {};
          try { if (metadata.length) fields = { hasMessage: true, message: checkedMessage(metadata[0]) }; }
          catch (cause) { return Promise.reject(cause); }
          if (metadata.length > 1) {
            const force = metadata[1] === undefined ? false : metadata[1];
            if (typeof force !== "boolean") return Promise.reject(new LayerFSError("InvalidInput", "force must be boolean", null));
            fields = { ...fields, hasForce: true, force };
          }
          return this.#call(details ? "publication" : "commit", fields);
        },
        unmount: (discard = true) => typeof discard === "boolean" ? this.#call(discard ? "unmount" : "unmount-clean") : Promise.reject(new LayerFSError("InvalidInput", "native unmount discard must be boolean", null)),
        exec: (executable, args, options) => {
          if (this.#state === "retained") return Promise.reject(this.#failure.error);
          if (this.#state !== "serving") return Promise.reject(new LayerFSError(this.#state === "closed" ? "NotMounted" : "Busy", "native command needs its original serving Session", null));
          return this.#commands.start(executable, args, options);
        },
      });
      this.#ready.resolve(this.#handle);
      return;
    }
    match = /^NATIVE_SERVICE_(STATUS|STATE|REFERENCE|COMMIT|PUBLICATION|UNMOUNTED|REFUSED) id=([0-9]+) (.*)$/.exec(line);
    if (!match || !["serving", "unmounting"].includes(this.#state)) throw new Error("unexpected native reply");
    const id = uint(match[2]).toString(), p = this.#pending.get(id);
    if (!p || p.answered) throw new Error("foreign or duplicate native reply id");
    const kind = match[1], payload = match[3];
    const unmount = ["unmount", "unmount-clean"].includes(p.kind);
    if (kind === "REFUSED") {
      const refusal = /^status=([0-9a-f]{8})( service_kept=true)?$/.exec(payload);
      if (!refusal || (refusal[2] && !unmount)) throw new Error("native refusal shape");
      const code = CODES[refusal[1]];
      if (!code) { this.#retain("native product retained a failed or unknown original operation", new Error("native status " + refusal[1]), line); return; }
      if (code === "Dirty" && p.kind !== "unmount-clean") throw new Error("Dirty response for a different original operation");
      if (unmount) {
        if (!["Busy", "Dirty"].includes(code) || !refusal[2] || (code === "Dirty" && p.kind !== "unmount-clean")) throw new Error("unmount refusal did not establish the original service/discard outcome");
        this.#state = "serving";
      }
      this.#pending.delete(id);
      p.reject(new LayerFSError(code, "native product refused the original " + p.kind, { session: this.#options.id, status: refusal[1], serviceKept: Boolean(refusal[2]) }));
      return;
    }
    if (kind === "STATUS" && p.kind === "status") {
      const s = /^root=([0-9]+) revision=([0-9]+) handles=([0-9]+) requests=([0-9]+) active=([0-9]+) retained=(true|false) prepared=(true|false) pending_commit=([01]) files=([0-9]+) directories=([0-9]+)$/.exec(payload);
      if (!s) throw new Error("native status shape");
      const value = { root: uint(s[1]), revision: uint(s[2]), handles: uint(s[3]), requests: uint(s[4]), active: uint(s[5]), retained: flag(s[6]), prepared: flag(s[7]), pendingCommit: s[8] === "1", files: uint(s[9]), directories: uint(s[10]) };
      if (value.root !== this.#root || value.files + value.directories !== value.handles) throw new Error("native status identity");
      if (value.retained) { this.#retain("native status reports original failure custody", new Error("native retained state"), line); return; }
      this.#pending.delete(id); p.resolve(value); return;
    }
    if (kind === "REFERENCE" && p.kind === "reference") {
      const end = /^after=([0-9]+) offset=([0-9]+) found=false$/.exec(payload);
      const row = /^after=([0-9]+) offset=([0-9]+) found=true handle=([0-9]+) serial=([0-9]+) file=(true|false) directory=(true|false) lookup=(true|false) cleaned=(true|false) data_writable=(true|false) attributes_writable=(true|false) delete_access=(true|false) path_bytes=(-|[0-9]+) next_offset=(-|[0-9]+) path=(-|[0-9a-f]+)$/.exec(payload);
      const match = end ?? row;
      if (!match || uint(match[1]) !== p.after || uint(match[2]) !== p.offset) throw new Error("native reference request correlation");
      let value = { found: false, after: p.after, offset: p.offset };
      if (row) {
        const handle = uint(row[3]), serial = uint(row[4]), file = flag(row[5]), directory = flag(row[6]);
        const pathBytes = row[12] === "-" ? null : uint(row[12]), nextOffset = row[13] === "-" ? null : uint(row[13]);
        if (row[14] !== "-" && row[14].length % 2) throw new Error("native reference path hex");
        const path = row[14] === "-" ? Buffer.alloc(0) : Buffer.from(row[14], "hex");
        const endOffset = p.offset + BigInt(path.length);
        if (handle <= p.after || serial === 0n || file === directory || path.length > 1024 ||
            (pathBytes === null ? p.offset !== 0n || path.length !== 0 || nextOffset !== null : endOffset > pathBytes ||
              (endOffset < pathBytes ? path.length !== 1024 || nextOffset !== endOffset : nextOffset !== null))) throw new Error("native reference window identity/progress");
        value = { ...value, found: true, handle, serial, file, directory, lookup: flag(row[7]), cleaned: flag(row[8]),
          dataWritable: flag(row[9]), attributesWritable: flag(row[10]), deleteAccess: flag(row[11]), pathBytes, path, nextOffset };
      }
      this.#pending.delete(id); p.resolve(value); return;
    }
    if (kind === "STATE" && p.kind === "state") {
      const s = /^workspace=([0-9a-f]{64}) branch=(11[0-9a-f]{32}) head=(-|12[0-9a-f]{64}) base=(32[0-9a-f]{64}) root=([0-9a-f]{64}) revision=([0-9]+) dirty_inodes=([0-9]+) dirty_entries=([0-9]+) handles=([0-9]+) active=([0-9]+) retained=(true|false) prepared=(true|false) pending_commit=([01]) pending_merge=(true|false)$/.exec(payload);
      if (!s || s[1] !== this.#options.id) throw new Error("native state identity/shape");
      const expectedBranch = this.#boundBranch ?? (this.#options.project ? null : this.#options.branch.toLowerCase());
      if (expectedBranch && expectedBranch !== s[2]) throw new Error("native Branch binding changed");
      this.#boundBranch = s[2];
      const value = { workspace: s[1], branch: s[2], head: s[3] === "-" ? null : s[3], baseLayer: s[4], root: s[5], revision: uint(s[6]), dirtyInodes: uint(s[7]), dirtyEntries: uint(s[8]), handles: uint(s[9]), active: uint(s[10]), retained: flag(s[11]), prepared: flag(s[12]), pendingCommit: s[13] === "1", pendingMerge: flag(s[14]) };
      if (value.retained) { this.#retain("native state reports original uncertain custody", new Error("native retained state"), line); return; }
      this.#pending.delete(id); p.resolve(value); return;
    }
    if (kind === "PUBLICATION" && p.kind === "publication") {
      const c = /^changed=(true|false) revision=([0-9]+) head=(-|12[0-9a-f]{64}) base=(32[0-9a-f]{64}) root=([0-9a-f]{64}) parent=(-|12[0-9a-f]{64}) displaced=(-|12[0-9a-f]{64}) merge_from=(-|12[0-9a-f]{64}) merge_head=(-|12[0-9a-f]{64}) published=true$/.exec(payload);
      if (!c || (c[1] === "true" && c[3] === "-")) throw new Error("native original publication shape");
      const identity = (s) => s === "-" ? null : s;
      const value = { changed: flag(c[1]), revision: uint(c[2]), head: identity(c[3]), baseLayer: c[4], root: c[5], parent: identity(c[6]), displacedHead: identity(c[7]), merged: c[8] === "-" && c[9] === "-" ? null : { from: identity(c[8]), head: identity(c[9]) }, scope: "published", published: true };
      this.#pending.delete(id); p.resolve(value); return;
    }
    if (kind === "COMMIT" && p.kind === "commit") {
      const c = /^changed=(true|false) revision=([0-9]+) published=true$/.exec(payload);
      if (!c) throw new Error("native Commit shape");
      this.#pending.delete(id); p.resolve({ changed: flag(c[1]), revision: uint(c[2]), scope: "published", published: true }); return;
    }
    if (kind === "UNMOUNTED" && unmount) {
      const u = /^native_exit=0 dispatcher_exit=(c0000120|00000000) overlay_closed=true$/.exec(payload);
      if (!u) throw new Error("native terminal shape");
      p.answered = true;
      this.#terminal = { id, nativeExit: 0, dispatcherExit: u[1], overlayClosed: true };
      return; // Wait for close of this exact parent, not merely an event line.
    }
    throw new Error("native reply kind differs from the request");
  }
  #call(kind, fields = {}) {
    if (this.#state === "retained") return Promise.reject(this.#failure.error);
    if (this.#state === "closed") return Promise.reject(new LayerFSError("NotMounted", "this native Session is closed", { session: this.#options.id }));
    if (this.#state !== "serving" || (["unmount", "unmount-clean"].includes(kind) && this.#pending.size)) return Promise.reject(new LayerFSError("Busy", "native Session is starting, terminating or still owns original calls", { session: this.#options.id }));
    if (++this.#next > MAX_U64) {
      this.#retain("native command identity exhausted", new Error("native id overflow")); return Promise.reject(this.#failure.error);
    }
    const id = this.#next.toString();
    const metadata = fields.hasMessage ? " message " + (fields.message === undefined ? "none" : fields.message === "" ? "-" : Buffer.from(fields.message, "utf8").toString("hex")) : "";
    const p = { ...deferred(), id, kind, ...fields, request: id + " " + (kind === "reference" ? "reference " + fields.after + " " + fields.offset : kind === "commit" ? "commit published" : kind === "publication" ? "commit published identity" : kind === "unmount-clean" ? "unmount clean" : kind) + metadata + (fields.hasForce ? " force " + fields.force : "") + "\n", answered: false };
    this.#pending.set(id, p);
    if (["unmount", "unmount-clean"].includes(kind)) this.#state = "unmounting";
    try { this.#child.stdin.write(p.request, (cause) => { if (cause) this.#retain("native command transfer failed; original request retained", cause, p); }); }
    catch (cause) { this.#retain("native command transfer failed; original request retained", cause, p); }
    return p.promise;
  }
  #closed(code, signal) {
    clearTimeout(this.#timer);
    if (["failed", "retained"].includes(this.#state)) return;
    if (code === 0 && signal === null && this.#terminal && this.#line.length === 0 && this.#pending.size === 1) {
      const p = this.#pending.get(this.#terminal.id);
      if (["unmount", "unmount-clean"].includes(p?.kind) && p.answered) {
        this.#state = "closed"; this.#pending.clear(); this.#releaseClosed(); retained.delete(this);
        p.resolve({ ...this.#terminal, processExit: 0, processSignal: null }); return;
      }
    }
    this.#retain("native product process ended without its correlated terminal acknowledgement", new Error("native exit " + code + ", signal " + signal));
  }
}
