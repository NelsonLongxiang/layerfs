// Collect fresh facts for native-route specs; never pass a live project/home.
// node tools/verification/native-route/tools/collect.mjs <new-output-directory>
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const out = resolve(process.argv[2] || "");
assert.ok(process.argv[2], "supply a fresh output directory");
assert.equal(process.platform, "win32", "native-route collector runs on Windows");
assert.ok(!existsSync(out), "never overwrite receipts");
mkdirSync(out);
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(?:LAYERFS_|DSH_LAYERFS_|ROUTE_NATIVE_|CLI_FAKE_)/.test(key)) delete env[key];
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", timeout: 10_000 });
  assert.equal(r.status, 0, r.stderr || String(r.error));
  return r.stdout.trim();
};
const addon = join(repo, "engine/crates/layerfs-node/layerfs.node");
const identity = () => ({ commit: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}"),
  diff: git("status", "--porcelain", "--untracked-files=no"), addon: hash(readFileSync(addon)) });
const before = identity();
assert.equal(before.diff, "", "commit tracked inputs before collecting");
const db = new DatabaseSync(join(out, "snapshot.sqlite"));
db.exec("CREATE TABLE receipts(id TEXT PRIMARY KEY, group_name TEXT, platform TEXT, exit_code INTEGER, passes INTEGER, failures INTEGER, skips INTEGER, status TEXT, command TEXT, started TEXT, ended TEXT, stdout TEXT, stderr TEXT, source_commit TEXT, source_tree TEXT, addon_sha256 TEXT, receipt_sha256 TEXT); CREATE TABLE identity(id INTEGER PRIMARY KEY, before_commit TEXT, after_commit TEXT, before_tree TEXT, after_tree TEXT, before_diff TEXT, after_diff TEXT, before_addon TEXT, after_addon TEXT); CREATE TABLE preflight(id INTEGER PRIMARY KEY, status TEXT, library_present INTEGER, driver_present INTEGER, library_loaded INTEGER, live_mount_verified INTEGER, exit_code INTEGER);");
const insert = db.prepare("INSERT INTO receipts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
function run(id, group, platform, command, args, seconds = 30) {
  const started = new Date().toISOString();
  const r = spawnSync(command, args, { cwd: repo, env, encoding: "utf8", timeout: seconds * 1000, maxBuffer: 4 * 1024 * 1024 });
  const stdout = r.stdout || "", stderr = (r.stderr || "") + (r.error ? String(r.error) : "");
  const code = r.error || r.signal ? -1 : r.status;
  const count = (word) => (stdout.match(new RegExp("^" + word + "(?:\\s|$)", "gm")) || []).length;
  const passes = count("PASS"), failures = count("FAIL"), skips = count("SKIP");
  const status = code === 0 && !failures && passes ? "PASS" : code === 0 && !passes && skips ? "SKIP" : "OBSERVED";
  const record = { id, command: [command, ...args], started, ended: new Date().toISOString(), code, signal: r.signal,
    error: r.error?.message ?? null, stdout, stderr, passes, failures, skips, status, ...before };
  const bytes = JSON.stringify(record, null, 2);
  writeFileSync(join(out, id + ".json"), bytes);
  insert.run(id, group, platform, code, passes, failures, skips, status, JSON.stringify(record.command),
    started, record.ended, stdout, stderr, before.commit, before.tree, before.addon, hash(bytes));
  console.log(id + ": exit=" + code + ", " + passes + " PASS, " + failures + " FAIL, " + skips + " SKIP");
  return record;
}
try {
  const cases = ["surface", "projects", "state", "events", "leftovers", "sandboxes", "volumes", "transport-order", "init", "docker-default"];
  for (const name of cases) run("runtime-" + name, "runtime", "windows", process.execPath, ["api/runtime/test/runtime.mjs", name]);
  run("runtime-home-mode", "home-mode", "windows", process.execPath, ["api/runtime/test/runtime.mjs", "home-mode"]);
  run("route-report", "report", "windows", process.execPath, ["api/agent/test/route-native-report.mjs"], 65);
  run("route-sdk", "sdk", "windows", process.execPath, ["api/agent/test/route-native.mjs"], 95);
  const p = run("projfs", "preflight", "windows", "pwsh", ["-NoProfile", "-File", "tools/projfs-preflight.ps1"], 15);
  try {
    const v = JSON.parse(p.stdout);
    const bit = (value) => value === true ? 1 : value === false ? 0 : null;
    db.prepare("INSERT INTO preflight VALUES (1,?,?,?,?,?,?)").run(v.status, bit(v.libraryPresent), bit(v.driverPresent), bit(v.libraryLoaded), bit(v.liveMountVerified), p.code);
  } catch { /* no fabricated row: missing material must fail the count */ }

  // Read-only Linux oracle: archive the exact commit, never copy host dependencies.
  git("archive", "--format=tar", "--output=" + join(out, "api.tar"), before.commit, "api");
  const image = "sha256:c469fbffcbb0086ddfb92598192d3e09eab25f2d81b9750a00f77f0910fed744";
  const setup = "tar -xf /receipts/api.tar -C /proof; mkdir -p /proof/api/node_modules/@layerfs; ln -s ../../agent /proof/api/node_modules/@layerfs/agent; ln -s ../../backend /proof/api/node_modules/@layerfs/backend; ln -s ../../runtime /proof/api/node_modules/@layerfs/runtime; ";
  for (const name of ["home-mode", "init", "docker-default"]) {
    run("linux-" + name, "linux", "linux", "docker", ["run", "--rm", "--network", "none", "--read-only",
      "--mount", "type=bind,src=" + out.split("\\").join("/") + ",dst=/receipts,readonly",
      "--tmpfs", "/proof", "--tmpfs", "/tmp", "-w", "/proof", image,
      "sh", "-ec", setup + "timeout 30s node api/runtime/test/runtime.mjs " + name], 90);
  }
  for (const [id, group, reason] of [
    ["host-ui", "scope", "not exercised: no live host credentials or session creation"],
    ["workspace", "scope", "native Workspace is not implemented/qualified"],
    ["durable", "scope", "execution disabled by owner"],
    ["workspace-live", "workspace-proof", "no ordinary process live mounted proof"],
    ["workspace-commit", "workspace-proof", "no capture-to-Commit proof"],
    ["workspace-lifecycle", "workspace-proof", "no open-handle/mapping drain proof"],
  ]) {
    const now = new Date().toISOString();
    insert.run(id, group, "windows", null, 0, 0, 1, "NOT_RUN", "", now, now, reason, "", before.commit, before.tree, before.addon, "");
  }
  const after = identity();
  db.prepare("INSERT INTO identity VALUES (1,?,?,?,?,?,?,?,?)").run(before.commit, after.commit, before.tree, after.tree, before.diff, after.diff, before.addon, after.addon);
  writeFileSync(join(out, "identity.json"), JSON.stringify({ before, after, checkedAt: new Date().toISOString() }, null, 2));
  console.log("SNAPSHOT " + join(out, "snapshot.sqlite"));
} finally { db.close(); }
