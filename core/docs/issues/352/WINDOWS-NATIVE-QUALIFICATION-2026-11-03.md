# 原生路由资格说明（2026-11-03）

> **Status:** Dated qualification statement for the Windows-native route. It states what was verified on one Windows host with the pinned binaries, what the product refuses by design, and what has no evidence yet. It is not a release, install or support claim.

## 范围

Windows 原生：Store 面在调用方进程内直接打开（无 daemon、无 WSL2），受限 resident 实例承载挂载/提交/卸载，SDK 注册路由消费已运行的实例。pinned 二进制与验证器基线见文末。

## 已取得资格

| 能力 | 证据 | 资格边界 |
| --- | --- | --- |
| `project.*`、`fs.*`、`branch.*`、`operator.*` 在原生 Store 上直接调用 | [矩阵](WINDOWS-NATIVE-SURFACE-2026-11-03.md) 逐调用表 + 各日期记录 | 单进程调用方；Disposable/WAL/OFF |
| 32 个原生 SDK 方法面 + 2 个 CLI/插件修复有真实消费者 | [消费者目录](../../../../api/runtime/test/verify) | 每片单样本；非压力测试 |
| 16 个 Workspace 挂载、容量拒绝可逆、一次并发提交 | [容量](WINDOWS-NATIVE-CAPACITY-2026-11-03.md)、[压力](WINDOWS-NATIVE-PRESSURE-2026-11-03.md) | 只在这个规模与一次并发下；更高并发/持续压力未测 |
| 两入口（直接 + SDK）共享同一份容量 | [混合容量](WINDOWS-NATIVE-MIXED-CAPACITY-2026-11-03.md) | 同上 |
| 一个原实例跨两个独立 client | [两 client](WINDOWS-NATIVE-TWO-CLIENTS-2026-11-03.md) | 两个 client，同进程 |
| 跨重启/进程存活的 Store 与分支 | [分诊复测](WINDOWS-NATIVE-CLI-REPORT-TRIAGE-2026-11-03.md)（22 分支存活） | 外部复测，单机 |
| retained 实例的失败保管与拒绝 | [retained](WINDOWS-NATIVE-RETAINED-INSTANCE-2026-11-03.md) | 失败后不重启是产品决定 |
| Windows 原生 CLI（`layerfs`）的读写/分支/合并/发布 | [分诊](WINDOWS-NATIVE-CLI-REPORT-TRIAGE-2026-11-03.md) | shim 已修两次；cmd.exe 调用者仍受 cmd 解析限制 |

## 明确拒绝（设计如此，不是缺陷）

| 调用 | 拒绝码 | 原因 |
| --- | --- | --- |
| `sandbox.create` | `Unsupported` | 原生注册消费已运行实例，不做镜像创建 |
| `workspace.exec` 的 Bash 字符串 | `Unsupported` | 无 daemon；用显式 windows-native 命令对象 |
| `workspace.unmount({force})` | `Unsupported` | 强制卸载未实现；正常 Busy 可逆 |
| `daemon.workspace.get_storage` / `list_changes` | `Unsupported` | 数字在受限 target 独占的 overlay；不猜 |
| `daemon.process.*` / `daemon.sandbox.get_log` | `Unsupported` | 原生不监督后台进程、无容器 |
| `project.list_sandboxes`（CLI 路径） | `Unsupported` | SDK 原生路由已服务；CLI 无 daemon 不走该面 |
| `fs.write` 到不存在的父目录 | `NoSuchPath` | 不自动创建父目录（设计如此，已记录） |

## 未取得资格（没有证据，不要写成可用）

- 多进程注册、跨用户、跨机器共享 Store。
- 持续压力、更高并发、跨进程写者、崩溃恢复（产品明确不重启，retained 即终态）。
- 发现/安装/发行；OCI/Bash；全映射/内核排空；named IPC。
- `branch.delete` 的**已发布分支**：schema 外键使其不可删（未发布分支可删/force 删，已发布一律 `Published`）；若要放开需要 schema 变更。
- `workspace.status` 的 `pendingMerge` 为 true 的路径：**瞬态/不确定安装状态**，公开调用序列下不可确定复现（见 [调查](WINDOWS-NATIVE-PENDING-MERGE-2026-11-03.md)），与 retained 失败保管同类。
- macOS/WSL worker 路由不在本页范围（各自独立契约）。

## 如何复核

- 验证器基线：`spec_16e9afcfa044` v1（13 条判据），正向 `run_c1f256ad7b731216` 13/13、负例 `run_3140f731146e6309` 11/2；归档 `sha256:0f42c526f7e4…`。
- 判据覆盖：HEAD/parent、生产 LOC 五档、counter SHA256、分支、34 份日期记录、30 份清单消费者、工作树干净、消费者总数 44（实测）。
- 每个能力行的证据是该行的日期记录；记录里有结果文件、命令与保留的 FAIL。

## 限制

单机（一台 Windows 主机）、单样本；资格边界写在每行；本页不改变任何产品代码，生产 LOC 不变。

first parent b7665ea4a4a21318c4aec4fb8adee00c46304559；本记录只增文档。