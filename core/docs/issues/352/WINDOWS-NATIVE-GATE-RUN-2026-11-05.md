# Windows 原生发布门：本地运行回执 — 2026-11-05

> **Status:** Dated run receipt. Executes the `windows-native-gate` workflow's
> `windows-native` job content on this host, because the fork's GitHub Actions
> are disabled (see "Where this ran").

## Where this ran

- Host: Windows 11, Rust 1.85.1 (`x86_64-pc-windows-msvc`), `cargo test` (no rustup shim)
- Tree: `release/windows-native-1.2.0` at `37e18d0a1` (tag `v1.2.0`)
- GitHub Actions on `NelsonLongxiang/layerfs` is **disabled** for this fork:
  `gh workflow run ...` returns HTTP 422 *"Actions has been disabled for this
  repository"*, and neither the `v1.2.0` tag push nor a branch push produced a
  run. `GET /actions/permissions` reports `enabled: true`, which is why the
  org-level value alone did not reveal it. The fix is one owner action:
  Settings → Actions → "Enable Actions" on the fork.

## Command

```bash
for crate in layerfs-content layerfs-persistence layerfs-project \
             layerfs-overlay layerfs-store-service; do
  cargo test --manifest-path Cargo.toml --locked --no-run -p "$crate"   # build first
  timeout 120 cargo test --manifest-path Cargo.toml --locked -p "$crate" # run, 120 s cap
done
```

Building first is required: compiling a test target alone can exceed the 120 s
run ceiling (observed twice as `exit code 143` before the pre-build step).

## Result

| Crate | Test binaries | Passed | Failed |
|---|---:|---:|---:|
| `layerfs-content` | 65 | 486 | 0 |
| `layerfs-persistence` | 40 | 91 | 0 |
| `layerfs-project` | 12 | 17 | 0 |
| `layerfs-overlay` | 20 | 81 | 0 |
| `layerfs-store-service` | 10 | 18 | 0 |
| **Total** | **147** | **693** | **0** |

Raw log: `tmp/gate-results.txt` in the work tree (locally excluded).

## Not covered by this receipt

`build-artifacts` (the second gate job): the C++ artifacts need MSVC **and the
Windows SDK**; this host has MSVC 14.40 but no Windows SDK. It runs on
`windows-latest` once the fork's Actions are enabled, then uploads
`windows-native-1.2.0` plus `artifact-sha256.txt`.
