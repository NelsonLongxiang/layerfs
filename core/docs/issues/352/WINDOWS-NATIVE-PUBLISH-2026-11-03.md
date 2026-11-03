# 原生 Store 的 branch.publish（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`branch.publish(branch, commit?)` 让 **main** 显示该 Branch 的 head（或指定 Commit），方式是往 main 加一个 Layer。这是把工作落到 main 的正规路径，此前没有真实消费者；本轮补上：[native_branch_publish_real.mjs](../../../../api/runtime/test/verify/native_branch_publish_real.mjs)。

流程（原生 Windows Store）：

1. 从 main 分叉 `feature` 与 `side`，各写同一路径 `/pub.txt`（`first`／`side`）。
2. `branch.publish('feature')` 返回 `kind: 'Added'` 且带 `publishedLayer`；main 读到 `first`。
3. 再 `publish('feature')` → **`UpToDate`**。
4. `publish('side')`（与已发布提交分叉）→ `Added`，`overwrote` **非空**（列出被跳过的 main Layer）；main 读到 `side`。
5. `publish('nope')` → **`NoSuchBranch`**。

[结果](../../../../tmp/native-publish-20261103/actual-second/result.json) 读取 2026-11-03T05:48:42.401Z，[命令](../../../../tmp/native-publish-20261103/actual-second-command.json)。

一次消费者错误保留 FAIL：最初在**同一条** Branch 上连续 publish 后断言 `overwrote` 非空——同一条链上是叠加，不会跳过 Layer，所以 `overwrote` 为空是正确行为；改成两条分叉 Branch 后才真正覆盖。

## 限制

只覆盖干净发布；冲突、`commit` 参数指定旧提交、`NoChanges` 分支未覆盖。生产 LOC 不变。

first parent cc9ca228209a5c34e48ff4e9aaa458d3ed2036ff；本记录只增文档/测试。
