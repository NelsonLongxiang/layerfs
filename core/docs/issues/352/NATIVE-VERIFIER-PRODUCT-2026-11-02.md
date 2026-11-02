# 原生验证器更新：产品接线、受限访问及驻留实例分叶（2026-11-02）

> **Status:** Dated retained-evidence verification; informative, not fresh runtime qualification, a product contract or signed release.
> 导入2026-11-02T13:34:28.488Z，树判定13:42:08.746Z，对账13:56:45.256Z（UTC；Asia/Shanghai同日21:34、21:42、21:56）。

## 更新结果

本轮更新验证器，不重跑挂载／命令、不改产品代码。保留原六叶材料／spec和历史快照，新导入产品接线、受限访问及驻留实例原件，九叶在同一新快照实际重算。

| 叶 | 判定 | 通过 / 失败 | 新run |
| --- | --- | --- | --- |
| Store保留证据 | PASS | 9 / 0 | run_b4b67fe69f054d16 |
| 只读projection | PASS | 8 / 0 | run_cb0dc4df9ed2830d |
| 早期native诊断 | PASS | 9 / 0 | run_a6e0534e8a093ff2 |
| 历史Workspace readiness | **FAIL** | **1 / 3** | run_530c912f8f29ca58 |
| Git生命周期资格 | **FAIL** | **6 / 1** | run_07391e2e7d0d1f00 |
| 单文件只读生命周期观察 | PASS | 8 / 0 | run_60abf455d5464361 |
| 新产品runtime消费 | PASS | 8 / 0 | run_fef66cd9b705e6e6 |
| 新受限后端访问 | PASS | 8 / 0 | run_8123cc1281908a76 |
| 新驻留实例生命周期 | PASS | 8 / 0 | run_7fb5589f6a528200 |
| all_pass聚合 | **FAIL** | **7叶 / 2叶** | run_8bb98146d139 |

新tree run **tr_cde696813cf8**，tree spec **ts_b9f54a690321**。[结果汇总](../../../../tmp/native-verify-95-20261102/summary.json)、[原始树报告](../../../../tmp/native-verify-95-20261102/home/verify/tree-reports/tr_cde696813cf8.json)。九叶共69个带witness判据，聚合只引用子判定，不计为独立证据。

**新三叶仅确认各自保留实证，不能使历史Git正常关闭或完整SDK Workspace合格。** Workspace历史三条FAIL来自旧时点NOT_RUN，不抹去之后产品已实现的部分；Git原关闭FAIL仍是同一失败事实。本次没有改写旧spec、旧run、旧包或旧snapshot，原六叶摘要与新运行逐项一致。

## 新材料、原件与来源

[产品八条材料](../../../../tools/verification/native-route/materials/product.md)／[AST](../../../../tools/verification/native-route/materials/product-candidates.json)核对真实SDK Init／fork、无catalog/cursor导出、native Published Commit与SDK一条History、300023字节binary、命令两路2097183字节原输出、exit9、不隐式提交、后代持文件Busy、正常终态及八启动拒绝。

[受限访问八条](../../../../tools/verification/native-route/materials/restricted.md)／[AST](../../../../tools/verification/native-route/materials/restricted-candidates.json)核对实读restricted token/IL4096/系统随机数、四后端文件READ及ACL扩大error5、三父进程内存及token复制拒绝、argv5项、环境过滤、原exit7及明确取消1223、受限WinFsp写入与SDK读回，明确full_host_isolation与SDK qualification为0。

[实例八条](../../../../tools/verification/native-route/materials/instance.md)／[AST](../../../../tools/verification/native-route/materials/instance-candidates.json)核对原resident PID／running、两个挂载及同private desktop观察、active-close/no-autostart原测试断言、原target handle取消、checked token/desktop release、resident exit0、14实例协议／13回执／11原生control结果，并保留旧1314和原实际FAIL，不把错误变成普通权限重试。

