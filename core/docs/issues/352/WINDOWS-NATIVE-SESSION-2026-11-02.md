# Windows产品逻辑Session与原生消费接线（2026-11-02）

> **Status:** Dated implementation checkpoint; not release evidence or a released product contract.
> 最终Git运行2026-11-02T06:58:52.512Z–06:58:56.794Z，原件对账07:02:46.586Z（UTC；Asia/Shanghai同日14:58、15:02）。无性能测量或完整SDK就绪声明。

## 实际交付

产品[daemon::native::Session](../../../../engine/crates/layerfs-daemon/src/native/session.rs)现在拥有显式Store绑定、BoundWorkspace、逻辑KernelMount、产品MountRequests、原生文件/目录句柄与lookup归属、Commit准入、协调状态和终止编排。它调用已有StoreService、StoreOperation lookup/Open、Workspace mutation/read、CapturedNamespace和原Commit pipeline，不另建encoder、数据库、worker或文件系统语义。

[Binding](../../../../engine/crates/layerfs-daemon/src/native/binding.rs)显式接受catalog/cursor/Branch/Workspace身份；[一次启动](../../../../engine/crates/layerfs-daemon/src/native/startup.rs)只打开已有绝对Store并认领新绝对work目录，限制owner DACL，拒绝缺失Branch及受保护main，执行既有有界root bind和kernel关联。BindFailure记录原phase/cause/intent及已初始化owner。没有authority默认、Store导入/复制或重放；失败或live Session被丢弃时保留完整state，不猜revoke/rollback/删除。部分上游接口原本只返回String，产品保持其原文本，不冒称恢复了不存在的底层typed cause。

[状态和终止](../../../../engine/crates/layerfs-daemon/src/native/lifecycle.rs)提供实际绑定、frontier、请求、句柄、发表次数、协调/准入/终止标记。Status是逻辑观察，不是WinFsp Ready或全section清单。正常关闭在descriptor、capture、Commit、协调、请求或保留失败存在时拒绝Busy/Unknown，不改变有效文件系统；成功后挡新请求。外部原生host必须先真正drain/detach，才可调用finish_after_native_drain：产品核验请求finish，逻辑revoke，再close/retire Overlay和Store。这个safe Rust方法不能认证调用方满足了OS precondition；失败终止不可重放。

[CommitWork/Completion](../../../../engine/crates/layerfs-daemon/src/native/commit.rs)将一次原始构造移出Session bookkeeping mutex，结果只能交回原Session。已知成功返回含原CommitSuccess、installed snapshot/frontier的CommitReceipt，失败/panic/foreign completion及published-but-retained结果保持原始所有权。未消费completion被丢弃时保留整个result和provider，不猜disposal。ApplicationVisible仍作用前Unsupported；Published不代表Windows缓存/section中的全部修改。

