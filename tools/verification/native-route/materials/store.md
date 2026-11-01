# Windows-native Store verification update

> Status: Current verification material; Store scope only, not Workspace qualification.

历史：保留 spec_9a8d135fb270 / mat_06efbfd8641e（2026-10-25 四进程并发场景）。本材料扩展当前路线与回执真实性，不覆写旧spec/报告，不把其旧构造器当作当前API。

S1 Windows runtime 必须有且仅有十个指定用例的 PASS 回执：surface、projects、state、events、leftovers、sandboxes、volumes、transport-order、init、docker-default；每条退出码为0且FAIL计数为0。
S2 Windows home-mode 必须明确报告 SKIP 而非 PASS；该项 POSIX 权限断言须在 Linux home-mode 回执中 PASS。
S3 真实 Windows native SDK 回执必须为7 PASS、0 FAIL、1 host-face SKIP；不把未执行的宿主检查计作通过。
S4 route-native-report 必须同时通过全跳过不报ALL PASS和允许main写入必判FAIL两个反例回归。
S5 Linux home-mode、init、docker-default 三个对照用例必须各自 PASS 且退出码为0。
S6 采集前后 source commit、source tree、addon SHA256 必须一致且非空，跟踪文件差异均为空；原生addon哈希只标识被测二进制，不证明它从该提交重建。
S7 ProjFS 预检必须留下缺组件或API加载候选的原始回执和正确退出码，且liveMountVerified为false；该项不证明活挂载。
S8 宿主UI、原生Workspace、Durable 三个未执行范围须逐项记录 NOT_RUN，不得计入 Store PASS。
S9 必须保留17条执行命令回执，每条带非空命令、起止时间、source commit、source tree、addon SHA256和原始JSON SHA256；状态未知或无原始回执不得以口头结论补齐。
