# 原生NTFS捕获与开放映射边界（2026-11-01）

> **Status:** Dated diagnostic result; not a stable Overlay capture, native Workspace or product release.
> 最终活证：2026-11-01 21:42:09.043–21:42:09.439（Asia/Shanghai）。

## 结果

已实现并实跑纯Windows双进程边界探针。**拒绝共享写入的读句柄可作为本实验单文件的输入准入控制；字节锁、mtime/长度检查、通知计数和停止ProjFS不能替代稳定capture。**
没有接通Overlay、Save或History，也没有改产品Unsupported契约。

| 实际场景 | 结果 |
| --- | --- |
| 普通子进程保留可写File句柄 | 父进程以read + FILE_SHARE_READ打开，明确拒绝：Win32 32 |
| 子进程关闭File，父进程取得该读句柄 | 读取65；父进程与子进程的新写句柄均返回32；持有期间再次读取仍为65 |
| 子进程建立可写view后关闭File与section HANDLE | 只剩mapped view，父进程同样拒绝共享写入的打开仍返回32；没有误判为已关闭所有引用 |
| 另一个明确共享WRITE/DELETE的观察句柄取得LockFileEx | 子进程的mapped byte从66改为67，父进程只读映射观察到67；该普通读句柄也读到67 |
| 此次映射写入前后 | size相同、mtime相同、ProjFS该文件通知数6→6；这些条件全都不能证明字节未变 |
| 可写映射仍存活时PrjStopVirtualizing | stop返回，子进程未退出；之后映射仍从67改为68，父进程读到68；新增回调0 |
| 显式释放双方view与锁、子进程退出后 | 普通文件读取68；这不是fsync或断电持久性证明 |

[最终精确指标](../../../../tmp/projfs-capture-20261101/capture-summary.json) ·
[原始活证](../../../../tmp/projfs-capture-20261101/capture-final/capture-live.json) ·
[四项CLI结果](../../../../tmp/projfs-capture-20261101/capture-final/result.json)。

拒绝后使用共享WRITE的句柄只属于**另一个反例实验**，不是capture失败后的fallback。生产捕获不能这样放宽共享权限，也不能自动等到文件释放再重试并冒称原请求成功。

## 实现与证据身份

沿用现有固定96KiB内容源及ProjFS回调，不修改真实Store只读路线。增加capture-live/capture-child，以及限于诊断Windows模块的映射/字节锁FFI。
源文件：[双进程实验](../../../../tools/projfs-probe/src/windows/capture_run.rs)、[映射所有权](../../../../tools/projfs-probe/src/windows/mapped.rs)、[CLI回归](../../../../tools/projfs-probe/tests/capture-smoke.mjs)。

- 测试前父提交：27511be96867fbfe498dd1bb359c63d0e5819565。
- 测试固定完整staged tree：f486d7738d059bfe7150c13cb6b0eac68efd5f73。
- 探针子树：b5f8fa1bbc27bb287e2fd815ece3ac36766917ca；测试前后无未暂存差异、子树和二进制一致。
- exe SHA256：cfed0948a6a7b4ccb0d3bde2b494d3234bddbd4a527c0a4e9943ff2611e816fa。
- Rust/Cargo 1.85.1，offline + locked；仅启用已有windows-sys 0.61.2的Memory/IO/Security绑定feature，根manifest、两个lock文件和第三方源码均未改。
- 格式检查仍用已安装默认rustfmt；不安装工具链、不修改profile、Windows组件或DSH。

测试完整身份及各命令在[固定身份回执](../../../../tmp/projfs-capture-20261101/final-identity.json)和[总执行回执](../../../../tmp/projfs-capture-20261101/final-command.json)。后续报告提交仅增加文档，不改变已测探针子树。

## 验证与资源所有权

最终固定子树下：**7项Rust测试、14项CLI用例全部通过**（旧固定内容6、真实Store4、新边界4）；Clippy all-targets -D warnings、fmt check通过。

