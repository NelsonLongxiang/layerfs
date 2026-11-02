# 原生 Git 完整状态与关闭检查点（2026-11-03）

> **Status:** Dated functional verification and failure record; overall Git qualification remains FAIL. Not a release receipt or complete Sandbox/kernel qualification.
> 受限首测读取2026-11-02T18:05:51.497Z；可信同用户测试读取18:17:12.455Z，即2026-11-03 02:05:51／02:17:12 Asia/Shanghai。

## 本轮结论

**整体 FAIL，不能标记原生 Git 完整关闭合格。** 本轮把两个执行范围分开记录，不把可信同用户执行当成受限 SDK 的自动后备：

| 范围 | 已核结果 | 未通过 |
| --- | --- | --- |
| 原运行受限实例上的真实 SDK exec | 原 Git 启动／退出与完整stderr回执已取得；cwd公开API已定位 | Git init前getcwd失败，exit128；未创建仓库 |
| 显式可信同用户 runtime Session | 35条Git命令exit0、3次Git commit、index／staged／unstaged／ignored字节保真；2次LayerFS发布／精确重挂载、前2次正常关闭 | 第3个只读验证挂载仍有13个native引用；第3次卸载未尝试，runtime未关闭 |

[消费者](../../../../api/runtime/test/verify/native_git_real.mjs)默认restricted-sdk；只有独立运行明确选择LAYERFS_TEST_GIT_MODE=trusted-local才使用既有同用户Session。没有失败后切换模式、普通token后备或失败操作重放。[分项汇总](../../../../tmp/native-sdk-git-20261103/summary.json)、[原件对账](../../../../tmp/native-sdk-git-20261103/audit-command.json)。

## 受限 Git：cwd规范化失败

[首轮结果](../../../../tmp/native-sdk-git-20261103/actual-first/result.json)、[Git init原回执](../../../../tmp/native-sdk-git-20261103/actual-first/02.json)。真实SDK Init／fork、resident create／bindClient／mount后，经原SDK显式argv执行Git。git --version正常，下一条git init返回“unable to get current working directory: Permission denied”，exit128。所有Git设置在隔离测试挂载内，未写全局Git配置。

[公开Windows API观察程序](../../../../engine/crates/layerfs-sandbox/tests/windows_cwd_probe.cpp)经同受限SDK执行，逐阶段结果见[原观察](../../../../tmp/native-sdk-git-20261103/cwd-native/cwd-diagnostic.json)：

- GetCurrentDirectoryW成功；对挂载根和repo子目录CreateFileW成功，SetCurrentDirectoryW(repo)也成功。
- GetFinalPathNameByHandleW选择DOS命名时，两目录均返回**1005**；选择NT或无卷前缀命名时成功。
- GetLongPathNameW回退时两目录均返回**5（Access denied）**。原挂载父目录保持私有，不能凭相对I/O或stat(cwd)成功推断Git规范化路径可用。

