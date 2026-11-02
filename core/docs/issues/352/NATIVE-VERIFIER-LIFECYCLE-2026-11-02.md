# 原生验证器更新：Git关闭FAIL与只读映射观察分叶（2026-11-02）

> **Status:** Dated retained-evidence verification; informative, not a product contract, fresh runtime qualification or signed release.
> 导入2026-11-02T00:27:57.024Z，树判定00:34:05.841Z，对账读取00:38:23.633Z（UTC；Asia/Shanghai同日08:27、08:34、08:38）。

## 新结果

本轮更新验证器，不重跑Git/挂载、不改产品关闭逻辑。把Windows属性回归、原Git失败和只读映射/reopen观察加入新快照；四个历史spec原字节保留，六叶在同一快照实际重算。

| 叶 | 判定 | 通过 / 失败 | 新run |
| --- | --- | --- | --- |
| Store保留证据 | PASS | 9 / 0 | run_ab5fbf9cb065ce17 |
| 只读projection保留证据 | PASS | 8 / 0 | run_f42248319058c6c5 |
| 早期native诊断 | PASS | 9 / 0 | run_916b19fa56918a1a |
| 历史Workspace readiness | FAIL | 1 / 3 | run_5c552aff7f2688c2 |
| 新Git生命周期资格 | **FAIL** | **6 / 1** | run_2ee928000ad6373d |
| 新只读生命周期观察 | PASS | 8 / 0 | run_b109b2eec5fee0cc |
| all_pass聚合 | **FAIL** | **4叶 / 2叶** | run_ea8559c16358 |

Tree run tr_0adecc046467；frozen tree ts_d380eb1d2fe0。[汇总及每叶witness数](../../../../tmp/native-verify-77-20261102/summary.json)、[原始树报告](../../../../tmp/native-verify-77-20261102/home/verify/tree-reports/tr_0adecc046467.json)。六叶共45个witness；聚合只有子判定引用、witness0，不冒充独立证据。

**Git失败项是正常关闭未完成；单文件reopen观察成功不使Git或产品Workspace合格。** 历史Workspace的三条FAIL仍来自原时点NOT_RUN，不冒充当前完整产品实跑。没有增加“必须另交after清单”门槛。

## 新判据及原件审计

[Git七条材料](../../../../tools/verification/native-route/materials/git.md)和[AST](../../../../tools/verification/native-route/materials/git-candidates.json)核对19条Git命令、20份子命令原始JSON、两个Git版本、17文件before清单、7个对象和ignored内容、重挂载断言检查点、元数据三项Rust回归、原生Commit/UpToDate、8个未Close引用以及整体FAIL。

Git旧材料没有独立after清单。G4明确保持“原测试断言+checkpoint”层级，不伪称现在能从两份清单独立重算全文件相等；这不额外否定原测试通过的数据路径，也不是业务验收新条件。另一个固定运行的第二Commit为Committed，本轮选择的file-trace原件第二Commit是UpToDate，保留自身事实不混用。

[生命周期八条材料](../../../../tools/verification/native-route/materials/lifecycle.md)和[AST](../../../../tools/verification/native-route/materials/lifecycle-candidates.json)分开ordinary read、view先Unmap、File先Close三臂；后者仍有1个Cleanup未Close、stop作用前Busy。另一独立实验验证Busy后新读与原view读可用、owner解除后10013ms观察无Close、普通reopen的Cleanup后原token102真实Close到达、独立新stop正常detach。general_close_qualified固定0，不外推改名/解绑、并发或全内核引用清单。

[导入器](../../../../tools/verification/native-route/tools/lifecycle.mjs)只复制关闭的round-70快照到新目录，新增git_evidence/lifecycle_evidence/lifecycle_artifacts；嵌入36份原JSON与1份manifest共37份材料。每次audit逐字节重算SHA256、复用现有[handle分析](../../../../tools/winfsp-handle-trace.mjs)和[reopen分析](../../../../tools/winfsp-reopen-test.mjs)、重算全部派生行以及七张历史表。声明source/tested subtree在import时用git对象对照，未重新编译原生产品或修改来源Store。[导入清单](../../../../tmp/native-verify-77-20261102/imported/import.json)。

[原件对账](../../../../tmp/native-verify-77-20261102/summary-audit.json)确认36份源JSON、原基线和新快照均未改变。新快照SHA256 **0f4224cdb7838d7c6b15ccdb0aef3c229183a961e6109e5c5b24203627fea65a**，历史基线仍1a69b4c97d9424a4643abe9b5b7a299ec7fe8763eb9535cc61e3c01675b09593。

## 验证器自身验证

