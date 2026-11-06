(function(root,factory){const node=typeof module==='object'&&module.exports,api=factory(node?require('./core.js'):root.AShareCore,node?require('./calendar.js'):root.AShareCalendar,node?require('./execution.js'):root.AShareExecution);if(node)module.exports=api;else root.AShareForward=api;})(globalThis,function(C,Cal,E){
'use strict';
const copy=x=>JSON.parse(JSON.stringify(x)),DAY=86400000,fail=(code,message)=>C.fail(code,message),finite=n=>typeof n==='number'&&Number.isFinite(n);
function digestText(x){return JSON.stringify(x);}
function observation(q,symbol,at,expectedDate){
 if(!q||q.symbol!==symbol||q.priceBasis!=='unadjusted'||!finite(q.price)||q.price<=0||!Number.isSafeInteger(q.asOf)||q.asOf>at||at-q.asOf>7*DAY||typeof q.source!=='string'||!q.source.trim())return {symbol,status:'unknown',reason:'未取得身份/日期/来源/未复权口径完整的报价。',quote:null};
 if(Cal.dateCN(q.asOf)!==expectedDate||new Date(q.asOf+8*3600000).getUTCHours()*60+new Date(q.asOf+8*3600000).getUTCMinutes()<900)return {symbol,status:'unknown',reason:'报价未覆盖本次预期已完成交易日的15:00以后参考时点。',quote:copy(q)};
 return {symbol,status:'observed',reason:'市场价格观察，不是成交。',quote:{symbol,price:q.price,asOf:q.asOf,source:q.source,priceBasis:'unadjusted',name:String(q.name||symbol)}};
}
function setup(a){
 if(!/^[a-zA-Z0-9_-]{3,80}$/.test(a.journalId||''))fail('FORWARD_INPUT','journalId格式不正确。');
 if(a.initialCash!==1000000||a.currency!=='CNY'||a.purpose!=='technical_only')fail('FORWARD_SCOPE','本阶段仅支持显式100万元人民币、空仓、技术测试，不接受个性化权重或真实资金。');
 if(!Number.isSafeInteger(a.at)||a.at>Date.now()+60000||!Cal.check(a.at).known)fail('FORWARD_TIME','冻结时间须在已核实日历和当前时间内。');
 if(!Array.isArray(a.symbols)||!a.symbols.length||a.symbols.length>20||new Set(a.symbols).size!==a.symbols.length||a.symbols.some(s=>!E.board(s)))fail('FORWARD_UNIVERSE','须冻结1至20只不重复的普通A股技术样本。');
 const date=Cal.expectedDailyBar(a.at),items=a.symbols.map(symbol=>observation(a.quotes?.[symbol],symbol,a.at,date)),benchmark=observation(a.benchmarkQuote,'sh000300',a.at,date);
 if(items.some(x=>x.status!=='observed')||benchmark.status!=='observed')fail('FORWARD_BASELINE_MISSING','起点需要同一已完成交易日的全部样本和沪深300参考报价。');
 if(!Array.isArray(a.identities)||a.symbols.some(s=>!a.identities.some(i=>i.symbol===s&&i.category==='A股'&&i.fetchedAt<=a.at+60000&&a.at-i.fetchedAt<DAY)))fail('FORWARD_UNIVERSE','技术样本须在官方主体目录中确认为A股。');
 const protocol={schema:1,purpose:'technical_only',initialCash:1000000,currency:'CNY',holdings:[],riskConfigStatus:'not_provided_technical_only',strategy:'cash_only_no_orders',universe:[...a.symbols],sampleReason:'预先指定的只读接口技术样本；选择过程未经验证，不是推荐或选股效果样本。',benchmark:{sameRisk:'cash_0_exposure',marketReference:'sh000300_price_index_not_same_risk'},observationCadence:'completed_session_post_close_last_quote',horizonTradingSessions:20,freezeAt:a.at,baselineDate:date,baseline:items,benchmarkBaseline:benchmark};
 return {schema:1,id:a.journalId,label:String(a.label||'100万元空仓技术观察').slice(0,200),mode:'simulation',version:1,protocol,protocolCanonical:digestText(protocol),protocolSha256:a.protocolSha256||null,createdAt:a.at,lastAttemptAt:a.at,observations:[{date,capturedAt:a.at,items,benchmark,status:'baseline'}],attempts:[],scheduleId:null,limitations:'仅技术观察：无个人风险配置、无选股/配仓建议、无成交，100万元保持现金。样本价格为各源15:00以后最后报价参考，并非已认证的交易所收盘价；原始价格变化不含分红且样本时刻可能不同。其涨跌不是策略盈亏；现金基准不计利息。协议及历史摘要仅检查意外损坏，不提供本地管理员防篡改保证。20个新交易日是技术观察窗口，不是用户投资期限，也不构成盈利验证。'};
}
function validate(j){if(!j||j.schema!==1||digestText(j.protocol)!==j.protocolCanonical)fail('FORWARD_FROZEN_CHANGED','冻结协议已变化，停止写入观察，不覆盖原记录。');}
function append(j,a){
 validate(j);if(a.expectedVersion!==j.version)fail('FORWARD_VERSION','先读取最新观察版本。');
 if(!Number.isSafeInteger(a.at)||a.at<j.lastAttemptAt||a.at>Date.now()+60000)fail('FORWARD_TIME','观察时间不能倒退或在未来。');
 if(j.attempts.length>=200||j.observations.length>=100)fail('FORWARD_LIMIT','技术观察达到记录上限。');
 const date=Cal.expectedDailyBar(a.at);if(!date)fail('FORWARD_CALENDAR_UNKNOWN','未知交易日，停止观察。');
 const previous=j.observations.at(-1);if(date<previous.date)fail('FORWARD_TIME','不能倒填以前的交易日结果。');
 const out=copy(j),items=j.protocol.universe.map(s=>observation(a.quotes?.[s],s,a.at,date)),benchmark=observation(a.benchmarkQuote,'sh000300',a.at,date),missing=items.filter(x=>x.status!=='observed').map(x=>x.symbol);
 if(benchmark.status!=='observed')missing.push('sh000300');
 if(date===previous.date&&previous.status!=='unknown')return {journal:out,alreadyObserved:true,reason:'没有新的已完成交易日；不把重复报价记为新的前向证据。'};
 const row={date,capturedAt:a.at,items,benchmark,status:missing.length?'unknown':'observed',missing};
 // Unknown attempts are retained; a later successful observation never erases them.
 out.attempts.push(copy(row));out.lastAttemptAt=a.at;out.version++;
 if(date>previous.date)out.observations.push(row);
 else if(previous.status==='unknown')out.observations.push({...row,correctsObservationIndex:out.observations.length-1});
 return {journal:out,alreadyObserved:false,observation:row};
}
function view(j){validate(j);const baseline=j.protocol.baseline,last=j.observations.at(-1),newDates=[...new Set(j.observations.filter(x=>x.status==='observed').map(x=>x.date))],unknown=j.attempts.filter(x=>x.status==='unknown');
 const prices=baseline.map(b=>{const observation=last.items.find(x=>x.symbol===b.symbol);return {symbol:b.symbol,status:observation?.status||'unknown',baselinePrice:b.quote.price,latestPrice:observation?.status==='observed'?observation.quote.price:null,rawPriceReturn:observation?.status==='observed'?observation.quote.price/b.quote.price-1:null};});
 const marketReferenceReturn=last.benchmark?.status==='observed'?last.benchmark.quote.price/j.protocol.benchmarkBaseline.quote.price-1:null;
 return {id:j.id,label:j.label,version:j.version,mode:'simulation',protocol:copy(j.protocol),protocolSha256:j.protocolSha256,observations:copy(j.observations),attempts:copy(j.attempts),newCompletedSessionCount:newDates.length,unknownAttemptCount:unknown.length,cashEquity:1000000,tradeCount:0,feesIncurred:0,portfolioPnl:0,portfolioReturn:0,sameRiskCashBenchmarkReturn:0,marketReferenceReturn,samplePriceChanges:prices,evaluationStatus:newDates.length>=20?'technical_window_observed_not_strategy_validated':'awaiting_future_sessions',limitations:j.limitations};
}
function markdown(j){const v=view(j),lines=[`# 【技术观察】${v.label}`,`记录 ${v.id} · 版本${v.version} · ${v.protocol.freezeAt?new Date(v.protocol.freezeAt).toISOString():''}`,v.limitations,`冻结协议SHA256：${v.protocolSha256||'未记录'}。`,`初始1000000元，空仓；当前现金权益1000000元；没有模型成交，费用0，现金策略盈亏0。`,`新增已完成交易日${v.newCompletedSessionCount}/20；未知尝试${v.unknownAttemptCount}；状态${v.evaluationStatus}。`,`同风险现金基准0；沪深300价格参考${v.marketReferenceReturn===null?'缺失':(v.marketReferenceReturn*100).toFixed(4)+'%'}，风险敞口不同，不用于计算选股超额收益。`,'','## 样本观察（不是推荐或成交盈亏）'];for(const x of v.samplePriceChanges)lines.push(`- ${x.symbol}：${x.status}；原始价格变化${x.rawPriceReturn===null?'缺失':(x.rawPriceReturn*100).toFixed(4)+'%'}。`);return lines.join('\n');}
return {setup,append,view,markdown,validate};
});
