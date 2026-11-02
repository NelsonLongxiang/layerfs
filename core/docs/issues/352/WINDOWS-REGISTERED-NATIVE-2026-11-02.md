# Windows已注册项目到原生Session接线（2026-11-02）

> **Status:** Dated implementation checkpoint; not release evidence or a released product contract.
> 最终真实运行回执2026-11-02T10:17:31.998Z，回执对账10:21:15.804Z（UTC；Asia/Shanghai同日18:17、18:21）。功能验证，不是性能测量。

## 本轮真正接通的消费者

[既有runtime.native.open](../../../../api/runtime/src/platform/native-windows/sessions.js)现在支持project与Branch名称模式：调用方提供已有项目名、非main分支名及显式产品程序/work/mount路径，**不再读取或传递catalog/cursor**。原store/catalog/cursor显式绑定模式保留，混用作用前拒绝；本轮不新增另一层薄wrapper、Store RPC、SDK Sandbox别名或worker。

运行时已有项目JSON记录只选择installed volume的实际Store路径，不作为授权凭据。[产品启动读取](../../../../engine/crates/layerfs-daemon/src/native/bootstrap.rs)接收LFSREG01：8字节magic、3个LE u16长度(home/project/branch)、Workspace32，然后UTF-8 home/project/branch。home处理窗口4096字节，总体65535窗口，现有history name语法仍适用；这些不是文件/Workspace总大小限制。stdin在启动帧后仍用于原控制命令，不要求EOF。JavaScript只持有路径/名字和新Workspace身份，没有catalog/cursor。

新[共享Windows项目读取器](../../../../engine/crates/layerfs-store-service/src/windows_project.rs)由SDK Windows discovery及native产品启动共同消费，替换[Node discovery](../../../../engine/crates/layerfs-node/src/discovery_windows.rs)中原先唯一使用的私有load/decode逻辑。读取器复用现有owner-only DACL检查、Answer/StoreManifest codec和Disposable profile，无新FFI、dependency、重复编码器或额外发现数据库。它检查home/project/record种类及隐私、record id1及完整帧、sealed/installed元数据一致性，installed只允许新增已确认的SQLite版本；错误记录不因可解析就获权。

[Session启动](../../../../engine/crates/layerfs-daemon/src/native/startup.rs)一次直接打开Store，以项目manifest的LayerStack和Branch name调用History.branch_named索引查询；随后仍执行protected-main拒绝、Workspace绑定、root及kernel关联。无整树扫描/复制、source re-import或凭空创建Branch。未找到/受保护分支时保留原name/stack选择、authority及已打开Store/work；原错误source沿typed错误链保管，不重放或猜撤销。[进程入口](../../../../engine/crates/layerfs-daemon/src/native/process.rs)复用既有父子所有权、状态、Published Commit和正常卸载回执。

