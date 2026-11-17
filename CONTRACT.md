# 来源与消费契约

## 来源

入口 `/feed?cursor=start`，JSON items 为本页项目，next 是后续相对路径或 null。`fixtures/source.json` 的 opening 与 updated 是两个可切换的来源观察，不代表业务库必须得出某个预设结论；可添加新的来源观察验证行为。

articleId 为来源内稳定身份；publishedAt 为首发时间，updatedAt 与 revision 为来源修订信息。next 是不透明游标，来源在更新时可能在相邻页重复出现稿件。正文与标题均参与内容变化判断；专题按 section 读取有效稿件，解析失败不表示来源撤稿。

## 业务消费

`readOperations(repository)` 当前返回 product 和 rows，每行带 sourceId/source/observedAt/attributes。现有 CLI 和结构化导入用于本地运维；新增采集结果也需要让业务读取入口看到一致状态，必要的解释信息可扩展返回。原始来源身份与 observedAt 不是通用的业务版本、完整性或成功证明。来源接口契约是兼容边界，采集、状态管理和新业务表达由实现决定。

## 持续采集语义

采集沿 next 游标逐页进行，相邻页重复出现的同一 articleId 不得产生新版本。标题与正文共同参与内容变化判断；内容指纹相同即为 unchanged，来源 revision 与 updatedAt 只用于排序，旧修订（stale）不能倒退当前有效稿，重试与 304 缓存命中也不得制造新版本。

每成功处理一页即提交检查点（页面 ETag、下一游标、文章版本与批次依据）。采集在某页失败时检查点停在该页，恢复后从边界页重读，分页期间来源在该页上的修订不得被跳过；完整走完整条游标链后下一轮从入口重新发现更新。条件请求得到 304 时复用已缓存的下一游标。

单条稿件解析失败按条目隔离：同页其它稿件照常生效，失败条目不删除也不替换该 articleId 的上一份有效稿，失败原因与原始片段写入 failures 供核对；只有页面结构损坏才整页重试。

业务读取通过 `readTopic` 看到当前有效稿件（可按 section 过滤），通过 `readArticleHistory` 回看某条稿件此前已知的全部版本，每个版本带采集批次号与内容指纹作为修订依据。
