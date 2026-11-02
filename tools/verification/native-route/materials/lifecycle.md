# Retained readonly mapping and reopen observations

> Status: Retained evidence criteria; not a product contract or fresh runtime qualification.

Author findings are self-review, not independent arbitration. The existing historical leaves and source times remain unchanged. SQL facts require the paired raw-artifact audit; hashes establish byte consistency, not producer honesty. Missing evidence remains unqualified.

L1 映射生命周期导入必须保留实际source commit、tested tree、不同构建的binary身份与原运行时间；本次导入不是重新挂载或编译溯源签名。
L2 单文件ordinary read与view先Unmap后File关闭两臂必须真实Close归零并正常prepare、drain、detach及provider退出0。
L3 File先关闭后Unmap臂必须保留应用退出0但一个Cleanup未Close、正常stop作用前Busy的事实，不把控制器取消provider当正常卸载。
L4 owner的只读view仍存活时，Busy后新普通read与原view read必须仍可用，原token不得提前Close或被手工释放。
L5 owner自行Unmap并退出后须保留至少10000毫秒无Close观察；随后一次显式普通只读reopen的Cleanup后原token真实Close到达，只有独立新stop正常detach才能通过单文件协调观察。
L6 映射两项guard和协调client一项guard共三次必须作用前拒绝非法父上下文或mode，且均有原始退出码和错误原因。
L7 本叶必须明确仅保留单文件观察，general_close_qualified与产品资格为0；不将普通reopen外推为任意映射、改名解绑并发或内核全引用排空契约。
L8 生命周期快照必须同样包含全部37份指定材料，保留原始字节及SHA256，audit与父级历史事实一致，不以仅有派生成功字段替代原件。
