# 多行业子代理分工（0.16）

当前引擎实际派工，每行业一个只读任务，默认最多3并行、其余排队；无能力明确降级。collect/保存/配仓/计划/调度/IM始终由主代理独占。子代理只读公开证据并返回建议，不直接写插件。

## 长批次增量协议2（显式启用）

完成collect_batch、必要原文与两位独立互核后，主代理调用 `refresh_context({mode,runId,requestKey,incremental:true})`。首次冻结刚取到的行业行情为analysisSectors/analysisAsOf，保留原K线及其真实日期，不声称实时。旧协议判断仅存历史，旧token不能换新token贴回。未启用时继续使用原协议1。

- `get_research(view:delegation)` 分页先读全待分析清单；每个assignment有自己的contextToken。按readRequest逐行业读全部股票页和本行业news页。默认30、最大100；以nextOffset结束，不拿第一页当完整行业。
- 任务只含本行业冻结行情、股票日K、行业/公司资料、原文及有效状态；宏观资讯由主代理最终统一复核，不能从别的行业借newsIds。
- 主代理实际spawn每行业只读子代理，保留真实workerId。回收一个就可串行record_judgment，携带该行业expectedContextToken及实际workerId，不用等496个行业全部返回。同行业证据/资料/原文变化或有效状态到期使相关行业needs_reanalysis；同一股票或原文涉及多个行业则都失效。未变化行业保留，兄弟结果不会互相失效。
- 补证后读取新的delegation，仅对变化行业真实重派/重新分析，不能仅替换token或伪造workerId。正文/监管范围续期仍按同指纹、实际检索和双审要求处理，不修改旧证据时间。
- 没有足够依据的行业返回assessment:insufficient、group:null、明确reason/missingReasons、newsIds可空、stockValues:[]，readCoverage须给真实stocksRead/totalStocks和limitations。必须读完实际可访问股票页，说明目录总数与可读数差异；不能将缺证默认写成不推荐。

classified返回四组之一，股票仍按一档/二档/三档。无充分价值依据的股票保持未分档，不用技术分数代替价值。股票分档及正仓位须包含最近完整交易日日K（上午允许上一交易日完整K）。候选K过旧时，用stock_detail(view:refresh_analysis,runId,symbol,requestKey)正式刷新该候选及其所有行业归属，再对关联行业真实重派；不重采全目录、不篡改旧K日期。主代理验证run/sector/token/actual worker和引文归属，记录成功请求键，实际任务ID不等于插件独立身份认证。

## 定稿前最新动态复核

冻结分析只在同一中国自然日内可用。跨日不能用rebaseAnalysis给旧数据续期；同日实质变化可用refresh_context(rebaseSectorIds:[实际变化行业ID])只更新对应行业快照，随后用新token真实重派。需全量重新冻结时才用rebaseAnalysis:true。首次启用保留原分析来源日，不能借迁移跨日续期。

所有行业已有当前分组或证据不足终态后，主代理再次refresh_context，更新最新行业行情与宏观但保留冻结行业分析。不要再传rebaseAnalysis。按 `get_research(view:revalidation)` 逐页读完最新行业行情、冻结快照和当前结论，另读最新资讯页；识别实质变化并重派相关行业。最终配仓不使用冻结价格，仍逐股取最新报价、检查正权重五类正文互核及监管范围有效性。

finalize_research新增必需的协议2字段：

```json
{"contextReview":{"expectedContextToken":"revalidation当前全局token","reviewedSectorIds":["实际读完并复核的完整唯一行业集合"],"reason":"最新行情/宏观对冻结行业判断与最终配置的影响、是否重审及局限","newsIds":["最近一次refresh_context取得且仍有效的资讯ID"]}}
```

全局token包括最新市场输入、行业当前结果及有效状态。刷新、补证、过期或判断更新后旧最终复核失效，必须实际复核后取得新token。保留最新上下文2小时、监管回执1小时及五类证据原时限，不扩大TTL。正仓位必须来自有效已分组行业且通过原风险/报价/五证门禁；不足行业单列，不是第五组，也不构成候选。流程完成不代表所有股票都已分档。

