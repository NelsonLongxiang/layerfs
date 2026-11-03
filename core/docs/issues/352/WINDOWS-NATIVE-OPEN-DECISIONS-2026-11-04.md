# 三个悬置问题的处置（2026-11-04）

> **Status:** Dated decision record. No product change beyond the pushed plugin commits.

按作者偏好与既有建议收口，逐条给结论与依据。

## 1. 空 stdin 守卫：不做默认拒绝

- **结论**：CLI 与 SDK 保持“给什么写什么”。空 stdin 写入 0 字节文件是既有行为（[空内容写入](WINDOWS-NATIVE-EMPTY-WRITE-2026-11-03.md)），不新增拒绝分支。
- **依据**：`api/docs/agent.md` 说 CLI “sends them exactly”；`edit` 只拒绝空的 `oldText`（歧义），不拒绝空内容；引擎 `target()` 对长度 0 正常建文件。
- **若将来要防手滑**：放 CLI 层做显式 opt-in（例如 `--require-content`），不动 SDK 语义；当前不实现。
- **相关修复**：零长度**二进制**体的 abort 已修（[空字节体崩溃](WINDOWS-NATIVE-EMPTY-BYTES-CRASH-2026-11-04.md)）——那是缺陷，不是“空即拒绝”。

## 2. 已发布分支删除：保持 `Published` 拒绝

- **结论**：不改 schema、不实现 A（去外键 + 允许 source 为空）或 B（tombstone）。
- **依据**：两者都需要 **Store schema 迁移契约**（当前没有迁移机制，旧 Store 会被 schema 检查拒绝），且会改变 canonical 历史来源语义；设计对比见 [BRANCH-DELETE-SCHEMA-DESIGN](BRANCH-DELETE-SCHEMA-DESIGN-2026-11-03.md)。
- **现状**：未发布分支可删、`--force` 可删；已发布一律 `Published`；`main` 拒绝；对象不回收。

## 3. 插件仓 shim 提交：已推 fork

- 三个提交（`70270c0` client、`9be4724` 多行参数、`382a2ed` 管道 stdin）已推到 `fork/main`（NelsonLongXiang/dsh-layerfs），readback 头 SHA `382a2ed`。
- 仓库里其它未提交的 client 改动不属于本次，未触碰。

## 4. 主 task `3b7a154bc4`

- 保持 `doing`：是否关闭由 owner 决定，本记录不代作决定。

本记录只增文档；生产 LOC 不变（112122）。
