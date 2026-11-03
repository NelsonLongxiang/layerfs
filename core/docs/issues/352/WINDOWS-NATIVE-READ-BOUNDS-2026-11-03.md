# 原生 Store 的 read 行边界与缺失路径（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.read` 的 `startLine/endLine` 组合与缺失路径行为此前没有消费者；本轮补上：[native_read_bounds_real.mjs](../../../../api/runtime/test/verify/native_read_bounds_real.mjs)。

通过原生 Windows Store（`/five.txt` 五行）：

- `read(1)` → 全部五行；
- `read(2,4)` → `l2\nl3\nl4\n`，`startLine:2`、`endLine:4`；
- `read(10)` → 空文本（越界不是错误）；
- `stat('/nope')` → **`NoSuchPath`**；`glob('*','/nodir')` → **`NoSuchPath`**。

[结果](../../../../tmp/native-read-bounds-20261103/actual-first/result.json) 读取 2026-11-03T15:20:46.335Z，[命令](../../../../tmp/native-read-bounds-20261103/actual-first-command.json)。一次通过。

## 限制

只覆盖小文件；`endLine < startLine`、超预算截断、二进制拒绝未覆盖。生产 LOC 不变。

first parent 7b2a2e1439fc5c46bd152138ef26a0d2c53ad34a；本记录只增文档/测试。
