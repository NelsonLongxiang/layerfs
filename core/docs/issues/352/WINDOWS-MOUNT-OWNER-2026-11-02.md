# Windows产品WinFsp挂载owner（2026-11-02）

> **Status:** Dated implementation checkpoint; not release evidence or a released product contract.
> 最终Git运行2026-11-02T05:16:44.139Z–05:16:47.941Z，回执对账05:20:25.658Z（UTC；Asia/Shanghai同日13:16、13:20）。无性能测量或完整SDK就绪声明。

## 这轮实际接通的组件

产品Fuse新增原生C++ [WinFspMount声明](../../../../engine/crates/layerfs-fuse/src/windows/mount.hpp)和[实现](../../../../engine/crates/layerfs-fuse/src/windows/mount.cpp)，实际拥有安装DLL、复制的回调表和volume参数、filesystem对象、mountpoint、dispatcher以及初始根目录probe。不是模拟端口或无消费wrapper；[诊断host](../../../../tools/winfsp-probe.cpp)现在链接这一个产品translation unit，删除原来的WinFsp create/mount/start/stop/delete序列。

一次attach只尝试一次：显式绝对DLL和新绝对挂载路径，校验后load/create/mount/start；通过普通CreateFile/GetFileInformationByHandle打开挂载根，核目录类型、卷serial和绑定的inode serial后才得到RootServed。首次失败保留原步骤、NTSTATUS/Win32错误和已完成阶段，不重试、不猜rollback，重复或乱序调用无效果且不覆盖原失败。

RootServed只证明一次内核根请求得到匹配的应用卷号和inode，不能代替SDK Ready、全receive-loop entry、完整namespace验证或任意kernel section盘点。卷号来自应用配置，不是全局唯一mount认证。回调实现及其外部上下文仍由调用方保活，必须持续至native drain。

正常关闭由已有Session先检查descriptor/Commit/capture/retained并停止产品请求准入。WinFspMount随后显式stop/join；detach才remove mountpoint/delete filesystem；逻辑Overlay Close成功后才能release_library。析构不隐式卸载：未完成/失败owner刻意保留heap状态及其DLL/回调表/filesystem到进程结束，不以scope结束猜安全清理。这不是已实现的失败恢复接口。