现金等待可作为合法建议，不能为了出计划凑分组、三档或正仓位。定稿后仅主代理核对原生调度、认领报告动作、调用绑定微信并保存真实messageId。历史失败报告不重放、真实账户不下单、simulation不写live。

---

## 原协议1兼容说明

# 多行业子代理分工（0.12）

插件提供只读任务输入和过期结果检查；实际派工由当前Cindy Agent的子代理工具完成，不由插件后台偷偷启动模型。至少两个待分析行业时优先并行，默认最多3个子代理，按当前引擎可用槽位缩减，其余排队。单行业通常由主代理直接分析；不可用时说明已降级串行，不伪造子代理或提速数字。

## 先固定输入，再分工

1. 主代理串行完成begin_research/collect_batch和refresh_context。collect_batch共用行业与股票游标，不能由多个子代理同时推进。
2. 按workflow的0.3完成候选资料包、来源原文、证据和独立互核。两位真实核验者可以并行阅读原文；add_evidence/reviews仍由主代理统一写入。行业分析分工不能替代五类原文互核。
3. `get_research({mode,runId,view:'delegation'})`分页返回共同contextToken、未分析行业assignments、totalAssignments/nextOffset和推荐并行数；主代理须先读取全部派工页，之后再提交，避免pending清单变短时沿旧offset漏行业。每个行业用readRequest读取其任务输入；默认每页30只股票（limit最多100），按nextOffset读完，不能只看第一页宣称覆盖整个行业。
4. 主代理实际调用当前可用的子代理工具（如当前引擎的spawn_agent），每行业一个任务。传入mode、namespace、runId、sectorId、contextToken、分页输入和真实任务边界，保留返回的实际任务标识。可传已冻结的JSON或让子代理只读get_research；不发整份账户凭证或不相关个人资料，不更换账号/供应商或恢复停用路由。

子代理只能分析分配行业、只读必要公开原文、返回结论和证据候选。禁止调用configure、begin/collect/refresh/add_evidence/record/finalize、plan_control写操作、claim/receipt、scheduler或IM；也不能把建议当成交。资料不足要说明覆盖和未分档原因，不凑三档、不建议保证盈利。

## 结果与主代理汇总

子代理返回以下字段（具体值取本任务输入，不照抄占位符）：

```json
{"protocolVersion":1,"runId":"本轮ID","sectorId":"本行业ID","contextToken":"输入的64位指纹","workerId":"实际子代理任务ID","industry":{"id":"本行业ID","group":"主投行业/二级投资行业/三级投资行业/不推荐行业之一","reason":"依据、时点与局限","newsIds":["本轮有效资讯ID"]},"stockValues":[{"symbol":"本行业已采集股票","tier":"一档/二档/三档之一","reason":"依据与缺项","newsIds":["本轮资讯ID"]}],"evidenceCandidates":[],"warnings":[]}
```

主代理核对实际workerId、runId、sectorId、contextToken及资讯/股票归属。待补原文只作为evidenceCandidates返回；若主代理添加新证据/复核或刷新上下文，旧判断会清空，所有旧任务结果作废，重新生成任务和分析。不同代理有分歧保留，不换名字凑通过。

所有行业结果收齐后，主代理按行业串行调用：

```js
record_judgment({mode,requestKey,runId,expectedContextToken:result.contextToken,workerId:actualTaskId,industry:result.industry,stockValues:result.stockValues})
```

expectedContextToken不包含已保存判断和账户全局revision，因此兄弟行业依次提交不会互相失效；它包含本轮配置快照、行业目录、股票/指标/报价、资讯、资料包、来源指纹及刷新代次。任何输入变化会返回STALE_CONTEXT且不保存旧结论；子代理结果缺token返回CONTEXT_TOKEN_REQUIRED。稳定请求键建议用runId+sectorId+contextToken摘要；同次重试参数不变。指纹检测输入变化，不认证代理身份，实际任务回执由主代理核对。

最终的跨行业去重、总仓位/单股/行业风险、正权重证据校验及finalize_research由主代理完成。调度、消息认领与发送也只由主代理处理。行业并行只加速独立分析，不扩大授权、不自动交易，不跳过失败和缺项。现有单行业/旧调用兼容；新并行流程始终携带token和真实workerId，归档行业保留analysis来源。
