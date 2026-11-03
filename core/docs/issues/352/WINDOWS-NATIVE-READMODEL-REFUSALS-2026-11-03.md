# 每个被拒绝的 daemon 读模型各自说明原因（2026-11-03）

> **Status:** Dated implementation and scoped functional record.

上一片只把 `workspace.get_storage` 的拒绝做成了点名原因；其余读模型仍共用一句泛化的 `Unsupported`。本轮补齐：[原生路由](../../../../api/runtime/src/platform/native-windows/client.js)在 `#backend` 里按操作给出四种不同理由：

- `workspace.get_storage`：overlay 独占 + 原协议无 storage 动词；
- `workspace.list_changes`：需要 overlay 扫描 + 原协议无 changes 动词；
- `process.start/list/cancel`：原生不监督后台进程，改用 `workspace.exec` 的显式 windows-native 命令并自持生命周期；
- `sandbox.get_log`：没有 daemon 容器，也就没有 daemon 日志。

`workspace.status` 与 `sandbox.list_workspaces` 仍照常服务。[运行时契约](../../../../api/docs/runtime.md#bind-an-existing-sdk-client-to-a-running-native-instance)同步。

## 实证

[消费者](../../../../api/runtime/test/verify/native_readmodel_refusals_real.mjs)：真实受限 SDK 挂载后，对同一 Workspace 依次调用上述六个方法，全部 `Unsupported`，**四种不同理由**（存储、变更、进程族、沙箱日志），且消息各自命中关键字；随后 `daemon.workspace.status` 仍返回 `branch: feature`、`activity: Idle`，正常卸载与关闭。

[结果](../../../../tmp/native-readmodel-20261103/actual-second/result.json)、[命令](../../../../tmp/native-readmodel-20261103/actual-second-command.json)。首跑断言把“每个方法一条独立消息”写死，实际进程三方法共用一族理由（设计如此）；只改消费者，原件保留 FAIL。

## 限制

只覆盖拒绝的可解释性；实现这些读模型仍需要原协议新增动词或 overlay 改为可并发读。生产 LOC 见提交信息。
