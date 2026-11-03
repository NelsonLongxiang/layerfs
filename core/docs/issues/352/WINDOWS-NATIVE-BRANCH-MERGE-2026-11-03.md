# 原生 Store 的 branch.merge（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`branch.merge(a, b, name, message)` 把两条 Branch 合成**新的** Branch，`a`/`b` 不变。此前没有真实消费者；本轮补上：[native_branch_merge_real.mjs](../../../../api/runtime/test/verify/native_branch_merge_real.mjs)。

流程（原生 Windows Store）：

1. 从 main fork 出 `feature` 与 `other`，各写一个文件（`/merged.txt`、`/other.txt`）。
2. `branch.merge('feature', 'other', 'merged-branch')` 返回 `kind: 'Merged'`、`branch: 'merged-branch'`、`fastForward: false`。
3. 新 Branch 上两侧文件与 main 的 `seed.txt` 都可读；History 头部等于返回的 `head`，且存在带 `secondParent` 的 merge commit。
4. 同名再 merge → **`NameTaken`**；源 Branch 不存在 → **`NoSuchBranch`**。

[结果](../../../../tmp/native-branch-merge-20261103/actual-third/result.json) 读取 2026-11-03T04:53:45.135Z，[命令](../../../../tmp/native-branch-merge-20261103/actual-third-command.json)。

两次消费者错误保留 FAIL：第一次把 main 与 feature 合并（main 是 feature 的祖先，结果 `fastForward: true`，不是真 merge）；第二次把 History 条数写死为 3，实际 2。产品行为本身正确。

## 限制

只覆盖 Store 面的干净合并；冲突、`/.lww`、merge units、分页未覆盖。生产 LOC 不变。

first parent af8eb75db8a36d556770bb2f8828be7d749a5db7；本记录只增文档/测试。
