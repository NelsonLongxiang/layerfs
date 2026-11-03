# 原生 Store 的 list 分页与目录 stat（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.list` 的分页此前只见过单页；本轮补上小 pageSize 多条目：[native_list_paging_real.mjs](../../../../api/runtime/test/verify/native_list_paging_real.mjs)。

通过原生 Windows Store（`/d` 下 7 个文件）：

- `list('/d',3,0)` → 3 条、`hasMore:true`、`nextPagePos:3`；
- `list('/d',3,3)` → 3 条、`nextPagePos:6`；
- `list('/d',3,6)` → 1 条、`hasMore:false`；
- 三页合并 = `a1..a7` 七个名字；`stat('/d')` 的 `type` 是 **`dir`**（不是 `directory`）。

[结果](../../../../tmp/native-list-paging-20261103/actual-second/result.json) 读取 2026-11-03T15:05:28.976Z，[命令](../../../../tmp/native-list-paging-20261103/actual-second-command.json)。

保留的 FAIL：首跑把目录 `type` 写成 `directory`，实际是 `dir`。

## 限制

只覆盖 7 条目 / pageSize 3；页间并发增删、超大目录、排序稳定性未覆盖。生产 LOC 不变。

first parent fcbb094fdfab1eada6c22bdfa6047cb500e54ecb；本记录只增文档/测试。
