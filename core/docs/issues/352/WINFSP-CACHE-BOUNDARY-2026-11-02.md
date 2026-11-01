# WinFsp缓存/可写映射与Overlay发布边界（2026-11-02）

> **Status:** Dated native observation and regression result; a reproduced visibility gap, not mapped-write qualification or a production fix.
> 最终provider活证：2026-11-01T17:17:25.313Z–17:17:25.895Z（UTC；2026-11-02 01:17:25，Asia/Shanghai）。

WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos.
[WinFsp repository](https://github.com/winfsp/winfsp)。使用此前已获明确授权的2.2.26286 Core+Developer；无重装、重启、DSH源码改动或WSL/Linux回退。

## 结论：三个可见性层次不能混同

**本机实际出现：可写映射已读到67/68，真实Overlay与Commit仍保持66，Commit返回UpToDate。**
关闭File/section HANDLE、随后Unmap，并不能据此断定新字节已经发布。后续普通open/read/close期间，一次constrained Write才把68送到Overlay；本次它发生在同一handle的Cleanup之后、Close之前。

这证明当前适配的UpToDate只描述**已发布frontier**，不能用于声称“应用没有待保存的映射修改”。诊断通过不等于问题已修复。现有OpenFile保留到Close的处理承接了晚到写入，未在本场景发现提前释放；映射准入/缓存同步仍是后续工程缺口。

## 八阶段原始观察

每阶段普通子进程先执行动作、核对能核对的字节，再发一次标记；host直接经SourceView::read读取已发布字节，不打开挂载文件来充当Overlay观察。两个独立进程的原始日志分别保存；host的应用值标签必须与client记录相符。

| 阶段 | 动作/应用端字节 | Overlay前/后 | Commit字节 / 变化 | Write / constrained | Cleanup / Close |
| --- | --- | --- | --- | --- | --- |
| 0 | 初始化4096字节为65并关闭 | 65 / 65 | 未提交 | 1 / 0 | 2 / 2 |
| 1 | 普通write返回，同句柄read为66；句柄仍开 | 66 / 66 | 未提交，独立capture仍为全65 | 2 / 0 | 3 / 3 |
| 2 | 关闭普通写句柄；最近确认值66 | 66 / 66 | 66 / Committed | 2 / 0 | 4 / 4 |
| 3 | view写67并读回；File与view仍开，section HANDLE已关 | 66 / 66 | 66 / UpToDate | 2 / 0 | 5 / 5 |
| 4 | File已关，只剩view；view读回67 | 66 / 66 | 66 / UpToDate | 2 / 0 | 6 / 5 |
| 5 | 仅view仍可写，写68并读回 | 66 / 66 | 66 / UpToDate | 2 / 0 | 6 / 5 |
| 6 | Unmap返回；最近确认值68，已无view可读取 | 66 / 66 | 66 / UpToDate | 2 / 0 | 6 / 5 |
| 7 | 普通open/read/close完整读回4096字节 | 68 / 68 | 68 / Committed | 3 / 1 | 8 / 8 |

阶段2、6的application值是前一步最近确认值，不是关闭后重新访问已释放句柄/view。不能从本次阶段顺序推导所有机器上的固定写回时机；checker允许合法的异步发布提前到达，但不允许未来字节、倒退或Commit与窗口内已发布frontier矛盾。

[八阶段观测](../../../../tmp/native-cache-20261102/final/observations.json) · [原始provider/client回执](../../../../tmp/native-cache-20261102/final/result.json) · [精简事件提取](../../../../tmp/native-cache-20261102/final/trace-summary.json)。

关键同handle记录：handle106先Cleanup，随后一次constrained=1、offset0、requested/done4096的Write，最后Close。最终handles0、错误0，挂载已移除；不是通过提前关闭引用伪造“排空”。
WinFsp的ConstrainedIo只保证该Write不得扩展文件，**该标志本身不能证明来源必然是映射**；这里是结合已知普通进程动作与同handle事件证明此次晚到写入。

## 实际保存与独立重开

provider结束后，另一个只读进程通过History与Content核对所有保存版本、父子链、head、文件长度4096及其余4095字节均为65，并把版本首字节序列与实际changed Commit阶段一一对账。

- Commit1：12d86e493b7a7d17c822784a612ec863e500aa49760e81bf16119fab36a7f77b76，首字节66，parent=None，via=Workspace。
- Commit2：121c64ccd4a1de5bde386538c8ce6b6199e8dbdfee1913a2e5a9a101c0b8189cc5，首字节68，parent=Commit1，via=Workspace。
- 阶段3–6没有多造Commit。第一次保存不是“67/68已保存”；第二次才包含68。

[独立只读History核对](../../../../tmp/native-cache-20261102/final/reopen.json)。本轮没有显式FlushViewOfFile、FlushFileBuffers、sync_all、retry或延长等待来推动发布；保留既有FlushAndPurgeOnCleanup=1配置。后续普通访问只是本协议已声明的下一步，**不是已证明可靠的同步接口**。

## 实现与验证

- [普通Windows client](../../../../tools/projfs-probe/src/windows/cache_client.rs)：使用既有受审计View封装；只做文件API和映射，不调用Store/Overlay；25秒绝对handshake期限。
- [host缓存观察模式](../../../../tools/winfsp-probe.cpp)：同一真实WinFsp适配，额外记录Write/Cleanup/Close及八个一次性控制点；45秒期限，不复制原生后端。
- [published_byte](../../../../tools/projfs-probe/src/native_overlay.rs)走现有SourceView::read；[FFI](../../../../tools/projfs-probe/src/windows/overlay_ffi.rs)窄转发。
- [缓存核验脚本](../../../../tools/winfsp-cache-test.mjs)核对provider/client双源阶段、首字节偏序、精确handle顺序、Commit/frontier一致性及独立重开；host/client各自输出完整保存。脚本自限50秒，执行命令70秒。
- [独立History检查](../../../../tools/projfs-probe/src/commit_reopen.rs)只读重开，所有4096字节核对，不是只查日志或单字节声明。

最终固定身份下：
- **11项Rust测试通过**：5范围、2真实Store、4Overlay/Commit/嵌套/新constrained-store组合测试。新增用例确认published-byte与capture分离、EOF裁切、超EOF no-op、旧Commit不变和stale descriptor拒绝。
- **8项解析器控制通过**：真实原件1 + 缺阶段、未来字节、丢失最终Commit、应用值伪造、capture字节不符、未Cleanup即Close、Close后Write共7个拒绝反例。
- **1组8阶段真实缓存/映射观察通过**，另有独立History重开；含受保护内部client拒绝直接调用。
- **18项既有ProjFS CLI与原生嵌套Commit/双挂载流程回归通过**。没有把观察通过算成映射资格PASS。
- Rust1.85.1 offline+locked，先test --no-run；Clippy all-targets -D warnings、fmt及MSVC /W4 /WX通过。每次测试显式≤120秒，无测试超时或失败。

回执：[最终缓存命令](../../../../tmp/native-cache-20261102/cache-final.json)、[解析反例](../../../../tmp/native-cache-20261102/parser-final.json)、[Rust11项](../../../../tmp/native-cache-20261102/rust-final.json)、[原生双挂载回归](../../../../tmp/native-cache-20261102/native-regression.json)、[Store CLI](../../../../tmp/native-cache-20261102/store-regression.json)、[固定样本CLI](../../../../tmp/native-cache-20261102/fixture-regression.json)、[ProjFS映射反例](../../../../tmp/native-cache-20261102/mapping-regression.json)、[目录锁反例](../../../../tmp/native-cache-20261102/namespace-regression.json)、[宿主构建](../../../../tmp/native-cache-20261102/host-checked.json)、[Rust构建与检查](../../../../tmp/native-cache-20261102/build-checked.json)。
较早first与checked实验原样保留，增加精确handle、History和解析检查之后才执行最终封存检查。最后新增Rust测试的build --no-run/Clippy已由会话完成通知确认exit0；恢复后job注册表为空、原job id不可收取，不能伪造补回的原始日志。最终测试与严格Clippy有本轮真实执行结果。

## 精确身份

父提交a729f99aefd214325882a8fdffc3177b81eb5c86；最终测试树f2bb5ee20506077a74c12e986a0b18784fc37e92。
探针子树1843dccb183d990faac54da728be39f4d08c8b96，C++ blob5e5d1987c9c28b9d0eead5611f305b5bc3b49f7d。

| 工件 | SHA256 |
| --- | --- |
| 原生host | f0c45b068258cddc4205610203ba8fdeab8b7c8c53d41a8f45d4bd9a3d0e7f16 |
| Rust DLL | aca364116f07969f6d7e46c64bde150d55c5f8a6baa84b1882e574da75b96d12 |
| client/checker | 5cb3d8448116401bcdb952343733f7df515690f1c304e78568ea194c6c4f445d |
| WinFsp DLL | 94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3 |

[源码封存](../../../../tmp/native-cache-20261102/source-seal.json)。hash验证前后身份，不证明可信签名发布或跨平台适用性。

## 必须保留的未完成项

**当前不能把“所有应用可见映射修改已进入Commit”作为保证。** 本轮主要新增可复现实证和防假绿检查，没有声称修复了Windows脏映射发布窗口。此前Store/顺序Commit/目录二次挂载成果不因此抹掉，但完整Workspace映射/并发资格仍非PASS，产品SDK仍Unsupported。

下一步针对WinFsp原生接口研究并实证可兑现的mapping/cache准入或协调边界；先确认请求层能观测/拒绝哪些缓存或section操作，再实现明确语义。不能只数写句柄/等待固定时长，不在桥mutex内同步触发会回入Write的flush，不把关闭进程或强制unmap当普通Commit实现。需要新增依赖/驱动配置时遵守已有授权边界，不擅自改第三方或DSH。

风险档中，非发布诊断；Store全部Disposable/WAL/OFF，无Durable执行；无产品/DSH/第三方源码变更，无新增依赖。Production LOC: 104392 -> 104392 (delta +0)，Core38454、Engine63178、API2760；exact first-parent/staged产品树与同一production_loc.py方法，工具/测试/文档排除，无测试删除。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。
品味判断点无新增；事实、时间相关观察和未确定的产品语义分别列明，不冒充裁决。
