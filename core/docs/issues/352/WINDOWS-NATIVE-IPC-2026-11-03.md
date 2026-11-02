# 受限原生 Node IPC 的访问边界（2026-11-03）

> **Status:** Dated diagnostic and regression record; not IPC support, a release receipt or complete platform qualification.
> 封版实测读取：2026-11-02T17:46:36.063Z，即2026-11-03 01:46:36 Asia/Shanghai。

## 结论

已把原 spawn EPERM 定位到 **IPC 管道客户端打开**，而非 cwd、可执行文件、后代创建或 LayerFS 命令回执。当前固定环境中，服务端管道创建成功；随后以 libuv 所需 GENERIC_READ | GENERIC_WRITE | WRITE_DAC 打开客户端返回 **Win32 5（ERROR_ACCESS_DENIED）**。Node 在目标创建前将此错误报告为同步 spawn EPERM，errno -4048。

这是已复核的限制，不是已修复的 IPC。**本轮没有修改任何产品代码、token、DACL、宿主设置或第三方字节。** 普通继承标准流的后代仍可用；同一原实例在 IPC 拒绝之后可继续执行、明确 Commit 和正常关闭，没有普通 token 后备、重启或失败操作重放。

## 原始证据

[公开 SDK 消费者](../../../../api/runtime/test/verify/native_ipc_real.mjs)在真实 SDK Init／fork、原 resident create、bindClient、WinFsp mount 后执行两个观察目标和一个普通目标。[封版结果](../../../../tmp/native-ipc-20261103/actual-sealed/result.json)、[执行回执](../../../../tmp/native-ipc-20261103/actual-sealed-command.json)、[SDK trace](../../../../tmp/native-ipc-20261103/actual-sealed/sdk-trace.jsonl)。结果明确写作 **PASS observed denial, not IPC support**。

[外部 Win32 观察程序](../../../../engine/crates/layerfs-sandbox/tests/windows_ipc_probe.cpp)仅调用与 libuv 对应的公开 Windows API，不 include 产品私有源、不修改任何安全描述符、不 hook Node、不启动进程、不重试失败调用。其 stdout 保留：

- 原 token restricted=1、integrity=4096；token default DACL 含原用户及 policy SID 的 GA。
- CreateIoCompletionPort_loop：成功，Win32 0。
- CreateNamedPipeA_server：成功，Win32 0。
- 对新服务端的 OWNER/DACL、LABEL 查询均成功；实际管道 DACL 为系统／管理员／原用户 full access、Everyone／Anonymous read，**不含 token default DACL 中的 policy SID**。mandatory label 已是 low／NW。
- CreateFileA_client：失败，Win32 **5**；后续连接／IOCP关联没有执行。

[原 Win32 输出](../../../../tmp/native-ipc-20261103/actual-sealed/win32-stdout.txt)与[Node 输出](../../../../tmp/native-ipc-20261103/actual-sealed/node-stdout.txt)可独立读取。实际 Node 先断言 stat(process.cwd()).isDirectory()为true，再使用 stdio:[0,1,2,'ipc']。同步 spawn-call 精确报告 EPERM／-4048／spawn；原目标自行以19结束，原命令 finished 同为19且完整EOF，不把这个应用退出码改为0，也不让 SDK启动成功行冒充IPC成功。

该观察程序复现公开API阶段，没有拦截Node内部调用；与固定源码及Node行为共同支持上述定位，不声称捕获了Node内部GetLastError或所有Windows版本的对象创建策略。token default DACL不保证每种新对象实际采用同一descriptor。

## 固定源码链

实际Node24.12.0／libuv1.51.0，Node文件SHA256 **2ffe3acc0458fdde999f50d11809bbe7c9b7ef204dcf17094e325d26ace101d8**。tag v24.12.0解析到commit **70f6b58ac655234435a99d72b857dd7b316d34bf**，以下4份只读来源已逐Git blob／长度／SHA256核对：[清单](../../../../tmp/native-ipc-20261103/upstream-manifest.json)、[审计seal](../../../../tmp/native-ipc-20261103/source-seal.json)。未patch、vendor或构建第三方。

