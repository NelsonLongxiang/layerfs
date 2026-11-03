# status 与 list_workspaces 的 activity 一致性（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`workspace.status` 的 activity（`Idle`/`Busy`/`Closing`）与 `sandbox.list_workspaces` 归一化后的 activity（`idle`→Idle、`committing`→Busy、`closing`→Closing）应当描述同一个 Workspace。本轮用真实消费者把四个可稳定观察的点钉住：[native_activity_agree_real.mjs](../../../../api/runtime/test/verify/native_activity_agree_real.mjs)。

同一挂载上取四次（挂载后、写入未提交后、Commit 后、UpToDate 后），每次都断言：

- `status.activity === "Idle"` 且 `list` 条目归一化后同为 `Idle`；
- `workspace` id、`branch`、`headMovedSinceMount` 两边相等；
- `dirty.inodes`/`dirty.entries` 两边相等；写入后 inodes > 0，Commit 后 head 已追上（`headMovedSinceMount: false`）。

[结果](../../../../tmp/native-activity-20261103/actual-third/result.json) 读取 2026-11-03T01:50:48.379Z，[命令](../../../../tmp/native-activity-20261103/actual-third-command.json)。

未观察 `Busy`/`Closing` 的瞬时窗口：Commit 在本机太快，抓不到稳定中间态；不做时序猜测，只在可稳定观察的四个点断言一致性。

首跑两处消费者错误：SDK 的 list 条目字段是 `path`（不是 `directory`）；保存结果时 BigInt 不能直接 JSON 序列化。两次产品断言均已通过，只改消费者并保留 FAIL 原件。

未取得资格：Busy/Closing 瞬时一致性、并发 Commit 期间的 activity、跨进程观察。生产 LOC 不变。

first parent e073e505952fe9fc4b5bcb58cc6c208402021ba4；本记录只增文档/测试。
