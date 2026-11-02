// The Windows-native Store route (#352, owner 2026-10-25): Store calls run in
// this process, no WSL worker and no Docker engine. Only the Store face is
// served — project, fs and branch; SDK Sandbox and Workspace calls still refuse
// Unsupported in the engine table. runtime.native separately starts explicit
// host-owned filesystem Sessions; they are not SDK Sandboxes or a Store worker.
//
// This module keeps the same shape as platform/windows so the runtime needs no
// second code path: the calls that only make sense with a worker (start,
// restart, releaseStore, docker, free) either answer `null`/no-op or refuse,
// and `endpoint` is null so @layerfs/agent is never handed a worker.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { LayerFSError } from "@layerfs/agent";

const refuse = (code, message) => new LayerFSError(code, message, null);

/** No Store worker is started here; explicit native Sessions have their own list. */
function status() {
  return { worker: null };
}

export default {
  name: "native-windows",
  /** No worker: this process's clients open the Store themselves. */
  endpoint: () => null,
  status,
  async start() {
    throw refuse("Unsupported", "the Windows-native Store route runs Store calls in this process; it has no worker to start");
  },
  async restart() {
    throw refuse("Unsupported", "the Windows-native Store route runs Store calls in this process; it has no worker to restart");
  },
  async close() {},
  /** Init runs in this process, so nothing starts here. */
  async init() {},
  path: (settings, hostPath) => hostPath,
  async docker() {
    throw refuse("Unsupported", "the Windows-native Store route uses no Docker engine");
  },
  /** The project's volume is a Windows directory under the LayerFS home. */
  storePath: (settings, volume) => `${volume}/global/store.sqlite`,
  /** A project is its home entry, read from the Windows home itself. */
  async homeNames(settings) {
    try {
      return readdirSync(settings.home)
        .filter((name) => {
          try {
            return statSync(join(settings.home, name, "project.record")).isFile();
          } catch {
            return false;
          }
        })
        .sort();
    } catch {
      return [];
    }
  },
  /** Removing a project removes its home entry; its volume is a directory the caller names. */
  async removeHome(settings, name) {
    if (!/^[a-z0-9][a-z0-9_.-]{0,61}[a-z0-9]$|^[a-z0-9]$/.test(name)) {
      throw refuse("InvalidInput", "a project name is a home entry name");
    }
    const { rmSync } = await import("node:fs");
    rmSync(join(settings.home, name), { recursive: true, force: true });
  },
  /** No cached Store lives outside this process's clients, so nothing is released first. */
  async releaseStore() {},
  /** No Sandbox disk: the route reports only the host's free space (status.js reads it). */
  async free() {
    return null;
  },
};
