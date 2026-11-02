# Windows 原生 SDK Commit message 保真（2026-11-03）

> **Status:** Dated implementation and scoped functional verification record. Explicit native SDK Commit metadata, default/empty/Unicode/API-bound cases and metadata-only UpToDate behavior pass. Not force, application-visible capture, arbitrary kernel/mapping, recovery or release qualification.

## 本轮实际交付

原生绑定的SDK workspace.commit(ws,message)现在将显式message送入原CommitWork和Store的既有CommitOptions，不再以硬编码描述替换。SDK与native Session复用[同一个checkedMessage](../../../../api/agent/src/client.js#L184-L189)，通过精确版本的[internal导出](../../../../api/agent/src/internal.js)共享，不增加第二套JavaScript校验器或公开SDK方法。

[原SDK接线](../../../../api/runtime/src/platform/native-windows/client.js)、[原Session请求](../../../../api/runtime/src/platform/native-windows/session.js)、[CommitWork](../../../../engine/crates/layerfs-daemon/src/native/commit.rs)、[控制命令处理](../../../../engine/crates/layerfs-daemon/src/native/control_commit.rs)。Store构造／编码／写入／History发布的既有管线不变，无新encoder、Store RPC、worker、metadata镜像registry或第三方依赖。

- 显式Unicode、换行／tab、尾部空格原样保留，不trim／规范化／截断。
- 空字符串是Some(空)，不是省略值。
- SDK省略或undefined使用Store既有默认描述Commit Workspace changes。旧原生standalone未传第三参数的调用仍保留Windows published Workspace frontier默认，避免悄悄重解释旧接口。
- 原生Session可用commit(published,details,message)明确提供第三参数；显式undefined选择Store默认。Published scope仍必须明确；ApplicationVisible capture仍Unsupported。
- message最多4096个UTF-8字节，允许换行／tab；null、非字符串、未配对surrogate、其它control和超界均拒绝InvalidInput。force仍Unsupported，不顺带开放。
- 仅改变message不创建文件系统变更。UpToDate不创建新History，也不把上次Commit改名。

[公开runtime契约](../../../../api/docs/runtime.md#bind-an-existing-sdk-client-to-a-running-native-instance)、[控制架构](../../architecture/68-native-workspace-control.md)。

## 原有界控制与失败保管

原继承stdin控制记录使用message字段：none表示省略，短横线表示空串，其余是UTF-8字节的hex编码。复用Bridge既有unhex，严格UTF-8解析及History CommitMeta::check在capture前校验。换行／tab或看似unmount的正文不会成为第二条控制命令；不建multipart上传owner或临时message文件。

控制处理窗由原128字节扩为**8320字节＝128命令开销＋2×4096公共message字段**。这只适配既有metadata上限，不是新的文件／编辑／Workspace／Exec／Commit流量总上限。原native callback二进制通道、数据窗口和输出回执均不改变。超处理窗／输入丢失／非法UTF-8控制文本保原字节及原因，失去原通道后不重连或重发。

[CommitWork](../../../../engine/crates/layerfs-daemon/src/native/commit.rs)携带选定message，运行构造仍在Session锁外。原completion保存message、绑定、token、before snapshot和原outcome；确认显式message与原publication相符后才已知结算。Store failure、先前native failure、panic或receipt不符都保完整原completion，不只保success或错误后丢掉请求metadata。被替换的success-only保管字段随此合并移除，没有第二个publication owner。原请求发送失败／丢回复仍由原JavaScript Session保管；published结果不会通过后查最新History猜测或自动重放。

默认message由Store决定，不在native复制其默认生成算法。没有提供message时，native仅沿原身份／parent／root／frontier校验；独立History实证核对默认值。新语法需要配套新parent，旧服务不认识时不fallback／reconnect。

## 最终受限 SDK 实证

[真实消费者](../../../../api/runtime/test/verify/native_commit_message_real.mjs)完成SDK Init／fork、原resident create／bindClient、SDK mount／commit／unmount和原token／desktop close；普通文件写入共享同原挂载，不要求Exec登记。

[最终结果](../../../../tmp/native-commit-message-20261103/actual-sealed/result.json)读取**2026-11-02T22:07:28.992Z**（2026-11-03 06:07:28 Asia/Shanghai），[命令回执](../../../../tmp/native-commit-message-20261103/sdk-sealed-command.json)、[原件审计](../../../../tmp/native-commit-message-20261103/audit-command.json)：

| 选择 | History message的UTF-8长度 | 原发布head |
| --- | --- | --- |
|Unicode／换行／tab／尾空格|53|12ecd4aac17de315afa3bba733661372e9f749eb0fefb9e919cc42f82cf8dbde91|
|显式空字符串|0|12fb039dbaf0a7fe53b407512be8ecb8450a314b0988faf5d5a7e94f0daa2c7ebb|
|最大多字节正文|4096|12171873747e810ac097f96818481e6225107292bf5a9823ebec9e8e5c5a767beb|
|省略参数|24|1241546385be6cc1f348750188a2a754ab2c5049cd55e62e03f984e95ce71ec1e0|
|显式undefined|24|12e7b079887e6adfb7a52422af2a78c60fd2622bad06283300367f4c901efce2be|

每次先写不同文件，再明确Commit。原publication与独立SDK History逐项核对message完整原文、head、parent、base和root；每次发布后又用另一message调用一次，**5次均UpToDate**，head／root和完整History不变。[完整发布和History证据](../../../../tmp/native-commit-message-20261103/actual-sealed/publications.json)。

9类非法SDK输入及force请求在native admission前拒绝，前后原Workspace状态相同且History仍0。随后原正常卸载、重新挂载的文件内容及[5条History原文](../../../../tmp/native-commit-message-20261103/actual-sealed/history-after-remount.json)仍正确；原resident PID不变，最后tokenClosed／desktopClosed及processExit0。最终runtime_closed:true、sessions与instances空。

实际SDK trace只作调用关联。公共trace会裁剪长message，**不能拿其裁剪正文证明4096字节保真**；本轮证明来自原请求和完整History／raw-artifact审计。没有为报告伪造trace字段或从执行启动推断完成。

## 原始控制与定向回归

[原始控制消费者](../../../../api/runtime/test/verify/native_commit_message_wire.mjs)只读复用已关闭测试Store，独立mount原parent，不借JavaScript校验替代native入口测试。[wire结果](../../../../tmp/native-commit-message-20261103/wire-corrected/result.json)读取22:03:30.607Z，最终parent身份与实际SDK相同：

- 非hex、奇数hex、过长UTF-8／surrogate编码、NUL、CR、C1control、4097字节正文及额外字段共9项拒绝，且每次后读state与原state相同。
- 空串、省略和4096字节正文在未变化的Workspace上均UpToDate；最大请求跨过原128字节窗口但未截断。
- 原控制通道保持可用，以一次明确clean unmount完成原terminal、parent exit0，mount消失。该消费者没有写Store或创建metadata-only History。

| 检查 | 结果 | 原件 |
| --- | --- | --- |
|直接产品Session|11／11，包含精确metadata、legacy默认、UpToDate及原native failure保管|[产品结果](../../../../tmp/native-commit-message-20261103/public-session-corrected-command.json)|
|Session message协议|4项：valid／refused／foreign reply／EOF，非法入参不forward、失联不重放|[valid回执](../../../../tmp/native-commit-message-20261103/protocol-message-valid.json)|
|SDK message forwarding|1项，Promise拒绝、force不开放及精确encoded请求|[更正后回执](../../../../tmp/native-commit-message-20261103/sdk-forwarding-corrected-command.json)|
|既有原owner与回执语义|8项：scope／mixed／pending-mixed／lost-publication、fragmented／identity-valid／foreign-publication／clean-Dirty|[scope](../../../../tmp/native-commit-message-20261103/regression-scope.json)|
|SDK包导出／生命周期|2项，internal精确导出与原Store生命周期|[surface](../../../../tmp/native-commit-message-20261103/packaging-surface-command.json)、[lifecycle](../../../../tmp/native-commit-message-20261103/packaging-lifecycle-command.json)|
|格式和guard|root／独立probe fmt、Nodecheck、1017产品文件guard、37guard＋23LOC selftests|[检查](../../../../tmp/native-commit-message-20261103/guards-final.json)|

固定Rust1.85.1 offline／locked product build、public Session no-run、daemon lib/native-bin及独立public test warning-denying scoped Clippy通过。[最终构建](../../../../tmp/native-commit-message-20261103/build-final-collected.json)。所有测试前台explicit≤120秒，先build／Nodecheck，无后台测试。Windows全仓all-targets因既存Unix-only目标限制未声称通过。C++host／launcher／token源码未改，未重建其binary或重复已通过Git闭环／后台ACL／映射回归。

## 三次消费者错误与修正，不改原FAIL

1. [SDK forwarding首测](../../../../tmp/native-commit-message-20261103/sdk-forwarding-command.json)错误期待同步throws；公共SDK绑定方法为Promise，测试未正确等待。改为assert.rejects并保持“原控制请求未发出”检查，新输出通过，产品逻辑未为此改变。
2. [产品首测](../../../../tmp/native-commit-message-20261103/public-session-command.json)10PASS／1FAIL。测试误以为kernel revoke本身必令Store Commit失败；实际上二者所有权不同。修正消费者：先用公开open实际记录已撤销mount的原native failure，再验证它确实阻止completion结算和第二次Commit，并保留pending／backing，不通过生产testhook注入失败。之后11项通过。
3. [wire首测](../../../../tmp/native-commit-message-20261103/wire-final/result.json)因等待器用null而断言undefined失败，在message校验前停止，未获得原终态。修正仅消费者等待器，用新独立输出取得wire成功，未强制回收原失败Session。

以上原件均保FAIL。早期[actual-first](../../../../tmp/native-commit-message-20261103/actual-first/result.json)虽然通过，但parent为68bb7956，与最终父程不同，不冒称最终身份；只复核受影响的metadata checkpoint形成actual-sealed。新默认／格式改变不覆盖旧Git13／8／cwd128和verifier7PASS／2FAIL原材料。

文档编辑曾误加入单个NUL而被文本editor判为binary；按完整已读内容精确修复后，最终所有变更文件无NUL、source seal与staged字节一致。没有把该未封版编辑带入产品或原运行。

## 身份、精确LOC与限制

first parent **2c05775dbc00cd468e642f9b9d99c479df006a3f**；source/test/count tree **51bd5061eafb955a425692f7b158cf6e6d928cc7**，本报告加入后仅多文档。[源码／binary seal](../../../../tmp/native-commit-message-20261103/source-seal.json)、[summary](../../../../tmp/native-commit-message-20261103/summary.json)、[原件audit](../../../../tmp/native-commit-message-20261103/audit-command.json)。最终parent SHA256 **0228896e9693e6d21202d5567a98babe549cd7135ee1cfa0e446d7d14a0c3a18**；原host6a01e415fa4b26c04d32f15c4965f1ee7160c06dc1a13d322951a711be121426、addon99e5a93454ed1c8875a490d6401f2709e95927a8308e153ef94f5669e919217a、resident51afc4867d5a03c625f20554e977f72847ddc91c77c96b89a430e8e33030d48e不变。

**Production LOC: 111785 -> 111872 (delta +87).** Core38454不变；Engine69620→69697，其中daemon9443→9520（+77）、Fuse6238不变；API3711→3721，runtime2136→2146（+10）、agent900不变（internal forwarding导出是实现变化但代码行数不增）。[比较](../../../../tmp/native-commit-message-20261103/loc-comparison.json)、[父树](../../../../tmp/native-commit-message-20261103/loc-parent.json)、[封版树](../../../../tmp/native-commit-message-20261103/loc-staged.json)。

双方exact git archive同production_loc.py --root archive --json，counter SHA2568c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3。完整产品Rust／SQL／JS／C++／hpp计入，tests／docs／tools排除；没有迁移、测试删除、新依赖、unsafe例外或第三方改动。reference absent (retiredR9c; last counted65417 at tree498dd1917812)。

仍未开放：force、ApplicationVisible capture、OCI/Bash、named IPC、所有kernel／mapping排空、DOS卷identity、任意私有ancestor兼容、crash/recovery、发现安装和发行。metadata测试不升级这些资格，也不改系统／DSH／profile或其它会话工作。主task3b7a154bc4继续doing；本轮无新业务品味判断，既有SDK形状提案仍未ratified。
