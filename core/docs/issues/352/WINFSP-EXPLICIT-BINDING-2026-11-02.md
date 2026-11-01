# 原生显式Store绑定与双Workspace隔离（2026-11-02）

> **Status:** Implemented diagnostic explicit binding and simultaneous native mount proof; not product SDK Workspace integration or unrestricted concurrent publication qualification.
> 最终原生provider范围：2026-11-01T19:44:42.180Z–19:44:42.775Z（UTC；2026-11-02 03:44:42，Asia/Shanghai）。这是行为实证，不是性能测量。

WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos.
[WinFsp repository](https://github.com/winfsp/winfsp)。沿用已授权安装，无重装、重启、依赖新增、第三方/产品/DSH源码改动。

## 已交付切片

**新原生绑定路径接收调用方明确给出的catalog binding、cursor capability、Branch和Workspace incarnation；两个原生进程同时挂载同一Store，独立Overlay及文件句柄，关闭一方不影响另一方。**

[Binding](../../../../tools/projfs-probe/src/native_binding.rs)校验现有History类型/宽度；[Session::bind_existing](../../../../tools/projfs-probe/src/native_overlay.rs)沿原StoreService::open_direct/bind；[FFI](../../../../tools/projfs-probe/src/windows/overlay_ffi.rs)提供lf_bind_stdin；[原生host](../../../../tools/winfsp-probe.cpp)增加--bind-stdin已有Store路径与显式Commit控制。没有Store复制、第二encoder、手写SQL、WSL/Linux worker或产品私有测试钩子。

旧Session::create/reopen与默认host fixture模式仍是保留的测试便捷入口，显式传入合成fixture值后走同一核心；它们没有变成任意Store入口。新bind核心、独立Commit读取和publication核对不再读取这些固定常量。**不是声称所有历史fixture代码都已删除。**

## 真实双挂载结果

测试只初始化一次新合成Store，catalog/cursor/Branch值不同于旧fixture，Workspace由测试调用方分别生成32字节非零身份。三个provider的existing-Store参数相同；只有第一次setup调用Project Init，三个挂载均记录existing=true/init=false。

| 阶段 | 本机核对结果 |
| --- | --- |
| A/B同时挂载 | 同一Store与Branch，两个不同Workspace incarnation；两个独立Overlay文件与各自句柄 |
| 普通Windows文件变更 | A创建a.txt=alpha，B创建b.txt=bravo；互相看不到对方尚未提交的文件 |
| A提交 | Commit1只保存a.txt；B保持自己原来的local base，仍看不到a.txt |
| B提交 | 现有driver执行干净合并，Commit2包含a.txt与b.txt；A仍不刷新成B的base，原句柄读alpha |
| A关闭请求 | A仍持外部文件引用时Busy，A/B均继续读；释放A后正常关闭、只移除A的Overlay |
| B继续活动 | A退出后B同一打开句柄仍读bravo、写after并提交Commit3；旧Commit2仍为bravo |
| 第三个新挂载C | 同一Store读到a.txt=alpha、b.txt=after；Published UpToDate不新增Commit |
| 独立只读进程 | 前后两次核对恰好3个版本、父子链、Branch、head、文件长度/字节与未改base内容 |

[三provider原始回执](../../../../tmp/native-binding-20261102/live-final/result.json) · [普通进程观察](../../../../tmp/native-binding-20261102/live-final/observations.json) · [独立History核对](../../../../tmp/native-binding-20261102/live-final/reopen.json) · [再次核对](../../../../tmp/native-binding-20261102/live-final/reopen-after.json) · [精简总结](../../../../tmp/native-binding-20261102/final-summary.json)。

A provider 19:44:42.180Z–.446Z；B .223Z–.541Z，因此两个挂载确实同时存活。C .641Z–.775Z。普通写入不是SDK fs.apply：由Node进程直接对挂载路径open/write/read，并在跨Commit期间保持原descriptor。

三个provider正常exit0、errors0，Cleanup/Close分别A6/6、B8/8、C4/4；挂载均移除。A关闭后确认A Overlay不存在而B Overlay仍在，B关闭后其Overlay也删除；全局Store保留。不把读取路径名当安全隔离或Sandbox证明。

实际Commit顺序：
1. 1212931cfc5517f8ae00e4841af1907ae21e3963b578a9c97e39697441afa17e4c，parent=None，a.txt=alpha，无b.txt。
2. 128b0cac5d7f82f6553053c02e29851963ad9ca228c993ae98abbc181fbff6f798，parent=1，a.txt=alpha/b.txt=bravo。
3. 1272abcb887264f2c450ec69b34a66a6a777b9ff5accc975856de3eed1e96b0759，parent=2，a.txt=alpha/b.txt=after。
所有记录via=Workspace，三个保存量分别454、592、280字节，不把此小fixture外推为性能结论。

## 修正诊断层的共享Branch假设

此前[Commit核对](../../../../tools/projfs-probe/src/native_commit.rs)假定record.parent等于准入前head，并要求之后独立读取的全局Branch仍指向该Commit。两个合法Workspace时这不成立：driver可能合并已经推进的head，另一实例也可能在本地settlement前再次推进它。

现在核对原返回的merge.from/head、record.meta.branch/via、独立读取的不可变Commit记录与本Workspace已知install。既有产品driver的merge/Save/History实现未改，不通过“再读全局head”猜测已完成操作的成败。

安全Rust用例特意让A的CommitWork先运行完但不settle，再让B提交推进head，最后才归还A的原completion。A仍正确settle自己的已知成功；B的合并Commit父子链与内容正确。没有重试、force覆盖、替换constructor或忽略原unknown custody。

## 明确输入与拒绝

新入口stdin一次性二进制帧：magic LFSBND01、little-endian u16 catalog长度、1–128字节catalog、32字节cursor、17字节tagged Branch、32字节非零Workspace；帧最大219字节，读最多220字节以检测超长。调用方发送完整帧并关闭stdin；测试有显式wall deadline，不把阻塞stdin宣称为已认证控制服务。

catalog/cursor不放argv、不落bootstrap文件、不打印帧；本轮全为非敏感合成值，没有读取生产凭证。[测试控制器](../../../../tools/winfsp-binding-test.mjs)记录public Workspace IDs、命令和结果，不记录stdin。此路径不是远程认证协议、不提供密码学内存擦除，也不能把非零cursor校验说成独立秘密所有权证明。Workspace身份仍由application authority负责，未实现跨进程重复incarnation全局注册表。

六种真实host拒绝均exit1且未创建mount/ready：空输入、截断、尾随字节、zero Workspace均0xc000000d；不存在Branch为0xc0000034；错误catalog由底层open拒绝并保留0xc0000001。另有guarded setup拒绝直接未授权调用。安全Rust额外覆盖empty/oversize catalog、zero cursor、错误Branch tag及受保护main Branch；main不能被当普通可写Branch挂载。错误输入不回退fixture默认值。

## 最终验证

- **18项Rust测试通过**：3项新binding组合、8项Overlay/Commit/lifecycle、5范围、2Store。
- **真实双挂载/关闭隔离/第三次挂载/三Commit独立重开通过**；同一harness包含6种host输入拒绝和setup guard。
- **原生嵌套/顺序双挂载、capture后并发Commit、正常close及8项close解析、cache8阶段及11项解析回归通过**。
- **18项既有ProjFS CLI通过**，共享fixture默认行为未丢。
- Rust1.85.1 offline+locked build、test --no-run、Clippy all-targets -D warnings与fmt；MSVC /W4 /WX通过。每个测试有显式≤120秒墙钟上限，无超时。

原件：[Rust18项](../../../../tmp/native-binding-20261102/rust-final.json)、[双挂载命令](../../../../tmp/native-binding-20261102/binding-final.json)、[原生顺序回归](../../../../tmp/native-binding-20261102/native-regression.json)、[并发回归](../../../../tmp/native-binding-20261102/concurrent-regression.json)、[close回归](../../../../tmp/native-binding-20261102/close-regression.json)、[cache回归](../../../../tmp/native-binding-20261102/cache-regression.json)、[Store CLI](../../../../tmp/native-binding-20261102/store-regression.json)、[样本CLI](../../../../tmp/native-binding-20261102/fixture-regression.json)、[ProjFS映射](../../../../tmp/native-binding-20261102/mapping-regression.json)、[目录锁](../../../../tmp/native-binding-20261102/namespace-regression.json)、[Rust最终构建](../../../../tmp/native-binding-20261102/build-first.json)、[host构建](../../../../tmp/native-binding-20261102/host-first.json)。

保留失败：[第一次测试编译](../../../../tmp/native-binding-20261102/build-unit-first.json)因测试声明误用逗号；修正为两个let。随后[初次Rust运行](../../../../tmp/native-binding-20261102/unit-first.json)2PASS/1FAIL，拒绝测试假定fixture有main但没有；用公开History::fork建立main测试前提后通过，不删除断言、不改产品实现。没有为了通过修改过往回执。

## 固定身份和范围

父提交0513c93fcbd93032266cb119d8a3cfd4d09c1ac9；最终测试树40efcba0bfa7935370077cb7c8f3f7e0db46da65，probe子树6c7f7cdaf2b6832986499b23f1917ac7dc1ed895，C++ blob097532420afad043de46320e28e4de8a29d896cb；[封存](../../../../tmp/native-binding-20261102/source-seal.json)。

| 二进制 | SHA256 |
| --- | --- |
| native host | 87429abc5aa2d6fc8f627ec2fecf7fe674b48462d19090cc86eb54782a6980b4 |
| Rust DLL | d4da03d643d325f16c50bebf91837b58c58773a29cd66740fb35f8e8fe3cdecf |
| client/checker | 322f1900b26b14f94a991c3fce74d051e1fc6f16fec7a03e60160828ba98ec2d |
| WinFsp DLL | 94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3 |

[架构图](WINDOWS-NATIVE-ARCHITECTURE.drawio)与[SVG](WINDOWS-NATIVE-ARCHITECTURE.svg)更新显式绑定/每挂载独立Overlay标签；仅XML核验，不新增视觉复核声明。

这是两个同时存活的独立挂载和有序Commit，不是同时构造/发布多个Commit的全面资格；冲突处理、重叠路径修改、跨进程重复身份、启动失败/崩溃恢复、完整Windows metadata/links/WTF-8、所有merge后的kernel cache一致性仍未验证。ApplicationVisible仍Unsupported，映射差异保持，不靠flush/unmap伪造实现。产品SDK Workspace仍未接入，旧分层验证器的历史原件不改写。

下一段建议用普通Windows Git在隔离原生挂载中运行init/add/commit/status及锁文件rename，检查真实开发工作负载的缺失回调和错误码；遇到适配缺陷就修复定向重验，不对真实用户仓库做实验，不把Bash/进程退出当自动unmount。

风险中档，非发布诊断。Production LOC: 104392 -> 104392 (delta +0)，Core38454、Engine63178、API2760；同一production_loc.py范围核对exact first-parent/staged产品树，工具/测试/文档不计。无产品搬迁、无测试删除。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。本轮品味判断点无新增；不确定范围如上。
