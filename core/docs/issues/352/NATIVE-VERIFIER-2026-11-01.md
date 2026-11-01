# LayerFS 原生路线验证器更新结果（2026-11-01）

> **Status:** Dated verification result; not Workspace qualification or production authorization.
> 读取/执行时间：2026-11-01 17:07起（各项精确时间见原始回执），Asia/Shanghai；后续变化须新运行，不沿用本页作实时状态。

## 结论

- **Store 证据叶：PASS，9/9；原生 Workspace 就绪叶：FAIL，0/4。**
- **递归总判定：FAIL。** 表达“完整原生 Workspace 尚未就绪”，不表示 Store 测试失败。
- 旧验证器 `spec_9a8d135fb270` 与历史报告保留不动，不把旧四写者场景的通过挪作新路线证明。
- 全库引擎自校验没有全绿：两个历史/本轮 STALE 聚合报告统计不一致，语料库未提供；详见下节。

## 精确对象与身份

| 字段 | 本轮值 |
| --- | --- |
| 采集提交 | `dec1c3486ed0350b70336ff37ed02e0426f19c71` |
| 采集树 | `576ca3ba07f96c25dc652b937e4ba14fab92bd01` |
| 前后跟踪文件差异 | 均为空；before/after commit、tree、addon SHA 相等 |
| native addon SHA256 | `7e673c483966e52554448bfe9887ee2c2a4ef37e0bdbddf2c3a7e9632d1a757c` |
| 事实快照 SHA256 | `02006c7301fd2430f540a3d2a74ca83e0afa560f86d1be5ec58033e3b9725d31` |
| CLI / 契约 | ygl-trees 0.118.0 / contract 1.2 |
| 工具源身份 | verifier meta v2，采集器与反例工具提交前登记 hash/变迁 |

addon 是本机已存在的二进制，本轮不重建不替换；以上哈希不证明它由该提交重建。
CLI 命令报告 engine_version 字段存在不同粒度：叶为 0.1.0，树为 0.118.0；按原件保留，不手改报告。

## 冻结材料与正式运行

| 层 | 材料 / spec | 正式运行 | 结果 |
| --- | --- | --- | --- |
| Store | `mat_bda77af1ace3` / `spec_9c8f3b98db86` v1 | `run_91cf95cc8b3cd605` | 9 PASS / 0 FAIL / 0 ERROR |
| Workspace readiness | `mat_c5dd9fe201d9` / `spec_04bcdb7fdf40` v1 | `run_4f010e4ff9b3042a` | 0 PASS / 4 FAIL / 0 ERROR |
| 精确目标树 | `mat_a8ad66a4d0fb` / `ts_3a1ea05e7b59` | `tr_0d524d64cb0e` | FAIL；Store PASS + Workspace FAIL |

递归执行的叶为 `run_38b4330090c4174d`（Store）与 `run_1f425df99bae424d`（Workspace），根报告 `run_a1dc49a53274`。
本轮未用 pinned 历史叶，两个叶均在同一快照上实际运行。

## 真实命令与 witness

所有命令在根检出执行；子测试有30/65/90/95秒上限，整体采集有115秒上限。

```sh
node tools/verification/native-route/tools/collect.mjs tmp/native-route-dec1c3486-20261101
ygl-trees verify run spec_9c8f3b98db86 --db tmp/native-route-dec1c3486-20261101/snapshot.sqlite --json
ygl-trees verify run spec_04bcdb7fdf40 --db tmp/native-route-dec1c3486-20261101/snapshot.sqlite --json
ygl-trees verify tree run ts_3a1ea05e7b59 --db tmp/native-route-dec1c3486-20261101/snapshot.sqlite --json
```

- Windows runtime：surface/projects/state/events/leftovers/sandboxes/volumes/transport-order/init/docker-default 十项 PASS；home-mode 明确 SKIP，未放松 Unix 0700/0755 断言。
- 真实 SDK：7 PASS、0 FAIL、1 host SKIP；含写入/发布/读回/ReadOnly/Unsupported。
- 报告反例测试：全跳过不报ALL PASS；错误允许main写入必须FAIL，两项 PASS。
- Linux固定镜像（node22.23.4）只读挂载、无网络：home-mode/init/docker-default PASS。Linux只作回归对照，不作产品运行路线。
- ProjFS：缺DLL和驱动；预检exit=2，liveMountVerified=false。DISM只读query因未提权返回740；确切servicing状态UNKNOWN。
- 17条原始JSON回执与快照字段/sha256独立重算一致。其余6条是显式NOT_RUN范围/证明占位，不算执行回执。

