// Regression for route-native.mjs's result reporting. No real Store or host.
// node api/agent/test/route-native-report.mjs (each child has a 30-second ceiling).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./route-native.mjs", import.meta.url));
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(?:LAYERFS_|DSH_LAYERFS_|ROUTE_NATIVE_|CLI_FAKE_)/.test(key)) delete env[key];
}
const run = (extra) => {
  const result = spawnSync(process.execPath, [script], {
    env: { ...env, ...extra }, encoding: "utf8", timeout: 30_000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
};

// This suite does no worker call: its SDK and host selections both skip.
const skipped = run({ LAYERFS_WORKER_ENDPOINT: "not-opened-by-this-suite" });
assert.equal(skipped.status, 0, skipped.stderr);
assert.match(skipped.stdout, /0 PASS, 0 FAIL, 2 SKIP/);
assert.doesNotMatch(skipped.stdout, /ALL PASS/);
console.log("PASS route-native-report/all-skipped-is-not-pass");

if (process.platform === "win32") {
  // The existing test binding accepts every fs.write, including main. The
  // named refusal check must fail even though no exception is thrown.
  const permissive = run({
    LAYERFS_NATIVE: fileURLToPath(new URL("./fixture/fake-native.cjs", import.meta.url)),
  });
  assert.equal(permissive.status, 1, permissive.stderr);
  assert.match(permissive.stdout, /^FAIL +main refuses direct writes$/m);
  assert.doesNotMatch(permissive.stdout, /^PASS +main refuses direct writes$/m);
  assert.match(permissive.stdout, /1 SKIP/);
  console.log("PASS route-native-report/permissive-main-write-is-fail");
} else {
  console.log("SKIP route-native-report/permissive-main-write: Windows-native selection only");
}
