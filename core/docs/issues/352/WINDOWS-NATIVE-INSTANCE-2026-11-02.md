# Windows原生驻留执行实例生命周期（2026-11-02）

> **Status:** Dated implementation checkpoint; not release evidence or a released product contract.
> 最终WinFsp实测2026-11-02T13:14:13.291Z，对账13:18:47.220Z（UTC；Asia/Shanghai同日21:14、21:18）。功能和原进程所有权验证，不是性能测量。

## 本轮真实达成的生命周期

[LayerFSRuntime](../../../../api/runtime/src/index.js)新增native.create及native.instances，创建一个实际驻留Windows进程、原始受限主令牌和随机私有桌面，收到原进程就绪回执后才返回immutable instance{id,project,mode,status,mount,close}。mode明确为windows-restricted，不是OCI镜像。create只建立执行上下文和owner-private工作根，不自动导入、创建Store或挂载。

[实例manager](../../../../api/runtime/src/platform/native-windows/instances.js)只接已注册项目、明确产品可执行文件和fresh工作路径；项目Store选择在创建时固定。原[Session manager](../../../../api/runtime/src/platform/native-windows/sessions.js)统一预留实例根，拒绝不属于它的重叠独立挂载；每次instance.mount(branch)在原工作根内选新编号work/mount路径，消费同一still-running实例。挂载不创建或重启实例，不默认选Branch，不放行main，文件系统数据面仍为原Rust/C++产品链。

[JavaScript实例所有者](../../../../api/runtime/src/platform/native-windows/instance.js)持有原ChildProcess和control，严格关联canonical非零递增id，分别观察starting/running/closing/retained。status是原控制回执加本地Session归属，不解决历史未知结果。active mount、仍在mount尝试或命令completion仍被持有时，close作用前MountsActive；未知Session返回Unknown，pending原control返回Busy。runtime.close先拒绝仍活跃／不确定实例，不能暗中unmount、kill或关闭项目客户端绕过它。

[原生实例owner](../../../../engine/crates/layerfs-sandbox/src/windows/instance.cpp)实际持有original restricted token和private desktop；control只接受精确status/launch/close语法，拒绝尾字段、NUL、超窗、非规范或重复id。EOF不是正常close。正常终止检查原CloseDesktop/CloseHandle结果，失败保原状态、不由析构重试；成功才发送token_closed/desktop_closed终态，运行时还必须等原进程exit0且无未解释尾字节才释放归属。重复closed handle.close返回已记录receipt，不发第二次stop。工作根保留，项目历史不删除；原句柄释放不等于所有后代及kernel引用消失。

## 原始令牌创建与句柄交接

最初尝试让兄弟进程复制已创建的受限token后CreateProcessAsUser，Windows拒绝win32=1314（所需特权未持有）。未申请管理员特权、未重建token或使用普通权限回退。改由原驻留进程使用自己的原始token创建目标，再把原目标process handle交给命令所有者：[launch handoff](../../../../engine/crates/layerfs-sandbox/src/windows/launch.cpp)、[命令owner](../../../../engine/crates/layerfs-sandbox/src/windows/restricted.cpp)。

每次命令owner准备private anonymous请求／响应管道，将只有三个数据stdio的副本及原helper进程incarnation交给resident。argv、cwd和explicit环境在bounded Windows UTF16 frame中传送，不含Store authority。双方在复制handle之前检查PID加creation time及原进程仍running，避免只凭可能复用的PID接管。target由原token/desktop一次创建，只继承explicit stdin/stdout/stderr列表；resident把原target handle以wait/query/terminate所需权限转交command owner，关闭自己的成功副本。命令等待、流、退出和明确root取消仍由command owner处理，resident不是命令supervisor，文件系统daemon更不监督命令。

[restricted adapter](../../../../api/runtime/src/platform/native-windows/restricted.js)先通过prepared handle请求获得原resident handoff确认，同时接收原command owner的target start/exit。两路证据可乱序，只有相符才交付started／exit；resident transferred与command before-effect refusal矛盾时保Unknown。确定create拒绝须原ack支持，不拿另一次观察改写原结论；partial/失联保原input、bytes/cause/handles/process，不重连或重发。未对resident公布的remote copy在失败前释放，已公布副本在不确定交接中保原所有权；不猜测撤销已创建进程。JavaScript不获得原token handle或desktop authority。

