# 原生挂载点访问修复与 SDK 背压／后代引用验证（2026-11-03）

> **Status:** Dated implementation and functional verification record; not a release receipt or complete Sandbox/kernel qualification.
> 最终实测读取：2026-11-02T17:22:05.458Z至17:22:46.760Z，即2026-11-03 01:22:05至01:22:46 Asia/Shanghai。

## 已修复

受限 SDK 命令能相对读写挂载文件，却不能 stat 自己的绝对 cwd，普通后代进程创建返回 ENOENT。根因是目录挂载点的 NTFS junction 与挂载卷根是两份安全边界：原 mount 调用没有传入安全描述符，新 junction 继承其私有父目录 ACL；只给卷内数据权限不足以使绝对 cwd 可访问。

[WinFsp mount owner](../../../../engine/crates/layerfs-fuse/src/windows/mount.cpp)改用 FspFileSystemSetMountPointEx，创建新挂载点时传入[callback owner](../../../../engine/crates/layerfs-fuse/src/windows/metadata.cpp)生成并保管的描述符：原用户 full access、原 policy SID **0x1200a9（读取／遍历）**、protected DACL和low label，无可继承ACE，不给junction写入／WRITE_DAC／WRITE_OWNER。卷内原0x1301bf数据权限不改，父目录、Store、Overlay、项目凭据与token均不改。没有在挂载后补宽ACL、改系统profile、继承到同级路径或创建普通token后备路线。

[原生host](../../../../engine/crates/layerfs-fuse/src/windows/host.cpp)将该描述符仅交给原 attach；[callback context](../../../../engine/crates/layerfs-fuse/src/windows/callback_state.hpp)保持两份描述符到原owner释放。无policy时传null，保留原继承行为。挂载、失败保管、正常终态仍只尝试原操作，不新增重放或清理猜测。

