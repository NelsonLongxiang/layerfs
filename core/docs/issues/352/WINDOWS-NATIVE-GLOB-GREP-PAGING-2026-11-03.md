# 原生 Store 的 glob/grep 分页（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.glob`/`fs.grep` 的 `pageSize/pagePos` 此前没有真实消费者；本轮补上：[native_glob_grep_paging_real.mjs](../../../../api/runtime/test/verify/native_glob_grep_paging_real.mjs)。

通过原生 Windows Store（`/f1.txt`…`/f5.txt` 各含 `needle`）：

- `glob('/f*.txt', '/', 2, 0/2/4)` → 三页 **2/2/1**，`hasMore` 依次 true/true/false，`nextPagePos` 从 2 起；三页合起来恰为 5 个路径。
- `grep('needle', '/', 2, 0/2/4)` → 三页 **2/2/1**，最后一页 `hasMore: false`。
- **条目形状**：`glob` 的 items 是**路径字符串**；`grep` 的 items 是带 `path` 的对象。

[结果](../../../../tmp/native-glob-grep-paging-20261103/actual-third/result.json) 读取 2026-11-03T11:40:20.243Z，[命令](../../../../tmp/native-glob-grep-paging-20261103/actual-third-command.json)。

两次消费者错误保留 FAIL：① 以为 `/*.txt` 只匹配新建的 5 个文件（项目 seed.txt 也算，6 个 → 页数不同）；② 以为 glob 条目是对象（实际是字符串）。产品行为两次都对。

## 限制

只覆盖 5 个文件、单目录；`skipped`（grep 跳过的文件）、超预算截断、深层目录遍历未覆盖。生产 LOC 不变。

first parent ea2a29b0dd5bb0d48eef1e8647ce6e32548add2b；本记录只增文档/测试。
