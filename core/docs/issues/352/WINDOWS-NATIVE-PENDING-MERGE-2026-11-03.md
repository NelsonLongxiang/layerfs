# pendingMerge 的可达性调查（2026-11-03）

> **Status:** Dated investigation. No product change; the flag stays as implemented.

## 结论

`workspace.status` / `sandbox.list_workspaces` 的 `pendingMerge` 为 true，需要 **frontier 的 base_root 与绑定的 snapshot 的 effective_root 不一致**；成功的 Commit 会同时推进两者，所以公开调用序列下**不可确定复现**。它是**提交进行中/安装不确定**的瞬态，不是可以脚本化的稳定状态。

## 源码依据

- 原实例状态行：`pending_merge={}` = `status.frontier.base_root != *snapshot.effective_root.as_bytes()`（[receipt.rs:15](../../../../engine/crates/layerfs-daemon/src/native/receipt.rs)）。
- daemon 的 dirty 报告用另一个来源：`pending_merge: pending.is_some() || moved`，其中 `pending = workspace.pending_conflicts()`、`moved = state.base_root != binding.effective_root`（[dirty.rs:210](../../../../engine/crates/layerfs-daemon/src/control/dirty.rs)）。
- 两者都指向「安装未完成/冲突待处理」，而不是用户可见的常规状态。

## 探针（一次）

挂载 `feature`、写一个文件、`workspace.commit`：

- commit 前：`pendingMerge:false`、`headMovedSinceMount:false`、`changed:true`（有未提交改动）。
- commit：`kind:Committed`、`changed:true`、head 与 baseLayer 推进。
- commit 后：`pendingMerge:false`、`headMovedSinceMount:false`、`changed:false`。

即 Commit 成功后 base_root 与 effective_root 同步，flag 不会变 true。

## 处置

- 不把 `pendingMerge=true` 列为「未覆盖的真实面」；改为记录为**瞬态/不确定安装状态**，与 retained 失败保管同属一类。
- 若要真正钉住它，需要注入「Commit 安装未完成」的失败（崩溃/中断），这属于 retained/崩溃恢复面，已有记录覆盖其终态语义。

生产 LOC 不变；本记录只增文档。
