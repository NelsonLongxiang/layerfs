# Windows 原生能力清单 — 2026-11-05

> **Status:** Dated capability record for LayerFS 1.2.0. Basline `d6e8035f3`.
> 用途：回答"交付了什么、凭什么说它可用"，每项能力都指到测试与证据。

## 已验能力

| # | 能力 | 实现位置 | 测试（文件 / 用例数） | 证据文档 |
|---|---|---|---|---|
| S1 | Store：SQLite 原生、调用方进程内执行、跨进程 writer lane | `engine/crates/layerfs-persistence` | `windows_store_native.rs` 1 · `windows_lane_abandoned.rs` 1 · `verbatim_wide_windows.rs` 4 | `WINDOWS-NATIVE-{STORE,LIST,READ,GREP,GLOB,EDIT,DIFF,BLAME,APPLY,RM,CP,CHMOD,SYMLINK}-*` |
| S2 | 卷守卫（仅本地 NTFS、长路径）与 owner-only DACL | `layerfs-store-service` | `volume_guard_long_paths_windows.rs` 2 · `windows_acl_windows.rs` 2 | `WINDOWS-NATIVE-BINARY` / `-STORAGE` |
| P1 | 项目 Init/导入、WTF-8 名称往返、重解析点拒绝 | `layerfs-project` | `windows_project_windows.rs` 6 · `name_roundtrip_windows.rs` 5 · `name_bytes_windows.rs` | `WINDOWS-NATIVE-PROJECT-*` |
| O1 | Overlay：身份、分配、基本属性、删除 | `layerfs-overlay` | `allocation_windows.rs` 1 · `windows_attributes.rs` 1 · `overlay_backing_windows.rs` 2 | `WINDOWS-NATIVE-OVERLAY-*` |
| F1 | WinFsp 挂载：回调接纳、属主、关闭顺序、section 持有 | `layerfs-fuse/src/windows`（C++） | `windows_mount.cpp` · `windows_callbacks.cpp` · `windows_callback_admission.cpp` · `windows_section_holder.cpp` | `WINDOWS-MOUNT-OWNER-2026-11-02` · `WINDOWS-CALLBACK-ADAPTER-2026-11-02` |
| E1 | Exec：受限启动器、IPC 边界、cwd | `layerfs-sandbox` | `restricted_probe_windows.cpp` · `windows_ipc_probe.cpp` · `windows_cwd_probe.cpp` | `WINDOWS-NATIVE-IPC` / `-EXEC` |
| N1 | Node 绑定：准入与发现 | `layerfs-node` | `native_admission.rs` 2 · `native_discovery.rs` 6 | `WINDOWS-NATIVE-BINDING-*` |
| B1 | 分支/提交：publish、merge、diff、apply 原子性、容量 | `layerfs-store-service` + `persistence` | 见 S1 用例 + 容量用例 | `WINDOWS-NATIVE-{BRANCH-MERGE,BRANCH-DELETE,BRANCH-DIFF-CURSOR,COMMIT-FORCE,COMMIT-MESSAGE,CAPACITY,APPLY-ATOMIC,APPLY-OPS,APPLY-DIFF}-*` |
| I1 | dsh 插件集成（跨仓 `dsh-layerfs`） | `dsh-layerfs` | native-real / owner / routes / text / agent-real 五套 + 2026-11-04 GUI 全生命周期 | `dsh-layerfs/docs/native-*-20261104.md` |

**规模**：Rust 用例 **63**（五个 crate 的 cfg(windows) 套件）；C++ 探针 **7** 个文件；
证据文档 **78** 份 `WINDOWS-NATIVE-*`（另有 8 份 `WINDOWS-*` 架构/回调/挂载记录）。

## CI 覆盖

`.github/workflows/ci.yml` 的 `windows` job（windows-latest，45 分钟，report-only）覆盖
`layerfs-content / persistence / project / store-service` 等的 Windows 套件，每 crate 120 s 上限。

**未覆盖**：fuse 与 sandbox 的 C++ 探针、node 绑定、插件集成——这些只有本地与 3081 回执。
