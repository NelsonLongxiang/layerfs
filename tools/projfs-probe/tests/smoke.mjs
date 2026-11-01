// Bounded positive/negative CLI proof. It creates only its own fixture root.
// node tools/projfs-probe/tests/smoke.mjs <exe> <new-output-directory>
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const exe = resolve(process.argv[2] || "");
const out = resolve(process.argv[3] || "");
assert.ok(process.argv[2] && process.argv[3], "supply executable and fresh output directory");
assert.ok(!existsSync(out), "never overwrite evidence");
mkdirSync(out);
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const binaryHash = hash(exe);
let sequence = 0;
function run(name, args, expected = 0) {
  const started = new Date().toISOString();
  const env = { ...process.env };
  delete env.LAYERFS_PROJFS_PROBE_CHILD_ROOT;
  const result = spawnSync(exe, args, { env, encoding: "utf8", timeout: 45_000, maxBuffer: 1 << 20 });
  const record = { name, started, finished: new Date().toISOString(), exe, binary_sha256: binaryHash,
    args, exit: result.status, signal: result.signal, error: result.error?.message ?? null,
    stdout: result.stdout || "", stderr: result.stderr || "" };
  writeFileSync(join(out, String(++sequence).padStart(2, "0") + "-" + name + ".json"), JSON.stringify(record, null, 2));
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, expected, record.stdout + record.stderr);
  return record;
}
run("usage", [], 1);
run("child-refusal", ["child", out], 1);
assert.equal(existsSync(join(out, "projected.txt")), false);
const loaded = run("api-load", ["check"]);
assert.match(loaded.stdout, /API_LOAD_OK live_mount_verified=false/);
run("relative-refusal", ["live", "relative-projfs-root"], 1);
const occupied = join(out, "occupied");
mkdirSync(occupied);
const sentinel = join(occupied, "keep.txt");
writeFileSync(sentinel, "must not change\n");
const keep = hash(sentinel);
const refusal = run("existing-root-refusal", ["live", occupied], 1);
assert.match(refusal.stderr, /refusing existing root/);
assert.equal(hash(sentinel), keep);
const live = run("live", ["live", join(out, "projection")]);
assert.match(live.stdout, /CHILD_PASS enumerate hydrate unaligned-read append rename create delete/);
assert.match(live.stdout, /LIVE_PROJECTION_PASS/);
assert.match(live.stdout, /FILE_STATE renamed.txt Ok\(8\)/);
assert.match(live.stdout, /panics=0 overflow=0/);
assert.match(live.stdout, /NOT_RUN overlay_capture commit sandbox_isolation open_mapping_lifecycle/);
assert.equal(hash(exe), binaryHash, "binary identity changed during proof");
writeFileSync(join(out, "result.json"), JSON.stringify({ status: "PASS", cases: sequence, binary_sha256: binaryHash,
  scope: "ProjFS single-file projection only", workspace_qualified: false, overlay_capture: "NOT_RUN", commit: "NOT_RUN", live }, null, 2));
console.log("PASS probe CLI " + sequence + " cases; live projection, 0 callback panics; NOT_RUN Workspace capture/Commit");
