# 两个入口对同一原 Session 可互换（2026-11-03）

> **Status:** Dated implementation and scoped functional record.

## 缺口

SDK 路由的 `#mounted` 按 path 在 `instance.workspaces()` 里找会话，所以 SDK 本来就能对**直接 `instance.mount` 创建的挂载**做 status/commit/unmount。反方向不成立：直接入口只拿到自己 `mount()` 返回的 handle，没有任何公开方法能拿到**SDK 创建的挂载**的 handle——文档却写两个入口「resolve the same original Session owners」。

## 实现

[实例 handle](../../../../api/runtime/src/platform/native-windows/instance.js)新增 `workspace(path)`：在该实例拥有的会话里按 path 查找，找不到抛 `NotMounted`，找到返回同一个冻结 Session handle。没有新增注册表或第二份所有权；SDK 与直接入口仍指向同一个 `NativeSession`。

[运行时契约](../../../../api/docs/runtime.md#resident-native-execution-instances)同步列出 `status()、mount(branch)、close()、workspace(path)`。

## 实证

[消费者](../../../../api/runtime/test/verify/native_interchange_real.mjs)：direct 挂 1 个、SDK 挂 1 个；SDK 对直接挂载做 status（`activity: Idle`）与 Commit；直接 `workspace(path)` 拿到 SDK 挂载的 handle 并 Commit；History 两条、两文件按 Branch 读回正确；随后**交叉卸载**——SDK 卸载直接挂载、直接 handle 卸载 SDK 挂载——两个终端都 exit0/overlayClosed，实例 sessions 0、checked close exit0。

[结果](../../../../tmp/native-interchange-20261103/actual-second/result.json) 读取 2026-11-03T00:21:27.056Z，[命令](../../../../tmp/native-interchange-20261103/actual-second-command.json)。首跑在消费者里误用不存在的 `instance.workspaces()`，暴露的正是本缺口；产品断言此前已通过，只改消费者与新增 handle 方法。伪绑定 scope 与 two-clients 回归通过。

## 限制

只覆盖“同一实例内两个入口的 handle 等价”。跨实例、多进程注册、强制卸载、Bash/OCI、崩溃恢复仍未取得资格。生产 LOC 见提交信息。
