# 原生路由拒绝 Workspace 存储读模型（2026-11-03）

> **Status:** Dated implementation and scoped functional record.

`backend.daemon.workspace.get_storage` 在容器里返回 overlay 的 inode/entry/payload/metadataRows 与 changes 计数（[容器实现](../../../../engine/crates/layerfs-daemon/src/operator/workspace.rs) 的 `overlay`）。原生路由此前用一条通用 `Unsupported` 拒绝所有 daemon 读模型，没有说明为什么这一项无法诚实回答。

本轮把它单独拒绝并说明原因：[原生路由](../../../../api/runtime/src/platform/native-windows/client.js)在 `#backend` 里对 `backend.daemon.workspace.get_storage` 抛 `Unsupported`——这些数字只存在于受限 target 独占的 in-memory overlay 里，运行时若再开一个连接会被 EXCLUSIVE 锁挡下；原协议也没有 storage 动词。**不伪造 inode/payload/changes。**

[运行时契约](../../../../api/docs/runtime.md#bind-an-existing-sdk-client-to-a-running-native-instance)同步写明；`workspace.status` 与 `sandbox.list_workspaces` 仍照常服务。

## 实证

[消费者](../../../../api/runtime/test/verify/native_storage_refusal_real.mjs)：真实受限 SDK 挂载后，`get_storage` 拒绝 `Unsupported` 且消息点明 overlay；同一 Workspace 的 `daemon.workspace.status` 仍返回 `branch: feature`、`activity: Idle`，随后正常卸载与关闭。

[结果](../../../../tmp/native-storage-20261103/actual-first/result.json)、[命令](../../../../tmp/native-storage-20261103/actual-first-command.json)。

## 限制

只覆盖拒绝的诚实性，不代表未来不会实现——若原协议增加 storage 动词，或 overlay 改为可并发读的日志模式，可以再实现。生产 LOC 见提交信息。
