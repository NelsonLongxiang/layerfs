# 原生验证器：真实Store只读投影独立叶（2026-11-01，第57轮）

> **Status:** Dated verification result; retained diagnostic evidence, not a writable Workspace or signed release.
> 验证时间：2026-11-01 20:55起，Asia/Shanghai；精确起止以[命令与结果汇总](../../../../tmp/native-verify-57-20261101/summary.json)及其原件为准。

## 结论

验证器已增加独立的只读投影叶，未修改已有Store/Workspace条款、未覆盖任何旧spec/run。

| 叶/聚合 | 结果 | 实跑报告 |
| --- | --- | --- |
| Store证据 | PASS，9/9 | run_08dd30728202b659 |
| Store→ProjFS只读投影 | PASS，8/8 | run_a618b1b81a69787c |
| Workspace就绪 | FAIL，1 PASS / 3 FAIL | run_8f86f1a231be6801 |
| 三叶all_pass | FAIL，2 PASS / 1 FAIL | run_675092882a71 |

Tree run：`tr_4c5c97e211a2`；冻结tree：`ts_5f6d1f832dc6`。
**只读投影不满足W2读写删改、W3稳定捕获单Commit或W4开放句柄/映射生命周期；这三项仍为NOT_RUN。**

## 本轮实际做了什么

- 新增[8条材料](../../../../tools/verification/native-route/materials/projection.md)、对应候选和作者自审、冻结spec及[三叶树材料](../../../../tools/verification/native-route/materials/tree-projection.json)。作者自审不冒充独立评审。
- [导入器](../../../../tools/verification/native-route/tools/projection.mjs)复制关闭的基线快照，嵌入result和4个原始CLI回执；核对退出码、错误、时点、二进制一致性、重复/缺失标记、根身份及字段类型，不改旧行。
- 独立audit模式重算5个原始JSON哈希及全部派生字段；从归档提取的快照也再次通过。SQL叶本身检查字段和记录存在性，不能单独认证任意生产者或恶意重写的整套证据。
- [解析/audit回归](../../../../tmp/native-verify-57-20261101/parser-audit-final.json)：19项通过，含缺案例、混合二进制、信号、错误退出、坏时点、超时、总结/原件不符、缺/重复标记、坏数字、错根、原始hash/body与派生字段篡改。另一次CLI audit通过。
- [合成反例](../../../../tmp/native-verify-57-20261101/negative-results.json)：25/25预期相符（Store 10、Workspace 5、投影10）。两个合成正例只验证检查器，不是产品能力证据；其余23个均正确FAIL。
- 固定引擎[六环自校验](../../../../tmp/native-verify-57-20261101/self-check.json)：6环ok、0 skip，12 canonical向量、173语料文件、44案例、35份归档重验通过。
- 仅复用既有本机固定引擎，未升级全局ygl、未改共享ygl源码、未改DSH、未运行WSL/Linux产品路径或Durable、未部署和创建定时任务。

## 来源与读取时间，不冒称产品重跑

本轮为**保留证据重验**，没有重新跑Store产品测试或ProjFS活挂载。

| 来源 | 固定提交/身份 | 原读取时间（Asia/Shanghai） |
| --- | --- | --- |
| Store/Workspace基线 | 194f3a6b6059aeec7705f3c22c7415b7ff9eaa9f；sha256 aa7b7c7f8edf80025659651c317ffa7438081aa21802a1d95610742765bac72b | 基线采集结束19:42:47，逐条时点在保留receipts中 |
| 真实投影 | d1fb56127f28ba572314791d5c3741ccbb90d675；exe 6e5c214baa517d2fd4c7ceca4aa8122b1417bc18d231d3896da20e73c9cdeaed | 20:26:38.573–20:26:39.159 |
| 混合事实快照 | e59c5b03652b636842200aa8d5f0d3a6ecc13283ba0dca209eb90eab92b914e6 | 20:55:17导入；21:03:02递归重验 |

