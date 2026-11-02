// One original native product process. No reconnect, replay, implicit Commit,
// process kill or operation timeout; the deadline bounds readiness only.
import { spawn } from "node:child_process";
import { LayerFSError } from "@layerfs/agent";
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
const CODES = { "80000011": "Busy", c000000d: "InvalidInput", c00000bb: "Unsupported", c0000128: "NotMounted" };

export class NativeSession {
  #options;
  #released;
  #commands;
  #child;
  #state = "starting";
  #root;
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
  observation() {
    return { id: this.#options.id, path: this.path, work: this.work, ...(this.#options.project ? { project: this.#options.project, branch: this.#options.branch } : {}), ...this.#commands.observation(), restricted: Boolean(this.#options.restricted), state: this.#state, pid: this.#child?.pid ?? null, root: this.#root?.toString() ?? null };
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
      this.#ready.resolve(Object.freeze({ id: this.#options.id, path: this.path,
        status: () => this.#call("status"),
        commit: (scope) => scope === "published" ? this.#call("commit") : Promise.reject(new LayerFSError("Unsupported", "native Session commit requires explicit scope \"published\"; application-visible mapping capture is unsupported", null)),
        unmount: () => this.#call("unmount"),
        exec: (executable, args, options) => {
          if (this.#state === "retained") return Promise.reject(this.#failure.error);
          if (this.#state !== "serving") return Promise.reject(new LayerFSError(this.#state === "closed" ? "NotMounted" : "Busy", "native command needs its original serving Session", null));
          return this.#commands.start(executable, args, options);
        },
      }));
      return;
    }
    match = /^NATIVE_SERVICE_(STATUS|COMMIT|UNMOUNTED|REFUSED) id=([0-9]+) (.*)$/.exec(line);
    if (!match || !["serving", "unmounting"].includes(this.#state)) throw new Error("unexpected native reply");
    const id = uint(match[2]).toString(), p = this.#pending.get(id);
    if (!p || p.answered) throw new Error("foreign or duplicate native reply id");
    const kind = match[1], payload = match[3];
    if (kind === "REFUSED") {
      const refusal = /^status=([0-9a-f]{8})( service_kept=true)?$/.exec(payload);
      if (!refusal || (refusal[2] && p.kind !== "unmount")) throw new Error("native refusal shape");
      const code = CODES[refusal[1]];
      if (!code) { this.#retain("native product retained a failed or unknown original operation", new Error("native status " + refusal[1]), line); return; }
      if (p.kind === "unmount") {
        if (code !== "Busy" || !refusal[2]) throw new Error("unmount refusal did not establish service retention");
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
    if (kind === "COMMIT" && p.kind === "commit") {
      const c = /^changed=(true|false) revision=([0-9]+) published=true$/.exec(payload);
      if (!c) throw new Error("native Commit shape");
      this.#pending.delete(id); p.resolve({ changed: flag(c[1]), revision: uint(c[2]), scope: "published", published: true }); return;
    }
    if (kind === "UNMOUNTED" && p.kind === "unmount") {
      const u = /^native_exit=0 dispatcher_exit=(c0000120|00000000) overlay_closed=true$/.exec(payload);
      if (!u) throw new Error("native terminal shape");
      p.answered = true;
      this.#terminal = { id, nativeExit: 0, dispatcherExit: u[1], overlayClosed: true };
      return; // Wait for close of this exact parent, not merely an event line.
    }
    throw new Error("native reply kind differs from the request");
  }
  #call(kind) {
    if (this.#state === "retained") return Promise.reject(this.#failure.error);
    if (this.#state === "closed") return Promise.reject(new LayerFSError("NotMounted", "this native Session is closed", { session: this.#options.id }));
    if (this.#state !== "serving" || (kind === "unmount" && this.#pending.size)) return Promise.reject(new LayerFSError("Busy", "native Session is starting, terminating or still owns original calls", { session: this.#options.id }));
    if (++this.#next > MAX_U64) {
      this.#retain("native command identity exhausted", new Error("native id overflow")); return Promise.reject(this.#failure.error);
    }
    const id = this.#next.toString();
    const p = { ...deferred(), id, kind, request: id + " " + (kind === "commit" ? "commit published" : kind) + "\n", answered: false };
    this.#pending.set(id, p);
    if (kind === "unmount") this.#state = "unmounting";
    try { this.#child.stdin.write(p.request, (cause) => { if (cause) this.#retain("native command transfer failed; original request retained", cause, p); }); }
    catch (cause) { this.#retain("native command transfer failed; original request retained", cause, p); }
    return p.promise;
  }
  #closed(code, signal) {
    clearTimeout(this.#timer);
    if (["failed", "retained"].includes(this.#state)) return;
    if (code === 0 && signal === null && this.#terminal && this.#line.length === 0 && this.#pending.size === 1) {
      const p = this.#pending.get(this.#terminal.id);
      if (p?.kind === "unmount" && p.answered) {
        this.#state = "closed"; this.#pending.clear(); this.#releaseClosed(); retained.delete(this);
        p.resolve({ ...this.#terminal, processExit: 0, processSignal: null }); return;
      }
    }
    this.#retain("native product process ended without its correlated terminal acknowledgement", new Error("native exit " + code + ", signal " + signal));
  }
}
