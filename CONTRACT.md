# 来源与消费契约

## 来源

入口 `/feed?cursor=start`，JSON items 为本页项目，next 是后续相对路径或 null。`fixtures/source.json` 的 opening 与 updated 是两个可切换的来源观察，不代表业务库必须得出某个预设结论；可添加新的来源观察验证行为。

articleId 为来源内稳定身份；publishedAt 为首发时间，updatedAt 与 revision 为来源修订信息。next 是不透明游标，来源在更新时可能在相邻页重复出现稿件。正文与标题均参与内容变化判断；专题按 section 读取有效稿件，解析失败不表示来源撤稿。

## 业务消费

`readOperations(repository)` 当前返回 product 和 rows，每行带 sourceId/source/observedAt/attributes。现有 CLI 和结构化导入用于本地运维；新增采集结果也需要让业务读取入口看到一致状态，必要的解释信息可扩展返回。原始来源身份与 observedAt 不是通用的业务版本、完整性或成功证明。来源接口契约是兼容边界，采集、状态管理和新业务表达由实现决定。
