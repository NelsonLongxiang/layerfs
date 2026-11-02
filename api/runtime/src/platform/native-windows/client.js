// Explicit SDK consumption of one original running native instance. Store calls
// keep the client's original local binding; container create/Bash Exec stay refused.
import { realpathSync } from "node:fs";
import { LayerFSError } from "@layerfs/agent";
import { bindClientControl, live } from "@layerfs/agent/internal";
const mode = "windows-restricted";
const samePath = (a, b) => typeof a === "string" && realpathSync.native(a) === realpathSync.native(b);
export class NativeClientRoute {
  #runtime;
  #original;
  #owner;
  #selection;
  #sandbox;
  #mounts = new Map();
  constructor(runtime, original, owner, selection, sandbox) {
    this.#runtime = runtime; this.#original = original; this.#owner = owner;
    this.#selection = selection; this.#sandbox = sandbox;
  }
  attach(client, options) {
    live(client);
    if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some((k) => k !== "commitScope") || options.commitScope !== "published") throw new LayerFSError("InvalidInput", "native SDK registration requires { commitScope: \"published\" }; no implicit mapping capture", null);
    this.#scope({ project: client.projectName, home: client.options.home, storePath: client.options.storePath });
    bindClientControl(client, { call: (op, args) => this.#call(op, args), backendCall: (op, args) => this.#backend(op, args) });
    return Object.freeze({ sandbox: this.#sandbox, image: null, mode });
  }
  #scope(args) {
    let paths = false;
    try { paths = samePath(args.home, this.#runtime.settings.home) && samePath(args.storePath, this.#selection.store); } catch { /* Refuse substituted/missing selection before effects. */ }
    if (args.project !== this.#selection.project || !paths) throw new LayerFSError("Unauthorized", "native registration belongs to its original project, home and installed Store", null);
  }
  async #running(sandbox) {
    if (sandbox !== this.#sandbox) throw new LayerFSError("NoSuchSandbox", "that native instance is not registered on this client; mount starts nothing", null);
    return this.#original.status();
  }
  #mounted(args) {
    const row = this.#mounts.get(args.path);
    if (!row) throw new LayerFSError("NotMounted", "this original native instance does not own that Workspace path", null);
    if (row.failure) throw row.failure;
    if (row.ending) throw new LayerFSError("Busy", "original native Workspace terminal operation is still owned", null);
    return row;
  }
  async #use(args, operation) {
    await this.#running(args.sandbox);
    const row = this.#mounted(args); row.calls++;
    try { return await operation(row); }
    catch (error) { if (error.code === "Unknown") row.failure = error; throw error; }
    finally { row.calls--; }
  }
  #value(row, state) {
    return { kind: "ok", mode, workspace: state.workspace, branch: row.branch, branchId: state.branch,
      base: state.head, baseLayer: state.baseLayer, root: state.root,
      branchHead: null, headMovedSinceMount: null,
      activity: state.prepared ? "Closing" : state.pendingCommit || state.active > 0n ? "Busy" : "Idle",
      overlay: { inodes: state.dirtyInodes, entries: state.dirtyEntries, pendingMerge: state.pendingMerge },
      native: state };
  }
  async #call(op, args) {
    this.#scope(args);
    if (op === "project.list_sandboxes") {
      if (this.#owner.observation().state === "closed") return { value: { items: [] } };
      const state = await this.#original.status();
      return { value: { items: [{ sandbox: this.#sandbox, name: this.#original.id, image: null, mode, workspaces: state.sessions }] } };
    }
    if (op === "sandbox.create") throw new LayerFSError("Unsupported", "native SDK registration consumes an already-running instance; container image creation is unchanged", null);
    await this.#running(args.sandbox);
    if (op === "sandbox.close") return { value: { kind: "Closed", mode, ...await this.#original.close() } };
    if (op === "workspace.mount") {
      if (typeof args.branch !== "string") throw new LayerFSError("InvalidInput", "native mount requires an existing Branch name", null);
      const observed = this.#owner.observation();
      if (observed.sessions >= 16) throw new LayerFSError("Capacity", "this native instance already owns 16 Workspace admissions; unmount explicitly or create another instance", null);
      {
        const session = await this.#original.mount(args.branch);
        const row = { session, branch: args.branch, calls: 0, ending: false, failure: null };
        this.#mounts.set(session.path, row); // Keep the original even if following observation fails.
        let state;
        try { state = await session.state(); }
        catch (error) { if (error.code === "Unknown") row.failure = error; throw error; }
        return { value: { kind: "Mounted", sandbox: this.#sandbox, path: session.path, image: null, mode, workspace: state.workspace, branch: args.branch, base: state.head, baseLayer: state.baseLayer, root: state.root } };
      }
    }
    if (op === "sandbox.list_workspaces") {
      if (this.#owner.observation().retainedSessions) throw new LayerFSError("Unknown", "original native instance retains a failed or incomplete Workspace admission", { retained: true });
      const workspaces = [];
      for (const [path, row] of this.#mounts) {
        const state = await this.#use({ ...args, path }, (row) => row.session.state());
        workspaces.push({ mounted: true, directory: path, workspace: state.workspace, branch: row.branch, base: state.head,
          activity: state.prepared ? "closing" : state.pendingCommit || state.active > 0n ? "committing" : "idle",
          dirty: { inodes: state.dirtyInodes, entries: state.dirtyEntries }, headMovedSinceMount: null, pendingMerge: state.pendingMerge, mode });
      }
      return { value: { version: null, workspaces } };
    }
    if (op === "workspace.commit") {
      if ((args.message !== undefined && args.message !== null) || args.force) throw new LayerFSError("Unsupported", "this native route preserves original Published Commit metadata; message and force are not implemented", null);
      const value = await this.#use(args, (row) => row.session.commit("published", true));
      return { value: { ...value, kind: value.changed ? "Committed" : "UpToDate", mode } };
    }
    if (op === "workspace.unmount") {
      if (args.force) throw new LayerFSError("Unsupported", "native forced unmount is not implemented; normal Busy remains reversible", null);
      if (args.discard !== undefined && typeof args.discard !== "boolean") throw new LayerFSError("InvalidInput", "native SDK discard must be boolean", null);
      const row = this.#mounted(args);
      if (row.calls) throw new LayerFSError("Busy", "this Workspace still owns original SDK calls", null);
      row.ending = true;
      try {
        const receipt = await row.session.unmount(args.discard === true);
        this.#mounts.delete(args.path);
        return { value: { kind: "Unmounted", mode, ...receipt } };
      } catch (error) {
        if (error.code === "Unknown") row.failure = error;
        else row.ending = false;
        throw error;
      }
    }
    throw new LayerFSError("Unsupported", "this native SDK registration serves mount/status/Published Commit/normal unmount; Bash Exec and other daemon methods are not implemented", null);
  }
  async #backend(op, args) {
    this.#scope(args);
    if (op !== "backend.daemon.workspace.status") throw new LayerFSError("Unsupported", "this native SDK registration has no requested daemon read model or process API", null);
    return { value: await this.#use(args, async (row) => this.#value(row, await row.session.state())) };
  }
}
