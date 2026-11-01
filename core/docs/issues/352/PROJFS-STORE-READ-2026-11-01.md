# 真实 Store 根的 ProjFS 只读投影（2026-11-01）

> **Status:** Dated diagnostic result; not a writable LayerFS Workspace or production release.
> 固定源码 `d1fb56127f28ba572314791d5c3741ccbb90d675`；活证时间 2026-11-01 20:26:38–20:26:39，Asia/Shanghai。

## 已完成

普通 Windows 进程通过 ProjFS 直接读取真实 LayerFS Store 的固定版本。没有全量导出到挂载目录，没有新增服务协议，也没有修改产品 SDK、Overlay、daemon、DSH 或根 Cargo workspace。

读取链：`Handles::open_read_only(Disposable)` → `Storage::reader()` → `TreeTable` / `directory::list_after` → `file::read_range` → ProjFS callbacks → 普通 Windows 文件调用。初始化仍由公开 `ProjectApi::init` 创建并封存新 Store。

为证明没有回退到原目录，初始化输入被保留在另一个名称下，原路径不存在。回调只持有 Store 读取端口。

## 版本固定与按需读取实证

| 检查 | 实测结果 |
| --- | --- |
| 测试 Store | 88 项；根目录 6 项；嵌套目录；80项分页目录；中文名；空文件；4 MiB+31 B 二进制文件；另有2 MiB未访问文件 |
| 启动 | directory_reads=0，range_reads=0，emitted=0，payload_reads=0；小元数据根读取883字节，**不是零I/O** |
| 固定根 | `5fc1e087f7f2d4afcafde2b579a1d5d4a0145639d72c3142865a2a5da75df082` |
| 随后推进Branch | 当前根变为 `8bf45173e15d2fb5e9242fe3bda1f5e856d332e58bc3f1703e65f14267913461`；投影仍读到旧alpha内容 |
| 普通进程 | 根枚举、80项目录完整、嵌套二进制四个窗口逐字节一致、中文和空文件正常 |
| 未访问文件 | never.bin未进入读取集合，停止provider后磁盘上也不存在，占位未物化 |
| 实际回调读取 | 3次GetFileData调用，7个Content读取窗口，输出4,194,382字节；0 panic / 0 notification overflow |
| Store读取端 | payload_read_bytes=15,980，pack_read_bytes=32,947，pack_write_bytes=0；这是诊断计数，不是物理设备读取量或冷缓存性能结论 |

**系统预读不能隐瞒**：应用只请求了四个二进制小窗口，但ProjFS实际水合了已打开大文件。成功证明的是启动惰性与文件级按需，不能说只加载四个小窗口或证明任意大文件都保持小驻留。

## 只读边界

“只读”指Store内容源：读取使用只读SQLite会话；投影已有文件的写入/重命名/删除在本实验中被拒绝。
**不代表整个NTFS投影目录是只读安全沙箱**。本机仍允许新建local-only.txt；测试确认该文件保留在NTFS，但不存在于Store。无写回实现。
为挑战固定根而执行的独立 `files::commit` 只是正常Store写操作，绝不是投影变更的Workspace Commit。

## 精确身份与验证

- source tree：`428380bbf03ac5f5fc75eec95a6f14626e709fc9`。
- 探针exe SHA256：`6e5c214baa517d2fd4c7ceca4aa8122b1417bc18d231d3896da20e73c9cdeaed`。
- Rust/Cargo 1.85.1；offline+locked；全部86个注册表依赖版本及checksum与主仓锁文件一致，无新增第三方能力库。
- 7项Rust测试通过：原5项范围算术 + 名字拒绝 + 实际Store固定根/分页/边界测试。
- 原固定内容CLI回归6/6；新Store CLI边界与活证4/4；Clippy all-targets -D warnings通过。
- 格式检查使用已有默认rustfmt（1.85.1格式组件此前缺失），未安装/更改工具链。

构建与验证命令（详细执行时点见回执；最终活证与测试二进制均对应固定提交源码）：

```sh
cargo +1.85.1 build --manifest-path tools/projfs-probe/Cargo.toml --offline --locked --target-dir tmp/projfs-probe-target -j 2
cargo +1.85.1 test --manifest-path tools/projfs-probe/Cargo.toml --offline --locked --target-dir tmp/projfs-probe-target --no-run -j 2
cargo +1.85.1 clippy --manifest-path tools/projfs-probe/Cargo.toml --offline --locked --all-targets --target-dir tmp/projfs-probe-target -j 2 -- -D warnings
# 测试分别使用timeout 30s/90s/110s，构建不计入测试时间
node tools/projfs-probe/tests/store-smoke.mjs tmp/projfs-probe-target/debug/layerfs-projfs-probe.exe tmp/projfs-store-20261101/store-d1fb56127
```

最后一条是历史实跑命令；该输出目录已存在，重跑须换新目录，不能覆盖。

原件：[Store CLI](../../../../tmp/projfs-store-20261101/store-d1fb56127/result.json) · [精确指标](../../../../tmp/projfs-store-20261101/store-final-summary.json) · [范围测试](../../../../tmp/projfs-store-20261101/ranges-final.json) · [Store测试](../../../../tmp/projfs-store-20261101/saved-final.json) · [旧样本回归](../../../../tmp/projfs-store-20261101/fixture-final.json) · [静态检查](../../../../tmp/projfs-store-20261101/build-final.json) · [依赖一致性](../../../../tmp/projfs-store-20261101/lock-parity.json)。

## 保留失败与局限

- 初次使用BranchSnapshot.root编译失败，按真实公开类型改为effective_root。
- 首次完整构建60秒期限中断链接；续跑通过，两个后台构建已收齐回执。不是测试超时被改预算。
- 单测夹具路径含../../导致Win32 verbatim ACL ERROR_INVALID_NAME；改为规范化已存在父目录后通过，原失败保留。
- 初次独立依赖解析选取了较新传递版本；最终锁以根锁为种子经Cargo离线裁剪，版本/checksum差异为零。首次活证不代替最终锁下的回执。
- 单目录1024项、单次Content读取1 MiB、单source mutex、1024条通知只是诊断限度；超界明确失败，不静默截断，不能推广为产品限制。
- 只测试合法UTF-8原拼写、普通文件和目录。symlink、WTF-8孤立代理、Win32特殊名字、ProjFS排序重名会拒绝。大小写别名、hard-link语义、GC并发所有权、任意完整仓库投影未合格。

## 验证器与下一段

该切片是单独的只读投影证明，**不满足冻结Workspace W2的读写删改，也不满足W3/W4**。不将本次PASS填到workspace-live行，不回写旧spec/run。
上一轮正式就绪结论仍是Store 9/9 PASS、Workspace 1/4 PASS（仅组件项），不能冒称这套产品检查在本提交重跑。这里提供的是固定提交下的7项Rust与10项CLI实证。
下一段：研究/验证本地NTFS修改到Overlay的稳定捕获，在开放句柄/映射仍存在时准确拒绝或取得稳定输入，再复用CapturedNamespace/Save/History链；不得用监听事件、重新Init或fs.apply伪装Workspace Commit。
本轮产品源码、根manifest/lock、宿主和DSH均未修改；生产LOC 104392→104392（+0），新增诊断不发布、不自动部署。
品味判断点：无新增；实现边界来自公开API和实测，不作业务裁决。
