# LayerFS 1.2.0 — Windows 原生支持

> **Status:** Release candidate for LayerFS 1.2.0. Not tagged. The candidate is
> the native Windows route qualified on 2026-11-04 (see the receipts under
> [`core/docs/issues/352`](../../../core/docs/issues/352/) and the plugin's
> `docs/native-*-20261104.md`). The tag `v1.2.0` is to point at the release
> commit that adds this record.

## Owner direction

Windows 原生路由的目标是让 LayerFS 在 Windows 上**不依赖 WSL2、不依赖 Docker、不起 daemon**
即可使用。这条线来自 #352 与 #454 的方向；1.2.0 把它作为 1.x 的一个新平台能力发布。

## What 1.2.0 is

Windows 原生路由（`route: native`）：

- **Store**：SQLite 原生；Store 调用在调用方进程内执行；跨进程 writer lane（内核命名互斥）；
  卷守卫（仅本地 NTFS、长路径正确）；owner-only DACL；卷序列 + 文件索引身份
- **Workspace**：WinFsp 原生挂载；一个 Workspace 一个挂载；关闭顺序受控
- **Exec**：受限启动器，非 root 身份，IPC 边界受控
- **分支与提交**：publish、merge、diff、apply（原子）、blame、容量
- **Node 绑定**：准入与发现
- **dsh 插件**：LayerFS 页面（Work / Sandboxes / History）+ 原生 Workspace 生命周期
  （创建 / 挂载 / Commit / 卸载 / 关闭）+ 16 KiB UTF-8 文本窗

能力与测试的逐项对应见
[Windows 原生能力清单](../../../core/docs/issues/352/WINDOWS-NATIVE-CAPABILITIES-2026-11-05.md)。

## Verification

- Rust Windows 套件 **63 个用例**（persistence / project / store-service / overlay / node 五个 crate）
- C++ 探针 **7 个文件**：WinFsp 挂载、回调、接纳、section 持有；受限执行、IPC、cwd
- dsh 插件侧 5 套 native 测试 + 2026-11-04 真实浏览器 GUI 全生命周期验收
- 2026-11-05 活模型会话：模型经工具调度自行发起 bash，拿到 16 个 `DSH_LAYERFS_*`
  变量并跑通 CLI 分支列举（见
  [活模型会话验证](../../../core/docs/issues/352/WINDOWS-NATIVE-LIVE-AGENT-2026-11-05.md)）
- 证据：仓库内 **78 份** `WINDOWS-NATIVE-*` 回执
- CI：`ci.yml` 的 `windows` job 覆盖 store 系列；C++ 探针、node 绑定与插件集成不在 CI 内，
  由本地与 3081 回执覆盖

## Release gate

发布门内容：五个 crate 的 Windows 套件 + 原生路由 SDK face。本 fork 的 GitHub Actions
被禁用（`gh workflow run` 返回 422），因此**门禁在本机执行**并在
[门禁回执](../../../core/docs/issues/352/WINDOWS-NATIVE-GATE-RUN-2026-11-05.md) 记录
693 通过 / 0 失败。工作流文件保留，fork 一旦启用 Actions 即可直接使用。
产物与哈希见 [ARTIFACTS.md](ARTIFACTS.md)；机器可执行验证器（spec/run/归档 + 硬 meta 门）见
[VERIFIER.md](VERIFIER.md)。

## Known limitations

六项边界的逐项定性与理由见
[Windows 原生边界](../../../core/docs/issues/352/WINDOWS-NATIVE-BOUNDARIES-2026-11-05.md)。

1. **agent 路径**已验证到 CLI 级（活模型 + 工具调度，2026-11-05）；GUI 输入路径未覆盖。
   另：插件按文件夹字符串精确匹配项目，正斜杠 cwd 会静默拿不到 `DSH_LAYERFS_*`（限制）
2. **机器级发现**的作用域是 this-host-runtime，不做跨进程或跨机列举（范围）
3. **宿主崩溃后不自动恢复**；保留/不确定的句柄需要人工关闭与清理（限制）
4. **不提供强制 unmount**；Workspace 为 Dirty 时按设计拒绝卸载（拒绝）
5. **GUI 文本窗上限 16 KiB**；大文件与二进制走 CLI 或原生命令（限制）
6. **无并发外部写/改名的 CAS 承诺**；多写者需外部协调（限制）

## Upgrade

从 1.1.0 升级不需要数据迁移：Store 文件、Project 记录与 Commit 格式不变。
Windows 上需要安装 WinFsp，并提供受限启动器所需的权限配置。