[新导入器](../../../../tools/verification/native-route/tools/product.mjs)只复制已关闭的round-77基线到新目录，在product_artifacts中保留**145份指定原件**：140份保留JSON回执／源seal、四份精确提交的公开测试harness源码及一份导入manifest。另在三张派生表存放可复算事实；audit先调用原历史审计，再逐原件重算SHA256、事实、所有父表及不升级范围。

当前snapshot SHA256 **56211dfe4d13d129b870bf01d37245b906b2c12f272c0f37cfd8963f9967981f**；原基线仍 **0f4224cdb7838d7c6b15ccdb0aef3c229183a961e6109e5c5b24203627fea65a**。[导入清单](../../../../tmp/native-verify-95-20261102/imported/import.json)、[原件对账](../../../../tmp/native-verify-95-20261102/summary-audit.json)。

来源分别为registered 8fe5dbf90、ordinary execution eeb53b091、restricted 17d73fa42和resident 687b8b358。各自source commit／tested subtree／原读取时间和binary身份分列，不混称同一最终干净构建。import时对照Git对象和四份harness字节；只有resident当前保留binary做实际字节核对，已替换的旧native parent等仅保留其当时回执身份，不冒称还能核对当前文件。

部分活动关闭／remount／两挂载／no-autostart证明来自原公开测试assert及原PASS回执。导入器明确保留assertion字段和精确harness，不补造当时没记录的独立事件／after清单。SQL PASS检查已派生事实，不能单独认证任意生产者；归档后同样需要raw audit。没有读取真实host项目或凭证，没有调用原生程序、修改DACL、运行Durable或启动WSL替代。

## 验证器自身验证

- [原件审计控制](../../../../tools/verification/native-route/tools/product-test.mjs) **40项通过**：真实audit、30种源回执／身份／范围／生命周期破坏、8种SQLite原件／派生／历史表篡改和源snapshot不变；共38种破坏均拒绝。[最终回执](../../../../tmp/native-verify-95-20261102/parser-final.json)。
- [判据反例工具](../../../../tools/verification/native-route/tools/product-counterexamples.mjs)构建**30份独立副本**：3正例、24单条反例及3空表反例；固定引擎逐个运行，3PASS／27FAIL均与预期一致。[结果](../../../../tmp/native-verify-95-20261102/counterexample-results.json)。这些副本刻意改事实，不能通过raw audit，也不是真实产品证明。
- 三份材料P1c覆盖均**8/8、0豁免**；[产品lint](../../../../tmp/native-verify-95-20261102/lint-product.json)、[权限lint](../../../../tmp/native-verify-95-20261102/lint-restricted.json)、[实例lint](../../../../tmp/native-verify-95-20261102/lint-instance.json)。reviews是作者自审，不冒充独立盲审或人工仲裁。
- 原历史lifecycle审计**43项**及固定入口拒绝回归**4组**通过：[回执](../../../../tmp/native-verify-95-20261102/verifier-regressions.json)。不改原分析器源码，也不把历史两FAIL改绿。
- 固定候选self-check **6环OK、0SKIP**：12canonical vectors、173语料文件、2shape、44案例、19份归档重验。[自检](../../../../tmp/native-verify-95-20261102/self-check.json)。隔离工作区通过不代表默认全库或任意历史坏包通过。
- meta检查**14spec／1orchestration／13tooling PASS**：[meta](../../../../tmp/native-verify-95-20261102/meta-final.json)。3个新工具显式登记，append-only链20条、0drift／0break：[登记审计](../../../../tmp/native-verify-95-20261102/meta-lineage-final.json)。无auto-rehash、no-meta或偷偷升级引擎。

所有test/CLI执行均显式≤120秒、无后台测试或失败操作循环重放。本轮只改验证工具／材料／spec／文档，Rust/C++及产品binary未变，因此产品build/test/Clippy NOT_RUN，不重复无关活测。Node SQLite的experimental warning保留。

## 归档、验包与签名状态

