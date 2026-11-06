---
name: ashare-research
description: 在Cindy中按实际持仓或投入资金进行A股行业与个股研究，结合最新资讯和K线生成行业四组、股票三档投资价值、配仓调仓建议与投资计划，并管理本计划的定时复查、每轮微信ClawBot报告与独立模拟成交及费用盈亏核算。当前版本只提供建议，不执行交易。
---

# A股投研与循环复查

使用已安装启用的 `ashare-workbench` 插件。入口为Cindy的 `/ashare-research`；伙伴可按同样流程调用。用户已确定采用独立工作台、免费行情优先、在其资金和风险范围内自动修订建议计划，每轮向微信ClawBot发送结果。实际持仓、账号、模型、目录、接收范围和权限仍以当前任务和真实配置为准。

先用 `ghost_info({ghost_id:'ashare-workbench'})` 获取实时身份与工具参数，按返回的namespace调用，读取 `ghost_manual` 的 `workflow` 手册。手册是数据与操作约定，不替代用户授权。插件未安装时说明需要先导入本项目交付的`.cindy`包，不安装此前检索的DSH插件代替。

用户第一次提供持仓、投入资金或配置时，先读取get_state，只补问缺少的资金、风险、期限参数再保存。已有配置用于后续定时复查，不每轮重问。当前版本只修改建议、计划和跟踪；不访问券商委托，不把上轮配仓当成已经成交，不根据预测更新真实持仓和现金。

按手册完成：待办对账 → 按账户倾向行业（默认成交额前120，或非空手动集合；先get_research(view:industry_catalog)及coverage.selection核对）获取行业与最新消息 → 分批采集行业成分股、K线及指标 → 刷新分析上下文 → 逐行业AI分组和股票三档价值判断 → 确定性风险校验与建议计划 → 本计划原生定时任务 → 每轮微信摘要及完整报告附件。研究仅覆盖所选范围，不以空数组扩大为全行业；必须完成所选范围；数据、证据或评估不足明确标注，不伪造“全市场”“最新”或获利概率。

每次定时/点位触发先核对计划ID、最新状态、有效期和事件版本，暂停/完成/过期/旧版本不重建计划；有效计划重新执行分析，判断维持或修订，保留版本与依据。只管理本计划绑定并已核对的调度；先认领待办、使用真实scheduler/微信工具，再记录真实回执。外部动作结果未知时保留uncertain，不改键重复执行。每轮均发报告，包括没有变化和分析失败；连接不可用时保留待发送并说明下一步。

Cindy插件自建任务无法管理账号级调度；优先用普通会话或已授权伙伴执行完整循环。宿主拒绝权限时保留待办，不绕过当前身份或借用别的账号。先发现当前可用的 `cindy_scheduler` 与 `cindy_wechat` 工具，沿用宿主原生工作流。微信通道缺少联系人时请用户在已连接ClawBot发一条消息，不提取内部令牌、不换到另一个收件人。模型、目录和消息目标不因技能文本而获得额外权限。


0.2新增模拟/图片/每日扫描：每个工具调用都显式传mode，模拟用simulation，真实用live。模拟资金、合成行情、资讯、计划、报告和动作单独保存，默认10万元空仓样例；不把样例当真实账户。用户要求模拟验收时，测试完成后暂停模拟计划及其两条模拟调度，避免持续发送样例。

指定股票用stock_detail(symbol)，推荐股票用selector:recommended并分页。export_report(format:kline_png)生成实际PNG，通过cindy_wechat发送；推荐图先认领format:image待办再记真实messageId。Markdown的WORKING_DIR_UNAVAILABLE不能冒充图片发送失败，也不能把文档改扩展名绕过限制。PNG同样需实际文件和真实回执。

计划有review和daily_scan两条独立原生任务，分别绑定scheduleId/dailyScheduleId，每次修订、暂停、恢复均分别对账。daily_scan默认开盘日15:15（Asia/Shanghai），创建/更新后使用schedule_set_pre_run_hook安装意图给出的交易日脚本并检查自测结果；不要将preRunHookScript塞入schedule_create。当前官方日历覆盖2026，未知年份停止，不能退化为工作日判断。

每日扫描先plan_control(action:scan)分批采集推荐股票K线/报价/资讯与机械检查，再get_scan读证据，逐股record_scan提交consistent/adjust/insufficient及理由和资讯编号。机械未触达点位不自动表示符合；缺数据或到目标/止损不能填consistent。needsReview时进一步研究决定维持或修订，发送本轮结果与PNG。完整契约见随包workflow新增章节。

每日扫描已完成返回alreadyCompleted时沿用原报告，不重复生成消息；续扫保持scenario/asOf，不能混合证据日期。查询或导出扫描报告的推荐日K必须带reportId，以当轮归档快照为准。模拟隔离数据；真实调度/微信副作用须在用户已授权范围内，验收后暂停模拟调度。