- 新[parser/audit反例工具](../../../../tools/verification/native-route/tools/lifecycle-test.mjs)：**43项通过**（真实audit1、33种回执/身份/顺序破坏、8种SQLite原件/派生/历史表破坏、源快照不变1），41种破坏均拒绝。[最终回执](../../../../tmp/native-verify-77-20261102/parser-final.json)。
- 原native分析器**37项回归通过**，未改其源码或降低断言：[回执](../../../../tmp/native-verify-77-20261102/native-parser-regression.json)。
- 新[合成fixture工具](../../../../tools/verification/native-route/tools/lifecycle-counterexamples.mjs)生成**19份**：Git9、lifecycle10；正例2，反例17。每条由固定引擎实际verify run，全部预期一致；合成Git正例只改副本资格字段以测试谓词，不能通过raw audit、不是真实Git正常关闭证明。[判据结果](../../../../tmp/native-verify-77-20261102/lifecycle-negative-results.json)。
- P1c覆盖Git7/7与lifecycle8/8，无豁免；[Git lint](../../../../tmp/native-verify-77-20261102/lint-git.json)、[lifecycle lint](../../../../tmp/native-verify-77-20261102/lint-lifecycle.json)。[作者自审](../../../../tools/verification/native-route/materials/git-reviews.json)不冒充独立盲审或人工仲裁。
- 固定引擎self-check **6环ok、0 skip**：12 canonical向量、173语料文件、2形状、44案例、15归档：[自检](../../../../tmp/native-verify-77-20261102/self-check.json)。
- meta检查通过：11spec、1orchestration、10tooling；重登记链17条、0 drift/0 break：[meta原件](../../../../tmp/native-verify-77-20261102/meta-final.json)。三份新工具按明确actor登记，没有自动刷新旧工具hash。

每次测试有显式≤120秒上限，无后台测试或超时试跑。本轮不改Rust/C++/产品实现，因此不重复跑产品构建与无关测试。Node SQLite仍打印experimental warning，如实保留。

## 归档

六个叶都包含materials与完整snapshot，六次提取逐字节相等且分别raw audit，聚合另验普通report/spec归档。[归档身份清单](../../../../tmp/native-verify-77-20261102/archives.json)、[快照字节核对](../../../../tmp/native-verify-77-20261102/archive-snapshot-bytes.json)、[全部验包与audit](../../../../tmp/native-verify-77-20261102/archive-audits.json)。

- [新Git叶包](../../../../tmp/native-verify-77-20261102/git-lifecycle-qualification.yglverify.zip)，arc_e129169fb020。
- [新映射观察叶包](../../../../tmp/native-verify-77-20261102/readonly-lifecycle-observation.yglverify.zip)，arc_07ca9d8a9612。
- 历史叶按原spec新运行新归档，不覆盖旧包；聚合归档不伪造prepare.material_id或data_source.sha256。

## 固定身份及局限

固定引擎仍是ygl-trees e5876e07a76c37ffdc6bca67823e938ce904d951本机候选，实际bundle/manifest字节由[engine-pin](../../../../tools/verification/native-route/engine-pin.json)核验；显式隔离home，未升级全局工具/变更DSH。叶spec内部0.1.0模板值与树0.118.0差异保留，实际引擎以固定入口字节为准；不是signed发行物。

来源分别为metadata d6e45c0ed、mapping ff4bd47cb、reopen 08fa9b0d3，原时间和binary不混称同一干净构建。旧Git/mapping DLL已由共享target后续构建替换：本次只能核对其保留hash间一致性，不能重验旧二进制实际字节。当前reopen的四份binary仍在，import时逐一核对。原trace Git回执没有保存完整harness hash，不能补造当时的干净seal。字节hash不保证任意生产者诚实、source-to-binary编译溯源或内核全状态。

归档后raw audit需要当前固定分析器源码；若源码hash变化会拒绝，而非偷偷用新版解释旧报告。首次调用外部meta-tooling --help返回exit2（不支持该flag）；已读其源码确认--add/--check/--audit，不改外部工具、不盲试绕过。

## 下一步

更新验证器的目标已完成，原Git任务8dc8d475a1仍doing。返回关闭实现：评估显式关闭请求中一次性、身份匹配的只读访问协调，先覆盖view活着应Busy且可读、改名/解绑/路径替换不误开对象；无证明不丢弃原custody或声称完整排空。原Windows Git整体FAIL、ApplicationVisible Unsupported、产品SDK等未合格边界不变。本轮未部署、发布版本、改权限或运行Durable/WSL产品替代路线。

Production LOC: **104682 -> 104682 (delta +0)**：Core38454、Engine63468、API2760；exact parent/staged产品子树和同一production_loc.py范围不变，工具/测试/文档不计。无产品源码搬迁或测试删除。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。本轮无新增品味判断点；after清单仅作证据局限，不自设门禁；上述未知项不作确定根因结论。
