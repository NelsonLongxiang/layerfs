# 不存在的 Branch 在创建目标前拒绝（2026-11-03）

> **Status:** Dated implementation and scoped functional record.

## 缺口

通过原生 SDK 挂载一个不存在的 Branch 时，路由把请求直接交给原实例：原 target 启动后绑定失败（`NativeBindFailure { phase: Branch, cause: MissingBranch }`），会话进入 retained 保管，SDK 只看到 `Unknown`（`native reply stream ended without a complete original terminal acknowledgement`），并且该实例已被占用一个 owner 槽位——一个拼写错误就会让实例在关闭前不可再用。

[修正前原件](../../../../tmp/native-missing-branch-20261103/actual-before/result.json)：`code: 'Unknown'`。

## 实现

[原生路由](../../../../api/runtime/src/platform/native-windows/client.js)在 `workspace.mount` 里先用调用方自己的 Store 绑定查一次该 Branch（`branch.list_commits(branch, 1, 0)`）：只有确定的 `NoSuchBranch` 会被转成同样的拒绝，且发生在任何原 target 创建之前；其它 Store 结果一律不翻译，仍由原 Session 自己校验绑定。没有新增连接、没有改 `NativeSessions`／容量／挂载实现。

[运行时契约](../../../../api/docs/runtime.md#bind-an-existing-sdk-client-to-a-running-native-instance)同步说明：缺失 Branch 在创建目标前拒绝，不消耗 owner、不留下 retained。

## 实证

[消费者](../../../../api/runtime/test/verify/native_missing_branch_real.mjs)：Init 后 fork feature，创建原 resident 并绑定；挂载 `missing-branch` 得到 `NoSuchBranch`，`instance.status().sessions` 仍为 0；随后挂载 `feature` 成功（sessions 1）、正常卸载、实例 checked close exit0。

[修正后结果](../../../../tmp/native-missing-branch-20261103/actual-after/result.json)、[命令](../../../../tmp/native-missing-branch-20261103/after-command.json)。回归：伪绑定 scope 与 two-clients 场景通过。

## 限制

只覆盖“Branch 不存在”这一确定的 before-effect 拒绝。其它绑定失败（catalog／cursor／Store 不可读等）仍走原 Session 的 retained 保管与 `Unknown`，没有被翻译成猜测的错误码。生产 LOC 见提交信息。
