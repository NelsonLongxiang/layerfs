# 原生 Store 的 publish 与指定 Commit（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`branch.publish(branch, commit?)` 的 `commit` 参数并不等于「把任意旧提交发布到 main」；本轮用真实消费者钉住它的实际语义：[native_publish_commit_real.mjs](../../../../api/runtime/test/verify/native_publish_commit_real.mjs)。

通过原生 Windows Store：

1. `feature` 上 `/a.txt` 先写 `v1` 再写 `v2`；`publish('feature')` → `Added`，main 读到 `v2`。
2. `publish('feature', 旧提交)` → **拒绝 `HeadMoved`**（消息 `head moved`）——不能把旧提交盖到已前进的 head 上；main 仍是 `v2`。
3. `publish('feature', 当前 head)` → **`UpToDate`**（main 已显示它）。

[结果](../../../../tmp/native-publish-commit-20261103/actual-second/result.json) 读取 2026-11-03T07:35:47.592Z，[命令](../../../../tmp/native-publish-commit-20261103/actual-second-command.json)。

一次消费者错误保留 FAIL：最初假设「指定旧提交 = 把它发布到 main」，实际产品明确拒绝 `HeadMoved`——这是正确行为，不是缺陷。

## 限制

只覆盖 Store 面、单 Branch 与三种结果；`NoChanges`、跨 Branch 指定 Commit 未覆盖。生产 LOC 不变。

first parent baaac7d4ed2e93c61499630947f9499a6a57e9b8；本记录只增文档/测试。
