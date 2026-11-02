# Windows原生回调：产品请求准入与终止drain（2026-11-02）

> **Status:** Implemented product request component with real WinFsp diagnostic consumption; not SDK Windows Workspace mount support or arbitrary kernel-section qualification.
> 修复后最终Git运行2026-11-02T04:18:54.215Z–04:18:59.653Z，原件对账04:27:50.761Z（UTC；Asia/Shanghai同日12:18、12:27）。不是性能测量。

## 实现

本轮复用产品[MountRequests](../../../../engine/crates/layerfs-fuse/src/dispatch/requests.rs)，不另造Windows请求状态机：

- RequestOwner::serve_sync在原接收线程执行同步回调，记录完成或保留原始错误/panic payload。异步路径仍在panic时保存原future，失败不重放。
- MountRequests::try_stop_receive在同一mutex内检查active/retained并挡住后续receive；Busy不改变准入，停止后为Stopped、finish后为Stale。它不是操作系统卸载、服务abort或内核mapping盘点。
- [WinFsp ABI消费端](../../../../tools/projfs-probe/src/windows/overlay_ffi.rs)在等待Session mutex前接收产品request owner，覆盖进入Workspace ABI的文件系统回调。确定拒绝为已完成请求；未知错误保存在产品lane，panic保留payload及中毒Session。控制调用单独执行，关闭准备不把自己计为活动回调。host-owned输入span持续至调用返回，不额外复制产品frame，request(0)只表示没有新复制的输入字节；每个ABI操作仍核对数据窗口。
- Session关闭准备先检查文件/目录、Commit、capture与保留状态，再原子停止空闲请求lane。有已接收但尚未取得Session锁的回调就返回Busy，服务继续可用。host完成WinFsp dispatcher停止、unmount和对象销毁后，Session::finish才核验产品request finish、记录NATIVE_REQUESTS_DRAINED，再撤销逻辑KernelMount、关闭Overlay与Store reader。

