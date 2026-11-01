# 原生验证器：WinFsp诊断独立叶（2026-11-02，第70轮）

> **Status:** Dated retained-evidence verification; local pinned engine, not a product Workspace qualification or signed release.
> 本轮导入：2026-11-01T18:58:23.395Z；递归判定：19:03:44Z；最终对账读取：19:16:29Z（UTC，分别对应Asia/Shanghai 2026-11-02 02:58、03:03、03:16）。

## 结果

本轮接入已完成的原生mutation/Commit/remount、scope、并发切片和正常close，不重跑原生挂载、不改历史回执、不把诊断PASS升级为产品API支持。

| 叶或聚合 | 结果 | 报告 |
| --- | --- | --- |
| 原Store证据 | PASS，9/9，9个witness | run_428390aac3e89a8e |
| 原只读投影证据 | PASS，8/8，8个witness | run_c937072d13564593 |
| 新WinFsp诊断证据 | PASS，9/9，9个witness | run_a49470310537f065 |
| 历史Workspace readiness | FAIL，1 PASS / 3 FAIL，4个witness | run_7c909b6ed14853f4 |
| 四叶all_pass | FAIL，3 PASS / 1 FAIL | run_c3a2ddc9f9a6 |

Tree run tr_63a1eccd469d，frozen tree ts_7ea1679dc6fb；[汇总](../../../../tmp/native-verify-70-20261102/summary.json)与[原始树](../../../../tmp/native-verify-70-20261102/home/verify/tree-reports/tr_63a1eccd469d.json)。

**历史Workspace叶的FAIL是对原时点的三条NOT_RUN重新判定，不是否认后来的WinFsp局部能力。** 新叶单独记录后来实证；产品SDK Windows Workspace仍未接入，当前代码边界见[native-windows平台](../../../../api/runtime/src/platform/native-windows/index.js)。不篡改旧W2/W3/W4成PASS，也不把旧FAIL冒充一次最新产品运行。

## 新增的可执行检查

[九条材料](../../../../tools/verification/native-route/materials/native.md)与[候选AST](../../../../tools/verification/native-route/materials/native-candidates.json)分别检查：
1. 五次原生运行的host/WinFsp/Rust DLL/client身份、声明源码树与受测probe/C++身份、原始与导入时间。
2. 真Overlay变更形成两个published Commit；打开句柄跨Commit，capture保持，父子链与独立只读重开一致。
3. 新进程重挂载同Store，不re-Init，UpToDate没有新Commit，head和两份History保持。
4. 八阶段scope拒绝、原输出不变、published/frontier/History一致，保留映射差异观察。
5. capture后受控写入进入较新的active generation/revision，旧Commit固定，Install保留后续变化。
6. 正常close五次作用前Busy，拒绝后仍可I/O；释放后新请求按prepare/stop/drain/close完成。
7. 产品资格、广义并发、全kernel section枚举和ApplicationVisible保证保持未合格。
8. 快照嵌入15份原始JSON和1份manifest共16份artifact，逐字节哈希可复核。
9. 固定native源码的15项Rust回归与build/test --no-run/Clippy完成回执。

[作者自审](../../../../tools/verification/native-route/materials/native-reviews.json)明确是self-review，不冒充独立评审/人工仲裁。P1c逐字覆盖9/9，无豁免；[lint](../../../../tmp/native-verify-70-20261102/lint-native.json)和[prepare](../../../../tmp/native-verify-70-20261102/prepare-native.json)。

[导入/audit](../../../../tools/verification/native-route/tools/native.mjs)复制关闭的混合基线快照，加入native/native_artifacts表；不改原identity/preflight/receipts/projection/projection_artifacts。它检查真实保留二进制当前字节，对照原receipt并把观察放入manifest；受测源码来自明确commit与tested tree，不是当前dirty工具树。导入不是编译，hash不是signed build provenance。

缓存与正常close解析器直接复用[cache analyzer](../../../../tools/winfsp-cache-test.mjs)和[close analyzer](../../../../tools/winfsp-close-test.mjs)：仅export和CLI main guard改动。对照686f14679的函数体逐字相同，未改原实测断言、未重新跑挂载；[对账](../../../../tmp/native-verify-70-20261102/summary-audit-corrected.json)。

## 验证器自身验证

- [37项parser/audit控制](../../../../tmp/native-verify-70-20261102/parser-final.json)：正常原件1、29种跨回执破坏、6种SQLite原件/派生字段/历史表破坏，以及原快照不变1；35种破坏全部拒绝。
- [36项合成判据案例](../../../../tmp/native-verify-70-20261102/negative-results.json)：Store10、Workspace5、projection10、native11，全部预期一致；3份合成正例仅证明检查器，33份反例均FAIL。
- 原cache 11项与close 8项解析控制通过：[cache](../../../../tmp/native-verify-70-20261102/cache-parser-final.json)、[close](../../../../tmp/native-verify-70-20261102/close-parser-final.json)。
- [固定引擎self-check](../../../../tmp/native-verify-70-20261102/self-check.json)：6环全ok、0 skip；12 canonical向量、173语料文件、2形状、44案例、45份归档重验。
- [verify meta](../../../../tmp/native-verify-70-20261102/meta-final.json)通过：9个spec、1个orchestration、7个tooling；[重登记链](../../../../tmp/native-verify-70-20261102/meta-final-registration.json)14项、0 breaks、0 drift。

所有测试命令有显式≤120秒上限，没有测试超时。未运行Rust构建或原生产品测试，因为本轮未改Rust/host，仅做证据导入器、验证判据和解析器可导入包装。

