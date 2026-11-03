# 原生路由能力矩阵（2026-11-03）

> **Status:** Dated inventory for the Windows-native route. It lists only what has been verified; it is not a new capability claim.

范围：Windows 原生（Store 面 + 受限 resident 实例 + SDK 注册路由 + 直接 `runtime.native` API）。容器/WSL worker 路径不在本表。

## Store 面（不经过实例路由）

| 面 | 状态 | 依据 |
| --- | --- | --- |
| `fs.*`、`branch.*`、`project.*`、`operator.*` | 已服务：Windows 原生 Store 在调用方进程内直接打开 | [Windows-native Store 路由](DIRECT_STORE.md)；[真实消费者](../../../../api/runtime/test/verify/registered_native_real.mjs)（`fs.read`、`branch.list_commits`、`main` 读取） |

## 直接 `runtime.native` API

| 面 | 状态 | 依据 |
| --- | --- | --- |
| `open`（未注册 Session，显式 catalog/cursor/branch） | 已服务；main/坏 catalog/未注册 project 在创建前拒绝 | [registered_native_real.mjs](../../../../api/runtime/test/verify/registered_native_real.mjs) |
| `create`、`instance.status/mount/close/workspace(path)` | 已服务；挂载与容量、两入口互换、retained 保管均有真实消费者 | [native_real.mjs](../../../../api/runtime/test/verify/native_real.mjs)、[容量](WINDOWS-NATIVE-CAPACITY-2026-11-03.md)、[互换](WINDOWS-NATIVE-INTERCHANGE-2026-11-03.md)、[retained](WINDOWS-NATIVE-RETAINED-INSTANCE-2026-11-03.md) |
| `list` / `instances` | 已服务（观测，不返回 handle） | 同上 |

## SDK 注册路由（`bindClient` 之后）

| 面 | 状态 | 依据 |
| --- | --- | --- |
| `sandbox.create` | **拒绝** `Unsupported`：注册消费已运行的实例，不做镜像创建 | [native_client_real.mjs](../../../../api/runtime/test/verify/native_client_real.mjs) |
| `project.list_sandboxes` | 已服务：返回该实例一条记录（含 Workspace 数），计数随挂载变化，实例关闭后为空 | [native_client_real.mjs](../../../../api/runtime/test/verify/native_client_real.mjs)（第 33、46、69 行） |
| `sandbox.list_workspaces` | 已服务：列出实例名下全部挂载（含直接挂载），retained admission 时 `Unknown` | [混合容量](WINDOWS-NATIVE-MIXED-CAPACITY-2026-11-03.md)、[两 client](WINDOWS-NATIVE-TWO-CLIENTS-2026-11-03.md) |
| `workspace.mount` | 已服务；缺失 Branch / `main` / 空或非字符串名在创建 target 前拒绝 | [缺失 Branch](WINDOWS-NATIVE-MISSING-BRANCH-2026-11-03.md)、[main/坏名](WINDOWS-NATIVE-MISSING-BRANCH-2026-11-03.md) |
| `workspace.status` | 已服务；`branchHead` 由调用方自身 Store 观察，不可读为 null | [status head](WINDOWS-NATIVE-STATUS-HEAD-2026-11-03.md) |
| `workspace.commit` | 已服务（message 保真、显式 force 走原 Store merge/overwrite） | [Commit message](WINDOWS-NATIVE-COMMIT-MESSAGE-2026-11-03.md)、[force](WINDOWS-NATIVE-COMMIT-FORCE-2026-11-03.md) |
| `workspace.unmount` | 已服务（正常卸载）；`force` **拒绝** `Unsupported` | [Close 语义](../../../../api/runtime/test/verify/native_close_real.mjs) |
| `workspace.exec` | 已服务：显式 `windows-native` 命令对象；Bash 字符串 **拒绝** `Unsupported` | [native_sdk_exec_real.mjs](../../../../api/runtime/test/verify/native_sdk_exec_real.mjs) |

## 后端 daemon 读模型

| 面 | 状态 | 依据 |
| --- | --- | --- |
| `daemon.workspace.status` | 已服务 | [互换](WINDOWS-NATIVE-INTERCHANGE-2026-11-03.md) |
| `daemon.workspace.get_storage` | **拒绝** `Unsupported`：数字只在受限 target 独占的 overlay 里，原协议无 storage 动词 | [存储拒绝](WINDOWS-NATIVE-STORAGE-REFUSAL-2026-11-03.md) |
| `daemon.workspace.list_changes` | **拒绝** `Unsupported`：需要 overlay 扫描，理由同上 | [client.js](../../../../api/runtime/src/platform/native-windows/client.js) |
| `daemon.process.start/list/cancel` | **拒绝** `Unsupported`：原生不监督后台进程 | 同上 |
| `daemon.sandbox.get_log` | **拒绝** `Unsupported`：无 daemon 容器日志 | 同上 |

## 未取得资格（不要写成已服务）

- 多进程注册、跨用户；强制卸载；Bash/OCI；全映射/内核排空；崩溃恢复（产品明确不重启，retained 即终态）；发现/安装/发行。
- 16 挂载只在容量与一次并发提交下取得资格；持续压力、更高并发、跨进程写者未测。

## 相关记录

[容量](WINDOWS-NATIVE-CAPACITY-2026-11-03.md)、[压力](WINDOWS-NATIVE-PRESSURE-2026-11-03.md)、[混合容量](WINDOWS-NATIVE-MIXED-CAPACITY-2026-11-03.md)、[两 client](WINDOWS-NATIVE-TWO-CLIENTS-2026-11-03.md)、[互换](WINDOWS-NATIVE-INTERCHANGE-2026-11-03.md)、[retained](WINDOWS-NATIVE-RETAINED-INSTANCE-2026-11-03.md)、[缺失 Branch](WINDOWS-NATIVE-MISSING-BRANCH-2026-11-03.md)、[存储拒绝](WINDOWS-NATIVE-STORAGE-REFUSAL-2026-11-03.md)。
