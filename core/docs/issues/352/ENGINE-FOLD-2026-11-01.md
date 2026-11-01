# 验证引擎 STALE 聚合修复采纳（2026-11-01）

> **Status:** Dated verification result; local pinned candidate, not a published release.
> 本轮自18:10起，Asia/Shanghai；精确命令与时间见回执。风险档：中，验证工具变更、无产品部署。

## 结果

已定位并采用现成修复，未重复开发引擎：ygl-trees `41344f4ddbc9979160c14b34e314194787117ce5`，
[PR #145](https://github.com/NelsonLongxiang/ygl-trees/pull/145) 已于2026-11-01T04:37:42Z合并为 `e5876e07a76c37ffdc6bca67823e938ce904d951`。
当前npm/global仍为旧0.118.0；固定源码构建也报告0.118.0，所以不能只用版本号区分。
本轮在git archive导出目录构建并核验候选，未改共享ygl源码、未切其在途分支、未改全局安装。

- 定向回归：**6/6 PASS**，覆盖STALE、INFRA_BLOCKED、业务FAIL、schema错误、损坏pinned包、嵌套聚合。
- 真实材料重放：旧错误target的树仍STALE，但新普通报告是ERROR/error=2，6份新归档全部验包通过。
- 精确target仍为 **Store PASS / Workspace FAIL / 总体FAIL**；这是业务事实，修复没有将它抹绿。
- 两个历史坏报告、侧车及zip，六个文件前后sha256一致；新引擎仍拒绝它们。
- 隔离候选工作区自校验：**6环全ok、无skip**（12 canonical向量、173语料文件、2形状、44案例、21新归档）。
- 原验证器15份合成正反例全部在固定入口复验，预期与结果逐项一致；这不把合成Workspace正例当成活挂载。
- 固定启动入口：4组正反例通过，包括缺home、两种转发home覆盖、篡改bundle拒绝。

## 根因和修复范围

旧树聚合写入五值STALE/INFRA_BLOCKED/NEUTRALIZED到普通四值VU，summary和overall另外计算；
archive verifier按普通四值重算，因此能检测出统计不一致。这不是archive verifier过严，也不应修改历史报告。
现成修复将树专属三态投影为普通ERROR，并复用archive的foldSummary/foldOverall；
五值原判定仍保留在tree envelope，leaf report_verdict不变，FAIL保持优先。

## 固定输入与产物

| 对象 | 身份 |
| --- | --- |
| 引擎源码 | `e5876e07a76c37ffdc6bca67823e938ce904d951`，未修改产品源码 |
| CLI主块 | `5cee6ac02028e0e2661f8e0e0bfddf041b01387039765e1d6450468e1dbde61b` |
| 其它四构建块、package/bundle/corpus manifest | [engine-pin.json](../../../../tools/verification/native-route/engine-pin.json) |
| 构建环境 | Node v24.12.0，tsdown 0.23.1，rolldown 1.2.14 |
| 语料 | corpus1.2，digest `683766f1077bb2c0fef662f485959bcb14df2ad6100867248faef70ce3902d43` |
| 既有事实快照 | `02006c7301fd2430f540a3d2a74ca83e0afa560f86d1be5ec58033e3b9725d31`，本轮未重采产品操作 |

外部运行依赖复用本机已安装依赖，版本记录在pin；bundle哈希不认证这些外部依赖的字节。
这不是签名发布物，不执行npm publish、全局升级或生产替换。

## 实际运行与原件

| 场景 | 新tree run | 根普通报告 | 结果 |
| --- | --- | --- | --- |
| 旧mismatched target | `tr_3c3b1cb25001` | `run_899c1a27632b` | tree=STALE；ordinary=ERROR；error=2 |
| 精确target | `tr_4d8c4a711333` | `run_72b62cd5c40d` | tree=FAIL；ordinary=FAIL；pass=1/fail=1 |

冻结spec/material/tree共16文件逐字节复制到新工作区；原件与副本前后哈希全部一致。
两树均实际重跑叶spec并归档；不采用跨工作区pinned旧run。
历史拒绝目标：`run_1fa89d0ea5d6`、`run_eebe9b27cb56`，原因仍为summary.error与overall不匹配。

原件：[重放总结](../../../../tmp/engine-fold-20261101/replay/summary.json)、
[六项回归](../../../../tmp/engine-fold-20261101/group-regression-registered.json)、
[最终入口自校验](../../../../tmp/engine-fold-20261101/pinned-entry-selfcheck-final.json)、
[启动器回归](../../../../tmp/engine-fold-20261101/launcher-tests-final.json)。

## 后续从哪个入口跑

固定入口是[engine.mjs](../../../../tools/verification/native-route/verify/orchestration/engine.mjs)。
必须显式给候选根与隔离home；先验pin所有文件，失败不回退全局CLI。
入口不自造判定，透传CLI退出码，110秒子进程上限。不要将它用于默认全库的写入。

```powershell
$engine = "D:/workspace/ygl-trees/tmp/layerfs-fold-e5876e0-20261101/source"
$home = "D:/workspace/layerfs/tmp/engine-fold-20261101/replay/home"
$runner = "D:/workspace/layerfs/tools/verification/native-route/verify/orchestration/engine.mjs"
node $runner --engine $engine --home $home -- verify self-check --corpus "$engine/packages/verify/core/corpus" --json
```

这些路径是本机验证副本，不是产品契约；不要删掉它们后仍宣称入口可用。
需要重新构建时从同一提交git archive导出，使用上游package.json的build:bundle:only参数；
不新建worktree、不复制共享dist、不改源码、不自动改pin接受新字节。
本次采用的参数：

```sh
node <existing-tsdown>/dist/run.mjs apps/cli/src/bin.ts --format cjs --out-dir dist/bundle --platform node --target node20 --deps.never-bundle better-sqlite3 --deps.never-bundle typeorm --deps.never-bundle reflect-metadata --deps.never-bundle pg --deps.never-bundle @deepseek-ai/dsh-atomic-write
```

## 失败保留与范围

第一次六项回归均被R3挡住：archive导出目录没有Git追踪上下文，刚生成的五个dist块未登记。
经上游scripts/meta-tooling.mjs --add逐条登记build角色后重跑6/6；只改导出副本登记，不改测试/产品源码、不用no-meta。
两条动态导入构建warning保留在[构建回执](../../../../tmp/engine-fold-20261101/build.json)，不冒称零警告。
原全局工作区仍留有坏归档，**不能声称全局self-check已绿**。本轮绿的是固定候选+隔离工作区。
由于未升级全局CLI，后续必须走固定入口；已发布修复版的采纳需再核版本、出处与回归。

ProjFS DLL与驱动仍未找到；没有原生Workspace/exec、活挂载或新的capture-to-Commit能力。
管理员组件启用及适配器的工程证明仍是后续工作，见[研究边界](WINDOWS-WORKSPACE-PROJFS-RESEARCH.md)。
不修改DSH源码或宿主，不改旧claim状态/resolve历史，不开启或重开上游PR。
生产LOC不变：104392→104392（+0）；本轮仅验证工具与文档。
品味判断点：无新增（采用现成正确性修复，不修改业务标准）。
