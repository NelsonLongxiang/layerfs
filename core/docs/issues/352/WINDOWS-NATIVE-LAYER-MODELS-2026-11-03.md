# 原生 Store 的 Layer 读模型：list_overwritten 与 get_comparable（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

发布会在 main 上产生 Layer；两个读模型描述它们：`store.project.list_overwritten`（一次发布替换掉、但不包含的旧 Layer）与 `store.project.get_comparable`（把 Layer 映射回可比较的 Commit）。此前没有真实消费者；本轮补上：[native_layer_models_real.mjs](../../../../api/runtime/test/verify/native_layer_models_real.mjs)。

通过原生 Windows Store：

1. 从 main 分叉 `feature` 与 `side`，各写 `/pub.txt`；`publish('feature')` → `Added`。
2. `publish('side')`（分叉）→ `Added` 且 `overwrote` 非空。
3. `store.project.list_overwritten(第二个 Layer)` → **至少一条**被跳过的 Layer。
4. `store.project.get_comparable(该 Layer)` → 返回含 `commit`/`root`/`exact` 的映射。
5. `get_comparable(feature 发布的源 Commit)` → `exact: true`，`commit` 就是该 Commit。

[结果](../../../../tmp/native-layer-models-20261103/actual-first/result.json) 读取 2026-11-03T08:50:29.796Z，[命令](../../../../tmp/native-layer-models-20261103/actual-first-command.json)。本轮一次通过，无消费者返工。

## 限制

只覆盖分叉发布产生的 Layer 与被跳过 Layer 的一条路径；`NotComparable`（Init 的 Layer、合并过的发布）、分页与 10 万 id 上限未覆盖。生产 LOC 不变。

first parent 95632c75dbe0d14646a15f25089c2707fea61972；本记录只增文档/测试。
