# 原生路由能力矩阵（2026-11-03）

> **Status:** Dated inventory for the Windows-native route. It lists only what has been verified; it is not a new capability claim.

范围：Windows 原生（Store 面 + 受限 resident 实例 + SDK 注册路由 + 直接 `runtime.native` API）。容器/WSL worker 路径不在本表。

## Store 面（不经过实例路由）

Windows 原生 Store 在调用方进程内直接打开；下列每一行都有真实消费者。

| 面 | 状态 | 依据 |
| --- | --- | --- |
| `project.start_init/get_init/list` | 已服务：Init 在原生 Store 上完成 | [store ops](WINDOWS-NATIVE-STORE-OPS-2026-11-03.md) |
| `fs.read`（含行窗口） | 已服务；窗口闭区间、越界空文本、反向拒绝 | [read window](WINDOWS-NATIVE-READ-WINDOW-2026-11-03.md) |
| `fs.write` | 已服务；字节精确、mode 生效 | [store ops](WINDOWS-NATIVE-STORE-OPS-2026-11-03.md)、[chmod/cp](WINDOWS-NATIVE-CHMOD-CP-2026-11-03.md) |
| `fs.edit` | 已服务；恰好一处才改，空操作返回 `UpToDate` | [edit diff](WINDOWS-NATIVE-EDIT-DIFF-2026-11-03.md)、[noop](WINDOWS-NATIVE-NOOP-EDIT-2026-11-03.md)、[match](WINDOWS-NATIVE-EDIT-MATCH-2026-11-03.md) |
| `fs.apply` | 已服务；整批一个提交，失败整批不提交 | [apply diff](WINDOWS-NATIVE-APPLY-DIFF-2026-11-03.md)、[apply ops](WINDOWS-NATIVE-APPLY-OPS-2026-11-03.md)、[atomic](WINDOWS-NATIVE-APPLY-ATOMIC-2026-11-03.md) |
| `fs.chmod/cp/rm/mv/mkdir` | 已服务（chmod 越界 `InvalidInput`；cp 保留模式） | [chmod/cp](WINDOWS-NATIVE-CHMOD-CP-2026-11-03.md)、[apply ops](WINDOWS-NATIVE-APPLY-OPS-2026-11-03.md) |
| `fs.stat/list` | 已服务 | [store ops](WINDOWS-NATIVE-STORE-OPS-2026-11-03.md) |
| `fs.glob/grep`（分页） | 已服务；`pageSize/pagePos` 覆盖全部条目 | [glob/grep paging](WINDOWS-NATIVE-GLOB-GREP-PAGING-2026-11-03.md) |
| `fs.diff_files/blame/body` | 已服务（二进制体、行级归因） | [terminal reads](WINDOWS-NATIVE-TERMINAL-READS-2026-11-03.md)、[binary](WINDOWS-NATIVE-BINARY-2026-11-03.md) |
| `branch.fork/merge` | 已服务；merge 冲突不产生对象 | [branch merge](WINDOWS-NATIVE-BRANCH-MERGE-2026-11-03.md) |
| `branch.publish` | 已服务；只接受当前 head，旧提交拒绝 `HeadMoved` | [publish](WINDOWS-NATIVE-PUBLISH-2026-11-03.md) |
| `branch.list_commits/diff_commits/diff_branches` | 已服务；分页与 cursor 续页 | [diff paging](WINDOWS-NATIVE-DIFF-PAGING-2026-11-03.md)、[cursor](WINDOWS-NATIVE-DIFF-CURSOR-2026-11-03.md) |
| `branch.delete` | 已服务：空 Branch 删；未发布默认 `Unmerged`、`force` 删；被已发布 Layer 引用的拒绝 `Published` | [删除记录](WINDOWS-NATIVE-BRANCH-DELETE-2026-11-03.md)、[设计](BRANCH-DELETE-DESIGN-2026-11-03.md) |
| `operator.*`、Store 模型/层模型 | 已服务（观测） | [store models](WINDOWS-NATIVE-STORE-MODELS-2026-11-03.md)、[layer models](WINDOWS-NATIVE-LAYER-MODELS-2026-11-03.md) |

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
| `project.list_sandboxes` | 已服务：返回该实例一条记录（含 Workspace 数），计数随挂载变化，实例关闭后为空 | [native_client_real.mjs](../../../../api/runtime/test/verify/native_client_real.mjs) |
| `sandbox.list_workspaces` | 已服务：字段与 `version:null` 已钉住；retained admission 时 `Unknown` | [list workspaces](WINDOWS-NATIVE-LIST-WORKSPACES-2026-11-03.md)、[混合容量](WINDOWS-NATIVE-MIXED-CAPACITY-2026-11-03.md) |
| `workspace.mount` | 已服务；缺失 Branch / `main` / 空或非字符串名在创建 target 前拒绝 | [缺失 Branch](WINDOWS-NATIVE-MISSING-BRANCH-2026-11-03.md) |
| `workspace.status` | 已服务；`branchHead` 由调用方自身 Store 观察，不可读为 null | [status head](WINDOWS-NATIVE-STATUS-HEAD-2026-11-03.md) |
| `workspace.commit` | 已服务（message 保真、显式 force 走原 Store merge/overwrite） | [Commit message](WINDOWS-NATIVE-COMMIT-MESSAGE-2026-11-03.md)、[force](WINDOWS-NATIVE-COMMIT-FORCE-2026-11-03.md) |
| `workspace.unmount` | 已服务（正常卸载）；`force` **拒绝** `Unsupported` | [forced unmount 决定](WINDOWS-NATIVE-FORCED-UNMOUNT-DECISION-2026-11-03.md) |
| `workspace.exec` | 已服务：显式 `windows-native` 命令对象；Bash 字符串 **拒绝** `Unsupported` | [native_sdk_exec_real.mjs](../../../../api/runtime/test/verify/native_sdk_exec_real.mjs) |

