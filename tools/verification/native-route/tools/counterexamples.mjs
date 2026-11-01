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
const fixtures = [];
for (const [group, cases] of [["store", store], ["workspace", workspace]]) {
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
