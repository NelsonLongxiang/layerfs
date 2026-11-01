# 原生可写Workspace下一步：WinFsp请求路径候选

> **Status:** Research and executable preflight; not installed, not a product route or release qualification.
> 来源读取：2026-11-01 22:15–22:30，Asia/Shanghai。

## 已交付与当前进度

Windows原生Store验证9/9、真实Store只读投影8/8已通过。完整Workspace就绪检查1/4通过，仅组件项；稳定Overlay捕获、单Commit写回与完整生命周期仍非PASS。不能用诊断测试通过数当整体完成百分比。

本轮[命名空间探针](../../../../tools/projfs-probe/src/windows/namespace_run.rs)实证：持有投影根目录的read+FILE_SHARE_READ句柄及一个文件的同类句柄时，普通子进程仍能mkdir、新建、改写、删除和嵌套rename。被单独保护文件的写打开返回32，根目录下另一rename也返回32。目录句柄不能代替完整命名空间capture。首次假设所有rename都成功被实测否定，失败目录保留，修正为逐操作准确断言，不掩盖差异。
[修正后原件](../../../../tmp/native-namespace-20261101/namespace-corrected/namespace-live.json)；[首次失败](../../../../tmp/native-namespace-20261101/namespace-first.json)。

## 为什么准备另一条纯Windows请求路径

