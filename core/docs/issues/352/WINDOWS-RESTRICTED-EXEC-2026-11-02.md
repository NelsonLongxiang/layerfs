# Windows受限命令与私有后端访问边界（2026-11-02）

> **Status:** Dated implementation checkpoint; not release evidence or a released product contract.
> 最终WinFsp实测2026-11-02T12:02:23.851Z，对账12:11:06.829Z（UTC；Asia/Shanghai同日20:02、20:11）。功能与权限验证，不是性能测量。

## 实现

显式runtime.native.open新增可选restrictedLauncher路径；未选时保留此前可信同用户执行。运行时生成每Session独有的随机限制SID，仅作为policy身份传给产品mount owner及命令启动器，不作为秘密或远程认证。原[项目绑定](../../../../api/runtime/src/platform/native-windows/sessions.js)不导出catalog/cursor，Store仍由Rust产品Session直接打开；SDK Sandbox/Workspace/Exec分发表与Unsupported未改变。

产品[Windows受限命令所有者](../../../../engine/crates/layerfs-sandbox/src/windows/restricted.cpp)位于Sandbox engine产品src，使用[受限令牌与桌面设置](../../../../engine/crates/layerfs-sandbox/src/windows/restricted.hpp)：CreateRestrictedToken(DISABLE_MAX_PRIVILEGE)、Administrators deny-only、额外restricting SID检查、低完整性4096、随机私有桌面。系统所需world/users/authenticated/logon/RestrictedCode SID保留在第二重检查中，用户SID未加入限制SID列表，且当前用户SID不能冒充policy。子令牌自身及其新建对象默认ACL允许受限应用自查，未扩大父进程/Store/Overlay/凭证的权限。无需全局用户、系统配置、驱动、Rust unsafe例外、第三方补丁或新依赖。

[WinFsp安全描述符](../../../../engine/crates/layerfs-fuse/src/windows/metadata.cpp)只为这个policy授予选定挂载的data/file rights及low mandatory label，不授WRITE_DAC/WRITE_OWNER；owner原full access保留。未选policy时仍为owner-only。格式不正确或等于当前用户的SID作用前拒绝。Rust[原生进程](../../../../engine/crates/layerfs-daemon/src/native/process.rs)只增加可选SID转交，由原[C++产品伴随进程](../../../../engine/crates/layerfs-fuse/src/windows/host.cpp)配置原有callbacks；不向命令发送Store/Overlay权限或数据服务。

启动器以CreateProcessAsUserW和显式继承handle名单启动目标，只给予stdin/stdout/stderr。目标身份、创建失败和原始Windows DWORD退出码从另一条私有继承管道返回；明确根取消从独立控制管道进入，对原process handle执行一次TerminateProcess，退出码1223。命令stdout不是lifecycle消息入口，不能通过打印LFS_EXEC_EXIT伪造完成；目标不继承这些control/receipt handles、原token或后端file。控制丢失不授权终止，发生异常不使用普通token回退、不重连或重发；没有进程树/Job终止或命令超时。每50ms有界等待原process及控制输入，不是失败操作重试或寿命上限。

[运行时adapter](../../../../api/runtime/src/platform/native-windows/restricted.js)严格检查start/exit/cancel关联、PID、u32范围、原launcher退出；before-effect失败只在原ack和原launcher exit1后释放，无ack或格式错误则保原chunk/pending/cause并返回Unknown。原[command owner](../../../../api/runtime/src/platform/native-windows/commands.js)继续区分target root exit、launcher close、原始输出EOF和caller stream消费EOF，保留背压/晚读，失败不杀进程或重放。command/finished增加restricted标记，root signal为null并保留实际DWORD；不把requested取消当成功终止。Session准入和正常unmount仍复用原callback/descriptor所有权，不依赖命令计数。

