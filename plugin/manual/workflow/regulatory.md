# 上交所公开监管接口与缓存回执（0.15）

不再等待浏览器执行动态监管页面。优先由已有随包Node工作进程做固定HTTPS GET（官方Referer、10秒超时、256KiB上限、不跟随重定向、不使用认证），只有普通传输异常才尝试宿主文本代发；两条路径均正常验证TLS。使用官网真实脚本调用的公开数据接口：`https://query.sse.com.cn/commonSoaQuery.do`，`sqlId=BS_KCB_GGLL_NEW`。仅支持上交所A股的监管措施（measures）与监管问询（inquiries）channel集合；不是全部监管动态、证监会/其他交易所全集或无风险证明。

## 读取与冻结

```js
stock_detail({mode:'live',view:'regulatory',symbol:'sh600900',regulatoryKind:'measures',from:'2026-08-08',to:'2026-11-06',cache:'prefer'})
```

日期是实际研究范围，不复制示例日期。from/to为YYYY-MM-DD，最多366日，to不晚于今天。每页5条，最多20页；校验公司、类别、日期、稳定总量、页数和重复ID。超预算/缺页保持complete:false，不能当完整。只使用固定官方GET与JSON/固定`?(...)`包装解析，不执行脚本、不接受任意URL或关闭TLS验证。

返回receipt包含scope、fetchedAt、expiresAt、complete/fresh/usable、总量、逐页URL/SHA、库内archivePath和searchScope。`offset/limit`分页读取已抓记录；`rawPage`按需读取一页原始响应（上限256KiB），给真实独立核验者复读。不要整批原始响应塞进Agent上下文。

取得完整且新鲜的回执后，保存到已采集原批次：相同参数增加runId和稳定requestKey。这会保存回执与首个查询响应指纹，并清空旧判断、改变contextToken。应先冻结必要监管/其他证据，再一次读完delegation清单重新派工。不得重采整个研究、复用旧token或旧worker冒充新分析。

## 缓存与失败

缓存仅由插件实际请求产生，不接受模型自编回执、外部路径或任意JSON导入。缓存按公司、类别、日期和分页规范隔离，模式前缀由Library层处理；simulation拒绝该真实入口，不读写live缓存。每次读取重新核对清单与原始响应的SHA、范围/分页/日期；一小时TTL，且截止日必须是今天才可用于当前取证。缓存命中不刷新fetchedAt。

`cache:'prefer'`优先完整新鲜缓存；`refresh`尝试官方接口，只有普通网络失败才回落同范围完整新鲜缓存；响应公司/格式/分页错误不会静默回落。`only`不联网，可只读旧缓存但fresh/usable=false，不允许旧缓存归档为当前有效范围。损坏缓存明确失败；没有缓存时明确REGULATORY_CACHE_MISS，不创建空名单。

宿主文本传输不返回最终URL时，回执注明该限制，sourceVerified/usable=false，只作待核验材料，不写可用缓存或归档到研究；不能据此通过风险门槛。显式报告重定向则拒绝该响应。

公开接口不可用时保留限制，继续其他可推进行业/取证；受影响候选保持证据不足，不等待浏览器或把根200/空壳HTML当名单。

## 与风险证据的边界

查询回执和记录目录均为metadata，不自动生成风险结论、publishedAt或复核票；零条只表示所列范围本次返回空，不表示公司没有风险。回执采集时间不冒称公告发布时间。实际风险事实仍需读其官方原文（接口可返回PDF/DOC等，必须使用能正确读取该格式的工具），并由两位实际独立核验者核对。

风险证据可在add_evidence.news中传regulatoryReceiptId，仅以search-scope-only关联本轮已保存的检索范围；这不表示正文是查询检出的某条监管事件。symbol与searchScope的from/to/查询源URL必须与原始归档一致且回执完整未过期，否则REGULATORY_SCOPE_MISMATCH。风险证据URL必须是独立抓取的官方原文，不能是query.sse接口列表。可另传regulatoryRecordId，严格绑定回执内具体docId与该原文URL；没有记录的空查询只能辅助说明检索范围，不会生成一条风险正文。绑定后风险证据还受一小时回执TTL限制。此链接不取代原有五类证据、真实双人正文核验、报价时效和正权重准入。

保持独立来源/日期/分页未覆盖的局限；不能把不确定项换名洗为supported，也不能仅凭空查询生成“无风险”结论。跨行业/个股分析、定稿、调度、微信仍由原流程实际执行并对账。

## 金融监管总局具体原文（0.18.8）

`stock_detail(view:'source')`允许固定官方主机`www.nfra.gov.cn`，其具体原文可作为risk类别来源。普通文章页可能只是前端模板；若使用官网前端实际声明的同源公开JSON正文路径，须保留文章页、公开脚本与具体正文的对应关系，实际读取正文和附件并核对主体、决定日期、发布日期、单位及适用范围。模板、索引、`docId`和抓取SHA本身不能当作已核验处罚事实。

这项来源支持不新增监管全量搜索、回执缓存或处罚主体自动绑定，也不扩大上交所measures/inquiries回执的范围。分支机构、总行与个人不得混同；来源快照、同指纹双人正文互核、检索范围、时效及未决分歧检查仍全部适用。访问拒绝或正文缺失须如实留缺项，不换主机或绕过认证。新支持只影响后续正式调用，不回写历史证据。
