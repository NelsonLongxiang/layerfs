# 原生 list_workspaces 的字段与 head 观察（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`sandbox.list_workspaces` 在原生路由返回的页与条目形状此前只被容量测试间接用过；本轮钉住字段：[native_list_workspaces_real.mjs](../../../../api/runtime/test/verify/native_list_workspaces_real.mjs)。

通过原生 Windows 实例：

- 页级：**`version: null`**（原生没有 daemon 协议版本）。
- 条目：`path`（不是 `directory`）、`branch`、`base`、`activity: "Idle"`、`state: "idle"`、`changed: false`、`dirty: { inodes, entries }`（**BigInt**）、`headMovedSinceMount: false`、`pendingMerge: false`。
- **`base` 实测为 `null`**：即使挂载前已在 feature 上写过一次提交，它仍是 null——本消费者用 `commitScope: "published"` 绑定，`base` 反映的是已发布基线，未 publish 的 feature 提交不在其中。断言因此写成「null 或 64 位 hex」。
- 挂载后用 Store 面提交一次，再列：**`headMovedSinceMount: true`**——status 读的是调用方自身 Store 的 head。
- 显式卸载后该页回到 0 条；实例 `close` 后 `runtime.close()` 不再 `Busy`。

[结果](../../../../tmp/native-list-workspaces-20261103/actual-sixth/result.json) 读取 2026-11-03T09:51:40.077Z，[命令](../../../../tmp/native-list-workspaces-20261103/actual-sixth-command.json)。

四次消费者错误保留 FAIL：① 以为条目有 `mounted`/`directory`（SDK 映射成 `path`）；② 以为 `base` 一定是 64 位 hex（空 Branch 时为 null）；③ 直接 `JSON.stringify(dirty)` 撞上 BigInt；④ 忘了 `instance.close()`，`runtime.close()` 报 `Busy`。产品行为每次都对。

## 限制

只覆盖一个挂载与一次 head 移动；`pendingMerge` 为 true 的路径、`dirty` 非零、`changed: true` 未覆盖。生产 LOC 不变。

first parent 12337f8295a73a401e8aa807dc7f19c76996888b；本记录只增文档/测试。
