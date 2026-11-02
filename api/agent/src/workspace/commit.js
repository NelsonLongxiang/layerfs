// workspace.commit: one Commit of the Workspace's changes.
import { invokeClient, workspaceArgs, checkedMessage } from "../client.js";
import { LayerFSError } from "../errors.js";
export function commit(client, ws, message, force = false) {
  if (typeof force !== "boolean") throw new LayerFSError("InvalidInput", "force must be boolean", null);
  return invokeClient(client, "workspace.commit", { ...workspaceArgs(ws), message: checkedMessage(message), force });
}
