# 原生 Store 的批量变更：rm／mv／write 一次提交（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.apply` 的 `changes` 支持 `write/edit/mkdir/chmod/rm/cp/mv`；此前只测过纯写入与单文件 diff。本轮补混合操作：[native_apply_ops_real.mjs](../../../../api/runtime/test/verify/native_apply_ops_real.mjs)。

通过原生 Windows Store：

1. 先 `apply` 两个 write（`/a.txt`、`/b.txt`）。
2. 再一次 `apply`：`{op:"rm", path:"/a.txt"}` + `{op:"mv", from:"/b.txt", to:"/c.txt"}` + `{op:"write", path:"/d.txt"}`。
3. 结果：**只新增 1 个提交**；根目录恰为 `c.txt`、`d.txt`、`seed.txt`；`c.txt` 内容仍是 `b` 的原内容；`/a.txt` 读时拒绝 `NoSuchPath`。

[结果](../../../../tmp/native-apply-ops-20261103/actual-first/result.json) 读取 2026-11-03T10:07:20.208Z，[命令](../../../../tmp/native-apply-ops-20261103/actual-first-command.json)。本轮一次通过，无消费者返工。

## 限制

只覆盖 rm/mv/write 的组合；`chmod`、`cp`、删除目录、失败中途（一个 change 拒绝时整批不提交）未覆盖。生产 LOC 不变。

first parent f2b717b7ad4555113e301213c0039396f0daa538；本记录只增文档/测试。
