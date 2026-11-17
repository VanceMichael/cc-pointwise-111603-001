# 稿件采集台

Node.js 本地数据接入项目。在首批结构化导入之外，新增沿来源游标的持续稿件采集：同一 articleId 的标题与正文修订会形成可回看的版本链，专题读取方既看到当前有效稿件，也能回看此前已知版本与每次采集依据。来源服务和业务存储独立，采集状态全部落在本地文件。

## 运行

需要 Node.js 22，无第三方包、远程服务或账户凭据。`npm test` 运行全部单元与集成测试；`npm run demo` 启动临时来源，演示首批导入、持续采集、来源修订、专题视图与版本回看，结束时自动关闭监听并清理临时数据，通常两秒内完成。`npm run acceptance` 在临时目录中验证完整生命周期（跨页去重、重启回读、304、旧稿重放、中断续采、解析失败隔离与业务查询），完成后清理临时状态。演示数据不访问生产站点。

- `npm start -- ingest [文件]`：原有结构化导入，写入本地 `var/records.json`。
- `npm start -- query [来源]`：读取原有集合。
- `npm start -- collect <来源地址> [--state 文件]`：执行一轮持续采集，默认状态文件 `var/collection.json`。
- `npm start -- topics [section] [--state 文件]`：专题读取入口，返回当前有效稿件，可按 section 过滤。
- `npm start -- history <sourceId> [--state 文件]`：回看一条稿件的全部已知版本（新到旧）。
- `npm start -- failures [--state 文件]`：列出历次条目解析失败依据。
- `npm start` 或 `npm start -- --help` 查看全部命令。

## 组件和数据

`source/server.js` 读取场景文件并监听随机回环端口。`startSource()` 返回 url、publish(stage)、failNext(path,status) 和 close()；publish 切换可观察来源版本而不修改业务仓库，failNext 可返回 503 或使用 disconnect 断开连接。它记录请求路径并支持来源 ETag/304。场景见 `fixtures/source.json`（首批）与 `fixtures/collection.json`（opening/revised/lagging/broken 四个观察，覆盖相邻页重复、分页期间更新、旧稿重放与损坏条目）。

`src/source-client.js` 只接受同一回环来源，支持带 ETag 的条件请求，304 以 notModified 返回。`src/adapter.js` 的 `parsePage` 保留首批页面解析；`parseCollectionPage` 解析采集页并在条目级别隔离损坏稿件（页面结构损坏才抛错重试）。`src/revisions.js` 以标题加正文的内容指纹判断变化，按来源 revision/updatedAt 排序，输出 created/revised/unchanged/stale 身份决策，旧修订不能倒退当前稿。

`src/collector.js` 是持续采集引擎：沿 next 游标逐页读取，每成功处理一页就把文章版本、页面 ETag、下一游标和批次依据原子落盘；瞬时故障（5xx、断连、超时、页面 JSON 损坏）有界重试，重试不产生重复版本；304 时复用已缓存的下一游标。中断后检查点停在未完成的边界页，下一轮从该页重读，不会跳过边界修订；完整走完游标链后检查点回到入口，下一轮重新发现更新。

`src/collection-repository.js` 维护单文件采集状态：articles（每篇稿件的当前稿与版本链，版本带批次号与内容指纹）、checkpoint（逐页 ETag/下一游标与完成标记）、batches（每轮采集的页面级依据与身份决策计数）、failures（解析失败的条目、原因与原始片段）。`src/repository.js`、`src/service.js` 与 `src/records.js` 保持原有首批集合能力不变；`src/operations.js` 在原 `readOperations` 之外新增 `readTopic`、`readArticleHistory` 与 `readCollectionFailures`。来源协议见 [CONTRACT.md](CONTRACT.md)。

状态目录属于运行产物。新增采集状态与原 `var/records.json` 分开组织，原有 CLI 和集合查询能力保持不变。测试可直接使用随机端口来源，不需要等待真实时间或接入外网。