九个叶各携**原材料与完整snapshot**新归档，全部提取byte-equal且逐份raw audit；聚合采用树运行生成的合法report/spec归档，不造prepare.material_id。[10份归档身份](../../../../tmp/native-verify-95-20261102/archives.json)、[10份验包](../../../../tmp/native-verify-95-20261102/archive-verification.json)、[9份快照逐字节核对](../../../../tmp/native-verify-95-20261102/archive-snapshot-bytes.json)、[9次原件审计](../../../../tmp/native-verify-95-20261102/archive-raw-audits.json)。同一resident run再次归档与原包逐字节一致：[确定性回执](../../../../tmp/native-verify-95-20261102/archive-determinism-command.json)。

- [产品runtime包](../../../../tmp/native-verify-95-20261102/product-runtime-consumption.yglverify.zip)：arc_3f12c32b5dc7。
- [受限访问包](../../../../tmp/native-verify-95-20261102/restricted-backend-access.yglverify.zip)：arc_3d2f15f60857。
- [驻留实例包](../../../../tmp/native-verify-95-20261102/resident-instance-lifecycle.yglverify.zip)：arc_581325958437。
- [总体FAIL聚合包](../../../../tmp/native-verify-95-20261102/retained-native-product-evidence.yglverify.zip)：原tree归档arc_72a780533a9e。

**验包通过不等于签名发布。** 运行时仍为engine-pin所选e5876e07源码构建候选，bundle／composition／corpus字节pin不变，reported0.118.0；未替换全局CLI。verify signature检查实际bin.cjs返回“not a sealed yglverify binary”，退出1：[原签名状态](../../../../tmp/native-verify-95-20261102/signature-status.json)。因此signed sealed候选为false，未生成密钥、未自信任密钥表或伪造Ed25519 footer。新归档是确定性完整性包，不冒称可信签名发行物。

## 本轮过程错误及修正

第一次归档脚本试图把read工具截断的单个长stdout行拼成JSON而解析失败，未进入archive调用；改读180行完整的immutable tree report。原树判定、snapshot和旧包不变，不重跑产品。

手动归档聚合时CLI默认with materials，而group没有material_id，明确失败：[原错误](../../../../tmp/native-verify-95-20261102/archive-retained-native-product-evidence.json)。读固定引擎archive源码确认，复用并逐字节复制tree已生成的正确group report/spec包；未补造字段、修改引擎或弱化验包。九个leaf此前已生成的包不重复覆盖。签名exit1是实际未sealed状态，不当程序失败重试或据此改出signed。

## 固定身份与局限

[九叶材料](../../../../tools/verification/native-route/materials/tree-product.json)明确target snapshot字节与engine0.118.0，tree_spec_version1保留其schema语义。新spec_f5da786574b9、spec_b35a181e1dd6、spec_1eb7b33fe75c逐字节保存，旧spec没有retarget。普通叶模板内部engine_version0.1.0与实际candidate0.118.0差异保留，实际执行以固定入口及bundle哈希为准，不改旧输出凑一致。

新判据共24条，冻结在新材料中。旧Workspace未跑项目、旧Git8个未Close引用仍是旧source的FAIL，不说明本轮重新对最新binary跑了完整资格。新产品runtime／权限／resident PASS同样不建立完整SDK Sandbox/Workspace dispatch、任意host confinement、所有kernel/mapping排空、普通Git资格、机器级注册或crash恢复；仅确认保留functional assert范围。

后续回到产品接线，沿已实现原生实例完成实际SDK消费，不再重复导入同样材料或重跑无变化判据。验证器本轮更新目标已完成；产品任务3b7a154bc4仍doing。旧tr_0adecc046467及六叶FAIL archives不覆盖，未来新增证明应提交新材料／快照／run。

Production LOC: **111050 -> 111050 (delta +0)**。Core38454、Engine69098、API3498不变；exact first-parent687b8b3585257db13d146468720de484ad076da9与final staged产品子树及counter对象一致，复用该精确产品快照的same production_loc.py结果；测试／工具／材料／spec／文档不计。无产品搬迁或测试删除。counter SHA2568c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。本轮无新增业务品味判断点；签名、独立审查和完整资格的未知项均不写成已证实。
