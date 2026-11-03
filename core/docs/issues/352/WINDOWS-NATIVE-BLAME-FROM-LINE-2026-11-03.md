# 原生 Store 的 blame fromLine（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.blame` 的 `fromLine` 此前没有消费者；本轮补上：[native_blame_from_line_real.mjs](../../../../api/runtime/test/verify/native_blame_from_line_real.mjs)。

通过原生 Windows Store（`/note.txt` 由三个提交逐行追加为 `one/two/three`）：

- `blame(..., 1)` → 3 行（n=1,2,3）；
- `blame(..., 2)` → 2 行（n=2,3），第 1 行被跳过。

[结果](../../../../tmp/native-blame-from-20261103/actual-second/result.json) 读取 2026-11-03T12:51:50.392Z，[命令](../../../../tmp/native-blame-from-20261103/actual-second-command.json)。

保留的 FAIL：首跑以为结果字段是 `items`（实际是 `lines`，行号字段是 `n`）。

## 限制

只覆盖 3 行文件；`nextLine` 续读（超预算）、`origins`、`comparisonCoarse`、二进制拒绝未覆盖。生产 LOC 不变。

first parent 723865cd13c77a8745ddaad2b7914e9b280565ae；本记录只增文档/测试。
