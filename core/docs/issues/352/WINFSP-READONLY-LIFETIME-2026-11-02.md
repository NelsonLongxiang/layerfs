# Git关闭缺口：只读映射释放顺序与精确handle定位（2026-11-02）

> **Status:** Reproduced native lifetime boundary and repaired diagnostic log transport; normal-close implementation is not fixed or qualified by this result.
> 最终最小复现：2026-11-01T21:42:53.209Z–21:43:04.289Z（UTC；Asia/Shanghai 2026-11-02 05:42–05:43）。不是性能测量。

WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos.
[WinFsp repository](https://github.com/winfsp/winfsp)。沿用已授权的2.2.26286 Core+Developer。无系统配置、driver、第三方、产品或DSH源码改动。

## 本轮确定了什么

**前轮Git第二挂载的8个残留引用已关联到确切token：一个.git/index和七个松散对象。它们全部只读打开，各有一次Cleanup但没有Close。一个不运行Git、不修改文件、不调用Commit的只读映射小场景即可复现同样的缺口。**

[Git完整FAIL回执](../../../../tmp/native-git-close-20261102/file-trace/result.json) · [逐handle对账](../../../../tmp/native-git-close-20261102/file-trace/handle-summary.json) · [第二provider原始日志](../../../../tmp/native-git-close-20261102/file-trace/second/provider-stdout.log)。

| 第二挂载token | 对象 | access | Cleanup / Close |
| --- | --- | --- | --- |
| 519 | 松散对象80/07d41d… | 0x00120089，只读 | 1 / 0 |
| 598 | Git index | 同上 | 1 / 0 |
| 774 | 松散对象35/d38c50… | 同上 | 1 / 0 |
| 775 | 松散对象98/a2896a… | 同上 | 1 / 0 |
| 778 | 松散对象e7/8bb06f… | 同上 | 1 / 0 |
| 820 | 松散对象85/1eed09… | 同上 | 1 / 0 |
| 821 | 松散对象35/102c78… | 同上 | 1 / 0 |
| 824 | 松散对象4b/f90aaa… | 同上 | 1 / 0 |

完整合成路径与serial在原件，不使用哈希简称定位真实文件。第一provider1654个打开均完成Cleanup/Close；第二provider724个打开、724个Cleanup、716个Close，差额恰好8，不存在“Close已成功而Rust忘了从handle表释放”的证据。总计7126条追踪事件，未触发20000条输出上限。序列由一次原子递增编号；分析按序列对账，不用跨线程stdout出现次序猜所有权。

## 最小只读映射复现

[client](../../../../tools/projfs-probe/src/windows/mapping_lifetime.rs)复用原有View封装，调用真实CreateFileMapping/MapViewOfFile/UnmapViewOfFile；[控制器](../../../../tools/winfsp-mapping-lifetime-test.mjs)用同一个新建合成Store、三个独立native挂载读取既有nested/data.bin。每个应用子进程均exit0，不持有跨进程共享句柄，不改变内容或执行Commit。

| 操作顺序 | native Cleanup / Close | normal close |
| --- | --- | --- |
| 普通File读取一字节，然后关闭File | 2 / 2（含目录） | 成功，provider exit0 |
| 只读view先Unmap，后关闭File | 2 / 2 | 成功，provider exit0 |
| 先关闭File，view仍存活，随后成功Unmap，子进程退出 | 2 / 1 | 10秒条件未达；新的正常stop请求Busy |

第三个场景剩余token102、serial88，仍为只读access0x00120089；它的Cleanup flags0x20仅包含last-access提示。**没有dirty write也能复现**，因此“等待写入发布”并不是完整解释。测试仅在记录Busy后取消自己的隔离provider，provider SIGTERM不是正常unmount；host硬期限未触发。控制器exit0仅表示实验完整执行并通过对账，不把第三臂normal_close=false升级为PASS。

[最终三臂原件](../../../../tmp/native-git-close-20261102/mapping-final/result.json) · [重算audit](../../../../tmp/native-git-close-20261102/mapping-final/audit.json) · [命令](../../../../tmp/native-git-close-20261102/mapping-final.json)。先前探索[三臂原件](../../../../tmp/native-git-close-20261102/mapping-order/result.json)保留；最终版本新增guard与audit后按受影响范围复验，未改等待期限或生命周期。

## 固定源码为什么支持这条定位

Git-for-Windows v2.46.0.windows.1已解到commit2e6a859ffc0471f60f79c1256f766042b0d5d17d，两个下载参考文件的Git blob与该tree一致：
- [git_mmap](https://github.com/git-for-windows/git/blob/2e6a859ffc0471f60f79c1256f766042b0d5d17d/compat/win32mmap.c#L22-L45)创建PAGE_READONLY/FILE_MAP_READ、立即关闭mapping HANDLE，munmap调用UnmapViewOfFile。[本机参考](../../../../tmp/native-git-close-20261102/win32mmap.c)。
- [map_fd](https://github.com/git-for-windows/git/blob/2e6a859ffc0471f60f79c1256f766042b0d5d17d/object-file.c#L1222-L1242)映射松散对象后就close(fd)，把仍存活的view返回给调用方。[本机参考](../../../../tmp/native-git-close-20261102/object-file.c)。
- [身份清单](../../../../tmp/native-git-close-20261102/summary.json)和[tag pin](../../../../tmp/native-git-close-20261102/git-tag-pin.json)。Git launcher hash不是整个已安装Git helper集合的认证，源码关系不能代替实际运行记录。

已安装WinFsp参考仍为v2.2B5固定commit14d6e0280ae15e2550c44d6dbc476be51649727f：[Cleanup](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/sys/cleanup.c#L130-L155)后在[CleanupComplete](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/sys/file.c#L1009-L1037)执行CcUninitializeCacheMap；真正的[user-mode Close](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/sys/close.c#L78-L108)来自kernel Close路径。当前FlushAndPurgeOnCleanup=1和FileInfoTimeout=0未改变。

我们尚未在kernel内部观察谁最终保留FILE_OBJECT/section，也没有证明driver必然泄漏。能够确认的是：这条只读File-first释放顺序能在当前环境产生缺少Close回执的状态；同一Rust handle路径的普通读和反向释放正常。不能因此提前释放OpenFile、更改用户程序合法释放顺序、触发虚假变更通知或用不可逆STOP“探测”Busy。

## 本轮实际修复与新增工具

- [host](../../../../tools/winfsp-probe.cpp)增加opt-in有界追踪：event、序列、tick、handle、serial、access/Cleanup flags和合成路径；正常未启用时只经过一个条件分支，不改变操作语义。输出达到20000条明确饱和，audit拒绝该回执；这不是文件数/总操作数限制。
- [Git控制器](../../../../tools/winfsp-git-test.mjs)provider stdout/stderr直接落本轮日志文件。此前在同一Node event loop使用spawnSync跑Git同时异步收provider pipe，大量逐handle日志填满pipe会反向阻塞文件回调。首次trace在git add的12秒子命令期限失败，[原件](../../../../tmp/native-git-close-20261102/traced/04.json)和[外层失败](../../../../tmp/native-git-close-20261102/traced-command.json)保留；改用文件输出后19个Git命令及数据检查恢复，原8引用关闭FAIL仍在。修的是观测transport，不是内核引用。
- [trace audit](../../../../tools/winfsp-handle-trace.mjs)核对逐token唯一open、serial、Cleanup/Close顺序、Close status、无漏号/重号、最后inventory一致、终态/退出码与时间，拒绝将取消或硬期限冒充正常关闭。
- guarded client拒绝未授权父上下文及非法mode，先于文件打开；不持久化bootstrap capability、不改用户或全局配置。

## 验证范围与身份

- 最终最小三臂实验完成：2个正常关闭、1个确定Busy，3个client均exit0；2个CLI guard反例通过。
- trace audit **13项控制**（真实1+12种破坏），分别对Git和mapping回执执行，共26条检查通过。[回执](../../../../tmp/native-git-close-20261102/trace-controls.json)。缺事件、错serial、错序、假inventory、假完成、饱和、缺退出结果、伪装超时等不能通过。
- **13项Rust存续回归通过**（metadata2/binding3/Overlay8）；原生normal-close及嵌套Commit/同Store第二次挂载回归通过：[Rust](../../../../tmp/native-git-close-20261102/rust-final.json)、[close](../../../../tmp/native-git-close-20261102/close-regression.json)、[native](../../../../tmp/native-git-close-20261102/native-regression.json)。未受影响的范围/Store/产品测试沿用父提交回执，不重复跑。
- Rust1.85.1 offline+locked build、test --no-run、Clippy all-targets -D warnings、fmt与MSVC /W4 /WX通过：[build](../../../../tmp/native-git-close-20261102/build-final.json)、[host](../../../../tmp/native-git-close-20261102/host-trace.json)。每个测试显式≤120秒，无测试留在后台。

父提交d6e45c0eda39651041b78b0581c22046dfdfbd23；最终测试树3756d8dc0dd710f96d27249028ee4199582cebb8（后续只加文档）。probe子树b1605239a949abc71b138a8cf80b10ff50527ab5，host blob90d1241823f9c9f1f51030a453c3be6dd62a3b7a。

| 用途 | 二进制SHA256 |
| --- | --- |
| 本轮host（Git与mapping共用） | 4e1349e0c30e6685f85b273949accde487b13a144eedf44d9f490ede72633393 |
| Git追踪Rust DLL（父版本） | 6843756259ff435e707efc31af8d481734f85766147a3b4bef3f04992a24b7ec |
| Git追踪checker（父版本） | c2af1c72f0956c3eb18554b6345f4d7cb00727ba2e2bb5a1aade981fe3d27b26 |
| 新mapping DLL | b4b1542a1616dfc95e24976c7151fa8f232bdada5b370b80d8512a6493fd1b7c |
| 新mapping client | 9b98f1d24111853b195116aaf2d8d1977580441323e21db938c2d9b49a60456f |
| WinFsp DLL | 94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3 |

两组Rust字节身份不同是新增独立client后的重建，未冒称同一binary；原Git观察保留原source/time，不重复完整Git工作负载来凑样本。当前变更没有修改产品crate、Store/Overlay/Commit/close实现或缓存标志。

## 仍在途

任务8dc8d475a1继续doing，Git整体仍FAIL。下一段应在此一文件File-first复现上核定已安装WinFsp公开的引用/缓存协调能力，或需要明确授权的驱动级手段；所有方案需保持用户view合法性与未Close句柄custody，不能靠模拟成功、提前释放、强制flush/unmap或假事件通知完成。无充分依据时保留Unsupported/Busy与这个可执行降级结果。

Production LOC: **104682 -> 104682 (delta +0)**，Core38454、Engine63468、API2760；exact first-parent/staged产品子树与同一production_loc.py counter不变，工具/测试/文档排除。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。本轮无新增品味判断点；尚未区分内核缓存与driver内部引用归属，不作确定根因断言。
