# Windows独立产品进程与继承流控制入口（2026-11-02）

> **Status:** Dated implementation checkpoint; not release evidence or a released product contract.
> 最终产品运行2026-11-02T08:43:18.262Z–08:43:18.603Z，回执对账08:49:06.131Z（UTC；Asia/Shanghai同日16:43、16:49）。这是功能验证，不是性能测量。

## 本轮新增的真实产品入口

[安全Rust入口](../../../../engine/crates/layerfs-daemon/src/bin/layerfs-native.rs)运行产品Session，直接打开已有Store并启动一个显式绝对路径的[WinFsp产品伴随进程](../../../../engine/crates/layerfs-fuse/src/windows/host.cpp)。伴随进程链接现有产品mount owner、回调及元数据适配，使用[继承流provider](../../../../engine/crates/layerfs-fuse/src/windows/stdio_port.cpp)调用父进程的既有Workspace语义。实际挂载路径不加载诊断DLL，不导入tools、不使用WSL/Linux worker、第二encoder或数据库，也不新增Rust unsafe例外。

[显式产品构建](../../../../tools/build-native-windows.ps1)使用MSVC14.40.33807、C++17 /W4 /WX、Windows SDK10.0.22621.0编译layerfs-winfsp.exe，并通过Rust1.85.1 offline/locked构建layerfs-native.exe。编译source全部位于engine产品层；脚本是构建工具，不是产品源码替代。Cargo构建Rust父进程，MSVC构建C++子进程，不能把二者混作同一个Cargo产物。当前是dev构建和显式二进制路径，不是安装器、Windows Service注册、发行版或SDK自动发现。

父进程的参数为absolute-native-host、WinFsp DLL、existing Store、fresh work、fresh mount。权限只经[一次启动帧](../../../../engine/crates/layerfs-daemon/src/native/bootstrap.rs)从继承stdin进入Rust Session：LFSBND01、LE u16 catalog长度、catalog、cursor32、Branch17、Workspace32。启动帧后不要求EOF，因为同stdin继续承载控制。临时凭证缓冲清零不等于密码学擦除；catalog/cursor不进argv、输出或挂载子进程。子进程只收到library/mount/root身份及backing-volume路径，不打开Store。

## 控制与原始结果保管

[控制入口](../../../../engine/crates/layerfs-daemon/src/native/control.rs)接受严格递增的非零编号及status、commit published、unmount，按原id返回。没有公共监听端点、自动重连、失败重放或远程认证声明；继承流持有者是这个显式进程实例的控制方，不是已注册SDK Sandbox。控制记录128字节窗口覆盖现有固定命令语法，不限制Workspace存活或总调用数。

父子间的[帧协议](../../../../engine/crates/layerfs-daemon/src/native/wire.rs)为LFSRPC01、请求id、opcode及长度，单帧处理窗口256KiB；文件读写仍按128KiB窗口分段，不是文件总大小上限。[Workspace分发](../../../../engine/crates/layerfs-daemon/src/native/port.rs)只调用原产品Session操作，没有Store数据RPC或第二语义实现。一个子进程声明一个mount/provider，单通道串行ABI exchange；控制Commit在Session锁外构造，输出也不跨Session锁。并发吞吐没有性能资格声明。

输入部分帧、校验失败的原Frame、失败请求/响应、typed delivery/control错误及失联后Session均保持进程内原始保管；成功Commit若交付失败保留其原receipt。读取/写入只在本次传输内继续正向短进度，error/zero-progress终止，不从帧首重发。不可解释的回答、编号错配、owner失联或错误控制使准入失败，关闭子进程输入以唤醒其等待者并返回失败，不假装正常卸载。进程退出后由OS清理不等于已实现安全恢复或重新接管协议。

## 完整回调准入与正常终止

原子计数覆盖完整WinFsp回调，而非只覆盖某一次管道exchange：响应转换、多窗口间隙及observer执行均在callback owner范围内。[准入State](../../../../engine/crates/layerfs-fuse/src/windows/callback_state.hpp)在有活动callback时返回Busy且不改准入；普通准入停止后，原有Cleanup/Close仍可释放并计入活动直到函数返回。产品Session的descriptor/capture/Commit/request/retained探测若Busy，native端恢复普通准入；恢复不因原Close仍在完成而失败。