## 来源、时间与固定引擎

| 来源 | 原身份与时间 |
| --- | --- |
| Store/历史Workspace | 原提交194f3a6b6059aeec7705f3c22c7415b7ff9eaa9f，原采集结束2026-11-01 19:42:47+08:00；原行保持 |
| 只读projection | d1fb56127f28ba572314791d5c3741ccbb90d675，原实跑2026-11-01 20:26:38.573–20:26:39.159+08:00 |
| WinFsp五组原生回执 | 686f146792a7e471154b6a2e93e618a544f097eb，受测树fd3063bb102e4f3d8e21a2cd96c354452f11d91f；2026-11-02 02:41:30.386–02:42:14.866+08:00 |
| 本轮导入 | 2026-11-02 02:58:23.395+08:00；snapshot SHA256 1a69b4c97d9424a4643abe9b5b7a299ec7fe8763eb9535cc61e3c01675b09593 |

[导入清单](../../../../tmp/native-verify-70-20261102/imported/import.json)保存各binary/hash/源码子树/原artifact哈希；原15份native JSON、基线快照与新快照再次对账未变。所有历史报告、旧spec/材料与失败原件保持不变。

引擎固定为ygl-trees e5876e07a76c37ffdc6bca67823e938ce904d951的本机构建候选，CLI报告0.118.0，经过[engine-pin](../../../../tools/verification/native-route/engine-pin.json)所有bundle/manifest字节核验，使用独立home和既有[launcher](../../../../tools/verification/native-route/verify/orchestration/engine.mjs)。没有升级全局引擎、回退旧CLI、构建或修改共享ygl/DSH源码。

引擎生成的普通叶spec/report内部verifier.engine_version仍是0.1.0模板值，而树报告使用0.118.0；本轮如实保留，不手改其身份字段。实际执行身份以launcher pin与命令回执为准；它并非signed发行物。

## 可携带归档

四个叶包都含materials和完整snapshot，包内snapshot与原件逐字节相等，分别解包后再次audit原件及全部派生事实：
- [Store](../../../../tmp/native-verify-70-20261102/store.yglverify.zip)，arc_25f5e057a849。
- [projection](../../../../tmp/native-verify-70-20261102/projection.yglverify.zip)，arc_e867238665d7。
- [native诊断](../../../../tmp/native-verify-70-20261102/native.yglverify.zip)，arc_12a86ef15563。
- [历史Workspace](../../../../tmp/native-verify-70-20261102/workspace-historical.yglverify.zip)，arc_e9e8649cb0a9。
- [聚合report/spec包](../../../../tmp/native-verify-70-20261102/home/verify/archives/yglverify-tree-tree-group-native-evidence-v1-20261101T190344Z-rc3a2ddc9.yglverify.zip)，arc_a688e4489e22。

[解包字节一致性](../../../../tmp/native-verify-70-20261102/archive-snapshot-bytes.json)，[native提取后audit](../../../../tmp/native-verify-70-20261102/audit-extracted-native.json)及[聚合验包](../../../../tmp/native-verify-70-20261102/archive-group.json)。这些是本地完整性归档，不是可信签名发布物；解包audit不需要旧机器路径上的二进制，但首次import需要真实保留字节，缺了会拒绝。

## 失败与未知项

1. [首次import失败](../../../../tmp/native-verify-70-20261102/import-first-command.json)：新父目录尚不存在，mkdir报ENOENT；改为创建fresh输出的父链，保留存在即拒绝，不修改输入。随后[import成功](../../../../tmp/native-verify-70-20261102/import-command.json)。
2. [一次性汇总audit失败](../../../../tmp/native-verify-70-20261102/summary-audit.json)：错误要求引擎自动生成group也有逐条witness。实读发现group只携child verdict，不具证据；修正汇总去核对4个leaf的30个witness和group引用一致性，不改report或引擎。聚合自身仍明确witness0，不作为独立能力证据。
3. 旧meta-tooling --audit --against-git的nested-root路径问题未修，本轮普通meta/链通过不消除[历史失败](NATIVE-VERIFIER-PROJECTION-2026-11-01.md#失败与局限原样保留)。未为凑绿删除审计链或改外部脚本。
4. A2A总工索证direct-7fa969af已一次回传正常close证据；route等待超时后查任务归档确认已关联交付，未重发。该回传不是独立评审通过结论。
5. SQL叶只检验派生事实，必须配套raw audit。协调伪造整套回执/manifest不由普通哈希防御；并发实证仅一次受控interleaving，close不等于完整section/cache排空。

本轮风险中档，验证工具本仓变更；无部署、外部版本发布、系统权限更改。Durable仍禁用，未运行WSL/Linux作为产品路线。

## 下一工程段

返回实现而非反复重验既有证据：原native bind仍有固定fixture BINDING/CURSOR/Branch及Workspace authority [85;32]，仅证明顺序实例。下一段优先给真实已有Store/Branch提供明确的绑定输入与独立Workspace identity，使用同一既有StoreService/Workspace，实证两个原生挂载有各自Overlay与文件引用生命周期；不复制Store、不引入第二encoder/worker、不以此自动开启产品SDK Windows Workspace。

Production LOC: 104392 -> 104392 (delta +0)：Core38454、Engine63178、API2760。exact first-parent/staged产品树及同一production_loc.py计数范围，工具/测试/文档排除；无产品源码搬迁、无测试删除。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。本轮品味判断点无新增：诊断证据与产品资格分层遵循明确任务要求；未验证项如上，不作人工裁决。
