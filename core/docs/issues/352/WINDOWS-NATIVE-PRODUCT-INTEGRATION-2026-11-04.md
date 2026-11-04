# Windows 原生 Workspace：产品接线与闭环资格（2026-11-04）

> **Status:** Dated functional verification. 单机 Windows、显式原实例所有权；GUI 与 agent 脚本路径分开取证，不是安装/发行或模型自主调度资格。

## 结论

1. 插件 host 现在保留 runtime.native.create 返回的原始 instance 及显式 bindClient 的原 SDK client，不重建句柄、不自动创建/重试/丢弃。状态来自本 host runtime 的原观测，不再从 Sandbox 空列表伪造 native 0 挂载。
2. 已在 3081 用真实 Tabbit 点击完成创建实例→挂载新 Branch→加载/编辑/保存中文 UTF-8→提交前卸载 Dirty 拒绝→显式 Commit→正常卸载→关闭实例；关闭后独立 SDK 进程读回精确正文/head/message。
3. agent 接线提供公共 runtime wrapper 与明确的部署信息；实际 contributor 在真实 detached Session 上生成 DSH 环境并交给独立脚本进程。该进程自己持有原 runtime/instance，两个本地 SDK clients 共享同一原实例；完成受限命令/Dirty/Commit/读回/卸载/关闭。父进程独立读回并收集 trace。**没有**把 host 的进程内句柄交给 agent，也没有 Store RPC。

## 已交付代码与独立评审

| 插件提交 | 内容 | 非自我同 SHA 评审 |
|---|---|---|
| 54a8fb81328b6b96fde043cc7276ced3f25357c2 | host 原生实例 owner 与鉴权 project/native 路由 | dsh/9af264d0，direct-eed60931 PASS |
| d53604e2cf6fefceba196dd33a0968ec11fca01b | GUI 生命周期与原受限 Session 文本窗口 | dsh/9af264d0，direct-86092fa5 PASS |
| 428bdfb7367abd9260edc75f699306d66201114b | 实际 GUI 闭环记录 | 文档片；代码 SHA 如上 |
| fbba907dd8e13c9a7e44b902df66de327fd71d24 | agent 公共 runtime wrapper 与 native 部署变量 | dsh/9af264d0，direct-c71032f2 同 SHA PASS，并独立 fresh 真跑通过 |

四片均已推插件 fork/main 并远端读回；agent 片获得独立同 SHA PASS（含评审自主 fresh 真跑），未借前片 PASS 覆盖新 SHA。详见 [host owner](../../../../../dsh-layerfs/docs/native-workspace-owner-20261104.md)、[GUI 记录](../../../../../dsh-layerfs/docs/native-gui-lifecycle-20261104.md)、[agent 记录](../../../../../dsh-layerfs/docs/native-agent-integration-20261104.md)。

## GUI 真实证据

- [逐步摘要](../../../../tmp/native-product-owner-20261104/gui-summary.json)、[Dirty 拒绝与 Commit 的 GUI 回执](../../../../tmp/native-product-owner-20261104/gui12-command.json)、[正常卸载/关闭/空实例列表回执](../../../../tmp/native-product-owner-20261104/gui13-command.json)、[最终截图](../../../../tmp/native-product-owner-20261104/gui-lifecycle.png)。
- Branch gui-native-20261104-1236 的创建是 SDK 前置准备，**不算 GUI 生命周期操作**。其余生命周期动作均真实点击；主分支未发布/改写，测试 Branch 保留。
- [独立 SDK 读回](../../../../tmp/native-product-owner-20261104/gui-readback.json)：GUI native lifecycle proof 中文（换行），head 12f5ff54dc8085ce74f0247398916f595d7e02f11af7765456f323745b9af5c0c9，message GUI native lifecycle acceptance 2026-11-04。
- 16 KiB 是小文本 GUI 编辑窗口，不是 Store/文件/Workspace 总量限制；空文本、BOM 和中文原样处理，保存不 Commit。大/二进制 GUI 编辑、外部并发 rename/write 原子 CAS 不在本资格内。

## agent 独立进程证据

- [父进程最终结果](../../../../tmp/native-agent-integration-20261104/actual-final/result.json)、[agent 子进程结果](../../../../tmp/native-agent-integration-20261104/actual-final/child-result.json)、[完整调用与退出回执](../../../../tmp/native-agent-integration-20261104/final-command.json)。产品参数、二进制路径、5 枚 SHA256、wrapper URL 均在结果中。
- 实际父/子 PID 102980/47020；正文 agent subprocess original owner 中文（换行），head 122ca447acd15c957997ce5068da21b5b35b7ea74be6d00db8381b37817979c4bb。父子 runtime 均 closed=true；原实例 tokenClosed/desktopClosed=true、processExit=0。
- collector 收到 workspace.mount、workspace.commit、workspace.unmount、backend status 等真实 trace。未注册 client 的 mount 仍 Unsupported，伪造 host handle 仍 NoSuchSandbox；runtime/SDK import 不自启。
- 第一失败样本为 plain Session 替身不兼容真实记录 API，改用公开 Session.create；第二失败为 work 父目录缺失，显式准备私有 workRoot 后 fresh-run 通过；原件保留在 actual-first/actual-second，无 mutation 自动重放。

## 仍未取得资格

- 没有调用在线模型，也没有由活的模型工具调度器启动本子进程；本结论是 **真实环境贡献器/Session 记录/独立脚本进程/公共 SDK** 接线资格，不是模型自主完成任务的资格。
- host-owned 与 agent-owned 原句柄都是 process-local；宿主 GUI 不宣称全局发现 agent 自持实例。跨进程借句柄/跨脚本续持/host 崩溃恢复未实现，不做重新创建或自动恢复。
- retained/未知结果保持原 ownership，不以空列表/成功猜测代替；强制卸载、跨用户/机器、持续压力、全映射仍未取得资格。
- 3081 用仓外一次性 --patch 启动（job pwsh-2d530fc992c349ff），没有改 profile 文件、3080 或 Harness 检出；已保留测试宿主供试用。运行中的 host 加载 GUI/owner 已审代码；新增 agent 环境变量仅对后续受控启动生效，本轮真实 contributor/Session/子进程证明直接运行已审 agent 提交。没有为载入变量暗重启现有测试宿主。
- 插件原有未提交主题/assets 没有被本轮编辑或提交；客户端构建中含这些输入，非 clean release；LayerFS pin 与当前测试版本差异仍披露。

## 源码规模与回归

插件生产 LOC：host 原 owner 8966→9083（+117）、GUI/编辑器 9083→9239（+156）、agent 薄接线 9239→9245（+6）。每片精确父/暂存树、同 counter；包含 shipped CJS/PS1/CMD 和被客户端引入的 sim 源码，测试/文档/工具/产物不计。LayerFS 本仓产品 112122 不变。

host/agent/bindings-shared/native-owner/native-routes/native-text/historycache/playback 回归通过；真实 native owner/editor/agent proof 分别使用 fresh 独立 Store，全部显式前台 ≤120s。

本记录补充而不改写 [较早 GUI 只读验收](WINDOWS-NATIVE-GUI-ACCEPTANCE-2026-11-04.md) 的历史结果；当时缺失的 GUI 生命周期入口已在后续插件实现并取得上述限定资格。主 task 3b7a154bc4 的关闭决定不由本记录代作。
