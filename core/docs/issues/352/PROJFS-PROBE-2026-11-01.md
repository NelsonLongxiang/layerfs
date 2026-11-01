# ProjFS 原生活投影探针结果（2026-11-01）

> **Status:** Dated diagnostic result; not a LayerFS Workspace implementation or release qualification.
> 本轮只新增独立开发探针，产品 Store-only 拒绝契约未改变。时间均为 Asia/Shanghai。

## 实际进展

19:24 重新检查时，系统 ProjectedFSLib.dll 与 prjflt.sys 已出现。19:25 只读探针确认 API 可加载、所需导出存在，当前进程仍未提权。此前18:56的缺组件记录保留。启用者及具体启用时间 UNKNOWN；本会话没有执行 DISM enable、提权或重启。

提交 `194f3a6b6059aeec7705f3c22c7415b7ff9eaa9f` 增加了 [ProjFS 探针](../../../../tools/projfs-probe/README.md)，只属于未发布诊断工具，不是 Cargo 根 workspace 成员。未修改产品 addon、SDK、Overlay、daemon 或 DSH。

## 证明了什么

探针投影一个96 KiB确定性文件，内容最初只在provider内存中；真实的独立Windows进程进入新目录，经过普通文件系统调用完成：

- 枚举得到 projected.txt；
- 按需回调提供98,304字节，读回逐字节一致；
- 跨块位置的23字节读取一致；
- 追加后读回一致、重命名后原名不复现；
- 新建本地文件、读回、删除且不复现；
- 修改后的 renamed.txt 经系统API确认状态为 FULL（8）；
- 显式停止provider，待PrjStopVirtualizing返回后释放回调状态和DLL。

固定提交后的活证输出：

```text
CHILD_PASS enumerate hydrate unaligned-read append rename create delete
FILE_STATE renamed.txt Ok(8)
COUNTERS enumeration=2 placeholder=1 read=1 bytes=98304 notifications=19 panics=0 overflow=0
LIVE_PROJECTION_PASS file=projected.txt child=read-write-rename-delete stop=drained
NOT_RUN overlay_capture commit sandbox_isolation open_mapping_lifecycle
```

通知覆盖 pre-convert-to-full（4096）、modified-close（1024）、pre-rename（32）、renamed（128）、new-file（4）、pre-delete（16）、deleted-close（2048）。19是该次实测计数，不是固定总数断言。

**尚未证明**：该文件来自真实LayerFS Store，稳定Overlay frontier、单Commit回写、内存映射/开放句柄跨capture、故障恢复、真实Sandbox隔离。这个结果不是 workspace.exec 已可用，也不能直接替代Workspace W2判据。

## 身份、命令、检查

| 对象 | 身份/结果 |
| --- | --- |
| 源码 | `194f3a6b6059aeec7705f3c22c7415b7ff9eaa9f` |
| source tree | `16ee7464db38a9e764cd7dc01aabc8ada0500438` |
| 探针exe SHA256 | `93d83d347bf1b56cb31c6926627a6805c6dc81bf482eec7a7b3912f4d5509bbc` |
| 构建 | Rust/Cargo 1.85.1，offline+locked，windows-sys 0.61.2/windows-link 0.2.1 |
| 静态检查 | Clippy all-targets -D warnings PASS；现有默认rustfmt check PASS |
| 算术边界 | 5/5 PASS（对齐、EOF、超界、溢出、确定性内容） |
| CLI/活证 | 6/6 PASS（参数、child入口、API、相对路径、已有路径及哨兵保护、真实投影） |
| 新事实快照SHA256 | `aa7b7c7f8edf80025659651c317ffa7438081aa21802a1d95610742765bac72b` |