[WinFsp诊断消费者](../../../../tools/projfs-probe/src/native_overlay.rs)已实际使用产品Session，删除原私有Commit、close、metadata、coordination及句柄/文件系统编排。只保留fixture、bootstrap frame、独立capture/history读回与日志；[FFI](../../../../tools/projfs-probe/src/windows/overlay_ffi.rs)继续是诊断边界，没有新产品Rust unsafe模块。[架构](../../architecture/68-native-workspace-control.md#native-windows-logical-session-2026-11-02)、[消费端说明](../../../../tools/projfs-probe/README.md#product-native-rust-session)。独立诊断增加已有第一方daemon依赖，锁文件只增加这个包及该边，不更新registry版本。

## 验证

| 范围 | 最终实际结果 |
| --- | --- |
| 直接产品Session | 5 PASS：绑定/status/Commit/孤儿/终止，活动request Busy及独立Session，精确bind失败，无效mount原typed失败保管，live owner丢弃不删Overlay |
| 保留的原生Rust测试 | Overlay8、coordination5、binding3、metadata2，共18 PASS；加直接5项共**23项Rust PASS** |
| 实际WinFsp | 嵌套mkdir/read/write/list/rename/rmdir、两Commit、同Store新挂载和UpToDate通过 |
| 并发Commit | capture固定、ordinary callbacks继续、Install保留后写及新建、第二Commit与独立读回通过 |
| 普通Windows Git | 19条Git命令加1 setup全部exit0，17文件before/after清单相等，两次挂载正常关闭 |
| 独立绑定/关闭 | 同Store同时挂载、本地变更隔离、合并历史、独立终止、新挂载读回及普通Busy可逆关闭通过 |
| 构建/静态 | Rust1.85.1 offline/locked，test --no-run先行；root daemon --lib及probe all-target Clippy -D warnings、fmt；989文件扫描、37守卫和23计数器测试通过 |

[直接测试源码](../../../../tools/projfs-probe/tests/product_native_session.rs)调用真实公开产品类型而非diagnostic Session。[13项产品/Overlay测试](../../../../tmp/native-session-20261102/session-final-tests.json)、[10项协调/绑定/元数据测试](../../../../tmp/native-session-20261102/coordination-final-tests.json)、[最终构建/严格检查](../../../../tmp/native-session-20261102/final-build-collected.json)、[守卫](../../../../tmp/native-session-20261102/guard-final.json)。保留测试未删、不改断言凑绿；所有运行显式≤120秒，编译与执行分开，没有后台测试。

[原生](../../../../tmp/native-session-20261102/native-final/result.json)及[同Store重挂载](../../../../tmp/native-session-20261102/native-final/second/result.json)、[并发Commit](../../../../tmp/native-session-20261102/concurrent-final/result.json)、[Git](../../../../tmp/native-session-20261102/git-final/result.json)、[before](../../../../tmp/native-session-20261102/git-final/before.json)/[after](../../../../tmp/native-session-20261102/git-final/after.json)、[双绑定](../../../../tmp/native-session-20261102/binding-final/result.json)、[普通关闭](../../../../tmp/native-session-20261102/close-final/result.json)。[汇总](../../../../tmp/native-session-20261102/summary.json)、[对账程序](../../../../tmp/native-session-20261102/reconcile.mjs)、[对账回执](../../../../tmp/native-session-20261102/summary-audit.json)。

最终Git接收/完成9577/9577、4438/4438个Workspace ABI回调，Cleanup/Close1637/1637、741/741；双绑定37/37、52/52、27/27，普通关闭181/181，并发Commit71/71，全部exit0、active0/retained0。原host native drain/detach先发生，产品finish成功后输出NATIVE_REQUESTS_DRAINED、OVERLAY_CLOSED，再释放provider。注意：本轮NATIVE_REQUESTS_DRAINED是finish返回后的观察标记，不是内部revoke时刻；source在revoke前检查requests.finish，不能仅靠日志顺序证明内部全部边界。

## 原始失败和修复

1. 原Windows daemon library基线因无条件Unix config API编译失败：[原件](../../../../tmp/native-session-20261102/daemon-baseline-collected.json)、[完成状态](../../../../tmp/native-session-20261102/daemon-baseline-final.json)。保留原Unix实现，增加平台cfg与[明确Unsupported的非Unix读取器](../../../../engine/crates/layerfs-daemon/src/application/config_unsupported.rs)，没有降级进程保护或把Linux配置格式冒充Windows部署。library已构建；独立Windows服务/启动器未实现。
2. 消费端迁移的返回类型、缺HistoryCatalog trait及String不实现Error导致编译失败，原件分别为[首次consumer](../../../../tmp/native-session-20261102/consumer-first-build.json)、[trait边界](../../../../tmp/native-session-20261102/consumer-corrected-build.json)、[String边界](../../../../tmp/native-session-20261102/consumer-strict-build.json)。按原API修正，String保留原文，typed错误保留source。
3. 直接测试发现kernel失败虽被Session保存，返回错误却只剩文字：[失败](../../../../tmp/native-session-20261102/product-and-overlay-tests-first.json)。将lookup/Open原failure转换为共享Arc，Session和caller保管同一原对象，typed source断言保持；[修复后](../../../../tmp/native-session-20261102/product-and-overlay-tests-fixed.json)。
4. 协调测试发现诊断capture迁移后绕过了协调准入：[失败](../../../../tmp/native-session-20261102/rust-regressions-first.json)。产品status暴露真实coordinating标记，诊断在同一Session锁内先核准入；[最终10项回归](../../../../tmp/native-session-20261102/coordination-final-tests.json)保持原断言全部通过。

未知状态首cause被Session保留，后续准入与释放重放被挡；kernel/Open、Commit等完整原始证据保管未被string替换。没有注入所有Store/maintenance/close/panic故障；对这些分支仅说明source保管设计，不声称全部端到端资格。观察接口/公开StoreOperation仍要求调用方遵守服务锁和生命周期，没有将此类型当成安全隔离边界。

## 身份和计数

父提交0448f83183063d8593ff618246a8600176f0b57d；封版受测treeabd9f5e488097955f1a04efc0f8758196da448f5，daemon subtree9a8fed623ce4d08f35648a8c8697648b04c5ef48、probe subtreeaa72153d91ddddb19321073069b216b7d9820d08。此后仅加入本报告。沿用host SHA256 b0eb967cb3597004e83824ba385af8e8fe4829da23ab2ddce5916d3638885455及WinFsp94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3；新bridge453ea9d77083edb265a80aceedbc3816798b751cbaf29d6deabf48490ed8d626、client981452c120bbcea1a6a862183c33c630eebe24329762750eb65f5636ba7b9667。Hash是字节身份，不是签名编译证明。C++产品和host源码均未变，没有重新构建其binary。根manifest/lock和vendor、SDK JS/API/Node均未修改。

Production LOC: **105907 -> 107685 (delta +1778)**；Core38454不变，Engine64693→66471（daemon6208→7986），API2760不变。相同[production_loc.py](../../../../tools/production_loc.py)对exact first-parent和final-tested git archive计数：[before](../../../../tmp/native-session-20261102/loc-parent.json)/[after](../../../../tmp/native-session-20261102/loc-staged.json)。诊断Session真实编排升格产品范围与新增失败custody完整计入，不是算法简化、范围搬出或重复实现长期共存；四份旧工具实现删除，测试不删。counter SHA2568c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3；工具/测试/文档排除。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。

## 仍在途

任务3b7a154bc4继续doing。产品安全Rust Session、产品C++挂载owner和回调已通过诊断ABI真实组合；仍没有正常打包/启动的独立Windows产品native服务、鉴权IPC/注册或SDK mount/status/Commit/unmount/Sandbox/Exec入口。禁止只删Unsupported或从产品include工具代码。多Session直接产品测试在同Rust进程运行，实挂载双绑定仍是独立provider进程，不声称同进程多ABI实例。

下一段需把产品Session与C++owner/callback接成正常native provider/host和服务控制入口，复用已有产品实现及边界；诊断夹具和捕获/历史验证不入产品。finish_after_native_drain的OS precondition须由真正host owner证明，路径、process/目录存在和count0不是Ready/任意内核排空。完整mapping同步、成功解绑kernel场景、广义并发/crash仍未合格。全Store显式Disposable/WAL/OFF，未改DSH/系统/driver/第三方源码或配置。

本轮无新增品味判断点。3081资源协调已一次回复可按对方既有授权借用并保留历史sessions，本轮LayerFS原生验证不依赖3081；未自行操作其profile、重启host或触碰3080。
