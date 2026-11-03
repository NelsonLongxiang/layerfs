# Branch delete：设计提案（2026-11-03）

> **Status:** Design proposal. No implementation; no capability claim. Owner decides the semantics.

## 问题

CLI 1.1.0 与 SDK 都没有 `branch delete`。一次真实测试留下 20 个 `win-*` 分支无法清理；Windows 原生 Store 路由上同样只能 `fork`、不能删除。缺失点在三层都成立：Store 有 Branch 记录与 head 指针，但没有任何「移除 Branch」的调用。

## 现状约束

- 一个 Branch 是一行 head 指针；Commit 是不可变对象，带父链，可被多个 Branch 共享。
- `publish` 把 Branch 的提交合入目标 Branch（本例 main）并推进其 head；main 只经 publish 前进。
- `fork` 记录 `forkedFrom`；merge 以 merge base 计算三方；`/.lww` 规则读 merge 的 a 侧。
- 全局单写者：删除必须走同一条发布车道，不能与 publish 并发。

## 候选语义

| 方案 | 行为 | 风险 |
|---|---|---|
| A. 只删指针 | 移除 Branch 记录与 head；对象不动 | 未合并提交变成不可达垃圾，需另行 GC；`forkedFrom` 悬空 |
| B. 删指针 + GC | 删除后回收不可达对象 | 需要可达性分析，与 merge base/publish 历史交叉；误删风险高 |
| C. 保守删除 | 仅允许删除「已合并进 main」或「无提交」的分支，否则拒绝；`force` 才允许删除未合并分支 | 不能删未合并分支（但可先 publish 或 force） |

## 建议（待 owner 拍板）

**C + A 的组合**：`branch.delete(name, { force })`

- 拒绝删除 `main`（`InvalidInput`）。
- 默认拒绝删除「有提交且未合并进 main」的分支：返回 `Unmerged`（detail: `{branch, head, unmerged: N}`），不产生任何变更。
- `force: true` 时允许删除，返回 `{kind:"Deleted", branch, head, unmerged}`；**对象不回收**（GC 另立契约）。
- 删除后：`list_branches` 不再列出；对已删分支的任何调用返回 `NoSuchBranch`；`forkedFrom` 指向已删分支的 fork 记录保留原字符串，不重写。
- 并发：删除在发布车道内完成一次原子提交式的记录移除；与 publish/merge 竞争时按既有 no-retry 规则返回 `Busy`。
- 审计：trace 记录 `branch.delete` 与 `{branch, head, unmerged, force}`。

## 接口草案

- SDK：`branch.delete(ref, { force } = {})` → `{kind:"Deleted", branch, head, unmerged}` 或拒绝。
- CLI：`layerfs branch delete <name> [--force]`；成功 exit 0，拒绝 exit 125（与现有错误路径一致）。
- 不新增 StoreRPC、不新增第二 encoder；删除只改 Branch 表与发布记录。

## 未决（需要 owner）

1. 默认是否允许删未合并分支（我建议默认拒绝、`force` 放行）。
2. 是否同轮做 GC（我建议不做，另立契约）。
3. `forkedFrom` 悬空是否需要 tombstone（我建议保留原字符串并在 `list_branches` 标 `deletedFrom`，可选）。
4. 删除后同名 `fork` 是否允许复用名字（我建议允许，历史不复用）。

## 限制

本记录只是设计，没有实现、没有测试、没有能力声明；生产 LOC 不变。

first parent 6a293ba2b3605ac901c42bf934f3553e6f91b985；本记录只增文档。
## 实现后的修订（2026-11-03，schema 证据）

实现时发现 schema 的硬约束，语义按现实收窄：

- `layer.source_branch_id` 有 **FOREIGN KEY → branch(layer_stack_id, branch_id)**（DEFERRABLE INITIALLY DEFERRED）。**任何被已发布 Layer 引用的 Branch 不能删除**——删除会在提交时违反外键。
- `commit.branch_id` 没有外键，所以「有 Commit 但从未发布」的 Branch 可以删（Commit 行保留，branch_id 成为悬空引用；对象不回收）。
- 因此最终语义：**空 Branch 直接删；未发布的 Branch 默认拒绝 `Unmerged`、`force` 可删；被已发布 Layer 引用的 Branch 一律拒绝 `Published`**；`main` 拒绝 `InvalidInput`；缺失 `NoSuchBranch`；删除后名字可复用。
- 删除在写车道的一次事务内完成；不回收对象（与 84 §8「GC 需独立契约」一致）。

这意味着 CLI 报告里那 20 个 `win-*` 分支：**已发布的不能删**，未发布的可以 `--force` 删。若要让已发布分支可删，需要 schema 变更（`ON DELETE SET NULL` 或去掉该外键），属于独立契约，未擅自改。

first parent 5e750cba191393f47ded2058839160ebf784a26c；本记录只增文档。
