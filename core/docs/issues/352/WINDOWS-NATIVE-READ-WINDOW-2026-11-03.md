# 原生 Store 的 read 行窗口（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.read` 支持 `startLine/endLine` 行窗口；此前没有真实消费者。本轮补上：[native_read_window_real.mjs](../../../../api/runtime/test/verify/native_read_window_real.mjs)。

通过原生 Windows Store（`/lines.txt` 为 `l1..l5`）：

- `read(..., 2, 4)` → `startLine: 2`、`endLine: 4`，文本含 `l2`–`l4`，不含 `l1`/`l5`。
- `read(..., 3)`（不传 end）→ `startLine: 3`、`endLine: 5`（窗口默认到末尾/上限）。
- `read(..., 9)`（越过 EOF）→ 空文本、`endLine: null`。
- `read(..., 4, 2)`（end < start）→ **`InvalidInput`**（`endLine must be at least startLine`）。

[结果](../../../../tmp/native-read-window-20261103/actual-first/result.json) 读取 2026-11-03T11:15:07.952Z，[命令](../../../../tmp/native-read-window-20261103/actual-first-command.json)。本轮一次通过，无消费者返工。

## 限制

只覆盖 5 行文件与单页窗口；`next`（超过 `REPLY_BUDGET` 时的续读指针）、超长行截断（`clipped`）未覆盖。生产 LOC 不变。

first parent f40500a929ec2c555c1385f9177f90cd1ce88753；本记录只增文档/测试。
