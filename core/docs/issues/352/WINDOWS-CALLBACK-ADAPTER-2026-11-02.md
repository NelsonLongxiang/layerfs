# Windows产品回调适配与provider保管（2026-11-02）

> **Status:** Dated implementation checkpoint; not release evidence or a released product contract.
> 最终Git运行2026-11-02T05:51:15.179Z–05:51:19.253Z，原始回执对账05:54:25.487Z（UTC；Asia/Shanghai同日13:51、13:54）。不是性能测量。

## 已实现与实际消费者

产品Fuse现在提供[WorkspacePort](../../../../engine/crates/layerfs-fuse/src/windows/workspace_port.hpp)、[WorkspaceCallbacks](../../../../engine/crates/layerfs-fuse/src/windows/callbacks.hpp)和[具体回调](../../../../engine/crates/layerfs-fuse/src/windows/callbacks.cpp)，覆盖打开/创建、读取/窗口写入、resize、Windows属性、rename/delete检查、Cleanup/Close及分页目录枚举。[元数据与安全适配](../../../../engine/crates/layerfs-fuse/src/windows/metadata.cpp)复用既有portable identity/mode/time/flags，生成当前进程owner安全描述符。[诊断host](../../../../tools/winfsp-probe.cpp)删除原回调实现，实际链接产品translation units；只保留诊断控制、观察计数与日志。

每个adapter复制不可变ABI端口、持有独立callback state及安全描述符；provider共享owner覆盖函数地址和其backing。mount把该context保存在可保留的heap State，并在启动前设置为WinFsp UserContext。目录打包也经同一个mount State访问WinFsp helper，不用全局mount对象。host独立增加provider DLL引用，再主动释放自己的adapter facade和provider引用：此后I/O仍须正常，直到native drain、detach、逻辑Overlay Close及显式library release后weak refs才过期。部分attach失败或owner被放弃时保留原context/provider，不卸载仍可能被回调使用的代码。

不可返回错误的Cleanup/Close保留第一个失败状态；已知普通拒绝直接返回，语义及原始失败custody仍由现有Workspace provider拥有。回调检查读取结果长度、目录名称长度与offset加法，避免在坏provider回答上继续复制或加法溢出。无新encoder、SQL、worker、依赖或Rust unsafe例外。optional同步noexcept observer只报告实际回调事件，不能选择算法或重放请求。