- [范围测试5项](../../../../tmp/projfs-capture-20261101/ranges-final.json)；[Store读取测试2项](../../../../tmp/projfs-capture-20261101/saved-final.json)。
- [旧固定内容6项](../../../../tmp/projfs-capture-20261101/fixture-final.json)；[真实Store4项](../../../../tmp/projfs-capture-20261101/store-final.json)；[新边界4项](../../../../tmp/projfs-capture-20261101/capture-final.json)。
- [构建/Clippy作业完成回执](../../../../tmp/projfs-capture-20261101/build-final.json)。作业stderr经会话完成通知送达，job_output后续为空；该JSON只证明记录的作业与exit0，不假造一份完整原始日志。

所有测试先构建--no-run，命令整体110秒上限；子测试分别30/60/90/45秒。子进程和父进程各15秒绝对handshake期限，单CLI上限30秒；无长跑测试后台等待。测试全部在数秒内完成，耗时不是性能结论。
File/section HANDLE与view分别释放；view只访问4KiB内的首字节，不创建外部可变内存的Rust引用。显式Unmap错误上报；没有FlushViewOfFile、sync_all或Durable执行。
普通文件只在新隔离根内操作；control标记在投影外。无命名共享对象、无网络端口、无后代进程；失败只取消本实验spawn返回的准确子进程。所有根与标记保留。

初版四项活证通过后补充跨进程写入拒绝对照并把映射场景收紧为必须返回32；最终版重新完整验证。旧[初版证据](../../../../tmp/projfs-capture-20261101/first-command.json)保留，不能替代最终证据。一次文档EOF空行检查失败已修正；未发生测试超时、测试失败或放宽通过阈值。

## 与官方契约对照

读取于2026-11-01本轮：

- [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)：没有FILE_SHARE_WRITE而已有写访问或可写file mapping时失败；共享选择持续到句柄关闭，且与进程上下文无关。
- [LockFileEx](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex)：锁定文件范围不阻止mapped view读写。
- [MapViewOfFile](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-mapviewoffile)：本地同文件的映射视图一致；与ReadFile/WriteFile不保证一般性一致，映射修改不保证更新mtime。因此本实验主观察用另一只读view，普通读结果只列本机实测。
- [关闭映射](https://learn.microsoft.com/en-us/windows/win32/memory/closing-a-file-mapping-object)：CloseHandle可在view仍打开时成功，view有单独生命周期；脏页延后写盘。
- [PrjStopVirtualizing](https://learn.microsoft.com/en-us/windows/win32/api/projectedfslib/nf-projectedfslib-prjstopvirtualizing)：停止provider服务/回调，不是撤销外部进程映射。

## 能用什么，仍不能声称什么

本实验支持在**已知、普通、本地NTFS文件**上，用保留read + FILE_SHARE_READ句柄取得稳定字节输入或准确拒绝Busy。不得据此声称目录成员关系、属性、hard-link/rename别名、多文件同一时点或完整Workspace稳定。
它会阻挡后续写打开，不能实现产品要求的capture后普通写入继续进入新Overlay generation；因此没有直接把该控制拼成Workspace Commit。

以下路径已经有反例，不能继续作为稳定性证明：
1. “没有新增通知，所以没有写入”。
2. “大小与mtime没变，所以捕获字节没变”。
3. “LockFileEx成功，所以映射不能改”。
4. “provider stop返回，所以所有外部句柄/映射释放”。

原生Workspace W2/W3/W4保持非PASS。W4要求的是完整capture/stop生命周期正确性，本次是排除错误方案的边界证据，不是W4通过。
后续应优先验证**命名空间变化的原子准入与代际写入**是否能由纯Windows请求路径拥有；逐文件share锁仅作组件基础。若ProjFS不能提供所需写请求/代际控制，应保持其只读Store投影边界，并研究Windows原生文件系统请求适配，不回退WSL，也不以bulk copy、re-Init或fs.apply代替capture。

Production LOC: 104392 -> 104392 (delta +0)：Core38454、Engine63178、API2760。仅非发布诊断工具/测试/文档变化；同一tools/production_loc.py计数器对exact parent/staged产品树比较，方法与结果留在本轮LOC回执。
reference absent (retired R9c; last counted 65,417 at tree 498dd1917812)。无测试删除，无生产源码迁移。
品味判断点：无新增；以上取舍由实测反例与既有capture契约决定，不是业务裁决。不确定项已逐项保留。