固定 WinFsp v2.2B5 commit **14d6e0280ae15e2550c44d6dbc476be51649727f**的[fs.c](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/dll/fs.c#L178-L210)说明普通接口以null调用Ex；[mount.c](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/dll/mount.c#L474-L510)将传入SecurityDescriptor用于新junction创建。[只读本机原文](../../../../tmp/native-sdk-streams-20261103/upstream-mount.c)的Git blob **5467cf10c43927eece78970d32c20a706b6754f1**已核对；未修改、patch或构建第三方。

## 原失败与定位

[首轮IPC用例](../../../../tmp/native-sdk-streams-20261103/actual-backpressure/result.json)根exit1，预期rootexit4未到达；[原始stderr](../../../../tmp/native-sdk-streams-20261103/startup-diagnostic/startup-diagnostic.json)为spawn EPERM。随后去掉额外Node IPC，保留标准数据句柄及挂载内就绪文件，仍[ENOENT](../../../../tmp/native-sdk-streams-20261103/file-handshake-backpressure/startup-diagnostic.json)；[继承三个stdio仍失败](../../../../tmp/native-sdk-streams-20261103/inherited-stdio-backpressure/startup-diagnostic.json)，不归咎于stdin ignore。

[访问诊断](../../../../tmp/native-sdk-streams-20261103/access-diagnostic/startup-diagnostic.json)实读Node executable存在且可读，目标cwd是选定挂载，但stat(cwd)为EPERM。固定源码进一步定位junction继承ACL。修复后保持相同受限token与原输入，absolute cwd stat、普通继承stdio的后代创建以及后续两项验证均通过。不删除5份原FAIL，不把额外Node IPC的EPERM声称已经独立修复，也不把可执行文件存在等同于成功创建后代。

公共web_fetch曾因工具endpoint返回404不可用，未改用户网络设置；固定源码通过现有gh只读blob读取并校验。一次gh jq引号错误作用前失败，修正引用后读取固定树。它们不是产品操作重试或替代执行后端。

## 最终真实 SDK／WinFsp 证据

[实际消费者](../../../../api/runtime/test/verify/native_sdk_exec_real.mjs)复用原SDK显式命令对象，初始Store经既有显式Disposable Init，原resident运行后bindClient、SDK mount／exec，不走诊断DLL或WSL。

### 双路背压

[封版结果](../../../../tmp/native-sdk-streams-20261103/final-backpressure/result.json)、[命令](../../../../tmp/native-sdk-streams-20261103/final-backpressure-command.json)。受限root普通创建后代，就绪文件握手后rootexit4；未消费stdout／stderr时两路均实读readable65536、writable65536，producer完成标记均未产生，finished未完成、commands1，instance close为MountsActive，runtime close为Busy。root已退出的cancel返回requested:false，不误杀后代或filesystem。

开始消费后两路各 **4194304字节**完整返回，stdout SHA256 **5a88cdf6f17b946f505ab4774fed05e88d6d8d5d99d087dac4593425893c09d2**、stderr **4fac3a2d054e82eb7d510e8dacaeb479ccf7c75ab636ff09499fc1bfd6d1bd74**。producer完成标记随后存在，原finished仍保rootexit4，未将后代完成伪装成rootexit0。命令owner只在原EOF／完成后释放。上述只证明processing-window背压和字节保真，不是完整进程峰值驻留／性能测量。

### 后代持文件与流

[封版结果](../../../../tmp/native-sdk-streams-20261103/final-descendant/result.json)、[命令](../../../../tmp/native-sdk-streams-20261103/final-descendant-command.json)。后代写文本及300023字节binary并持open文件，rootexit4后原native handles实读2；finished仍未完成，明确SDK正常卸载返回 **Busy/serviceKept:true**，普通文件读取继续可用。关闭实例／runtime同样拒绝，不以rootexit或取消无效结果当作排空。

调用方通过测试持有者约定的release文件明确释放该后代文件，stdout32／stderr16字节哈希精确，原finished exit4，原native句柄／active观察归0。随后明确Commit使History从0到1，再正常卸载；新挂载文本和300023字节binary逐字节一致。这里有显式持有者释放及状态改变后的新关闭调用，没有自动重试Busy。最终原token／desktop checked-close、residentexit0，lists为空。并不推断任意未知后代、映射、section或全内核排空。

两项均直接断言目标内stat(process.cwd()).isDirectory()为true。final-backpressure读取17:22:05.458Z，final-descendant17:22:07.406Z。完整[证据汇总](../../../../tmp/native-sdk-streams-20261103/summary.json)、[原件审计](../../../../tmp/native-sdk-streams-20261103/audit-command.json)。

## 覆盖与权限未扩大

| 验证 | 最终结果 | 证据 |
| --- | --- | --- |
| SDK背压／后代持引用 | 2条实际消费者PASS | 上述封版结果 |
| 原受限访问 | 实际PASS：4后端READ、4 ACL修改、3父进程内存、3 token复制拒绝均error5 | [结果](../../../../tmp/native-sdk-streams-20261103/restricted-final/result.json) |
| SDK原生正常执行 | 实际PASS：双路2097183字节、exit9、argv/env快照、no auto Commit、cancel1223及终态 | [结果](../../../../tmp/native-sdk-streams-20261103/sdk-flow-final/result.json) |
| 非受限普通原生执行 | 实际PASS：字节／Commit／重挂载、后代持引用Busy、明确取消和独立终态 | [结果](../../../../tmp/native-sdk-streams-20261103/normal-final/result.json) |
| callback与descriptor | 7项case组PASS，含protected DACL恰2 ACE、policy精确0x1200a9、无继承、无policy仍null、失败不暴露descriptor | [外部检查](../../../../engine/crates/layerfs-fuse/tests/windows_callbacks.cpp)、[回执](../../../../tmp/native-sdk-streams-20261103/callback-final-command.json) |
| mount owner | 6项case组PASS，原失败不重放／不猜清理 | [回执](../../../../tmp/native-sdk-streams-20261103/mount-final-command.json) |
| 产品守卫／自测／root fmt | 1012生产文件、37 guard与23 counter PASS | [回执](../../../../tmp/native-sdk-streams-20261103/guards-final.json) |

共5条实际消费者链，两个C++测试二进制共13组。diagnostic provider DLL只用于callback setup／lifetime单测，不在产品挂载执行路径。所有测试先构建／Nodecheck、显式墙钟≤120秒、前台运行。旧规则／原FAIL／验证器snapshot和归档未改。

本轮MSVC14.40.33807、SDK10.0.22621.0、C++17 /W4 /WX /MT严格构建host和两个测试二进制，clang-format --dry-run --Werror通过。[构建原件](../../../../tmp/native-sdk-streams-20261103/final-build-collected.json)、[完整seal](../../../../tmp/native-sdk-streams-20261103/source-seal.json)。locked offline cargo native-parent构建完成但parent字节不变；Rust源码未变，Rust tests／Clippy NOT_RUN，未复跑既有Windows all-target Unix-only测试失败或声称全仓全绿。

最终host SHA256 **2b4cf30097dd845f0f6177f1b4ae78314da7971f97266788fb6a001761f8b3f5**；原parent **7c51f2af77e8cb118103b96ef8c3409923a39dc18242dd8d3166f7566f471c80**、addon **99e5a93454ed1c8875a490d6401f2709e95927a8308e153ef94f5669e919217a**、resident **51afc4867d5a03c625f20554e977f72847ddc91c77c96b89a430e8e33030d48e**、安装WinFsp **94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3**均再次字节核对。早期host6d59f745属于同源码的前构建，不拿其结果替代最终二进制证据。

## 精确LOC与边界

first parent **c70f3dcc08c351ee0aa9c2e4a7180d56f56942af**；受测／计数树 **4a33a22971d197ecd90defee7884cb4c9c70d211**，加入本报告不改受测产品／harness字节。[精确比较](../../../../tmp/native-sdk-streams-20261103/loc-comparison.json)、[父树](../../../../tmp/native-sdk-streams-20261103/loc-parent.json)、[封版树](../../../../tmp/native-sdk-streams-20261103/loc-staged.json)。

**Production LOC: 111345 -> 111362 (delta +17).** Core38454、API3685不变；Engine69206→69223，其中fuse6079→6096。exact父提交及final staged tree经git archive到独立目录，双方同production_loc.py --root archive --json，计入C++／hpp和全部产品JS，测试／文档／工具不计；counter SHA256 **8c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3**。无依赖、Rust unsafe例外、第三方patch、测试删除、source搬迁或计数范围变化。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。

本轮仅给fresh mountpoint建立其功能所需的窄对象权限，未更改用户／系统权限配置、既有profile或后端文件ACL。隔离测试home保留原owner-only准备；Durable NOT_RUN — owner禁用。没有部署、发行或合并。

旧验证器tr_cde696813cf8保持7PASS／2FAIL、总体FAIL。SDK命令对象形状LAYERFS-NATIVE-EXEC-COMMAND仍pending_review、未ratified；本轮无新业务品味判断点，也未把上轮选择改成人工认定。额外IPC、完整host confinement、任意kernel/mapping drain、Git正常关闭、crash恢复和公开跨进程发现／发行仍未合格。主task3b7a154bc4继续doing；此确定cwd权限缺口已修复并验证，下一段回到SDK实际使用中的确定接口／生命周期缺口，不重造命令或挂载包装。
