# Windows 原生混合入口共享所有权（2026-11-03）

> **Status:** Dated implementation and functional verification record; not a release receipt or complete platform qualification.
> 最终实际读取：2026-11-02T16:11:19.065Z，即2026-11-03 00:11:19 Asia/Shanghai。

## 本轮结果

SDK 与直接 instance.mount 现在查询同一份原 NativeSessions 所有权，不再维护独立 SDK 挂载表。直接入口在客户端注册前后的挂载均能被 SDK 查询／提交／卸载；直接卸载后 SDK 不留旧记录；别的实例即使在同项目也不能冒用该路径。16 个原 Workspace owner 的准入检查移至两种入口共用的 instance owner，计入同步保留的在途启动以及尚未释放的命令完成所有权。

[原 Session 集合](../../../../api/runtime/src/platform/native-windows/sessions.js)、[实例准入](../../../../api/runtime/src/platform/native-windows/instance.js)、[SDK 路由](../../../../api/runtime/src/platform/native-windows/client.js)、[原 Session handle](../../../../api/runtime/src/platform/native-windows/session.js)。没有旁路 registry、自动重启或重新创建 token。

正常关闭仍由原 Session 检查原在途控制；SDK 不再复制 calls／ending／failure 状态。原失败和未返回的 admission 保持 Unknown。文件系统已经关闭、命令流未消费完的 owner 仍保留，但不列为 mounted Workspace，也不计入 project.list_sandboxes 的挂载数；其命令未完成时 instance.close 仍拒绝 MountsActive。这里的 owner 计数和挂载数不是同一事实。

## 复现与修复

修改产品前，两项外部 peer 基线均实际失败，原件保留：

- [混合列表失败](../../../../tmp/native-owner-20261102/before-mixed-command.json)：先直接挂载再绑定 SDK，SDK 列表0项而实际应1项。
- [混合容量失败](../../../../tmp/native-owner-20261102/before-capacity-mixed-command.json)：15个 owner 后混合发起3次启动，原实现放行2个而应只放行1个；因为直接入口没有共享容量检查。

删除 SDK 独立 Map，SDK 只解析原 Session 并使用其原 immutable handle；原 Session 的 retained／starting／unmounting／closed 语义不变。共用准入在任何 await 前检查当前原 owner，NativeSessions 同步登记启动，再交回控制；不增加第二份容量计数。

## 真实 Windows SDK／WinFsp 证明

[实际消费者](../../../../api/runtime/test/verify/native_client_real.mjs)、[最终结果](../../../../tmp/native-owner-20261102/actual-sealed/result.json)、[55行 SDK trace](../../../../tmp/native-owner-20261102/actual-sealed/sdk-trace.jsonl)、[命令](../../../../tmp/native-owner-20261102/actual-sealed-command.json)。本轮最终 resident PID76080。

1. SDK Init／fork 后，直接创建 mixed 挂载，再绑定客户端；SDK 列表及 backend status 返回同一 Workspace 身份。绑定后再直接挂载，列表含两个原 owner。
2. 普通 I/O 写入文本和300023字节二进制，SDK 对直接挂载执行 Published Commit、Store读回，然后 SDK 卸载该原 handle。直接卸载另一个 handle 后 SDK 列表立即为空、状态 NotMounted；新直接挂载逐字节读回二进制。
3. 在该新挂载中以原 resident 执行命令，原exit7后观察到原生句柄仍为1；等待原句柄／active明确归0，再只执行一次明确卸载。根进程退出不是文件系统排空证明。
4. 挂载关闭后SDK列表为空、项目挂载数为0，runtime仍保留closed owner，instance.close拒绝MountsActive。随后晚读stdout／stderr精确保留“late stdout”／“late stderr”，原finished exit7后该owner才释放。
5. 原SDK独立分支的Dirty／外部fd Busy可逆、原Commit／History身份、UpToDate、明确discard、新挂载读回、原token／desktop checked-close和进程exit0继续通过，最终runtime lists为空。

混合分支本次原Commit为 **12d181edb4ccbe94e6901909d76b44780444f9ce08584bce271e2dc5853194ab67**，root为 **67085cfa1416c4c0bf2309c1998819b9b07fe5f809b33364d4de5936a1e4b7cf**。这些是本次回执身份，不替代旧运行。

## 定向验证与保留失败

