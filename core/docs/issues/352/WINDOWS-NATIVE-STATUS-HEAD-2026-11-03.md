# Windows 原生 status 的 Branch head 观察（2026-11-03）

> **Status:** Dated implementation and scoped functional record. Native SDK status/list_workspaces now report the observed Branch head and movement. Not a Store snapshot, conflict predictor, kernel/mapping drain, recovery or release qualification.

## 意图与实现的差距

容器路线的状态值由绑定**单独读一次 Store head** 后填入 branchHead／headMovedSinceMount；status 自身不读 Store（[values.rs](../../../../engine/crates/layerfs-api/src/sandbox/values.rs)）。原生路由此前把这两个字段恒置 null，文档也写"未观察即 null"。结果是：同一 Branch 上另一个 Workspace 发布后，SDK 用户无法在 Commit 前发现 head 已移动——而这正是决定 merge 还是显式 force 的依据。

本轮把这个观察接上，不改任何发布语义：[原生路由](../../../../api/runtime/src/platform/native-windows/client.js)、[运行时契约](../../../../api/docs/runtime.md#bind-an-existing-sdk-client-to-a-running-native-instance)。

## 实现

- 注册时保存原 client；status 与 sandbox.list_workspaces 各自用该 client **自己的 Store 绑定**做一次 `branch.list_commits(branch, 1, 0)` 分页读取（仅首页 1 条），取当前 head。
- 不新建 Store 连接、不加 Store RPC、不改 daemon／Rust／C++、不设第二份 head 记录；status 仍不读 Store，读的是调用方自己的绑定。
- 语义与绑定一致：`branchHead = 当前 head`；`headMovedSinceMount = head !== 绑定的 base`。
- **空 Branch**（base 为 null 且读到的 head 为 null）是"已观察：无 head、未移动"，返回 null／false。
- **读取不可用**（拒绝或异常）保持未观察：null／null，绝不由 base 反推"未移动"。
- 已绑定 base 的 Branch 却读到空列表，视为不可用（不是"无 head"证据），同样保持 null，不猜。

## 实证

**路由级**（伪绑定，[native-client.mjs](../../../../api/runtime/test/native-client.mjs)）：伪 peer 的 base 为 null，status 得 `branchHead:null, headMovedSinceMount:false`（空 Branch 已观察）；把 `branch.list_commits` 设为拒绝后，同一 status 得 `null／null`（不可用即未观察，不从 base 推断）。scope／mixed／sdk-loss-publication 回归同时通过。

**真实受限 SDK**（[消费者](../../../../api/runtime/test/verify/native_status_head_real.mjs)）：Init 后 fork feature，创建原 resident 并绑定，同一 Branch 挂两个 Workspace。[最终结果](../../../../tmp/native-status-head-20261103/actual-second/result.json) 读取 **2026-11-02T23:04:34.742Z**（2026-11-03 07:04:34 Asia/Shanghai），[命令](../../../../tmp/native-status-head-20261103/actual-second-command.json)：

| 步骤 | A 的 status | B 的 status |
| --- | --- | --- |
| 空 Branch | base null／head null／moved false | 同 A |
| A 发布 12e5c3c4… | base=head=12e5c3c4…／moved false | base null／head 12e5c3c4…／**moved true** |
| B 合并发布 12f8356d… | base 12e5c3c4…／head 12f8356d…／**moved true** | base=head=12f8356d…／moved false |

B 的合并回执为 `{from:null, head:12e5c3c4…}`、parent 12e5c3c4…，说明 moved 观察与实际 merge 来源一致。`sandbox.list_workspaces` 在同一时刻给出相同的逐 Workspace moved 值。两个 Workspace 均正常卸载（native/parent exit0、overlayClosed），实例 checked token/desktop close 后 processExit0；runtime_closed:true、sessions/instances 空。未使用强制卸载、取消、重试或旧 owner 回收。

## 保留的失败

[首次消费者运行](../../../../tmp/native-status-head-20261103/actual-first/result.json) 在读取 `sandbox.list_workspaces` 结果时失败：SDK 把 `directory` 映射为 `path`，消费者按 `directory` 查找。产品断言（status 的 branchHead／headMovedSinceMount）此前已通过。修正仅改消费者字段，未改产品、未弱化断言；原件保留 FAIL，新输出独立目录。

## 检查、身份与精确 LOC

Node 语法、`git diff --check`、1017 文件边界扫描、37 项 guard 与 23 项 counter 自测通过；本轮未改 Rust／C++，未重复其构建，binary 字节复核见 seal。真实消费者与路由回归均在显式 ≤120 秒前台墙钟内运行。

first parent **9df94f4be68a0842a2a083e8bfe2a72788e4e0d8**；受测／计数树 **2b0f9d84b389b867484fefb096f39d9ea9534b4e**；本报告只增文档。[源码／原件审计](../../../../tmp/native-status-head-20261103/audit-final.json)、[summary](../../../../tmp/native-status-head-20261103/summary.json)、[seal](../../../../tmp/native-status-head-20261103/source-seal.json)。

**Production LOC: 111912 -> 111925 (delta +13).** Core 38454、Engine 69729（daemon 9552、Fuse 6238）不变；API 3729→3742，runtime 2152→2165（+13），agent 900 不变。[比较](../../../../tmp/native-status-head-20261103/loc-comparison.json)、[父树](../../../../tmp/native-status-head-20261103/loc-parent.json)、[封版树](../../../../tmp/native-status-head-20261103/loc-staged.json)。双方同一 production_loc.py --root archive --json，counter SHA256 8c9f1aca6779d171d026ce2506050ec6bfcec4bc28fff4695353d48a462208d3；含产品 Rust／SQL／JS／C++／hpp，排除 tests／docs／tools。无迁移、无新依赖、无删除测试、无 unsafe 例外。

未取得资格：这是**观察**，不是快照或锁；读到 head 后它仍可能立即变化；它不预测同路径并发写造成的 Conflict，也不替代 Commit 时的原 Store 判定。强制卸载、Bash／OCI、daemon 进程 API、全映射／内核排空、崩溃恢复、发现安装与发行仍不支持或未验证。历史 Git／cwd／control／verifier FAIL 原件不改。主 task 3b7a154bc4 仍 doing；无新品味判断。