[架构](../../architecture/76-native-mount-session.md#windows-winfsp-connection-owner-2026-11-02)、[消费端说明](../../../../tools/projfs-probe/README.md#product-winfsp-mount-owner)。Cargo不编译C++；[显式native构建](../../../../tools/winfsp-build.ps1)将产品source作为独立编译单元链接到host或外部测试，不从产品include工具源码、不新增Rust unsafe授权、依赖或vendor修改。

## 验证与原始失败

| 范围 | 最终结果 |
| --- | --- |
| 直接owner测试 | 6 PASS：空owner/乱序终止、相对mount、已有路径、相对DLL、缺失DLL、缺少WinFsp导出的真实系统DLL |
| 真实post-mount拒绝 | 错误root serial返回root-identity/InvalidParameter，保留Dispatching+DLL/filesystem，无false Ready；作为预期拒绝用例PASS |
| 普通关闭 | 4种file/directory/view持有状态Busy且I/O继续；释放后新关闭完成 |
| 普通Windows Git | 19条Git命令加1 setup全exit0，17文件before/after相等；两次挂载正常关闭 |
| 同Store双绑定 | 两个同时运行的独立mount/Overlay，隔离变更、合并Commit祖先、独立关闭和新挂载读回通过 |
| native编译 | MSVC14.40.33807、Windows SDK10.0.22621.0，C++17、/W4 /WX；owner及host分别编译，没有测试宏 |
| 源码检查 | 971产品文件扫描，37守卫及23计数器测试PASS；Ruff0.17.2 format/check、clang-format通过 |

[外部C++测试](../../../../engine/crates/layerfs-fuse/tests/windows_mount.cpp)不使用product test hooks、mock driver或新数据库。[owner控制器](../../../../tools/winfsp-owner-test.mjs)同时验证六个直接用例和真实挂载后根身份错误：[原始结果](../../../../tmp/native-mount-owner-20261102/owner-final/result.json)、[失败原件](../../../../tmp/native-mount-owner-20261102/owner-final/root-mismatch.json)。失败child到自身exit前保留资源；未删除投影根、操作共享driver或用恢复重试使该例变绿。

成功路径内额外核对：RootServed时detach/release/重复attach均拒绝；stop只发生一次；Stopped后的重复stop拒绝；detach后不持有filesystem、重复detach拒绝；逻辑Close后release成功且重复release拒绝。[普通关闭](../../../../tmp/native-mount-owner-20261102/close-final/result.json)、[Git](../../../../tmp/native-mount-owner-20261102/git-final/result.json)、[双绑定](../../../../tmp/native-mount-owner-20261102/binding-final/result.json)。原始顺序为根服务→准入停止→native dispatcher stop/join→detach/delete→产品request drain→Overlay Close→DLL release，host输出NATIVE_MOUNT_OWNER_PASS。

最终Git两个provider分别接收/完成9625/9625与4438/4438个Workspace ABI回调，Cleanup/Close1646/1646与741/741；普通close181/181，双绑定三个provider37/37、52/52、27/27，全部active=0/retained=0且exit0。这不是完整OS回调或mapping计数。[汇总](../../../../tmp/native-mount-owner-20261102/summary.json)、[逐项对账](../../../../tmp/native-mount-owner-20261102/summary-audit.json)、[对账脚本](../../../../tmp/native-mount-owner-20261102/reconcile.mjs)、[Git before](../../../../tmp/native-mount-owner-20261102/git-final/before.json)/[after](../../../../tmp/native-mount-owner-20261102/git-final/after.json)。

### 正常STOP0的退出码修正

初版新增dispatcher result检查，把所有负值都当失败，导致正常close在StopDispatcher返回后被错误阻止：[保留的失败](../../../../tmp/native-mount-owner-20261102/owner-and-close-checked.json)。固定WinFsp v2.2B5源码[StopDispatcher](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/dll/fs.c#L417-L440)先STOP0、join dispatcher，再STOP；[kernel接收](https://github.com/winfsp/winfsp/blob/14d6e0280ae15e2550c44d6dbc476be51649727f/src/sys/volume.c#L1163-L1184)在停止IOQ上返回STATUS_CANCELLED。原文使用此前已逐blob核验的[fs.c](../../../../tmp/native-close-20261102/fs.c)、[volume.c](../../../../tmp/native-close-20261102/volume.c)及[身份清单](../../../../tmp/native-close-20261102/source-and-close-audit.json)，未改第三方字节。

修正后先检查dispatcher在stop前未观察到失败，再调用一次stop/join，保存原始dispatcher_exit。仅这个显式停止上下文接受STATUS_CANCELLED，其它负值仍失败保管。最终六个成功provider都保留原始c0000120，不改成伪造00000000。正常停止前后有观察窗口；没有额外证明任意外部异常与本次停止的竞争归因。此前尝试不存在的dispatcher.c URL得到404，随后转向已验证的本地fs.c，没有修改Web工具或端点。

首次计数器自测4 FAIL是旧Windows路径分隔符断言，改用as_posix后保留完整成员/排除断言，23测试通过：[首次失败](../../../../tmp/native-mount-owner-20261102/owner-and-guard-tests-first.json)、[修复回执](../../../../tmp/native-mount-owner-20261102/guard-and-counter-fixed.json)。新增C++ scope、注释/字符串计数、tests排除及product-only分支/include/raw literal守卫一同覆盖，没有删除测试。已有Ruff模块0.15.22与仓pin不同，仅在工作区下载并提取0.17.2工具，没有改profile、PATH或全局安装。初次Ruff两项错误做最小等价修正；[最终检查](../../../../tmp/native-mount-owner-20261102/guard-counter-final.json)。

早期[native嵌套/两Commit/重挂载](../../../../tmp/native-mount-owner-20261102/native-first-command.json)使用host-first身份，原件不冒称最终版本。最终范围重验owner拒绝、普通close、Git和双绑定，不重跑无变化Rust：根/诊断Rust源码及manifest与父9430ec706相同，上一轮受测Rust bridge/client原字节沿用；Rust Clippy/test本轮NOT_RUN，不能把C++构建写成Cargo覆盖。每条测试显式≤120秒、先build再执行，无后台测试。

## 身份与源码计数

父提交9430ec706f8019a049f05f29f3eeca407938af2f；封版受测tree44f59e8246fd1a31637984d8f7d8517828fa502f。Fuse subtreed40f48c54ac2cbe878b0fd2db919796dad33a896，host blob353fdb229d653a5bfe71c4bf7a32086ec5c451c7。报告后加入，产品/consumer实现保持相同。

| 实跑binary/source | SHA256 |
| --- | --- |
| 新host | 3b8c113ee9b882cc59bcd4b90066d24ca7b3e70ece4a58a1bb5e261d8ac7ef1e |
| WinFsp DLL | 94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3 |
| 沿用Rust bridge | 746c207f88b48d834ab71418391412981692b3fe6b98405b212dd07c156c5b4f |
| 沿用client | 648833d19e2074d12f40d6c771590ff10bfb725ddfa25dc28953c6aace86be83 |
| mount.cpp | 1fbefde3c97a93e0b235a578f1a0ba8203725ed797c1361f387ce05e2d3fa6d3 |
| mount.hpp | afe69803e0e0915fc209200977e02afae4aa8f5e0182faec5f5bcff0fd748894 |

[最终MSVC构建回执](../../../../tmp/native-mount-owner-20261102/build-sealed.json)含source/header/owner/binary hash，原件已读回核对。Hash是字节身份而非签名编译溯源；WinFsp安装未变，driver/系统/DSH/第三方源码未改。全部新Store显式Disposable/WAL/OFF。

Production LOC: **105119 -> 105336 (delta +217)**；Core38454不变，Engine63905→64122（Fuse4603→4820），API2760不变。扩展同一[production_loc.py](../../../../tools/production_loc.py)把src内C++及headers完整纳入产品计数，Rust/SQL/JS处理不变；对exact parent与final-tested archive使用同一新版counter，[before](../../../../tmp/native-mount-owner-20261102/loc-parent.json)/[after](../../../../tmp/native-mount-owner-20261102/loc-staged.json)。父版本用新版counter重计仍105119，不因scope扩展改变旧总数。诊断host仅消费产品新对象，不把tools范围整体搬入产品；测试/文档/工具不计，没有生产语义移出或测试删除。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。

## 保留的边界与下一段

任务3b7a154bc4继续doing。真正WinFsp连接owner现已是engine产品组件并被实跑消费，但文件系统callback adapter/Rust Session仍是非发布诊断；Cargo Rust/API不自动构建或暴露这个C++单元。SDK Workspace/Sandbox/Exec仍Unsupported，产品进程注册、权限/凭证、IPC、完整Ready与mount/status/Commit/unmount入口尚待接线。不能只移除Unsupported或从产品include工具源码。

下一段应把已验证owner接到可构建产品native host和现有服务/平台入口，并按真实职责迁移callback adapter；保留实际消费者和失败状态，避免继续无消费wrapper搬迁。完整kernel引用、任意mapping同步及成功解绑、广义并发/crash仍未合格。Root probe、固定应用卷号和计数0不是这些资格。本轮无新增品味判断点；未注入其它dispatcher/FreeLibrary/partial native故障，不把这些分支写成已全面验证。
