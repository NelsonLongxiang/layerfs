// layerfs branch delete: branch.delete(branch, force?); its Commits and objects stay.
export default {
  args: ["branch"],
  options: { force: "bool" },
  summary: "delete a Branch (its Commits and objects stay); unmerged Branches need --force",
  run: (lf, a) => lf.branch.delete(a.branch, a.force === true),
};
