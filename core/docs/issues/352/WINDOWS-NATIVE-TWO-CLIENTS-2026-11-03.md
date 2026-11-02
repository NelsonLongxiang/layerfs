# 一个原实例上的两个独立 SDK client（2026-11-03）

> **Status:** Dated implementation and scoped functional record. One original native instance may be registered on several independent SDK clients. Not a multi-host, multi-process or cross-user claim; not kernel/mapping/crash/install qualification.

## 为什么现在做

注册表本来就把「一个原实例」与「多个 client」分开：`NativeInstances` 对同一 handle 复用一个 route，每个 client 各自 `bindClientControl`。但上一轮 status 的 head 观察在 route 上存了一个 `#client` 字段——第二次 `attach` 会覆盖它，于是 A 的 status 可能拿 B 的 Store 绑定读 head。两个 client 的 project/home/Store 必须相同（`#scope` 已校验），所以行为上通常等价，但「共享 route 记住最后一个 client」本身就是错的。

本轮把 client 从 route 字段改成随每次 control 绑定传入，并用真实双 client 场景把它钉住。

## 实现

- [原生路由](../../../../api/runtime/src/platform/native-windows/client.js)：删除 `#client`；`attach` 用 `bindClientControl(client, { call: (op, args) => this.#call(client, op, args), ... })`，`#call`/`#backend`/`#head` 接收调用方自己的 client。
- 不新增注册表、不改 `NativeSessions`/16 owner 计数、不改 Store 绑定与 transport；同一实例的挂载、容量与 pending/retained 仍只有一份。
- 关闭一个 client 只释放它自己的 Store 客户端；route 不再持有任何 client，其他注册与挂载不受影响。

## 实证

**路由级**（伪绑定，[native-client.mjs](../../../../api/runtime/test/native-client.mjs)）：同一实例先后注册两个 client，第二个注册共享同一 sandbox；关闭第一个后，第二个的 status 与 list_workspaces 仍正常，随后可卸载并关闭实例。

**真实受限 SDK**（[消费者](../../../../api/runtime/test/verify/native_two_clients_real.mjs)）：Init 后 fork feature，创建原 resident，两个独立 `LayerFS` client 分别绑定同一实例。[最终结果](../../../../tmp/native-two-clients-20261103/actual-second/result.json) 读取 2026-11-02T23:36:47.132Z，[命令](../../../../tmp/native-two-clients-20261103/actual-second-command.json)：

- 两个 client 各挂一个 Workspace，路径不同、workspace id 不同；`instance.status().sessions === 2`，`list_workspaces` 看到 2 个——容量与 owner 只有一份。
- 两个 client **并发** Commit：都返回 `Committed`，head 不同，History 恰好 2 条且两条都在，两侧文件都可读——经原 Store 的发布 lane 串行，无重放。
- 关闭 client A 后，B 的 status 与 list 仍看到 2 个挂载，B 继续写入并 Commit 成功。
- B 可以卸载 A 挂的 Workspace（owner 属于实例而非 client），两个 Workspace 正常卸载、实例 checked token/desktop close exit0；关闭后对原 handle 的 status 拒绝 `NoSuchSandbox`。

回归：scope／mixed／status-head 三个既有真实/伪绑定场景在本改动后仍通过（status-head 走的正是被改的 `#head` 路径）。

## 检查与精确 LOC

Node 语法、`git diff --check`、1017 文件边界扫描、37 项 guard 与 23 项 counter 自测通过；本轮未改 Rust/C++，未重复其构建。

first parent **7b6581323ac0a6a40f0429164f63f3131b8bddbd**；受测／计数树 **163ce9dc963f25b30161f4bb3e874328da2ab2e3**；本报告只增文档。

**Production LOC: 111925 -> 111923 (delta -2).** Core 38454、Engine 69729（daemon 9552、Fuse 6238）不变；API 3742→3740，runtime 2165→2163（-2），agent 900 不变。[比较](../../../../tmp/native-two-clients-20261103/loc-comparison.json)、[父树](../../../../tmp/native-two-clients-20261103/loc-parent.json)、[封版树](../../../../tmp/native-two-clients-20261103/loc-staged.json)。同一 production_loc.py --root archive --json，counter SHA256 8c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3；含产品 Rust/SQL/JS/C++/hpp，排除 tests/docs/tools。

## 保留的失败与未取得资格

首次真实运行在关闭实例之后又调用 `instance.status()`，按设计拒绝 `NoSuchSandbox`；这是消费者顺序错误，产品断言（两个挂载、并发 Commit、关闭隔离）此前已通过。修正只改消费者顺序，原件保留 FAIL，新输出独立目录。

未取得资格：多进程／多宿主注册、跨用户、16 个真实挂载满容量（容量本身由原 `NativeSessions` 单测覆盖，本轮只证明两个 client 共享同一计数）、强制卸载、Bash/OCI、全映射／内核排空、崩溃恢复、发现安装与发行。历史 Git/cwd/control/verifier FAIL 原件不改。主 task 3b7a154bc4 仍 doing。