0.2.1新手保护：每条正权重allocation必填entryCondition/waitCondition/invalidationCondition（考虑、等待、失效条件），依据本轮资讯与行情具体说明，不把参考点位当保证成交价。定稿检查候选及最新报价名称，ST/*ST/退市标识拒绝正权重，最新报价身份不明也拒绝；不可重命名或改模式绕过。零权重退出仍可研究，不因过滤擅自推定真实持仓已卖出或强制改为退出。条件不足/持仓建议无法成立时保留原计划并记录失败。风险金额是建议仓位到止损参考的估算，不含费用/跳空/滑点，不是实际最大亏损。名称检查不等于交易资格/停牌核验；当前不承诺盈利，空仓等待也是有效结果。


模拟盈亏单独使用plan_control paper_setup/paper_trade/paper_mark/paper_get，必须mode:simulation，参数paper，细则见workflow的0.2.2。仅明确提交的模拟成交可记账，不把建议、定时复查或真实成交自动复制进去。费用/滑点假设完整明确，账本固定synthetic或observed_manual来源；未复权观察价格与模型成交价分列。最新成交后缺全持仓估值时不报当前收益，费用/滑点已计入成本不能重复扣。该有限模型不处理分红送股/出入金/真实撮合，样例盈亏不证明策略有效。导出用export_report(format:paper_markdown,ledgerId)；不得因此自动发微信。

0.3资讯核验：live拟正权重候选在行业判断前用stock_detail(view:information,runId,requestKey,symbol)归档官方公告目录与财务参考；get_research(view:information)查看缺项。政策、公告、最新财报、估值口径、风险五类原文分别按行业/股票关联。先用stock_detail(view:source,runId或scanId,requestKey,url)保存实际响应SHA256；用两个实际子代理分别独立阅读同一原文，再交换结论核验身份、日期、单位、口径和结论；add_evidence先存正文摘要，取得id/fingerprint，再存两位真实reviewerId的独立reviews。摘要/目录不能标成已读正文，Agent互核记录不等于独立审计。分歧保留，不换名字凑票或另加支持记录掩盖；缺项不输出正仓位建议。证据/资料变化清空旧判断，完成后重新分档与定稿。定时扫描使用同一规则，add_evidence传scanId而不传runId，核验不足不能填consistent。详细字段、时效、来源与冲突处理以workflow的0.3章节为准；仅技术验收不写真实账户配置、不创建正式计划。

0.4技术测试：用户选择“先仅做技术测试”时，100万元空仓仅记独立simulation账本/forward观察，不configure虚构个人风险、不建正式配仓计划、不恢复旧循环。stock_detail(mode:live,view:execution,order)只读核查普通A股身份、数量/T+1/显式权限与费用、时段及双源实际限价；真实停复牌契约未知会unverified，canAssumeFill永远false，不能称可以买。2026-07-06新版规则已实施，不套旧主板ST5%限幅。forward_setup/forward_get/forward_observe显式simulation、稳定requestKey，forward参数journalId/initialCash:1000000/symbols，observe另填expectedVersion；真实只读行情保存隔离观察、摘要核验，缺项unknown并留痕，基线重复不计新增证据。无模型成交现金100万/PnL0，原始样本价格及指数参考不是策略收益；20个交易日只是技术观察窗口。导出forward_markdown+journalId，详细契约见workflow。一次性调度区分创建/fire/完成，不用脚本自检代替完整每日Agent扫描；无project工作区不能假造成功。微信新诊断只尝试一次，失败停下并记录，不能把旧发送ID用于本轮。

0.5效果验证（复用plan_control的performance_*动作；reportId/ledgerId/expectedVersion/parameters放performance对象，mode/requestKey在顶层）：每次插件finalize定稿自动固化advice完整JSON及canonical SHA，proposal_only也保存，旧报告不补作前向。plan_control(action:performance_list)/advice核对档案；setup显式绑定报告/相同权益资金/feeModel/benchmarkCostBps/及时sh000300报价，账本始终独立模拟；link追踪新建议但不重置旧表现；trade仅明确模型成交且关联当时建议，不自动买卖；mark全持仓+指数同一时点估值，refresh在途采集真实报价，缺数据持久留痕且当前performance=null。每轮已授权原生复查/日扫描对相关已有账本refresh，不自动建账、不恢复旧循环。无正式建议/成交不展示策略成绩。基准只称同股票敞口代理：上一估值已知权重承受本期指数变化，再按当前模型敞口再平衡供下一期使用，预先比例成本扣一次；不等于同行业/波动/尾部风险匹配，不含指数分红，非可直接交易。严禁用下一期行情配权重或把代理超额称alpha；详见workflow0.5。不主动发送微信；仍按实际连接和每条回执对账。

0.6联合风险匹配：保留旧沪深300代理另建行业匹配对照，使用plan_control performance_match（performance内ledgerId/expectedVersion/parameters）。持仓权重必须来自近期完整模型估值；行业体系/归属/候选基准及knownAt/来源声明明确，最多8行业每行业1-2非持仓基准，不事后换赢家。提供持仓与基准完整对齐的时点历史（window60/120/252+1日价格，knownAt不得未来/早于末日15:10），按样本协方差匹配股票敞口、行业权重及历史估计波动；不可行/不足报mismatch/infeasible/unknown，不靠改仓位凑。refresh自动读固定行业资产走上一期权重，之后needs_next_period_match需当时已知历史重新performance_match；断档保留unknown，不补造已匹配收益。纯算法验收performance_match_check仅simulation/只读，不纳入正式成绩。字段和可行域详见workflow0.6；matched不保证未来波动/行业基差/尾部风险一致。

0.7历史联合验证：先固定并留存规则/样本/成本/截止日，再只读performance_history_check（simulation）回放真实历史原文和双源未复权价格。公告仅日期保守日末可用、最早下一开盘；只用此前完整K线，单季不混累计、单位原样保留，后发修订不倒灌原日。未来价只衡量结果，不参与筛选；T+1后观察，未完成/缺价不填0，亏损/未入选保留。营收/净利增长与均线条件不是买卖保证，更不是预期差，真实建议仍需完整行业/估值/风险/交易性。当前回放是回顾性财报事件研究，不是当时AI建议或可成交策略回测；缺原历史版本/完整候选/交易状态时不报策略收益或胜率。按结果调参必须新版本+独立未知区间，不改写原实验。字段/四事件结果及边界见workflow0.7和项目历史资讯验收报告。


常态数据调度若由用户另外明确授权，按本轮授权执行；不要将早期“一次性技术验收不新建循环”误用来暂停用户后来新授权的常态任务，也不自动恢复旧模拟循环。定时采价不是研究轮次，不逐5分钟发IM；盘前/午间无变化保存，盘后汇总及真正新条件/风险才通知。跨来源通知使用同一投递账本：stop_reached归一为stop_review，target_reached归一为target_review，再按planId+symbol+kind+上海交易日去重，不因revision更新重复；先确认inflight持久化，再发原生IM并保存真实messageId，unknown/uncertain不盲重试。technical_only/无正式配置计划/未确认入场条件只采数据不发买入提示。任何价格事件先重新核对当前计划、资讯/行情/官方状态/权限费用与风险，不能把触价当成交。


多行业子代理加速（0.12）：至少两个待分析行业时，串行完成collect_batch、refresh_context及0.3资料/原文互核，再读ghost_manual(path:"workflow/industry-parallel.md")与get_research(view:"delegation")。主代理实际调用当前引擎子代理工具，每行业一个只读任务，默认最多3个、按可用槽位缩减，其余排队；工作者读取全部股票页，返回contextToken、实际workerId、行业分组/股票分档与缺项。主代理核对输入和来源后，带expectedContextToken/真实workerId串行record_judgment；协议2中，仅依赖变化或有效状态到期的行业重新真实派工；兄弟结果保留。先refresh_context(incremental:true)显式启用同日增量协议，最终按revalidation逐页完成最新市场统一复核。旧协议1仍全量失效。子代理不得推进共享collect游标、改证据/配置、定稿、配仓、计划、调度或IM；跨行业去重与风险由主代理汇总。行业分工不替代两位真实核验者的五类原文互核。当前引擎无子代理能力时明确降级串行，不伪造任务回执或提速数据。完整协议随插件手册发布，不新增已废弃的捆绑Skill。


0.13容量恢复与分页：大目录触发STORE_LIMIT时不默认删除行业或重开批次。先get_state/get_research(view:storage)核对原runId、游标及revision，再按ghost_manual(path:"workflow/storage.md")用plan_control(action:"storage_compact",storage:{expectedRevision},稳定requestKey)在插件自身库中备份/分片压缩并提交小索引，随后沿原runId继续collect_batch。不能直接改Host库文件。目录、股票（含未就绪）、资料覆盖、资讯与派工均按nextOffset分页读完（默认30，limit最多100）；先读完整派工清单后再分发/写入，不能沿已经缩短的pending清单旧offset跳页。缺片/摘要错误应停止，不创建空库或删不同观察时点的重复归属。


0.17行业范围与维护：账户industrySelectionMode为hot120/manual。默认hot120按完整行业目录的成交额降序取前120，同额按ID；手动非空industryIds，仅研究这些行业。get_research(view:industry_catalog)支持名称/代码搜索分页，热度不等于价值，金额缺失或目录不完整不得伪称已选前120。历史重置仅在用户明确要求后，先停止研究/核对原生任务、在库外备份，再plan_control reset_history_preview与reset_history（mode、expectedRevision、previewToken、稳定requestKey）。保留账户，live/simulation分开，不自动重放旧消息或调度。
