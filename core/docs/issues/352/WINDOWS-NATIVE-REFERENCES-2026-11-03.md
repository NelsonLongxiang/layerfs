# Windows 原 Session 有界引用观察（2026-11-03）

> **Status:** Dated implementation and functional evidence record. Read-only owner observation is implemented; Git normal-close qualification remains FAIL. Not a release or kernel-drain receipt.

## 本轮实际交付

新增公开native Session的reference(after,offset)观察：每次查原有handle索引中的下一项，拷贝至多1024字节路径窗口，返回handle／serial、file／directory、lookup／Cleanup及data-write／attribute-write／delete访问事实。它用于解释Busy和保留原owner事实，不用于自动回收。[公开契约](../../../../api/docs/runtime.md#native-reference-observation)、[架构接线](../../architecture/68-native-workspace-control.md#bounded-windows-native-reference-observation-2026-11-03)。

[原Session实现](../../../../engine/crates/layerfs-daemon/src/native/observation.rs)直接读取已有BTreeMap，不新增镜像registry、Store查询、全树扫描、handle序号、固定快照或持有pin。没有Store／Overlay schema变化、C++／token／ACL修改、新依赖、Rust unsafe例外或第三方补丁。[源码seal](../../../../tmp/native-references-20261103/source-seal.json)。

[原控制通道](../../../../engine/crates/layerfs-daemon/src/native/control.rs)仍为进程继承stdin/stdout，无网络listener或外部重连；[回执编码](../../../../engine/crates/layerfs-daemon/src/native/receipt.rs)在同原Session锁下取得一条有界观察，释放锁后发送。输入仍受128字节处理窗约束，1024字节路径编码为hex，回执行长度小于既有4096字节接收窗。路径不经stdout trace重复输出，不包含Store binding或backend主机路径。

[JavaScript原Session](../../../../api/runtime/src/platform/native-windows/session.js)验证u64 BigInt输入、request correlation、严格字段／kind、非倒退handle、path窗口长度及next-offset进度。损坏回执仍Unknown、保留原请求／进程且不重放。Session的state／status／Exec／Commit／unmount拥有关系不变；SDK既有对象未增加第二份mount或command登记。

## 查询不是释放证明

- after=0n／offset=0n从第一项开始；每次结果是原handle表的一次观察，不是某个时刻的完整kernel／section清单。
- found:false只表示这次观察在after之后没有原native handle，不证明全OS对象消失。
- path是至多1024字节的原路径提示；继续同一路径窗口保持after不变、offset用nextOffset。推进下一handle才设after为返回handle、offset为0。
- 路径是remembered hint，不是新的namespace lookup或当前名字权威。改名／取消链接会更新或清空提示；两次查询之间也可能发生Close。调用者不能把不同handle／serial／flag／length窗口拼在一起；即使相同header，也不证明同长度路径期间没变。
- 以Buffer返回原UTF-8字节，窗口可以切在码点中间；拼完后才解码。未记路径的pathBytes为null，合法末端窗口可为空，越界偏移明确InvalidInput。
- 查询不触发文件I/O、Cleanup、Close、Commit、coordination、入场栅栏或重试。Cleanup仍不等于Close；无force或延长等待来消除Busy。

## 最小消费者：一次Git历史读取

未重跑旧35条Git任务，也未试图接管原13引用挂载。新增[最小消费者](../../../../api/runtime/test/verify/native_references_real.mjs)在独立临时源上用3条普通Git设置命令创建小型已提交fixture；真实SDK Init取得其初始根，fork后通过公开runtime.native.open绑定完整根，在挂载内仅执行**1次git show HEAD:seed.txt**。这是明确的trusted-local范围，不是受限SDK失败后fallback，更不是受限Git支持证明。

[初次具体引用观察](../../../../tmp/native-references-20261103/minimal-first/result.json)读取2026-11-02T18:59:44.917Z（2026-11-03 02:59:44 Asia/Shanghai）。之后[最终分窗消费者](../../../../tmp/native-references-20261103/window-first/result.json)读取19:04:41.495Z（03:04:41 Asia/Shanghai），在同产品binary下增加长路径字节分窗验证，不是重复选取较好Git关闭结果。

最终消费者先用普通外部文件API打开两个只读文件，查询到原native handle103／serial9和handle105／serial36，均未Cleanup；在查询前后revision／root／head及完整状态保持相同，unmount Busy保服务。调用者再明确关闭自己两个fd，未由文件系统代为关闭。

其中长路径为**1026字节**，公开API实收1024＋2字节；第一个窗口末字节为UTF-8三字节字符的首字节，拼接字节与原路径完全相同；1027的越界偏移被拒绝且原状态保持。没有为了诊断提高产品总路径上限或另建全路径快照。

接着一次Git历史读取返回原exit0／stdoutEnded／stderrEnded，stdout精确为minimal Git history payload加换行，stderr空。[命令原回执](../../../../tmp/native-references-20261103/window-first/git-command.json)。之后在commands0／active0／dirty inode0／dirty entry0时，原native handle表留下3项：

| 原handle | serial | 原Workspace路径提示 | 已核对象种类 | 原访问事实 |
| --- | --- | --- | --- | --- |
| 168 | 31 | /repo/.git/objects/3a/e598d6761a35dc6d31fe49f85322a3b8b830ef | commit，205字节正文 | file、lookup、cleaned=true；data／attribute-write／delete均false |
| 169 | 32 | /repo/.git/objects/ad/89b3e977143ed2764604148fe22969c7a0459b | tree，36字节正文 | 同上 |
| 172 | 30 | /repo/.git/objects/2b/42c8b9e57a2626d419f007937ad0ffb586cb3e | blob，28字节正文 | 同上 |

对象种类由**原关闭fixture输入**的压缩对象字节解码其Git header，并重算Git SHA1与对象路径一致，未再读取live mount来改变引用。原handle／serial／Cleanup与权限来自本次Session查询。[分项汇总](../../../../tmp/native-references-20261103/summary.json)、[原件审计](../../../../tmp/native-references-20261103/audit-command.json)。

这3项已Cleanup但没有原Close证明，故明确普通unmount仍Busy且serviceKept:true；runtime_closed:false、原Session保留serving。消费者为完成诊断记录而退出，但**退出不是上述服务正常终态或系统资源回收证据**，没有调用kill、force、额外Commit或延长等待。原Busy样本和临时源均保留，不报告正常关闭PASS。

## 与旧失败、关闭协调的关系

[旧Git记录](WINDOWS-NATIVE-SDK-GIT-2026-11-03.md)中13个引用只有计数而无本次新增字段；不能把新3项身份倒填到旧13项，也不能把3引用或之前8引用的失败称为同一底层对象。本轮证明一个更小的可复现状态：一次历史读取也会留下已Cleanup、只读、具名的Git对象owner。它尚未证明这些引用的具体内核section来源或产品泄漏位置。

现有[关闭协调](../../../../engine/crates/layerfs-daemon/src/native/coordination.rs)仅允许已Cleanup、具名、只读、无delete access的文件候选，核对serial／path并在原Close后才许可prepare。[旧外部诊断消费者](../../../../tools/winfsp-probe.cpp)的协调接线在诊断拓扑中；当前产品[端口](../../../../engine/crates/layerfs-daemon/src/native/port.rs)和[原生host](../../../../engine/crates/layerfs-fuse/src/windows/host.cpp)仍是callbacks fence后直接prepare，并没有该完整协调接线。

本轮没有仅凭相似flag就将诊断重开／读取逻辑搬进正常关闭，也没有将新只读查询作为自动回收触发。下一实作可针对这3个原对象身份验证一条可逆、有原Close回执的协调路径，但必须保留写／delete／directory／未Cleanup／changed-name／active映射等拒绝，不得Cleanup当Close或对失败操作重放。本轮完整Git关闭仍FAIL，受限GitDOS cwd规范化仍FAIL，Mount Manager系统注册路线不再尝试；旧验证器7PASS／2FAIL保持原样。

## 验证清单与边界

- 固定Rust1.85.1、offline／locked，原生parent build、lib／bin no-run和warning-denying scoped Clippy通过。[构建初段](../../../../tmp/native-references-20261103/build-first-collected.json)、[完成回执](../../../../tmp/native-references-20261103/build-first-complete.json)。首先cargo +1.85.1 fmt因本机没装该工具链rustfmt而失败，编译未开始；保留[原失败](../../../../tmp/native-references-20261103/build-first.json)，之后用本机既有cargo fmt，不安装或改变profile／工具链配置。Rust编译仍固定1.85.1。
- [公开原Session测试](../../../../tools/projfs-probe/tests/product_native_session.rs)7／7通过，0ignored；新增2项覆盖empty／MAXcursor／末端与越界、file／directory／权限、查询不分配handle或改变frontier、Cleanup后仍Busy、原Close消失、rename／unlink提示变化不pin旧名字。沿现有Fixture显式Disposable/WAL/OFF，不include私有源码、不改生产测试分支。[原测试结果](../../../../tmp/native-references-20261103/product-session-command.json)、[no-run／Clippy](../../../../tmp/native-references-20261103/product-session-build-collected.json)。lib／bin no-run不是额外功能用例数；没有冒称Windows全仓all-targets通过。
- [外部协议测试](../../../../api/runtime/test/native-session.mjs)10项新增场景通过：end、valid、1024分窗、null-path、错误游标、旧handle、错误next-offset、奇数hex、kind不一致、u64溢出；每次同时验证无效入参forward前拒绝、损坏回执原调用不重放。[fixture](../../../../api/runtime/test/fixture/native-session-peer.mjs)。另复用8项原语义regression：fragmented、Busy、identity-valid、clean-Dirty、foreign-workspace、overflow、EOF-live、partial-terminal均通过；不是全部协议或容器路线资格。
- [现有受限SDK flow](../../../../api/runtime/test/verify/native_sdk_exec_real.mjs)在同新parent读取19:15:11.752Z，**PASS**：原执行／双流／显式发布／晚读／client-close后原cancel、正常终态及resident token／desktop close，最终runtime_closed:true／sessions空。[结果](../../../../tmp/native-references-20261103/sdk-flow/result.json)。这证明既有受限普通exe链未因新观察语法回归，不证明受限Git cwd或IPC支持。
- root／独立诊断formatter、Nodecheck、1013文件boundary scan、37项guard和23项LOC自测通过。[检查](../../../../tmp/native-references-20261103/guards.json)。产品C++、token、descriptor、依赖不变，因此本轮未重建这些旧binary；旧strict／后代／IPC证据按原身份保留，不重跑未改范围。
- 每次测试明确≤120秒前台，先编译no-run再执行；独立test编译3分10秒为build-only，不是超时测试。所有background build/count job已单独收齐，无后台测试；无性能、峰值、cold-cache或一般kernel drain声明。

产品parent SHA256 **591edf5e06b968eeefb7061e3f477befe99794316bbbfe6c998ec5611d4c0a49**；原WinFsp host **2b4cf30097dd845f0f6177f1b4ae78314da7971f97266788fb6a001761f8b3f5**、addon **99e5a93454ed1c8875a490d6401f2709e95927a8308e153ef94f5669e919217a**不变。新parent和JS与旧parent不是可假定兼容的协议组合：新reference需要本轮实现；不存在旧服务不识别后的fallback／重连。服务无安装／发现／跨进程接管能力升级。

## 精确生产LOC和交付

first parent **a2873b4d9f6eaf72f0d1920914c16626b1412a18**；最终实现／测试／文档封版树 **b8b6cda6ebce86a372b4308d055584e19fb84957**，本报告加入后仅多该文档。所有产品source与消费者在此seal后未改；minimal-first与window-first是不同证明输入，分列原读取时间，不把先前样本伪造为最终新运行。[seal](../../../../tmp/native-references-20261103/source-seal.json)。

**Production LOC: 111362 -> 111497 (delta +135).** Core38454不变；Engine69223→69334（daemon9188→9299，+111）；API3685→3709（runtime2110→2134，+24），agent900不变。[精确比较](../../../../tmp/native-references-20261103/loc-comparison.json)、[父树计数](../../../../tmp/native-references-20261103/loc-parent.json)、[封版树计数](../../../../tmp/native-references-20261103/loc-staged.json)。

双方git archive exact first parent／final staged implementation，同production_loc.py --root archive --json；包含所有产品Rust／SQL／JS／C++／hpp，测试／docs／工具排除。counter SHA256 **8c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3**不变。没有删除测试、source迁移或legacy替代；增长用于真实有界operational read model及严格原回执验证。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。

本轮完成有界只读观察及最小引用身份定位，不宣告Git关闭修复或主任务完成。主task3b7a154bc4继续doing。无新业务品味判断，既有SDK接口提案未ratified。本轮没有改DSH、系统配置、Mount Manager或其它会话工作。