正式Store报告各项witness（rows_scanned / rows_matched）：S1 23/10；S2 23/2；S3 23/1；S4 23/1；S5 23/3；S6 1/1；S7 1/1；S8 23/3；S9 23/17。
每项包含schema_fingerprint；没有用“口头复验”替代运行。

## 判别力与保留失败

- S1–S9逐项破坏快照：9/9实际FAIL且对应V1–V9命中；空快照9/9 FAIL。正式快照SHA不变。
- W1–W4使用**合成**正例4/4 PASS、逐项负例各FAIL。合成正例仅验证检查器，不证明已挂载、已Commit或已装ProjFS。
- 负例生成器：[counterexamples.mjs](../../../../tools/verification/native-route/tools/counterexamples.mjs)；源码快照以只读打开，输出目录必须不存在，禁止覆盖。
- 首次递归运行 `tr_f165a5c14d18` 为STALE：人为命名target.id与叶真实id不匹配。保留原记录；改材料为真实basename+SHA后新冻结新跑，未覆写旧spec/report。
- 一次tree_spec_version=2被CLI明确拒绝：该字段只接受schema版本1，不是修订计数；已按协议重新冻结。
- 初次归档只传--snapshot不会自动包含快照，已以--with "materials,snapshot"新建带快照归档；PowerShell逗号参数需要引号。

## 归档交付

| 工件 | 位置 | 验包 |
| --- | --- | --- |
| Store，含材料+快照 | [run_91cf95cc8b3cd605.yglverify.zip](../../../../tmp/native-route-dec1c3486-20261101/run_91cf95cc8b3cd605.yglverify.zip) | ok，arc_937911a33fcb，6 items |
| Workspace，含材料+快照 | [run_4f010e4ff9b3042a.yglverify.zip](../../../../tmp/native-route-dec1c3486-20261101/run_4f010e4ff9b3042a.yglverify.zip) | ok，arc_f8d1213e209a，6 items |
| 递归根（工作区归档） | arc_ade8f018a341 | ok，2 items |

归档校验共20份：2份正式含快照包 + 10份Store反例包 + 5份Workspace合成包 + 3份精确目标递归节点包，全部ok。
这是哈希链完整性验包，不是ed25519可信发布签名；本轮没有签名密钥/封包发布。
原始输出：[采集目录](../../../../tmp/native-route-dec1c3486-20261101/)；[诊断与反例回执](../../../../tmp/takeover-20261101/)。

## 引擎自校验异常（不冒绿）

`ygl-trees verify self-check --json`：exit=1；environment ok，corpus skip（未提供语料），archives fail。
异常是STALE树聚合报告 `run_1fa89d0ea5d6` 与 `run_eebe9b27cb56`：原summary.error=0、overall=NEEDS-MATERIAL，重算要求error=2、overall=ERROR。
本轮精确目标的根只含PASS/FAIL子值，其单独archive verify通过；不能因此宣称全库自校验通过。
不修改已发布依赖、不手改历史报告；已将实际差异记入生命周期问题台账。

## 未完成能力与管理员一步

Workspace 4 FAIL分别是：组件不可用、无普通进程活挂载证明、无捕获到单Commit证明、无开放句柄/映射生命周期证明。
详见[ProjFS语义研究](WINDOWS-WORKSPACE-PROJFS-RESEARCH.md)：启用组件并不自动补齐适配器与稳定捕获。
需管理员在已授权提权窗口执行：

```powershell
DISM /Online /Enable-Feature /FeatureName:Client-ProjFS /All /NoRestart
pwsh -NoProfile -File D:/workspace/layerfs/tools/projfs-preflight.ps1
```

不绕过UAC、不自动重启宿主、不以物化+监听冒充既有Workspace。宿主UI、Durable均未运行；没有部署或上游PR发布。
本轮生产LOC：104392→104392（+0）；仅测试、验证工具与文档。品味判断点：无新增；以上均为契约与可复核事实，不替人仲裁。