- [SDK外部peer测试](../../../../api/runtime/test/native-client.mjs) **10项PASS**：mixed、capacity-mixed、pending-mixed、direct-loss-bootstrap及原scope／capacity／4类SDK失联。容量用例15→16仅放行1个、拒绝2个；跨入口各持原状态调用时，另一入口卸载Busy，未另发终态。直接启动未返回Workspace也保留Unknown且不重发。[汇总](../../../../tmp/native-owner-20261102/summary.json)。Peer仅证明真实SDK路由／协议，不冒称真实Store或WinFsp。
- [Session协议测试](../../../../api/runtime/test/native-session.mjs) **8项PASS**：validation、fragmented、Busy、identity-valid、Dirty、foreign id、failed terminal、terminal without exit。
- [SDK／runtime回归](../../../../tmp/native-owner-20261102/sdk-regressions-sealed.json) **5项PASS**：surface、lifecycle、container sandbox、runtime surface/state。合计23项定向回归。
- [产品守卫](../../../../tmp/native-owner-20261102/guards-sealed.json)：1012生产文件扫描、37项guard和23项counter自测PASS；变化JS均Node语法检查通过，无测试删除／依赖／unsafe例外／第三方patch。
- Rust／C++源码和所有产品binary未变，build／Rust tests／Clippy NOT_RUN，复用上一提交的定向严格检查，不写作本轮重编译。真实消费者使用相同字节的addon／parent／host／resident，SHA见[源码和二进制seal](../../../../tmp/native-owner-20261102/source-seal.json)。

保留[过早卸载失败](../../../../tmp/native-owner-20261102/actual-final/result.json)及[原命令](../../../../tmp/native-owner-20261102/actual-final-command.json)：新增测试最初只等待root exit就卸载，原产品返回Busy并保持serving。这不是混合入口丢失owner；原命令launcher及native Close仍可能持引用。修测试为先读原status直至handles／active为0，再做一次明确卸载，不重试原失败操作，不改产品Busy条件。[修后观察](../../../../tmp/native-owner-20261102/actual-after-drain/result.json)及最终封版均通过。最终root exit后确实实读1个句柄，不把等待写作退出即排空。

一次原件对账脚本把目录变量覆盖为事件dict而失败，未写summary或重跑产品；修变量名后[对账通过](../../../../tmp/native-owner-20261102/audit-fixed-command.json)，[原错误](../../../../tmp/native-owner-20261102/audit-command.json)保留。工具程序语法及一次测试文本定位失败均发生在执行前／零修改，检查实际文件后再继续。

所有测试墙钟明确≤120秒、无后台测试；后台仅两次精确git archive计数，job均已收齐。只在隔离测试home准备其原有owner-only DACL，沿既有显式Disposable/WAL/OFF Init；Durable NOT_RUN — owner禁用。无系统配置、进程宽杀、WSL替代、发布或部署。

## 精确身份与LOC

first parent **3605acacff81250e8bf2293d69ec8f05077680d8**；最终受测／计数树 **d096cb1e301110fc150c4e5e4e7ba9ec751cf55f**。本报告加入后仅文档差异，不改受测生产／harness字节。[原件对账](../../../../tmp/native-owner-20261102/audit-fixed-command.json)、[精确对比](../../../../tmp/native-owner-20261102/loc-comparison.json)、[父树计数](../../../../tmp/native-owner-20261102/loc-parent.json)、[封版计数](../../../../tmp/native-owner-20261102/loc-sealed.json)。

**Production LOC: 111334 -> 111324 (delta -10).** Core38454不变、Engine69206不变；API3674→3664（runtime2110→2100）。同一production_loc.py对exact first-parent及final staged tree的git archive独立输出计数，C++／hpp及全部产品JS均计，测试／文档／工具不计。counter SHA256 **8c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3**。这是删除重复控制状态后的源码差异，不是性能承诺。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。

## 范围与下一步

本轮只修原生混合入口的一致性，image:null／mode:windows-restricted与Published范围保持不变。SDK OCI image创建、Bash Exec、自定义Commit message／force、forced unmount和其他daemon模型仍Unsupported；不改变默认容器路径，不把argv执行冒充Bash。fullhost隔离、所有kernel／mapping排空、Git正常关闭、crash恢复及跨进程发现仍未合格。旧验证器tr_cde696813cf8仍7PASS／2FAIL、总体FAIL，原材料和归档不改。

共享owner修复切片完成，主任务3b7a154bc4仍doing；下一段处理明确Windows执行调用方契约或其实际缺口，不重造resident／bindClient wrapper。台账和唯一调度在本轮收口更新。本轮没有新增业务品味判断点；最终统一平台接口仍非已获人工裁决的契约。
