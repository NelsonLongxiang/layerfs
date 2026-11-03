# 原生 Store 的 branch.delete（2026-11-03）

> **Status:** Dated functional record. Product change: `branch.delete` on the Store face.

`branch.delete` 此前不存在（CLI/SDK 都无法清理测试分支）。本轮按 [设计提案](BRANCH-DELETE-DESIGN-2026-11-03.md) 实现，并在实现中发现 schema 外键把语义收窄：[native_branch_delete_real.mjs](../../../../api/runtime/test/verify/native_branch_delete_real.mjs)。

## 语义

- 空 Branch：直接删除，返回 `{kind:"Deleted", branch, head:null, unmerged:0}`。
- 未发布但有 Commit：默认拒绝 **`Unmerged`**（detail 带 `unmerged` 计数）；`force` 可删。
- **被已发布 Layer 引用：一律拒绝 `Published`**——`layer.source_branch_id` 有外键指向 `branch`，删了会违反外键；schema 不允许。
- `main`：`InvalidInput`；缺失：`NoSuchBranch`。
- 删除后名字可复用；Commit 与对象**不回收**（与 84 §8「GC 需独立契约」一致）。

## 证据

通过原生 Windows Store（新构建的 addon + native 可执行）：

- 空 Branch 删除成功，列表不再出现；
- 已发布 Branch → `Published`，Branch 仍在；
- 未发布有 Commit → `Unmerged`，`force` 后删除，`unmerged:1`；
- `main` → `InvalidInput`；`nope` → `NoSuchBranch`；
- 删后同名 `fork` 成功。

[结果](../../../../tmp/branch-delete-20261103/actual-sixth/result.json) 读取 2026-11-03T12:22:25.179Z，[命令](../../../../tmp/branch-delete-20261103/actual-sixth-command.json)。

## 保留的 FAIL

- 首次运行用**旧 addon**：`branch.delete` 走不到新代码（`UnknownMethod`）。
- 未加 `branch_layer_count` 语句映射前：删除已发布分支触发外键，表现为 `Failed: integrity: persistence`。
- `main` 的检查最初放在 store-service，但 `lookup::branch` 先拒绝 main（`NoSuchBranch`）；改为 API 层先判 `main` 才得到 `InvalidInput`。

## 限制

- 已发布分支不可删（schema 外键）；要放开需 schema 变更（`ON DELETE SET NULL` 或去外键），属独立契约。
- 删除后 Commit 行保留、`branch_id` 悬空（无外键），对象不回收；GC 未实现。
- 只覆盖单进程、Windows 原生 Store；并发删除与 publish 竞争未测。

first parent 5e750cba191393f47ded2058839160ebf784a26c。