## 后端 daemon 读模型

| 面 | 状态 | 依据 |
| --- | --- | --- |
| `daemon.workspace.status` | 已服务 | [互换](WINDOWS-NATIVE-INTERCHANGE-2026-11-03.md) |
| `daemon.workspace.get_storage` | **拒绝** `Unsupported`：数字只在受限 target 独占的 overlay 里，原协议无 storage 动词 | [存储拒绝](WINDOWS-NATIVE-STORAGE-REFUSAL-2026-11-03.md) |
| `daemon.workspace.list_changes` | **拒绝** `Unsupported`：需要扫描受限 target 独占的 overlay，且原协议无 changes 动词；不猜 added/modified/removed | [readmodel 拒绝](WINDOWS-NATIVE-READMODEL-REFUSALS-2026-11-03.md) |
| `daemon.process.start/list/cancel` | **拒绝** `Unsupported`：原生不监督后台进程；改用 `workspace.exec` 的显式 windows-native 命令并自持生命周期 | 同上 |
| `daemon.sandbox.get_log` | **拒绝** `Unsupported`：没有 daemon 容器；诊断看原 Session 的 stderr 与 trace | 同上 |

## CLI 与插件

| 项 | 状态 | 依据 |
| --- | --- | --- |
| `layerfs` shim 多行参数 | 已修：`.ps1` 优先于 `.cmd`，参数按对象传递 | [分诊](WINDOWS-NATIVE-CLI-REPORT-TRIAGE-2026-11-03.md)（插件仓 `9be4724`） |
| shim 管道 stdin | 已修：管道对象按 CRLF 转发、输出回吐、退出码保留 | 同上（插件仓 `382a2ed`） |
| `branch delete` | **缺失**：设计提案待 owner | [设计](BRANCH-DELETE-DESIGN-2026-11-03.md) |
| `fs.write` 父目录 | 不自动创建，拒绝 `NoSuchPath`（设计如此，已记录） | [分诊](WINDOWS-NATIVE-CLI-REPORT-TRIAGE-2026-11-03.md) |

## 未取得资格（不要写成已服务）

