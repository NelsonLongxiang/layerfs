# Windows产品接线：文件与目录kernel Open（2026-11-02）

> **Status:** Implemented shared product components consumed by Windows diagnostics; not product SDK Windows Workspace support.
> 最终Git回归2026-11-02T03:15:34.833Z–03:15:38.942Z，对账读取03:19:54.891Z（UTC；Asia/Shanghai同日11:15、11:19）。不是性能测量。

## 已实现

[StoreOperation::kernel_open](../../../../engine/crates/layerfs-store-service/src/store/kernel_open.rs)将文件OPEN与目录OPENDIR接到已有Workspace/Overlay原子visit。输入是已由该kernel mount引用的serial、请求身份及类型/写能力，不重走路径、另取lookup引用或自行执行权限策略。Windows文件系统仍负责已授予的访问权限。

Lookup与Open共用一份私有[原子观察与事实补给循环](../../../../engine/crates/layerfs-store-service/src/store/kernel_observation.rs)，删除重复实现。只有成功、effect-free且无descriptor candidate的Needs观察才继续；不可变事实在Overlay锁外补给。失败或未知完成只返回一次，既不重放也不猜补偿。原公开KernelLookupCause保留为同一原始边界类型的别名。

KernelOpened包含inode、File/Directory类型化descriptor、原始成功观察及StoreOperation作用域。采用descriptor前核对请求类型、serial、engine/mount和文件写能力。Lookup、Open及Close各自独立：丢弃Rust回执不Close，FORGET不Close，文件失去名字后仍可通过保留的lookup按serial打开；文件/目录的终止继续使用原显式kernel Close端口。

KernelOpenFailure保留mount、request、serial、请求类型、原失败边界、最后观察及provider/backing作用域。失败事务中的candidate仅是证据，不能采用或猜测关闭。确定语义拒绝要求Ok(None)、Refused且无candidate；[Windows适配](../../../../tools/projfs-probe/src/native_overlay.rs)仅在这个确定拒绝分支释放自己取得的lookup，其余失败保存至Session并阻止新准入及正常关闭。

