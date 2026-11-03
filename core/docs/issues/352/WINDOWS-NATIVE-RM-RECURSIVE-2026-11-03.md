# 原生 Store 的递归 mkdir/rm 与深层 list（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.mkdir`/`fs.rm` 在 SDK 里固定 `recursive: true`；此前只测过单层。本轮补上：[native_rm_recursive_real.mjs](../../../../api/runtime/test/verify/native_rm_recursive_real.mjs)。

通过原生 Windows Store：

- `mkdir('/a/b/c')` → 深层目录创建；`list('/a/b')` 返回 `c`；
- 写入 `/a/b/c/f.txt` 后 `rm('/a')` → 整树消失，`list('/')` 不再含 `a`；
- 删除后再 `stat('/a/b/c/f.txt')` → **`NoSuchPath`**；`rm('/nope')` 同样拒绝。

[结果](../../../../tmp/native-rm-recursive-20261103/actual-first/result.json) 读取 2026-11-03T14:35:22.059Z，[命令](../../../../tmp/native-rm-recursive-20261103/actual-first-command.json)。一次通过。

## 限制

只覆盖单棵小树；`rm` 对文件的语义、大量条目、并发删除未覆盖。生产 LOC 不变。

first parent 29244b0a6d398165ecd9c4717d7a3058d1232d9b；本记录只增文档/测试。
