# Real Store read-only projection evidence

> Status: Current diagnostic evidence checks; not writable Workspace qualification or a product release.

Retained native-only proof is imported without re-running it. Historical Store and Workspace receipts retain their original source and time. An all_pass tree exposes all three leaf verdicts; no live mutation/capture claim is inferred.

P1 必须导入完整四用例原始回执，退出码和二进制哈希一致、起止时间有效；记录基线快照、明确声明的源码提交及树、探针树、测试脚本和回执哈希；导入不是产品重跑，也不是源码到二进制的签名证明。
P2 启动时目录读取、文件范围读取、发出字节、payload读取均为0，并报告无目录扫描和无文件范围预读；不把元数据读取称作零I/O。
P3 固定根必须与推进后的Branch根不同，普通子进程仍读到固定根的旧字节；Branch挑战不是Workspace写回。
P4 普通Windows子进程必须核对88项Store的6个根条目、80项目录、4个二进制读取窗口及精确字节、嵌套目录、中文名和空文件；回调读取大于0且panic和通知溢出为0。
P5 2MiB未访问文件必须未读取且未物化、原输入路径不存在；记录实际水合字节，不以应用小窗口推断细粒度驻留或冷缓存性能。
P6 Store读取源必须只读且pack写入为0，已有投影文件写改删拒绝；NTFS允许本地新文件但不进入Store、无写回，不把投影根称作只读安全沙箱。
P7 Workspace资格必须为false，overlay_capture和commit_writeback保持NOT_RUN，并明确列出sandbox_isolation与open_mapping_lifecycle未验证；只读投影不能替代W2/W3/W4。
P8 SQLite快照必须携带result及四个指定用例共5份非空原始JSON和各自SHA256，便于归档后复核；不得只依赖人工总结或已迁移的本机路径。
