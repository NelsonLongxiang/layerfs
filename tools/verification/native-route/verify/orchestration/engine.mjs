// Explicit pinned candidate only. Never replaces a global CLI or selects its default home.
// node .../engine.mjs --engine <export-root> --home <isolated-home> -- verify ...
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

try {
  const args = process.argv.slice(2);
  if (args.length < 6 || args[0] !== "--engine" || args[2] !== "--home" || args[4] !== "--") {
    throw new Error("usage: engine.mjs --engine <export-root> --home <isolated-home> -- <CLI arguments>");
  }
  const root = resolve(args[1]), home = resolve(args[3]), command = args.slice(5);
  if (!args[1] || !args[3]) throw new Error("engine and home must be explicit");
  if (command.some(value => value === "--home" || value.startsWith("--home="))) throw new Error("choose the isolated home before --, not in forwarded arguments");
  const pin = JSON.parse(readFileSync(new URL("../../engine-pin.json", import.meta.url), "utf8"));
  for (const [file, expected] of Object.entries(pin.files)) {
    const actual = createHash("sha256").update(readFileSync(join(root, file))).digest("hex");
    if (actual !== expected) throw new Error("pinned engine hash mismatch: " + file);
  }
  const env = { ...process.env, YGL_HOME: home, YGL_SESSION: "layerfs-native-pinned-engine", YGL_NO_UPDATE_CHECK: "1" };
  for (const key of ["YGL_DB_URL", "YGL_PG_URL", "YGL_DB", "YGL_PROJECT", "YGL_TREE", "YGL_TEST", "NODE_OPTIONS"]) delete env[key];
  const result = spawnSync(process.execPath, [join(root, "dist/bundle/bin.cjs"), ...command], {
    env, stdio: "inherit", timeout: 110_000,
  });
  if (result.error) throw result.error;
  if (result.signal || result.status === null) throw new Error("pinned CLI did not exit normally");
  process.exitCode = result.status;
} catch (error) {
  console.error("native-route engine: " + error.message);
  process.exitCode = 1;
}
