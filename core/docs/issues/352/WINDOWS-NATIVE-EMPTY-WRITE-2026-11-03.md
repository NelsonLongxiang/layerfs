# 原生 Store 的空内容写入（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.write` 写入空内容的行为此前没有消费者。本轮补上：[native_empty_write_real.mjs](../../../../api/runtime/test/verify/native_empty_write_real.mjs)。

通过原生 Windows Store：

- `write('/empty.txt','')` → 成功，`read` 为空、`stat.type: "file"`、**`size: 0`**；
- 再写一次同样的空内容 → 同样成功（`put()` 逐段相同即跳过，不产生新变更）。

[结果](../../../../tmp/native-empty-write-20261103/actual-second/result.json) 读取 2026-11-03T15:54:09.011Z，[命令](../../../../tmp/native-empty-write-20261103/actual-second-command.json)。

保留的 FAIL：首跑断言 `receipt.changed`，实际 receipt 没有该字段。

## 与作者偏向的关系

源码与文档表明空内容是合法值：引擎 `target()` 对任意长度（含 0）都创建普通文件、`write()` 无 `is_empty` 分支；`api/docs/agent.md` 说 CLI “sends them exactly”、`edit` 只拒绝空的 `oldText`（歧义）。因此**空内容不拒绝**是既有设计，不是遗漏。

## 限制

只覆盖新文件；覆盖已有非空文件为空的路径、空 `fs.apply` change 未覆盖。生产 LOC 不变。

first parent 35fc3757eff899c074973fed4e1a340b47d805dd；本记录只增文档/测试。
