# 原生实例的 16 个 Workspace 容量（2026-11-03）

> **Status:** Dated functional record for existing admission behaviour. No production source changed.

容量入口在 `NativeInstance` 的 attach：`#owned().length >= 16` 时拒绝 `Capacity`；`#owned` 按实例过滤 `NativeSessions`，而 Session 在 `start()` 之前就进表，所以 pending 也计数。计数属于实例，不属于 client。

本轮用真实消费者把它钉住：[native_capacity_real.mjs](../../../../api/runtime/test/verify/native_capacity_real.mjs)。Init 后 fork feature，创建原 resident，两个独立 client 各绑同一实例，交替挂满 16 个 Workspace（路径互不相同），第 17 个挂载拒绝 `Capacity`；拒绝后实例仍是 16、另一 client 的列表仍 16、已有挂载可读且 status 正常；卸载一个后计数 15，再挂一个回到 16；16 个挂载全部正常卸载（native/parent exit0、overlayClosed），实例 checked token/desktop/close exit0，之后原 handle 拒绝 `NoSuchSandbox`。

[结果](../../../../tmp/native-capacity-20261103/actual-first/result.json) 读取 2026-11-02T23:41:30.518Z（2026-11-03 07:41:30 Asia/Shanghai），[命令](../../../../tmp/native-capacity-20261103/actual-first-command.json)。伪绑定另有一条同口径场景（[native-client.mjs](../../../../api/runtime/test/native-client.mjs) 的 capacity），用于不依赖 WinFsp 的快速回归。

未取得资格：16 个挂载同时承受并发写压力、容量与 retained/pending 混合的端到端证明、多进程注册、强制卸载。生产 LOC 不变（本轮只改测试与文档）。

first parent ca716284f13f0020217bf433b8113423c24e5f40；本记录与文档只增文档/测试。
