# Native WinFsp diagnostic evidence

> Status: Retained diagnostic evidence checks, not product Workspace qualification.

Import and audit prior bounded native runs without replaying product operations. Existing Store/projection/Workspace records remain unchanged with their original source and time. Author reviews are self-review, not independent arbitration. Hashes establish consistency, not producer honesty or signed provenance.

N1 必须在独立快照导入五次原生诊断运行，核对host、WinFsp、Rust桥与client二进制身份、声明源码与受测树、C++构建回执和原读取/导入时间；保留历史表，不将哈希称为编译溯源签名。
N2 普通Windows文件变更必须经真实Overlay形成两个published Commit，含打开句柄跨Commit、旧capture稳定、正确父子链和独立只读重开；不把成功字符串单独作为证据。
N3 第二个原生进程必须重挂载同一个已提交Store，无re-Init、不复制Store，UpToDate不新增Commit，独立重开仍匹配第一次两版本与head。
N4 八阶段缓存证据必须逐次拒绝ApplicationVisible及非法scope，输出不变；Published与直接读取的已发布frontier和独立History一致，保留映射可见性观察而不声称排空。
N5 一个Commit捕获后、公开测试lane释放前，普通文件变化必须进入更新active代际和revision；旧Commit固定，Install保留后来变化，独立重开核对两个版本；只覆盖受控交错。
N6 正常close必须在file、directory、view与view-only及真实stop共五次请求中作用前Busy，拒绝后I/O仍可用；释放后新请求严格prepare、stop、drain、Overlay close且退出成功。
N7 本叶必须明确为保留诊断证据，Workspace产品资格、任意并发、全部kernel section清单和ApplicationVisible保证均未合格；既有Workspace历史NOT_RUN不得被本叶改写。
N8 快照必须包含15份指定原始JSON及1份导入manifest共16份非空artifact与SHA256；audit在运行前和归档提取后重算原件、所有派生事实与历史表一致性。
N9 固定受测源码的Rust回归必须为8项Overlay组合、5项范围、2项Store共15 PASS，无失败；build、test --no-run与Clippy成功，正常close与scope作用前拒绝用例均有原始回执。
