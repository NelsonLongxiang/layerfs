# 外部 CLI 测试报告分诊（2026-11-03）

> **Status:** Dated triage record. Documentation only; no production source changed.

外部会话于 2026-11-03 15:37 用 `layerfs` 1.1.0 CLI 对 `obelisk` 项目做了 Windows 原生路由实测（约 15.3M logical，Store 在 `%TEMP%\dsh-layerfs\home\volumes\obelisk-store-*`）。本记录只做分诊：哪些是产品缺陷、哪些是环境、哪些与 SDK 证据不一致。

## 确认成立

- `project` / `fs` / `branch` 三族在 Windows 原生 Store 路由可用（读、写、分支、merge、publish、blame、diff、grep/glob）。
- `sandbox.create`、`workspace.mount` 等按设计拒绝 `Unsupported`，消息点名「this route has no daemon」（`api/agent/src/client.js:97` 的绑定缺失路径）。
- merge 以块为粒度：相邻行改动算同一冲突块；add/add 冲突整文件；`/.lww` 可裁决 add/add；冲突不产生对象。
- 发布链与跨重启持久化正常（Store SQLite 中分支/提交存活）。

## 真缺陷 / 缺口

1. **`layerfs.cmd` shim 多行参数静默截断**（危害最高）。`packages/host/src/bin/layerfs.cmd` 的内容就是 `node "%DSH_LAYERFS_CLI%" %*`；经 cmd.exe 传参时参数里的换行会把命令截断，`fs edit --new "line1\nline2"` 只收到 `line1`，替换成相同内容后 **exit 0 的空提交、无报错**。修法在 shim 形态或调用侧（改用 `--from` 文件），CLI 自身看不到被截断的内容。
2. **没有 `branch delete`**。`api/cli/src/branch` 只有 diff/fork/list/merge/publish，SDK 的 `branch` 模块同样没有删除；报告里 20 个测试分支无法清理。
3. **chcp 横幅污染 stdout**。程序化消费应直调 `node "$env:DSH_LAYERFS_CLI"`（报告已验证无横幅、纯 JSON）。
4. ~~`fs.edit` 对 old === new 不拒绝，会产出空提交~~——**已实测否定**：old === new 时 Store 返回 `{kind: "UpToDate"}`，提交数不增、head 不变（见 [空操作 edit 记录](WINDOWS-NATIVE-NOOP-EDIT-2026-11-03.md)）。与 1 叠加时的问题是「成功但没有任何改动」被静默接受，不是空提交。

## 环境性，不是产品缺陷

- DSH 的 bash 工具在 Windows 原生上跑 PowerShell（`$env:NAME`、无 heredoc、`2>/dev/null` 无效）。
- PowerShell 管道 stdin 会带 CRLF（27 字符 → 29 字节）；字节精确写入用 `[IO.File]::WriteAllText` + `fs write --from`。
- `fs.write` 不自动创建父目录（设计），CLI help 应注明。

## 与 SDK 证据的一处差异

报告把 `project list_sandboxes` 记为「拒绝 Unsupported」。那是 **CLI 路径**（缺 daemon 绑定）的行为；SDK 原生路由的 `project.list_sandboxes` 是**已服务**的——实例关闭时返回空 `items`（见 [终态读模型](WINDOWS-NATIVE-TERMINAL-READS-2026-11-03.md)）。两者不是同一面，文档/报告不应混写。

## 后续（2026-11-03 18:55）

- **shim 多行截断已修复**（插件仓 `dsh-layerfs`，commit `9be4724`）：新增 `packages/host/src/bin/layerfs.ps1`；PowerShell 会优先解析同目录的 `.ps1` 而不是 `.cmd`，参数按对象传递，`layerfs fs edit --new "line1\nline2"` 实测 6 个参数、换行保留。`.cmd` 保留给 cmd.exe 调用者（它仍会截断，这是 cmd.exe 的解析限制）。`pnpm test` 全过。

## 建议动作

- 文档：Windows 原生指南（PowerShell、`--from`、多行限制、shim 横幅、父目录语义）。
- 插件：把 `layerfs` shim 从 `.cmd` 换掉（或提供无横幅/可传多行的形态），或在多行内容上强制 `--from`。
- 产品：补 `branch delete`；`fs.edit` 对 old === new 明确拒绝。

本记录不改变任何能力声明；生产 LOC 不变。
