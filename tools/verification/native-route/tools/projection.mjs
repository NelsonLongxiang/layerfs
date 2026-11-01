// Import retained diagnostic evidence into a NEW verifier snapshot; no product calls.
// node projection.mjs <base.sqlite> <store-smoke-output> <probe-source-commit> <fresh-output>
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export const names = ["direct-child-refuses", "relative-refuses", "existing-refuses", "store-live"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sha = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
export function facts(result, records) {
  assert.equal(result.status, "PASS", "complete harness result required");
  assert.equal(result.cases, 4);
  assert.equal(records.length, 4);
  assert.ok(sha(result.binary_sha256), "binary identity required");
  for (const [i, record] of records.entries()) {
    assert.equal(record.name, names[i], "exact case order required");
    assert.equal(record.binary_sha256, result.binary_sha256, "mixed binaries");
    assert.equal(record.exit, i === 3 ? 0 : 1, "exact expected exit required");
    assert.equal(record.signal, null); assert.equal(record.error, null);
    assert.ok(typeof record.stdout === "string" && typeof record.stderr === "string");
    assert.ok(Array.isArray(record.args) && record.args.length === 2 && record.exe);
    const start = Date.parse(record.started), end = Date.parse(record.finished);
    assert.ok(Number.isFinite(start) && Number.isFinite(end) && end >= start, "valid receipt times");
    assert.ok(end - start <= 90_000, "probe child deadline");
  }
  const live = records[3];
  assert.deepEqual(live, result.live, "result/live raw receipt disagreement");
  assert.equal(live.args[0], "store-live");
  assert.match(records[2].stderr, /refusing existing root/);
  const lines = live.stdout.split(/\r?\n/);
  const one = prefix => {
    const matched = lines.filter(line => line.startsWith(prefix + " "));
    assert.equal(matched.length, 1, "missing/duplicate marker: " + prefix);
    return matched[0];
  };
  const value = (line, key, pattern) => {
    const matches = [...line.matchAll(new RegExp("(?:^|[ ,])" + key + "(?:=|: )(" + pattern + ")(?=[ ,]|$)", "g"))];
    assert.equal(matches.length, 1, "missing/duplicate field: " + key);
    return matches[0][1];
  };
  const num = (line, key) => { const n = Number(value(line, key, "[0-9]+")); assert.ok(Number.isSafeInteger(n)); return n; };
  const bit = (line, key) => Number(value(line, key, "true|false") === "true");
  const root = (line, key) => {
    const m = new RegExp(key + '=ObjectId\\("([0-9a-f]{64})"\\)').exec(line);
    assert.ok(m, "root required: " + key); return m[1];
  };
  const created = one("STORE_CREATED"), pin = one("STORE_PIN"), ready = one("PROJECTION_READY");
  const stable = one("PIN_STABLE"), child = one("STORE_CHILD_PASS"), counts = one("STORE_COUNTS");
  const callbacks = one("CALLBACK_COUNTS"), scope = one("READ_ONLY_SCOPE"), proof = one("STORE_PROJECTION_PASS");
  const notRun = one("NOT_RUN");
  assert.equal(root(created, "root"), root(pin, "root"));
  assert.equal(root(stable, "pinned"), root(pin, "root"));
  assert.ok(lines.indexOf(pin) < lines.indexOf(ready) && lines.indexOf(ready) < lines.indexOf(stable)
    && lines.indexOf(stable) < lines.indexOf(child), "pin before branch advance before child reads");
  assert.equal(typeof result.workspace_qualified, "boolean");
  assert.equal(typeof result.overlay_capture, "string"); assert.equal(typeof result.commit_writeback, "string");
  return {
    id: 1, cases: records.length, binary_sha256: result.binary_sha256, started: live.started, ended: live.finished,
    store_entries: num(created, "entries"), pinned_root: root(stable, "pinned"), current_root: root(stable, "current"),
    startup_directories: num(pin, "directory_reads"), startup_ranges: num(pin, "range_reads"),
    startup_emitted: num(pin, "emitted"), startup_payload_reads: num(pin, "payload_reads"),
    startup_pack_bytes: num(pin, "pack_read_bytes"), no_directory_scan: bit(ready, "no_directory_scan"),
    no_file_ranges: bit(ready, "no_file_ranges"), pinned_old_bytes: bit(child, "pinned_old_bytes"),
    root_entries: num(child, "root"), directory_entries: num(child, "directory_entries"),
    binary_ranges: num(child, "binary_ranges"), nested: bit(child, "nested"), unicode: bit(child, "unicode"),
    empty_file: bit(child, "empty"), binary_exact: bit(proof, "binary_exact"),
    callback_reads: num(callbacks, "reads"), panics: num(callbacks, "panics"), overflow: num(callbacks, "overflow"),
    untouched_bytes: num(proof, "untouched_file_bytes"), untouched_read: bit(proof, "untouched_file_read"),
    source_folder_absent: bit(proof, "source_folder_absent"), emitted_bytes: num(counts, "emitted"),
    store_reader: bit(scope, "store_reader"), projected_mutations_refused: bit(scope, "projected_existing_mutations_refused"),
    local_files_allowed: bit(scope, "local_new_files_allowed"), local_not_writeback: bit(child, "local_create_not_writeback"),
    writeback: bit(scope, "writeback"), pack_write_bytes: num(counts, "pack_write_bytes"),
    workspace_qualified: Number(result.workspace_qualified), overlay_capture: result.overlay_capture,
    commit_writeback: result.commit_writeback,
    unimplemented_explicit: Number(notRun === "NOT_RUN overlay_capture commit_writeback sandbox_isolation open_mapping_lifecycle"),
  };
}

export function audit(db) {
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  const artifacts = db.prepare("SELECT * FROM projection_artifacts ORDER BY name").all();
  assert.deepEqual(artifacts.map(a=>a.name), ["result", ...names].sort());
  for (const a of artifacts) assert.equal(hash(a.body), a.sha256, "raw artifact hash: " + a.name);
  const byName = new Map(artifacts.map(a=>[a.name,a]));
  const parsed = facts(JSON.parse(byName.get("result").body), names.map(n=>JSON.parse(byName.get(n).body)));
  const rows = db.prepare("SELECT * FROM projection").all(); assert.equal(rows.length,1);
  for(const [key,value] of Object.entries(parsed)) assert.equal(rows[0][key],value,"derived fact drift: " + key);
  assert.equal(rows[0].result_sha256,byName.get("result").sha256);
  assert.equal(rows[0].live_sha256,byName.get("store-live").sha256);
  return artifacts.length;
}
function main() {
  if (process.argv[2] === "--audit") {
    assert.equal(process.argv.length,4,"--audit <closed-snapshot>");
    const db = new DatabaseSync(resolve(process.argv[3]), { readOnly:true });
    try { console.log("PASS projection snapshot audit: " + audit(db) + " raw hashes and all derived fields"); }
    finally { db.close(); }
    return;
  }
  assert.equal(process.argv.length, 6, "supply base snapshot, proof directory, source commit, fresh output");
  const [source, proofDir, commitArg, out] = process.argv.slice(2).map((v,i) => i === 2 ? v : resolve(v));
  assert.ok(!existsSync(out), "never overwrite evidence");
  assert.ok(!existsSync(source + "-wal"), "closed baseline required");
  const repo = fileURLToPath(new URL("../../../../", import.meta.url));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: repo, timeout: 10_000 });
    assert.equal(r.status, 0, String(r.stderr)); return r.stdout;
  };
  assert.match(commitArg, /^[0-9a-f]{40}$/, "explicit full source commit required");
  const sourceTree = git("rev-parse", commitArg + "^{tree}").toString().trim();
  const probeTree = git("rev-parse", commitArg + ":tools/projfs-probe").toString().trim();
  const harnessSha = hash(git("show", commitArg + ":tools/projfs-probe/tests/store-smoke.mjs"));
  assert.equal(harnessSha, hash(readFileSync(join(repo, "tools/projfs-probe/tests/store-smoke.mjs"))), "inspect changed proof harness before importing");
  const artifacts = ["result", ...names].map(name => {
    const bytes = readFileSync(join(proofDir, name + ".json"));
    return { name, sha256: hash(bytes), body: bytes.toString("utf8") };
  });
  const parsed = artifacts.map(a => JSON.parse(a.body));
  const row = facts(parsed[0], parsed.slice(1));
  const sourceSha = hash(readFileSync(source));
  const src = new DatabaseSync(source, { readOnly: true });
  let baseIdentity;
  try {
    assert.equal(src.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    baseIdentity = src.prepare("SELECT * FROM identity WHERE id=1").get();
    assert.ok(baseIdentity, "baseline identity required");
    assert.equal(src.prepare("SELECT count(*) AS n FROM receipts WHERE group_name='workspace-proof' AND status='NOT_RUN'").get().n, 3, "read-only evidence never qualifies Workspace");
  } finally { src.close(); }
  Object.assign(row, { source_commit: commitArg, source_tree: sourceTree, probe_tree: probeTree,
    source_attribution: "declared source; binary hash identifies receipts, not an attestation",
    base_snapshot_sha256: sourceSha, harness_sha256: harnessSha, artifact_count: artifacts.length,
    result_sha256: artifacts[0].sha256, live_sha256: artifacts[4].sha256 });
  mkdirSync(out); copyFileSync(source, join(out, "snapshot.sqlite"));
  const db = new DatabaseSync(join(out, "snapshot.sqlite"));
  try {
    db.exec("CREATE TABLE projection (" + Object.entries(row).map(([key,v]) => key + (key === "id" ? " INTEGER PRIMARY KEY" : typeof v === "number" ? " INTEGER" : " TEXT")).join(",") + "); CREATE TABLE projection_artifacts(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,body TEXT NOT NULL)");
    db.prepare("INSERT INTO projection VALUES (" + Object.keys(row).map(() => "?").join(",") + ")").run(...Object.values(row));
    const insert = db.prepare("INSERT INTO projection_artifacts VALUES (?,?,?)");
    for (const a of artifacts) insert.run(a.name, a.sha256, a.body);
    audit(db);
  } finally { db.close(); }
  assert.equal(hash(readFileSync(source)), sourceSha, "baseline unchanged");
  const manifest = { imported_at: new Date().toISOString(), baseline: {path:source,sha256:sourceSha,identity:baseIdentity},
    projection: row, artifacts: artifacts.map(({name,sha256})=>({name,sha256})),
    snapshot_sha256: hash(readFileSync(join(out,"snapshot.sqlite"))),
    scope: "retained evidence import; no product/probe rerun; no Workspace qualification" };
  writeFileSync(join(out,"import.json"), JSON.stringify(manifest,null,2));
  console.log("PASS retained projection import; 5 raw artifacts, baseline unchanged, Workspace NOT_RUN preserved");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
