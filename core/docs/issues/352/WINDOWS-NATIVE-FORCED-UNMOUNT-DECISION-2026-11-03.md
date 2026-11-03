# 决策：原生路由暂不实现强制卸载（2026-11-03）

> **Status:** Design decision record. It documents a refusal, not an implementation.

## 上下文

容器路径的 `workspace.unmount(ws, discard?, force?)` 有两条终态路径：

- 正常卸载：`unmount_checked` 先探针，`Dirty` 拒绝时什么都不关；成功要等 detach、所有 loop join、daemon-work drain、kernel-owner revocation 与逻辑 Close 全部完成。
- 强制卸载：`force_unmount(token, false)` 对内核连接**写一次 abort**，返回 `{ kind: "ForceUnmounted", abort, detach, cleanup }`；abort 写失败或短写即进入 retained 保管，**不重试**。

原生路由（受限 resident 实例）目前对 `force: true` 直接拒绝：

```
workspace.unmount: Unsupported — native forced unmount is not implemented; normal Busy remains reversible
```

## 决策

**在原生路由上不实现 `force`，保持 typed `Unsupported`。**

理由：

1. **没有 abort 通道。** 受限 target 的控制协议只有 `unmount`、`unmount clean`、`unmount discard` 三个动词；WinFsp 侧卸载是 `FspFileSystemRemoveMountPoint`（干净 detach），不存在“对连接写一次 abort”的原语。要强制只能杀 target 进程，那会留下没有终态确认的 overlay 与 dispatcher 状态——正是产品拒绝伪造的 retained custody。
2. **Windows 上“取消 in-flight I/O”不归我们。** WinFsp 的 dispatch 停止后，已进入的请求仍可能持有句柄/映射；内核引用由 OS 释放，不是产品能 drain 的。容器方案里的 abort 写依赖 FUSE 连接的可控中断，这个前提在 WinFsp 上不成立。
3. **overlay 删除不能先于 target 退出。** overlay 是 target 独占的 in-memory SQLite；强行删除要么被占用，要么丢掉未确认的写入。正常路径的顺序是：drain → 关闭 overlay → 删除文件 → 确认 terminal。
4. **命令流归属 target。** 后台/前台命令由 target 进程持有；强制卸载不保证它们的流不悬挂，会制造“看起来卸载了、进程还在写”的假成功。

## 后果

- `workspace.unmount(..., force: true)` 继续拒绝 `Unsupported`；文档与能力矩阵把这项列为未实现。
- 正常卸载的 `Busy` 仍是**可逆**的：持有句柄的进程退出后重试即可；这是产品选择的替代路径。
- 实例级 `sandbox.close()` 仍要求没有挂载（`MountsActive`）或保留（`Unknown`），不做隐式强拆。

## 用户可用的替代路径

| 场景 | 现在怎么做 |
| --- | --- |
| 有进程仍持有挂载内的文件 | 结束该进程（它自己的生命周期），再正常 `unmount`；`Busy` 不会破坏挂载 |
| 本产品启动的命令还占着 | 用该命令流上的 `cancel()` 请求终止（只针对原 root 进程，不按名字杀、不杀进程树），或等它结束，再 `unmount` |
| 挂载已不可用（实例 retained） | 保留 custody，按文档关闭/替换实例；不重试、不伪造成功 |

## 若要实现，前置条件

1. WinFsp 侧能提供一个可判定的“abort 连接”原语（等价于 FUSE 的 abort 写），且失败可 typed 返回。
2. 能在 abort 后证明 kernel 引用已释放（或明确接受 retained custody 的语义）。
3. 命令流能被 target 侧统一取消并确认退出。
4. 有真实消费者覆盖：abort 成功、abort 短写、abort 后重试被拒三条路径。

在这些条件满足前，实现 `force` 只会把“未确认的终态”伪装成成功。

## 证据指针

- [原生路由的拒绝](../../../../api/runtime/src/platform/native-windows/client.js)（`workspace.unmount` 的 `force` 分支）
- [容器强制的契约](../../../../engine/crates/layerfs-api/src/sandbox/unmount.rs)（`force_unmount`、`ForcedOutcome`）
- [原生 target 的卸载动词](../../../../engine/crates/layerfs-daemon/src/native/control.rs)（`unmount` / `unmount clean` / `unmount discard`）
- [WinFsp 卸载点](../../../../engine/crates/layerfs-fuse/src/windows/mount.cpp)（`FspFileSystemRemoveMountPoint`）
- [命令取消](../../../../api/runtime/src/platform/native-windows/commands.js)（`cancel()` 只请求原 root 进程终止）