- 多进程注册、跨用户；强制卸载；Bash/OCI；全映射/内核排空；崩溃恢复（产品明确不重启，retained 即终态）；发现/安装/发行。
- 16 挂载只在容量与一次并发提交下取得资格；持续压力、更高并发、跨进程写者未测。
- `workspace.status` 的 `pendingMerge=true`：瞬态/不确定安装状态，公开调用序列不可确定复现（[调查](WINDOWS-NATIVE-PENDING-MERGE-2026-11-03.md)）；`branch.delete`、`branch.merge units`、`fs.edit` 跨 32 KiB、符号链接、glob 预算截断、diff_branches cursor、blame fromLine 已取得真实消费者。

## 相关记录

[容量](WINDOWS-NATIVE-CAPACITY-2026-11-03.md)、[压力](WINDOWS-NATIVE-PRESSURE-2026-11-03.md)、[混合容量](WINDOWS-NATIVE-MIXED-CAPACITY-2026-11-03.md)、[两 client](WINDOWS-NATIVE-TWO-CLIENTS-2026-11-03.md)、[互换](WINDOWS-NATIVE-INTERCHANGE-2026-11-03.md)、[retained](WINDOWS-NATIVE-RETAINED-INSTANCE-2026-11-03.md)、[缺失 Branch](WINDOWS-NATIVE-MISSING-BRANCH-2026-11-03.md)、[存储拒绝](WINDOWS-NATIVE-STORAGE-REFUSAL-2026-11-03.md)、[readmodel 拒绝](WINDOWS-NATIVE-READMODEL-REFUSALS-2026-11-03.md)、[forced unmount 决定](WINDOWS-NATIVE-FORCED-UNMOUNT-DECISION-2026-11-03.md)、[close mounts](WINDOWS-NATIVE-CLOSE-MOUNTS-2026-11-03.md)、[terminal reads](WINDOWS-NATIVE-TERMINAL-READS-2026-11-03.md)、[store ops](WINDOWS-NATIVE-STORE-OPS-2026-11-03.md)、[edit diff](WINDOWS-NATIVE-EDIT-DIFF-2026-11-03.md)、[branch merge](WINDOWS-NATIVE-BRANCH-MERGE-2026-11-03.md)、[apply diff](WINDOWS-NATIVE-APPLY-DIFF-2026-11-03.md)、[publish](WINDOWS-NATIVE-PUBLISH-2026-11-03.md)、[binary](WINDOWS-NATIVE-BINARY-2026-11-03.md)、[diff paging](WINDOWS-NATIVE-DIFF-PAGING-2026-11-03.md)、[noop edit](WINDOWS-NATIVE-NOOP-EDIT-2026-11-03.md)、[store models](WINDOWS-NATIVE-STORE-MODELS-2026-11-03.md)、[layer models](WINDOWS-NATIVE-LAYER-MODELS-2026-11-03.md)、[diff cursor](WINDOWS-NATIVE-DIFF-CURSOR-2026-11-03.md)、[list workspaces](WINDOWS-NATIVE-LIST-WORKSPACES-2026-11-03.md)、[apply ops](WINDOWS-NATIVE-APPLY-OPS-2026-11-03.md)、[apply atomic](WINDOWS-NATIVE-APPLY-ATOMIC-2026-11-03.md)、[edit match](WINDOWS-NATIVE-EDIT-MATCH-2026-11-03.md)、[read window](WINDOWS-NATIVE-READ-WINDOW-2026-11-03.md)、[chmod/cp](WINDOWS-NATIVE-CHMOD-CP-2026-11-03.md)、[glob/grep paging](WINDOWS-NATIVE-GLOB-GREP-PAGING-2026-11-03.md)、[Commit message](WINDOWS-NATIVE-COMMIT-MESSAGE-2026-11-03.md)、[force](WINDOWS-NATIVE-COMMIT-FORCE-2026-11-03.md)、[status head](WINDOWS-NATIVE-STATUS-HEAD-2026-11-03.md)、[activity agree](WINDOWS-NATIVE-ACTIVITY-AGREE-2026-11-03.md)、[分诊](WINDOWS-NATIVE-CLI-REPORT-TRIAGE-2026-11-03.md)、[branch delete 设计](BRANCH-DELETE-DESIGN-2026-11-03.md)。