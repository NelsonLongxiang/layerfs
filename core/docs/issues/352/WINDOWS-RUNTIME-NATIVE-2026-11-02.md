# Windows显式Runtime原生Session调用面（2026-11-02）

> **Status:** Dated implementation checkpoint; not release evidence or a released product contract.
> 最终真实运行回执2026-11-02T09:32:14.828Z，对账09:36:16.782Z（UTC；Asia/Shanghai同日17:32、17:36）。这是功能验证，不是性能测量。

## 交付与边界

[LayerFSRuntime](../../../../api/runtime/src/index.js)新增显式runtime.native.open/list，实际消费已经实现的Rust/C++ Windows产品进程。[Session manager](../../../../api/runtime/src/platform/native-windows/sessions.js)校验显式executable/host/WinFsp/Store路径、全新work/mount路径及catalog/cursor/Branch authority，认领本runtime的路径归属后启动一次。Workspace身份由密码学随机数新建；capability只入继承stdin启动帧，不进入argv、列表或调用方错误。

[进程客户端](../../../../api/runtime/src/platform/native-windows/session.js)等待真实原生root-service回执，返回不可变的{id,path,status(),commit(scope),unmount()}。Published Commit必须明确传入published，省略及application-visible都作用前拒绝。status计数/root/revision及Commit revision使用BigInt，不对u64取浮点近似；native.list是进程本地观察，root以decimal string返回，不是机器级发现或完整Ready证明。

每个调用只发一次单调id，严格检查reply id/kind/字段。Busy不破坏原服务；unmount在仍有原调用pending时本地拒绝，并在发出后停止新调用准入。终态行不足以完成卸载：必须同时收到原产品进程close(code0,signalnull)且无未解释尾字节，才释放runtime归属并resolve。任何错配、重复、坏数字、错误终止、reply EOF、未知结果或readiness deadline都保留原请求、原始回答/原因及process/stream对象，返回净化Unknown，不kill/end/reconnect/resend。stderr只保留4096字节诊断尾部及truncated标记，不宣称完整日志归档。readiness有显式等待期限，已准入操作没有自动timeout。

runtime.close在starting/serving/unmounting Session存在时作用前Busy，在retained存在时Unknown；不会暗中unmount、kill或关闭其余客户端来绕过这个结果。正常显式卸载后列表为空，runtime.close可重复调用。失联Session即使后来进程自行退出也保留不确定身份，不从exit猜正常卸载；恢复/接管API未实现。

这个调用面是**集成host显式拥有的本机文件系统Session，不是SDK Sandbox/Workspace**。它不伪造Sandbox、不autostart SDK Sandbox、不替换workspace.mount(sandbox,branch)的running-Sandbox契约。agent/backend/Node的原Workspace/Sandbox/Exec分发和Unsupported均未改，Store仍在原native route进程内打开，不新增Store RPC或worker。可执行文件由调用方明确提供并信任，不是恶意同用户binary、重解析点或路径替换竞态的隔离边界。

