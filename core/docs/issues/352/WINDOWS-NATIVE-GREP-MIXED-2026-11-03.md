# 原生 Store 的 grep 跨文件混合与长行截断（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.grep` 之前的消费者都只看单文件小结果；本轮补上混合场景：[native_grep_mixed_real.mjs](../../../../api/runtime/test/verify/native_grep_mixed_real.mjs)。

通过原生 Windows Store：

- `/a.txt` 3 处、`/b.txt` 2 处命中 → **items 合计 6**，按文件正确归属；
- `/bin.dat`（含 NUL）→ **`skipped: 1`**；
- `/long.txt` 是单行 10 万字符且含 `needle` → 命中但 **`lineTruncated: true`**，返回的 `text` 远短于原行。

[结果](../../../../tmp/native-grep-mixed-20261103/actual-first/result.json) 读取 2026-11-03T14:05:44.499Z，[命令](../../../../tmp/native-grep-mixed-20261103/actual-first-command.json)。一次通过。

## 限制

只覆盖两文件 + 一个二进制 + 一条长行；超预算跨页与二进制/长行同时触发、目录深度未覆盖。生产 LOC 不变。

first parent 64829911200ca43abc8e65b616b2d4e034e2d692；本记录只增文档/测试。
