# 原生 Store 的 list_commits 分页（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`branch.list_commits` 的分页此前只见过单页；本轮补上：[native_list_commits_paging_real.mjs](../../../../api/runtime/test/verify/native_list_commits_paging_real.mjs)。

通过原生 Windows Store（`feature` 上 5 个提交）：

- `list_commits('feature',2,0)` → 2 条、`hasMore:true`、`nextPagePos:2`；
- `(2,2)` → 2 条、`nextPagePos:4`；`(2,4)` → 1 条、`hasMore:false`；
- 三页合并 = `commit 1..5` 五条消息。

[结果](../../../../tmp/native-list-commits-paging-20261103/actual-first/result.json) 读取 2026-11-03T15:35:17.282Z，[命令](../../../../tmp/native-list-commits-paging-20261103/actual-first-command.json)。一次通过。

## 限制

只覆盖 5 个提交 / pageSize 2；页间并发提交、跨 Branch 合并历史未覆盖。生产 LOC 不变。

first parent 81484e9e4923ee8256387ce054c1fd83a6731f3e；本记录只增文档/测试。
