# 空操作 edit 不会产生空提交（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

外部 CLI 报告把「多行参数被截断后替换成相同内容」描述为「exit 0 的空提交」。本轮用真实消费者测了 no-op edit 在 Store 层的实际行为：[native_noop_edit_real.mjs](../../../../api/runtime/test/verify/native_noop_edit_real.mjs)。

在原生 Windows Store 上：

- 先 `fs.write('/a.txt','same\n')`（1 个提交）；
- `fs.edit('feature','/a.txt','same','same','noop edit')`（old === new）；
- **提交数 1 → 1（未新增）**，head 不变；
- 返回 **`{kind: "UpToDate", branch, head, root}`**——不是 `Committed`。

所以产品**不会**为空操作写提交，也不会伪装成新提交：它明确返回 `UpToDate`。报告里的「空提交」应理解为「命令成功但没有任何改动」，真正的问题是 **`layerfs.cmd` shim 的静默截断**让一个本想改多行的调用变成了 no-op 而不报错，不是 Store 造了空提交。

[结果](../../../../tmp/native-noop-edit-20261103/actual-first/result.json) 读取 2026-11-03T07:52:16.020Z，[命令](../../../../tmp/native-noop-edit-20261103/actual-first-command.json)。

## 限制

只覆盖 Store 面、单文件、old === new 一种 no-op；其它 no-op 形态（同内容 write、空 apply）未测。生产 LOC 不变。

first parent 47f634b5199af18018c43661ee2c9da303a432cf；本记录只增文档/测试。
