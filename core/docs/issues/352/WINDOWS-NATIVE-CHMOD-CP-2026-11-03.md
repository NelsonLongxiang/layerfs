# 原生 Store 的 chmod 与 cp（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.apply` 的 `chmod` 与 `fs.cp` 此前没有真实消费者；本轮补上：[native_chmod_cp_real.mjs](../../../../api/runtime/test/verify/native_chmod_cp_real.mjs)。

通过原生 Windows Store：

- 写入 `/a.txt` 时 `mode: 420`（0o644），`fs.stat` 读回 **420**。
- `apply [{op:"chmod", path:"/a.txt", mode:292}]`（0o444）→ stat **292**。
- `fs.cp('/a.txt','/c.txt')` → 副本 stat **292**（保留模式）、内容 `a\n`。
- `apply [{op:"chmod", path:"/a.txt", mode:4096}]`（超过 0o7777）→ **`InvalidInput`**，且模式仍是 292。

[结果](../../../../tmp/native-chmod-cp-20261103/actual-first/result.json) 读取 2026-11-03T11:22:56.425Z，[命令](../../../../tmp/native-chmod-cp-20261103/actual-first-command.json)。本轮一次通过，无消费者返工。

## 限制

只覆盖普通文件的模式位与单文件复制；目录递归复制、`cp` 覆盖已存在目标、Windows 只读属性映射未覆盖。生产 LOC 不变。

first parent 3416edbc2df4f6fe346f53607b5d206e289e9c63；本记录只增文档/测试。
