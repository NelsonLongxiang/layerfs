# 原生 Store 的 merge units（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`branch.merge` 的 `units`（#352 F-057）此前没有真实消费者；本轮补上：[native_merge_units_real.mjs](../../../../api/runtime/test/verify/native_merge_units_real.mjs)。

通过原生 Windows Store：

- `ours` 与 `theirs` 都改了 `/gen/`（各自 mkdir + 写一个文件；theirs 晚 1.1 秒写）。
- `merge('ours','theirs','merged', msg, [{name:'gen', patterns:['/gen/']}])`：
  - `units` 恰一条：`unit:'gen'`、**`kept:'theirs'`**（更晚的写者胜）、`changedOurs:2`、`changedTheirs:2`、`dropped:2`；
  - 合并结果里 `/gen/b.txt` 是 theirs 的内容，**`/gen/a.txt` 不存在**（落败侧整单元回退到 base）；
  - 单元外的 `/plain.txt` 正常合入。

[结果](../../../../tmp/native-merge-units-20261103/actual-fourth/result.json) 读取 2026-11-03T12:00:49.477Z，[命令](../../../../tmp/native-merge-units-20261103/actual-fourth-command.json)。

三次消费者错误保留 FAIL：① 忘记 `fs.write` 不建父目录（`NoSuchPath`）；② 以为报告字段叫 `name`（实际是 `unit`）；③ 以为计数只算文件（mkdir 也计入，2 而不是 1）。产品行为每次都对。

## 限制

只覆盖「两侧都改同一单元、后写者胜」；平局（同一时间戳）走 ours、单元外冲突、`unitsTruncated`、多单元重叠（先列先得）未覆盖。生产 LOC 不变。

first parent 279293509c657fa975a0f17ca6088a19ee872d27；本记录只增文档/测试。
