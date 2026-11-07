# LayerFS 1.2.0 Windows 原生发布验收规范

S1 发布版本号为 1.2.0，Cargo 工作区与四个 api 包的 version 字段一致。
S2 发布包含五个产物：三个可执行文件、Node 绑定与插件 bundle。
S3 五个产物的 sha256 均出现在产物清单文档 ARTIFACTS.md 中。
S4 发布门在本机执行并记录 693 个通过、0 个失败。
S5 发布 tag v1.2.0 指向发布分支的当前提交。
S6 边界记录声明六项限制，且 agent 路径标记为已验证（CLI 路径）。
