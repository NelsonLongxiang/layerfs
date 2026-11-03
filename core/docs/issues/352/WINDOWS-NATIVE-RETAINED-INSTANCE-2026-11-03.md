# 意外驻留死亡后的实例保管（2026-11-03）

> **Status:** Dated functional record. Test and documentation only; no production source changed.

现有真实消费者只覆盖 exec 输出放弃导致的 **Session** retained（`runtime.close`/`instance.close` Unknown）。本轮补 **实例** retained：[native_retained_instance_real.mjs](../../../../api/runtime/test/verify/native_retained_instance_real.mjs)。

流程：Init 后 fork feature，创建原 resident 并挂载一个 Workspace；用 `taskkill /PID <resident> /F` 外部杀死 resident；在有界等待里轮询 `runtime.native.instances()` 直到 `state: "retained"`。随后：

- `instance.status()`、`instance.mount('feature')`、`instance.close()` 全部拒绝 **Unknown**；
- `runtime.close()` 同样拒绝 **Unknown**；
- 再次读取实例，`pid` 仍是原来的 resident——**没有重启、没有伪造成功**；
- 实例 retained 后，它名下挂载仍可显式卸载：`instance.workspace(path).unmount(true)` 返回 `nativeExit 0 / processExit 0 / overlayClosed true`——挂载保管与实例保管是两条独立的终态。

[结果](../../../../tmp/native-retained-20261103/actual-second/result.json) 读取 2026-11-03T00:35:48.861Z，[命令](../../../../tmp/native-retained-20261103/actual-second-command.json)。首跑在消费者里对 SDK 挂载值误调 `.handle()`（它是 `{sandbox,path}`，不是 Session），产品断言此前已全部通过；只改消费者并保留 FAIL 原件。

未取得资格：崩溃恢复/重启策略（本产品明确不重启）、多进程注册、强制卸载、Bash/OCI。生产 LOC 不变。

first parent 5a89bae9ec58669758deed44c56e9fa10d190975；本记录只增文档/测试。
