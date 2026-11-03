# 原生 Store 的 diff 分页与 hunks 开关（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`branch.diff_commits` 与 `branch.diff_branches` 支持 `pageSize/pagePos` 与 `{ hunks: false }`，但此前没有真实消费者；本轮补上：[native_diff_paging_real.mjs](../../../../api/runtime/test/verify/native_diff_paging_real.mjs)。

通过原生 Windows Store：

- `feature` 上两次 `fs.apply` 各写三个文件；`diff_commits(base, head, 1)` 返回 **1 项、`hasMore: true`、`nextPagePos: 1`**；第二页拿到另一条路径；`pageSize: 50` 一次拿全 3 条且 `hasMore: false`。
- `{ hunks: false }` 时每个条目的 `hunks` 为 **`null`**（不是缺字段）。
- `diff_branches('other', 'feature', 1)` 同样分页：1 项、`hasMore: true`。

[结果](../../../../tmp/native-diff-paging-20261103/actual-fifth/result.json) 读取 2026-11-03T07:14:43.439Z，[命令](../../../../tmp/native-diff-paging-20261103/actual-fifth-command.json)。

四次消费者错误保留 FAIL：① 把 feature 的 head 与「feature 历史最后一条」当 base（同一提交）；② 改从 `main` 取 base，但该 Store 里没有 `main`（`NoSuchBranch`）；③ 断言 `hunks === undefined`（实际是 `null`）；④ 用同一 Branch 自比 `diff_branches` 却读 `items[0]`（空列表）。产品行为每次都对。

## 限制

只覆盖 Store 面、单页/两页与 hunks 开关；`cursor` 续页、`nextCursor` 未覆盖。生产 LOC 不变。

first parent 5c1e231d094ae35235d38ad624eafb966f8e85d6；本记录只增文档/测试。
