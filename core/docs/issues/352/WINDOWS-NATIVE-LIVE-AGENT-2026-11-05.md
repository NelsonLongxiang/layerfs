# Windows 原生：活模型会话验证 — 2026-11-05

> **Status:** Dated functional verification. Closes boundary #1 of
> [`WINDOWS-NATIVE-BOUNDARIES-2026-11-05.md`](WINDOWS-NATIVE-BOUNDARIES-2026-11-05.md)
> at the CLI path; the GUI input path stays unverified.

## Setup

- Host: `dsh web` 0.2.2-rc.1 (`fcc0ad4`), profile `web`, home `D:/dsh-test-homes/3081`,
  port 3089, the plugin read from `D:/workspace/dsh-layerfs`
- Driver: `session/create` + `session/prompt` over the host's HTTP API
  (`POST /api/session/<method>`, the client's own request envelope), so the run is a
  live model session with the real tool scheduler — not a replayed script
- Session: `session-8b118855-4f63-41a1-a23d-e93d973803d6`, cwd `D:\workspace\obelisk`
  (bound to the home's `ygl-video-studio` project), preset `layerfs-dsh-minimalist`

## What ran

The model answered one prompt by issuing bash calls on its own. It produced 8 bash
calls in total; the two that matter:

1. `env | grep DSH_LAYERFS` — returned **16 variables**, including
   `DSH_LAYERFS_PROJECT`, `DSH_LAYERFS_CLI`, `DSH_LAYERFS_SDK`,
   `DSH_LAYERFS_RUNTIME`, `DSH_LAYERFS_NATIVE_WORKSPACE` (the native deployment
   JSON with executable/host/winfsp/restrictedLauncher/workRoot),
   `DSH_LAYERFS_STORE_PATH`, `DSH_LAYERFS_VOLUME`, `DSH_LAYERFS_TRACE*`
2. `node "D:\workspace\dsh-layerfs\packages\host\src\agent\cli.js" project list_branches`
   — returned real Store data: `{"items":[{"name":"main",...},{"name":"media-lww-rules",...}...]}`

Receipt: `tmp/live-agent-session-20261105.json` in the LayerFS work tree (locally excluded).

## Findings

1. **Folder matching is string-exact.** A session created with
   `cwd = D:/workspace/obelisk` received **no** `DSH_LAYERFS_*` variables; the same
   session with `D:\workspace\obelisk` received all of them. The plugin's
   `bindings.workspaces[folder]` lookup does not normalize separators, so a
   forward-slash path silently loses the project. Candidate fix: normalize the
   folder key, or fall back to a case-insensitive, separator-insensitive compare.
2. **Shell variable expansion differs on this host.** The model's
   `node "$DSH_LAYERFS_CLI" ...` became `node "" ...`; the environment's shell
   did not expand a POSIX-style `$VAR` for that command. Literal paths work.
   Documentation for agents should prefer the literal path or the shim
   (`layerfs` on PATH).

## Scope

Verified: live model → tool scheduler → bash → plugin-injected environment →
LayerFS CLI → native-route Store read.
Not verified: the GUI input path (the browser's Lexical composer in this
environment did not accept synthesized input from the automation engine).