未进入Workspace ABI的C++回调仍由WinFsp dispatcher拥有。本lane不是全部OS请求/section清单；active=0不代替api.stop返回或实际卸载回执。[架构说明](../../architecture/75-native-request-service.md#synchronous-native-callbacks-and-terminal-admission-2026-11-02)、[消费端说明](../../../../tools/projfs-probe/README.md#product-callback-admission-and-drain)。

## 修复一个真实释放顺序缺陷

抽取共享完成函数时，初版record(self, ...)提前消费RequestOwner；已完成future可能在active归零之后才析构，析构中仍持有的消费者因此被误报为空闲。

新增确定性[回归测试](../../../../engine/crates/layerfs-fuse/tests/requests.rs)在future析构时尝试idle-stop。修复前测试exit101，观察到active=0且停止错误成功：[原始失败](../../../../tmp/native-request-lifecycle-20261102/disposal-before-fix.json)。改为record(&self, ...)后，原请求保持活动直到已完成future析构结束；析构内idle-stop返回Busy，随后终止正常。未通过sleep或放宽断言凑绿。

## 最终验证

| 范围 | 结果 |
| --- | --- |
| 产品请求测试 | 6 PASS：原async唤醒/force/panic、同步准入/失败/panic保留及future析构顺序 |
| 原生Session协调测试 | 5 PASS：既有3项加活动回调阻止关闭、保留失败不被normal close丢弃 |
| 其它Rust回归 | 19 PASS：Overlay8、binding3、metadata2、产品lookup3、产品Open3 |
| 总计 | **30项Rust测试PASS** |
| 实际原生调用链 | 嵌套操作/两Commit/同Store新挂载通过；修复后普通关闭、协调Git及并发Commit通过 |
| 静态检查 | 969文件产品扫描、36守卫自测、root Fuse/probe全目标Clippy -D warnings及fmt通过 |

[11项定向测试](../../../../tmp/native-request-lifecycle-20261102/fixed-request-tests.json)、[19项回归](../../../../tmp/native-request-lifecycle-20261102/rust-regressions-fixed.json)、[守卫](../../../../tmp/native-request-lifecycle-20261102/guard-final.json)、[修复后完整构建和严格检查](../../../../tmp/native-request-lifecycle-20261102/build-disposal-fixed.json)。测试panic行是刻意捕获的原始payload验证，不是额外失败。编译Rust1.85.1、offline/locked，先no-run再在显式≤120秒上限内运行；没有后台测试或失败自动重试。

### 原始drain顺序

最终回执逐条确认：NORMAL_CLOSE_PREPARED → NORMAL_CLOSE_STOP_BEGIN → NORMAL_CLOSE_DISPATCHER_DRAINED → NATIVE_REQUESTS_DRAINED → OVERLAY_CLOSED → NORMAL_CLOSE_DONE。host在dispatcher停止返回后执行unmount/destroy，再调用Rust finish；不能只从标记推断所有内核状态。

| 修复后场景 | 接收 / 完成 | active / retained | 结果 |
| --- | --- | --- | --- |
| Git第一次挂载 | 9631 / 9631 | 0 / 0 | 正常exit0；Cleanup/Close1647/1647 |
| Git第二次挂载 | 4432 / 4432 | 0 / 0 | 正常exit0；Cleanup/Close740/740 |
| 普通关闭 | 175 / 175 | 0 / 0 | Busy时仍可用，释放后新请求正常关闭 |
| 并发Commit | 65 / 65 | 0 / 0 | capture后普通I/O继续，最终正常关闭 |

Git19条命令加1 setup全exit0，17文件独立before/after清单一致，无取消。上述计数是所有进入Workspace ABI的回调，不仅open/read/write计数。[最终汇总](../../../../tmp/native-request-lifecycle-20261102/summary.json)、[原始对账脚本](../../../../tmp/native-request-lifecycle-20261102/reconcile.mjs)、[对账回执](../../../../tmp/native-request-lifecycle-20261102/summary-audit.json)、[Git结果](../../../../tmp/native-request-lifecycle-20261102/git-fixed/result.json)、[before](../../../../tmp/native-request-lifecycle-20261102/git-fixed/before.json)/[after](../../../../tmp/native-request-lifecycle-20261102/git-fixed/after.json)、[普通关闭](../../../../tmp/native-request-lifecycle-20261102/close-fixed/result.json)、[并发Commit](../../../../tmp/native-request-lifecycle-20261102/concurrent-fixed/result.json)。

初版生命周期的[native结果](../../../../tmp/native-request-lifecycle-20261102/native-first/result.json)及[同Store重挂载](../../../../tmp/native-request-lifecycle-20261102/native-first/second/result.json)仍保留原身份，不重新标注成析构修复后的结果。析构修复后实际消费链重新覆盖普通关闭/Git/并发，未重复全部未受影响场景取最好样本。

## 依赖、身份及原始失败

消费端只新增已有第一方layerfs-fuse依赖，独立lock增加其传递闭包。Linux-only fuser解析沿用根仓已授权的path patch，无vendor源码编辑；Windows不编译Linux FUSE/driver。独立lock的114个registry package逐包与产品根lock核对version/checksum一致；根manifest/lock均未修改。该比较不宣称Linux消费者已运行。

首次消费端构建因InputFailure没有Display而失败，原件在[首次构建](../../../../tmp/native-request-lifecycle-20261102/build-first-current.json)；修正为明确读取reason，再用locked构建。新增依赖解析曾引起意外版本漂移，先后保留[第一次对齐](../../../../tmp/native-request-lifecycle-20261102/lock-align.json)与[最终对齐](../../../../tmp/native-request-lifecycle-20261102/lock-align-final.json)，没有悄改现有产品依赖。

格式/暂存组合命令20秒中断留下空index.lock；确认绝对路径、固定修改时间和没有Git进程后只清除此锁，[检查](../../../../tmp/native-request-lifecycle-20261102/git-lock-inspection.json)、[精确清理](../../../../tmp/native-request-lifecycle-20261102/git-lock-cleanup-literal.json)。两次路径校验/转义错误在删除前拒绝，原回执保留。源码计数首次90秒中断，检查已有导出后仅续做未完成的计数，不重新导出或跑治疗；[中断](../../../../tmp/native-request-lifecycle-20261102/loc-command.json)、[导出逐blob核对](../../../../tmp/native-request-lifecycle-20261102/loc-exports-audit.json)。读取超长JSON显示行曾被工具截断，后续对账直接解析原始文件，未改原件。

父提交3c865217748f97159986432fe1c7f583a2ccda2e；封版受测tree5481dc0feea82cfcb482255c935344e14327a2eb。Fuse subtree4a49cc781801e1740d0ab9c469a7ce431c469638；probe subtree27cd8e5515b6168608d7b5e8c2ad95828be844ea。之后只加入本报告。

| 实跑binary | SHA256 |
| --- | --- |
| 沿用host | bae2aa4bf8f68726c7859ae383b67db433fd965906fd39de93df3867446a7bf1 |
| WinFsp DLL | 94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3 |
| 最终Rust bridge | 746c207f88b48d834ab71418391412981692b3fe6b98405b212dd07c156c5b4f |
| 最终client | 648833d19e2074d12f40d6c771590ff10bfb725ddfa25dc28953c6aace86be83 |
| Git launcher | 851535ccc041bed536a23b17200cd51e7b06e266a527f4eaf8338b5c256c6466 |

Hash证明保留字节一致，不是签名编译溯源；launcher hash不认证全部Git helper。本轮没有改DSH、系统配置、安装driver或执行Durable/WSL替代路线；全部Store为显式Disposable/WAL/OFF，新合成fixture隔离。

## 仍在途

任务3b7a154bc4保持doing：产品请求准入/失败保管/drain已由Windows回调消费，但实际WinFsp挂载owner、进程/服务注册和SDK mount/status/Commit/unmount尚未产品接通。请求计数0不等于无任意section/descriptor；完整kernel引用、可写映射同步、kernel成功解绑映射、广义并发/crash仍未合格。Linux FUSE整体挂载测试本轮NOT_RUN。旧FAIL及旧验证器快照不改绿。

下一段应完成真实产品mount owner或平台调用接线，明确绑定、Ready、终止与IPC/权限归属，不继续停在无消费wrapper搬迁，也不能只移除Unsupported或从产品include诊断源码。

Production LOC: **105081 -> 105119 (delta +38)**；Core38454不变，Engine63867→63905（Fuse4565→4603），API2760不变。同一[production_loc.py](../../../../tools/production_loc.py)对exact parent/final-tested git archive导出计数，[before](../../../../tmp/native-request-lifecycle-20261102/loc-parent.json)/[after](../../../../tmp/native-request-lifecycle-20261102/loc-staged.json)；每份导出1521个blob已验证，最终产品/consumer subtree与受测树相同。工具/测试/文档排除，无测试删除或范围迁移。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。本轮无新增品味判断点；所有未验证支持范围如上，不把不确定写成确定。
