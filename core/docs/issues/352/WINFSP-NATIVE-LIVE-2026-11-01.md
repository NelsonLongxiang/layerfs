# WinFsp原生请求回调活证（2026-11-01）

> **Status:** Dated native diagnostic result; installed by explicit owner authorization, not a LayerFS Workspace or production release.
> 最终活证：2026-11-01 22:54:42.502–22:54:42.549，Asia/Shanghai。

WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos.
[WinFsp repository](https://github.com/winfsp/winfsp)。本工具及其启动输出含该署名；内部隔离试验不分发第三方安装包。

## 本轮实际推进

**不再仅是API存在：普通Windows进程通过实际挂载进入自写原生回调，完成create/read/write/truncate/rename/delete，字节核对正确。**
无WSL、Docker、Cygwin/FUSE接口、宿主重启或DSH改动。已有Store和ProjFS证据保持原身份，本工具独立于它们。

| 操作/观察 | 最终结果 |
| --- | --- |
| 普通进程新建并写probe.bin | 原生Create=1、Write=1；读回完整内容一致 |
| 目录枚举、普通读取、截断至31字节 | 枚举含目标；截断后与原前31字节一致；Read回调共4 |
| 重命名至renamed.bin、再读、删除 | Rename=1、Delete=1，删除后路径不存在 |
| 生命周期 | Open=21、Cleanup=22、Close=22；provider正常exit0；自己的挂载目录已移除 |
| 边界反例 | 已有挂载路径拒绝并保留sentinel；相对路径拒绝；65537字节超界拒绝且原字节不变；删除后第二次创建拒绝，防止重用仍被kernel引用的唯一诊断node |
| 未验证 | LayerFS Overlay、捕获、Save、History、映射生命周期、完整仓库语义；程序和回执明确NOT_RUN/false |

[最终原件](../../../../tmp/native-namespace-20261101/native-live-attributed/result.json) · [命令回执](../../../../tmp/native-namespace-20261101/native-attributed-command.json)。
计数仅描述该原生样本，不能当Workspace W2/W3/W4通过。它不是“fs.apply冒充Commit”，没有产生任何LayerFS Commit。

## 授权安装与读回

用户在本轮明确选择“授权安装并继续验证”。随后使用已核对SHA256/Authenticode的官方WinFsp 2026 Beta5（2.2.26286）执行一次提升安装：F.Main,F.User,F.Developer，/passive /norestart，不含F.Cygfuse。
安装22:42:08–22:42:31，exit0、无需重启。没有绕过UAC，没有改系统PATH、profile或DSH。署名和官方版本选择原因见[候选研究](WINDOWS-NATIVE-REQUEST-PATH-2026-11-01.md)。

[MSI原始日志](../../../../tmp/native-namespace-20261101/winfsp-install-authorized.log)第1606–1624行确认安装成功、MainEngineThread返回0；[安装作业回执](../../../../tmp/native-namespace-20261101/install-job.json)。
[安装后预检](../../../../tmp/native-namespace-20261101/winfsp-installed.json)确认DLL签名Valid、六个原生导出存在，driver注册；第一次挂载前驱动Stopped/Manual，首次实跑后Running/Manual。停止本实验不擅自卸载/停掉共享驱动。
安装后[3项预检回归](../../../../tmp/native-namespace-20261101/installed-preflight-tests/result.json)确认api-load-candidate及坏包/缺包拒绝；与之前missing-component不同，两份回执均保留。

## 实现范围和复跑

- [原生回调](../../../../tools/winfsp-probe.cpp)：直接使用官方已安装C ABI；自己实现受限单文件回调，不复制/改写第三方源码。全局短锁仅用于此诊断，两dispatcher线程，单文件64KiB，超界明确拒绝。
- [构建脚本](../../../../tools/winfsp-build.ps1)：VcTools、SDK根/版本、输出目录都由参数给出，不修改环境；现有MSVC19.40 / Windows SDK10.0.22621.0，/W4 /WX /MT。
- [活证脚本](../../../../tools/winfsp-smoke.mjs)：另一个普通Node进程使用系统文件API，不调用LayerFS SDK；只能新绝对根与新control目录；记录EXE和DLL前后hash、错误及退出。provider自限30秒、harness40秒、命令60秒，失败只终止自己spawn的准确子进程。
- 根安全描述符取本进程真实用户SID，owner-only DACL；不是公开共享测试卷。安装DLL由显式绝对路径加载，加载依赖限DLL目录与System32。需先运行已验签的安装前置；工具本身不是任意DLL安全加载器。

```powershell
pwsh -NoProfile -File tools/winfsp-build.ps1 -VcTools <MSVC版本目录> -WindowsSdk <SDK根目录> -SdkVersion <SDK版本> -Out <新构建目录>
node tools/winfsp-smoke.mjs <新构建目录>/winfsp-probe.exe <已安装绝对DLL路径> <新证据目录>
```

示例执行的是原生请求可行性诊断，不应被部署为LayerFS运行后端。后续用薄ABI适配接现有Rust Overlay，删除/替换本固定内存样本，不扩大成另一套存储引擎。

## 精确身份

测试前父提交08fc19d282f00752d655983debb3e2a76456d321；最终已暂存测试树4ec03a3eb9ce4f480aea2222b7d5d89b81bcc72e。此后只加结果文档，已测三个工具字节不变。

- 源文件SHA256：b72c2d65a8ec6f06097f8b670559e26dcc4378acc6330f80fd770432419d6f95。
- EXE SHA256：9e17ef852de8ea2f5ce9b288d012dcb456b10d1ebf3c0727054a24bae9d40c66。
- 已安装DLL SHA256：94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3。
- [最终编译回执](../../../../tmp/native-namespace-20261101/native-build-attributed.json)：/W4 /WX成功。格式化使用已安装clang-format，LLVM样式并禁止重排includes（Windows头顺序有实际依赖），没有安装新编译工具。

## 保留失败与限制

初次编译用变量名interface，与Windows宏冲突而失败；改为callbacks后编译。一次clang-format默认排序把sddl.h放在Windows类型定义之前导致编译失败，恢复必须顺序并SortIncludes:Never后通过；不修改SDK或禁用警告。保留[初次编译失败](../../../../tmp/native-namespace-20261101/native-build-first.json)、早期成功回执与构建目录，最终身份不冒用旧二进制。

这次确实新增了宿主系统驱动，但有用户授权、官方摘要/签名核对及MSI接收回执。使用prerelease的风险已在授权前说明；不自动外发发布、不宣布产品许可组合已审完。WinFsp原生callback存在仍不能自动证明缓存写ack、映射、崩溃恢复、跨capture代际正确；这些仍须Overlay集成活证。

下一项：把已验证的原生请求入口接入现有Rust Workspace/Overlay公开端口，以真实NTFS外部进程写入发布到Overlay；随后才验证CapturedNamespace→Save→History，不重新Init、不整树复制。

生产LOC：104392→104392（+0），Core38454、Engine63178、API2760；新增仅非发布诊断工具和文档，没有产品依赖、根manifest/lock或DSH修改。计数同一production_loc.py、exact first-parent/staged产品树；测试/工具/文档排除。reference absent (retired R9c; last counted 65,417 at tree 498dd1917812)。无测试删除。
品味判断点：无新增；接口可行性与局限来自实测和API契约，不冒充业务裁决。
