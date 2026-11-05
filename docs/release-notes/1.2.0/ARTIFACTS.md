# LayerFS 1.2.0 — 发布产物清单

> 状态：清单与哈希已钉定；**产物重建待做**（见文末清单）。
> 构建 profile：**dev** —— 三个脚本都按仓库惯例以 dev profile 产出并在回执中记录
> `profile: 'dev'`（`build-native-windows.ps1` 里 `cargo build` 无 `--release`）；
> 资格记录（qualification）依据的正是这些产物。
> 本文件是 1.2.0 的"可复核交付面"：每个产物给出构成、构建命令与 sha256。

## 产物

| # | 产物 | 构成 | 构建入口 | sha256（当前已验证构建） |
|---|---|---|---|---|
| 1 | `layerfs-native.exe` | 原生 Store 路由主二进制 | `tools/build-native-windows.ps1` | `3e58f1c4bc3115f1b50a38b2b04fa14d4ee6bae35038470a355c7cbc63f93a34` |
| 2 | `layerfs-winfsp.exe` | WinFsp 宿主（挂载面） | 与 #1 同一脚本 `tools/build-native-windows.ps1`（它同时产出二者） | `6a01e415fa4b26c04d32f15c4965f1ee7160c06dc1a13d322951a711be121426` |
| 3 | `layerfs-restricted.exe` | 受限启动器（Exec 面） | `tools/build-restricted-windows.ps1` | `51afc4867d5a03c625f20554e977f72847ddc91c77c96b89a430e8e33030d48e` |
| 4 | `layerfs.node` | Node 绑定（`layerfs_node.dll` 改名） | `cargo +1.85.1 build -p layerfs-node` | 见下（由 release 构建产出后补齐） |
| 5 | `dsh-layerfs` 插件 bundle | 插件宿主 + 客户端 bundle | `pnpm run build`（dsh-layerfs 仓库） | 由 `tools/build-client.mjs` 产出 `lib/client.js` |

**构建身份**：Rust 1.85.1（`rust-version = "1.85"`），Windows x64；WinFsp 依赖
`C:\Program Files (x86)\WinFsp\bin\winfsp-x64.dll`（WinFsp 安装自带）。

## 安装与升级

1. 安装 **WinFsp**（提供 `winfsp-x64.dll`）
2. 放置三个可执行文件与 `layerfs.node`，登记 `nativeWorkspace` 部署字段
   （`executable` / `host` / `winfsp` / `restrictedLauncher` / `workRoot`）
3. 把 `bin/layerfs.cmd`（shim）加入 PATH，令 `layerfs <family> <call>` 可用
4. 从 1.1.0 升级不需要数据迁移：Store 文件、Project 记录与 Commit 格式不变

## 发布门

`.github/workflows/windows-native-gate.yml` 是 1.2.0 的**发布门**：
手工触发或打 tag 时运行 Windows 原生套件（五个 crate + SDK face），任一红色即失败。
与 `ci.yml` 的 report-only 快车道不同，这条门**阻断发布**（不阻断日常推送）。

## 重建位置

C++ 产物需要 MSVC **与 Windows SDK**；本机有 MSVC 14.40 但未安装 Windows SDK，
因此重建放在 CI：`windows-native-gate.yml` 的 `build-artifacts` job 在 windows-latest 上
解析 MSVC/SDK 路径 → 跑两个 ps1 → 构建 Node 绑定 → 产出 `artifact-sha256.txt` 并上传 30 天。

## 待办（发布前）

- [ ] 触发 `windows-native-gate`（Dispatch 或打 tag），用 CI 产物的哈希替换上表
- [ ] 生成 `layerfs.node` 与插件 bundle 的 sha256
- [ ] 在 Windows 上手工跑一次 `windows-native-gate` 并留存 run 链接
- [ ] 打 `v1.2.0` tag（发布门的 tag 触发路径）
