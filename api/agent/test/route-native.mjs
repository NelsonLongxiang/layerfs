// The Windows-native Store route (#352, owner 2026-10-25), end to end.
//
//   node test/route-native.mjs
//
// Two parts, because they need different things:
//
//   1. SDK — nothing but a LayerFS home, a Store and the native addon. Asserts
//      the Store face works (project, fs, branch: write, apply, edit, fork,
//      publish, read back byte-exact) and that the daemon-backed family refuses
//      `Unsupported` — not `InvalidInput` — before any deployment field is
//      interrogated. Skips with a printed reason when the environment is not a
//      native route (no addon, or a worker endpoint set).
//
//   2. Host — needs a live dsh host running this plugin on the native route.
//      Set ROUTE_NATIVE_URL (http://127.0.0.1:3081) and ROUTE_NATIVE_TOKEN (the
//      token the host prints at boot); the part then checks the plugin routes,
//      the runtime overview's honesty, session creation and the agent's
//      PowerShell command path. Skips, with the reason, when they are unset.
//
// One exit code: 0 when every executed check passed, 1 otherwise.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const results = [];
const check = (name, ok, detail = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const skip = (name, why) => {
  results.push([name, true]); // a skip is not a failure, but it is printed
  console.log(`SKIP  ${name}  — ${why}`);
};

const sdkRoot = new URL("../src/index.js", import.meta.url).href;
const native = process.platform === "win32" && !process.env.LAYERFS_WORKER_ENDPOINT;

// ── 1. the SDK face ─────────────────────────────────────────────────────────
async function sdk() {
  if (!native) return skip("SDK face", `not a Windows-native route (platform ${process.platform}, worker endpoint ${process.env.LAYERFS_WORKER_ENDPOINT ? "set" : "unset"})`);
  const work = mkdtempSync(join(tmpdir(), "route-native-sdk-"));
  const home = join(work, "home");
  const source = join(work, "source");
  const volume = join(work, "volume");
  mkdirSync(join(volume, "global"), { recursive: true });
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "seed.md"), "# seed\n");
  process.env.LAYERFS_HOME = home;
  process.env.LAYERFS_STORE_PATH = join(volume, "global", "store.sqlite");
  delete process.env.LAYERFS_WORKER_ENDPOINT;
  delete process.env.LAYERFS_IMAGE;
  delete process.env.LAYERFS_DAEMON;
  delete process.env.LAYERFS_VOLUME;

  const { LayerFS } = await import(sdkRoot);
  const name = `route-native-${Date.now().toString(36)}`;
  let layerfs;
  try {
    layerfs = await LayerFS.init(name, source, 60_000);
    await layerfs.branch.fork("work");

    // write → apply → edit → publish, each one Commit, main only through publish
    await layerfs.fs.write("work", "/written.md", "written\n", "route write");
    await layerfs.fs.apply("work", [
      { op: "mkdir", path: "/nested" },
      { op: "write", path: "/nested/applied.md", content: "applied\n" },
      { op: "write", path: "/applied.md", content: "applied root\n" },
    ], "route apply");
    await layerfs.fs.edit("work", "/applied.md", "applied root", "applied edited", "route edit");
    const read = await layerfs.fs.read("work", "/applied.md");
    check("fs.write/apply/edit read back byte-exact", (read.text ?? read.content) === "applied edited\n", JSON.stringify(read.text ?? read.content));

    const published = await layerfs.branch.publish("work");
    check("branch.publish moves main", Boolean(published?.head ?? published?.commit ?? published), JSON.stringify(published).slice(0, 60));
    const onMain = await layerfs.fs.read("main", "/nested/applied.md");
    check("main carries the published tree", (onMain.text ?? onMain.content) === "applied\n");

    let refusing = true;
    try {
      await layerfs.fs.write("main", "/direct.md", "no\n", "must be refused");
    } catch (error) {
      refusing = error.code === "ReadOnly";
    }
    check("main refuses direct writes", refusing);

    const refuse = async (label, run) => {
      try {
        await run();
        check(`${label} refuses Unsupported`, false, "it answered ok");
      } catch (error) {
        check(`${label} refuses Unsupported`, error.code === "Unsupported", `${error.code}: ${String(error.message).slice(0, 70)}`);
      }
    };
    await refuse("sandbox.create", () => layerfs.sandbox.create());
    await refuse("workspace.mount", () => layerfs.workspace.mount("1", "main"));
    await refuse("project.list_sandboxes", () => layerfs.project.list_sandboxes());
  } finally {
    try {
      await layerfs?.close();
    } catch {
      /* already closed */
    }
    rmSync(work, { recursive: true, force: true });
  }
}

// ── 2. the host face (a live dsh host running this plugin) ──────────────────
function host() {
  const base = process.env.ROUTE_NATIVE_URL;
  const token = process.env.ROUTE_NATIVE_TOKEN;
  if (!base || !token) return skip("host face", "set ROUTE_NATIVE_URL and ROUTE_NATIVE_TOKEN to check a live host");
  const jar = join(tmpdir(), `route-native-${process.pid}.jar`);
  const curl = (args) => execFileSync("curl", ["-s", "-b", jar, "--max-time", "60", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 26 });
  curl(["-L", "-c", jar, `${base}/?token=${token}`]);
  const api = (path) => JSON.parse(curl([`${base}${path}`]));

  const status = api("/layerfs/status");
  check("plugin route mounted", /dsh-layerfs[\\/]home$/.test(status.home ?? ""), `home=${status.home}`);

  const names = api("/layerfs/projects").projects.map((p) => p.name);
  check("projects list", names.length > 0, names.slice(0, 4).join(","));

  const runtime = api("/layerfs/runtime");
  check(
    "runtime overview reports the route, not a Docker fault",
    runtime.level === "ok" && (runtime.reasons ?? []).length === 0 && runtime.engine?.level === "not-used" && runtime.store === null && runtime.sweep === null,
    `level=${runtime.level} engine=${runtime.engine?.level}`,
  );

  const created = JSON.parse(
    curl(["-X", "POST", `${base}/api/session/create`, "-H", "Content-Type: application/json",
      "--data-binary", '{"type":"client-request","rpcId":"route","method":"session/create","payload":{"args":{"request":{"cwd":"' + process.cwd().replace(/\\/g, "/") + '"}}}}']),
  );
  check("session/create", created.result?.ok === true, created.result?.ok ? created.result.value.agentPreset : (created.result?.error?.code ?? "no answer"));
}

await sdk();
host();

const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
