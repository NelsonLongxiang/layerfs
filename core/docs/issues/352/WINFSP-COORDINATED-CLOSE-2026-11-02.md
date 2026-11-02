# 原生协调关闭与Git全流程（2026-11-02）

> **Status:** Dated diagnostic implementation and verification; not product SDK Windows Workspace support or general kernel-section qualification.
> 最终Git活测2026-11-02T01:23:44.918Z–01:23:48.520Z，证据对账01:32:25.129Z（UTC；Asia/Shanghai同日09:23–09:32）。不是性能测量。

WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos.
[WinFsp repository](https://github.com/winfsp/winfsp)。沿用已授权安装，无重装、重启、driver/系统配置、第三方或DSH源码改动。

## 结果

**新显式协调关闭入口下，合成原生Git全流程PASS，两次挂载均正常退出，无进程取消。** 19条Git命令（另1条Store setup）完成init/add、两次Git commit、status、fsck、check-ignore及show。LayerFS Published Commit后同Store新进程重挂载，17文件before/after独立清单逐条一致，包含index、objects、refs与ignored内容。

| 挂载 | Cleanup / Close | 结果 |
| --- | --- | --- |
| 第一次 | 1654 / 1654 | 无剩余candidate；prepare/drain/detach，provider exit0 |
| 第二次 | 740 / 740 | 8个旧只读token逐一身份匹配访问；真实Close完成，provider exit0 |

[完整结果](../../../../tmp/native-coordinate-20261102/git-final/result.json) · [before](../../../../tmp/native-coordinate-20261102/git-final/before.json) · [after](../../../../tmp/native-coordinate-20261102/git-final/after.json) · [命令退出](../../../../tmp/native-coordinate-20261102/git-final-command.json) · [汇总及原token清单](../../../../tmp/native-coordinate-20261102/summary.json)。

原token519/598/774/775/778/820/821/824都收到真实Close，不手工删Rust owner。首次LayerFS Commit为128ba8d5419ba2a73814a9dbda4844ab02fdace1923e57d7f45d9c1213ca3be664，第二次请求实际UpToDate，不新增Commit；两个Git版本不变。首次provider有22次rename（含Git lock替换），两次errors0。数据checkpoint写于第二次LayerFS请求/最终关闭之前，其中normal_close_qualified=false仍保留原时点；最终normal_close_complete=true见完整结果。

## 实现及边界

[Session协调](../../../../tools/projfs-probe/src/native_coordination.rs)与[host](../../../../tools/winfsp-probe.cpp)新增独立的stop-coordinate操作。普通stop不自动选此路线，原作用前Busy语义不变。第一次Busy请求消费一次，owner释放后可发不同的stop-coordinate-after-release，不重放旧请求。

- Cleanup只记事实；Close仍是原OpenFile、directory与lookup所有权的释放依据。handle保留serial、路径提示和write/attributes/delete-control权限。
- 准入只接受已Cleanup、有名字的只读文件；Commit/capture/未知结果、目录、未Cleanup、可写或delete-control引用均作用前Busy。短暂准入挡住命名、普通变更及新写权限打开，允许read和真实Cleanup/Close。
- 固定token上界按BTreeMap游标流式遍历本次原handle；新只读打开不加入本次pass。rename按组件更新路径提示，unlink/替换失效旧提示。每个candidate通过现有Workspace解析确认当前serial，失配不访问。
- 文件API在Session mutex之外执行：readonly OPEN_EXISTING，核对volume marker和file index，拒绝directory/reparse，读最多1字节并关闭临时handle。不显式flush、不假notify、不强制foreign Unmap、不提前释放旧owner。
- 每个candidate每请求仅访问一次。十秒readiness只等真实Close及正在完成的Close回调；Busy恢复可逆准入，成功原子prepare再走已有stop/drain/detach/Overlay-close。十秒不是单个同步Windows调用的取消/延迟保证。

路径提示维护为open-state线性扫描，不是全树扫描；大规模open-state成本尚未测量。不能把一次访问或计数0当通用kernel引用盘点。此代码仍是独立、非发布native诊断，不挪作已交付SDK产品实现。

[使用说明](../../../../tools/projfs-probe/README.md#explicit-identity-checked-coordinated-close)。Git测试明确选择LAYERFS_NATIVE_COORDINATED_CLOSE=1；默认分支仍使用原stop。新实现不改变历史测试默认含义。

## 验证

- 三个WinFsp场景均PASS：普通readonly view；目录移动并在旧路径创建新对象；mapped-source删除被拒绝后继续读。live view下协调Busy、原view与新read均可用；owner主动Unmap后独立新请求接收真实Close并正常卸载。[plain](../../../../tmp/native-coordinate-20261102/plain-final/result.json)、[rename](../../../../tmp/native-coordinate-20261102/rename-final/result.json)、[delete-refusal](../../../../tmp/native-coordinate-20261102/delete-refusal-final/result.json)。
- 成功unlink/同名替换失效、目录移动、写/delete/目录引用、Commit/capture、foreign token和恢复由[三项Rust定向测试](../../../../tools/projfs-probe/tests/native_coordination.rs)覆盖。kernel映射源unlink返回EPERM，不能声称已完成kernel解绑/替换场景。固定[WinFsp删除处置](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/sys/fileinfo.c#L1539-L1570)有映射/readonly检查，本轮未在kernel中唯一归因EPERM，未改其策略。
- **23项Rust测试PASS**：coordination3/binding3/metadata2/Overlay8/range5/Saved2。[前8项](../../../../tmp/native-coordinate-20261102/rust-final-command.json)、[后15项](../../../../tmp/native-coordinate-20261102/rust-remaining.json)。**33项审计控制PASS**：三个场景各真实1+十种破坏，拒绝假身份、假恢复、提前Close、无Unmap、取消或超时假成功。[原件](../../../../tmp/native-coordinate-20261102/audit-controls-command.json)。
- 存续native嵌套变更/Commit/重挂载、普通close、双绑定、capture后并发、cache八阶段均PASS：[native](../../../../tmp/native-coordinate-20261102/native-regression.json)、[close](../../../../tmp/native-coordinate-20261102/close-regression.json)、[binding](../../../../tmp/native-coordinate-20261102/binding-regression.json)、[concurrent](../../../../tmp/native-coordinate-20261102/concurrent-regression.json)、[cache](../../../../tmp/native-coordinate-20261102/cache-regression.json)。cache仍报告mappingGap，不升级保证。
- Rust1.85.1 offline/locked，先test --no-run后有界执行，build/Clippy all-targets -D warnings/fmt成功；[完成回执](../../../../tmp/native-coordinate-20261102/build-complete.json)。job最终读取为已消费空流，状态与命令保留，不补造stdout。MSVC /W4 /WX成功，[host元数据](../../../../tmp/native-coordinate-20261102/host-final-identity.json)来自成功工具输出并[重核hash](../../../../tmp/native-coordinate-20261102/host-identity-check.json)。

## 固定身份与失败保留

父提交641394af0b3ddc9ad162fae3805fcd46bea81154；封版受测tree aef6742e0e6b13cfc13f21756962d296d9a005f9，后续只加文档。probe subtree64400cb00eac143607f0fd2093ae56e341317d8c，host blob72b9e6b82969cd00a59138473599b64aebc2e772。

| 实跑binary | SHA256 |
| --- | --- |
| host | bae2aa4bf8f68726c7859ae383b67db433fd965906fd39de93df3867446a7bf1 |
| WinFsp DLL | 94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3 |
| Rust bridge | 3de05f8e88820b7a565312c78102b5f8d72de99a27f763aa041899059210253e |
| client | 0b90866033ff38e223f80c6984cbe90be6d26fcd2f227f53d65ff36c2e5c254a |
| Git launcher | 851535ccc041bed536a23b17200cd51e7b06e266a527f4eaf8338b5c256c6466 |

[汇总字节/manifest审计](../../../../tmp/native-coordinate-20261102/summary-command.json)。hash不是signed source-to-binary attestation；Git launcher不认证全部helper。全部为新合成Store/测试仓，Disposable/WAL/OFF，不碰用户仓、Durable或WSL替代路线。

首次live的provider正常结束，但audit缺inventory而FAIL：[原失败](../../../../tmp/native-coordinate-20261102/live-first-command.json)。补真实日志后重验，没放宽断言。首次unlink-replace探索在unlink即EPERM：[原失败](../../../../tmp/native-coordinate-20261102/unlink-replace-first-command.json)，其后单独记录delete-refusal，不把原解绑实验抹绿。文档NUL编辑被工具拒绝，已用先读全文后write清除6个NUL；无二进制源码替换。

## 完成与后续

合成原生Git任务8dc8d475a1已达到操作、LayerFS Commit/同Store重挂载、显式正常关闭的范围。**这是新协调操作下的新PASS，旧普通stop的FAIL、历史readiness与六叶验证器总体FAIL原件不改。**

[SDK native-windows平台](../../../../api/runtime/src/platform/native-windows/index.js)仍是Store-only；本轮未实现Workspace/Sandbox产品接线。下一段按真实SDK/engine归属梳理mount/status/Commit/unmount接口与所有权，再推广适配，不另造worker或encoder。可写映射同步、完整kernel引用、kernel成功解绑映射、广义并发/崩溃恢复仍未合格。

Production LOC: **104682 -> 104682 (delta +0)**；Core38454、Engine63468、API2760。exact first-parent/final-staged产品子树与同一production_loc.py方法不变；本轮诊断/工具/测试/文档排除，无测试删除或产品实现搬迁。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。本轮无新增品味判断点；EPERM归因、通用排空与产品接线不确定性明确保留。
