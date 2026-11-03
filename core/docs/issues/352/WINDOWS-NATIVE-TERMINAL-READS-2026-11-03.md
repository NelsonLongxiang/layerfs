# 实例终态后的读模型（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

实例进入终态后，两个读模型应有明确且不同的行为。本轮用真实消费者钉住：[native_terminal_reads_real.mjs](../../../../api/runtime/test/verify/native_terminal_reads_real.mjs)。

## 已关闭的实例

- `sandbox.list_workspaces` 拒绝 **`NoSuchSandbox`**（先经 `#running` 的实例状态检查）。
- `project.list_sandboxes` 返回 **空 `items`**（`client.js` 的 closed 分支：实例已关闭就不再列出 Sandbox）。

## retained 的实例

- 外部杀死 resident 后，`sandbox.list_workspaces` 与 `project.list_sandboxes` **都拒绝 `Unknown`**（实例保管未确认，不伪造空列表或成功）。
- 该实例名下的挂载仍可显式卸载；`runtime.close()` 仍拒绝 `Unknown`。

## 实证

两个独立 client（一个 client 只能绑定一个显式原生控制，绑定第二个实例会拒绝 `InvalidInput`）分别绑定 closed 与 retained 实例。[结果](../../../../tmp/native-terminal-reads-20261103/actual-third/result.json) 读取 2026-11-03T03:06:21.710Z，[命令](../../../../tmp/native-terminal-reads-20261103/actual-third-command.json)。

首跑两处消费者错误：把两个实例绑到同一个 client（被 `InvalidInput` 拒绝），以及重命名后残留一处 `shop.branch.fork`；产品断言此前已通过，只改消费者并保留 FAIL 原件。

## 限制

只覆盖这两个读模型；retained 期间其它 daemon 读模型仍是 `Unsupported`（见能力矩阵）。生产 LOC 不变。

first parent b862b27948ba6cc19fe3ff512967500eef07d63b；本记录只增文档/测试。