[架构说明](../../architecture/76-native-mount-session.md#per-mount-windows-callback-adapter-2026-11-02)、[消费端说明](../../../../tools/projfs-probe/README.md#product-winfsp-callbacks-and-provider-custody)。volume值由调用方提供；诊断仍用合成1GiB，不宣称真实容量。Readonly及H/S/A、属性/时间限制、allocation拒绝与原元数据策略保持，不构成完整ACL、symlink/hardlink、任意Win32名称或mapping资格。

## 验证结果

| 范围 | 结果 |
| --- | --- |
| 外部C++直接测试 | 6 PASS：identity/size/flags/FILETIME转换、目录readonly/时间边界、极端时间不回绕、独立callback table/context、缺port/provider/非法volume拒绝、真实partial DLL acquisition后的provider保活 |
| 原生读写 | 嵌套目录、读写/rename/rmdir、两Commit、同Store新挂载通过 |
| 缓存观察 | 8阶段通过；保留应用可见/已发布及committed gap，并观察Cleanup后1次延迟constrained write；不是任意mapping同步保证 |
| 最终Git | 19条Git命令加1 setup全exit0；17文件before/after相等；两挂载正常Close |
| 最终双绑定与关闭 | 同Store同时挂载隔离、合并历史/新挂载读回及普通Busy可逆关闭通过 |
| 静态/编译 | MSVC14.40.33807 C++17 /W4 /WX、SDK10.0.22621.0及clang-format通过；976文件扫描、37守卫与23计数器测试通过 |

[直接测试源码](../../../../engine/crates/layerfs-fuse/tests/windows_callbacks.cpp)使用公开adapter和真实provider DLL，不包含产品私有实现、test hook或mock filesystem。失败保活测试故意用真实kernel32 DLL触发缺WinFsp导出，mount保留context/provider；不生成挂载。成功活测则丢弃facade后继续真正I/O，关闭后验证weak refs过期。[6项直接测试及native回执](../../../../tmp/native-callbacks-20261102/lifetime-and-native-first.json)、[缓存原件](../../../../tmp/native-callbacks-20261102/cache-first/result.json)、[缓存分析](../../../../tmp/native-callbacks-20261102/cache-first/observations.json)、[最终Git](../../../../tmp/native-callbacks-20261102/git-final/result.json)、[before](../../../../tmp/native-callbacks-20261102/git-final/before.json)/[after](../../../../tmp/native-callbacks-20261102/git-final/after.json)、[双绑定](../../../../tmp/native-callbacks-20261102/binding-final/result.json)、[关闭](../../../../tmp/native-callbacks-20261102/close-final/result.json)。

逐条核对provider固定顺序：context pinned（facade/provider caller引用已释放）→根已服务→准入停止→native dispatcher stop/drain→detach→产品请求drain→Overlay Close→context/provider释放→owner Closed。最终Git接收/完成9625/9625及4480/4480，Cleanup/Close1644/1644及747/747；双绑定37/37、52/52、27/27，普通close181/181，全部active=0/retained=0且exit0。[汇总](../../../../tmp/native-callbacks-20261102/summary.json)、[对账程序](../../../../tmp/native-callbacks-20261102/reconcile.mjs)、[对账回执](../../../../tmp/native-callbacks-20261102/summary-audit.json)。不是完整OS callback/section清单。

首次构建因Windows头文件的interface宏与方法名冲突而失败：[原始失败](../../../../tmp/native-callbacks-20261102/build-first.json)；改名table，不修改第三方头或宏。[修复后构建](../../../../tmp/native-callbacks-20261102/build-corrected.json)、[保活测试构建](../../../../tmp/native-callbacks-20261102/build-lifetime.json)、[最终封版构建](../../../../tmp/native-callbacks-20261102/build-sealed.json)、[守卫回执](../../../../tmp/native-callbacks-20261102/guard-final.json)。最终构建记录全部7个native输入的hash，已与当前字节逐一对账。

直接测试/native/cache使用host-lifetime原binary，最终Git/binding/close使用host-sealed；两份构建的product/host源码hash相同，PE binary hash不同，原件各保留而不改写身份。测试显式≤120秒，先编译后运行；没有后台测试或重复失败请求。Rust provider源码、manifest/lock与父版本不变，沿用先前合格binary；本轮Rust tests/Clippy NOT_RUN，不把C++编译伪装成Cargo覆盖。

## 源码身份与计数

父提交15366b3dc549905b0ada7377db44d91f06dcc3aa；封版受测tree4a9dc7e411fcf889d812c0cd511cd1b9ea487b85，Fuse subtree1b87103429859a7d3701ea29d23e8f235787ef6c，host blobdaae70be99c01507a738713940925fd3307a0df4。后续仅加入本报告。最终host SHA256 b0eb967cb3597004e83824ba385af8e8fe4829da23ab2ddce5916d3638885455；沿用WinFsp94323b3de265c66a9b5428ee054313b9b14f179571201dfbaf5e7f15ba4918e3、Rust bridge746c207f88b48d834ab71418391412981692b3fe6b98405b212dd07c156c5b4f、client648833d19e2074d12f40d6c771590ff10bfb725ddfa25dc28953c6aace86be83。Hash表示字节身份，不是签名编译证明。

Production LOC: **105336 -> 105907 (delta +571)**；Core38454不变，Engine64122→64693（Fuse4820→5391），API2760不变。相同[production_loc.py](../../../../tools/production_loc.py)对exact parent与final-tested git archive计数：[before](../../../../tmp/native-callbacks-20261102/loc-parent.json)/[after](../../../../tmp/native-callbacks-20261102/loc-staged.json)。新增port/callback headers与源码完整计入，tools/tests/docs排除；这是诊断实现升格到产品scope及必要context保管，不是算法压缩或生产代码移出计数。原host重复callback实现已删除，没有删除测试。reference absent (retired R9c; last counted65,417 at tree498dd1917812)。

## 在途与不确定

任务3b7a154bc4保持doing。产品原生mount owner、callback table/metadata/security/Workspace ABI consumer已经实际运行；Rust Session/FFI与控制进程仍是诊断，Cargo/API不自动编译/启动该native host。独立adapter context不等于同一进程内多个Rust Session：本轮双绑定是多个真实provider进程。产品注册、鉴权/IPC及SDK Workspace/Sandbox/Exec入口仍未接通，Unsupported不删。

下一段应建立正常可构建产品native host/服务入口，按现有StoreService/Workspace保管Session和控制，不把tools源码include进产品，也不再只搬迁薄wrapper。保留库生命周期、实际Ready与终止回执。任意kernel引用、可写mapping同步、成功解绑映射、广义并发/crash及其它provider/SDDL失败注入仍未全面验证。noexcept observer须由host或同样保活的代码提供，observer failure不另造恢复路径。全部Store显式Disposable/WAL/OFF，无driver/系统配置、DSH或第三方源码改动。本轮无新增品味判断点。
