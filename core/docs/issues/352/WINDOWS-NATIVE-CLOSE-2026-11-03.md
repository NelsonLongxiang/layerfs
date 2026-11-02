# Windows 原生缓存引用关闭协调（2026-11-03）

> **Status:** Dated implementation and scoped functional evidence record. Minimal trusted-local Git object close and isolated active read-only view refusal pass. Full restricted Git, arbitrary kernel/mapping drain and release qualification remain unqualified.

## 实际修复

本轮将原Session已有的可逆关闭协调接入产品WinFsp关闭路径。普通卸载不再仅因已Cleanup的只读缓存文件仍持引用而直接拒绝：先由原Session检查可协调候选，再一次请求WinFsp缓存失效，只有原Close完成且引用／请求／完整回调归零后，才执行原prepare、native stop／join／detach、product finish、DLL release和parent终态。

这不是把Cleanup当Close，也不删除任何尚在使用的OpenFile。[产品协调](../../../../engine/crates/layerfs-fuse/src/windows/close.cpp)、[原Session准入](../../../../engine/crates/layerfs-daemon/src/native/coordination.rs)、[继承通道端口](../../../../engine/crates/layerfs-daemon/src/native/close_port.rs)、[API契约](../../../../api/docs/runtime.md#native-cache-reference-close-coordination)、[架构](../../architecture/68-native-workspace-control.md#windows-native-cache-reference-close-coordination-2026-11-03)。

**限定范围PASS：一次Git历史读取留下的3个对象引用现在能正常关闭；活动只读映射仍保持Busy和可用性。** 旧13／8引用的原FAIL不改，受限Git cwd规范化未修，不冒称完整受限Git或全部kernel drain完成。

## 路径和边界

1. 原host接到明确unmount后，以既有whole-callback门禁停止新普通请求；Cleanup／Close继续可入场。已有callback仍活动时先返回Busy，不因只核对单个RPC就假定回调完成。
2. 原Session锁内检查已有候选：每项必须cleaned、具名、regular file、无data-write／attribute-write／delete access；Commit／capture／retained outcome或目录／未Cleanup／丢名拒绝。clean unmount额外检查dirty inode／entry和pending base，不清洁则before-cache Dirty并释放协调入场，不补做Commit。
3. 原token既是协调所有权也是handle上界；逐项从现有索引取一个具名候选，核当前namespace仍对应同serial且为文件。协调时名称变更／Commit入场被原namespace gate挡住；不持Session锁跨OS I/O。
4. 原WinFsp owner通过已有DLL的FspFileSystemNotify，对候选提交一次**Filter=0／Action=0**缓存失效。无变更通知、无普通重开／读取、无重试、无token／ACL／Mount Manager／系统配置改动。它是异步失效请求，不是Close或OS排空回执。所有失效错误仍保原状态码，未知通道结果保管，不猜恢复。
5. 当前计数由同原Session的handle索引长度和active request事实取得，等待时不反复namespace读取／全表扫描。C++另核whole callback idle，覆盖Close provider返回之后的native response转换。固定10秒readiness期限内只观察原Close，不重复失效或延长期限。
6. 任意原引用仍在则返回可逆Busy、只撤销协调入场并恢复普通callback服务，不强制结束caller file／mapping／process。只有**真实Close归零、active0、完整callback完成**才重新执行原clean／discard prepare。后续停止／分离／逻辑关闭顺序不变，原native child及parent退出0与相关终态回执仍缺一不可。

[Session lifecycle](../../../../engine/crates/layerfs-daemon/src/native/lifecycle.rs)的clean-frontier检查抽为同一方法，被协调前和最终prepare复用；原standalone显式discard默认不变。新的继承控制22–25只在同一次已发起unmount内可用，依旧严格opcode／字段长度／token／游标／u64检查，无listener／Store RPC或SDK Exec协议。丢回复不重发，原input／Session／native owner继续保管。旧parent／host混搭不承诺协议兼容，也无不识别后fallback。

## 为什么不用旧普通重开诊断

固定WinFsp commit **14d6e0280ae15e2550c44d6dbc476be51649727f**的[create](../../../../tmp/native-coordination-20261103/create.c)仅在FileInfoTimeout为infinity等条件下打开FO_CACHE_SUPPORTED；当前host为0。[noncached read](../../../../tmp/native-coordination-20261103/read.c)对现有section执行flush时选择不purge，故普通重开后读取一个字节不能作为可靠清理机制。

同版[缓存失效实现](../../../../tmp/native-coordination-20261103/file.c)按名字查同FileNode并调用其缓存flush／purge逻辑，[volume notify](../../../../tmp/native-close-20261102/volume.c)是异步worker；Filter0不发文件变化事件。产品不复刻kernel处理、不改第三方或新增kernel driver，只使用公开WinFsp能力，并把唯一释放权留给原Close。[6份新增固定源Git blob对账](../../../../tmp/native-coordination-20261103/source-seal.json)均重新核对字节长度与blob SHA1。

## 最小Git：3个原对象到正常终态

[消费者](../../../../api/runtime/test/verify/native_close_real.mjs)创建独立Git fixture，真实SDK Init／fork后绑定公开native Session，挂载里仅执行1次git show HEAD:seed.txt，不重复旧35条Git任务。原输入完整根含.git，非投影／导出树替代产品数据路径。可信同用户模式明确，不自动转为受限SDK支持。

[封版结果](../../../../tmp/native-coordination-20261103/git-sealed/result.json)读取 **2026-11-02T19:55:26.854Z**（2026-11-03 03:55:26 Asia/Shanghai）：

- Git原root／finished exit0及双流EOF，输出精确，stderr为空。
- unmount前原handles3、active0、dirty0，3项为具名、已Cleanup、只读、无delete的Git commit205／tree36／blob28对象，保handle／serial／路径原回执。
- 一次明确unmount取得原nativeExit0、overlayClosed:true、parent processExit0、processSignal:null；dispatcher原c0000120仅按原healthy explicit stop处理。
- runtime_closed:true，sessions空。原1026字节路径的1024＋2字节分窗及未Cleanup外部fd持有时Busy检查继续通过。

这条链针对原先最小复现的缺口，不更改其[旧3引用观察](../../../../tmp/native-references-20261103/window-first/result.json)或[旧13引用FAIL](../../../../tmp/native-sdk-git-20261103/trusted-first/result.json)。本轮未重放旧整套Git、未声称已知原13项身份。

## 无cwd干扰的活动只读view：Busy可逆且数据可读

最初用Session.exec启动holder时，进程cwd本身持有挂载根目录，Busy可能先由目录准入拒绝。此前[view-first](../../../../tmp/native-coordination-20261103/view-first/result.json)、[view-final](../../../../tmp/native-coordination-20261103/view-final/result.json)、[view-sealed](../../../../tmp/native-coordination-20261103/view-sealed/result.json)保留，但**不计作隔离active section失效证明**。

随后只修改消费者，从挂载外部cwd启动同一个[公开Win32 holder](../../../../engine/crates/layerfs-fuse/tests/windows_section_holder.cpp)，不用Exec登记。[外部view结果](../../../../tmp/native-coordination-20261103/view-external/result.json)读取 **2026-11-02T20:00:33.903Z**（04:00:33 Asia/Shanghai），同封版product binary：

1. holder CreateFile／CreateFileMapping／MapView成功；关闭file和mapping两个handle后仅保留read-only view，ready回执明确这两次关闭。
2. 原Session实读4项，全部是file／cleaned／只读／无delete，没有directory或挂载cwd，commands0／active0／dirty0，因此不是Exec或目录引用先挡住准入。
3. 明确unmount执行后返回Busy、prepared:false、serviceKept:true；计数由**4降为1**，3个Git对象已真实Close，只剩活动view的文件引用。root／revision／head保持相同。
4. 返回Busy后向原holder发送p，实读view[0]仍为109，SECTION_READ确认still_mapped:true，未为了清理破坏视图。
5. 调用者明确发送x，holder检查UnmapViewOfFile成功并exit0；之后新的一次明确unmount正常完成，runtime_closed:true／sessions空。不是自动重试，也没有扩大10秒readiness期限。

[holder binary](../../../../tmp/native-coordination-20261103/section-holder/windows-section-holder.exe)SHA256 **61215d5732fd7c17e29763a84141b1268efe52a85532cb571d428dd84d6bf271**；MSVC strict构建。它只用公开Windows API且自身30秒安全截止；没有产品私有include／hook或额外Rust unsafe。

## 其他覆盖

| 范围 | 本轮结果 | 原回执 |
| --- | --- | --- |
| 原public Session | 9／9，新增2项：write／attr／delete／directory／not-cleaned／replaced-name拒绝，foreign token、协调可逆、原Close仍是release authority | [Rust结果](../../../../tmp/native-coordination-20261103/public-session-command.json) |
| Callback conversion/context/gate | 7组PASS，callbacks_idle仅在fenced且whole callback0才true | [callback结果](../../../../tmp/native-coordination-20261103/callback-absolute-command.json) |
| WinFsp owner | 6组PASS，未attach／失败后不能请求失效或终态 | [mount结果](../../../../tmp/native-coordination-20261103/mount-command.json) |
| 完整native回调 | 2项PASS，真实Open活动使fence Busy；Close provider完成后仍在callback时idle false，恢复准入仍可逆 | [admission结果](../../../../tmp/native-coordination-20261103/admission-command.json) |
| 真实SDK原client | mixed SDK／direct owner、Dirty before effects、原Published／UpToDate、完整binary remount、晚读command owner及原token／desktop终态PASS | [client封版结果](../../../../tmp/native-coordination-20261103/client-sealed/result.json) |
| 已有受限SDK argv／流 | 同新parent和checked host的flow PASS，不冒称最终另一构建身份 | [flow结果](../../../../tmp/native-coordination-20261103/sdk-final/result.json) |
| Guard／格式 | root／probe cargo fmt、Nodecheck、1016文件boundary scan、37guard＋23LOC selftests PASS | [checks](../../../../tmp/native-coordination-20261103/guards-final.json) |

封版client读取19:55:30.811Z，dirty拒绝后原服务继续可读，之后显式Published Commit与独立SDK History/readback正确；普通／mixed挂载和原instance均以原终态退出，runtime_closed:true。该证明不升级受限Git cwd、named IPC、OCI/Bash或全部host isolation资格。

Rust **1.85.1 offline／locked**，parent build与public Session no-run、daemon lib／native-bin和external Session strict Clippy通过；MSVC14.40.33807、SDK10.0.22621.0、C++17 /W4 /WX /MT，所有host／C++ test均先构建再前台运行。每次测试明确≤120秒。未跑Windows全仓all-targets：原Unix-only host_install问题保留，不假全仓green。无性能／cold-cache／一般peak或durability结论，Store全显式Disposable/WAL/OFF，Overlay MEMORY/OFF/EXCLUSIVE。

## 失败及操作留痕

- 新progress.active最初为usize而回执要求u64，Rust编译E0308，未生成新parent；类型修正后构建／Clippy与原Session tests通过。[失败构建状态](../../../../tmp/native-coordination-20261103/build-final-failure.json)保留；该次分段job输出已先前在会话读取，不伪造空text为完整错误日志。
- cargo fmt串命令曾在15秒截止时被终止；检查受影响文件发现external test尾部尚未格式化，之后用既有formatter完成root／probe格式，60秒命令正常结束。它不是functional test hang，不改变测试budget。
- Callback test第一次传相对DLL路径，LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR要求绝对路径，加载前exit1、未进入新断言；[原失败](../../../../tmp/native-coordination-20261103/callback-command.json)保留。改绝对路径后7组通过，未放宽断言。
- 固定source首次写输出目录未存在，shell在redirection前失败，创建本轮新目录后读取；不存在的memory.c路径404后停止猜路径，沿已读取cache实现继续。未改网络设置或第三方。
- 源码暂存命令超时留下空index.lock；[只读核对](../../../../tmp/native-coordination-20261103/index-lock-diagnosis.json)确认无Git进程、lock为本轮时间且0字节，精确核对绝对路径和时间后只删除该废弃锁，再暂存本席文件。[恢复回执](../../../../tmp/native-coordination-20261103/staging-collected.json)。没有宽杀进程／删除git状态／worktree／stash或他人文件。

## 证据身份、LOC和未完成范围

parent **70103f7d4a8b7c75987f8fa972302fad3cd47960**；计数树 **192dbc89b355addee30957335857ea90920d626d**；最终产品／消费者树 **1b800c029e77b47eded2de6cda1245146dd4028b**只在外部view消费者不同，产品source逐个相同。本报告加入后仅多文档。[source seal](../../../../tmp/native-coordination-20261103/source-seal.json)、[summary](../../../../tmp/native-coordination-20261103/summary.json)、[原件audit](../../../../tmp/native-coordination-20261103/audit-command.json)。

最终parent SHA256 **24f30149f774a24c2e351cbcf5c1143da9a385e639fd47809967a69f860c4cc2**；host **6a01e415fa4b26c04d32f15c4965f1ee7160c06dc1a13d322951a711be121426**，来自[sealed构建](../../../../tmp/native-coordination-20261103/build-sealed.json)。checked和早期host样本均保各自identity，不把旧PASS重贴到新binary。addon／WinFsp／resident／token配置未改。

**Production LOC: 111497 -> 111783 (delta +286).** Core38454不变；Engine69334→69620，其中daemon9299→9443（+144）、Fuse6096→6238（+142）；API3709不变，runtime2134、agent900。[比较](../../../../tmp/native-coordination-20261103/loc-comparison.json)、[父树计数](../../../../tmp/native-coordination-20261103/loc-parent.json)、[封版计数](../../../../tmp/native-coordination-20261103/loc-staged.json)。

双方exact git archive first parent／final staged production tree，同production_loc.py --root archive --json，产品Rust／SQL／JS／C++／hpp全部计入，tests／docs／tools排除；counter SHA256 **8c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3**不变。没有测试删除、新依赖、unsafe例外、第三方patch或source搬移，增长用于真实关闭协调／回执验证而非另registry。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。

仍未证明：旧13／8引用的身份和原样本恢复、完整35命令Git多发布／第三挂载闭环、受限GitDOS cwd兼容、writable／image／all kernel mappings、forced teardown、crash recovery及安装发行。零过滤失效的submission本身不是drain；本轮活动只读view证明不推广成所有映射安全资格。没有再用Mount Manager注册、token／ancestor ACL扩大或自动杀caller来绕过。

本轮完成产品窄修复及原Close／外部view／SDK消费者验证；主task3b7a154bc4继续doing。旧verifier7PASS／2FAIL和原Git数据／失败工件不变。本轮无新增业务品味判断，既有SDK调用形状提案仍未ratified；没有修改DSH、系统配置或其它会话工作。
