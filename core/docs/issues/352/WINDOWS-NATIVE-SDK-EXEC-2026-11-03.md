# Windows 原生 SDK 执行调用方（2026-11-03）

> **Status:** Dated implementation and functional verification record; not a release receipt or an owner-ratified unified platform API.
> 最终实际读取：flow 2026-11-02T16:42:26.890Z、abandoned 16:42:29.184Z，即2026-11-03 00:42:26／00:42:29 Asia/Shanghai。

## 本轮达成

真实 SDK 的 workspace.exec 已能以明确的 Windows executable／argv 输入调用原运行实例中的原命令 owner。新增对象形式为 { mode: "windows-native", executable, args, env? }，只供显式 runtime.native.bindClient 注册的本地客户端使用。原 Bash 字符串、容器 image 路径和旧 text／sink／spool 输出语义不改；未注册或 worker 客户端在转发对象前拒绝 Unsupported。

[SDK入口](../../../../api/agent/src/workspace/exec.js)、[客户端分派](../../../../api/agent/src/client.js)、[原生路由](../../../../api/runtime/src/platform/native-windows/client.js)、[既有命令owner](../../../../api/runtime/src/platform/native-windows/commands.js)、[运行时契约](../../../../api/docs/runtime.md#explicit-native-sdk-execution)。没有第二份进程表、后台 worker、Store RPC 或 token 迁移；filesystem daemon 不接收 Exec 控制，也不监督命令。

调用成功只表示原目标启动已确认，返回原 immutable handle：id、pid、restricted、stdin、stdout、stderr、exited、finished、cancel()。SDK 不复制结果、不聚合／解码输出、不代结束 stdin、不自动消费 stdout／stderr，也不推断 shell、deadline、Commit、卸载或进程树取消。命令根退出、launcher close、输出消费和文件系统排空仍分别由原 owner 负责。

选择对象在等待原 resident status 前复制。shell／cwd／timeout／image 等未知字段、稀疏 argv、错误参数或 case-duplicate env 在目标创建前拒绝。校验仍复用命令owner，补正其 argv 对稀疏数组的检查；公开 SDK 对对象同时带 message／sinks 拒绝，原生路由也拒绝 spool。有效对象经原 running instance、原 serving Session 检查后才启动目标。

[追踪实现](../../../../api/agent/src/trace.js)仅记录 mode 和 argv 数量，不记录原生命令代码、argv 内容或 env 值。对象调用成功行写 execution:started、commandId、pid，不补造 exitCode。这个调用的耗时截至启动回执，不是完整执行耗时；真正结果必须读原 exited／finished。旧 Bash 追踪不变。

## 实际 Windows SDK／WinFsp 证明

[实际消费者](../../../../api/runtime/test/verify/native_sdk_exec_real.mjs)使用公开 LayerFSRuntime／LayerFS SDK完成 Init、fork、原 resident create、bindClient、SDK mount／exec、显式Commit／读回／重挂载和正常关闭。[最终flow结果](../../../../tmp/native-sdk-exec-20261103/actual-final-flow/result.json)、[命令](../../../../tmp/native-sdk-exec-20261103/actual-final-flow-command.json)、[SDK trace](../../../../tmp/native-sdk-exec-20261103/actual-final-flow/sdk-trace.jsonl)。

- 13种无效选择与3种不相容参数拒绝，commands保持0；unbound、错误sandbox／path分别拒绝，Bash字符串仍Unsupported。
- 有效命令在调用后修改原 argv／env，不影响已复制的输入。5个argv包括空串、空格、引号、反斜线和Unicode，目标实际读回相同值；env明确值保持original，主机secret及addon选择不自动继承。命令对private Store读取被拒绝，不切换到普通token。
- stdin **2097183字节**经stdout、stderr两路完整返回，二者SHA256均为 **6cf6c312318da2d187864a06539e020f6940dd96aad46d60f5b9405171173157**；原exit9／signal:null、restricted:true、完整EOF与未请求取消回执保留。
- 命令写入文本与300023字节binary；执行后SDK Store读不到未提交文件，History为0。明确SDK Commit后恰1条历史、文件可读，新挂载binary逐字节一致。原Commit为 **1203ce3700a2b304b94652b61309e4357c55a41b76b93678a3bfa4befc2d95ee11**，不把命令完成当自动发布。
- 不能启动的PE返回Failed且不替换resident。两路49153字节输出在root exit7后晚读仍完整；finished在消费前不完成，原命令owner仍持有。
- SDK client.close后原命令及cancel handle继续有效：对原root明确取消一次，重复取消Busy，最终exit1223；resident身份不变。重新打开SDK并显式绑定后继续原挂载，UpToDate不造新历史。
- 正常卸载后对原path执行拒绝NotMounted；实例checked token／desktop close、原process exit0后执行拒绝NoSuchSandbox。flow结束runtime lists为空。

本轮不是重新实现进程／流管理。原Session／NativeCommands的同一stdin、stdout、stderr、exited、finished、cancel直接返回SDK；[分派测试](../../../../api/agent/test/native_exec.mjs)用严格对象同一性核对，且检查不隐式结束／读取任何流。

## 输出放弃的负例

[最终abandoned结果](../../../../tmp/native-sdk-exec-20261103/actual-final-abandoned/result.json)、[实际命令](../../../../tmp/native-sdk-exec-20261103/actual-final-abandoned-command.json)。目标stdout被调用方主动destroy后，原finished拒绝Unknown，root原exit7仍可读；原命令executionRetained:true、commands1，实例close与runtime.close均Unknown，原resident没有因该错误重建。

这是按预期拒绝的PASS，不是正常关闭或完整输出交付。负例在落盘结果后仅结束外部测试harness进程；没有向产品owner发送kill、close重试或取消。harness退出后的stdin EOF不建立graceful terminal、crash恢复或所有OS资源已释放的证明。原件中runtime_closed:false及保管的Session／instance状态明确保留，不涂改为干净终态。

## 检查与身份

| 覆盖 | 最终结果 | 依据 |
| --- | --- | --- |
| 真实SDK flow及输出放弃 | 2项PASS（分别正常终态／预期Unknown） | [flow](../../../../tmp/native-sdk-exec-20261103/actual-final-flow/result.json)、[abandoned](../../../../tmp/native-sdk-exec-20261103/actual-final-abandoned/result.json) |
| SDK分派、原Bash输出、trace ids／no-content、packaging surface／lifecycle／sandbox、runtime surface／state | 9条命令PASS | [回执](../../../../tmp/native-sdk-exec-20261103/sdk-regressions-final.json) |
| 原命令owner validation／stream／late-consumer／cancel／output-abandoned | 5条命令PASS | [审计汇总](../../../../tmp/native-sdk-exec-20261103/summary.json) |
| 产品守卫／自测 | 1012生产文件扫描、37项guard及23项counter PASS | [回执](../../../../tmp/native-sdk-exec-20261103/guards-final.json) |
| Node语法及git diff whitespace | PASS | 变化JS在封版前检查，交付审计核对原字节 |
| Rust／C++ build／tests／Clippy | NOT_RUN — engine源码与binary未改 | 复用上轮定向构建，binary字节再次核对 |

first parent **1c1472082f15f0e6b3962648f9d37bc2e5860b81**；受测／计数树 **295f284822c56c942617f0e04f00ed2da0c9b24b**。文档核对树 **fdc170dd5e3d87c40fb96877b0e267498a5c275f**仅更新两份既有说明；本报告加入不改受测生产／harness字节。[源码seal](../../../../tmp/native-sdk-exec-20261103/source-seal.json)、[原件审计](../../../../tmp/native-sdk-exec-20261103/audit-command.json)、[汇总](../../../../tmp/native-sdk-exec-20261103/summary.json)。

| 复用binary | SHA256 |
| --- | --- |
| addon | 99e5a93454ed1c8875a490d6401f2709e95927a8308e153ef94f5669e919217a |
| Rust parent | 7c51f2af77e8cb118103b96ef8c3409923a39dc18242dd8d3166f7566f471c80 |
| WinFsp host | f3231fd4dd3c50f26fd9b58ee1c2891b00924961e6e6208be3b2c2b7bd24be63 |
| resident launcher | 51afc4867d5a03c625f20554e977f72847ddc91c77c96b89a430e8e33030d48e |
| 安装的WinFsp DLL | 94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3 |
| 实际Node目标 | 2ffe3acc0458fdde999f50d11809bbe7c9b7ef204dcf17094e325d26ace101d8 |

所有测试有显式≤120秒墙钟限制，均前台运行；后台仅git archive计数job且已收齐。全局Store沿既有显式Disposable/WAL/OFF Init，Durable NOT_RUN — owner禁用。只在隔离测试home做原有owner-only DACL准备；不改系统profile、DSH检出、第三方或安装部署。原历史失败／验证器材料／snapshot／archives不覆盖，不以新PASS抹去旧总体FAIL。未执行的性能／峰值／冷缓存／fullhost资格不作声明。

## 接口判断与未验证范围

本轮接口对象／独立方法两种都合理，已登记而非自行裁决：

| case | rule | verdict | ctx |
| --- | --- | --- | --- |
| layerfs-native-sdk-execution-workspace.exec-explicit-native-command-shape | LAYERFS-NATIVE-EXEC-COMMAND | A（原workspace.exec使用显式tagged对象，返回原stream handle） | decision:self-authored LAYERFS-NATIVE-EXEC-COMMAND proposal after reading SDK and runtime sources |

该提案revision1为pending_review、effective:false、未ratified，claim bc14dd944e；不把实现选择写成人工认定的统一平台契约。理由是复用现有SDK调用和命令owner，同时严格区分Bash字符串和native对象；如最终接口另选，按人工裁定处理。

OCI image创建、原生Bash字符串、后台daemon process模型、自定义Commit message／force、forced unmount仍Unsupported。fullhost confinement、任意kernel／mapping排空、Git正常关闭、crash恢复、跨进程发现／接管和发行仍未合格。SDK native exec已经有真实consumer，不再写成只有独立Session执行；也不把这一子集冒称完整Sandbox资格。

本轮无产品／测试命令失败。一次品味提案候选值含禁止分号被工具作用前拒绝，改为A／B正常立案；一次同值文本替换被edit拒绝，检查先前完成编辑后继续，无产品重放或检查放宽。

## 精确生产LOC

**Production LOC: 111324 -> 111345 (delta +21).** Core38454、Engine69206不变；API3664→3685，其中agent889→900（+11）、runtime2100→2110（+10）。[对比](../../../../tmp/native-sdk-exec-20261103/loc-comparison.json)、[父树计数](../../../../tmp/native-sdk-exec-20261103/loc-parent.json)、[封版计数](../../../../tmp/native-sdk-exec-20261103/loc-staged.json)。双方使用git archive exact first parent／final tested tree和相同production_loc.py --root archive --json，计入全部产品JS及C++／hpp，排除测试／文档／工具。最终只文档差异，不改变生产blob。counter SHA256 **8c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3**。

没有依赖、新Rust unsafe例外、第三方patch、测试删除、范围搬迁或另建registry。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。主任务3b7a154bc4仍doing；下一段沿实际调用方检查大输出背压／descendant引用及执行与关闭交错的确定缺口，不重造SDK／resident包装、不重复导入旧验证器原件。
