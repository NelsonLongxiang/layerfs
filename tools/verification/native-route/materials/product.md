# Retained product Windows runtime consumption

> Status: Retained evidence criteria; not a fresh execution, complete product qualification or signed release.

Author self-review is not independent arbitration. SQL facts require paired raw-artifact audit; snapshots preserve old leaves and original source/read times. Hashes check byte consistency, not arbitrary producer honesty.

P1 产品证据必须保留各自source commit、tested tree、原读取时间及混合身份声明；本次导入不是新挂载或编译签名。
P2 已注册项目必须真实SDK Init并以项目权限打开原生Session，调用方不导出catalog/cursor；SDK读回恰一条Commit且base匹配fork。
P3 原独立History必须逐字节验证300023字节非零binary与head/root，重挂载仍保留原测试断言层级而不伪造独立清单。
P4 命令两路输出必须各2097183字节精确且原退出码9保留，九项原执行用例通过；命令退出不得隐式Commit。
P5 根进程退出后后代仍持文件必须使正常unmount为Busy且I/O可用；新的明确终止请求须收到原native和parent正常退出回执。
P6 注册启动八个坏输入必须各保留exit1，无false RootServed或unmount；缺Branch与protected main保留已初始化work。
P7 产品局部消费叶不得升级为SDK Sandbox或完整host隔离资格；旧Workspace和Git失败事实不由本叶覆盖。
P8 新快照必须包含全部145份指定原件，保原字节与来源；逐项raw audit与父级历史事实重算是使用派生表的必要配套。
