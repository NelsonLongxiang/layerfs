# 直接挂载与 SDK 挂载共用 16 个容量（2026-11-03）

> **Status:** Dated functional record. Test and documentation only; no production source changed.

`runtime.md` 写的是容量「across both SDK and direct entrypoints」，此前只有伪绑定场景覆盖混用。本轮用真实消费者补上：[native_mixed_capacity_real.mjs](../../../../api/runtime/test/verify/native_mixed_capacity_real.mjs)。

Init 后 fork feature，创建原 resident 并绑定一个 SDK client；随后 **直接 `instance.mount` 挂 8 个、SDK `workspace.mount` 挂 8 个**。结果：`instance.status().sessions === 16`；SDK 的 `list_workspaces` 列出全部 16 个，其中 8 个路径正是直接挂载的路径；第 17 个无论从 SDK 还是直接入口都被 `Capacity` 拒绝，实例仍为 16；直接入口与 SDK 各提交一次都成功，History 两条、两个文件都可读；16 个挂载全部正常卸载（native/parent exit0、overlayClosed），实例 checked token/desktop/exit0，之后原 handle 拒绝 `NoSuchSandbox`。

[结果](../../../../tmp/native-mixed-capacity-20261103/actual-second/result.json) 读取 2026-11-03T00:15:41.640Z，[命令](../../../../tmp/native-mixed-capacity-20261103/actual-second-command.json)。首跑在消费者里误把直接挂载的返回值当成 Session（它已经是冻结 handle），产品断言此前已通过；只改消费者，原件保留 FAIL。

未取得资格：多进程注册、强制卸载、Bash/OCI、崩溃恢复、发现安装与发行。生产 LOC 不变。

first parent ed3bfbe56dcb98917a2b482d5cd8cb2b1a645ad4；本记录只增文档/测试。
