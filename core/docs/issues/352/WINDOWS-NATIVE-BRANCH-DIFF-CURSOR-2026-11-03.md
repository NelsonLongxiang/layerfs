# 原生 Store 的 diff_branches cursor 续页（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`branch.diff_branches` 的 `pageSize/pagePos` 分页已覆盖，**cursor 续页**没有消费者；本轮补上：[native_branch_diff_cursor_real.mjs](../../../../api/runtime/test/verify/native_branch_diff_cursor_real.mjs)。

通过原生 Windows Store：

- `feature` 上写 3 个文件；`diff_branches('main','feature',1,0,{hunks:false})` 返回 1 项、`hasMore:true`、**`nextCursor`**；
- 用 `{cursor: nextCursor}` 再调 → 返回 1 项，且路径与第一页不同。

[结果](../../../../tmp/native-branch-diff-cursor-20261103/actual-second/result.json) 读取 2026-11-03T12:48:20.631Z，[命令](../../../../tmp/native-branch-diff-cursor-20261103/actual-second-command.json)。

保留的 FAIL：首跑 ACL 命令写错（`(O)(CI)F` 缺 `I`），icacls 拒绝；修正后一次通过。

## 限制

只覆盖一页 cursor；失效 cursor、与 pagePos 混用、`hunks:true` 的 cursor 未覆盖。生产 LOC 不变。

first parent 790cc4bd04464d80e115b9e2d06c8f5573e8ed91；本记录只增文档/测试。
