// Explicit host-owned native filesystem sessions, not SDK Sandboxes.
import { randomBytes } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { LayerFSError } from "@layerfs/agent";
import { NativeSession } from "./session.js";
import { NAME, record } from "../../project/list.js";

const invalid = (message) => new LayerFSError("InvalidInput", message, null);
function within(parent, child) {
  const tail = relative(parent, child);
  return tail === "" || (!isAbsolute(tail) && tail !== ".." && !tail.startsWith(".." + sep));
}
export function checkedPath(value, label, existing) {
  if (typeof value !== "string" || value.includes("\0") || !isAbsolute(value) || !/^[a-z]:[\\/]/i.test(value)) throw invalid(label + " must be an absolute local drive path");
  const full = resolve(value);
  if (existing) {
    if (!lstatSync(full).isFile()) throw invalid(label + " must name an existing regular file");
    return realpathSync.native(full);
  }
  try { lstatSync(full); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    return resolve(realpathSync.native(dirname(full)), basename(full));
  }
  throw invalid(label + " must be fresh; existing paths are never replaced");
}
function checked(options, runtime) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw invalid("native.open takes explicit process, Store, work, path and binding options");
  const allowed = ["executable", "host", "winfsp", "store", "work", "path", "catalog", "cursor", "branch", "project", "readyTimeoutMs", "restrictedLauncher"];
  if (Object.keys(options).some((key) => !allowed.includes(key))) throw invalid("unknown native.open option; this is not sandbox.create or workspace.mount");
  const readyTimeoutMs = options.readyTimeoutMs ?? 15000;
  if (!Number.isSafeInteger(readyTimeoutMs) || readyTimeoutMs < 1 || readyTimeoutMs > 120000) throw invalid("readyTimeoutMs must be a whole number from 1 to 120000");
  const registered = options.project !== undefined;
  let projectRecord;
  if (registered) {
    if (typeof options.project !== "string" || !NAME.test(options.project) || typeof options.branch !== "string" || !NAME.test(options.branch) || options.branch === "main") throw invalid("registered native.open requires a project name and a non-main Branch name");
    if (["store", "catalog", "cursor"].some((key) => options[key] !== undefined)) throw invalid("registered native.open reads project authority itself; do not supply store, catalog or cursor");
    projectRecord = record(runtime.settings, options.project);
    if (!projectRecord || projectRecord.name !== options.project || typeof projectRecord.volume !== "string") throw new LayerFSError("NoSuchProject", "this runtime has no installed record for the named project", null);
  }
  if (!registered && (!(options.catalog instanceof Uint8Array) || options.catalog.length < 1 || options.catalog.length > 128 ||
      !(options.cursor instanceof Uint8Array) || options.cursor.length !== 32 || !options.cursor.some((b) => b !== 0) ||
      typeof options.branch !== "string" || !/^11[0-9a-f]{32}$/i.test(options.branch))) throw invalid("native binding requires catalog bytes (1-128), nonzero cursor bytes (32), and a Branch id (34 hex digits, tag 11)");
  const given = registered ? { ...options, store: runtime.platform.storePath(runtime.settings, projectRecord.volume) } : options;
  const paths = Object.fromEntries(["executable", "host", "winfsp", "store", "work", "path"].map((key) => [key, checkedPath(given[key], key, !["work", "path"].includes(key))]));
  if (within(paths.work, paths.path) || within(paths.path, paths.work) || within(paths.work, paths.store) || within(paths.path, paths.store)) throw invalid("native work, mount and Store paths must have independent ownership");
  const workspace = randomBytes(32);
  const restricted = options.restrictedLauncher === undefined ? null : {
    executable: checkedPath(options.restrictedLauncher, "restrictedLauncher", true),
    sid: "S-1-5-21-" + [0, 4, 8, 12].map((i) => workspace.readUInt32LE(i)).join("-"),
  };
  if (!workspace.some((b) => b !== 0)) throw new LayerFSError("Failed", "native Workspace identity acquisition failed", null);
  if (registered) {
    const parts = [runtime.settings.home, options.project, options.branch].map((s) => Buffer.from(s, "utf8"));
    if (parts[0].length > 4096 || parts.some((b) => !b.length || b.length > 65535)) throw invalid("registered native startup path/name window");
    const frame = Buffer.alloc(46 + parts.reduce((n, b) => n + b.length, 0));
    frame.write("LFSREG01"); parts.forEach((b, i) => frame.writeUInt16LE(b.length, 8 + i * 2));
    workspace.copy(frame, 14); let offset = 46;
    for (const b of parts) { b.copy(frame, offset); offset += b.length; }
    return { ...paths, id: workspace.toString("hex"), frame, readyTimeoutMs, restricted, project: options.project, branch: options.branch };
  }
  const frame = Buffer.alloc(91 + options.catalog.length);
  frame.write("LFSBND01"); frame.writeUInt16LE(options.catalog.length, 8);
  Buffer.from(options.catalog).copy(frame, 10); Buffer.from(options.cursor).copy(frame, 10 + options.catalog.length);
  Buffer.from(options.branch, "hex").copy(frame, 42 + options.catalog.length); workspace.copy(frame, 59 + options.catalog.length);
  return { ...paths, id: workspace.toString("hex"), frame, readyTimeoutMs, restricted, branch: options.branch.toLowerCase() };
}

export class NativeSessions {
  #runtime;
  #held = new Map();
  #roots = new Map();
  constructor(runtime) { this.#runtime = runtime; }
  claimInstance(id, work) {
    const roots = [...this.#roots.values(), ...this.list().flatMap((s) => [s.path, s.work])];
    if (roots.some((p) => within(p, work) || within(work, p))) throw new LayerFSError("Busy", "an original native owner holds this instance work path", null);
    this.#roots.set(id, work);
  }
  releaseInstance(id) { this.#roots.delete(id); }
  async open(options, context = null) {
    if (!this.#runtime.settings.native || process.platform !== "win32") throw new LayerFSError("Unsupported", "explicit native Sessions require the Windows-native runtime; SDK Sandbox and Workspace routes are unchanged", null);
    let input;
    try { input = checked(options, this.#runtime); }
    catch (error) { if (error instanceof LayerFSError) throw error; throw invalid("native input paths could not be checked"); }
    if (context) {
      if (input.store !== context.store) { input.frame.fill(0); throw new LayerFSError("InvalidInput", "the registered Store selection changed after this native instance was created", null); }
      input.restricted = context.policy;
      input.instance = context.id;
    }
    if ([...this.#roots].some(([id, root]) => id !== context?.id && [input.path, input.work].some((p) => within(root, p) || within(p, root)))) {
      input.frame.fill(0); throw new LayerFSError("Busy", "an original native instance owns this path; use its mount method", null);
    }
    // Claim before awaiting, including before any work/mount path is made.
    if ([...this.#held.values()].some((s) => [s.path, s.work].some((p) => within(p, input.path) || within(input.path, p) || within(p, input.work) || within(input.work, p)))) {
      input.frame.fill(0); throw new LayerFSError("Busy", "this runtime owns an overlapping native Session path", null);
    }
    const session = new NativeSession(input, () => this.#held.delete(input.id));
    this.#held.set(input.id, session);
    return session.start();
  }
  list() { return [...this.#held.values()].map((s) => s.observation()); }
  assertIdle() {
    if (!this.#held.size) return;
    const sessions = this.list();
    throw new LayerFSError(sessions.some((s) => s.state === "retained" || s.executionRetained) ? "Unknown" : "Busy", "native Sessions remain owned; unmount explicitly before closing this runtime (retained failures are never silently disposed)", { sessions });
  }
}