固定Git for Windows **2.46.0.windows.1**的[mingw_getcwd](https://github.com/git-for-windows/git/blob/v2.46.0.windows.1/compat/mingw.c#L1494-L1528)先做DOS规范路径查询，失败后回退长路径查询；[只读本机原文](../../../../tmp/native-sdk-git-20261103/git-mingw.c)Git blob **bb8760deec9433fdc468bc77223180e72923d9f1**已核对。观察程序只调公开API，不hook Git，不改ACL／token或第三方代码。

这不是上一轮junction访问修复失效：原目录已经可打开，失败在DOS规范路径和祖先长路径回退。受限Git本轮没有完成仓库创建，不能引用后面的可信数据检查点升级其结果。

## 已撤回的卷路径试验

调查中曾在本席未提交的mount owner中，尝试WinFsp支持的扩展DOS目录挂载写法，以请求Mount Manager注册卷路径。[试验结果](../../../../tmp/native-sdk-git-20261103/volume-path-actual/result.json)在启动挂载时即Unknown，无Git命令执行；原Session保持retained，未取得可用挂载。原始错误回执没有确定该启动失败的具体NTSTATUS，不能猜成某项权限缺失。

继续读固定WinFsp commit **14d6e0280ae15e2550c44d6dbc476be51649727f**的[目录注册调用](../../../../tmp/native-sdk-streams-20261103/upstream-mount.c)、[Mount Manager实现](../../../../tmp/native-sdk-git-20261103/winfsp-mountmgr.c)后，发现该路径可能查询、暂时设置和恢复系统AutoMount状态。这个试验不保留为默认产品行为，也未通过改系统配置继续尝试。自己的mount.cpp试验已精确撤回；最终所有产品src及发布binary与父提交一致。[seal](../../../../tmp/native-sdk-git-20261103/source-seal.json)。

未在试验前采集系统AutoMount基线，故**不能证明试验从未触及系统状态或已回滚**。之后仅[只读查询](../../../../tmp/native-sdk-git-20261103/automount-readback.json)看到NoAutoMount值缺失，不能把该当前值冒充前后等价证明；没有再写注册表或补做系统回滚。本轮不再走这条路径。

一次从PowerShell调用裸bash误选了WSL，旧Linux Node在解析阶段即失败，未执行Init／Git或形成原生证据。[该错误](../../../../tmp/native-sdk-git-20261103/cwd-diagnostic-command.json)保留，随后通过Git Bash工具启动Windows Node的[原生观察](../../../../tmp/native-sdk-git-20261103/cwd-native-command.json)单独记录。WSL未被用作产品实现、worker或替代验证后端。

## 可信同用户 Git：数据通过，关闭未通过

[本次完整结果](../../../../tmp/native-sdk-git-20261103/trusted-first/result.json)明确mode:trusted-local、status:FAIL，读取18:17:12.455Z。它直接使用公开runtime.native.open和原Session.exec，不是受限SDK Sandbox；Store侧仍由真实SDK Init／fs／History读取。

35条Git命令均保存原root和finished exit0、stdout／stderr字节、pid与restricted:false。任务创建3次Git commit，含重命名、Git fsck、历史读取与ignore检查：

- 第一Git commit：5a0210ce2140df9c4d8595a7fe2e88aaa7ac0614。
- 第二Git commit：4a8ab03da5b9569fb044c5a9c9a498eeb93c2e89。
- 第三Git commit：25df1f23f42feb1e89850dfc4bf27830dbc28b17。

第一LayerFS发布前，index保存staged index content，而working file保存unstaged working content；status精确为AM staged.txt及未跟踪untracked.txt。忽略文件ignored/cache.bin为300023字节，虽然Git忽略，仍属于完整LayerFS Workspace。

[第一前清单](../../../../tmp/native-sdk-git-20261103/trusted-first/before-first.json)与[重挂载清单](../../../../tmp/native-sdk-git-20261103/trusted-first/after-first.json)逐路径／类型／长度／SHA256完全一致：39项、20个文件，包含.git/index、对象、refs、ignored与未跟踪文件。SDK读回working内容，同时新挂载的git show :staged.txt仍读到index的原staged版本，status也保持相同。

将working状态加入Git并创建第三次Git commit后，第二LayerFS发布与[第二前清单](../../../../tmp/native-sdk-git-20261103/trusted-first/before-second.json)／[第二重挂载清单](../../../../tmp/native-sdk-git-20261103/trusted-first/after-second.json)也完全一致：47项、24个文件。[SDK History](../../../../tmp/native-sdk-git-20261103/trusted-first/history.json)恰2条，分别为：

1. 128fe2835eae097b35e84817d1edd4ae661b92da3e564887497d921e18b7da3103。
2. 1281742891038c5b58f71f8e626cb2b6ca491c9d98d675c91b36b76092068ccb6d，parent为第一条。

Git命令不是LayerFS自动提交。仅明确Published Commit才创建这些历史；清单只是测试观察，不是用导出／物化树实现产品数据路径。

### 正常关闭的精确范围

[引用观察](../../../../tmp/native-sdk-git-20261103/trusted-first/close-observations.json)与结果中的原终态回执一致：

- 第一次挂载handles0／active0，明确unmount成功，overlayClosed:true、native exit0、parent exit0。
- 第二次挂载同样handles0／active0，明确unmount成功。
- 第三次只读验证执行rev-parse、status、fsck、show（--no-optional-locks），其命令均已结束且commands0。dirty inode／entry计数0，但仍实读**handles13**，active0、无Commit／retained／prepared状态。

原始10秒引用等待期限内未归零，因此测试在third-normal-close-references失败；**没有发送第三次unmount，没有调用force、重试、额外Commit、杀进程或在Cleanup提前释放OpenFile**。runtime_closed:false，第三个Session仍serving。上述13个引用的具体文件身份／section来源未由本次状态回执枚举，不能仅凭数目认定为内核缓存或产品泄漏。

历史[file-trace检查点](../../../../tmp/native-git-close-20261102/file-trace/data-checkpoint.json)仍normal_close_qualified:false，旧8个引用的FAIL不变。本次两个关闭成功不覆盖旧失败，也不建立任意Git负载、长期挂载或全kernel／mapping排空资格。

## 检查、身份及可复核性

本轮新增消费者和公开cwd观察程序；最终只文档／测试变化，无产品源码、依赖、unsafe例外、第三方patch或测试删除。实验host77dd75ec只用于失败的卷注册调查，不是本轮最终产品，不能混入正常Git结果；所有保留结果分别带其实际binary身份。

成功数据检查点和两个失败范围均使用已提交产品：host **2b4cf30097dd845f0f6177f1b4ae78314da7971f97266788fb6a001761f8b3f5**、parent **7c51f2af77e8cb118103b96ef8c3409923a39dc18242dd8d3166f7566f471c80**、addon **99e5a93454ed1c8875a490d6401f2709e95927a8308e153ef94f5669e919217a**。Git cmd入口SHA256 **851535ccc041bed536a23b17200cd51e7b06e266a527f4eaf8338b5c256c6466**；不冒称已逐一认证所有Git DLL／子程序依赖。

外部cwd观察程序strict MSVC14.40.33807、SDK10.0.22621.0、C++17 /W4 /WX /MT构建及格式通过；binarySHA256 **6b7d99c629f9eb5c852d15fbe4aa0e344fa866a1fc95f2ddb490094d3d5e06b6**。Node语法／diff whitespace、[1012文件guard及37+23自测](../../../../tmp/native-sdk-git-20261103/guards-final.json)通过，不将这些静态检查当作Git功能通过。最终产品Rust／C++实现不变，产品build／Rust tests／Clippy NOT_RUN；试验host构建及失败记录另存，未复用其结果。

运行均显式≤120秒前台，引用观察有固定10秒期限而非无限等候。初始Store沿现有显式Disposable/WAL/OFF Init；Durable NOT_RUN。没有修改源检出Git、全局Git配置或测试目录以外的仓库；未发起部署、发行或合并。

可信实测使用最终harness的同一执行逻辑，之后只补4行顶层使用说明；原受限／cwd诊断记录来自此前同输入的harness版本，加入trusted分支后未重跑成新实证。最终源码seal与这些原始读取时间分列，不伪造“一次最终全通过”。

## 精确生产LOC及交付

first parent **2d617b0acc9232b6a01b4336c0b634bccb883f64**；计数／封版树 **cd8d6311e59a6a03668d9b13bf490bd1d58770af**。本报告加入后只多文档，不改产品或harness字节。[精确比较](../../../../tmp/native-sdk-git-20261103/loc-comparison.json)、[父树](../../../../tmp/native-sdk-git-20261103/loc-parent.json)、[封版树](../../../../tmp/native-sdk-git-20261103/loc-staged.json)、[源码seal](../../../../tmp/native-sdk-git-20261103/source-seal.json)。

**Production LOC: 111362 -> 111362 (delta +0).** Core38454、Engine69223、API3685不变。双方git archive exact parent／final staged tree，使用同production_loc.py --root archive --json；计入所有产品Rust／SQL／JS／C++／hpp，测试／文档／工具不计，产品src blob逐个核对相同。counter SHA256 **8c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3**。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。

本轮交付的是完整状态的新消费者覆盖和两个确定未通过点，**未达成受限SDK Git或完整正常关闭资格**。主task3b7a154bc4继续doing；后续应分别处理DOS路径身份／受限cwd和只读重挂载的13引用，而非重放这次工作负载、延长等待或把普通Git成功作安全降级。旧验证器仍7PASS／2FAIL总体FAIL，原材料／snapshot／archive不改。本轮无新增品味判断；既有SDK接口提案仍未人工认定。