原[exec所有者](../../../../api/runtime/src/platform/native-windows/commands.js)继续区分root exit、owner close、raw stream和caller-visible stream EOF；cancel只对原target handle一次，非PID重查、进程树或文件系统终止。被关闭／retained实例不准入新命令。原独立native.open及restrictedLauncher模式保持可用，不被resident模式替换。

公开使用及限制见[runtime说明](../../../../api/docs/runtime.md#resident-native-execution-instances)、[控制架构](../../architecture/68-native-workspace-control.md#resident-windows-native-execution-instance-2026-11-02)。private handoff是同构建Windows-x64内部格式，不是兼容承诺、网络监听或认证服务。

## 验证结果

| 范围 | 最终结果 |
| --- | --- |
| 真实resident闭环 | runtime.create得到actual running进程／token／desktop；原实例内两个同时挂载的Session运行命令，共同观察同一随机private desktop，原实例PID一直相同 |
| 文件与Store | 受限命令读取Store仍error5，mount写入文本及300023非零binary；明确Published Commit后SDK独立读回、另一挂载精确读回，第二Commit UpToDate |
| 所有权 | active Session时close返回MountsActive；明确取消使用原target handle，exit1223且实例仍running；两挂载卸载后status归零，原token／desktop checked close及resident exit0；closed实例mount拒绝且不造第3个mount |
| 实例协议 | 14项PASS：validation/legal/setup/foreign/wrong-kind/eof/partial/oversize/duplicate/duplicate-ready/wrong-pid/late/failed-close/terminal-live；外部peer不建立真实token资格 |
| 句柄／命令回执 | 13项PASS：原9项加handoff-legal/refused/mismatch/lost；延迟ack前不交付start，矛盾结果不当作before-effect释放 |
| 原生control | 11项PASS：正常原close、duplicate/trailing/negative/leading-zero/overflow/zero/truncated/NUL/EOF/window拒绝；失败不伪报closed |
| 既有路径 | 原standalone受限WinFsp权限／argv／Commit／取消回归通过；runtime surface/state及3命令所有权回归通过 |
| 构建和守卫 | MSVC14.40.33807 C++17/W4/WX/MT SDK10.0.22621.0 build通过；Node syntax、1010产品文件守卫、37守卫与23counter测试、root Rust fmt通过 |

[真实resident测试](../../../../api/runtime/test/verify/native_instance_real.mjs)、[最终实测](../../../../tmp/native-instance-20261102/actual-final/result.json)、[执行回执](../../../../tmp/native-instance-20261102/actual-final-command.json)、[真实SDK Init](../../../../tmp/native-instance-20261102/actual-final/init.json)。probe的desktop观察走公开OS接口；测试不include/recompile product private source，原SDK Store addon与WinFsp都为真实产品binary。测试名称沿用borrowed-original-context只表示原上下文消费；最终代码不导出或在兄弟进程借用token。

[14项runtime测试](../../../../api/runtime/test/native-instance.mjs)和[独立peer](../../../../api/runtime/test/fixture/native-instance-peer.rs)、[13项回执测试](../../../../api/runtime/test/restricted-lifecycle.mjs)及[外部wire peer](../../../../api/runtime/test/fixture/restricted-peer.mjs)、[11项真实control测试](../../../../api/runtime/test/verify/native_instance_controls.mjs)及[结果](../../../../tmp/native-instance-20261102/controls-sealed/result.json)。peer fixture在test树，产品不读其environment选择器。全部先build/no-run或node --check，各次执行显式≤120秒、无后台测试和失败操作循环重试。

[原standalone受限回归](../../../../tmp/native-instance-20261102/direct-restricted-final/result.json)、[surface/state与命令回归](../../../../tmp/native-instance-20261102/runtime-regressions-final.json)、[守卫](../../../../tmp/native-instance-20261102/guard-final.json)、[MSVC工作完成记录](../../../../tmp/native-instance-20261102/sealed-native-build.json)、[原completion-notification字节只读核对](../../../../tmp/native-instance-20261102/sealed-native-build-readback.json)。最后job_output已经被finish notification消费了输出，记录的text为空但job exit0；readback明确标注为编译后hash观察，不冒充第二次编译或签名溯源。

[原件索引与汇总](../../../../tmp/native-instance-20261102/summary.json)、[只读对账](../../../../tmp/native-instance-20261102/summary-audit.json)、[对账程序](../../../../tmp/native-instance-20261102/reconcile.mjs)。本轮没有Rust产品实现改动、Cargo依赖或manifest/lock变动，Rust build/test/Clippy NOT_RUN，复用父提交native parent、WinFsp及addon。新的C++产品src全部在正常显式构建中，不把实现移到tools。

## 原始失败与确定性修复

首次真实resident已成功create/mount，但兄弟进程借token后目标create失败：[原FAIL](../../../../tmp/native-instance-20261102/actual-first/result.json)、[原执行](../../../../tmp/native-instance-20261102/actual-first-command.json)。独立诊断保原borrow回执phase=create win32=1314 startedfalse，同时显式关闭该诊断自己的原resident：[精确Win32观察](../../../../tmp/native-instance-20261102/borrow-observation/result.json)。改为原resident创建而不提升权限，原始错误及已初始化workspace输出保留；没有重放同次失败或通过重建token凑绿。

此前完成的受限权限证明不替代本轮驻留生命周期，本轮也不改旧失败结果。CreateProcessAsUser本机权限事实由上述实测确定，未凭外部文档授权执行系统权限变更。无DSH、profile、driver、全局账号或系统配置更改。

## 源身份和生产源码计数

父提交17d73fa42f69af0f41643be6f5e1cbb4609f7bc2；受测封版tree0978d12b250e770bb7a7dc5719c54ae22949b0df。Sandbox subtree8c30830ea545df9ab514a1a69d4ef338d54166ea，runtime subtree3111e8c9db8558a1d6b121b84dbb34e6a26108f0；封版后只加入本报告。

| 最终使用字节 | SHA256 |
| --- | --- |
| resident／command owner | 51afc4867d5a03c625f20554e977f72847ddc91c77c96b89a430e8e33030d48e |
| independent access probe | 4f3a62e095ac3791d2c374fe3800e8bd073b4f74bc389792507dd3fd2fbebfed |
| Rust native parent（沿用） | dfa597f4db98e8662fd14e50562bc8382153bd85e750259bf90e65e4f4c8c766 |
| WinFsp product host（沿用） | 9705e72d328049dd4af0931277165d052d127ebbd35e179f5a3a79cd4fdb0aa1 |
| SDK addon（沿用） | 99e5a93454ed1c8875a490d6401f2709e95927a8308e153ef94f5669e919217a |

Production LOC: **110344 -> 111050 (delta +706)**。Core38454不变，Engine68638→69098（Sandbox3702→4162，其余不变），API3252→3498（runtime1706→1952）。相同[production_loc.py](../../../../tools/production_loc.py)对exact first-parent和staged git archive计数：[before](../../../../tmp/native-instance-20261102/loc-parent.json)/[after](../../../../tmp/native-instance-20261102/loc-staged.json)。C++/hpp驻留进程、句柄交接及JS runtime ownership/forwarding全部计入，tests/tools/docs排除；未删测试或把产品实现移出scope，LOC增长是原进程／句柄／生命周期实际新增，不称算法简化。counter SHA2568c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。Hash是字节身份而非安全认证或编译签名。

## SDK契约差异与下一步

任务3b7a154bc4保持doing。原生实例create→mount→exec/status/Commit→unmount→close的running-context闭环已实现且真实消费者通过，不再描述为只有目录、孤立进程或需要重新造token；但它不是现有SDK的container-image Sandbox。SDK当前image语义明确为OCI/Docker容器镜像，原生实例mode选择Windows受限token/desktop，不能静默忽略image、伪造容器Ready或仅删Unsupported。唯一待属主明确的接口取舍是：是否在SDK为Windows显式引入native平台模式（image不适用，能力正面区分），而不声称与容器隔离等价。

没有把这个契约差异当所有工程的门禁：本轮已完成真实原实例所有权。后续可继续补权限/句柄/运行时注册消费的确定性缺口，但不再增加重复的explicit薄wrapper；接SDK容器族前须保持现行image与runningSandbox/no-autostart契约。公共endpoint发现/认证、发行安装、跨进程接管、机器唯一注册和所有异常transfer注入仍未实现。

同用户可信控制方可选择product binary及project路径；resident handoff的远程句柄号不是公共认证credential。任意恶意同用户进程、重解析路径/TOCTOU、手工复制或插入control尚无完整隔离证明。process创建服务的原token不能被目标继承；本轮实测private Store拒绝，但general host confinement、网络/registry/quota、后代tree排空、任意mapping/kernel引用/成功解绑/crash恢复仍未qualified。关闭token/desktop句柄只证明本owner release，不证明OS对象已无其他后代owner。Store只执行Disposable/WAL/OFF，Durable未运行。本轮无新增业务品味判断点。
