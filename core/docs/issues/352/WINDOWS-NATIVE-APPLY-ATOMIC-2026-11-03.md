# 原生 Store 的 apply 原子性（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.apply` 是「整批一个提交」；本轮钉住失败时的原子性：[native_apply_atomic_real.mjs](../../../../api/runtime/test/verify/native_apply_atomic_real.mjs)。

通过原生 Windows Store：

- 先写 `/keep.txt`（1 个提交）。
- `apply` 两个 change：`{op:"write", path:"/x.txt"}` 与 `{op:"rm", path:"/nope.txt"}`（后者不存在）。
- 整批**拒绝 `NoSuchPath`**；提交数不变、head 不变；`/x.txt` 读时 **`NoSuchPath`**（没有半成品）；`/keep.txt` 原样。

[结果](../../../../tmp/native-apply-atomic-20261103/actual-first/result.json) 读取 2026-11-03T10:24:42.936Z，[命令](../../../../tmp/native-apply-atomic-20261103/actual-first-command.json)。本轮一次通过，无消费者返工。

## 限制

只覆盖「后一个 change 失败」一种顺序；先失败后写、rm 目录、chmod 失败未覆盖。生产 LOC 不变。

first parent 05c7a48383ee879aedddbfd055eb6bd0ccef6afb；本记录只增文档/测试。
