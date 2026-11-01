# 只读映射：Busy后仍可读与普通reopen后的真实Close（2026-11-02）

> **Status:** Native single-file coordination observation verified; no general unmount implementation or Git qualification upgrade.
> 最终实跑2026-11-01T22:03:32.186Z–22:03:43.729Z（UTC；Asia/Shanghai 2026-11-02 06:03）。原件读取/交付时间见审计回执；不是性能结果。

WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos.
[WinFsp repository](https://github.com/winfsp/winfsp)。沿用已授权安装；本轮不改系统配置、driver、第三方、产品crate或native close实现。

## 新证据

**只读view仍存活时，正常stop返回Busy，普通文件读取与原view读取仍可用。owner解除view并退出后，原handle在10秒观察中仍无Close；随后一次普通只读open/read/close带来原handle的真实Close，新的正常stop请求才prepare/drain/detach成功。**

[最终结果](../../../../tmp/native-reopen-20261102/final/result.json)明确status=OBSERVED、general_close_qualified=false，provider和application均exit0，未触发总期限、未取消进程。与前轮只做Unmap后等待的失败场景不同，本轮增加了一个独立、显式且已记录的普通只读访问，不把前次Busy请求自动重放。

| 步骤 | 原handle102 / serial88 | 其它观察 |
| --- | --- | --- |
| 只读File建立view后关闭 | Open seq4、Cleanup seq5；无Close | files1、cleanup2/close1（含目录） |
| 正常stop | 仍无Close | STATUS_DEVICE_BUSY=0x80000011，service_kept=true；未prepare/stop/detach |
| view存活时普通reopen/read/close | 原102仍保留 | 新token104完成seq9 Open→10 Cleanup→11 Close；读回字节0，owner从原view再次读回0 |
| owner自行Unmap并退出 | 原102仍保留 | owner exit0；不强制另一个进程Unmap |
| 原10秒有界观察 | 无新Close；last seq仍11 | 实录10013ms（调度误差不作性能或延时保证） |
| 另一次普通只读reopen/read/close | 原102收到Close seq17 | 新token106 Open seq15→Cleanup seq16→Close seq18；与原对象同serial、同路径 |
| 新stop-after-release请求 | 所有真实Close已到 | files0、cleanup6/close6；prepare→stop→dispatcher drain→Overlay closed→detach完成 |

[provider原始trace](../../../../tmp/native-reopen-20261102/final/case/provider-stdout.log) · [应用原始输出](../../../../tmp/native-reopen-20261102/final/case/application-stdout.log) · [逐事件审计](../../../../tmp/native-reopen-20261102/final/audit.json)。

原102在view存活时没有提前Close；新访问token104已关闭但不会因此丢掉原引用。后一次访问的Cleanup之后才出现102的Close，适配执行既有Close回调释放所有权，没有手工删除token或提前释放Rust OpenFile。初次探索中102与106两条Close的相对顺序不同，故判据只要求原102在后一次访问开始/新Cleanup之后、最终停止之前真正完成，不强加无契约的两个Close排序。

最终callback create0/open6/read3/write0/rename0/cleanup6/close6/delete0/errors0，Overlay revision0、publications0、Commit0。文件内容没有修改，既有挂载移除被controller检查。后台仍可能按已配置的FlushAndPurgeOnCleanup执行内核工作；本轮只保证调用方未显式FlushFileBuffers/FlushViewOfFile、未伪造notify、未改变cache flags或执行不可逆STOP来探测Busy。

## 实现范围与复现

[新client](../../../../tools/projfs-probe/src/windows/mapping_coordination.rs)由测试父上下文启动，只维护一个既有readonly View；用独立控制目录标记协调“保持view→读回→owner解除”。[测试控制器](../../../../tools/winfsp-reopen-test.mjs)只操作新合成Store及挂载，stdin一次输入合成Binding，不落盘或记录capability。与产品相关的native host、Rust Session/FFI/close、StoreService和内核均与父提交相同；只增加CLI路由和测试client。

命令（仓根；复跑必须另选不存在的输出目录）：

```powershell
node tools/winfsp-reopen-test.mjs <host-trace-exe> <installed-WinFsp-dll> <Rust-dll> <probe-client-exe> <fresh-output>
node tools/winfsp-reopen-test.mjs --self-test <fresh-output>/result.json
```

实际执行命令有75秒外层deadline，host35秒、view owner25秒；原无reopen观察仍10秒，新操作后的Close观察独立限10秒，未增加某次关闭尝试的等待上限。原始命令及退出0见[coordination-final](../../../../tmp/native-reopen-20261102/coordination-final.json)。这不是通用后台重试或循环扫树。

固定WinFsp源码（v2.2B5 commit14d6e0280ae15e2550c44d6dbc476be51649727f）解释一个合理路径：[CleanupFlush](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/sys/file.c#L838-L886)在last Cleanup且FlushAndPurgeOnCleanup开启时做既有cache处理，[CleanupComplete](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/sys/file.c#L1009-L1037)调用CcUninitializeCacheMap。view解除后的新handle Cleanup与本机Close到达相符，但这不构成Windows API对任意隐藏section排空的保证。我们没有在内核中确定此前最终持有者，未称驱动泄漏已修复。

## 验证

- 真实单文件协调实验：Busy时新读成功、原view读成功、owner释放后原token真实Close到达、正常关闭成功；新增CLI未授权父上下文拒绝通过。[最终原件](../../../../tmp/native-reopen-20261102/final/result.json)。
- **10项事件控制通过**：真实1+9反例，拒绝提前Close、错误原token、伪通用保证、缺view读/Unmap/reopen、声称view存活时已Close、超时与被取消provider冒充成功。[反例回执](../../../../tmp/native-reopen-20261102/coordination-controls.json)。
- **13项存续Rust回归通过**：metadata2、binding3、Overlay8；[测试回执](../../../../tmp/native-reopen-20261102/rust-final.json)。未更改的产品测试及其平台失败沿用父提交证据，不重新标日期或抹绿。
- Rust1.85.1 offline/locked build、test --no-run、Clippy all-targets -D warnings、fmt通过。[构建](../../../../tmp/native-reopen-20261102/build-first.json)及[最终检查](../../../../tmp/native-reopen-20261102/build-final.json)。沿用完全相同host binary，无新driver/系统安装。

第一次controller路径字面量把Windows反斜线解释为escape，找不到实际trace中的token；[失败命令](../../../../tmp/native-reopen-20261102/first-command.json)保留。读原件证实Open/Cleanup已发生，改为明确分隔符归一化后[探索](../../../../tmp/native-reopen-20261102/path-fixed-command.json)通过；新增audit/guard后完成最终一次覆盖。不修改旧输出或放宽生命周期判断。

## 固定源码与字节身份

父commit ff4bd47cb92d38ba8bc66eb85ad88748a8566afe。最终实验tree62a21bfc03787f2766a73254dc7d20b682835737；probe/src树22fc36c6d04596b58caaa71bb8306af2e7714a9b。
Host源码blob90d1241823f9c9f1f51030a453c3be6dd62a3b7a保持不变；product crates、native_overlay/native_close/overlay_ffi/mapped均与父提交相同，新增client导致DLL与CLI重建，不能说二进制与前次完全相同。

| 二进制 | SHA256 |
| --- | --- |
| 沿用host | 4e1349e0c30e6685f85b273949accde487b13a144eedf44d9f490ede72633393 |
| WinFsp DLL | 94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3 |
| 新Rust DLL | 0f1b34e437074e635f059936e10d918520b96d5f10b174192ce954b525210824 |
| 新client | 3fb90f60e7e6b1755d81e19167ff7da3295ebd8b18629ed04d41840c95fe2da2 |

## 不能外推与下一段

本实验知道同一未改名文件的准确路径、原token及owner何时主动释放view。**尚未实现自动reopen扫尾**：rename/unlink、路径替换、共享/权限拒绝、多个/可写映射、新open竞态、引用盘点与有界增量处理都未被覆盖。不能在adapter mutex内回入普通文件API形成死锁，也不能因一次reopen成功就丢弃未Close的原始custody。

任务8dc8d475a1继续doing；整个Git场景仍沿用FAIL，不以单文件成功改写。下一段只评估明确正常关闭请求下的一次性、身份匹配且不修改数据的协调是否可推广；先覆盖view仍存活不得成功终止、文件已改名/解绑不得错开新对象等边界，再考虑接线。若机制不足，继续明确Busy/Unsupported而非猜成功。ApplicationVisible Commit仍Unsupported，产品SDK/全kernel引用/崩溃恢复尚未合格。

Production LOC: **104682 -> 104682 (delta +0)**，Core38454、Engine63468、API2760；产品子树及同一production_loc.py方法不变，工具/测试/文档排除；无测试删除或实现搬迁。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。本轮无新增品味判断点；普通reopen能否成为通用安全协调仍未定论。
