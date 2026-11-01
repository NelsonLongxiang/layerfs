# WinFsp → Rust Workspace/Overlay 原生接线（2026-11-01）

> **Status:** Dated native integration diagnostic; not full product Workspace qualification or Commit.
> 最终活证：2026-11-01T15:38:29.181Z–15:38:29.580Z（UTC，等于23:38:29 Asia/Shanghai）。

WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos.
[WinFsp repository](https://github.com/winfsp/winfsp)。此前授权的官方Beta5 Core+Developer安装沿用，未重复安装、重启或修改DSH。

## 已接通

**普通Windows进程 → WinFsp原生回调 → 窄C ABI → 现有Rust BoundWorkspace/Workspace → 真实SQLite Overlay。**
上轮C++单文件64KiB内存数组已删除，不是保留两个可选后端。没有编写第二个内容编码器、SQL驱动或另一路Store API。

- 启动用现有Project Init建立并封存独立Disposable Store夹具；原输入目录改名保留。这个一次性准备不是变更后的重新Init。
- StoreService直接打开该Store，bind一个持续存在的BoundWorkspace，复用现有StorePorts和权威serial预留。
- 文件读写使用真实OpenFile/kernel访问端口；创建/改名/删除通过现有Mutation公开层，数据和命名空间由Workspace发布到Overlay。
- WinFsp full context分别传稳定inode serial和每次打开的请求令牌；Cleanup不关闭Rust句柄，Close才释放OpenFile/KernelDirectory及lookup引用。
- Native host不保存文件字节；每次读写走128KiB以内的现有Overlay窗口，300000字节文件分窗，不再有64KiB总文件上限。

源：[Rust适配](../../../../tools/projfs-probe/src/native_overlay.rs) · [窄FFI](../../../../tools/projfs-probe/src/windows/overlay_ffi.rs) · [原生宿主](../../../../tools/winfsp-probe.cpp)。

## 活证结果

| 检查 | 结果 |
| --- | --- |
| 普通Windows读取alpha.txt | 与真实Store的旧内容一致，未回退原目录 |
| 新建并读写300000字节 | 全字节一致；duplicate create拒绝，旧内容不变 |
| 截断、改名、读取、删除、重建同名文件 | 全通过，serial由Store/Workspace分配，无本地伪造inode |
| capture | 第1代、revision 11固定；句柄保持打开 |
| 后续同一描述符写入 | 当前内容由before capture变为after! capture；第2代、revision 12 |
| captured reader | 仍逐字节读到before capture，不受后续写入影响 |
| 原生回调 | create3、open29、read11、write4、rename1、cleanup32、close32、delete1、error0 |
| 收尾 | handles=0；Overlay显式关闭；自身挂载移除；无Store Commit |

[最终活证原件](../../../../tmp/native-overlay-20261101/live-final/result.json) · [执行命令](../../../../tmp/native-overlay-20261101/native-final.json)。
Overlay最终诊断：active=2、captured=Some(1)、payload_bytes=29、inode_rows=5；这些是该样本的逻辑计数，不是存储性能或物理驻留结论。revision是引擎事实；publications字段是适配层成功变更调用计数，不能推广为任意no-op下的精确publication数。

**捕获口径**：先完成并关闭首次写入，确认缓存写已经到达Overlay，再保留新打开的描述符跨capture。此证明不声称未发布的内核脏页属于capture，也不声称所有原生Write返回都已发布。Windows缓存/映射/并发reply与capture排序仍须专门验证。

直接Rust集成测试另证明：可写句柄在rename/unlink后仍能读写，原captured bytes不变，最终关闭后旧handle拒绝；只读descriptor写入拒绝且字节不变，重名创建拒绝。全部调用的是真实Store/Overlay公共端口，不是mock。

## 验证

- **8项Rust测试通过**：5范围算术、2真实Store读取、1新增Overlay/capture/open-unlinked组合用例。
- **18项旧ProjFS CLI回归通过**：固定样本6、真实Store4、映射边界4、命名空间边界4。
- **1组原生Overlay端到端活证通过**，含已有/相对挂载拒绝、300KB内容、duplicate create、捕获跨句柄与正常退出。
- Rust/Cargo1.85.1，offline+locked；tests --no-run先构建；Clippy all-targets -D warnings通过，fmt通过；C++宿主MSVC /W4 /WX通过。
- 每个测试显式限时≤120秒；无测试超时或测试失败。构建作业均收齐，没有等待中的测试/进程。

原件：[Overlay单测](../../../../tmp/native-overlay-20261101/direct-final.json)、[范围](../../../../tmp/native-overlay-20261101/range-final.json)、[Store](../../../../tmp/native-overlay-20261101/saved-final.json)、[固定内容CLI](../../../../tmp/native-overlay-20261101/fixture-final.json)、[Store CLI](../../../../tmp/native-overlay-20261101/store-final.json)、[映射CLI](../../../../tmp/native-overlay-20261101/mapping-final.json)、[命名空间CLI](../../../../tmp/native-overlay-20261101/namespace-final.json)、[最终构建作业](../../../../tmp/native-overlay-20261101/build-final.json)。
构建stderr已由会话完成通知收取，后续job_output为空；JSON证明作业身份和exit0，不冒称另有完整编译日志。

## 精确身份与保留问题

- 父提交d30859bcb40ec8d8b544999041e31d073e1b7fed。
- 最终测试staged tree：3b4475661b2f2092bc8e4573eba2c932250236a5。
- 已测探针子树：4d7e61af443c146e18b332cd2a1a970bcc02e94a；C++ blob ee546c00b8d3047f8015dc15922a5dac6db2085e。
- 宿主EXE SHA256：b1755d47ab24661d2c3ac067b37b2fb0b7107ca3c344155c3a7b595231080eff。
- Rust DLL SHA256：0dc0dd88f27480f5a2e465e47dbd6bf6e678371a323b0ecde915f41af0030249。
- WinFsp DLL SHA256：94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3。

[源码封存](../../../../tmp/native-overlay-20261101/source-seal.json)、[宿主构建](../../../../tmp/native-overlay-20261101/host-first.json)。二进制hash前后核对；本报告不把本机构建变成签名发布物。
第一次Rust check错误是NTSTATUS常量推断为i32溢出，改为显式u32→i32；随后首次cdylib构建发现与原CLI同名PDB冲突warning，改诊断library名layerfs_native_probe，CLI名保留，最终无该warning。原[带warning构建](../../../../tmp/native-overlay-20261101/rust-build-first.json)保留；最终旧测试仅调整crate导入名，未删测试或弱化断言。

## 局限，不升级为完整Workspace

1. 适配器只接精确UTF-8根条目，嵌套路径操作、创建目录、symlink/hardlink、全部Windows属性/security写入明确未接；不是完整仓库挂载。
2. 诊断桥mutex串行化回调/control，不是产品SQL锁跨Store I/O。未来产品需请求级准入、并发和全生命周期证明，不能把该全局锁当生产设计。
3. 沿用Mutation的reply_attempted语义；它不是WinFsp实际回复送达回执。当前顺序活证不证明并发回调与capture完整排序。
4. 仅在本轮测试中没有未知失败。源代码对未知owner错误锁存拒绝并保留source/operation，不猜释放或重放；故障注入/崩溃恢复未验证。
5. captured reader仅核对新文件的本地字节；最终通过resolve_failed撤销诊断capture、保留活跃视图，再显式关闭，不称作Commit成功或一次真实失败的Commit。
6. **Save、History、Commit写回与重新挂载核对尚未执行**；产品SDK的Windows Workspace仍Unsupported。冻结W2/W3/W4没有被本轮自动置PASS。

下一段复用现有BoundWorkspace::commit_captured，验证真实Windows操作的已发布frontier经CapturedNamespace→Save::finish→History发布并重开读取；捕获/安装必须继续保持后续活跃变化与打开句柄，不用fs.apply或re-Init代替。

风险档：中，非发布诊断接线；不改DSH/系统配置/产品源码。生产LOC104392→104392（+0）：Core38454、Engine63178、API2760。同一计数器对exact parent/staged产品树核对；新工具/测试/文档排除，无第三方新增包，独立lock仅加两项已有first-party直接依赖。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。
品味判断点：无新增（公共端口复用与正确性边界）；不确定范围逐项如上。
