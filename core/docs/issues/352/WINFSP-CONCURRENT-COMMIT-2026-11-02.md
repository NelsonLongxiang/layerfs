# 原生published Commit与capture后文件变更交错（2026-11-02）

> **Status:** Implemented diagnostic Commit ownership split and deterministic native interleaving proof; not unrestricted concurrency or full product Workspace qualification.
> 最终活证：2026-11-01T18:13:44.363Z–18:13:44.917Z（UTC；2026-11-02 02:13:44，Asia/Shanghai）。

WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos.
[WinFsp repository](https://github.com/winfsp/winfsp)。使用此前授权安装，不重装、不重启、不修改第三方/DSH或产品源码。

## 已交付结果

**长Commit构造/Save/History不再占用整个诊断Session mutex。Commit完成capture后，普通Windows文件回调能完成写入和新建；第一次Commit固定旧内容，已知Install保留后续活跃状态，第二次Commit收进后续变化。**

不是把整个Session裸放并发：ordinary callback和短控制仍串行，只有持有独立所有权的长Commit离开该锁。scope=Published仍是已发布frontier；ApplicationVisible仍在作用前Unsupported，缓存/映射差异未被抹掉。

| 本机最终阶段 | 核对结果 |
| --- | --- |
| Commit admission | 一个CommitWork持有bound Workspace、before snapshot和request token；重复Commit、额外capture、terminal close均Busy |
| 产品driver已capture | captured generation1、revision2，active generation2；Commit worker仍未完成 |
| lane尚未释放时普通Windows操作 | 同一打开文件before commit→during commit，新增late-during.txt=new generation；全部调用已返回，Overlay revision2→5 |
| 释放公开Store publication lane | 此后第一次Commit完成，scope=published、via=Workspace |
| 第一次不可变Commit | concurrent.txt=before commit；late-during.txt不存在 |
| 已知Install后的活跃视图 | 同一描述符仍读到during commit，新建文件仍可见，没有回滚后续写入 |
| 下一次写入与Commit | 同一描述符写after! commit，第二次Commit保存该值及new generation；旧Commit不变 |
| 收尾 | UpToDate不新增；handles0、Overlay已关闭；owned mount移除；两个子进程exit0 |

[原生完整回执](../../../../tmp/native-concurrent-20261102/live-final/result.json) · [交错核对](../../../../tmp/native-concurrent-20261102/live-final/interleaving.json) · [独立只读History重开](../../../../tmp/native-concurrent-20261102/live-final/reopen.json)。

普通写入段在18:13:44.703Z–18:13:44.734Z完成，lane-holder到18:13:44.740Z才退出。主断言不是比较时间差，而是controller确认lane-holder仍活跃且尚未发release标记，host同时确认captured generation不变、revision增长、Commit worker未完成。时间仅辅助溯源，不是性能结果。

实际Commit：
1. 1281fea7a2207cb8ae4857695058cab7327d96fb0ea5c0f78eb57995b4477600c1；root5e481c28f44eda377f157b00d0d926e374559699134edb663276212897cf13ed；保存476字节。
2. 126aae747569ba5833e1a2656bd23ca2b1e6d008906c629cb8919d184ed3719595；rootd8156235ef73f368383aa43142590ce4a023f60db33dd7e59463494c538baf99；保存523字节；parent=Commit1。
最终callback：create2/open10/read8/write4/rename0/cleanup12/close12/delete0/error0。这一用例不靠rename/delete，原有目录/双挂载回归另跑并保留。

## 所有权拆分

[CommitWork/CommitCompletion](../../../../tools/projfs-probe/src/native_commit.rs)从原Session commit方法移出，职责为：
1. begin_commit在Session锁内校验scope、独立capture、已有pending或retained结果，记录一个token。
2. CommitWork移动给单个worker，消费一次，调用**未改动的公开BoundWorkspace::commit_captured**；文件handle表仍归Session，不复制或移动到worker。
3. CommitCompletion持有原始成功、失败或panic payload；只有相同bound pointer与token的Session能settle。成功核对并本地Install确认后清pending；错误保存原始custody，不自动重放或猜清理。
4. worker已完成但结果还没交回时，第二Commit/capture/terminal close仍Busy。错投completion保留在接收方，原方仍保留pending；丢弃尚未run的work不隐式取消admission。

[FFI](../../../../tools/projfs-probe/src/windows/overlay_ffi.rs)只在准入/settlement持Session锁，长Commit在锁外。若其它callback已触发未知失败锁存，正常call不再接受settlement，则把原completion保留到Session；锁已poison或Session不可取得时保守保留值而非丢弃。panic和异常退出恢复路径未作故障注入证明。
[原生host](../../../../tools/winfsp-probe.cpp)新增一个诊断Commit worker，正常线程回调继续被服务。它不是额外的并行内容构造worker，也不是全局Store多writer路线。

## 确定性交错如何建立

[guarded lane-holder](../../../../tools/projfs-probe/src/commit_hold.rs)只用于试验：打开既有Disposable Store，使用HistoryCatalog::publish_lane公开端口暂持已有写入许可，最长15秒；不创建History记录、不修改产品实现或加测试钩子。writable open仍有正常setup和writer-lane成本，不能说“完全无IO/无写事务”。

产品driver的capture先于后续Store保存/发布。我们从公开Overlay state观察captured字段非空，而不是通过固定sleep猜阶段；因为Store lane仍被另一个线程/进程持有，该Commit尚不能完成发布。普通文件变更只经真实Overlay路径，且本fixture使用已有权威serial预留，没有新增inode refill的Store等待。
[原生测试](../../../../tools/winfsp-concurrent-test.mjs)在write/create返回并由host确认revision后才释放lane，接着等待真实Install和独立History核对。这是一个有控制的争用场景，不是正常请求路径加锁，也不证明构造正在持续CPU运行期间所有操作都已验证。首次Rust测试使用同一公开端口在安全Rust层完成交错，再接真实WinFsp文件API。

## 本轮修复的精确错误

旧诊断将0xc00000aa当作Busy，实为Windows STATUS_INSTRUCTION_MISALIGNMENT。已对照本机Windows SDK的STATUS_DEVICE_BUSY=0x80000011纠正所有诊断准入/capture/close与测试断言；host实际比对STATUS_DEVICE_BUSY。历史报告/旧回执不重写。
第一次C++编译因新局部变量captured遮蔽旧变量，被/W4 /WX拒绝；改名修复，未禁警告。[首次编译原件](../../../../tmp/native-concurrent-20261102/host-first.json)。第二次格式整理时的握手标签误替换在读源检查中修正，未将错误标签投入最终测试。旧[初版活证](../../../../tmp/native-concurrent-20261102/live-first.json)保留，最终证据单独封存。

## 验证与身份

- **14项Rust测试通过**：5范围、2Store、7Overlay/Commit/缓存/嵌套/scope/新增并发和custody用例。
- **1组真实原生并发Commit流程通过**，另一个进程重开只读Store核对exact2版本、parent/head/bytes和未变base。
- **原生嵌套Commit/同Store第二次挂载回归通过**；**缓存8阶段及11项解析控制通过**；**18项ProjFS CLI通过**。
- Rust1.85.1 offline+locked，test --no-run在先，Clippy all-targets -D warnings、fmt以及MSVC /W4 /WX通过。测试显式≤120秒，无运行测试失败/超时；没有测试删除。
- Foreign/dropped custody测试故意保留自己的Store/session到测试进程退出，不作猜测恢复；路径由Rust测试打印，原始测试回执保留。

回执：[Rust14项](../../../../tmp/native-concurrent-20261102/rust-final.json)、[native并发](../../../../tmp/native-concurrent-20261102/concurrent-final.json)、[native双挂载](../../../../tmp/native-concurrent-20261102/native-regression.json)、[cache/scope](../../../../tmp/native-concurrent-20261102/cache-regression.json)、[Store CLI](../../../../tmp/native-concurrent-20261102/store-regression.json)、[固定样本CLI](../../../../tmp/native-concurrent-20261102/fixture-regression.json)、[ProjFS映射](../../../../tmp/native-concurrent-20261102/mapping-regression.json)、[目录锁](../../../../tmp/native-concurrent-20261102/namespace-regression.json)、[Rust最终构建](../../../../tmp/native-concurrent-20261102/build-final.json)、[host最终构建](../../../../tmp/native-concurrent-20261102/host-final.json)。流式作业已收取；空的后续job_output不冒称另一份完整日志。

父提交10644176f4652af4ec9b4101e684c62c7d5c4cbb；最终测试树e5dbccc3d05b12a948332f93b7876cca0c5aa518。
probe子树b0390713cbf293aabd4432faffc4377aa8ca59ec，C++ blob6f4038a4a6cf35ec0e3f311c846ece310894c8b0。
- host SHA256：5cfc0fb1b0c2a6cf31333512f6234a374e64f2f5b8ac4c05f839612881c6e71a。
- Rust DLL SHA256：50395e566f8d4bb9c6cd5b6c21bc95f2004fdabeb7e85a2003584dd4cd7c3e10。
- client/checker SHA256：90c05431885299c3ec314916905e133c386dd0cdf4cfc3a5dcdcbf808ce7eb45。
- WinFsp DLL SHA256：94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3。

[Draw.io](WINDOWS-NATIVE-ARCHITECTURE.drawio)与[SVG](WINDOWS-NATIVE-ARCHITECTURE.svg)仅更新“已证capture后写入与Install保持；广义并发、映射未合格”标签；不把该局部实证画成全部并发已完成。XML可机器核验，未新增视觉复核声明。

## 未完成与下一段

只证明一个Workspace中一个Published Commit与普通文件变更的确定性交错；普通callback之间仍串行，完整WinFsp reply/capture竞态、多个Commit/多个Workspace并发、故障/kill/crash恢复、mapped-write同步、links/WTF-8/Win32元数据与产品SDK接入仍未合格。ApplicationVisible继续Unsupported，不改变已认定的published-frontier语义。
下一段可推进正常unmount/close与尚存文件引用的前置拒绝和显式收尾，避免依赖test harness总能先关闭所有外部句柄；并将已完成子能力纳入验证器的独立leaf，不能直接覆盖旧W2/W3/W4成全绿。

风险档中，非发布诊断；所有Store显式Disposable/WAL/OFF，Durable未执行，无依赖/根manifest/lock/产品/DSH改动。
Production LOC: 104392 -> 104392 (delta +0)，Core38454、Engine63178、API2760；同一production_loc.py与exact first-parent/staged产品树对比，工具/测试/文档排除；仅诊断代码按职责拆分，不转移产品源码规避计数。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。
品味判断点无新增；源码事实、受控实证与尚未验证范围分开列出。
