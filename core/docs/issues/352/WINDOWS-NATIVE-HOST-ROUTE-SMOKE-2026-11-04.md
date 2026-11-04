# 插件 host 路由在 native 路由下的冒烟（2026-11-04）

> **Status:** Dated smoke record. Read-only GETs; no product change.

3081（DSH test home，插件 junction 源码活性，`layerfs-host.route = native`）重启后做只读冒烟。

## 通过（200，真实数据）

| 路由 | 结果 |
|---|---|
| `GET /`（带 token） | 200 |
| `GET /layerfs/status` | 200，`configured:true`、`missing:[]`、sdk/backend/cli 路径正确 |
| `GET /layerfs/runtime` | 200，`level:"ok"`，engine `not-used`（native 路由不涉及 Docker） |
| `GET /layerfs/projects` | 200，列出 `native1`（volume/source/created） |
| `GET /layerfs/project/native1/state` | 200，main head 与 commits（C1..）、roots 等 |
| `GET /layerfs/project/native1/history` | 200，History 数据 |
| `GET /layerfs/project/native1/storage` | 200，store 统计（logical/canonical/stored/dedupe/compression）与 init 记录 |

## 未通过（预期行为，非缺陷）

- `list/changes` 用 `ref=main` → **400**：路由要求 `ref` 是 **64–68 位十六进制**的已保存 Commit/Layer id，不接受分支名。
- 用 history 里的 64 位 id 请求 `list` → **409**：这些 id 是 Init/合并产生的 Layer；409 属 `NotComparable` 类拒绝，但具体由 id 解析还是 list 的比较步骤触发，本轮未进一步区分。
- 要 200 需要一个“有可比 Commit 的已保存 id”；本轮未构造，不影响上面的结论。

## 影响说明

- 覆盖了 GUI 验收里最有价值的部分：**host 装配 + Store 读**在 native 路由下可用、返回真实数据。
- 仍未覆盖：client 的 React 渲染与 agent 会话里 skills→SDK 的注入路径；这两块属呈现/接线，失败不会污染 Store。
- 环境注意：3081 的 token 每次重启会变；本轮用 `tmp/3081-out.log` 里的新 token。

本记录只增文档；生产 LOC 不变（112122）。