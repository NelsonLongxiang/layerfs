# Windows原生Session普通命令执行（2026-11-02）

> **Status:** Dated implementation checkpoint; not release evidence or a released product contract.
> 最终WinFsp运行2026-11-02T11:04:12.519Z，对账11:05:43.715Z（UTC；Asia/Shanghai同日19:04、19:05）。功能验证，不是性能测量。

## 实现与明确边界

显式原生Session新增exec(executable,args,{env?})，由[运行时命令所有者](../../../../api/runtime/src/platform/native-windows/commands.js)在挂载根目录启动一个可信同用户Windows命令。它使用标准Node ChildProcess/streams，不发daemon Exec请求、不引入Store RPC/worker，不更改SDK Sandbox或workspace.exec的Unsupported。调用方提供绝对本地可执行文件和参数；没有隐式shell、命令超时、Commit、unmount或进程树监督。

返回不可变handle{id,pid,stdin,stdout,stderr,exited,finished,cancel()}。exited保留原根进程的{exitCode,signal}，非零/null不改成成功；finished另外等待原close及原始输出EOF、调用方透传流消费到EOF。两个不可变回执彼此独立，均不证明所有后代/文件引用消失。stdin是标准Writable，调用方明确写入/结束；stdout/stderr是原始字节流，以各64KiB高水位的PassThrough及OS pipe背压处理，不设总输出大小上限。标准库可能短时超过高水位一个输入chunk，高水位不是精确内存峰值声明。

Node内部child_process的flushStdio在根退出时会resume原始流。产品在启动前建立透传消费者，阻止未读取数据被无声排空；透传流满时也阻止根退出的resume越过背压。晚读和后代持流都保留字节。未消费流会按设计阻止finished；放弃/破坏流将原命令/错误/input/streams保为Unknown，不自动重发或杀进程。没有完整stdout/stderr归档或sink交付保证：调用方拥有其sink和错误，须同时排空两路或明确处理放弃。

cancel仅在调用方显式请求时，对原ChildProcess根进程调用一次Windows SIGTERM终止；不保证POSIX式优雅信号。重复pending取消Busy；根已退出返回requestedfalse。它不按进程名/PID重新发现、不终止后代或文件系统服务，不把requested当成exit/内核排空。文件系统unmount仍只由真实callback/handle/ref判断Busy，不由命令计数决定；无filesystem引用的命令可以在mount关闭后仍存活。

[Session](../../../../api/runtime/src/platform/native-windows/session.js)仅在serving时准入新命令，保留正常关闭文件系统但仍有命令完成所有权的观察；[runtime manager](../../../../api/runtime/src/platform/native-windows/sessions.js)在这些owner仍在时close作用前Busy，命令不确定时Unknown。命令丢失不会为完成runtime.close而暗中杀掉。list增加commands和executionRetained字段；command count不是后代inventory或排空证明。

环境只继承PATH/PATHEXT/SYSTEMROOT/WINDIR/TEMP/TMP/COMSPEC，其他env由调用方明确提供，名称按Windows大小写唯一。不会自动转发LayerFS部署/authority、addon选择和其他host env秘密；这只是环境卫生，**不是权限隔离**。命令仍有该Windows用户能访问的全部权限；无token lowering、Job object、AppContainer、容器image或Sandbox registration。仅供可信本机命令，不能用来执行不可信agent代码后宣称安全Sandbox。原SDK Sandbox/Workspace/Exec分发保持未接通。