来源细节及源码树/探针树/测试脚本hash在[导入清单](../../../../tmp/native-verify-57-20261101/imported/import.json)。
与本轮父提交f91f29fea比较，Store产品路径core/crates、engine/crates、api及根manifest/lock/.cargo无变化；投影src/tests/manifest/lock与d1fb56127无变化。
树不写一个会误导的单一subject.commit；每份来源保留自己的提交和原时点。提交归因是明示归因，hash不是编译溯源签名。

## 归档与复核

三个叶均包含材料和完整混合快照；解包确认快照逐字节等于原快照，并对解出的投影原件再次audit。

- [Store归档](../../../../tmp/native-verify-57-20261101/store-evidence.yglverify.zip) — arc_6de1b28d637f。
- [投影归档](../../../../tmp/native-verify-57-20261101/projection-read.yglverify.zip) — arc_79c61fb1a019。
- [Workspace归档](../../../../tmp/native-verify-57-20261101/workspace-ready.yglverify.zip) — arc_3d2efa9874b8。
- [聚合原始归档](../../../../tmp/native-verify-57-20261101/home/verify/archives/yglverify-tree-tree-group-native-delivery-v1-20261101T130302Z-r67509288.yglverify.zip) — arc_21a74de59300，仅report/spec。

[归档解包核对](../../../../tmp/native-verify-57-20261101/archive-snapshot-audit.json)；[原始聚合验包](../../../../tmp/native-verify-57-20261101/verify-original-group.json)。
四包均通过完整性验证，**不是可信签名发布物**。

## 失败与局限原样保留

1. 首次tree run误用材料中的建议ID；引擎prepare返回内容寻址ID，改用真实返回值后运行成功。[失败原件](../../../../tmp/native-verify-57-20261101/tree-run.json)保留，未改旧报告。
2. 聚合report由引擎生成，其prepare无material_id、report无data_source.sha256；分别请求材料+快照、仅快照均被拒。保留[第一次](../../../../tmp/native-verify-57-20261101/archive-native-delivery.json)和[第二次](../../../../tmp/native-verify-57-20261101/archive-group-snapshot.json)失败，交付现成合法report/spec包，并与三个含材料/快照叶包配套。不伪造字段，不修改引擎门禁。
3. 导入只认保留harness成功及原件，未再次查看历史投影目录。未访问文件未物化来自原harness的实际磁盘断言。
4. 已打开4MiB文件曾被OS预读水合，不能把4个应用读取窗口说成只驻留4个窗口；启动元数据883字节不是零I/O。
5. 只读是Store源，不是NTFS安全沙箱；本地新文件不进入Store。开放句柄/映射、稳定Overlay捕获与Save/History未在本轮实现。
6. 固定引擎仍是本机源码构建候选；未改变默认工作区的历史坏归档，不能把本隔离工作区通过外推为全局通过。
7. 额外的[meta-tooling --audit --against-git](../../../../tmp/native-verify-57-20261101/meta-git-audit.json)未通过：5个工具均报无Git历史。源码firstAddBlobOf在嵌套YGL_META_ROOT下调用git show <commit>:tools/<name>，而实际路径在tools/verification/native-route/tools/内；真实git log已确认当前提交包含新工具。该固定脚本还把首登记中间版本直接对比首提交字节，初次提交前的多次登记链需另核。普通[登记链审计](../../../../tmp/native-verify-57-20261101/meta-chain-audit.json)与verify meta通过不替代这个失败；不改外部脚本、不删历史记录、不宣称Git时序审计已绿。

## 代码与后续

Production LOC: 104392 -> 104392 (delta +0)。Core 38454、Engine 63178、API 2760。
计数器sha256 7b540142dd835c4aaaaadbd754d456e824ac25fe3033c4328f9ec192c3ceacff；`tools/production_loc.py --root <exact-export> --json`，排除测试/工具/文档；对first-parent与最终staged tree做同一范围比较。
reference absent (retired R9c; last counted 65,417 at tree 498dd1917812)。未删除测试，未移动产品代码规避计数。

下一工程项仍是任务393b3c895a：纯Windows NTFS变化的稳定捕获和开放可写句柄/映射边界，然后复用Overlay→Save→History。
本轮按最新定时请求先完成验证器更新，不将该工程项标完成，不新增进程等待或日程。
品味判断点：无新增（均为既有事实/正确性边界）；未知项如上，不作业务裁决。