本轮没有新增依赖、encoder、数据库、worker或产品对tools的依赖；没有改变Content格式、Overlay schema、Store配置或原native Close实现。[架构说明](../../architecture/73-native-read-custody.md#store-backed-kernel-open-and-opendir-composition-2026-11-02)、[消费端说明](../../../../tools/projfs-probe/README.md#product-file-and-directory-open-composition)。

## 验证结果

| 范围 | 实际结果 |
| --- | --- |
| 新产品Open直接测试 | 3 PASS：lookup/open独立及孤儿文件、目录FORGET后独立descriptor与类型拒绝、foreign/revoked/无lookup引用拒绝与健康sibling |
| 原产品Lookup直接测试 | 3 PASS，公开cause别名及确定拒绝语义保留 |
| 原生适配Rust回归 | 16 PASS：Overlay8、binding3、coordination3、metadata2 |
| StoreService产品回归 | 12 PASS：kept plans、kernel guard、backing、root batches、volume路径、ACL与容量错误 |
| WinFsp消费链 | 嵌套读写/目录/rename/rmdir、两Commit、同Store重挂载、普通Close和双挂载隔离PASS |
| 普通Windows Git | 19条Git命令加1 setup退出0，17文件before/after一致，两provider正常Close并exit0 |
| 静态检查 | 969个产品文件扫描PASS；36项边界守卫自测PASS；root StoreService及probe all-target Clippy -D warnings、fmt通过 |

新[测试源码](../../../../tools/projfs-probe/tests/product_kernel_open.rs)直接调用真实StoreService/Workspace/Overlay端口，使用既有合成Store夹具而非诊断Session。文件测试在unlink后由仍持有lookup的serial再Open，FORGET后仍读写已开文件，验证readonly写入被拒绝；关闭writable句柄后剩余readonly孤儿仍读到已发表内容。目录测试丢回执、FORGET后仍能使用原目录descriptor，最终明确Close。无内核挂载的产品端口测试不能替代所有真实平台映射场景。

[6项直接测试](../../../../tmp/native-product-open-20261102/product-tests-first.json)、[16项适配回归](../../../../tmp/native-product-open-20261102/rust-final-command.json)、[12项产品回归](../../../../tmp/native-product-open-20261102/service-final-command.json)、[native](../../../../tmp/native-product-open-20261102/native-final-command.json)、[普通Close](../../../../tmp/native-product-open-20261102/close-final-command.json)、[双绑定](../../../../tmp/native-product-open-20261102/binding-final-command.json)。共34项Rust测试，不把native场景重复计入单元测试数。

Git回归使用已有显式协调关闭入口；原host不重建，Rust消费者已改用新产品Open。首次Cleanup/Close为1647/1647、第二次740/740，无取消及unknown保留失败。[Git结果](../../../../tmp/native-product-open-20261102/git-final/result.json)、[before](../../../../tmp/native-product-open-20261102/git-final/before.json)、[after](../../../../tmp/native-product-open-20261102/git-final/after.json)、[逐项对账](../../../../tmp/native-product-open-20261102/summary-audit.json)、[汇总](../../../../tmp/native-product-open-20261102/summary.json)。普通stop和历史FAIL、验证器历史目标均不改。

Rust1.85.1 offline/locked，先test --no-run，再执行显式不超过120秒的选定测试；无后台测试或自动重试。[初次root构建](../../../../tmp/native-product-open-20261102/build-first-collected.json)、[完成状态](../../../../tmp/native-product-open-20261102/build-first-complete.json)、[root严格检查完成](../../../../tmp/native-product-open-20261102/product-build-complete.json)、[消费端最终构建与检查](../../../../tmp/native-product-open-20261102/build-final.json)、[最终完成状态](../../../../tmp/native-product-open-20261102/build-final-complete.json)、[边界守卫](../../../../tmp/native-product-open-20261102/guard-final.json)。部分job输出分次收集，完成状态不补造已消费stdout。

## 身份与局限

父提交0dbdee4657e39a6e9c3056fc521ebc0d0ee2bd28；封版受测tree41a5dc4072c01fb52b5985670cba4493a03a146b，后续仅加入报告。StoreService subtreecb432cde9f9d56df78632e4e4fd1b94c43485ed7；probe subtree9f7e1021ab8d32a3edae4499668e2fa0f7df90f2。

| 实跑binary | SHA256 |
| --- | --- |
| 沿用host | bae2aa4bf8f68726c7859ae383b67db433fd965906fd39de93df3867446a7bf1 |
| WinFsp DLL | 94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3 |
| 新Rust bridge | 2e263faf64042212185b162483e8df493184e919bcc64ec679ac0d6b51979583 |
| 新client | 0f2d60bea437d07bfe359cab9ee067ca6e813f6ac7a98742ca896b824149741c |
| Git launcher | 851535ccc041bed536a23b17200cd51e7b06e266a527f4eaf8338b5c256c6466 |

Hash核对证明保留字节一致，不是签名编译溯源；Git launcher不认证安装目录所有helper。源码首次/最终检查均通过；本轮没有失败治疗后放宽断言、测试删除或依赖变更。scheduled上下文中的create_goal被host拒绝为非人工顶层请求，未重试；不影响原在途工程任务。

未注入未知事务完成或provider失败，没有声明这些分支具备全部端到端资格。Linux daemon/FUSE完整运行及既有平台限定测试本轮NOT_RUN；未因Windows上的局部PASS抹掉历史编译/工具平台失败。该Open端口不是任意kernel引用排空、可写映射同步或崩溃恢复保证。

## 接线状态与下一步

产品任务3b7a154bc4保持doing。Lookup与文件/目录Open现在由共享产品组件完成，真实Windows回调消费；read、Close和mount生命周期仍使用既有端口及诊断编排。本轮不改变SDK Windows Workspace/Sandbox/Exec的Unsupported。

下一段应沿现有BoundWorkspace/StoreOperation推进可复用的mount owner或读窗口/释放组合，明确请求、descriptor、base/provider及终止drain的归属，减少诊断私有控制；不要只重复迁移无消费包装或只删Unsupported。不恢复host-mediated Store，不从产品include工具源码；全部Store仍显式Disposable/WAL/OFF，无Durable或WSL替代。

Production LOC: **104842 -> 105081 (delta +239)**；Core38454不变，Engine63628→63867（StoreService10588→10827），API2760不变。相同[production_loc.py](../../../../tools/production_loc.py)对exact first-parent和受测暂存树的git archive导出计数，[before](../../../../tmp/native-product-open-20261102/loc-parent.json)/[after](../../../../tmp/native-product-open-20261102/loc-staged.json)。新增产品Open及共享观察完整计入，工具/测试/文档排除；没有范围搬迁或生产语义移出计数。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。本轮无新增品味判断点；所有未验证资格如上。
