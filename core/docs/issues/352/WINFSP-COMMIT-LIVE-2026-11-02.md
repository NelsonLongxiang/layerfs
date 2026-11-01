# 纯Windows原生变更到真实Commit（2026-11-02）

> **Status:** Dated native integration diagnostic; real captured Commit and Store reopen verified, not full product Workspace qualification.
> 最终活证：2026-11-01T16:05:12.749Z–16:05:14.606Z（UTC；2026-11-02 00:05:12–00:05:14，Asia/Shanghai）。

WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos.
[WinFsp repository](https://github.com/winfsp/winfsp)。沿用此前明确授权安装的Core+Developer；本轮未安装、重启或更改DSH。

## 结果

**普通Windows文件操作 → 真实Rust Workspace/Overlay → BoundWorkspace::commit_captured → CapturedNamespace → Save::finish → History → 本地Install → 独立只读进程重开**已在顺序诊断场景实跑通过。
不是SDK fs.apply，不是变更后重新Init，不是直接造Commit记录或重写数据格式。

| 检查 | 实测结果 |
| --- | --- |
| 原生文件操作 | 读取真实Store；300000字节写读；截断、改名、删除、同名重建 |
| 先前独立capture检查 | 旧captured reader保持before capture，活跃视图变为after! capture |
| 显式释放诊断capture | 无History发布；随后产品commit_captured自己取得新capture，未复用/重复旧capture |
| 第一次真实Commit | via=Workspace，parent=None，保存508字节；打开句柄数1；本地Install到active3/revision12 |
| Commit后继续操作 | 原打开描述符可读、可写；内容改为final! capture；新增late.txt |
| 第二次真实Commit | parent指向第一次Commit，保存516字节；打开句柄数1；Install到active4/revision15 |
| 第三次无变更Commit | UpToDate，root/head不变；History无新增记录 |
| 原生宿主退出后 | 独立只读进程重开Store：精确两次Commit、父子链、via、各版本字节/长度、head及base目录内容全部一致 |
| 收尾 | handles0、captured=None、Overlay payload_bytes0/inode_rows0；自身挂载移除、宿主exit0 |

[完整活证](../../../../tmp/native-commit-20261101/live-final/result.json) · [独立重开](../../../../tmp/native-commit-20261101/live-final/reopen.json) · [执行回执](../../../../tmp/native-commit-20261101/final-command.json)。
保存字节为本样本Storage计数，不是速度、物理磁盘IO或空间基准。

两次不可变Commit：
1. 1215514b320afd29cbfdf91b24b3db27236f70992570682d6b368ac910a3f67bc0；root7e1ea9439ef10fce95c6ae0baaf5a20c68d468fc788f986039cf92bbee39884d。
2. 1241dcb5e9cc1dfff76ca07c3c276f93be58447579a456fd5dd168b020843abf59；root1abbf330a0dc5fc5a7b697e2f4e70c682d41a38b0c9639e95e5b1657d0eedf2d。

第一版读取after! capture，第二版读取final! capture。late.txt只出现在第二版；root条目8→9，原many目录80项保留；alpha.txt仍是原Store内容，renamed.bin已删除，probe.bin为重建后的new inode。
原生回调create4/open36/read15/write6/rename1/cleanup40/close40/delete1，error0。窗口聚合可能让Write回调数与应用write次数不同，不能互相替代。

## 实现与失败所有权

[Session::commit](../../../../tools/projfs-probe/src/native_overlay.rs)只调用已有BoundWorkspace::commit_captured，要求真实capture与CapturedNamespace工作回执存在，检查完整constructor owner释放、本地base安装和History独立读取。Known-success回执在任何后验检查失败时保留；真实CommitFailure原样保留，不猜重试/close，也不从稍后读回推断原未知发布是否成功。

[Saved::open_commit](../../../../tools/projfs-probe/src/saved.rs)通过History查询Commit id，再用原有Storage/Content读固定root，不接受随意拼造的根。
[独立核验器](../../../../tools/projfs-probe/src/commit_reopen.rs)只读SQLite/History/Content，在原生进程退出后核对精确历史和内容。
[原生控制](../../../../tools/winfsp-probe.cpp)每个标记仅执行一次；[smoke](../../../../tools/winfsp-smoke.mjs)只通过普通文件API修改挂载，结束才运行只读核验器。

独立capture先显式release/resolve，无发布；它不是第一次真实Commit的capture。第一次产品Commit捕获的是已经接受的after! capture与其它修改。第二次是新的显式Commit，不是失败重试。

## 验证与版本身份

- **9项Rust测试通过**：范围5、真实Store2、Overlay/句柄/capture1、新真实Commit/持有句柄/UpToDate1。
- **18项既有ProjFS CLI回归通过**：固定样本6、真实Store4、映射边界4、命名空间4。
- **1组原生Commit端到端活证通过**，另一个只读进程完成最终重开核验。
- 反例包括：持有独立capture时Commit拒绝；空History不能通过核验；两条但不符合预期样本的History不能通过；既有duplicate create、相对/已有挂载路径拒绝保持。
- Rust1.85.1 build/test --no-run/Clippy all-targets -D warnings通过；fmt通过；MSVC /W4 /WX通过。先构建再执行，每个测试命令显式≤120秒，没有测试超时/失败，没有新增依赖。

原件：[最终构建作业](../../../../tmp/native-commit-20261101/build-final.json)、[宿主编译](../../../../tmp/native-commit-20261101/host-first.json)、[范围和Store单测](../../../../tmp/native-commit-20261101/rust-range-saved.json)、[Store CLI](../../../../tmp/native-commit-20261101/store-regression.json)、[固定内容CLI](../../../../tmp/native-commit-20261101/fixture-regression.json)、[映射CLI](../../../../tmp/native-commit-20261101/mapping-regression.json)、[命名空间CLI](../../../../tmp/native-commit-20261101/namespace-regression.json)。
构建stderr已在会话中收取；后续job_output为空的作业JSON只证明身份与exit0，不捏造第二份编译日志。

测试父提交bd385cd69ba111972e48b4d054fc7c2c695d227a；最终测试树efe36b976e69ae91bacda2e6bcc31c32e074a942。
- 探针子树：03aefd6380151103c1b1dbbde44160aa4a2fe6c0。
- C++ blob：b239378cfe95ac7d2bb834d4fbe37bc89cb13047。
- 宿主EXE SHA256：8272098b1246308aa58103f7befe52805e167b799f252bb79d7186a66d2bd749。
- Rust DLL SHA256：1b56c1e3b38a06a0623c001ce8386a845574fb3cfc0abe5d03c98aca6a8f28b3。
- 独立checker EXE SHA256：8be6beba6a020ff87f70ae6d5d7eb8fa25c003984143a6c7df4b3de01024969e。
- WinFsp DLL SHA256：94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3。
后续只加报告/图的格式修正，不改变测试实现字节。

## 架构图更新

[可编辑Draw.io源](WINDOWS-NATIVE-ARCHITECTURE.drawio) · [SVG预览](WINDOWS-NATIVE-ARCHITECTURE.svg)。图用三种标记分清真实组件、诊断接线、未合格范围，未将产品Workspace或并发映射画成已完成。

本会话技能目录没有drawio-skill，因此没有伪称调用该技能；直接生成标准mxfile与同内容SVG。XML节点唯一性/边引用、SVG尺寸已机器校验；Edge在隔离profile中写出1100×620截图，但浏览器进程在命令期限未退出而被结束，未遗留该profile的浏览器进程。
[渲染回执](../../../../tmp/native-commit-20261101/diagram-render.json) · [结构校验](../../../../tmp/native-commit-20261101/diagram-validation.json) · [实际渲染图](../../../../tmp/native-commit-20261101/architecture.png)。
当前模型不支持image input，read_image被工具拒绝，**未完成模型目视复核**；不把截图生成或XML有效写成视觉验收。该图仍作为可编辑、可查看的交付物提供。

## 未完成，不能随本轮一起置绿

1. 这是根条目/UTF-8诊断，产品SDK Windows Workspace仍Unsupported；创建目录、嵌套路径、links、完整Windows属性与安全语义未接。
2. bridge mutex仍串行化控制和回调。证明的是Commit前后顺序活动与保持打开的描述符，不是构建中并发写入/Commit正确性。
3. 首次写入关闭以让缓存写到达Overlay；不声称任何未发布内核脏页已被捕获，也不声称原生Write返回=本地发布。映射与reply/capture排序需单独证明。
4. 本轮是只读Store重开，不是第二个原生挂载；Power loss、异常退出恢复、未知发布故障注入未验证。
5. 没有自动改旧冻结W2/W3/W4或历史报告。原生Commit顺序切片已实证，不代表完整Workspace就绪。

下一段应先消除root-only路径限制，接通目录/嵌套读写与同一Store新绑定/新挂载复核；同时单列并发和映射语义，不通过增大锁范围或隐藏缓存边界来宣布完成。
风险档中：仅非发布诊断/测试/文档；Windows安装沿用既有授权，无新系统配置。所有Store显式Disposable/WAL/OFF，Durable未执行；无DSH/产品源码变更。
Production LOC: 104392 -> 104392 (delta +0)，Core38454、Engine63178、API2760；同一production_loc.py与exact first-parent/staged产品树，工具/测试/文档排除；无测试删除。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。
品味判断点：无新增；事实与正确性边界如上，未知项不作确定结论。