[公开runtime契约](../../../../api/docs/runtime.md#restricted-command-access-boundary-explicit-opt-in)、[控制架构](../../architecture/68-native-workspace-control.md#restricted-windows-command-backend-access-2026-11-02)、[显式构建入口](../../../../tools/build-restricted-windows.ps1)。C++启动器与SDK addon/daemon分别构建，不把新C++源码藏在工具目录；Rust仍沿用现有安全模块。

## 权限实证及回归

| 范围 | 实际结果 |
| --- | --- |
| 受限令牌 | 原生探针实读IsTokenRestricted=1、integrity4096；BCrypt/SystemFunction036随机数正常，可运行真实Node24.12.0 |
| 私有文件 | 真实Store、project.record、Workspace Overlay及template共4文件：GENERIC_READ均Win32 error5；WRITE_DAC/WRITE_OWNER均error5；Node readFile也得到EPERM |
| 父进程 | runtime、native Rust parent和未降权launcher共3个：PROCESS_VM_READ/QUERY及TOKEN_DUPLICATE/ASSIGN_PRIMARY/QUERY均error5 |
| 挂载业务 | 受限Node普通写入文本与300023非零binary；显式Published Commit后SDK独立读回、fresh native mount字节精确，第二次UpToDate |
| 控制 | 原target exit7、标准流完整；无效PE before-effect Failed且不降级；空参数/空格/中文/引号/尾反斜线5项argv精确；显式root cancel实际exit1223，文件系统服务继续可用 |
| 协议拒绝 | 9项：legal/before-effect/partial/duplicate/overflow/false-exit/bad-cancel/unknown/oversize通过；外部peer不是令牌隔离证明 |
| 原路径回归 | 9项普通native命令用例及真实WinFsp普通执行通过；两路各2097183字节、exit9/no implicit Commit、后代持文件Busy仍符合原行为 |
| native/静态 | 7项callback测试含坏policy拒绝及合法policy准入；MSVC C++17/W4/WX、daemon lib/bin build/no-run/Clippy-Dwarnings、fmt、1005产品文件扫描、37守卫和23counter测试通过 |

[真实权限测试](../../../../api/runtime/test/verify/restricted_native_real.mjs)、[最终实测](../../../../tmp/restricted-native-20261102/actual-final/result.json)、[执行回执](../../../../tmp/restricted-native-20261102/actual-final-command.json)、[原生权限观察者](../../../../engine/crates/layerfs-sandbox/tests/restricted_probe_windows.cpp)。测试使用真实SDK Init/fork和真实WinFsp，不通过诊断DLL、WSL或工具端Store实现；未降权SDK与受限命令各持真实独立进程。临时test home只对自己新建路径配置owner ACL，未修改任何既有profile/系统权限。

[协议测试](../../../../api/runtime/test/restricted-lifecycle.mjs)及[外部peer](../../../../api/runtime/test/fixture/restricted-peer.mjs)、[普通执行回归索引](../../../../tmp/restricted-native-20261102/summary.json)、[普通WinFsp实测](../../../../tmp/restricted-native-20261102/normal-actual-final/result.json)、[callback结果](../../../../tmp/restricted-native-20261102/callback-final-command.json)、[严格构建](../../../../tmp/restricted-native-20261102/scoped-build-complete.json)、[最终native构建](../../../../tmp/restricted-native-20261102/final-native-build.json)、[守卫](../../../../tmp/restricted-native-20261102/guard-final.json)。测试先build/no-run或node --check，每条显式≤120秒，不后台测试、不循环重试失败操作。

[汇总](../../../../tmp/restricted-native-20261102/summary.json)、[只读对账](../../../../tmp/restricted-native-20261102/summary-audit.json)、[对账源码](../../../../tmp/restricted-native-20261102/reconcile.mjs)核对13个native输入、实际binary字节及全部权限结果。Owner的成功释放还要求原target exit、launcher close、流EOF和filesystem终态，不拿PID存在/文件字节Hash代替这些事实。

## 原失败不抹除

初版private desktop未明确实际用户owner及window-station名称，命令在代码前以c0000142退出：[首次](../../../../tmp/restricted-native-20261102/probe-first/result.json)、[logon SID诊断](../../../../tmp/restricted-native-20261102/probe-logon/result.json)。明确用户DACL和station后跨过这个失败，但Node因无法查询自己的受限token而CSPRNG初始化失败：[原记录](../../../../tmp/restricted-native-20261102/probe-desktop-explicit/result.json)。独立native probe定位self-query拒绝，设置child-only token/default ACL后系统随机数正常且私有record仍error5：[修正观察](../../../../tmp/restricted-native-20261102/native-self-query/result.json)。没有加入用户SID跳过restricted检查或回退普通权限。

外部probe被clang-format排序为bcrypt.h先于Windows类型而编译失败：[原构建](../../../../tmp/restricted-native-20261102/hardened-build-collected.json)，只修第一方test头顺序。回执peer合法分支因argv位置误判失败：[原件](../../../../tmp/restricted-native-20261102/receipt-first-legal/result.json)，改peer argv3而不放宽产品检查。全部早期回执保持原hash/结果，未冒充最终资格。

Windows机制依据为[Restricted Tokens](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens)的双access-check和非默认desktop要求，以及[CreateRestrictedToken](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken)的flags语义。引用用于实现机制，不代表Microsoft替本实现做安全认证。页面访问曾有timeout/404，后已取得原文；未修改web endpoint配置。

## 架构图同步

更新现有[Draw.io源](WINDOWS-NATIVE-ARCHITECTURE.drawio)和[SVG预览](WINDOWS-NATIVE-ARCHITECTURE.svg)，明确registered runtime、restricted launcher、WinFsp/Session、私有后端拒绝、Commit和独立终止链。12个节点/10条边的唯一id与引用、XML以及全部标签一致性已核验：[结构记录](../../../../tmp/restricted-native-20261102/diagram-validation.json)。当前技能目录没有drawio-skill，未伪称调用；browser-use doctor无连接daemon，未改用户browser/profile、未声称视觉复核通过。SVG尺寸1280×850；产品支持与未合格范围在图中分列，后续可单独补视觉复核而不冒充已做。

## 字节身份与生产源码

父提交eeb53b091c2a667f27a7eae93ed924b1c12c65fd；封版tree3650431162eec45e208258db62df30915052f554，Sandbox subtree dd0eb1086cde84263e4cf2221b98696942cc3969、runtime subtree0823b48554327dd7e53635fb6d04f1a4dd5a1a57；之后只加入本报告。MSVC14.40.33807、SDK10.0.22621.0、C++17/W4/WX/MT，Rust1.85.1 offline/locked、root manifest与原.cargo输入不变；无新依赖、Rust unsafe豁免、driver或全局配置。

| 产品字节 | SHA256 |
| --- | --- |
| native Rust parent | dfa597f4db98e8662fd14e50562bc8382153bd85e750259bf90e65e4f4c8c766 |
| WinFsp产品companion | 9705e72d328049dd4af0931277165d052d127ebbd35e179f5a3a79cd4fdb0aa1 |
| restricted launcher | b4221d5bccd93eb1f54e25ea8f743bdfa5649510a1ec291abb3b50e734b968d1 |
| 独立native观察者（测试） | c670769f1aaa0b2dddb7c40cb75b4474d63a7b9b3324cb551cc93cdce377ded4 |
| SDK addon（沿用） | 99e5a93454ed1c8875a490d6401f2709e95927a8308e153ef94f5669e919217a |

Production LOC: **109944 -> 110344 (delta +400)**。Core38454不变，Engine68321→68638（daemon9070→9081，Fuse6057→6078，Sandbox3417→3702），API3169→3252（runtime1623→1706）。相同[production_loc.py](../../../../tools/production_loc.py)对exact first-parent和封版staged git archive计数：[before](../../../../tmp/restricted-native-20261102/loc-parent.json)/[after](../../../../tmp/restricted-native-20261102/loc-staged.json)。新增C++/hpp全部在Sandbox产品src并扫描计数，runtime adapter/转发/验证计入，测试/工具/文档/图源排除；未删测试或把实现移出产品。counter SHA2568c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。Hash是字节身份，不是签名编译链或隔离认证。

## 尚未完成与具体限制

task3b7a154bc4保持doing。这轮确立的是原生低完整性restricted token对选定mount与private backend之间的局部访问边界，不是完整SDK Sandbox。SDK create/close及Workspace mount/exec/status/Commit/unmount分发仍未接；公开发现/认证、安装发行、跨进程恢复和机器级唯一注册仍未实现。

系统和公开可读对象仍可能读取；网络、注册表、任意host filesystem、资源quota、process tree与OS攻击面没有完整隔离证明。限制SID不是凭证；可信caller和明确binary路径仍为前提，父路径重解析/TOCTOU或恶意同用户进程替换未全面隔离。命令无Job树回收，后代可存活；low integrity/单目标token不等于安全运行任意不可信agent代码。其余native name/mapping/kernel引用限制沿用，完整Ready/成功解绑/广义concurrency/crash仍未合格；process-local retention不等crash恢复。

下一段应推进真正running Sandbox所有权及SDK路由，并继续使用这次已经实现的权限边界和原进程回执；不能仅把explicit Session改名为Sandbox或删Unsupported。所有Store只执行Disposable/WAL/OFF，Durable未执行，无DSH源码或配置写入。本轮无新增业务品味判断点。
