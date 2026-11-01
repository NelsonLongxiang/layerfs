# 原生正常关闭的作用前拒绝与终止顺序（2026-11-02）

> **Status:** Implemented diagnostic close admission with real file/directory/view refusal tests; not a universal kernel-reference census, forced-unmount or full product qualification.
> 最终活证：2026-11-01T18:41:30.386Z–18:41:30.892Z（UTC；2026-11-02 02:41:30，Asia/Shanghai）。

WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos.
[WinFsp repository](https://github.com/winfsp/winfsp)。沿用已获授权安装；本轮未改系统配置、第三方源码、DSH或产品源码。

## 已修正的关闭顺序

原生host此前直接StopDispatcher/RemoveMountPoint，再由Session::finish检查Busy；这可能在发现引用尚存之前已经让挂载不可用。现在增加prepare_close：**先在同一Session准入锁内检查并封住新操作，成功后才执行不可逆的dispatcher stop和detach。**

| 情况 | 本轮行为 |
| --- | --- |
| 仍有OpenFile/KernelDirectory、pending或已完成未settle的Commit、独立capture | STATUS_DEVICE_BUSY（0x80000011），不置closing、不stop/detach/revoke |
| 未知/retained Commit结果 | 继续保留原始custody，拒绝正常关闭，不猜清理 |
| 准入成功 | closing=true；后续open/create/read/capture/Commit准入拒绝；未先修改Overlay frontier或History |
| native终止 | prepare → StopDispatcher/drain → remove mount → kernel revoke → Overlay close |
| 部分finish结果或再次finish | finish_started锁存一次终止尝试，不重放未知关闭 |

[close准入模块](../../../../tools/projfs-probe/src/native_close.rs) · [Session终止](../../../../tools/projfs-probe/src/native_overlay.rs) · [FFI](../../../../tools/projfs-probe/src/windows/overlay_ffi.rs) · [host](../../../../tools/winfsp-probe.cpp)。
独立诊断capture现在必须先显式release；finish不再偷偷清掉它。正常Commit发布与未提交Overlay关闭仍是不同操作，未加入隐式Commit。

## 原生实测

普通client只使用Windows文件API/映射，不调用Rust管理接口。四阶段拒绝后继续用原对象核对；随后控制进程另持文件发出真实stop请求，验证它也在作用前拒绝。

| 阶段 | 外部持有状态 | close检查 | 拒绝后 |
| --- | --- | --- | --- |
| 0 | alpha.txt文件句柄 | files1/dirs0，Busy | 原句柄读回完整旧内容 |
| 1 | many目录句柄 | files0/dirs1，Busy | 普通枚举仍有80项 |
| 2 | 可写view与File句柄，section HANDLE已关闭 | files1，Busy | view仍读到写入值66 |
| 3 | File/section HANDLE均关，只剩view | files1，Busy | view继续写67并读回 |
| stop请求 | 另一外部alpha.txt句柄 | Busy且service_kept=true | 挂载存在，普通读回正确，未输出stop/drain/done |
| 全部已知引用释放后 | adapter收到对应Close，pending/capture均无 | 新的stop-after-release请求准入 | 完整drain、mount移除、Overlay关闭、host退出0 |

[原始双进程回执](../../../../tmp/native-close-20261102/live-final/result.json) · [有序精简事件](../../../../tmp/native-close-20261102/source-and-close-audit.json) · [测试命令](../../../../tmp/native-close-20261102/close-final.json)。
最终callback create1/open16/read7/write2/cleanup17/close17/delete0/error0。host与client都正常exit0；没有强杀用户进程、强制unmap、显式FlushViewOfFile/FlushFileBuffers或固定延迟来冒充排空。

**两次请求不是自动重试**：第一次stop被消费并回Busy，挂载继续服务；测试明确释放引用，再发送不同stop-after-release标记。close-inspect仅等待实际Close回执的有界状态条件，不进行关闭也不授予关闭许可；prepare_close仍重新检查并原子封住新准入。普通回归测试也在终止请求前核对自己的引用已释放。

## 固定版本源码依据

官方WinFsp v2.2B5提交14d6e0280ae15e2550c44d6dbc476be51649727f只读参考，4个Git blob与官方tree相同，[核对清单](../../../../tmp/native-close-20261102/source-and-close-audit.json)：
- [FspFileSystemStopDispatcher](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/dll/fs.c#L417-L440)调用STOP0，等待dispatcher，再调用STOP；没有返回可逆Busy的接口。[本机源](../../../../tmp/native-close-20261102/fs.c)。
- [FspVolumeStop](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/sys/volume.c#L1311-L1350)：STOP0停止IOQ但不取消IRP，STOP进一步取消；这是终止协议，不是探测。[本机源](../../../../tmp/native-close-20261102/volume.c)。
- [kernel FSCTL分发](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/sys/fsctl.c#L101-L135)明确上述顺序来源；本轮没有调用某个未实现的volume lock来声称已冻结。[本机源](../../../../tmp/native-close-20261102/sys-fsctl.c)。

我们因此在自己控制的Session边界做原子准入，而不误用native stop探测Busy。CloseState记录**adapter仍持有的确切引用**，不是所有kernel section/dirty cache状态的枚举。此实测知道它建立了哪些外部引用，并验证释放；不以“计数0”独立宣称所有隐藏引用不存在。

## 验证与失败留痕

最终固定源码下：
- **15项Rust测试通过**：5范围、2Store、8Overlay/Commit/并发/custody/新增close组合用例。
- **1组实际close生命周期**覆盖4个reference阶段与真实stop共5次拒绝；释放后另一个显式请求完成关闭。
- **8项close解析控制通过**（真实trace1+7拒绝反例：缺view拒绝、错Busy、提前prepared、先stop、缺drain、重复stop、没有拒绝后view写入）。
- 原生并发Commit仍核对pending Commit期间prepare_close和finish均Busy；原生嵌套/同Store双挂载、缓存8阶段与11项解析控制、18项ProjFS CLI均回归通过。
- Rust1.85.1 offline+locked，test --no-run先构建，测试逐次显式≤120秒；Clippy all-targets -D warnings、fmt、MSVC /W4 /WX通过。

原件：[Rust15项](../../../../tmp/native-close-20261102/rust-final.json)、[close反例](../../../../tmp/native-close-20261102/close-parser-final.json)、[native双挂载](../../../../tmp/native-close-20261102/native-regression.json)、[并发Commit](../../../../tmp/native-close-20261102/concurrent-regression.json)、[cache/scope](../../../../tmp/native-close-20261102/cache-regression.json)、[Store CLI](../../../../tmp/native-close-20261102/store-regression.json)、[固定样本CLI](../../../../tmp/native-close-20261102/fixture-regression.json)、[ProjFS映射](../../../../tmp/native-close-20261102/mapping-regression.json)、[目录锁](../../../../tmp/native-close-20261102/namespace-regression.json)、[最终Rust构建](../../../../tmp/native-close-20261102/build-final.json)、[host构建](../../../../tmp/native-close-20261102/host-ordered.json)。

保留的失败：
1. 新测试用unwrap_err要求成功值Stat实现Debug而编译失败；改为err().unwrap()核错误，不改产品类型。[编译失败作业](../../../../tmp/native-close-20261102/build-first-failure.json)，详细stderr已在会话收取，后续空job_output不假造原始文本。
2. [首次live失败](../../../../tmp/native-close-20261102/live-first.json)的顺序断言确实拒绝：C++ stdout缓冲导致drained日志晚于Rust Overlay closed。实际调用顺序正确，但证据顺序不可信；修复是在drain完成后fflush(stdout)再调Rust finish，不是文件/Store flush，不弱化断言。[失败原件](../../../../tmp/native-close-20261102/live-first/result.json)保留。
3. 最终重新封存live与反例通过；没有测试超时。异常/超时退出输出DIAGNOSTIC_EXIT_NOT_NORMAL，不称作正常收尾。测试失败时仅可取消自己spawn的隔离进程，不把这种退出当作普通unmount能力。

## 精确身份与未合格范围

父提交4edecf328b3604157669cb7045c03702b7323927；最终测试树fd3063bb102e4f3d8e21a2cd96c354452f11d91f。
probe子树4ab75d2ba291d5b6b0c350ea8a170c2f13f6ccdf，C++ blobae725ad7c7a243e1734a7b6f2c6ccfca495f8f28；[源码封存](../../../../tmp/native-close-20261102/source-seal.json)。
- host SHA256：1e8bc1d2efc175da76511f3e04224b0629b998268b9e695d0d018a1749f3dd88。
- Rust DLL SHA256：1c484b84a05c68b62f4ad2ba2c4bc21152d2b2641b644419aa959d958083f647。
- client SHA256：cf606ae8ef83b48b5a6e9deafaca683f9669d31708d5c10a5cf1e32f1bd8226c。
- WinFsp DLL SHA256：94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3。

本轮只证明这些已知引用存活下的可逆拒绝、以及观察到确切Close后原子封准入的正常终止序列。完整未知kernel引用/section清单、并发kernel缓存命中/新open竞态、forced teardown、崩溃恢复仍未验证。WinFsp成功stop并不自动解决此前mapped-byte发布差异，ApplicationVisible仍Unsupported，产品SDK Workspace仍未启用。

本轮native-close样本故意不Commit其临时文件修改，正常unmount不隐式Commit；History保留另由已有Commit/双挂载回归和Rust新close用例核对。没有改变用户完整可变Workspace的目标或偷偷提高完成标准。
下一段应把已完成Store、projection、native mutation/Commit/remount、缓存scope、并发切片及正常close的证据分层纳入验证器；不把旧W2/W3/W4直接全绿，也不把一个探针成功替代产品SDK入口。

风险中档；所有Store显式Disposable/WAL/OFF，Durable未执行。Production LOC: 104392 -> 104392 (delta +0)，Core38454、Engine63178、API2760；同一production_loc.py方法与exact first-parent/staged产品树核对，非发布工具/测试/文档排除。无测试删除、无产品源码搬迁。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。品味判断点无新增；未确定的能力边界如上。