[微软ProjFS通知文档](https://learn.microsoft.com/en-us/windows/win32/projfs/file-system-operation-notifications)列出的接口是投影与通知：部分pre-operation可拒绝，new-file/overwrite是post-operation；没有把所有普通写入payload交给provider的Write回调。前轮已实证映射写入跨字节锁和provider stop仍可发生。不能只接目录监听器就宣布代际Overlay捕获成立。

候选使用[WinFsp原生API](https://github.com/winfsp/winfsp/blob/v2.2B5/inc/winfsp/winfsp.h)，不走WSL、Docker、Cygwin或Linux FUSE。其FSP_FILE_SYSTEM_INTERFACE提供Create/Read/Write/SetFileSize/Rename/Cleanup/Close等请求；API存在不是接线完成或稳定frontier证明。需继续处理缓存写、映射、Cleanup与Close的独立生命周期和本地发布顺序。

本机[只读预检](../../../../tmp/native-namespace-20261101/winfsp-preflight.json)：WinFsp安装目录、DLL、驱动均未发现；当前坐席非管理员。预检退出2明确表示缺组件，不算PASS。
[可重跑预检脚本](../../../../tools/winfsp-preflight.ps1)不安装/启动驱动/挂载；[3项正反例](../../../../tmp/native-namespace-20261101/preflight-tests.json)通过，包含真缺组件、坏安装包与缺安装包，不将DLL加载当活挂载。

## 已备好的一步

推荐授权在本机安装官方签名的**WinFsp 2026 Beta5（2.2.26286）Core + Developer**，不安装Cygwin，不自动重启，不改DSH。它仍是prerelease，不是生产依赖选择；只用于隔离原生请求试验。

为什么不直接用“latest”：官方releases/latest返回稳定2.1，但[Beta5发布说明](https://github.com/winfsp/winfsp/releases/tag/v2.2B5)列出CVE-2026-3006、CVE-2026-7162及多项后续漏洞/死锁修复。本轮选择带这些已公开修复的最新官方测试候选，不把“稳定旧版”当安全证明。

已下载[官方安装包](../../../../tmp/native-namespace-20261101/winfsp/winfsp-2.2.26286.msi)，SHA256：
293ffb9bcc0b625c85079fe85fa77f8fe98170aba51a02ac9c83d58f6c3b0e2f。
与GitHub release digest及发布说明一致，Authenticode=Valid，签发对象NAVIMATICS LLC。MSI只读表确认feature为F.Main、F.User、F.Developer；不执行安装自定义动作来探测。

在仓库根目录的管理员PowerShell中，**授权后**运行：

```powershell
$msi=(Resolve-Path 'tmp/native-namespace-20261101/winfsp/winfsp-2.2.26286.msi').Path
if ((Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash.ToLowerInvariant() -ne '293ffb9bcc0b625c85079fe85fa77f8fe98170aba51a02ac9c83d58f6c3b0e2f') { throw 'hash mismatch' }
if ((Get-AuthenticodeSignature -LiteralPath $msi).Status -ne 'Valid') { throw 'signature invalid' }
$p=Start-Process msiexec.exe -ArgumentList @('/i',('"'+$msi+'"'),'ADDLOCAL=F.Main,F.User,F.Developer','/passive','/norestart') -Wait -PassThru
if ($p.ExitCode -notin @(0,3010)) { throw "Installer exit $($p.ExitCode)" }
# 3010只记录需要重启，不在此自动重启。
pwsh -NoProfile -File tools/winfsp-preflight.ps1 -Installer $msi
```

请求只要一项：**是否授权安装该候选驱动和开发文件**。未授权时默认不安装，已交命名空间实测与只读预检；继续源码/接口级工作，不冒称活请求链已跑通。安装时若平台需要UAC人点，不能绕过；凭授权由本坐席执行能执行的步骤，剩下一步明确交持权人。

## 许可与发布边界

[官方License](https://github.com/winfsp/winfsp/blob/v2.2B5/License.txt)是GPLv3并附FLOSS链接/未修改安装包分发例外，含署名/链接与不得混合专有软件等条件。当前仅内部隔离诊断，不分发/上架WinFsp、不修改第三方源码。后续若产品引入要核完整分发组合，不凭该摘要宣布所有集成许可自动满足。

风险：诊断代码中档；驱动安装是需授权的宿主系统配置操作，本轮尚未执行。Windows可写Workspace路线仍是候选，必须在驱动就位后实际证明请求回调→Overlay发布→capture→Save/History，不能以本报告代替实现。

## 最终验证与身份

最终探针活证：2026-11-01 22:31:50.678–22:31:50.722（Asia/Shanghai）。
[最终4项命名空间CLI](../../../../tmp/native-namespace-20261101/namespace-final/result.json)；
[映射4项回归](../../../../tmp/native-namespace-20261101/capture-regression.json)；
[真实Store4项回归](../../../../tmp/native-namespace-20261101/store-regression.json)；
[原固定内容6项回归](../../../../tmp/native-namespace-20261101/fixture-regression.json)。
合计7项Rust + 18项CLI通过，另有3项WinFsp预检用例通过。每次测试均显式限时≤120秒；无测试超时。

[Rust与格式检查](../../../../tmp/native-namespace-20261101/rust-and-format-final.json)内两个测试二进制5+2项都通过，fmt也通过；末尾git rev-parse误用索引目录语法而exit128，该错误只属于身份查询，已按完整staged tree读取[正确子树](../../../../tmp/native-namespace-20261101/source-seal.json)，未隐瞒或重复跑已通过测试。
[build/test --no-run/Clippy作业](../../../../tmp/native-namespace-20261101/build-check-job.json)exit0；完整编译stderr在本会话已收取，后续流式读取为空，不假造另一份完整日志。

- 父提交：33555c50d2564a6b7a17220b29b5342b64a87aeb。
- 测试时完整staged tree：45d44e91633642da2c0bae6ed8269125fd0cd0bf。
- 已测探针子树：df855cd5369cf8466c31ac9e8cf1ab662fc31edc。
- exe SHA256：3c4296dbfe059862151577c4bd86ccb7d58359f02bb430631fa306719af77985。
- 没有产品/DSH/第三方源码修改，没有新增Cargo依赖或lock变更。普通Workspace W2/W3/W4仍非PASS。

读取候选输入：[官方源tree清单](../../../../tmp/native-namespace-20261101/winfsp-source.json)、[官方头文件](../../../../tmp/native-namespace-20261101/winfsp.h)、[ABI依赖头](../../../../tmp/native-namespace-20261101/fsctl.h)、[API原文](../../../../tmp/native-namespace-20261101/WinFsp-API.md)、[许可原文](../../../../tmp/native-namespace-20261101/WinFsp-License.txt)。这些是只读参考/第三方下载，不进产品提交、不修改。
MSI表第一次COM取值方式只返回空数组，不能作为feature证据；修正为显式属性读取后取得[有效表数据](../../../../tmp/native-namespace-20261101/msi-tables-fixed.json)，[无效初次输出](../../../../tmp/native-namespace-20261101/msi-tables.json)保留。
早期临时PowerShell路径转义不正确，不能用其registry/file负结果证明缺组件；最终结论只采用已测试preflight脚本（RegistryKey双视图、系统路径、CIM驱动枚举）。未修改profile或尝试绕过管理员权限。

本轮中间件保留于tmp/native-namespace-20261101，仅为报告引用的原件、失败证据、签名安装包及其回归输出；没有新建worktree或系统临时脚本。
Production LOC: 104392 -> 104392 (delta +0)，Core38454、Engine63178、API2760。计数使用原tools/production_loc.py，对exact parent/staged产品路径比较；非发布诊断/测试/文档不计生产LOC。无测试删除。
reference absent (retired R9c; last counted 65,417 at tree 498dd1917812)。
品味判断点：无新增（请求能力与安全修复基于官方契约和实测，尚未确定产品依赖）。未知：原生请求实际挂载、缓存/映射语义、Overlay代际接线和完整许可分发组合。
