# 原生 Store 的 grep skipped 计数（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.grep` 会跳过二进制文件并把数量放在 `skipped`；此前没有消费者。本轮补上：[native_grep_skipped_real.mjs](../../../../api/runtime/test/verify/native_grep_skipped_real.mjs)。

通过原生 Windows Store：

- `/text.txt` 含 `needle`；`/bin.dat` 是含 NUL 的二进制。
- `grep('needle','/')` → items 只有 `/text.txt` 一条，**`skipped: 1`**（二进制被跳过并计数）。
- 带 `pageSize 1` 时同样 `skipped: 1`。

[结果](../../../../tmp/native-grep-skipped-20261103/actual-first/result.json) 读取 2026-11-03T12:34:07.958Z，[命令](../../../../tmp/native-grep-skipped-20261103/actual-first-command.json)。本轮一次通过，无消费者返工。

## 限制

只覆盖一个二进制文件；超预算截断、深层目录、符号链接未覆盖。生产 LOC 不变。

first parent 442c4c307f205bd4b3126893ccb2666888068f7b；本记录只增文档/测试。
