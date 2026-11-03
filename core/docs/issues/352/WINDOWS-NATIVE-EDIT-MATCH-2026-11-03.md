# 原生 Store 的 edit 匹配拒绝：AmbiguousMatch 与 NoMatch（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.edit` 要求**恰好一处**匹配；本轮钉住两种拒绝与一次成功：[native_edit_match_real.mjs](../../../../api/runtime/test/verify/native_edit_match_real.mjs)。

通过原生 Windows Store：

- `/dup.txt` 内容 `x\nx\n`，`fs.edit(..., 'x', 'y')` → **`AmbiguousMatch`**；文件保持原样。
- `fs.edit(..., 'zzz', 'y')` → **`NoMatch`**。
- `/one.txt` 唯一匹配时正常替换（读回 `changed\n`）。

[结果](../../../../tmp/native-edit-match-20261103/actual-first/result.json) 读取 2026-11-03T10:50:15.544Z，[命令](../../../../tmp/native-edit-match-20261103/actual-first-command.json)。本轮一次通过，无消费者返工。

## 限制

只覆盖一处/多处/零处三种匹配；跨块（>32 KiB 窗口）匹配、二进制文件拒绝未覆盖。生产 LOC 不变。

first parent fa91cd583c284cd3d63e55105e6838488d2fbc42；本记录只增文档/测试。
