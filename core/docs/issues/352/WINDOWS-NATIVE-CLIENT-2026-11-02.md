# Windows 原生 SDK 客户端接线（2026-11-02）

> **Status:** Dated implementation and functional verification record; not a release receipt or complete platform qualification.
> 读取时间：SDK 实测2026-11-02T15:20:21.485Z、resident 回归15:25:56.623Z（Asia/Shanghai 同日23:20、23:25）。

## 本轮达成

已把真实 SDK 客户端接到原先已运行的 Windows 原生实例，不再只有独立 runtime 包装。集成方调用 runtime.native.bindClient(client, instance, { commitScope: "published" })，随后原有 client.workspace.mount／commit／unmount、sandbox.close／list_workspaces、project.list_sandboxes 和 backend.daemon.workspace.status 消费该原实例。显式注册返回 sandbox 编号、image:null、mode:windows-restricted；没有忽略镜像参数来伪造容器。

[SDK runtime 契约](../../../../api/docs/runtime.md#bind-an-existing-sdk-client-to-a-running-native-instance)、[实际路由](../../../../api/runtime/src/platform/native-windows/client.js)、[客户端绑定](../../../../api/agent/src/client.js)、[架构说明](../../architecture/68-native-workspace-control.md)。

注册只影响指定客户端的控制调用。该客户端 Store 调用仍用创建时的本地 binding；未注册客户端及默认容器 image 路径不变。不启动 worker、容器、WSL 或替代实例，不重复打开 Store，不改全局 transport。注册检查原 handle、存活实例、相同 project/home/Store 与明确 Published scope；同一客户端不能被第二次静默切换。另一客户端可显式绑定同一实例，继续操作原有挂载。

### 补在原产品边界的事实

- [原始身份回执](../../../../engine/crates/layerfs-daemon/src/native/receipt.rs)从本次 Session snapshot／Commit completion 返回 workspace、Branch、head、baseLayer、root、revision、parent／displaced／merge 身份。SDK 不在提交后查询“最新 History”猜本次结果。
- SDK Commit 返回 Committed／UpToDate 与 Published 身份子集，不编造容器 Commit record 的 message、LWW、大小和计时字段。未实际观察的当前 Store head／headMovedSinceMount 为 null。
- 默认 SDK unmount 走 clean-close。完整 native callback 栅栏后，原 Session 在锁内检查 dirty counts／pending base changes，再停止接收／进入终态。Dirty／Busy 是作用前拒绝，恢复回调准入，原挂载仍可读写；不是 JavaScript status 预检查。明确 discard:true 才许可丢弃本地变更，旧 standalone Session.unmount() 默认终态语义未改。
- 原 Session／instance 继续拥有状态、进程及关闭回执。客户端 close 只释放自己的 Store client，不隐式提交、卸载或关闭实例。原 terminal receipt 与原进程 exit0 才完成正常关闭。
- 启动、状态或发布回执失联时保留 Unknown、原输入及会话。尚未返回 Workspace 的失败 admission 也不能在列表中伪装为空；runtime close 不用普通 Busy 遮住内部 retained 会话。没有自动重放、重启、猜测回收或容错后端。

## 真实 SDK 消费者

[公开 SDK 测试](../../../../api/runtime/test/verify/native_client_real.mjs)实际完成 Windows SDK Init／fork → 创建原 resident（PID73916）→ bindClient → SDK mount → 普通文件系统写入 → Dirty／Busy 拒绝及服务继续 → SDK Published Commit → 第二个 SDK client 读回／History 对账 → 显式 discard／新挂载检查 → 正常卸载 → 原实例 checked-close。

[最终结果](../../../../tmp/native-client-20261102/actual-final/result.json)、[实际命令](../../../../tmp/native-client-20261102/actual-final-command.json)、[37行 SDK trace](../../../../tmp/native-client-20261102/actual-final/sdk-trace.jsonl)。

- 写入文本及 **300023字节**二进制；新挂载逐字节一致。丢弃的文件在下一新挂载不存在。
- Dirty 返回 serviceKept:true，后续状态未 prepared、文件仍可读；外部 open/readSync 持有的描述符使正常卸载 Busy，关闭后才卸载。
- 原 Published head为 **12cdca878fe0f1470916f7c4422fa96bd0901196912850727bb3a23b1d403a550b**、root为 **b93541c1e4bd05b69ba00b96aa7ac4d5b324c7f6ce3ca2b911fd675ebad453c0**。独立 SDK History 恰一条 Commit，head/root相同；下一次无变更为 UpToDate，未造第二条历史。
- SDK close 后原实例仍持有一个挂载；新 SDK client 显式绑定后继续访问。正常卸载为原 overlayClosed、native exit0、parent exit0。最终 tokenClosed／desktopClosed true、resident exit0，runtime lists 为空。
- 未注册客户端仍 Unsupported；foreign sandbox、已关闭原实例和未知挂载分别明确拒绝；结束后不自动重建。

[原 resident 消费者](../../../../api/runtime/test/verify/native_instance_real.mjs)以本轮 parent／host 再回归：原受限 token、两个同时挂载、同 private desktop、真实普通执行／明确取消1223、SDK读回、300023字节保真、Store访问拒绝、active-close拒绝、原checked终态均通过。[结果](../../../../tmp/native-client-20261102/resident-final/result.json)、[命令](../../../../tmp/native-client-20261102/resident-final-command.json)。这条回归复用未改的 launcher/addon/probe，不声称重新编译它们。

## 定向检查

| 覆盖 | 最终结果 | 原件 |
| --- | --- | --- |
| SDK客户端范围、16容量、启动/挂载/状态/发布失联 | 6项PASS | [SDK外部peer测试](../../../../api/runtime/test/native-client.mjs)及[汇总](../../../../tmp/native-client-20261102/summary.json) |
| 原身份／clean-close协议 | 9项PASS | [协议测试](../../../../api/runtime/test/native-session.mjs)；合法、Dirty、错workspace/Branch、overflow、缺head、foreign publication、短root、矛盾discard |
| 旧协议定向回归 | 8项PASS | validation、fragmented、Busy、foreign/duplicate、EOF仍活、错误terminal、terminal未exit |
| SDK／runtime原路径 | 5项PASS | [回执](../../../../tmp/native-client-20261102/sdk-regressions-fixed.json)；surface、lifecycle、container sandbox、runtime surface/state |
| 产品边界与计数器自测 | 1012文件扫描、37+23项PASS | [回执](../../../../tmp/native-client-20261102/guard-final.json) |
| Rust daemon lib/bin no-run、Clippy -D warnings、fmt | PASS | [构建收齐](../../../../tmp/native-client-20261102/product-final-build-complete.json) |
| Rust lib/bin 执行 | 两个目标各0 tests，不充作功能覆盖 | [回执](../../../../tmp/native-client-20261102/rust-final-command.json) |

所有测试有明确≤120秒墙钟限制，不后台测试、不重跑仍在途工作。external peer 用例仅证明真实 SDK 路由和协议保管，不证明 WinFsp／token／真实 Store。两条 actual consumer 才是本轮原生功能证据。无性能、冷缓存、峰值驻留或全局资格声明。

## 身份、构建与原失败

first parent **257e7e74604f2f1445b844b10e52fba6b2c29e87**；原生产代码封版计数树 **629f34d79ba7b4b2efff13c9990c98123cb0bf08**。最终对账树 **cd7d876eb4515b674397bb10865a7db9d165f150** 与其只差测试file URL修正和文档；本报告及三条既有架构文档失效路径修正加入后，仍不改变生产／测试字节。[源码及测试seal](../../../../tmp/native-client-20261102/source-seal.json)、[原件对账](../../../../tmp/native-client-20261102/reconcile-command.json)。这只是可复算构建身份，不是签名build attestation。

MSVC14.40.33807、Windows SDK10.0.22621.0、C++17 /W4 /WX /MT；Rust1.85.1 offline locked，root Cargo配置不改。完整Windows all-target检查的既有Unix-only host_install问题未重跑；仅变化daemon lib/bin做严格检查，不能写成整个仓库全绿。

| 二进制 | SHA256 |
| --- | --- |
| 本轮parent | 7c51f2af77e8cb118103b96ef8c3409923a39dc18242dd8d3166f7566f471c80 |
| 本轮host | f3231fd4dd3c50f26fd9b58ee1c2891b00924961e6e6208be3b2c2b7bd24be63 |
| 复用addon | 99e5a93454ed1c8875a490d6401f2709e95927a8308e153ef94f5669e919217a |
| 复用resident launcher | 51afc4867d5a03c625f20554e977f72847ddc91c77c96b89a430e8e33030d48e |
| 安装的WinFsp DLL | 94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3 |

保留本轮两项原失败：

1. [合法身份协议最初失败](../../../../tmp/native-client-20261102/protocol-first-identity-valid.json)：explicit binding选项没保留原Branch ID，新校验触发Unknown。修为保存原Branch，未放松身份语法；registered项目实际测试不走这个输入分支。[修后结果](../../../../tmp/native-client-20261102/protocol-fixed-identity-valid.json)。
2. [旧packaging测试初始化失败](../../../../tmp/native-client-20261102/sdk-regressions-final.json)：Windows绝对路径直接用于动态ESM import，ERR_UNSUPPORTED_ESM_URL_SCHEME。改测试为pathToFileURL，所有原断言保留。[修后5项PASS](../../../../tmp/native-client-20261102/sdk-regressions-fixed.json)。

交付链接审计最初被架构文档中三条既有 ../../crates 旧路径拒绝，已按现存 engine 源文件位置修正；产品与测试字节不变。[原审计失败](../../../../tmp/native-client-20261102/audit-final.json)保留，最终审计另存。

不删任何测试、历史实测失败、原验证器材料／spec／snapshot／archive。一次对账脚本run_code语法失败发生在工具执行前，未写文件；修正脚本文本后对账通过，没有再次执行产品操作。

## 范围与下一步

这是明确 opt-in、同进程的 SDK 原生 Workspace 子集；不是完整OCI Sandbox，也不代表属主已确认最终统一平台接口。仍明确 Unsupported：SDK sandbox.create(image)、workspace.exec的Bash契约、后台process模型、其它daemon read models、自定义Commit message／force、forced unmount。既有native Session普通执行可用，但不在这里偷偷改写Bash语义。

完整host confinement、任意kernel/mapping成功排空、普通Git正常关闭、crash恢复、公开认证发现／跨进程接管、安装发行仍未合格。本轮没有系统级配置、部署、合并或发布；仅隔离测试home做其原有owner-only DACL准备，所有新Store沿现有显式Disposable/WAL/OFF产品Init路径。Durable NOT_RUN — owner禁用。

旧验证器 **tr_cde696813cf8 7PASS/2FAIL，总体FAIL** 未改；本轮不重新导入同样原件或让新SDK成功冲掉历史Workspace/Git失败。下一段沿原生实际调用方补执行契约，保持image/Bash/argv能力差异公开；不再新增一层resident wrapper或重做token。主任务3b7a154bc4仍doing。

## 精确生产LOC

**Production LOC: 111050 -> 111334 (delta +284).**

| 范围 | before | after | delta |
| --- | ---: | ---: | ---: |
| Core | 38454 | 38454 | +0 |
| Engine | 69098 | 69206 | +108 |
| API | 3498 | 3674 | +176 |
| daemon（Engine内） | 9081 | 9188 | +107 |
| fuse（Engine内） | 6078 | 6079 | +1 |
| agent（API内） | 871 | 889 | +18 |
| runtime（API内） | 1952 | 2110 | +158 |

[精确计数对比](../../../../tmp/native-client-20261102/loc-comparison.json)、[父树计数](../../../../tmp/native-client-20261102/loc-parent.json)、[封版树计数](../../../../tmp/native-client-20261102/loc-staged.json)。git archive父提交及封版staged tree到独立目录，双方运行相同production_loc.py --root <archive> --json；最终生产blob与计数树一致。计入C++／hpp及新SDK runtime实现；测试、文档、工具不计。counter SHA256 **8c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3**。无迁移、第三方补丁、新依赖、Rust unsafe例外或测试删除。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。本轮无新增业务品味判断点；最终平台产品取舍和未验证能力未冒充已认定规则。