1. [process-stdio.c:231–249](https://github.com/nodejs/node/blob/70f6b58ac655234435a99d72b857dd7b316d34bf/deps/uv/src/win/process-stdio.c#L231-L249)：UV_CREATE_PIPE在创建目标之前建立stdio pair。blob181db92ea30d45090c3d0b9def6b4001903afd2d。
2. [pipe.c:249–309](https://github.com/nodejs/node/blob/70f6b58ac655234435a99d72b857dd7b316d34bf/deps/uv/src/win/pipe.c#L249-L309)：server/client权限均含WRITE_DAC，CreateNamedPipe使用null描述符；client使用GENERIC_READ／WRITE及WRITE_DAC。blobd05bfd28aec8b9e6abdbcd32fe1005e005e0b5a9。
3. [process.c:1005](https://github.com/nodejs/node/blob/70f6b58ac655234435a99d72b857dd7b316d34bf/deps/uv/src/win/process.c#L1005)调用stdio创建，错误早于CreateProcessW。blob27605ca36f44348a6c2f24adce93d9d9b3e8b6da。
4. [error.c:158–159](https://github.com/nodejs/node/blob/70f6b58ac655234435a99d72b857dd7b316d34bf/deps/uv/src/win/error.c#L158-L159)：ERROR_ACCESS_DENIED／ERROR_PRIVILEGE_NOT_HELD映射UV_EPERM。blob7abf906bb5c82312aeb9f3f30f39ab2cadc07eae。

[本机stdio原文](../../../../tmp/native-ipc-20261103/process-stdio.c)、[pipe原文](../../../../tmp/native-ipc-20261103/pipe.c)、[process原文](../../../../tmp/native-ipc-20261103/process.c)、[error原文](../../../../tmp/native-ipc-20261103/error.c)均为只读参考，不进入产品提交。最初长工具输出截断导致pipe源码JSON解析失败，检查已完成文件后改存完整原始输出再校验；未重跑产品操作。

## 拒绝后的实际消费者

同一原 resident、不重建挂载，IPC失败后明确执行另一条普通继承stdio的后代命令：

- 原退出码6、stdout精确为ordinary-child、stderr为空；在挂载内写入 after-ipc 文件。
- commands回到0，resident PID不变；Store读取该文件仍NoSuchPath、History仍0，未自动Commit。
- 明确 Published Commit后Store读回正确、History恰1条；原head **12ec653fea638f796ed7c6dfc60deaf6295f5abd1c9e764c8ba55253d0a88e0a04**。
- 原native handles／active明确归0后正常卸载；tokenClosed／desktopClosed true，resident exit0，runtime lists为空。

这条普通命令是独立执行请求，不是对失败IPC的重放或自动降权后备。业务需要额外Node IPC时仍应视为不支持，不静默去掉IPC继续同一任务。普通继承标准流的功能证据也不建立网络、任意named pipe或完整host隔离资格。

不把用户SID加入restricting SID列表、不扩大World／Users的pipe权限、不让应用修改全局管道ACL、不添加进程内hook或第三方补丁。加入用户SID会破坏原owner-private后端拒绝条件，不是窄修。若以后需要IPC，必须另有对象级创建／传递与权限设计和独立证据；本轮没有选择或实现该新机制。

## 检查、身份及LOC

观察程序严格MSVC14.40.33807、Windows SDK10.0.22621.0、C++17 /W4 /WX /MT构建通过，clang-format --dry-run --Werror通过。[构建回执](../../../../tmp/native-ipc-20261103/probe-security-build.json)，probe SHA256 **61e7ff6f50ccb0705690b8bd521178e62ccbe6637c75dc73031905ee2a70e71a**，源SHA256 **bbbf2dff5bff0c23e178daeebf9d011e16bd77683d953627d1475e6aea4e9dca**。测试先build／Nodecheck，每条显式≤120秒前台；后台只有精确LOC计数，job已收齐。

产品binary原样复用：host2b4cf30097dd845f0f6177f1b4ae78314da7971f97266788fb6a001761f8b3f5、parent7c51f2af77e8cb118103b96ef8c3409923a39dc18242dd8d3166f7566f471c80、addon99e5a93454ed1c8875a490d6401f2709e95927a8308e153ef94f5669e919217a、resident51afc4867d5a03c625f20554e977f72847ddc91c77c96b89a430e8e33030d48e，均再次字节核对。没有新产品构建；Rust tests／Clippy NOT_RUN — 产品源码未变。只有外部观察程序编译，不把其结果写成产品构建或IPC能力通过。

[守卫回执](../../../../tmp/native-ipc-20261103/guards-final.json)：1012生产文件扫描、37项guard和23项counter自测PASS；Node语法和diff whitespace通过。[原件对账](../../../../tmp/native-ipc-20261103/audit-command.json)、[汇总](../../../../tmp/native-ipc-20261103/summary.json)。本轮未发生产品／测试命令失败，最初宽观察收集标为OBSERVED而非合格，封版断言固定为精确拒绝；旧EPERM／ENOENT失败仍原样保留。

first parent **897d5bba2e3d86347bf8bb69ef0d4a4e69300b32**；受测／计数树 **af53eae0222a588a7669633d7cef9a6e73590e7c**。加入本报告仅文档差异，不改原harness字节。[精确比较](../../../../tmp/native-ipc-20261103/loc-comparison.json)、[父树计数](../../../../tmp/native-ipc-20261103/loc-parent.json)、[封版计数](../../../../tmp/native-ipc-20261103/loc-staged.json)。

**Production LOC: 111362 -> 111362 (delta +0).** Core38454、Engine69223、API3685不变。exact first-parent与final staged tree分别git archive，同counter production_loc.py --root archive --json计全部产品Rust／SQL／JS／C++／hpp，测试／文档／工具不计。counter SHA256 **8c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3**。没有产品src修改、测试删除、依赖、unsafe例外、第三方patch或计数搬迁。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。

## 交付范围

本轮完成IPC错误阶段的诊断及同实例拒绝／继续执行／正常终态回归，**没有实现受限Node IPC**。额外IPC仍不支持；不是一个未确认错误就能自动扩大权限的门禁，也不挡其它纯Windows工程。

现有native SDK对象接口仍pending_review、未ratified；本轮无新增品味判断。OCI image创建、native Bash、fullhost隔离、所有kernel／mapping drain、Git正常关闭、crash恢复和公开发现／发行仍未合格。旧验证器7PASS／2FAIL总体FAIL及原材料／snapshot／archive均不改。主task3b7a154bc4继续doing；下一段转向实际项目任务的SDK／原生Git完整状态与关闭证据，不循环更换管道参数或重跑本次拒绝原件。
