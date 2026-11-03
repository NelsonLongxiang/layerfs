# 原生 Store 的 glob 预算截断（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.glob` 的回复预算（`REPLY_BUDGET = 48 KiB`）会在条目多时截断并给 `nextPagePos`；此前没有消费者。本轮补上：[native_glob_budget_real.mjs](../../../../api/runtime/test/verify/native_glob_budget_real.mjs)。

通过原生 Windows Store（250 个约 210 字符的长名文件）：

- `glob('/f*.txt','/',1000,0)` → 一页**装不下 250 条**，`hasMore:true` 且 `nextPagePos` 前进；
- 按 `nextPagePos` 续页直到 `hasMore:false`，**各页合计 250 条**，覆盖全部文件。

[结果](../../../../tmp/native-glob-budget-20261103/actual-first/result.json) 读取 2026-11-03T13:00:29.974Z，[命令](../../../../tmp/native-glob-budget-20261103/actual-first-command.json)。一次通过。

## 限制

只覆盖长名文件触发的预算截断；`grep` 的预算截断（`skipped`/超预算）、更深目录、符号链接混合未覆盖。生产 LOC 不变。

first parent da17c0c23298e02c9395ff5f9e1fc3e27572b0f8；本记录只增文档/测试。
