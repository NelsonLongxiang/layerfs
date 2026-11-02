// The original resident native token/desktop owner. It is not a container image.
import { spawn } from "node:child_process";
import { LayerFSError } from "@layerfs/agent";

const retained = new Set();
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}
function integer(value) {
  if (!/^[1-9][0-9]*$/.test(value) || BigInt(value) > 0xffffffffffffffffn) throw new Error("native instance identity");
  return value;
}
export class NativeInstance {
  #options;
  #sessions;
  #released;
  #child;
  #state = "starting";
  #ready = deferred();
  #context;
  #line = "";
  #last;
  #failure;
  #beforeEffect;
  #stderr = Buffer.alloc(0);
  #stderrTruncated = false;
  #terminal;
  #closed;
  #pending = new Map();
  #next = 0n;
  #mount = 0;
  #mounting = 0;
  #timer;
  constructor(options, sessions, released) { this.#options = options; this.#sessions = sessions; this.#released = released; }
  observation() {
    return { id: this.#options.id, project: this.#options.project, work: this.#options.work,
      mode: "windows-restricted", state: this.#state, pid: this.#child?.pid ?? null,
      sessions: this.#owned().length, retainedSessions: this.#owned().filter((s) => s.state === "retained" || s.executionRetained).length };
  }
  #owned() { return this.#sessions.list().filter((s) => s.instance === this.#options.id); }
  #admit() {
    if (this.#state === "retained") throw this.#failure.error;
    if (this.#state !== "running") throw new LayerFSError("NoSuchSandbox", "this original native instance is not running; create one explicitly (mount never starts one)", { instance: this.#options.id });
  }
  async start() {
    const o = this.#options;
    try { this.#child = spawn(o.restrictedLauncher, ["--instance", o.sid, o.work], { stdio: ["pipe", "pipe", "pipe"], shell: false, windowsHide: true }); }
    catch (cause) { this.#notStarted(cause); return this.#ready.promise; }
    const child = this.#child;
    child.stdout.on("data", (chunk) => this.#data(chunk));
    child.stdout.on("error", (cause) => this.#retain(cause));
    child.stdout.on("end", () => { if (this.#line || (!this.#terminal && !this.#beforeEffect)) this.#retain(new Error("native instance EOF without outcome")); });
    child.stderr.on("error", (cause) => this.#retain(cause));
    // The original protocol, not stderr, decides. Do not accumulate unbounded logs.
    child.stderr.on("data", (chunk) => {
      const tail = Buffer.concat([this.#stderr, chunk]); this.#stderrTruncated ||= tail.length > 4096; this.#stderr = tail.subarray(-4096);
    });
    child.stdin.on("error", (cause) => { if (child.pid) this.#retain(cause); });
    child.on("error", (cause) => { if (!child.pid) this.#notStarted(cause); else this.#retain(cause); });
    child.on("close", (code, signal) => this.#exit(code, signal));
    this.#timer = setTimeout(() => this.#retain(new Error("native instance readiness deadline")), o.readyTimeoutMs);
    return this.#ready.promise;
  }
  #notStarted(cause, setup = false) {
    if (this.#state !== "starting") return;
    clearTimeout(this.#timer); this.#state = "failed"; this.#released();
    const error = new LayerFSError("Failed", setup ? "native instance setup failed; any claimed work path is retained" : "native instance process was not created", { instance: this.#options.id, setup, work: this.#options.work });
    this.#failure = { error, cause }; this.#ready.reject(error);
  }
  #retain(cause) {
    if (["closed", "failed", "retained"].includes(this.#state)) return;
    clearTimeout(this.#timer); this.#state = "retained";
    const error = new LayerFSError("Unknown", "original native instance outcome retained; no restart, mount or implicit stop", { instance: this.#options.id, pid: this.#child?.pid ?? null, retained: true });
    this.#failure = { error, cause, original: this.#last, partial: this.#line, stderr: this.#stderr, stderrTruncated: this.#stderrTruncated, pending: [...this.#pending.values()] };
    retained.add(this); this.#ready.reject(error);
    for (const p of this.#pending.values()) p.reject(error);
  }
  #data(chunk) {
    if (["closed", "failed", "retained"].includes(this.#state)) return;
    this.#last = chunk;
    try {
      if (chunk.some((b) => b > 127)) throw new Error("native instance reply encoding");
      let at = 0;
      while (at < chunk.length) {
        const end = chunk.indexOf(10, at), stop = end < 0 ? chunk.length : end;
        if (this.#line.length + stop - at > 4096) throw new Error("native instance reply processing window");
        this.#line += chunk.toString("ascii", at, stop);
        if (end < 0) return;
        const line = this.#line; this.#line = "";
        at = end + 1;
        let m;
        if ((m = /^LFS_INSTANCE_READY pid=([1-9][0-9]*) created=([1-9][0-9]*) restricted=true integrity=low$/.exec(line))) {
          if (this.#state !== "starting" || this.#beforeEffect || Number(m[1]) !== this.#child.pid) throw new Error("native instance root identity");
          this.#context = Object.freeze({ pid: integer(m[1]), created: integer(m[2]), launch: (request, response) => this.#call("launch", { request, response }) });
          clearTimeout(this.#timer); this.#state = "running";
          this.#ready.resolve(Object.freeze({ id: this.#options.id, project: this.#options.project, mode: "windows-restricted",
            status: () => this.#call("status"), mount: (branch) => this.#attach(branch), close: () => this.#close() }));
        } else if ((m = /^LFS_INSTANCE_FAILED win32=([0-9]+)$/.exec(line))) {
          if (this.#state !== "starting" || this.#beforeEffect) throw new Error("native instance failure after admission");
          this.#beforeEffect = new Error("native instance setup win32 " + m[1]);
        } else if ((m = /^LFS_INSTANCE_LAUNCHED id=([1-9][0-9]*) outcome=(transferred|refused)$/.exec(line))) {
          const id = integer(m[1]), p = this.#pending.get(id);
          if (!p || p.action !== "launch" || p.answered) throw new Error("native launch handoff correlation");
          this.#pending.delete(id); p.resolve({ outcome: m[2] });
        } else if ((m = /^LFS_INSTANCE_(STATUS|CLOSED) id=([1-9][0-9]*) (.*)$/.exec(line))) {
          const id = integer(m[2]), p = this.#pending.get(id);
          if (!p || p.answered) throw new Error("native instance response correlation");
          if (m[1] === "STATUS" && p.action === "status" && m[3] === "restricted=true integrity=low") {
            this.#pending.delete(id); p.resolve({ ...this.observation(), restricted: true, integrity: "low" });
          } else if (m[1] === "CLOSED" && p.action === "close" && m[3] === "token_closed=true desktop_closed=true") {
            p.answered = true; this.#terminal = { id, tokenClosed: true, desktopClosed: true };
          } else throw new Error("native instance response kind");
        } else throw new Error("native instance response grammar");
      }
    } catch (cause) { this.#retain(cause); }
  }
  #call(action, handles = null) {
    try { this.#admit(); } catch (error) { return Promise.reject(error); }
    if (++this.#next > 0xffffffffffffffffn) { this.#retain(new Error("native instance sequence exhausted")); return Promise.reject(this.#failure.error); }
    const id = this.#next.toString(), p = { ...deferred(), id, action, answered: false, request: id + " " + action + (handles ? " " + integer(handles.request) + " " + integer(handles.response) : "") + "\n" };
    this.#pending.set(id, p); if (action === "close") this.#state = "closing";
    try { this.#child.stdin.write(p.request, (cause) => { if (cause) this.#retain(cause); }); }
    catch (cause) { this.#retain(cause); }
    return p.promise;
  }
  async #attach(branch) {
    this.#admit();
    const o = this.#options;
    const n = ++this.#mount;
    const policy = Object.freeze({ executable: o.restrictedLauncher, sid: o.sid, context: this.#context, admit: () => this.#admit() });
    this.#mounting++;
    try {
      return await this.#sessions.open({ executable: o.executable, host: o.host, winfsp: o.winfsp, project: o.project, branch,
        work: o.work + "/" + n + "-work", path: o.work + "/" + n + "-mount", readyTimeoutMs: o.readyTimeoutMs }, { id: o.id, policy, store: o.store });
    } finally { this.#mounting--; }
  }
  #close() {
    if (this.#state === "closed") return Promise.resolve(this.#closed);
    try { this.#admit(); } catch (error) { return Promise.reject(error); }
    const sessions = this.#owned();
    if (sessions.length || this.#mounting) return Promise.reject(new LayerFSError(sessions.some((s) => s.state === "retained" || s.executionRetained) ? "Unknown" : "MountsActive", "native instance still owns original mounts or commands; unmount explicitly first", { instance: this.#options.id, sessions }));
    if (this.#pending.size) return Promise.reject(new LayerFSError("Busy", "native instance still owns an original status call", { instance: this.#options.id }));
    return this.#call("close");
  }
  #exit(code, signal) {
    clearTimeout(this.#timer);
    if (["failed", "retained"].includes(this.#state)) return;
    if (this.#beforeEffect && this.#state === "starting" && code === 1 && signal === null && !this.#line) { this.#notStarted(this.#beforeEffect, true); return; }
    if (code === 0 && signal === null && this.#terminal && !this.#line && this.#pending.size === 1) {
      const p = this.#pending.get(this.#terminal.id);
      if (p?.action === "close" && p.answered && !this.#owned().length) {
        this.#closed = Object.freeze({ ...this.#terminal, processExit: 0, processSignal: null });
        this.#state = "closed"; this.#pending.clear(); this.#released(); p.resolve(this.#closed); return;
      }
    }
    this.#retain(new Error("native instance exited without original acknowledged close: " + code + "/" + signal));
  }
}
