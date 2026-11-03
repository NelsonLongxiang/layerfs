# 原生 Store 的 edit 跨 32 KiB 窗口（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.edit` 用流式 KMP 在 32 KiB 窗口上扫描；此前只测过小文件的匹配拒绝，跨窗口匹配没有消费者。本轮补上：[native_edit_window_real.mjs](../../../../api/runtime/test/verify/native_edit_window_real.mjs)。

通过原生 Windows Store：

- 构造 32,760 字节前缀 + `NEEDLE`（起点 32,760，**跨过 32,768 边界**）+ 1,000 字节后缀；`fs.edit(...,'NEEDLE','X')` 成功，长度 33,765 → 33,760，位置 32,760 变成 `X`。
- 另一个 40,000 字节文件尾部 `FAR` → `Y`，长度 40,003 → 40,001。

[结果](../../../../tmp/native-edit-window-20261103/actual-first/result.json) 读取 2026-11-03T12:29:29.519Z，[命令](../../../../tmp/native-edit-window-20261103/actual-first-command.json)。本轮一次通过，无消费者返工。

## 限制

只覆盖单个匹配跨窗口与远端匹配；多窗口长匹配（模式本身 > 32 KiB）、二进制拒绝、`AmbiguousMatch` 跨窗口计数未覆盖。生产 LOC 不变。

first parent 85da9792822915e17cbd9dc4a1683c1fb9c21c7a；本记录只增文档/测试。