[native.list](../../../../api/runtime/src/platform/native-windows/session.js)在项目模式增加project和branch观察，仍是本runtime的进程内列表，不是机器级发现。公开契约见[runtime指南](../../../../api/docs/runtime.md#open-an-installed-runtime-project-without-exporting-authority)、[控制架构](../../architecture/68-native-workspace-control.md#registered-windows-project-authority)。SDK Sandbox/Workspace/Exec分发表及Unsupported未改变：显式host文件系统Session不能冒充隔离Sandbox，workspace.mount仍必须指向已运行Sandbox且不得autostart。

## 实测与定向验证

| 范围 | 最终结果 |
| --- | --- |
| 真实项目闭环 | runtime.project.start_init → 真实Node addon SDK Init → SDK branch.fork → registered native.open → WinFsp普通文件I/O/Published Commit → 同Store重新打开SDK读回及History → 正常unmount → fresh mount通过 |
| 文件和History | 300023字节非零binary跨窗口读写/Commit/新挂载一致；SDK fs.read精确读回文本，branch.list_commits恰1项feature、parent/secondParent空、无more，base与原fork一致；main seed不变 |
| 所有权 | held handle时Busy后继续I/O；观察原native Close后发新显式unmount，不自动重试；terminal原始dispatcher c0000120、native exit0/product parent exit0且mount/Overlay删除；runtime归属归零后close |
| 私有记录 | **6项PASS**：完整installed/uninstalled记录、installed cursor/root身份替换、record id和尾字节、Everyone可读拒绝、目录/路径逃逸、65536字节超窗拒绝 |
| 注册启动边界 | **8项PASS**：缺项目、缺Branch、protected main、zero Workspace、truncated frame、非法home UTF8、project逃逸、坏record；均exit1，无false RootServed/unmount。缺Branch/main保留已初始化Store/work |
| 原模式回归 | 原显式authority的公开runtime原生WinFsp测试仍通过；validation/fragmented/overlap三协议回归通过 |
| 严格检查 | daemon lib/bin、store-service lib/新record test Clippy -D warnings；Node lib --no-deps -D warnings通过；fmt、1001产品文件扫描、37守卫+23counter测试通过 |

[真实SDK闭环测试](../../../../api/runtime/test/verify/registered_native_real.mjs)、[最终运行](../../../../tmp/registered-native-20261102/actual-final/result.json)、[真实Init](../../../../tmp/registered-native-20261102/actual-final/init.json)、[执行回执](../../../../tmp/registered-native-20261102/actual-final-command.json)。测试只用公开LayerFSRuntime/LayerFS和普通OS文件I/O，无合成checker/诊断DLL或工具端权限解码；项目记录由产品Init创建、SDK及native产品共同读取。测试仅为新建fixture home落owner-only ACL，既有home/profile/系统权限不改。SDK旧值via=exec是它对Workspace Commit的既有显示；本次文件写入没有通过Exec注册，不能据此声称SDK Exec已支持。

[记录测试源码](../../../../engine/crates/layerfs-store-service/tests/windows_project_windows.rs)、[6项结果](../../../../tmp/registered-native-20261102/record-tests-command.json)、[注册边界控制器](../../../../api/runtime/test/verify/registered_native_boundaries.mjs)、[8项结果](../../../../tmp/registered-native-20261102/boundaries-final/result.json)。边界程序复用已完成Init fixture进行失败前metadata/Branch检查，不重发失败请求；缺Branch/main失败后保留测试自己的work及原始stderr，不当成正常卸载。

[原显式模式实测](../../../../tmp/registered-native-20261102/explicit-final/result.json)、[协议回归](../../../../tmp/registered-native-20261102/runtime-regressions.json)、[范围明确的严格检查](../../../../tmp/registered-native-20261102/scoped-strict-complete.json)、[产品守卫](../../../../tmp/registered-native-20261102/guard-final.json)、[最终产品字节](../../../../tmp/registered-native-20261102/final-binary-identity.json)。全部测试先构建/no-run或node --check，再显式≤120秒执行，测试不后台、不靠重试/放宽断言变绿。node addon只在证据目录stage为final.node，现有安装binding未覆盖。

[原始结果索引及对账](../../../../tmp/registered-native-20261102/summary.json)、[对账执行](../../../../tmp/registered-native-20261102/summary-audit.json)、[对账源码](../../../../tmp/registered-native-20261102/reconcile.mjs)。所有旧回执保留，不沿用旧binary身份标最终资格。

## 失败及范围诚实

- 首次注册native编译，HistoryName::new需要借用str而提供String：补借用，[失败状态](../../../../tmp/registered-native-20261102/first-build-failed.json)。补保管时又误写super::sourced，改为实际types模块内部函数：[原编译输出](../../../../tmp/registered-native-20261102/record-build-final-output.json)。没有扩大Rust unsafe授权。
- 首次真实SDK测试使用相对命名空间路径seed.txt，SDK作用前InvalidInput；改用/seed.txt、/published.txt，产品断言未放宽。[原FAIL](../../../../tmp/registered-native-20261102/actual-first/result.json)、[原执行](../../../../tmp/registered-native-20261102/actual-first-command.json)、[修正后早期通过](../../../../tmp/registered-native-20261102/actual-path-fixed/result.json)。
- all-target Clippy触发既有daemon/tests/support/host_install.rs的Unix-only接口，Windows编译失败：[原输出](../../../../tmp/registered-native-20261102/final-build-complete.json)。未删/跳改测试，改按真实Windows lib/bin和新增测试逐目标严格检查。Node --no-deps严格检查自身，依赖中原sandbox未用STOPPED/CommandIdentity.check及api clear_io_waits警告保留；不声称整个Windows依赖图warning-free。
- 初始只读查找若猜错旧路径或命令在api工作目录重复api前缀，按报错定位真实文件/改命令，无产品执行副作用；不把command-not-found算产品失败或通过。

## 身份和生产源码计数

父提交68690699d55e9dbde14f7a92494e7f38a840d063，受测封版tree6b323f099bfae5b327a1cc20f1b2b20c3e56194b。封版后仅加本报告及外部registered-boundaries测试，不改实现。

| 最终产品字节 | SHA256 |
| --- | --- |
| SDK addon | 99e5a93454ed1c8875a490d6401f2709e95927a8308e153ef94f5669e919217a |
| Rust native parent | 079b4dcfb992946ccd346ea4ac133116ab52cb44196b656ceb8dc62b75f3a6c6 |
| C++ native companion（沿用） | eede3cc6c8f7cc33d4e4e6daa04b9e054a5da9fcb37534ce3173fbe03413709c |
| installed WinFsp DLL（沿用） | 94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3 |

Rust1.85.1 offline/locked按root manifest、原.cargo输入构建；无manifest/lock/vendor/driver改动。C++和WinFsp source/binary未变，C++重建NOT_RUN；受影响真实调用对上述字节执行，hash为身份不是签名编译证明。

Production LOC: **109609 -> 109824 (delta +215)**。Core38454不变，Engine68125→68321（daemon8974→9070，Node3152→3134，store-service10827→10945），API3030→3049（runtime1484→1503）。共享加载代码是真实Node到store-service迁移，删除旧私有load而非复制；同时新增注册读取验证/启动绑定和runtime选择，不称纯缩减。相同[production_loc.py](../../../../tools/production_loc.py)对exact first-parent和staged git archive计数：[before](../../../../tmp/registered-native-20261102/loc-parent.json)/[after](../../../../tmp/registered-native-20261102/loc-staged.json)。所有新增runtime/parser/adapter及转发计入，测试/工具/文档排除，未删测试或移实现到工具。counter SHA2568c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。

## 在途与未验证

任务3b7a154bc4继续doing。SDK Init/Branch与已注册项目权限→产品原生Session→SDK Store读回这段已经接通，不再描述为手动export authority；但SDK Sandbox create/close和Workspace mount/exec/commit/status/unmount分发、公开认证/发现、安装发行集成、跨进程恢复还未接通。下一段应直接处理SDK/受控caller的剩余生命周期，不再包装同样的native.open。

owner-only读取复用当前windows_acl的实际检测，不声明对恶意同用户进程/任意ACL构造、重解析父路径和TOCTOU替换的完整隔离。运行时JSON仅选Store路径，实际catalog绑定与LayerStack/Branch由Store检验；未验证机器级注册/唯一实例。installed manifest原root是Init身份，不把它当live head。记录超窗是控制格式处理窗口，不是业务体量cap。启动失败的进程内保管及Overlay原件不等crash恢复或强制安全解绑；mapped-source unlink EPERM、完整kernel/mapping Ready/同步/成功解绑、广义并发/crash仍未qualified。Store只执行Disposable/WAL/OFF，Durable未执行。本轮无新增品味判断点。
