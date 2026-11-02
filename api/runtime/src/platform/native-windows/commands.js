// Trusted same-user host execution in a native mount, not Sandbox isolation.
// Ordinary pipes carry bytes with backpressure; root exit, stream EOF and native
// filesystem drain are independent. No shell, default deadline or implicit stop.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import { LayerFSError } from "@layerfs/agent";
import { PassThrough } from "node:stream";
import { restrictedProcess } from "./restricted.js";

const retained = new Set();

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  // These receipts may settle before the caller attaches; keep their exact
  // result available without generating a detached unhandled rejection.
  promise.catch(() => {});
  return { promise, resolve, reject };
}
function inputs(executable, args, options) {
  const bad = (message) => new LayerFSError("InvalidInput", message, null);
  if (typeof executable !== "string" || !isAbsolute(executable) || !/^[a-z]:[\\/]/i.test(executable) || executable.includes("\0")) throw bad("native exec requires an explicit absolute local executable");
  try { if (!lstatSync(executable).isFile()) throw new Error("not a file"); }
  catch { throw bad("native exec executable must be an existing regular file"); }
  if (!Array.isArray(args) || Array.from(args).some((s) => typeof s !== "string" || s.includes("\0"))) throw bad("native exec arguments must be strings without NUL");
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some((key) => key !== "env")) throw bad("native exec options are { env? }; no shell, cwd, timeout or automatic Commit");
  const env = {};
  // Do not inherit LayerFS deployment/capabilities, addon selection or arbitrary
  // host secrets. The caller can deliberately supply additional command values.
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(path|pathext|systemroot|windir|temp|tmp|comspec)$/i.test(key)) env[key.toUpperCase()] = value;
  }
  if (options.env !== undefined) {
    if (!options.env || typeof options.env !== "object" || Array.isArray(options.env)) throw bad("native exec env must be an object of explicit strings");
    const keys = new Set();
    for (const [key, value] of Object.entries(options.env)) {
      const upper = key.toUpperCase();
      if (!/^[a-z_][a-z0-9_]*$/i.test(key) || keys.has(upper) || typeof value !== "string" || value.includes("\0")) throw bad("native exec env names must be case-unique and values must be strings without NUL");
      keys.add(upper); env[upper] = value;
    }
  }
  return { executable, args: [...args], env };
}

export class NativeCommands {
  #path;
  #changed;
  #policy;
  #held = new Map();
  constructor(path, changed, policy = null) { this.#path = path; this.#changed = changed; this.#policy = policy; }
  observation() { return { commands: this.#held.size, executionRetained: [...this.#held.values()].some((p) => p.retained) }; }
  get idle() { return this.#held.size === 0; }
  async start(executable, args, options = {}) {
    const input = inputs(executable, args, options);
    this.#policy?.admit?.();
    const id = randomUUID(), opened = deferred(), exited = deferred(), finished = deferred();
    const output = [new PassThrough({ highWaterMark: 65536 }), new PassThrough({ highWaterMark: 65536 })];
    const owned = { id, input, opened, exited, finished, output, child: null, retained: false, root: null, closed: false, completed: false, cancelRequested: false, failure: null };
    this.#held.set(id, owned); // Before any awaited launch or close.
    const release = () => { this.#held.delete(id); this.#changed(); };
    const fail = (cause) => {
      if (owned.retained || owned.completed) return;
      const error = new LayerFSError("Unknown", "native command or stream outcome is uncertain; original process custody retained without replay or termination", { command: id, pid: owned.child?.pid ?? null, retained: true });
      owned.retained = true; owned.failure = { error, cause }; retained.add(owned);
      opened.reject(error); finished.reject(error); this.#changed();
    };
    const complete = () => {
      if (owned.retained || owned.completed || !owned.closed || !owned.root || output.some((s) => !s.readableEnded)) return;
      owned.completed = true;
      release(); finished.resolve(Object.freeze({ ...owned.root, command: id, pid: restricted ? restricted.pid : owned.child.pid, restricted: Boolean(restricted), stdoutEnded: true, stderrEnded: true, cancellationRequested: owned.cancelRequested }));
    };
    const notStarted = (cause) => {
      const error = new LayerFSError("Failed", "native command could not start; no command process was created", { command: id, phase: "spawn" });
      owned.failure = { error, cause }; owned.completed = true; release();
      opened.reject(error); exited.reject(error); finished.reject(error);
    };
    let child, restricted;
    try {
      restricted = this.#policy ? restrictedProcess(this.#policy, input, this.#path, fail, notStarted) : null;
      child = restricted?.child ?? spawn(input.executable, input.args, { cwd: this.#path, env: input.env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    }
    catch (cause) { notStarted(cause); return opened.promise; }
    owned.child = child;
    const announce = (pid) => {
      if (!Number.isSafeInteger(pid) || pid === process.pid) { fail(new Error("native command identity")); return; }
      opened.resolve(Object.freeze({ id, pid, restricted: Boolean(restricted), stdin: child.stdin, stdout: output[0], stderr: output[1], exited: exited.promise, finished: finished.promise,
        cancel: () => {
          // The original ChildProcess holds the process identity. Never look up
          // a pid by name or terminate a process tree/the filesystem service.
          if (owned.root) return { requested: false, rootExited: true };
          if (owned.cancelRequested) throw new LayerFSError("Busy", "cancellation already requested for this original root process", { command: id });
          owned.cancelRequested = true;
          try { return restricted ? restricted.cancel() : { requested: child.kill("SIGTERM"), rootExited: false }; }
          catch (cause) { fail(cause); throw owned.failure.error; }
        },
      }));
    };
    if (restricted) restricted.observe(announce, (root) => { owned.root = root; exited.resolve(root); });
    else child.once("spawn", () => announce(child.pid));
    child.on("error", (cause) => { if (!child.pid) notStarted(cause); else fail(cause); });
    // Install pipe consumers before root exit: Node resumes its own stdio at
    // exit, which otherwise discards unread output. These exposed streams keep
    // it and backpressure their sources, including when a descendant outlives
    // the root. Resist Node resuming a source while its destination is full.
    for (const [index, source] of [child.stdout, child.stderr].entries()) {
      const stream = output[index];
      source.on("error", fail);
      source.on("close", () => { if (child.pid && !source.readableEnded) fail(new Error("native command output closed before EOF")); });
      source.on("resume", () => { if (stream.writableNeedDrain) source.pause(); });
      stream.on("error", fail);
      stream.on("end", complete);
      stream.on("close", () => { if (child.pid && !stream.readableEnded) fail(new Error("native command output abandoned before EOF")); });
      source.pipe(stream);
    }
    child.stdin.on("error", fail);
    child.once("exit", (code, signal) => {
      if (restricted) return;
      if (code === null && signal === null) { fail(new Error("native command exit unavailable")); return; }
      owned.root = Object.freeze({ exitCode: code, signal }); exited.resolve(owned.root);
    });
    child.once("close", async (code, signal) => {
      if (!child.pid || owned.retained) return;
      if (restricted && !(await restricted.close(code, signal))) return;
      if (!owned.root || (!restricted && (owned.root.exitCode !== code || owned.root.signal !== signal)) || !child.stdout.readableEnded || !child.stderr.readableEnded) {
        fail(new Error("native command close lacks root exit or complete output EOF")); return;
      }
      owned.closed = true; complete();
    });
    return opened.promise;
  }
}
