# 原生 Store 的空列表与 sandbox 家族拒绝（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

空目录行为与 native 路由的 sandbox 家族拒绝此前只在资格页里写过，没有消费者；本轮补上：[native_empty_refusals_real.mjs](../../../../api/runtime/test/verify/native_empty_refusals_real.mjs)。

通过原生 Windows Store：

- `/empty` 空目录：`list('/empty')` → `items: []`、`hasMore:false`；`glob('*','/empty')` 同样空；
- `project.list_sandboxes()` → **`Unsupported`**（native 路由不提供 sandbox 家族）。

[结果](../../../../tmp/native-empty-refusals-20261103/actual-first/result.json) 读取 2026-11-03T15:50:20.407Z，[命令](../../../../tmp/native-empty-refusals-20261103/actual-first-command.json)。一次通过。

## 限制

只覆盖空目录与一个拒绝面；其余 sandbox 调用（create/mount/reclaim）未逐一覆盖。生产 LOC 不变。

first parent 8ffb3443f4c048eb6e89ad74a4abd55ee42bfd8d；本记录只增文档/测试。
