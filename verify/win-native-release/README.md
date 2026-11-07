# win-native-release —— 1.2.0 发布验证器（重建输入）

> 本目录是验证器线的**仓内单一事实源**：材料、候选、评审与快照构建器。
> 运行态（YGL_HOME、specs/runs/归档、sqlite 快照）按设计留在机器本地
> `tmp/verify-ws`（meta R3 要求 tmp/ gitignored）；身份与结果见
> [`docs/release-notes/1.2.0/VERIFIER.md`](../../docs/release-notes/1.2.0/VERIFIER.md)。

## 文件

| 文件 | 作用 |
|---|---|
| `material.md` | 验收材料（6 子句 S1–S6，submit 冻结为 mat_db3c972193ba） |
| `candidates.json` | 9 个 count 判据（predicate AST） |
| `reviews.json` | 三问评审（faithful/decidable/not-vacuous） |
| `build-snapshot.py` | 快照构建器（参数化，无绝对路径；从工作树实况投影事实） |

## 复跑

```bash
# 1) 重建快照（可选 --layerfs-root/--dsh-layerfs-root/--gate-log/--out）
python verify/win-native-release/build-snapshot.py

# 2) 跑验证器（YGL_HOME 指向运行态工作区）
export YGL_HOME="<layerfs>/tmp/verify-ws/home"
ygl-trees verify submit --title "LayerFS 1.2.0 Windows 原生发布验收" --text verify/win-native-release/material.md
ygl-trees verify prepare <mat-id> --candidates verify/win-native-release/candidates.json \
                             --reviews verify/win-native-release/reviews.json \
                             --db <layerfs>/tmp/verify-ws/release-1.2.0.sqlite
ygl-trees verify run <spec-id> --db <layerfs>/tmp/verify-ws/release-1.2.0.sqlite
```

同材料同候选幂等：`submit` 返回同一 material_id；判据未演进时 spec 维持 v3。

## 已知边界（见 ADR f5395bcda1）

- S3 判据信任 `doc_matches` 投影：构建后篡改 `artifacts.sha256` 不触发红（D9，P2 修）
- `verify list` 文本表格在 Windows 控制台渲染空白：用 `--json`（D4，登记移交 ygl-trees 仓）
- 快照是时点投影，不重跑 cargo；产物级以门禁回执 693/0 为准
