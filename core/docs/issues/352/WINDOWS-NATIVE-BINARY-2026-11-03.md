# 原生 Store 的二进制内容（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

`fs.write` 接受非字符串内容作为字节；`fs.read` 只读文本。本轮用真实消费者把这条边界钉住：[native_binary_body_real.mjs](../../../../api/runtime/test/verify/native_binary_body_real.mjs)。

通过原生 Windows Store：

1. `fs.write('feature','/bin.dat', Uint8Array([0,1,2,255,254]))` 成功并产生提交——二进制可以写入。
2. `fs.read('feature','/bin.dat')` **拒绝 `Binary`**，消息为 `text contains NUL or invalid UTF-8`——文本读取不猜、不替换。
3. 再写一版不同字节后，`fs.diff_files(旧, 新)` 能报告这是二进制差异（返回里带 `Binary` 语义，不做文本解码）。

[结果](../../../../tmp/native-binary-20261103/actual-third/result.json) 读取 2026-11-03T06:06:17.859Z，[命令](../../../../tmp/native-binary-20261103/actual-third-command.json)。

两次消费者返工保留 FAIL：第一次假设 `fs.read` 会返回 bytes（实际直接拒绝）；第二次只是把 PASS 文案从“round-trip”改成与断言一致（文本读取是拒绝，不是回读字节）。

## 限制

只覆盖写入与拒绝/差异报告；没有覆盖“通过 SDK 读回原始字节”的路径（当前 SDK 无该读取方法，这是已知边界）。生产 LOC 不变。

first parent d62f0d875a653c07256a5ce9bc4791e59018bad9；本记录只增文档/测试。
