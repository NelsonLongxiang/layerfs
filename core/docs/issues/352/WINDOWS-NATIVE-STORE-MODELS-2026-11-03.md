# 原生 Store 的读模型：revisions／文件存储／提交存储（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`@layerfs/backend` 的 `backend.store.*` 是 Store 的只读面；此前只覆盖过 `project.get_storage` 与 `get_history`。本轮补 `fs.list_revisions`、`fs.get_storage`、`branch.list_commit_storage`：[native_store_models_real.mjs](../../../../api/runtime/test/verify/native_store_models_real.mjs)。

通过原生 Windows Store（`LayerFSBackend.of(shop)`）：

1. `feature` 上 `/a.txt` 依次写 `v1`、edit 成 `v2`、再写 `v3`（三个提交）。
2. `store.fs.list_revisions('feature','/a.txt')` → **3 条**，最新一条就是 head。
3. `store.fs.get_storage('feature','/a.txt')` → 含 `size` 的存储数字。
4. `store.branch.list_commit_storage('feature')` → **≥3 行**，最新一行是 head。

[结果](../../../../tmp/native-store-models-20261103/actual-first/result.json) 读取 2026-11-03T08:21:10.879Z，[命令](../../../../tmp/native-store-models-20261103/actual-first-command.json)。本轮一次通过，无消费者返工。

## 限制

只覆盖三个读模型的成功路径与「最新= head」；分页边界、`list_overwritten`（需要 publish 产生的 Layer）、`get_comparable` 未覆盖。生产 LOC 不变。

first parent 0b384c564d3392ba6619affd6ff4057aa15a05e4；本记录只增文档/测试。
