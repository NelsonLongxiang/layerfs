// Explicit SDK consumption of one original running native instance. Store calls
// keep the client's original local binding; container create/Bash Exec stay refused.
import { realpathSync } from "node:fs";
import { LayerFSError } from "@layerfs/agent";
import { bindClientControl, live, checkedMessage } from "@layerfs/agent/internal";
const mode = "windows-restricted";
const samePath = (a, b) => typeof a === "string" && realpathSync.native(a) === realpathSync.native(b);
export class NativeClientRoute {
  #runtime;
  #original;
  #owner;
  #selection;
  #sandbox;
  constructor(runtime, original, owner, selection, sandbox) {
    this.#runtime = runtime; this.#original = original; this.#owner = owner;
    this.#selection = selection; this.#sandbox = sandbox;
  }
  attach(client, options) {
    live(client);
    if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some((k) => k !== "commitScope") || options.commitScope !== "published") throw new LayerFSError("InvalidInput", "native SDK registration requires { commitScope: \"published\" }; no implicit mapping capture", null);
    this.#scope({ project: client.projectName, home: client.options.home, storePath: client.options.storePath });
    // The client travels with each control binding: one original instance can be
    // registered on several independent clients, and a shared route must never
    // remember whichever attached last.
    bindClientControl(client, { call: (op, args) => this.#call(client, op, args), backendCall: (op, args) => this.#backend(client, op, args) });
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
    const session = this.#owner.workspaces().find((s) => s.path === args.path);
    if (!session) throw new LayerFSError("NotMounted", "this original native instance does not own that Workspace path", null);
    return session;
  }
  async #use(args, operation) {
    await this.#running(args.sandbox);
    return operation(this.#mounted(args));
  }
  // Status reads no Store itself: the client's own binding supplies the current
  // head separately, exactly as the daemon binding does. An unavailable read
  // stays unobserved (null) rather than being guessed from the bound base.
  async #head(client, session, base) {
    try {
      const page = await client.branch.list_commits(session.branch, 1, 0);
      const head = Array.isArray(page?.items) && page.items.length ? page.items[0].id : null;
      if (head !== null || base === null) return { head, moved: head !== base };
      return null; // A Branch with a bound base has a head; an empty answer is not evidence.
    } catch { return null; }
  }
  #value(row, state, observed) {
    return { kind: "ok", mode, workspace: state.workspace, branch: row.branch, branchId: state.branch,
      base: state.head, baseLayer: state.baseLayer, root: state.root,
      branchHead: observed ? observed.head : null, headMovedSinceMount: observed ? observed.moved : null,
      activity: state.prepared ? "Closing" : state.pendingCommit || state.active > 0n ? "Busy" : "Idle",
      overlay: { inodes: state.dirtyInodes, entries: state.dirtyEntries, pendingMerge: state.pendingMerge },
      native: state };
  }
  async #call(client, op, args) {
    this.#scope(args);
    if (op === "project.list_sandboxes") {
      if (this.#owner.observation().state === "closed") return { value: { items: [] } };
      await this.#original.status();
      return { value: { items: [{ sandbox: this.#sandbox, name: this.#original.id, image: null, mode, workspaces: this.#owner.workspaces().filter((s) => s.observation().state !== "closed").length }] } };
    }
    if (op === "sandbox.create") throw new LayerFSError("Unsupported", "native SDK registration consumes an already-running instance; container image creation is unchanged", null);
    if (op === "workspace.exec") {
      const command = args.command;
      if (typeof command === "string") throw new LayerFSError("Unsupported", "Bash strings are not Windows executable/argv commands; supply an explicit windows-native command object", null);
      let input;
      try { input = structuredClone(command); } // Snapshot before the instance-status await.
      catch { throw new LayerFSError("InvalidInput", "native command fields must be copyable values", null); }
      if (!input || typeof input !== "object" || Array.isArray(input) || input.mode !== "windows-native" || Object.keys(input).some((k) => !["mode", "executable", "args", "env"].includes(k))) throw new LayerFSError("InvalidInput", "native command is { mode: windows-native, executable, args, env? }; no shell, cwd or deadline", null);
      if (args.message !== undefined || args.spool !== undefined || args.sinks !== undefined) throw new LayerFSError("InvalidInput", "native execution returns original stream handles; message, spool and sinks do not apply", null);
      return { value: await this.#use(args, (session) => session.handle().exec(input.executable, input.args, input.env === undefined ? {} : { env: input.env })) };
    }
    if (op === "workspace.commit") {
      const force = args.force === undefined ? false : args.force;
      if (typeof force !== "boolean") throw new LayerFSError("InvalidInput", "force must be boolean", null);
      const message = checkedMessage(args.message);
      const value = await this.#use(args, (session) => session.handle().commit("published", true, message, force));
      return { value: { ...value, kind: value.changed ? "Committed" : "UpToDate", mode } };
    }
    await this.#running(args.sandbox);
    if (op === "sandbox.close") return { value: { kind: "Closed", mode, ...await this.#original.close() } };
    if (op === "workspace.mount") {
      if (typeof args.branch !== "string" || args.branch.trim() === "") throw new LayerFSError("InvalidInput", "native mount requires an existing Branch name", null);
      // The container contract groups the protected base Branch with a missing one.
      if (args.branch === "main") throw new LayerFSError("NoSuchBranch", "main is the protected base Branch; fork a Branch from it", null);
      // A Branch this project does not have must refuse here: starting an original
      // target would consume an owner slot and leave retained custody for a typo.
      // Only a definite NoSuchBranch is translated; any other Store outcome is
      // left to the original Session, which still validates the binding.
      try { await client.branch.list_commits(args.branch, 1, 0); }
      catch (error) { if (error?.code === "NoSuchBranch" || error?.code === "InvalidInput") throw error; }
      const session = await this.#original.mount(args.branch);
      const state = await session.state();
      return { value: { kind: "Mounted", sandbox: this.#sandbox, path: session.path, image: null, mode, workspace: state.workspace, branch: args.branch, base: state.head, baseLayer: state.baseLayer, root: state.root } };
    }
    if (op === "sandbox.list_workspaces") {
      if (this.#owner.observation().retainedSessions) throw new LayerFSError("Unknown", "original native instance retains a failed or incomplete Workspace admission", { retained: true });
      const workspaces = [];
      for (const session of this.#owner.workspaces()) {
        if (session.observation().state === "closed") continue; // Command completion may still hold the owner, not a mount.
        const state = await session.handle().state(), observed = await this.#head(client, session, state.head);
        workspaces.push({ mounted: true, directory: session.path, workspace: state.workspace, branch: session.branch, base: state.head,
          activity: state.prepared ? "closing" : state.pendingCommit || state.active > 0n ? "committing" : "idle",
          dirty: { inodes: state.dirtyInodes, entries: state.dirtyEntries }, headMovedSinceMount: observed ? observed.moved : null, pendingMerge: state.pendingMerge, mode });
      }
      return { value: { version: null, workspaces } };
    }
    if (op === "workspace.unmount") {
      if (args.force) throw new LayerFSError("Unsupported", "native forced unmount is not implemented; normal Busy remains reversible", null);
      if (args.discard !== undefined && typeof args.discard !== "boolean") throw new LayerFSError("InvalidInput", "native SDK discard must be boolean", null);
      const receipt = await this.#mounted(args).handle().unmount(args.discard === true);
      return { value: { kind: "Unmounted", mode, ...receipt } };
    }
    throw new LayerFSError("Unsupported", "this native SDK registration serves mount/status/Published Commit/normal unmount; Bash Exec and other daemon methods are not implemented", null);
  }
  async #backend(client, op, args) {
    this.#scope(args);
    if (op !== "backend.daemon.workspace.status") throw new LayerFSError("Unsupported", "this native SDK registration has no requested daemon read model or process API", null);
    return { value: await this.#use(args, async (session) => {
      const state = await session.handle().state();
      return this.#value(session, state, await this.#head(client, session, state.head));
    }) };
  }
}
