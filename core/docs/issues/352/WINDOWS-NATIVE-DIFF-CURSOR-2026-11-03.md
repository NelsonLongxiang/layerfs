# 原生 Store 的 diff cursor 续页（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`branch.diff_commits`/`diff_branches` 的分页除了 `pagePos` 还接受 `{ cursor }` 续页；`pageSize` 分页已由 [diff 分页记录](WINDOWS-NATIVE-DIFF-PAGING-2026-11-03.md)覆盖，cursor 此前没有真实消费者；本轮补上：[native_diff_cursor_real.mjs](../../../../api/runtime/test/verify/native_diff_cursor_real.mjs)。

通过原生 Windows Store：

- `feature` 上两次 `fs.apply` 各写三个文件，得到 6 条路径的差异；
- `diff_commits(base, head, 1, 0, { hunks: false })` 返回 1 项，并给出 **`nextCursor`**；
- 用 `{ cursor: nextCursor }` 再调用 → 返回 1 项，且路径与第一页不同。

[结果](../../../../tmp/native-diff-cursor-20261103/actual-first/result.json) 读取 2026-11-03T09:20:26.567Z，[命令](../../../../tmp/native-diff-cursor-20261103/actual-first-command.json)。本轮一次通过，无消费者返工。

## 限制

只覆盖 `diff_commits` 的 cursor 一页；`diff_branches` 的 cursor、cursor 失效/跨请求重放、与 `pagePos` 混用未覆盖。生产 LOC 不变。

first parent 35786e6da9c96a764dcf1dc4aad669e91e7cc846；本记录只增文档/测试。
