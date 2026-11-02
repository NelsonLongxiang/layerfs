# Retained restricted Windows backend access

> Status: Retained evidence criteria; not a fresh execution, complete product qualification or signed release.

Author self-review is not independent arbitration. SQL facts require paired raw-artifact audit; snapshots preserve old leaves and original source/read times. Hashes check byte consistency, not arbitrary producer honesty.

R1 权限证据必须保留原source commit、tested tree、读取时间及原binary身份；没有签名构建溯源或新运行资格声明。
R2 原生观察必须实读restricted token、integrity4096及可用系统随机数，不以启动器自报替代实际token观察。
R3 四个真实Store、项目记录、Overlay和template文件必须同时拒绝READ与WRITE_DAC或WRITE_OWNER，各以Win32 error5保留。
R4 runtime、native parent及原launcher三个未降权父进程必须同时拒绝内存读取与原令牌复制。
R5 五种空白、Unicode、引号及尾反斜线argv必须原样交付，LayerFS环境不得自动泄露到目标命令。
R6 原target退出7、明确根取消退出1223及九个合法或坏lifecycle回执必须保原结果，文件系统正常终态仍独立确认。
R7 受限命令必须在真实WinFsp写入，显式Commit后由SDK读回及新挂载保持原断言；这些字段只表示原测试断言被审计。
R8 本叶必须保留145份原件与配套raw audit，SDK资格和完整host隔离为0，不外推网络、注册表、进程树、任意kernel或crash契约。