[公开使用指南](../../../../api/docs/runtime.md#explicit-windows-native-filesystem-sessions)、[控制架构](../../architecture/68-native-workspace-control.md#explicit-javascript-runtime-consumer-2026-11-02)。调用方必须已有authority并提供已构建产品程序；此API不发现/导出凭证、不安装driver或全局配置。

## 验证

| 范围 | 最终结果 |
| --- | --- |
| 公开runtime真实WinFsp | 原生普通mkdir/read/write/rename/list、并行status/Published Commit、Busy后I/O可用、明确新终止请求、原进程正常退出、mount/Overlay删除、新挂载读回通过 |
| 内容与History | 300023字节非零binary跨128KiB处理窗口，Commit/新挂载及独立只读History逐字节一致；1条Workspace Commit parentNone/head与root匹配，第二次UpToDate changedfalse |
| 外部peer协议 | **18项PASS**，不冒称WinFsp实证：validation、spawn-failure、fragmented、overlap、busy、foreign-id、duplicate-reply、overflow、root-mismatch、line-window、unknown、failed-terminal、partial-terminal、terminal-without-exit、late-ready、no-ready、bad-ready、reply-eof-live |
| 现有runtime回归 | surface及state两个选择PASS；非Windows/非native路由的native.open仍明确Unsupported |
| 静态检查 | Node语法检查、1000产品文件守卫、37守卫自测、23计数器测试及git diff --check通过 |

[真实API测试源码](../../../../api/runtime/test/verify/native_real.mjs)只通过公开LayerFSRuntime.native调用产品服务。诊断checker仅在挂载前造新合成Store、卸载后用公开History/Content只读校验；它不进入产品挂载路径。[最终实测](../../../../tmp/runtime-native-20261102/actual-final/result.json)、[执行回执](../../../../tmp/runtime-native-20261102/actual-final-command.json)、[只读History](../../../../tmp/runtime-native-20261102/actual-final/history.json)。最终root1/revision8，first Commit changedtrue、second changedfalse，终止nativeExit0/processExit0、dispatcher c0000120、overlayClosedtrue，所有runtime native归属归零后正常close。

[协议测试](../../../../api/runtime/test/native-session.mjs)及[外部peer](../../../../api/runtime/test/fixture/native-session-peer.mjs)不进产品src、无产品test selector/fault injection。每个用例独立执行并留receipt，证明：拒绝坏输入前不spawn；无进程的spawn失败可释放；readiness超时不kill原进程；reply EOF时仍活着的peer不被误报关闭；foreign/重复/溢出/root不匹配/错误终止原调用不重发；已收terminal但进程尚未退出时unmount仍pending。Busy、合法碎片/并行回答、重叠路径及明确终止后的释放也验证。

[18项原始回执索引及汇总](../../../../tmp/runtime-native-20261102/summary.json)、[只读对账](../../../../tmp/runtime-native-20261102/summary-audit.json)、[对账程序](../../../../tmp/runtime-native-20261102/reconcile.mjs)、[surface/state](../../../../tmp/runtime-native-20261102/runtime-regressions-final.json)、[守卫](../../../../tmp/runtime-native-20261102/guard-final.json)。peer失败案例中保留owned state不是未清理正常挂载：它们没有WinFsp且在自己的测试进程内自然退出，产品客户端没有执行kill/重发或伪造成功。

首次测试命令误把工作目录api内路径再加api前缀而MODULE_NOT_FOUND，未执行产品；修正命令后通过，[首个协议执行回执](../../../../tmp/runtime-native-20261102/protocol-first.json)。其余实现阶段没有产品测试FAIL被删改成PASS。EOF补充检测后已对封版源码运行全部18项和真实WinFsp覆盖，不把早期数据重标为最终身份。每条测试显式≤120秒，纯JS无需编译产物，先node --check；未后台测试或循环重试失败操作。

本轮只改JavaScript产品和文档/外部tests，engine Rust/C++、manifests/locks/vendor和既有产品binary均未变；复用上一轮编译字节，Rust/C++ build/test/Clippy本轮NOT_RUN，不声称Node测试重新编译了engine。已有独立产品WinFsp的9失败边界属于父提交证据，不重复运行且不并入本轮18项。

## 身份与生产源码计数

父提交5d24e25e5dd54ed32cac3efae7225bb98e769ff1；封版受测treeca6cb6968a2b3fa8e16be194ec0e56cc58e13ad7，runtime subtree0012b373dc9e989dec6b302b775680ce041c140d。之后只加入本报告。产品运行沿用Rust executable SHA256704b34d59149c449bbad6afcc1ea95490e30e1bac28503dfcfa914f3093185ee、C++ hosteede3cc6c8f7cc33d4e4e6daa04b9e054a5da9fcb37534ce3173fbe03413709c、WinFsp DLL94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3，checkerf3542099436e57676fd65e67e0a57a5bf7456118b89230b0ee83c47da4417bfd。Hash为字节身份，不是签名编译证明。

Production LOC: **109339 -> 109609 (delta +270)**；Core38454不变，Engine68125不变，API3030（原2760），其中runtime1214→1484。相同[production_loc.py](../../../../tools/production_loc.py)对exact first-parent与final-tested git archive计数：[before](../../../../tmp/runtime-native-20261102/loc-parent.json)/[after](../../../../tmp/runtime-native-20261102/loc-staged.json)。imports/forwarding/parser/lifecycle均计入，工具/测试/文档排除，没有范围移出、测试删除或第二实现藏于tools。counter SHA2568c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。

## 在途与不确定

任务3b7a154bc4保持doing。真实JavaScript调用方现已接通显式产品native Session；SDK Sandbox注册、agent.workspace.mount/status/commit/unmount与普通Exec还未集成，保持Unsupported。公共发现/鉴权、跨进程接管、安装/发行配置仍未实现；per-runtime列表不覆盖机器上所有进程。

所有Store显式Disposable/WAL/OFF；未改DSH、系统profile/PATH、driver或第三方源码。客户端保管不等于崩溃恢复：原始请求、结果和进程引用只在当前调用方进程内，caller退出由OS处置不构成安全force unmount。实际binary受信且路径竞态无完整隔离证明；token临时清零无擦除保证；stderr尾部不是完整日志；所有native metadata/UTF16/mapping限制沿用。完整Ready/任意kernel引用、mapping同步/成功解绑、广义并发/crash仍未合格。

下一段在现有运行时/SDK边界上选一个真实注册或受控调用方生命周期接线，不重复无消费包装，也不只删Unsupported或破坏running-Sandbox mount契约。原失败保管和终态回执继续复用，不新增worker/Store RPC。本轮无新增品味判断点。
