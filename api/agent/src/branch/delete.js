// branch.delete: one positional SDK operation. `force` deletes a Branch whose
// Commits main does not reach; its Commits and objects stay (#352 F-058).
export function deleteBranch(client, ref, force = false) {
  return client.call("branch.delete", { branch: ref, force: force === true });
}
