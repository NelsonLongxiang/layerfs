# 原生 Store 面的文件操作（2026-11-03）

> **Status:** Dated functional record. Test only; no production source changed.

能力矩阵把 Store 面（fs/branch/project/operator）列为「已服务」，但既有真实消费者主要覆盖 `read`/`write`/`branch.list_commits`。本轮补一组文件操作：[native_store_ops_real.mjs](../../../../api/runtime/test/verify/native_store_ops_real.mjs)。

通过原生 Windows Store 依次执行并断言：

- `fs.mkdir('/docs')`、`fs.write('/docs/a.txt')`、`fs.cp` 到 `/docs/b.txt`、`fs.mv` 到 `/docs/c.txt`；
- `fs.list('/docs')` 恰好 `a.txt` 与 `c.txt`；
- `fs.glob('**/*.txt')` 命中 `/docs/a.txt`、`/docs/c.txt` 与 `/seed.txt`（glob 返回的是路径字符串）；
- `fs.grep('alpha')` 命中 `/docs/a.txt`；
- `fs.stat('/docs/c.txt')` 返回 `type: 'file'`、`size: 6`（`kind` 是信封字段，不是文件类型）；
- `fs.read` 读回 `alpha\n`；
- `fs.rm` 删文件后只剩 `a.txt`，`fs.rm` 删目录后根目录只剩 `seed.txt`。

[结果](../../../../tmp/native-store-ops-20261103/actual-third/result.json) 读取 2026-11-03T03:51:51.256Z，[命令](../../../../tmp/native-store-ops-20261103/actual-third-command.json)。

三次消费者错误保留 FAIL：`glob` 的 items 是路径字符串（不是对象）、`grep` 的条目形状与预期不同、`stat.type` 才是文件类型；产品行为本身每次都正确。

## 限制

只覆盖 Store 面；Workspace 内的同一批操作走 target，不在本记录范围。生产 LOC 不变。

first parent ec9a709e3bacc9a9cf708f151128f6a1090a0d14；本记录只增文档/测试。
