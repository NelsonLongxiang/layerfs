# 原生 Store 的 grep 预算截断（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.grep` 同样受 48 KiB 回复预算限制；此前只测过小结果。本轮补上：[native_grep_budget_real.mjs](../../../../api/runtime/test/verify/native_grep_budget_real.mjs)。

通过原生 Windows Store（一个 3,000 行、每行含 `needle` 的文件）：

- `grep('needle','/',1000,0)` → 一页装不下全部匹配，`hasMore:true` 且 `nextPagePos` 前进；
- 按 `nextPagePos` 续页直到 `hasMore:false`，**各页合计 3,000 条**。

[结果](../../../../tmp/native-grep-budget-20261103/actual-second/result.json) 读取 2026-11-03T13:35:40.513Z，[命令](../../../../tmp/native-grep-budget-20261103/actual-second-command.json)。

保留的 FAIL：首跑用 `pageSize 5000`，SDK 拒绝（`pageSize must be 1..1000`）。

## 限制

只覆盖单文件多匹配；跨文件混合、`skipped` 与预算同时作用、超长行截断未覆盖。生产 LOC 不变。

first parent 97da23fc460de7ac74e3cc82927a5ade1141d0b7；本记录只增文档/测试。
