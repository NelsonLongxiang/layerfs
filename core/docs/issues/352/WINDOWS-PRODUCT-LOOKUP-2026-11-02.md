# Windows产品接线首段：共享kernel lookup端口（2026-11-02）

> **Status:** Implemented product component with Windows diagnostic consumption; not SDK Windows Workspace support.
> 本次Git消费链活证2026-11-02T02:37:42.360Z–02:37:45.992Z，对账读取02:44:13.367Z（UTC；Asia/Shanghai同日10:37、10:44）。不是性能测量。

## 已实现

[StoreOperation::kernel_lookup](../../../../engine/crates/layerfs-store-service/src/store/kernel_lookup.rs)接管单个名称的kernel查找：复用现有Workspace/Overlay原子visit，Needs时在Overlay锁外补给本操作的不可变事实，再继续未决求值；失败和未知结果不重放。没有第二encoder、数据库、worker、WinFsp依赖或产品对tools的依赖。

正向结果KernelLookup保存inode、原始KernelReadOutcome及StoreOperation作用域；成功原子查找取得一个kernel lookup引用，丢弃Rust回执不会FORGET。调用方仍负责显式kernel_forget和独立文件/目录句柄的释放。

KernelLookupFailure保存mount、parent、name、原始失败边界、最后观察（若已有）和原操作/provider/backing作用域。只有观察结果Ok且decision为Refused，才返回确定的语义拒绝；事务失败旁边的决定值不作为成功依据。[Windows消费端](../../../../tools/projfs-probe/src/native_overlay.rs)已删除重复的fact-supply循环并调用该产品端口；非语义失败保存在Session，挡住后续准入及正常关闭，不仅转换为字符串后丢掉原因。缺失路径等确定拒绝不触发这一保留状态。

这是产品机制端口，不是SDK方法、完整路径遍历、权限检查或挂载实现。现有SDK Workspace调用仍归Sandbox daemon，Windows产品入口继续明确Unsupported；本轮没有仅移除拒绝或把诊断Session复制成已发布实现。

## 实证

| 范围 | 结果 |
| --- | --- |
| 产品端口直接测试 | 3 PASS：引用直到显式FORGET、Missing/NotDirectory原始拒绝、foreign/revoked mount拒绝且另一Workspace可用 |
| 既有原生适配Rust测试 | 14 PASS：Overlay8、binding3、coordination3 |
| StoreService既有产品测试 | 12 PASS：核心5、Windows/容量7 |
| 实际WinFsp消费链 | 嵌套mkdir/read/write/list/rename/rmdir、两Commit、持有句柄及同Store新挂载PASS |
| 普通Windows Git消费链 | 19条Git命令+1 setup退出0，17文件before/after相等，协调关闭两provider均正常exit0 |
| 产品边界/静态检查 | 扫描967个产品文件PASS、守卫自测36 PASS、root StoreService和probe全目标Clippy -D warnings、fmt通过 |

[产品端口测试源码](../../../../tools/projfs-probe/tests/product_kernel_lookup.rs)使用既有合成Store夹具，但直接调用真实StoreService，不经诊断Session。[三项定向回执](../../../../tmp/native-product-lookup-20261102/product-tests-first.json)、[14项适配回归](../../../../tmp/native-product-lookup-20261102/rust-regression.json)、[产品核心](../../../../tmp/native-product-lookup-20261102/service-core.json)、[产品Windows](../../../../tmp/native-product-lookup-20261102/service-windows.json)、[native活证](../../../../tmp/native-product-lookup-20261102/native-regression.json)、[Git活证](../../../../tmp/native-product-lookup-20261102/git-regression/result.json)。

Git两provider的Cleanup/Close分别1643/1643、746/746，均无取消、无原始lookup保留失败。独立[before](../../../../tmp/native-product-lookup-20261102/git-regression/before.json)/[after](../../../../tmp/native-product-lookup-20261102/git-regression/after.json)逐条一致；不是仅依据成功字符串判断。沿用显式协调关闭选择，普通stop和历史FAIL不变。[对账汇总](../../../../tmp/native-product-lookup-20261102/summary.json)。

编译使用Rust1.85.1 offline/locked，先test --no-run后有界运行，每条测试命令显式不超过120秒。[root构建及消费端初建](../../../../tmp/native-product-lookup-20261102/build-first-collected.json)、[root严格检查](../../../../tmp/native-product-lookup-20261102/build-product-test-collected.json)、[probe最终严格检查](../../../../tmp/native-product-lookup-20261102/build-final.json)、[守卫](../../../../tmp/native-product-lookup-20261102/guard-final.json)。首次构建有迁移后unused import警告，已删除并通过-D warnings；没有改依赖或安装工具链。

## 身份与局限

父提交871893705000c8750a5b32a0cd8011b0be711cf4；封存受测tree22216437ce54f6741281b470c9da64537e9a5abc。StoreService subtree38be56c4f285e3fcae2e6bd02430db1310f22ef7；probe subtreeb170265745fbe3bdaabfed3b34896a59c017064d。之后仅加入本报告，不改变受测实现。

| 实跑binary | SHA256 |
| --- | --- |
| 沿用host | bae2aa4bf8f68726c7859ae383b67db433fd965906fd39de93df3867446a7bf1 |
| WinFsp DLL | 94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3 |
| 新Rust bridge | 0bfa3a454d0ac310d6fc37c861b34d68bf14e307e834384b7e2776b65cf9e706 |
| 新client | cb20bb6462de9525217ba672cfa75ce514602769159da92a3494e84dc2ffe081 |
| Git launcher | 851535ccc041bed536a23b17200cd51e7b06e266a527f4eaf8338b5c256c6466 |

Hash证明字节一致，不是签名编译溯源；Git launcher不认证全部helper。本轮没有注入未知事务或供应商读失败，故这些失败分支的端到端资格仍未证；已有revoked失败检验保留原观察，不等于模拟了所有未知结果。Linux daemon/FUSE完整测试在本Windows环境未运行；既有Workspace all-targets/Linux-only dev依赖限制及历史工具平台失败不被本轮覆盖。

首次证据汇总因正则匹配转义错误得到0计数而失败，保留[原汇总失败](../../../../tmp/native-product-lookup-20261102/summary-audit.json)；读取原测试回执后修正统计，[修正审计](../../../../tmp/native-product-lookup-20261102/summary-audit-fixed.json)通过，未重跑治疗或修改原测试结果。全部Store显式Disposable/WAL/OFF，无Durable、WSL替代、系统配置/DSH写入或真实用户仓实验。

## 下一段

产品接线任务3b7a154bc4保持doing：本轮只完成共享lookup产品端口与真实消费，不完成SDK mount/status/Commit/unmount。后续继续按现有engine所有权推进native open/read/close或mount owner边界，避免产品include诊断私有代码；不恢复旧host-mediated Store路线。完整kernel引用、可写映射同步、所有并发/崩溃恢复及Windows SDK Workspace/Sandbox仍未合格。

Production LOC: **104682 -> 104842 (delta +160)**。Core38454不变；Engine63468→63628（StoreService10428→10588）；API2760不变。相同[production_loc.py](../../../../tools/production_loc.py)对exact first-parent与受测暂存树的git archive导出计数，[before](../../../../tmp/native-product-lookup-20261102/loc-parent.json)/[after](../../../../tmp/native-product-lookup-20261102/loc-staged.json)；工具/测试/文档排除，新产品端口完整计入，无测试删除或范围搬迁。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。本轮无新增品味判断点；上述未验证部分不作确定结论。
