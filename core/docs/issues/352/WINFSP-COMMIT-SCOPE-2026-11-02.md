# WinFsp原生Commit保证范围与作用前拒绝（2026-11-02）

> **Status:** Implemented diagnostic guarantee admission and verified refusal, not a solution for dirty mapped-page synchronization or product Workspace qualification.
> 最终实跑：2026-11-01T17:41:53.097Z–17:41:53.667Z（UTC；2026-11-02 01:41:53，Asia/Shanghai）。

WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos.
[WinFsp repository](https://github.com/winfsp/winfsp)。沿用此前已授权的官方2.2.26286 Core+Developer，没有驱动重建、第三方修改、系统配置改变或DSH写操作。

## 已落实的边界

**诊断Commit不再含糊地接受任意保证：调用方必须显式要求Published或ApplicationVisible。**

| 请求 | 行为 | 保留的保证 |
| --- | --- | --- |
| scope=1 / Published | 调用既有commit_captured，正常Committed或UpToDate；结果打印scope=published | 仅对locally published Overlay frontier成立，打开文件句柄仍允许 |
| scope=2 / ApplicationVisible | 立即STATUS_NOT_SUPPORTED（0xc00000bb） | 不承诺所有应用可见cache/映射字节；在capture/Save/History之前拒绝 |
| scope=0或未知值 | STATUS_INVALID_PARAMETER（0xc000000d） | 没有默认范围，不能静默选择较弱保证 |

拒绝不写changed输出参数，不释放已有capture，不改变generation/revision/base或History，不触发flush，不猜测缓存脏页状态。不以“当前没有打开句柄”推断更强保证成立。后续调用Published是明确的不同请求，不是内部fallback或失败操作重放。

[安全Rust入口](../../../../tools/projfs-probe/src/native_overlay.rs)使用CommitScope；[FFI](../../../../tools/projfs-probe/src/windows/overlay_ffi.rs)改为lf_commit_scoped(scope,changed)，旧无范围symbol移除；[原生host](../../../../tools/winfsp-probe.cpp)及本仓所有调用者同步更新。仅本仓非发布诊断ABI变化，**产品SDK接口未改变，Windows Workspace仍Unsupported**。

这不是“所有映射字节已保存”的实现，也没有禁止MapViewOfFile。已有published-frontier链路保持可用，不新增“关掉所有句柄才能Commit”的自设门禁。

## 为什么不是设置DisableCache就完成

只读查看官方v2.2B5固定提交14d6e0280ae15e2550c44d6dbc476be51649727f（tree5e7e25ee96844df0295ebb9b966ef2227b18cc87），不是对最新分支的猜测。9个下载参考文件的Git blob均与该官方tree匹配；[校验清单](../../../../tmp/native-admission-20261102/source-and-live-audit.json)。没有patch/vendor/build第三方代码。

- [内核Create](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/sys/create.c#L1137-L1156)：SectionObjectPointer独立设置。只有FileInfoTimeout为INFINITE、调用未要求FILE_NO_INTERMEDIATE_BUFFERING且DisableCache=false，才设置FO_CACHE_SUPPORTED。当前host本来就是FileInfoTimeout=0，不能靠重复“关闭普通缓存”解决已有映射差异。[本机原文](../../../../tmp/native-admission-20261102/create.c)。
- [内核section回调](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/sys/callbacks.c#L82-L117)：Acquire/ReleaseFileForNtCreateSection在kernel资源上同步；这里没有发送可由本user-mode适配拒绝的section创建回调。[本机原文](../../../../tmp/native-admission-20261102/callbacks.c)。
- [share检查](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/sys/file.c#L713-L727)：没有FILE_SHARE_WRITE且已有user-writable section时，kernel可拒绝一次打开。这个是**单文件打开准入**，不自动构成完整目录树capture、后续代际写入或映射清空证明。[本机原文](../../../../tmp/native-admission-20261102/file.c)。
- [Flush路径](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/sys/flush.c#L59-L104)：枚举open文件并调用CcFlushCache；会把写请求带回user-mode。不能在当前桥mutex内同步调用、造成回入死锁；本轮没有采用flush来伪造排空。[本机原文](../../../../tmp/native-admission-20261102/flush.c)。
- [FSCTL分发](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/sys/fsctl.c#L720-L765)未实现FSCTL_LOCK_VOLUME入口；未把NTFS上另一个接口的语义移植宣称到WinFsp。[本机原文](../../../../tmp/native-admission-20261102/fsctl.c)。
- [Close路径](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/sys/close.c#L78-L117)可异步best-effort发user-mode Close；descriptor统计不是全局section/缓存排空的独立证据。[本机原文](../../../../tmp/native-admission-20261102/close.c)。

这些源码事实限定**已安装版本的已读接口**，不是“所有Windows机制永远无法做到”的结论；本轮未声称实跑了所有候选控制方式。安装header中的GetOperationContext虽能读写Create response，却不能凭空变出kernel section admission回调。

## 真正执行的验证

1. 新Rust用例：dirty active、已有独立capture、已经真实发布后3种状态中，ApplicationVisible均拒绝；精确比较WorkspaceState（包含generation/revision/capture/base）和独立History snapshot前后相等；旧字节与capture保持。
2. 同用例继续显式Published，打开句柄不关闭也可Committed；无变化UpToDate；继续写入再Committed，证实未破坏原路线。
3. 真实8阶段缓存/映射实验：每阶段先调用ApplicationVisible与invalid scope，各获得预期0xc00000bb/0xc000000d，两个输出sentinel保持不变；随后分别发明确Published请求。缺失/被改成成功的拒绝证据必须失败。
4. Committed/UpToDate都带scope=published。独立只读进程重开并对账实际Commit字节、4096长度、其余字节、parent/head，不因拒绝产生额外History。

[8阶段真实拒绝与published行为](../../../../tmp/native-admission-20261102/live-final/result.json) · [精简拒绝提取](../../../../tmp/native-admission-20261102/source-and-live-audit.json) · [只读History核对](../../../../tmp/native-admission-20261102/live-final/reopen.json)。

映射差异仍如实存在：阶段3–6应用可见67/68而published和Commit为66；后续晚到constrained Write才发布68。**本轮修复的是接口承诺含混，不是映射同步窗口。**

最终测试计数：
- **12项Rust测试通过**：5范围、2Store、5Overlay/Commit/目录/缓存/新scope测试。
- **11项解析控制通过**：真实原件1 + 10个拒绝反例，新增缺scope拒绝、强保证假成功、结果省略scope3项。
- **真实8阶段16次保证拒绝通过**（每阶段1次不支持、1次非法），随后显式published行为及独立只读History通过。
- **原生嵌套Commit/同Store双挂载回归通过**，18项既有ProjFS CLI通过。
- Rust1.85.1 build/test --no-run/Clippy all-targets -D warnings、fmt及MSVC /W4 /WX通过。测试逐次显式≤120秒；没有测试超时/失败，无测试删除或断言降级。

回执：[Rust12项](../../../../tmp/native-admission-20261102/scope-rust-final.json)、[cache执行](../../../../tmp/native-admission-20261102/scope-cache-final.json)、[解析反例](../../../../tmp/native-admission-20261102/scope-parser-final.json)、[原生双挂载](../../../../tmp/native-admission-20261102/native-regression.json)、[Store CLI](../../../../tmp/native-admission-20261102/store-regression.json)、[固定样本CLI](../../../../tmp/native-admission-20261102/fixture-regression.json)、[映射CLI](../../../../tmp/native-admission-20261102/mapping-regression.json)、[目录锁CLI](../../../../tmp/native-admission-20261102/namespace-regression.json)、[编译作业](../../../../tmp/native-admission-20261102/build-complete.json)、[宿主编译](../../../../tmp/native-admission-20261102/host-first.json)。流式构建结果已在会话完成通知收取；后续空输出job receipt不冒称完整编译日志。

## 身份、范围与下一步

父提交1c0ac1bee8b97a27f7cfce217ceeee223f7e1715；最终测试树f5fe560bd434535f45324b1d574a2146c4677b87，probe子树77b6e9f20232cc1de54d81898a6f10dc02fb2907，C++ blob310e5bd72637dfa74f32cbfd81a7dcf58a94a378。

| 二进制 | SHA256 |
| --- | --- |
| 原生host | 1de4543faed2f58664284add08f903f79968666384d01eb2962f44221195c6c0 |
| Rust DLL | 3e6e7ed301e60a106f369209d18844c544ac7f739ce37b05edd89f6728198f84 |
| client/checker | 3472ba36f168f19a0a3b030cf7394673d2d207f28b5e90caf73635f188b245eb |
| WinFsp DLL | 94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3 |

没有改cache flags、没有新增依赖/驱动安装、没有发布到产品SDK。风险中档，内部诊断ABI在同仓同步切换，旧无scope host不能悄悄使用新库。
下一段优先处理当前全局桥mutex与Commit构造并发的操作所有权：用真实请求交错证明published capture之后的写入进入新代并在Install后继续可见；完整application-visible映射保证仍为明确Unsupported，不用重命名成Published来冒称完成。

Production LOC: 104392 -> 104392 (delta +0)，Core38454、Engine63178、API2760。exact first-parent/staged产品树与同一production_loc.py方法核对，非发布工具/测试/文档排除；无产品或DSH源码变化。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。
品味判断点无新增：未实现保证不能冒充实现是正确性边界；尚未验证的并发、映射、元数据/links与产品API资格保持非PASS。
