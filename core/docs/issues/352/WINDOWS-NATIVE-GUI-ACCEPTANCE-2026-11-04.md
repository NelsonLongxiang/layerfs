# Windows 原生路由：真实 GUI 验收（2026-11-04）

> **Status:** Dated functional verification. 在隔离 3081 上完成浏览器验收；不是发布资格，也不是完整 GUI Workspace 生命周期通过。

## 结论

**GUI 项目/历史/存储/文件/Blame 读取通过；native Workspace 的挂载→编辑→提交→卸载 GUI 闭环未取得资格，因为当前界面没有这些入口。** 没有用 SDK/API 调用冒充按钮点击。主 task 3b7a154bc4 未在本轮关闭；缺失生命周期入口已登记为 task 6930e4ec4d。

## 环境与来源（读取时间 2026-11-04，Asia/Shanghai）

- 浏览器：Tabbit CLI，通过实际页面点击/鼠标操作；目标 http://127.0.0.1:3081/；3080 未使用。
- LayerFS：72c44d5337d6c8b3e47015b08e46fcdca1f3cf5e（本文第一父提交）。
- dsh-layerfs：父提交 382a2ed232cdeeebcf75d12c204c4f8212a2ea19；本轮修复提交 **5d63d49d99f0a9151f2f68506f15d3dd7ce2bb9a**，已推 fork/main 并用远端接口读回相同 SHA。
- DeepSeek Harness：ce7073d51254c26cd63b22a60835b8f948deb447；只读检查，未改源码、构建产物、Git 状态；未重启宿主。
- 插件已有未提交的主题/资源改动，构建时包含它们，但本轮未编辑或提交那些文件。实测属于带明确哈希的本地组合，不宣称 clean release。
- 插件的 LayerFS pin 为 fabefdf87a4fa4742897998c2ece883013939184，与实测 checkout 不同；check:layerfs 返回失败已保留。没有暗改 pin。
- [源码与产物哈希](../../../../tmp/gui-3081-20261104/identity.json)、[完整插件验收记录](../../../../../dsh-layerfs/docs/windows-native-gui-20261104.md)。

## 实际点击与读回

| 页面/动作 | 结果与证据 |
|---|---|
| 侧边栏 LayerFS → native1 | 正常渲染项目、main L6、7 Layers、1 Branch、42 Commits；[History 截图](../../../../tmp/gui-3081-20261104/history.png) |
| Files → agent-written.md | 正文显示 agent-path write；[点击与读回](../../../../tmp/gui-3081-20261104/12-file-mouse-command.json) |
| File → Blame | 行归属 C7、37 versions compared；list/read/blame 三个实际浏览器资源均 200；[读回](../../../../tmp/gui-3081-20261104/16-verify-blame-command.json) |
| Storage | 266 KB on disk、156 KB raw history、1.4x dedupe、6.0x compression；[截图](../../../../tmp/gui-3081-20261104/storage.png)、[读取](../../../../tmp/gui-3081-20261104/08-tabs-command.json) |
| Sandboxes | 显示 native route、0 Workspaces、up to 16 mounts per instance；仅 Refresh，无 native 挂载/编辑/Commit/卸载控件；[截图](../../../../tmp/gui-3081-20261104/native-workspaces.png) |
| All projects | 显示 4 projects、Store calls in-process；发现并修复 native 被误报 Docker not answering；[修复后回归](../../../../tmp/gui-3081-20261104/23-final-regression-command.json) |

文件读取使用的是页面产生的 saved id **32569fa170f69562dae81ec974268fd47f5d126740979c004da9ed514bd71d39a1**，不需要构造新数据。因此此前 [host 冒烟记录](WINDOWS-NATIVE-HOST-ROUTE-SMOKE-2026-11-04.md) 中“未找到可读 id”的限制已由本轮证据补上；此前 409 没有保存完整响应体，不能据此确定它是 NotComparable。

## GUI 发现并修复的真实问题

All projects 的 Health 将所有非 ok 的 engine 状态当作 not answering，但 host 已正确返回 not-used。另有闲置项目标题暗示下一次挂载会启动 Sandbox、把本地 Store 当 Docker volume。

只修改插件 AllSandboxes 与 Overview 类型：显示 not used · Windows-native、no container sweep needed、Native projects · no containers required、Store local；daemon 路由文案保持不变。没有改 SDK/Store/host。

- 插件构建通过；只写插件自身 lib，Harness 仅作为只读构建 preset。
- [真实浏览器回归脚本](../../../../../dsh-layerfs/packages/client/tests/native-overview.tabbit.js) 在重新构建、刷新同一页面后 **PASS**；时间 2026-11-04T00:35:54.402Z（08:35:54 +08:00）。
- [客户端既有回归](../../../../tmp/gui-3081-20261104/client-regressions-command.json)：historycache、playback（16 steps）、initlimit、scenario-projects 通过；全部显式前台超时。
- 修复后的 bundle SHA256：d4184b7ab1cae1146183ef309b538ae36daa76ae46e0673c10f475d87e5416d5。
- 插件生产 LOC **8965 → 8966（+1）**，精确父/暂存树计数；LayerFS 本仓生产 LOC **112122 不变**。插件计数范围及脚本见 [计数结果](../../../../tmp/gui-3081-20261104/plugin-loc/counts.json)。

## 未取得资格与保留失败

- 不能宣称 GUI 可创建 native 实例、挂载/编辑/Commit/卸载；现有 GUI 是状态/读取面。host runtime 动作仅承接既有 unmount/discard/stop；本轮无已注册 native 实例，不借后台制造成功。
- 0 Workspaces 来自 host 的 Sandbox 派生列表，不证明所有独立创建的 native 实例均已被全局发现。
- 没有验证 agent skills 注入、模型驱动写入、崩溃/retained/跨用户；也没有证据证明所有 GUI 错误绝不影响 Store，不能重复此前这种绝对保证。
- Chrome 控制先因缺远程调试授权失败，用户指定换 Tabbit；未绕过授权。错误 locator、DOM 重绘与一次正则拼写错误均保留在编号回执中。
- 构建后截图工具超时；**不伪造修复后截图**，修复后的 DOM、浏览器响应和回归回执已保留。3 张较早截图为浏览器返回原件的字节副本。
- 无关 /__dsh_a2a/state 401、/layerfs-mock 404 保留，不在本次修复范围。
- Tabbit 90 秒空闲释放期间出现一次重取标签失败，随后按实际 tab id 重取；[最终页面状态](../../../../tmp/gui-3081-20261104/29-finish-state-command.json) 与 [finish 回执](../../../../tmp/gui-3081-20261104/browser-finish-command.json) 确认只关闭本任务空白页，保留 3081 页面、正常释放浏览器所有权。

## 本轮边界

没有创建新会话、运行模型、写 Store 或修改现有项目数据；没有更改 profile、恢复调度、重启 3081/3080 或修改 Harness。品味规则已查询，没有 ratified 规则；本轮没有新增业务口味判断（问题为路由状态与显示不一致的技术缺陷）。
