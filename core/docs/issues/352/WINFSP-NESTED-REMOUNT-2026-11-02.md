# 纯Windows嵌套目录与同Store第二次原生挂载（2026-11-02）

> **Status:** Dated native integration diagnostic; nested namespace and sequential same-Store remount verified, not full product Workspace qualification.
> 最终第一轮：2026-11-01T16:32:55.756Z–16:33:00.078Z；第二轮：16:33:00.084Z–16:33:01.409Z（UTC；Asia/Shanghai为2026-11-02 00:32:55–00:33:01）。

WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos.
[WinFsp repository](https://github.com/winfsp/winfsp)。沿用已获明确授权安装的Core+Developer；无重复安装、系统配置修改、DSH写操作或WSL/Linux回退。

## 本轮推进

**root-only限制已解除：普通Windows进程创建目录、嵌套文件读写、跨目录移动、删除、Commit；原挂载退出后，用同一个Store文件、新进程和新Overlay owner再次原生挂载核对。**
第二次不是只读Storage API，不是重新Init，也不是复制Store成新项目。

| 检查 | 第一轮及第二轮结果 |
| --- | --- |
| 既有嵌套文件 | nested/data.bin的4MiB+31字节全部与fixture模式逐字节相同 |
| 分页目录 | many目录80个名称与e000.txt至e079.txt完整列表一致，不仅检查数量 |
| 新建目录与文件 | work、archive、work/src与嵌套a.txt创建/读写成功 |
| 跨父目录移动 | work/src→archive/moved，随后a.txt→keep.txt；旧路径消失，内容保持 |
| 删除与拒绝 | 非空目录删除拒绝；循环移动拒绝；temp.txt删除；空work目录删除 |
| Commit1 | 嵌套keep.txt为nested first，archive/new不存在；root条目9 |
| 后续变化与Commit2 | keep.txt变nested final，archive/new/late.txt新增；root条目10；第一版不受影响 |
| 第二个原生挂载 | 同一个已提交Store，读取最终嵌套内容、many完整80项以及根目录文件；无Init、无create/write |
| 无变化提交 | 两轮最后均UpToDate；最终History仍精确两条Commit |
| 退出 | 两个provider均exit0，两个自身挂载点移除；handles0，清理后Overlay计数0 |

[完整执行回执](../../../../tmp/native-nested-20261102/native-final.json) · [第一次挂载原件](../../../../tmp/native-nested-20261102/live-final/result.json) · [第二次挂载原件](../../../../tmp/native-nested-20261102/live-final/second/result.json) · [第二次退出后的只读History核对](../../../../tmp/native-nested-20261102/live-final/second/reopen-after.json)。

第一轮回调create11/open73/read18/write10/rename3/cleanup84/close84/delete3/error0；第二轮create0/open15/read10/write0/rename0/cleanup15/close15/delete0/error0。
第一轮Commit1安装active3/revision23，Commit2安装active4/revision31；第二轮新Overlay active1/revision0，UpToDate仍指向同一head/root。这些是本次功能计数，不是延迟、吞吐或驻留性能承诺。

History确认：
- Commit1：1277dae9f8b43f9410d3383470246ecc7218d0349ee6e6edbbeb17c98fbc00d1a1；保存597字节。
- Commit2：12f59d1add03fb728fd54b39f7aeb3612cfb9fa711918ebfb56702c301b4d12dc2；保存635字节，parent为Commit1。
- 两者via=Workspace；第二轮UpToDate没有增加历史；late.txt和archive/new/late.txt只出现在第二版。

## 代码如何接通

[安全Rust适配](../../../../tools/projfs-probe/src/native_overlay.rs)复用Mutation::parent/resolve、Operation::Mkdir/Rmdir/Rename、SourceView::list与kernel lookup/open ports。路径逐段校验，不规范化合并不同名字；中间parent lookup引用明确释放，未知owner结果不猜释放。目录句柄保留真实KernelDirectory，枚举按该句柄的serial，而非固定root。

目录改名提供真实destination_path作为已有引擎的防环/祖先证据；CanDelete对目录做有界分页非空检查，真正Rmdir仍由现有原子操作再次裁定，不以事前检查替代实际变更。WinFsp Cleanup执行删除，Close释放确切descriptor与lookup引用。

同Store路线由Session::reopen(existing_store,fresh_work)创建新本地owner/模板并bind既有History root；它不调用Fixture::create或Project Init。
[FFI](../../../../tools/projfs-probe/src/windows/overlay_ffi.rs)仅转发，原生host可选第5个业务参数指定既有Store；[smoke](../../../../tools/winfsp-smoke.mjs)顺序启动两次host并分别保留结果。
[独立checker](../../../../tools/projfs-probe/src/commit_reopen.rs)继续只读核对精确两条Commit、嵌套文件大小/字节、删除与版本差异。

已有小capture控制只读一个新根文件，这个诊断限制仍明确拒绝嵌套参数；实际嵌套Commit构造一直由CapturedNamespace负责，未复制实现或添加SQL/编码器。

## 验证与身份

- **10项Rust测试通过**：5范围、2真实Store、3原生Overlay/Commit/嵌套与重绑组合测试。
- **18项既有ProjFS CLI回归通过**：固定样本6、Store4、映射4、目录锁4。
- **1组双挂载端到端流程通过**，两次provider退出后均独立只读核对，完整大文件和80名称列表核对。
- build --no-run先于测试；每次测试显式≤120秒；无运行测试超时/失败。
- Rust1.85.1 offline+locked，Clippy all-targets -D warnings和fmt通过；C++ MSVC /W4 /WX通过。根manifest/lock、产品源码和第三方版本未修改。

原件：[Rust10项](../../../../tmp/native-nested-20261102/rust-final.json)、[Store CLI](../../../../tmp/native-nested-20261102/store-regression.json)、[固定样本CLI](../../../../tmp/native-nested-20261102/fixture-regression.json)、[映射CLI](../../../../tmp/native-nested-20261102/mapping-regression.json)、[目录锁CLI](../../../../tmp/native-nested-20261102/namespace-regression.json)、[最终构建作业](../../../../tmp/native-nested-20261102/build-final.json)、[宿主编译](../../../../tmp/native-nested-20261102/host-first.json)。
流式构建输出已经在会话收取，后续job_output为空的JSON只证明作业身份/退出码。一次Clippy因显式auto-deref失败，按提示去掉冗余解引用后通过，[失败作业记录](../../../../tmp/native-nested-20261102/build-check-first.json)保留；未禁警告或降低断言。

最终测试父提交e34e4b517090f60aff010f7716359362ee244e15；staged tree915e80b067dbfc6c570e3dba91e0f9e22d552f9d。
- probe子树0c1aeebe34049aa761469aab0fdc2c558a8b6a57；C++ blob4e78d2218ad06eb69769a8b90004f75b64b12761。
- host EXE SHA256：fcaf6ad45c129676efcb7f6775d3c35bdbfdacb509aeda9ea08f56401e9a75a4。
- Rust DLL SHA256：0479f7e89c1613b1102994b908f4902546cb949cbb5b76650d0c850086923e09。
- checker SHA256：d2665c63b21fe6fc8dc1d3adb0fe54c7b8c890d6494084afa37eaf541853df54。
- WinFsp DLL SHA256：94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3。

[架构图源](WINDOWS-NATIVE-ARCHITECTURE.drawio)与[SVG](WINDOWS-NATIVE-ARCHITECTURE.svg)同步移除root-only与“尚无第二次挂载”的旧限制。仅做XML/标签一致性复核，未声称模型目视通过；旧报告与截图仍保留原始证据身份。

## 尚未合格

这是顺序、非发布诊断，不是产品SDK原生Workspace已启用。桥mutex串行化回调/control；并发Commit与文件回调的回复排序、cached/mapped writes的可见性与capture边界、崩溃恢复仍未验证。
该诊断固定Workspace authority只用于已结束的前后两个进程，不证明并发身份唯一或跨进程shared ownership。UTF-8精确拼写之外的WTF-8/大小写别名、symlink/hardlink、完整Win32属性与安全写入仍未实现/合格。目录枚举使用SourceView分页，并不是所有WinFsp cookie/restart/并发目录变化语义均通过。

第二次挂载只读取并验证UpToDate，没有再作第三次变更Commit；本轮覆盖的是第一轮变更提交后真实新挂载可见性。源码中的错误输出含预期NoSuchPath/Exists/NotEmpty，并不代表被静默吞掉的成功；原件同时保留。
下一段：针对WinFsp缓存写/可写映射与capture/Commit的发布边界做独立原生实证，保持未知结论非PASS，再决定产品级准入和生命周期方案。

风险档中；所有Store显式Disposable/WAL/OFF，Durable未执行。生产LOC104392→104392（+0）：Core38454、Engine63178、API2760；exact first-parent/staged产品树与同一计数器核对，非发布工具/测试/文档排除。无测试删除，旧root-only拒绝断言改为真实嵌套成功加非法路径拒绝。
reference absent (retired R9c; last counted65,417 at tree498dd1917812)。品味判断点无新增；未确定的能力边界如上。