公开用法与完整限制见[runtime指南](../../../../api/docs/runtime.md#trusted-host-commands-in-a-native-mount)、[控制架构](../../architecture/68-native-workspace-control.md#native-host-execution-and-filesystem-ownership-2026-11-02)。

## 验证结果

| 范围 | 最终结果 |
| --- | --- |
| 真实Windows产品执行 | 真实SDK Init/fork→注册native Session→普通Node命令在WinFsp mount写入文件及300023字节非零binary；退出9和两路各2097183原始字节精确SHA256通过 |
| 发布边界 | 退出后SDK仍NoSuchPath且History零Commit，证明未隐式发布；显式Published Commit后SDK读回与fresh mount内容一致，第二次UpToDate |
| 后代与Busy | 测试后代IPC确认已持流/文件后根退出4；根exit后native unmount仍Busy且普通I/O可用；外部marker让后代释放，再按真实status观察Close后发新终止请求成功 |
| 显式取消 | 单次根终止requestedtrue，第二请求Busy，原exit signalSIGTERM/nullcode保留，流EOF后命令完成；文件系统状态继续可读、最终正常unmount |
| 9项执行定向 | stream、late-consumer、backpressure、validation、spawn-failure、environment、cancel、process-before-streams、output-abandoned均PASS |
| 回归和守卫 | surface/state及fragmented/busy/terminal-without-exit/reply-eof-live通过；Node语法、1002产品文件守卫、37守卫及23计数器测试通过 |

[真实运行测试源码](../../../../api/runtime/test/verify/native_exec_real.mjs)、[最终回执](../../../../tmp/native-exec-20261102/actual-final/result.json)、[执行命令](../../../../tmp/native-exec-20261102/actual-final-command.json)。两路2097183字节SHA256均为6cf6c312318da2d187864a06539e020f6940dd96aad46d60f5b9405171173157；root9和cancelSIGTERM独立记录。标准Node、产品Rust/C++和SDK addon都是真实Windows程序，无诊断DLL、WSL/Linux worker或工具端文件系统实现。

[定向测试源码](../../../../api/runtime/test/native-exec.mjs)使用真实普通子进程和外部native协议peer；这9项不是WinFsp证明。覆盖输出2MiB+完整读回、根先退出后晚读49153字节、后代4MiB输出背压、参数/env校验、无进程spawn失败、敏感env不继承、一次根取消、文件系统已关但命令输出仍有owner及放弃输出保Unknown。背压用实际writableNeedDrain、buffer长度和producer完成marker观察，不用加长timeout凑通过。

[9项原始回执索引及汇总](../../../../tmp/native-exec-20261102/summary.json)、[只读对账执行](../../../../tmp/native-exec-20261102/summary-audit.json)、[对账程序](../../../../tmp/native-exec-20261102/reconcile.mjs)、[回归记录](../../../../tmp/native-exec-20261102/runtime-regressions-final.json)、[守卫](../../../../tmp/native-exec-20261102/guard-final.json)。所有测试先node --check，执行显式≤120秒，无后台测试/失败操作循环重发。

## 失败和源身份

最初process-before-streams用例根立即退出，未证明后代已独立存活，观察commands0而非1：[原失败命令](../../../../tmp/native-exec-20261102/process-before-streams-first-command.json)。改为测试后代detached并IPC握手，再退出根，保留原断言；最终WinFsp用同样的真实文件/流握手证明Busy，没有放宽产品结束条件。诊断时发现Node根退出resume原stdio，遂加入标准透传与resume背压保护并留下late-consumer/backpressure回归，不直接暴露可被自动丢弃的原stdout。

父提交8fe5dbf90ab0c3b36556013083de5d757459d6f7；封版受测tree58c3c51fcaf3e8215a771540442bca513d0a743a，runtime subtree7b14d640eea198367f02dabc4fc0e3e87dd60db3；之后只加入本报告。engine Rust/C++、manifest/lock/vendor及产品binary未改。Rust/C++ build/test/Clippy本轮NOT_RUN：复用父提交已编译字节，新的JavaScript真实调用对这些字节执行。旧回执保持原identity，不重标为本轮。

| 使用字节 | SHA256 |
| --- | --- |
| SDK addon | 99e5a93454ed1c8875a490d6401f2709e95927a8308e153ef94f5669e919217a |
| native Rust parent | 079b4dcfb992946ccd346ea4ac133116ab52cb44196b656ceb8dc62b75f3a6c6 |
| native C++ companion | eede3cc6c8f7cc33d4e4e6daa04b9e054a5da9fcb37534ce3173fbe03413709c |
| installed WinFsp DLL | 94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3 |
| Node24.12.0 | 2ffe3acc0458fdde999f50d11809bbe7c9b7ef204dcf17094e325d26ace101d8 |

Production LOC: **109824 -> 109944 (delta +120)**。Core38454/Engine68321不变，API3049→3169（runtime1503→1623）。相同[production_loc.py](../../../../tools/production_loc.py)对exact first-parent和封版staged git archive计数：[before](../../../../tmp/native-exec-20261102/loc-parent.json)/[after](../../../../tmp/native-exec-20261102/loc-staged.json)。新增执行adapter、parser/ownership与imports全计入，测试/工具/文档排除，未删测试、无生产实现移出scope。counter SHA2568c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。

## 在途与未验证

task3b7a154bc4继续doing。可信Windows命令到原生挂载I/O、执行流/exit/明确取消及显式Commit闭环已可实际运行；SDK Sandbox/Workspace/Exec family仍Unsupported。下一段须解决真正的命令权限/隔离、已运行Sandbox生命周期及其SDK路由，不可把这个same-user helper改名当Sandbox。无公开发现/认证、安装发行或跨进程接管；挂载失联保管、命令进程内retention不等crash恢复。

任意后代、映射/句柄和内核引用不由command count/exit/EOF完整枚举；没有job-tree cancellation，根取消不保证后代退出。64KiB窗口不声明驻留峰值资格，极限输出、输入失败、各种OS故障未全覆盖；同用户路径替换及环境显式注入由受信caller承担。Store只用Disposable/WAL/OFF，无Durable执行，无DSH/系统profile/driver更改。本轮无新增品味判断点。
