# 原生 Store 的 apply 与 diff_files（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.apply` 把一批变更写成一次提交；`fs.diff_files` 比较两个 ref 下同一路径。此前都没有真实消费者；本轮补上：[native_apply_diff_real.mjs](../../../../api/runtime/test/verify/native_apply_diff_real.mjs)。

通过原生 Windows Store：

- `fs.apply('feature', [{op:'write', path:'/one.txt', content:'1\n'}, {op:'write', path:'/two.txt', content:'2\n'}], 'batch write')` 后两个文件都可读；
- 再 `fs.write('/one.txt', '3\n')` 产生第二个提交；
- `fs.diff_files(第一个提交, '/one.txt', 第二个提交, '/one.txt')` 的 JSON 同时包含旧值 `1` 与新值 `3`。

[结果](../../../../tmp/native-apply-diff-20261103/actual-first/result.json) 读取 2026-11-03T05:35:48.728Z，[命令](../../../../tmp/native-apply-diff-20261103/actual-first-command.json)。本轮一次通过，无消费者返工。

## 限制

只覆盖 Store 面、写入型 changes 与单文件 diff；删除型 changes、二进制 body、行块细节与分页未覆盖。生产 LOC 不变。

first parent aca86dcd904fffa5bd8d97100762fe4c2d00c183；本记录只增文档/测试。
