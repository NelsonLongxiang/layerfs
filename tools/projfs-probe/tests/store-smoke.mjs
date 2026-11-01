// Real Store -> ProjFS -> ordinary process. Test roots and receipts are retained.
// node tools/projfs-probe/tests/store-smoke.mjs <exe> <fresh-output-directory>
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
assert.ok(process.argv[2] && process.argv[3], "name executable and fresh output directory");
const exe = resolve(process.argv[2]), out = resolve(process.argv[3]);
assert.ok(!existsSync(out), "never overwrite a proof");
mkdirSync(out);
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const binary = sha(exe);
const records = [];
function run(name, args, expected) {
  const env = { ...process.env };
  delete env.LAYERFS_PROJFS_PROBE_CHILD_ROOT;
  const started = new Date().toISOString();
  const r = spawnSync(exe, args, { env, encoding: "utf8", timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });
  const record = { name, exe, binary_sha256: binary, args, started, finished: new Date().toISOString(),
    exit: r.status, signal: r.signal, error: r.error?.message ?? null, stdout: r.stdout, stderr: r.stderr };
  records.push(record);
  writeFileSync(join(out, name + ".json"), JSON.stringify(record, null, 2));
  assert.ifError(r.error); assert.equal(r.signal, null); assert.equal(r.status, expected, r.stdout + r.stderr);
  return record;
}
run("direct-child-refuses", ["store-child", out], 1);
run("relative-refuses", ["store-live", "relative-store-projection"], 1);
const occupied = join(out, "occupied"); mkdirSync(occupied);
const sentinel = join(occupied, "keep.txt"); writeFileSync(sentinel, "unchanged\n");
const original = sha(sentinel);
const occupiedResult = run("existing-refuses", ["store-live", occupied], 1);
assert.match(occupiedResult.stderr, /refusing existing root/);
assert.equal(sha(sentinel), original);
assert.equal(existsSync(join(occupied, "store.sqlite")), false);
const root = join(out, "case");
const live = run("store-live", ["store-live", root], 0);
for (const pattern of [
  /STORE_CREATED entries=88 /,
  /PROJECTION_READY no_directory_scan=true no_file_ranges=true/,
  /PIN_STABLE pinned=ObjectId\("[0-9a-f]+"\) current=ObjectId\("[0-9a-f]+"\)/,
  /STORE_CHILD_PASS .*directory_entries=80 binary_ranges=4 pinned_old_bytes=true/,
  /projected_mutations_refused=true local_create_not_writeback=true/,
  /READ_ONLY_SCOPE .*local_new_files_allowed=true writeback=false/,
  /STORE_PROJECTION_PASS .*untouched_file_read=false source_folder_absent=true/,
  /CALLBACK_COUNTS reads=[1-9][0-9]* panics=0 overflow=0/,
  /NOT_RUN overlay_capture commit_writeback sandbox_isolation open_mapping_lifecycle/,
]) assert.match(live.stdout, pattern);
const roots = /PIN_STABLE pinned=ObjectId\("([0-9a-f]+)"\) current=ObjectId\("([0-9a-f]+)"\)/.exec(live.stdout);
assert.notEqual(roots[1], roots[2]);
assert.equal(existsSync(join(root, "input")), false);
assert.equal(existsSync(join(root, "projection/never.bin")), false, "untouched 2 MiB file not materialized");
assert.equal(readFileSync(join(root, "projection/local-only.txt"), "utf8"), "local NTFS file, not a Store Commit\n");
assert.equal(sha(exe), binary);
writeFileSync(join(out, "result.json"), JSON.stringify({ status: "PASS", cases: records.length,
  binary_sha256: binary, scope: "fixed root read-only Store source, not read-only NTFS sandbox",
  workspace_qualified: false, overlay_capture: "NOT_RUN", commit_writeback: "NOT_RUN", live }, null, 2));
console.log("PASS Store projection: 4 CLI cases, pinned root + paged directory + binary windows + unused file unmaterialized; NOT_RUN capture/Commit");
