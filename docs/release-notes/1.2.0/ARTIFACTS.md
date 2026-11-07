# LayerFS 1.2.0 — 发布产物清单

> 状态：**哈希已钉定**（取自资格化构建，2026-11-05）。
> 构建 profile：**dev** —— 三个构建脚本按仓库惯例以 dev profile 产出，并在回执里记录
> `profile: 'dev'`（`build-native-windows.ps1` 里 `cargo build` 无 `--release`）；
> 资格记录（qualification）依据的正是这些产物。
> 本文件是 1.2.0 的"可复核交付面"：每个产物给出构成、构建命令与 sha256。

## 产物

| # | 产物 | 构成 | 构建入口 | sha256 |
|---|---|---|---|---|
| 1 | `layerfs-native.exe` | 原生 Store 路由主二进制 | `tools/build-native-windows.ps1` | `3e58f1c4bc3115f1b50a38b2b04fa14d4ee6bae35038470a355c7cbc63f93a34` |
| 2 | `layerfs-winfsp.exe` | WinFsp 宿主（挂载面） | 与 #1 同一脚本（它同时产出二者） | `6a01e415fa4b26c04d32f15c4965f1ee7160c06dc1a13d322951a711be121426` |
| 3 | `layerfs-restricted.exe` | 受限启动器（Exec 面） | `tools/build-restricted-windows.ps1` | `51afc4867d5a03c625f20554e977f72847ddc91c77c96b89a430e8e33030d48e` |
| 4 | `layerfs.node` | Node 绑定（`layerfs_node.dll` 改名） | `cargo build -p layerfs-node` | `4b36f02e5e708a6df1b1bd285694818d69954bf582c6a3433daeb267edf22b02` |
| 5 | `dsh-layerfs` 插件 bundle | 插件宿主 + 客户端 bundle | `node tools/build-client.mjs`（dsh-layerfs 仓库） | `lib/client.js` = `690c0b659dfc3127ec2f23fe58e9c59eaf6678e952fcffe83e1d9273f0334691` |

**构建身份**：Rust 1.85.1（`rust-version = "1.85"`），Windows x64；WinFsp 依赖
`C:\Program Files (x86)\WinFsp\bin\winfsp-x64.dll`（WinFsp 安装自带）。

## 安装与升级

1. 安装 **WinFsp**（提供 `winfsp-x64.dll`）
2. 放置三个可执行文件与 `layerfs.node`，登记 `nativeWorkspace` 部署字段
   （`executable` / `host` / `winfsp` / `restrictedLauncher` / `workRoot`）
3. 把 `bin/layerfs.cmd`（shim）加入 PATH，令 `layerfs <family> <call>` 可用
4. 从 1.1.0 升级不需要数据迁移：Store 文件、Project 记录与 Commit 格式不变

## 发布门：本地执行，不用 CI

`.github/workflows/windows-native-gate.yml` 写好了（五个 crate 套件 + SDK face +
产物构建），但**本 fork 的 GitHub Actions 处于禁用状态**：`gh workflow run` 返回
HTTP 422 *"Actions has been disabled for this repository"*，tag 与分支推送都不产生运行
（`GET /actions/permissions` 仍报 `enabled: true`，所以只看该字段会被误导）。

因此 1.2.0 的门禁**在本机执行**，回执见
[`WINDOWS-NATIVE-GATE-RUN-2026-11-05.md`](../../../core/docs/issues/352/WINDOWS-NATIVE-GATE-RUN-2026-11-05.md)：
**693 通过 / 0 失败**，147 个测试二进制，五个 crate 全绿。

工作流文件保留：一旦 fork 启用 Actions，它即成为可用的发布门，无需再改。

## 重建方式

C++ 产物需要 MSVC **与 Windows SDK**。本机有 MSVC 14.40 但**未安装 Windows SDK**，
所以现有产物取自资格化构建（上表哈希）；要重建需在装有 SDK 的机器上跑两个 ps1
（脚本拒绝写入已存在的输出目录，需用新目录），或启用 fork 的 Actions 后跑
`build-artifacts` job。

## 清单

- [x] 五个产物的 sha256 钉定
- [x] 发布门在本机执行并留存回执（693/0）
- [x] `v1.2.0` tag 指向发布提交
- [ ] 启用 fork Actions 后补一次 CI 复核（可选，不阻塞发布）