准备成功后才进行native stop/join、detach/delete，再由Rust Session执行product finish，最后native library release和终态事件。父进程同时等待原子进程exit0，才回答NATIVE_SERVICE_UNMOUNTED并释放closed Session。实际Overlay文件和mount路径删除已读回核对。RootServed是原生内核根身份已验证，不是完整SDK Ready、全receive-loop证明或任意mapping引用清单。

[架构控制说明](../../architecture/68-native-workspace-control.md#standalone-windows-inherited-stream-entry-2026-11-02)、[原生连接说明](../../architecture/76-native-mount-session.md#product-native-companion-and-whole-callback-fence-2026-11-02)、[消费者及构建说明](../../../../tools/projfs-probe/README.md#standalone-native-product-entry)。

## 最终验证

| 范围 | 实际结果 |
| --- | --- |
| 独立产品链路 | 两次产品实例均root served、正常exit0；普通mkdir/read/write/rename/list、状态、Published Commit、held-handle Busy后继续I/O、新终止请求及重挂载通过 |
| 跨窗口内容 | 300023字节确定性非零binary原生写入/读取、Commit、新挂载和独立只读History逐字节一致 |
| 发布结果 | 第一次changed=true，第二次UpToDate changed=false；独立History恰好1条Workspace Commit、parent=None、head/root与内容一致 |
| 失败边界 | 9个预期拒绝：magic/truncated/zero-Workspace启动，native sequence/wrong-root/oversize/partial-header，owner EOF与重复控制编号；均exit1、不伪报正常卸载 |
| 回调直接测试 | 7项metadata/setup/provider/空闲fence-resume用例通过；另2个真实目标callback用例验证活动Open Busy、fence期间Close及活动Close期间resume |
| 严格检查 | MSVC /W4 /WX、clang-format、root daemon --lib/bin和probe all-target Clippy -D warnings、fmt、998产品文件扫描、37守卫和23计数器测试通过 |

[产品链路控制器](../../../../tools/native-service-test.mjs)只用诊断checker在挂载前准备合成Store、挂载后以公开History/Content接口独立校验；父子产品运行均未加载checker或诊断DLL。[最终运行](../../../../tmp/native-service-20261102/route-binary-fixed/result.json)、[只读History](../../../../tmp/native-service-20261102/route-binary-fixed/history.json)、[9个边界结果](../../../../tmp/native-service-20261102/boundaries-final/result.json)、[外部边界控制器](../../../../tools/native-service-failures.mjs)、[外部坏peer源码](../../../../tools/native-service-peer.rs)。坏peer不在产品src、不作为product selector或故障注入钩子。

[7项直接回调测试](../../../../tmp/native-service-20261102/callback-tests-command.json)、[2项真实callback证明](../../../../tmp/native-service-20261102/admission-correlated-command.json)、[证明源码](../../../../engine/crates/layerfs-fuse/tests/windows_callback_admission.cpp)。真实证明只经公开observer同步目标目录的Open/Close，无fake clock或product测试API。7项回执使用较早的相同接口实现，最后resume修正由2项精确目标证明覆盖，原binary身份保留；不把旧回执重标为最终程序。

[最终产品构建](../../../../tmp/native-service-20261102/product-final-build.json)包含10个native输入hash及父子binary身份；[严格检查完成记录](../../../../tmp/native-service-20261102/product-sealed-build-complete.json)、[最终checker构建](../../../../tmp/native-service-20261102/cross-window-checker-build.json)、[typed控制错误检查](../../../../tmp/native-service-20261102/control-typed-build-complete.json)、[产品守卫](../../../../tmp/native-service-20261102/guard-final.json)。build先行，所有测试执行显式≤120秒、无后台测试或循环失败操作。原Session23项测试及先前原生Git资格属于此前交付身份；本轮没有运行普通Git工作负载，不以这次基本I/O推断全部Git合格。

[逐项汇总](../../../../tmp/native-service-20261102/summary.json)、[回执对账](../../../../tmp/native-service-20261102/summary-audit.json)、[对账程序](../../../../tmp/native-service-20261102/reconcile.mjs)核对产品运行、失败结果、源/产物hash和mount/Overlay删除。

## 失败与修正不抹除

- 首次产品测试在用户handle关闭后立即unmount仍Busy：[原FAIL](../../../../tmp/native-service-20261102/route-first/result.json)。CloseHandle不是WinFsp Close证明。测试增加一次普通reopen及只读status等待原native Close，再发单独终止请求；不自动重试unmount、不提前forget/释放descriptor。此范围不保证任意缓存/mapping都能解除。
- 旧binding-verify固定要求三个Commit，误用在一Commit场景失败：[原件](../../../../tmp/native-service-20261102/route-observed/result.json)。新增工具侧service-verify核验一条Commit的全部provenance/head/内容，原三条Commit验证器未放宽。
- 跨窗口夹具误用Buffer.from第二参数而生成全零，独立History逐字节检查失败：[原件](../../../../tmp/native-service-20261102/route-final/result.json)。只读小程序已证明生成器行为；改用Uint8Array.from映射生成，独立断言保持，最终非零数据通过。没有归咎产品并降低覆盖。
- callback proof最初关联路径遍历中的父Open，因等不到该句柄Close失败：[首次](../../../../tmp/native-service-20261102/admission-proof-command.json)、[目录版诊断](../../../../tmp/native-service-20261102/admission-directory-command.json)。改按目标directory serial/handle精确关联后通过；不是用sleep/加长超时凑绿。产品resume在原Close仍active时允许恢复的竞态修正保留。
- 首次Rust构建缺Read trait而失败：[原始编译结果](../../../../tmp/native-service-20261102/rust-first-complete.json)；补导入和移除unused import，最终warning-denying checks通过。所有旧输出不覆盖、不改绿。

## 身份和源码计数

父提交511da7497a8dab79dd1e0591ddb66d1199ad5515；封版受测tree780cfd21a4e4aa31c35aa843fa7ae6f995feb119。daemon subtree2cc07c81c1cf1dde22b7c43ae17f3115e9e6b4dd、Fuse subtree622618f3555177432548e32d7a0b6945e7c595fb。之后只加入本报告。

| 最终运行字节 | SHA256 |
| --- | --- |
| Rust产品父进程 | 704b34d59149c449bbad6afcc1ea95490e30e1bac28503dfcfa914f3093185ee |
| C++产品伴随进程 | eede3cc6c8f7cc33d4e4e6daa04b9e054a5da9fcb37534ce3173fbe03413709c |
| WinFsp安装DLL | 94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3 |
| 仅供工具验证的checker | f3542099436e57676fd65e67e0a57a5bf7456118b89230b0ee83c47da4417bfd |

Hash核对是字节身份而非签名编译溯源；根Cargo manifest/lock、vendor、DSH、系统、driver未改，没有安装新全局依赖。全新Store由fixture显式Disposable/WAL/OFF创建，产品只打开已有Store并验证既有profile。

Production LOC: **107685 -> 109339 (delta +1654)**；Core38454不变，Engine66471→68125（daemon7986→8974，Fuse5391→6057），API2760不变。相同[production_loc.py](../../../../tools/production_loc.py)对exact first-parent与final-tested git archive计数：[before](../../../../tmp/native-service-20261102/loc-parent.json)/[after](../../../../tmp/native-service-20261102/loc-staged.json)。所有Rust binary/runtime及native C++/headers完整计入；工具/测试/文档排除，无测试删除或生产语义移出scope。counter SHA2568c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。

## 在途与明确未验证

任务3b7a154bc4保持doing。独立显式产品进程入口现已能实际运行，不再依赖诊断ABI；但SDK Sandbox注册、workspace.mount/status/Commit/unmount路由、普通Exec、公开鉴权/发现、安装/发布集成仍未接通。不得将这个新入口作为不经已运行Sandbox的SDK mount默认，不能只删Unsupported。

继承流是本次进程所有权通道，不是对任意恶意同用户进程/不可信binary的安全隔离；正常host与Session配对后才有终止证据。owner失联会失败退出，其OS清理不构成断电/crash恢复或安全forced unmount保证。固定frame版本是同构建内部协议，无跨版本兼容承诺。volume free-space为启动时backing volume观察，不是持续或独占容量保证。

原始失败保管主要在Rust parent；C++坏response/pipe故障也会fence，但未对所有异步异常、分配失败、交付失败、deadlock及启动/stop故障逐一注入。未验证普通Git、广义高并发、完整receive-loop Ready、任意kernel引用/可写mapping同步及成功解绑映射。frame/path窗口沿用当前UTF16/UTF8适配，未宣称所有WTF-8 native名称资格。Windows Store/root profile约束不变，不能以WSL/Linux补跑替代。

下一段应将这个显式产品进程与既有SDK native-Windows运行时/Sandbox生命周期真正接线，保持凭证继承、关联id、Busy可逆、原始结果和进程终态回执；先完成一个真实API调用方，不继续重复内部wrapper或重跑未变场景。本轮无新增品味判断点。
