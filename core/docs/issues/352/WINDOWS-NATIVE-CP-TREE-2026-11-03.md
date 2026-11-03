# 原生 Store 的递归 cp 与覆盖写（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.cp` 固定 `recursive: true`，此前只测过单文件；本轮补上目录树与覆盖写：[native_cp_tree_real.mjs](../../../../api/runtime/test/verify/native_cp_tree_real.mjs)。

通过原生 Windows Store：

- `/src` 含 `a.txt`、`b.txt`、`sub/c.txt`；`cp('/src','/dst')` → `/dst` 列出同样的三项，嵌套文件可读（`three\n`）；
- 对已存在的 `/dst/a.txt` 再 `write('ONE\n')` → 读回 `ONE\n`，`stat.size` 为 4（覆盖而非追加）。

[结果](../../../../tmp/native-cp-tree-20261103/actual-first/result.json) 读取 2026-11-03T14:50:23.438Z，[命令](../../../../tmp/native-cp-tree-20261103/actual-first-command.json)。一次通过。

## 限制

只覆盖单棵小树；cp 到已存在目标、大文件、权限/符号链接混合未覆盖。生产 LOC 不变。

first parent 3f19c465533add2324e20365aa76fb29023d5c29；本记录只增文档/测试。
