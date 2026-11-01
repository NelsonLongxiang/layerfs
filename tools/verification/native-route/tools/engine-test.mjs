// Test the pinned CLI launcher: exact candidate accepted, tampered/missing inputs refused.
// node tools/verification/native-route/tools/engine-test.mjs <candidate-export-root>
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const runner = fileURLToPath(new URL("../verify/orchestration/engine.mjs", import.meta.url));
const candidate = resolve(process.argv[2] || "");
assert.ok(process.argv[2], "name the fixed engine export");
mkdirSync(join(root, "tmp"), { recursive: true });
const work = mkdtempSync(join(root, "tmp/engine-pin-test-"));
const run = (args) => {
  const r = spawnSync(process.execPath, [runner, ...args], { cwd: root, encoding: "utf8", timeout: 15_000 });
  assert.ifError(r.error); assert.equal(r.signal, null); return r;
};
try {
  const prefix = ["--engine", candidate, "--home", join(work, "home"), "--"];
  const exact = run([...prefix, "--version"]);
  assert.equal(exact.status, 0, exact.stdout + exact.stderr); assert.equal(exact.stdout.trim(), "0.118.0");
  console.log("PASS engine/exact-pinned-candidate");
  const missingHome = run(["--engine", candidate, "--", "--version"]);
  assert.equal(missingHome.status, 1); assert.match(missingHome.stderr, /usage:/);
  console.log("PASS engine/no-implicit-global-home");
  const override = run([...prefix, "db", "stats", "--home", join(work, "other")]);
  assert.equal(override.status, 1); assert.match(override.stderr, /before --/);
  const equalsOverride = run([...prefix, "db", "stats", "--home=" + join(work, "other")]);
  assert.equal(equalsOverride.status, 1); assert.match(equalsOverride.stderr, /before --/);
  console.log("PASS engine/no-forwarded-home-override");
  const copy = join(work, "tampered");
  const pin = JSON.parse(readFileSync(new URL("../engine-pin.json", import.meta.url), "utf8"));
  for (const file of Object.keys(pin.files)) { const target = join(copy, file); mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(candidate, file), target); }
  writeFileSync(join(copy, "dist/bundle/bin.cjs"), "throw new Error('must never execute');\n");
  const tampered = run(["--engine", copy, "--home", join(work, "home"), "--", "--version"]);
  assert.equal(tampered.status, 1); assert.match(tampered.stderr, /pinned engine hash mismatch: dist\/bundle\/bin.cjs/);
  assert.doesNotMatch(tampered.stderr, /must never execute/);
  console.log("PASS engine/tampered-bundle-refused-before-execution");
} finally {
  // mkdtemp created this test-owned exact subtree; never delete the candidate or real YGL_HOME.
  rmSync(work, { recursive: true, force: true });
}
