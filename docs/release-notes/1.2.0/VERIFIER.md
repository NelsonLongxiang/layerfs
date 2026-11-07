# LayerFS 1.2.0 — 机器可执行验证器（ygl-trees spec-validator）

> 状态：已构建、已运行、已归档；meta 准入为**硬门**。
> 工具：`ygl-trees 0.120.0`（= npm latest），`contract 1.2` / `corpus 1.2`。

## 它验证什么

材料把发布验收写成 6 个子句（S1–S6），每个子句由 predicate AST 判据在**快照库**上判定：

| 子句 | 判据 |
|---|---|
| S1 | 五个版本字段（workspace + 四个 api 包）= 1.2.0 |
| S2 | 五个产物按 kind（exe/binding/bundle）登记齐备 |
| S3 | 五个产物的 sha256 均出现在本目录的 ARTIFACTS.md 中 |
| S4 | 门禁记录 693 通过、0 失败 |
| S5 | tag `v1.2.0` 存在，且其提交等于发布分支头 |
| S6 | 边界记录六项，且 agent 路径标记为已验证（CLI 路径） |

## 身份

| 项 | 值 |
|---|---|
| 工作区 | `tmp/verify-ws`（`YGL_HOME=…/home`；tmp/ 已在 .gitignore） |
| 材料 | `mat_db3c972193ba`，text sha256 `20e6c44a1d5c0665…` |
| Spec | `spec_497e1afd9b53` **v3**（9 判据，覆盖 6/6，P5 冻结） |
| Run | `run_7a59473105dc88b0`，**overall=PASS**（9/0/0/0） |
| 归档 | `arc_585da479209e`，`sha256:585da479209ec773…`，`archive verify` ok（5 项 0 问题） |
| 快照 | `release-1.2.0.sqlite` —— 由真实文件投影：五个 sha256 现场计算，gate 693/0 取自门禁日志，tag/head 取自 git，S3 用 `doc_matches` 表逐项核对 |

## meta 准入（硬门）

`verify/meta.json`（`meta_index_version: 2`）声明 `source_roots`
（api / core / engine / plugins / tools / docs）使产品源码不被当作 stray 工具；
`.gitignore` 补 `tmp/`。`ygl-trees verify meta .` 结果：

```
✓ R1 AGENTS.md exists at repo root
✓ R2 verify/meta.json ↔ spec files consistent
✓ R3 no stray executable verification artifacts
✓ R5a orchestration statically compliant
meta_version 1.4 · verdict PASS
```

此后再 `submit`/`prepare`，报告里不再出现 `meta_warning`（此前为 "meta gate skipped"）。

## 复跑

重建输入的单一事实源在 [`verify/win-native-release/`](../../../verify/win-native-release/README.md)
（分支 `verify/converge-win-native-release`）；运行态工作区仍在 `tmp/verify-ws`（见其 SUPERSEDED.md）。

```bash
python verify/win-native-release/build-snapshot.py          # 重建快照（参数化）
cd tmp/verify-ws && export YGL_HOME="$PWD/home"
ygl-trees verify run spec_497e1afd9b53 --db release-1.2.0.sqlite
ygl-trees verify report run_7a59473105dc88b0
ygl-trees verify archive verify home/verify/archives/*.yglverify.zip
ygl-trees verify self-check --corpus <ygl-trees>/packages/verify/core/corpus
```

工具自检六环全绿：environment / 12 canonical vectors / 173 文件语料摘要 / 2 shapes /
44 例语料实跑 / 归档重算。

## 如实披露的边界

1. 验证的是**快照投影**，不重跑 cargo；产物级复核以
   [门禁回执](../../../core/docs/issues/352/WINDOWS-NATIVE-GATE-RUN-2026-11-05.md) 的 693/0 为准。
2. 候选与评审**同作者**（P3a 已记录，引擎不阻断独立评审）。
3. `graduate` 资格需 3 份连续 PASS 且跨度 ≥30 天：当前 1 份，未毕业。
4. 本 fork 的 GitHub Actions 被禁用，因此验证器在本机执行，不依赖 CI。
