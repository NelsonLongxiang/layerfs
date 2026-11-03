# 实例关闭与挂载的关系（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`NativeInstance#close` 的语义此前只有两个点被间接覆盖（还有挂载时 `MountsActive`、retained 时 `Unknown`），缺一条显式断言：**全部卸载后实例仍能正常关闭**，以及**二次关闭**的行为。本轮用真实消费者补齐：[native_close_mounts_real.mjs](../../../../api/runtime/test/verify/native_close_mounts_real.mjs)。

流程与断言：

1. 挂 2 个 Workspace 后，直接 `instance.close()` 拒绝 **`MountsActive`**；SDK 的 `sandbox.close()` 同样拒绝 **`MountsActive`**。
2. 两个 Workspace 正常卸载，`sessions` 归 0。
3. `instance.close()` 成功：`processExit 0`、`tokenClosed true`、`desktopClosed true`。
4. **二次** `instance.close()` 返回**同一个冻结终态**（deep equal，`#close` 的 closed 分支直接返回 `#closed`）。
5. 实例关闭后 SDK 的 `sandbox.close()` 拒绝 **`NoSuchSandbox`**——SDK 不会对已关闭的实例再演一次关闭。
6. `runtime.native.instances()` 中该实例为 `closed`；`runtime.close()` 正常结束。

[结果](../../../../tmp/native-close-mounts-20261103/actual-second/result.json) 读取 2026-11-03T02:36:34.880Z，[命令](../../../../tmp/native-close-mounts-20261103/actual-second-command.json)。

首跑消费者把 `runtime.native.instances()` 当同步调用（它是 Promise）；此前的产品断言已全部通过，只改消费者并保留 FAIL 原件。

未取得资格：并发 close、关闭期间仍有命令流、retained 实例的 close（已由 retained 记录覆盖 `Unknown`）。生产 LOC 不变。

first parent 1e59085a2b0bca22ca6fa12c3b660bc22309bfda；本记录只增文档/测试。
