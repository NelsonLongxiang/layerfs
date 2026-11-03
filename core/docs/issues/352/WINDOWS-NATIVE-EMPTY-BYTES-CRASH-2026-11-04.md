# 空字节体崩溃与修复（2026-11-04）

> **Status:** Dated fix record. Product change: `api/agent/src/fs/body.js`, `api/agent/src/fs/write.js`.

## 现象

通过 CLI 写空 stdin 时进程直接 abort（退出码 `3221226505`，Rust panic）：

```
thread '<unnamed>' panicked at library/core/src/panicking.rs:218:5:
unsafe precondition(s) violated: NonNull::new_unchecked requires that the pointer is non-null
thread caused non-unwinding panic. aborting.
```

最小复现（SDK 直接调用）：

- `fs.write(branch, path, '')`（文本空）→ 正常，建 0 字节文件；
- `fs.write(branch, path, Buffer.alloc(0))`（**空二进制**）→ **abort**；
- `fs.apply([{op:'write', path, bytes: Buffer.alloc(0)}])` → **abort**；
- 非空二进制（`Buffer.from([1,2,3])`）→ 正常。

## 根因

napi 2.16.17 的 `JsBuffer::into_value()`：

```rust
let mut data = ptr::null_mut();
napi_get_buffer_info(env, value, &mut data, &mut len)?;
Vec::from_raw_parts(data as *mut _, len, len)   // len == 0 时 data 可为 NULL
```

Node 对零长度 Buffer 允许返回 `data == NULL`；`Vec::from_raw_parts` 的 `NonNull` 前置条件被违反 → abort。napi 是第三方 crate（`=2.16.17`），按仓库规则不 patch/vendor。

## 修复

在 SDK 层把**零长度二进制体**按空文本发送（`content: ''`），两者对 Store 是同一个 0 字节文件：

- `body.js` 新增 `emptyBinary(value)`；`change()` 对空的 `content`/`bytes` 改为 `content: ''` 并去掉 `bytes`；
- `write.js` 对空二进制走 `{ content: '' }`。

不改变非空字节的传输方式，也不特判“空即拒绝”（作者偏向：精确字节、不把空当错误）。

## 验证

- `native_cli_empty_stdin_real.mjs`：CLI 空 stdin → 0 字节文件、非空 stdin 原样；修复前 abort，修复后通过。
- 直接探针：`fs.apply` 空 bytes 从 abort 变为成功。

生产 LOC：见提交信息里的 parent/staged 对比。

first parent d883e915c200074747641dce144c0f7ea0223709。
