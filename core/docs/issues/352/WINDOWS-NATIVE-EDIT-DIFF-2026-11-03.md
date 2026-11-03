# 原生 Store 的 edit／blame／diff（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

上一片覆盖了 mkdir/write/cp/mv/glob/grep/list/stat/rm，本轮补 `fs.edit`、`fs.blame`、`branch.diff_commits`、`branch.diff_branches`：[native_edit_diff_real.mjs](../../../../api/runtime/test/verify/native_edit_diff_real.mjs)。

通过原生 Windows Store：

- `fs.write('/note.txt', 'one\ntwo\nthree\n')` 后 `fs.edit(..., 'two', 'TWO')`，读回恰好 `one\nTWO\nthree\n`；
- `fs.blame('/note.txt')` 的结果里出现 `TWO`（blame 指向改写它的版本）；
- 再写 `/other.txt` 后，`branch.diff_commits(旧, 新)` 的 JSON 里包含 `/other.txt`；
- `branch.diff_branches('main', 'feature')` 同时包含 `/note.txt` 与 `/other.txt`（main 只有 seed.txt）。

[结果](../../../../tmp/native-edit-diff-20261103/actual-first/result.json) 读取 2026-11-03T04:21:05.521Z，[命令](../../../../tmp/native-edit-diff-20261103/actual-first-command.json)。本轮一次通过，无消费者返工。

## 限制

只覆盖 Store 面；Workspace 内编辑走 target，不在本记录范围。diff 只断言路径出现，不断言行块（hunks）细节；分页与 cursor 未覆盖。生产 LOC 不变。

first parent b456b87d82d325ec532d1b2f972c71405c738aaf；本记录只增文档/测试。
