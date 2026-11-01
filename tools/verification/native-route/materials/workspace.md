# Native Workspace readiness

> Status: Research readiness checks; not an implemented capability or Store release gate.

此叶判断拟实现的原生Workspace是否就绪，不改变当前Unsupported契约。与Store叶分开，未具备时如实FAIL；不得将本叶未通过归因Store实现失败。

W1 ProjFS libraryPresent、driverPresent、libraryLoaded 均为1，预检status为api-load-candidate且退出码为0。
W2 原生Workspace活目录普通进程读写删改证明必须具有PASS回执，不得用SDK文件操作替代。
W3 原生Workspace捕获写回单个Commit并重开核对证明必须具有PASS回执，不得用re-Init或fs.apply伪装。
W4 保持可写句柄或映射跨capture和stop的生命周期证明必须具有PASS回执；未实现或未验证必须保持非PASS。