```powershell
cargo +1.85.1 build --manifest-path tools/projfs-probe/Cargo.toml --offline --locked --target-dir tmp/projfs-probe-target
cargo +1.85.1 test --manifest-path tools/projfs-probe/Cargo.toml --offline --locked --target-dir tmp/projfs-probe-target --no-run
cargo +1.85.1 clippy --manifest-path tools/projfs-probe/Cargo.toml --offline --locked --all-targets --target-dir tmp/projfs-probe-target -- -D warnings
node tools/projfs-probe/tests/smoke.mjs tmp/projfs-probe-target/debug/layerfs-projfs-probe.exe tmp/projfs-proof-<unique>
```

实际执行以Git Bash timeout包裹：单测30秒、每个CLI子进程45秒、完整smoke110秒；provider内只对子进程handle执行15秒限时。所有新根保留，拒绝既有根；未留下运行中的探针进程。

原件：[固定提交活证](../../../../tmp/projfs-live-20261101/proof-194f3a6b6/result.json)、[单测](../../../../tmp/projfs-live-20261101/ranges-at-194f3a6b6.json)、[构建与Clippy](../../../../tmp/projfs-live-20261101/build-final.json)、[组件预检](../../../../tmp/projfs-live-20261101/preflight.json)。

## 正式验证器随环境变化重跑

沿现有冻结spec，不调整门槛，不覆盖旧快照：

| 叶 | 新run | 结果 |
| --- | --- | --- |
| Store `spec_9c8f3b98db86` | `run_bd44885bd36b5ffd` | 9/9 PASS |
| Workspace `spec_04bcdb7fdf40` | `run_73fde35542ea8a27` | 1 PASS / 3 FAIL：仅组件项W1通过 |
| 新target树 `ts_608e52c660f0` | `tr_8b63573f1461` | FAIL，Store PASS + Workspace FAIL |

固定引擎与原始材料策略见[引擎采纳报告](ENGINE-FOLD-2026-11-01.md)。新的[递归材料](../../../../tools/verification/native-route/materials/tree-projfs-enabled.json)使用新快照SHA与源码提交，不重写旧树target。
独立ProjFS固定内容探针的PASS不写入workspace-live行；那一行仍明确NOT_RUN，因为它尚未连接产品Store/Workspace。

两份正式报告已附材料+快照归档并官方验包：

- [Store归档](../../../../tmp/projfs-live-20261101/run_bd44885bd36b5ffd.yglverify.zip)：arc_52c9fadd542d，6 items，ok。
- [Workspace归档](../../../../tmp/projfs-live-20261101/run_73fde35542ea8a27.yglverify.zip)：arc_66949857f34e，6 items，ok。
- 隔离固定引擎工作区[完整self-check](../../../../tmp/projfs-live-20261101/self-check-final.json)：6环全ok，44黄金案例、28归档；不宣称默认全库旧坏归档已修好。

## 保留的失败与限制

- 1.85.1 rustfmt组件未安装：未改变系统工具链，使用现有默认rustfmt；编译、Clippy和test build仍为1.85.1。
- 首次边界测试误把exact EOF当溢出；修正样例为范围内起点+溢出长度，并保留EOF no-op断言，原失败回执保留。
- 本机现已具备组件，缺DLL拒绝路径只完成源码/动态装载边界实现；最终环境下未人为卸载组件验证，NOT_RUN。
- provider用局部有界日志（1024事件）供此次小实验，溢出使probe失败；不得推广为产品全局容量上限。
- 原生进程写入后的full file实际存在NTFS，进一步证实[研究中的语义差距](WINDOWS-WORKSPACE-PROJFS-RESEARCH.md)，不能直接等同Overlay写事务。

## 下一段

优先把已钉版Store根作为只读内容提供者，再独立验证完整路径枚举与范围读取。之后才解决NTFS修改与Overlay之间的稳定捕获；保持现有共享构造/Save/History发布链，不用re-Init或fs.apply冒充Workspace Commit。开放句柄/映射与并发修改的边界必须有单独证明。
本轮生产LOC 104392→104392（+0）；新增的是明确隔离且不发布的诊断工具，不是将产品代码移出计数范围。
品味判断：无新增；范围划分来自既有产品契约和本轮实测，不作业务仲裁。
