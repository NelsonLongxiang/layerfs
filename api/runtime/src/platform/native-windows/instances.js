// Resident Windows execution contexts owned by this runtime, not container images.
import { randomBytes, randomUUID } from "node:crypto";
import { relative, isAbsolute, sep } from "node:path";
import { LayerFSError } from "@layerfs/agent";
import { NAME, record } from "../../project/list.js";
import { checkedPath } from "./sessions.js";
import { NativeInstance } from "./instance.js";
function within(parent, child) {
  const value = relative(parent, child);
  return !value || (!isAbsolute(value) && value !== ".." && !value.startsWith(".." + sep));
}
export class NativeInstances {
  #runtime;
  #sessions;
  #held = new Map();
  constructor(runtime, sessions) { this.#runtime = runtime; this.#sessions = sessions; }
  async create(options) {
    if (!this.#runtime.settings.native || process.platform !== "win32") throw new LayerFSError("Unsupported", "native instances require the Windows-native runtime", null);
    const invalid = (message) => new LayerFSError("InvalidInput", message, null);
    if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some((k) => !["project", "executable", "host", "winfsp", "restrictedLauncher", "work", "readyTimeoutMs"].includes(k))) throw invalid("native.create takes explicit project, product executables and fresh work; no container image selection");
    if (typeof options.project !== "string" || !NAME.test(options.project)) throw invalid("native instance project name required");
    const project = record(this.#runtime.settings, options.project);
    if (!project || project.name !== options.project || typeof project.volume !== "string") throw new LayerFSError("NoSuchProject", "this runtime has no installed project record", null);
    const readyTimeoutMs = options.readyTimeoutMs ?? 15000;
    if (!Number.isSafeInteger(readyTimeoutMs) || readyTimeoutMs < 1 || readyTimeoutMs > 120000) throw invalid("native instance readiness window is 1–120000 milliseconds");
    let input;
    try {
      input = Object.fromEntries(["executable", "host", "winfsp", "restrictedLauncher", "work"].map((k) => [k, checkedPath(options[k], k, k !== "work")]));
      input.store = checkedPath(this.#runtime.platform.storePath(this.#runtime.settings, project.volume), "project Store", true);
      if (within(input.work, input.store) || within(input.work, this.#runtime.settings.home)) throw invalid("native instance work must not contain its Store or project home");
    } catch (error) { if (error instanceof LayerFSError) throw error; throw invalid("native instance paths could not be checked"); }
    const owners = [...this.list(), ...this.#sessions.list()];
    if (owners.some((o) => [o.work, o.path].filter(Boolean).some((p) => within(p, input.work) || within(input.work, p)))) throw new LayerFSError("Busy", "an existing native owner holds this work path", null);
    const bytes = randomBytes(16), id = randomUUID();
    const sid = "S-1-5-21-" + [0, 4, 8, 12].map((i) => bytes.readUInt32LE(i)).join("-");
    this.#sessions.claimInstance(id, input.work);
    const instance = new NativeInstance({ ...input, id, sid, project: options.project, readyTimeoutMs }, this.#sessions, () => { this.#held.delete(id); this.#sessions.releaseInstance(id); });
    this.#held.set(id, instance);
    return instance.start();
  }
  list() { return [...this.#held.values()].map((i) => i.observation()); }
  assertIdle() {
    if (!this.#held.size) return;
    const instances = this.list();
    throw new LayerFSError(instances.some((i) => i.state === "retained") ? "Unknown" : "Busy", "runtime still owns a native instance; close that original instance explicitly", { instances });
  }
}
