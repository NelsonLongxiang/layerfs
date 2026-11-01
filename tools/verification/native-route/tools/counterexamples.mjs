// Synthetic spec counterexamples, not product/Workspace evidence.
// node tools/verification/native-route/tools/counterexamples.mjs <snapshot.sqlite> <new-output-dir>
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const source = resolve(process.argv[2] || "");
const output = resolve(process.argv[3] || "");
assert.ok(process.argv[2] && process.argv[3], "supply a closed snapshot and a new output directory");
assert.ok(!existsSync(output), "never overwrite counterexamples");
assert.ok(!existsSync(source + "-wal"), "use a closed, checkpointed snapshot");
const digest = () => createHash("sha256").update(readFileSync(source)).digest("hex");
const original = digest();
const src = new DatabaseSync(source, { readOnly: true });
assert.equal(src.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
src.close();
mkdirSync(output);
const store = {
  S1: "DELETE FROM receipts WHERE id='runtime-surface'",
  S2: "UPDATE receipts SET status='PASS', passes=1, skips=0 WHERE id='runtime-home-mode'",
  S3: "UPDATE receipts SET passes=6 WHERE id='route-sdk'",
  S4: "UPDATE receipts SET passes=1 WHERE id='route-report'",
  S5: "UPDATE receipts SET status='FAIL',passes=0,failures=1,exit_code=1 WHERE id='linux-init'",
  S6: "UPDATE identity SET after_tree='changed-tree'",
  S7: "UPDATE preflight SET live_mount_verified=1",
  S8: "UPDATE receipts SET status='PASS',passes=1,skips=0 WHERE id='host-ui'",
  S9: "UPDATE receipts SET receipt_sha256='' WHERE id='route-sdk'",
  empty: "DELETE FROM receipts; DELETE FROM identity; DELETE FROM preflight",
};
const workspace = {
  positive: "",
  W1: "DELETE FROM preflight",
  W2: "DELETE FROM receipts WHERE id='workspace-live'",
  W3: "DELETE FROM receipts WHERE id='workspace-commit'",
  W4: "DELETE FROM receipts WHERE id='workspace-lifecycle'",
};
const seed = "UPDATE preflight SET status='api-load-candidate',library_present=1,driver_present=1,library_loaded=1,exit_code=0; UPDATE receipts SET status='PASS',passes=1,failures=0,skips=0,exit_code=0,command='SYNTHETIC checker fixture - NOT an actual live proof',receipt_sha256='synthetic-fixture-only' WHERE group_name='workspace-proof';";
const projection = {
  positive: "",
  P1: "UPDATE projection SET live_sha256=''",
  P2: "UPDATE projection SET startup_ranges=1",
  P3: "UPDATE projection SET current_root=pinned_root",
  P4: "UPDATE projection SET binary_exact=0",
  P5: "UPDATE projection SET untouched_read=1",
  P6: "UPDATE projection SET writeback=1",
  P7: "UPDATE projection SET workspace_qualified=1",
  P8: "DELETE FROM projection_artifacts WHERE name='store-live'",
  empty: "DELETE FROM projection; DELETE FROM projection_artifacts",
};
const native = {
  positive: "",
  N1: "UPDATE native SET identity_checked=0",
  N2: "UPDATE native SET mutation_reopen_exact=0",
  N3: "UPDATE native SET remount_new_commits=1",
  N4: "UPDATE native SET scope_refusals=7",
  N5: "UPDATE native SET later_revision=capture_revision",
  N6: "UPDATE native SET close_ordered=0",
  N7: "UPDATE native SET workspace_qualified=1",
  N8: "DELETE FROM native_artifacts WHERE name='close'",
  N9: "UPDATE native SET rust_passes=14",
  empty: "DELETE FROM native; DELETE FROM native_artifacts",
};
const fixtures = [];
const groups = [["store", store], ["workspace", workspace]];
const probe = new DatabaseSync(source, { readOnly: true });
const hasProjection = !!probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projection'").get();
const hasNative = !!probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='native'").get();
probe.close();
if (hasNative) groups.push(["native", native]);
if (hasProjection) groups.push(["projection", projection]);
for (const [group, cases] of groups) {
  for (const [name, mutation] of Object.entries(cases)) {
    const file = join(output, group + "-" + name + ".sqlite");
    copyFileSync(source, file);
    const db = new DatabaseSync(file);
    try { if (group === "workspace") db.exec(seed); if (mutation) db.exec(mutation); }
    finally { db.close(); }
    fixtures.push({ group, name, file, synthetic: true, expected: name === "positive" ? "PASS" : "FAIL", mutation });
  }
}
assert.equal(digest(), original, "source snapshot unchanged");
writeFileSync(join(output, "manifest.json"), JSON.stringify({ source, source_sha256: original, fixtures }, null, 2));
console.log("Created " + fixtures.length + " SYNTHETIC fixtures; source hash unchanged: " + original);
