# 16 个挂载的并发提交压力（2026-11-03）

> **Status:** Dated functional record. Test and documentation only; no production source changed.

上一片钉住容量时明确未取得「16 个挂载同时承受写/提交压力」。本轮补上：[native_pressure_real.mjs](../../../../api/runtime/test/verify/native_pressure_real.mjs)。

真实受限 SDK：Init 后 fork feature，创建原 resident，两个独立 client 各绑同一实例，交替挂满 16 个 Workspace；每个挂载各写自己的 `f<n>.txt`，随后 **16 个 Commit 并发发起**。结果：全部 `Committed`、16 个互不相同的 head、History 恰好 16 条且消息集合与发起集合一致、每个文件按 Branch 读回内容正确。整段并发提交耗时 **311ms**。随后 16 个挂载全部正常卸载（native/parent exit0、overlayClosed），实例 checked token/desktop/close exit0，关闭后原 handle 拒绝 `NoSuchSandbox`。

[结果](../../../../tmp/native-pressure-20261103/actual-first/result.json) 读取 2026-11-02T23:59:49.665Z（2026-11-03 07:59:49 Asia/Shanghai），[命令](../../../../tmp/native-pressure-20261103/actual-first-command.json)。

这证明原 Store 的发布 lane 在 16 个并发提交下保持串行且不丢、不重放；它不证明更高并发、跨进程写者、崩溃恢复或长时间压力下的表现。

未取得资格：多进程注册、强制卸载、Bash/OCI、全映射/内核排空、崩溃恢复、发现安装与发行。生产 LOC 不变。

first parent 8df55d86519b9f73eace16cc6ca8d7985f57e261；本记录只增文档/测试。
