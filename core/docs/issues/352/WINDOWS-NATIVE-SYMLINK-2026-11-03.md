# 原生 Store 的符号链接（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

Init 会导入源目录里的符号链接；此前没有消费者。本轮补上：[native_symlink_real.mjs](../../../../api/runtime/test/verify/native_symlink_real.mjs)。

通过原生 Windows Store（源目录含 `target.txt` 与 `link.txt -> target.txt`）：

- `glob('/*')` → 同时列出 `/link.txt` 与 `/target.txt`；
- `fs.stat('/link.txt')` → **`type: "symlink"`**、`size: 10`（目标字符串长度）、`mode: 511`（0o777）；
- `fs.read('/target.txt')` 正常；`fs.read('/link.txt')` → **`NotFile`**（不跟随链接读取）。

[结果](../../../../tmp/native-symlink-20261103/actual-first/result.json) 读取 2026-11-03T12:57:22.457Z，[命令](../../../../tmp/native-symlink-20261103/actual-first-command.json)。一次通过。

## 限制

只覆盖文件符号链接；目录链接、悬空链接、Windows 权限/重解析点映射未覆盖。生产 LOC 不变。

first parent aef2cfa16bd51d5eee64d09fe5324adf62bfe91c；本记录只增文档/测试。
