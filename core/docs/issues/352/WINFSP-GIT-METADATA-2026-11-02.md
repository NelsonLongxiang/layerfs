# 原生 Windows Git：持久化属性修复与未完成的关闭边界（2026-11-02）

> **Status:** Implemented metadata/enumeration repair with passing focused regressions; the complete Git workload remains FAIL at its second normal close.
> 最终Git活证：2026-11-01T21:06:34.283Z–21:06:47.429Z（UTC；Asia/Shanghai 2026-11-02 05:06）。本轮不是性能测量。

WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos.
[WinFsp repository](https://github.com/winfsp/winfsp)。使用已授权安装，不重装、不重启、不改DSH、第三方源码或全局Git配置。

## 结果：数据路径已证，整项未完成

普通Windows Git 2.46.0.windows.1在新隔离WinFsp挂载中完成init、add、两次Git commit、status、fsck、check-ignore及重挂载后的show。**19条Git命令均exit0；另1条是Store setup，共20条子命令。17个文件在LayerFS Published Commit和新进程重挂载后长度/哈希一致，包含.git/index、对象、refs及被Git忽略的文件。**

第一次挂载正常关闭；第二次挂载的Git命令也全部结束，但等待Close回执的10秒有界条件未达：**files=8、directories=0、cleanup=730、close=722**，pending Commit/capture/retained均为0。测试因此exit1，第二个测试provider被其控制器精确取消；这不是正常unmount成功。未延长等待、未提前释放OpenFile、未禁用Git的Hidden行为、未强制文件flush或unmap。

- [完整FAIL回执](../../../../tmp/native-git-20261102/final/result.json)与[命令退出](../../../../tmp/native-git-20261102/final-command.json)。
- [数据检查点](../../../../tmp/native-git-20261102/final/data-checkpoint.json)在第二次LayerFS Commit前写入，所以其中second_layerfs_commit=false；最终回执中该项为true，normal_close_complete始终false。
- [17文件清单](../../../../tmp/native-git-20261102/final/before.json)与[精简失败分析](../../../../tmp/native-git-20261102/final-analysis.json)。检查点的git_commands=20沿用子命令计数；[汇总](../../../../tmp/native-git-20261102/validation-summary.json)另明确19条Git+1 setup，不混淆。

Git版本历史：851eed09fa5b59edc006bea640b1abb5b00329f2 → 35d38c50ced38c8194fcc32602ec26da46acad84。
LayerFS Commit1为128dcc606637ff5b135f99a9e63adf1bee04eac2c6da0fec46939790ea55661a7b，保存3509字节；第一次provider有54 create、44 write、22 rename、9 delete，1643 Cleanup/1643 Close、errors0。重挂载后Git status可刷新index/文件属性，第二次LayerFS Commit实际为Committed（126b4cacdb5c7aa04e9f5b2bf409f9f83b1474ed8ce198fe87b951c9d4a58baa71，parent=Commit1，878字节），不冒称只读或UpToDate。

## 本轮修复

1. **Windows基本属性持久化。** Git创建.git后默认设置Hidden；原host无SetBasicInfo，返回Function not implemented。现有Workspace原先只有portable mode/mtime/size，不能诚实完成Hidden。现在[Overlay inode](../../../../engine/crates/layerfs-overlay/src/contract/types.rs)与[schema40](../../../../engine/crates/layerfs-overlay/sql/schema.sql)保存Hidden/System/Archive（mask0x26），由同一active/captured/orphan代际管理；ReadOnly映射portable mode，不增加内存属性表或第二数据库。
2. **复用规范构造。** [windows_metadata](../../../../engine/crates/layerfs-workspace/src/windows_metadata.rs)通过Content已有opaque属性树保存domain=windows、key=file-attributes、4字节大端值；缺值为0，错宽度/未知位拒绝。CapturedNamespace把flag变化视为真实变更，保留其余属性；移除flags、后续代际、已知Install和孤儿引用使用原路径。Content格式和全局Store schema未改。
3. **原子创建/修改/覆盖。** 公共Workspace增加CreateWindows、SetWindowsAttributes、SetOpenWindowsAttributes、OverwriteWindows；创建携初始flags，覆盖同时truncate和replace/merge flags，非法字段先拒绝。[原生适配](../../../../tools/projfs-probe/src/native_metadata.rs)分别记录data-write和write-attributes权限，不能靠attribute-only句柄写文件数据。独立creation/access/change时间仍Unsupported；原本展示为portable mtime投影的事实不变，未假造完整NTFS时间模型。
4. **空目录枚举。** Git命令通过后，完整清单读取空objects/info目录曾返回ENOENT；host未返回dot entries。现在非root目录的点条目及父条目来自已有目录handle与当前parent custody，目录移动后也保持正确，不保存虚假namespace行或扫描路径猜parent。
5. **明确关闭观测。** host只在close状态变化时记录exact files/dirs/pending/capture/retained与Cleanup/Close；关闭准入与期限不放宽。数据检查点与整体FAIL分开保存。

[实现说明](../../../../tools/projfs-probe/README.md#native-basic-metadata-and-ordinary-git) · [Overlay架构](../../architecture/19-daemon-overlay.md#windows-basic-flags-schema-40-2026-11-02) · [捕获构造架构](../../architecture/78-captured-namespace-construction.md#windows-basic-attribute-round-trip)。

Local Overlay schema从39→40；只生成新template和新Overlay，不迁移/重开旧Overlay，不触碰运行中的既有挂载。使用旧版本overlay模板的调用方需按新版本重建模板，不做静默转换。全局Store仍Disposable/WAL/OFF，Overlay仍MEMORY/OFF/EXCLUSIVE；Durable未执行。Project Init仍没有完整NTFS属性导入资格，本轮证明的是挂载中创建/变更属性后的Commit和重挂载。

## 验证

| 范围 | 实际结果 |
| --- | --- |
| Overlay产品测试 | **81 PASS**，含新增Windows flags capture/孤儿持有/清除与既有payload/lifetime/索引回归；非Windows allocation target在此为0 tests，不计PASS数 |
| StoreService产品测试 | **12 PASS**，真实Windows backing/ACL/volume guard与既有能力回归 |
| 原生探针Rust | **20 PASS**，新增metadata round-trip及dot-parent；18项原绑定/Commit/scope/close等存续测试 |
| 原生集成回归 | 嵌套Commit/同Store重挂载、显式双挂载、capture后并发切片、normal-close、cache8阶段全部通过；close8/cache11解析控制通过 |
| ProjFS CLI回归 | **18项通过** |
| 生产边界 | 扫描966个Rust/SQL/JS文件PASS；定向守卫自测36 PASS |
| 普通Git完整场景 | **FAIL**；19 Git命令exit0和17文件重挂载核对通过，但第二次normal close未完成 |

[全部计数与原件索引](../../../../tmp/native-git-20261102/validation-summary.json)、[metadata定向](../../../../tmp/native-git-20261102/native-metadata-final.json)、[其余探针18项](../../../../tmp/native-git-20261102/native-unit-final.json)、[新Overlay用例](../../../../tmp/native-git-20261102/product-windows-attributes.json)、[native回归](../../../../tmp/native-git-20261102/native-regression.json)、[双挂载](../../../../tmp/native-git-20261102/binding-regression.json)、[并发](../../../../tmp/native-git-20261102/concurrent-regression.json)、[close](../../../../tmp/native-git-20261102/close-regression.json)、[cache](../../../../tmp/native-git-20261102/cache-regression.json)、[guard自测](../../../../tmp/native-git-20261102/guard-self-tests.json)。

Rust1.85.1使用offline/locked、先test --no-run再执行；每个测试显式≤120秒。探针all-targets Clippy -D warnings通过，root Overlay/StoreService all-targets及Workspace --lib Clippy通过；[最终探针构建](../../../../tmp/native-git-20261102/build-complete-collected.json)、[root最终检查](../../../../tmp/native-git-20261102/product-final-complete.json)。MSVC /W4 /WX构建成功，实际二进制身份如下。rustfmt使用已安装1.8.0 stable；指定1.85.1的rustfmt未安装，未临时装工具链或更改PATH。

**未通过的广域检查保留：** root Workspace all-targets因既有dev依赖拉入Linux-only daemon，在Windows报os::unix/nix缺失，未修改daemon平台边界来凑绿。FUSE存续test的Inode初始化增加零flags但其运行未在Windows验证。整个tools unittest为139项，6 FAIL/20 ERROR，集中于Windows不具st_blocks/os.uname、Unix权限及路径分隔符假设；[广域原件](../../../../tmp/native-git-20261102/boundary-final.json)不被定向守卫PASS覆盖。未宣称全仓测试绿或跨平台全资格。

## 失败演进原样保留

- [first](../../../../tmp/native-git-20261102/first-command.json)：Git不接受Node devNull的设备路径作为配置；用任务目录的空配置修正隔离环境，不读/改全局配置。
- [config-fixed](../../../../tmp/native-git-20261102/config-fixed-command.json)：默认.git Hidden触发ENOSYS，定位到SetBasicInfo缺口；[Git同版源码](../../../../tmp/native-git-20261102/mingw.c)只读参考，未patch Git。
- [metadata-first](../../../../tmp/native-git-20261102/metadata-first-command.json)：schema新增字段后遗漏orphan INSERT第16参数，Git config替换触发；补齐实际孤儿路径并增加对应回归。
- [orphan-fixed](../../../../tmp/native-git-20261102/orphan-fixed-command.json)：Git命令已过，空目录枚举ENOENT，修dot entries。
- [dots-fixed](../../../../tmp/native-git-20261102/dots-fixed-command.json)、[close-observed](../../../../tmp/native-git-20261102/close-observed-command.json)：第二次close readiness超时，新增观测确认8个Cleanup未Close；当前[final](../../../../tmp/native-git-20261102/final-command.json)仍失败。每次对应代码/观测修订，未通过不修改等待值/断言，所有挂载失败根保留。
- 计数命令曾在30秒整体期限中断：parent计数完整、staged文件为空；检查现有导出后只续跑未完成staged计数，未重复测试或覆写历史失败结论。

## 固定身份与下一步

父提交bfc568ca15eabc59faf3c40de63029be024b38c5；覆盖本轮实现的暂存树ff1a9bc7601a4908860df2ac5b9775d373e54381。
Overlay树9185df45edeeeab1cfc5f098c9908f187db1c985；Workspace树9208d07b09287ec5aa3a22e25cf2c7a8d1d10a04；probe树abbd40e854acb3a1ef9258b08b70e59277e2418a；host blob726a867f9b7c7f0e5a24408536e4632cad547e77。

| 实跑二进制 | SHA256 |
| --- | --- |
| WinFsp host | 78d8b81249874c1aa4b41f687eae1cbf8b2784fa50da7f0bc7e45b694d57a5f4 |
| Rust DLL | 6843756259ff435e707efc31af8d481734f85766147a3b4bef3f04992a24b7ec |
| checker | c2af1c72f0956c3eb18554b6345f4d7cb00727ba2e2bb5a1aade981fe3d27b26 |
| WinFsp DLL | 94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3 |
| Git launcher | 851535ccc041bed536a23b17200cd51e7b06e266a527f4eaf8338b5c256c6466 |

Git launcher身份不等于安装目录所有Git helper的逐字节认证。测试只使用新合成仓与per-process配置；未触碰LayerFS/DSH源码仓的Git工作内容。文件清单是小fixture验证，不宣称有界大仓枚举性能。

**任务8dc8d475a1保持doing。** 下一段在同样有界期限内定位8个具体handle/文件及其Cleanup→Close缺口，区分内核缓存/section持有与适配自身泄漏；不能以Git退出、句柄计数或显式flush猜排空。正常close保持Busy/未准入，不先stop/detach；不能用测试进程取消冒充产品强制卸载。映射同步、全kernel引用枚举、产品SDK、跨平台完整测试仍未完成。

Production LOC: **104392 -> 104682 (delta +290)**。Core38454不变；Engine63178→63468（Overlay9903→9910，Workspace8991→9274）；API2760不变。以同一[production_loc.py](../../../../tools/production_loc.py)对exact parent与staged的git archive导出计数，工具/测试/文档排除；[before](../../../../tmp/native-git-20261102/loc-parent.json)、[after](../../../../tmp/native-git-20261102/loc-staged.json)。新增生产语义没有挪入工具规避计数；无测试删除。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。

品味判断点：本轮无新增；属性必须真实保存和失败不得抹绿按正确性要求处理。未知关闭原因明确保留，尚未作根因定论。
