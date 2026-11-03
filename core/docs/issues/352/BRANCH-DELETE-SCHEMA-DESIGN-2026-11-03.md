# 已发布分支可删除：schema 变更设计（2026-11-03）

> **Status:** Design proposal. No schema change, no implementation. Owner decides.

## 问题

`branch.delete` 已实现，但**被已发布 Layer 引用的 Branch 一律拒绝 `Published`**：`layer.source_branch_id` 有 `FOREIGN KEY (layer_stack_id, source_branch_id) REFERENCES branch(...)`，删除会在提交时违反外键。CLI 报告里的 20 个 `win-*` 测试分支多数已发布，因此删不掉。

## 现有约束（不可绕）

- `layer` 表 `STRICT, WITHOUT ROWID`；`CHECK` 要求 child layer 的 `source_branch_id` **非空**（genesis 才允许三者皆空）。
- `branch` 唯一 `(layer_stack_id, name)`；`commit.branch_id` 无外键（未发布分支可删）。
- Store schema 有版本检查；**没有迁移机制**（缺表/版本不符的 Store 直接被拒绝）。
- 84 §8：History 不删除、GC 需独立契约。

## 候选方案

| 方案 | 改动 | 代价 |
|---|---|---|
| A. 去外键 + 允许 source_branch_id 为空 | 改 `layer` 的 FK 与 CHECK；schema 版本 +1 | 已发布 Layer 的来源信息会丢（或需另存）；旧 Store 需迁移/重建 |
| B. 软删除（tombstone） | `branch` 加 `deleted_at`（或状态列），删除=置位；列表过滤；名字释放需要额外规则（唯一索引含状态） | 行永久保留；名字复用语义要重新定义；同样要 schema 版本 |
| C. 不支持删除已发布分支（现状） | 无 | 已发布测试分支无法清理 |

## 建议

**C 保持现状 + 记录 A/B 的前置条件**，除非 owner 明确要清理已发布分支：

- A 会改变历史来源语义（Layer 的 source 变成可空），属于 canonical 契约变更，不是小修；
- B 的软删除会让 `branch` 行与唯一索引语义变复杂，且需要迁移；
- 两者都要求 **新增迁移契约**（当前没有），影响所有既有 Store。

若 owner 要 A/B，先立「Store schema 迁移」契约（版本、迁移步骤、旧 Store 处理），再改 schema；在此之前 `branch.delete` 的 `Published` 拒绝是正确行为。

## 影响面（若将来做 A）

- `engine/crates/layerfs-persistence/sql/sqlite/history.sql`：FK 与 CHECK。
- `layerfs-history` 的 Layer 记录与读取（source 可为空）。
- 所有读 `source_branch_id` 的查询与 SDK 值（可为 null）。
- 既有测试与记录里「child layer 必有 source」的断言。
- 生产 LOC 会显著增加（schema + 迁移 + 读取兼容），需单独立项。

本记录只是设计，没有改 schema、没有改代码；生产 LOC 不变。
