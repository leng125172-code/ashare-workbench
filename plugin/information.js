(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AShareInformation=api;})(globalThis,function(){
'use strict';
const SOURCE_HOSTS=['www.cninfo.com.cn','datacenter.eastmoney.com','static.cninfo.com.cn','www.gov.cn','sousuo.www.gov.cn','www.ndrc.gov.cn','zfxxgk.ndrc.gov.cn','www.miit.gov.cn','www.pbc.gov.cn','www.stats.gov.cn','www.csrc.gov.cn','www.nfra.gov.cn','www.sse.com.cn','query.sse.com.cn','www.szse.cn','www.bse.cn','quote.eastmoney.com','qt.gtimg.cn'];
const DAY=86400000,CATEGORIES=['policy','announcement','financial','valuation','risk'];
const LABELS={policy:'行业政策',announcement:'公司公告',financial:'财报',valuation:'估值口径',risk:'风险事件'};
function fail(message){throw Object.assign(new Error(message),{code:'INVALID_INFORMATION'});}
function publicUrl(s){let u;try{u=new URL(s);}catch{fail('证据来源须为公开HTTPS原文。');}if(u.protocol!=='https:'||u.username||u.password||u.port||u.hostname==='localhost'||/^\d[\d.]+$/.test(u.hostname)||u.hostname.includes(':'))fail('证据来源须为公开HTTPS原文。');return u;}
function primary(s,category){const h=publicUrl(s).hostname.toLowerCase();if(category==='risk'&&h==='query.sse.com.cn')return false;if(category==='risk'&&(h==='csrc.gov.cn'||h.endsWith('.csrc.gov.cn')||h==='www.nfra.gov.cn'))return true;if(category==='policy')return h==='gov.cn'||h.endsWith('.gov.cn');return ['cninfo.com.cn','sse.com.cn','szse.cn','bse.cn'].some(d=>h===d||h.endsWith('.'+d));}
function date(s,name){if(typeof s!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(s)||!Number.isFinite(Date.parse(s)))fail(name+'须含时区。');return Date.parse(s);}
function period(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)fail('财报期末须为有效YYYY-MM-DD。');return s;}
function clean(s,max=1200){if(typeof s!=='string'||!s.trim()||s.length>max)fail('资讯字段缺失或过长。');return s.trim();}
function evidence(n,at=Date.now()){
 const url=publicUrl(n.url);const publishedMs=date(n.publishedAt,'发布时间');if(publishedMs>at+60000)fail('不能引用未来发布的资讯。');
 if(n.tradingEvent!==undefined&&n.category!=='announcement')fail('停复牌事件仅允许公司公告。');
 const category=n.category||'market';if(![...CATEGORIES,'market'].includes(category))fail('资讯类别不支持。');
 const x={title:clean(n.title,800),url:url.href,source:String(n.source||url.hostname).slice(0,120),publishedAt:n.publishedAt,publishedMs,fetchedAt:at,keyword:String(n.keyword||'').slice(0,100),category,contentLevel:n.contentLevel||'metadata',provenance:'agent-supplied-source',reviews:[]};
 if(category==='market'){if(n.sectorId!==undefined){if(typeof n.sectorId!=='string'||!/^BK\d+$/.test(n.sectorId))fail('行业资讯归属须为有效行业代码。');x.sectorId=n.sectorId;}if(n.symbol!==undefined){if(typeof n.symbol!=='string'||!/^(sh|sz|bj)\d{6}$/.test(n.symbol))fail('公司资讯归属须为标准股票代码。');x.symbol=n.symbol;}return x;}
 if(!['metadata','full_text_reviewed'].includes(x.contentLevel))fail('正文读取状态不支持。');
 if(category==='policy'){x.validityCheckedAt=date(n.validityCheckedAt,'政策现行状态核验时间');if(x.validityCheckedAt>at+60000||at-x.validityCheckedAt>DAY)fail('政策现行状态须在24小时内核查。');x.validityBasis=clean(n.validityBasis,1000);if(typeof n.sectorId!=='string'||!/^BK\d+$/.test(n.sectorId))fail('政策证据须关联本轮行业。');x.sectorId=n.sectorId;}
 else{if(typeof n.symbol!=='string'||!/^(sh|sz|bj)\d{6}$/.test(n.symbol))fail('公司证据须关联标准股票代码。');x.symbol=n.symbol;}
 if(category!=='valuation'&&!primary(x.url,category))fail('政策/公告/财报/风险证据须来自对应官方原文。');
 if(url.pathname==='/'||url.pathname==='')fail('资料目录首页不能代替具体原文。');
 x.summary=clean(n.summary,1600);
 if(n.tradingEvent!==undefined){
  if(category!=='announcement'||!primary(x.url,category))fail('停复牌事件须来自关联股票的官方公告。');
  const t=n.tradingEvent;if(!t||!['suspended','resumed'].includes(t.state))fail('停复牌事件状态无效。');
  const effectiveDate=period(t.effectiveDate);
  x.tradingEvent={state:t.state,effectiveDate,basis:clean(t.basis,500)};
 }
 if(n.validUntil!==undefined){x.validUntil=date(n.validUntil,'有效期');if(x.validUntil<=publishedMs)fail('有效期须晚于发布时间。');}
 if(category==='financial'){x.reportPeriod=period(n.reportPeriod);if(Date.parse(x.reportPeriod+'T00:00:00+08:00')>publishedMs)fail('财报发布日期不能早于报告期末。');}
 if(category==='valuation'){
  x.dataAsOf=date(n.dataAsOf,'估值数据时间');if(x.dataAsOf>at+60000)fail('不能使用未来估值。');
  if(!Array.isArray(n.metrics)||!n.metrics.length||n.metrics.length>12)fail('估值须记录指标值、单位和口径。');
  x.metrics=n.metrics.map(m=>({name:clean(m.name,80),value:clean(m.value,120),unit:clean(m.unit,80),basis:clean(m.basis,300)}));
 }
 if(category==='risk'){
  const s=n.searchScope;if(!s||!Array.isArray(s.urls)||!s.urls.length||s.urls.length>10)fail('风险复核须记录实际检索范围。');
  const from=date(s.from,'风险检索起始时间'),to=date(s.to,'风险检索截止时间');if(from>=to||at-from<30*DAY||to>at+60000||at-to>DAY)fail('风险检索截止时间须在24小时内。');
  if(s.urls.some(u=>!primary(u,'risk')&&!(publicUrl(u).hostname==='query.sse.com.cn'&&publicUrl(u).pathname==='/commonSoaQuery.do'&&publicUrl(u).searchParams.get('sqlId')==='BS_KCB_GGLL_NEW')))fail('风险检索须包括官方披露来源。');
  x.searchScope={from,to,urls:s.urls.map(u=>publicUrl(u).href),limitations:clean(s.limitations,800)};
 }
 return x;
}
function review(e,r,at=Date.now()){
 if(!e||!e.fingerprint||r.fingerprint!==e.fingerprint)fail('复核须引用同一条已保存证据的指纹，内容变化后重新核验。');
 if(e.category==='market'||e.contentLevel!=='full_text_reviewed')fail('目录、摘要或市场快讯不能标成已核验正文。');
 const checkedAt=date(r.checkedAt,'核验时间');if(checkedAt>at+60000||at-checkedAt>DAY||checkedAt<e.fetchedAt-60000)fail('复核时间须在采集后且24小时内。');
 if(!['supported','contradicted','uncertain'].includes(r.verdict))fail('核验结论不支持。');
 const reviewerId=clean(r.reviewerId,120);if((e.reviews||[]).some(x=>x.reviewerId===reviewerId))fail('同一核验者不能重复计票或覆盖旧结论。');
 const sourceUrl=publicUrl(r.sourceUrl).href;if(sourceUrl!==e.url&&e.category!=='valuation'&&!primary(sourceUrl,e.category))fail('复核须读取原文或同类官方证据。');
 return {reviewerId,fingerprint:r.fingerprint,verdict:r.verdict,checkedAt,sourceUrl,excerpt:clean(r.excerpt,400),notes:clean(r.notes,1000)};
}
function status(e,at=Date.now()){
 const rr=e.reviews||[];if(rr.some(r=>r.verdict==='contradicted'))return 'conflict';
 if(e.validUntil&&at>e.validUntil)return 'expired';
 if(e.category==='announcement'&&at-e.publishedMs>90*DAY)return 'stale';
 if(e.category==='financial'&&at-Date.parse(e.reportPeriod+'T00:00:00+08:00')>190*DAY)return 'stale';
 if(e.category==='policy'&&(!e.validityBasis||!e.validityCheckedAt||at-e.validityCheckedAt>DAY))return 'stale';
 if(e.regulatoryQuery&&(!e.regulatoryQuery.complete||!e.regulatoryQuery.usable||at>=e.regulatoryQuery.expiresAt))return 'stale';
 if(e.contentLevel!=='full_text_reviewed')return 'metadata_only';
 if(!e.sourceSnapshot||!/^[a-f0-9]{64}$/.test(e.sourceSnapshot.sha256||'')||at-e.sourceSnapshot.fetchedAt>DAY)return 'source_not_captured';
 if(at-e.fetchedAt>DAY||e.fetchedAt>at+60000)return 'stale';
 const ok=new Set(rr.filter(r=>r.fingerprint===e.fingerprint&&r.verdict==='supported'&&at-r.checkedAt<=DAY&&r.checkedAt<=at+60000).map(r=>r.reviewerId));
 if(rr.some(r=>r.verdict==='uncertain'))return 'unresolved';
 return ok.size>=2?'supported':'needs_cross_review';
}
function coverage({news=[],dossier=null,symbol,sectorId,at=Date.now(),quote=null,sourceSnapshots={}}){
 const checks={},issues=[];
 for(const category of CATEGORIES){
  const relevant=news.filter(e=>e.category===category&&(category==='policy'?e.sectorId===sectorId:e.symbol===symbol));
  const conflicts=relevant.filter(e=>['conflict','unresolved'].includes(status(e,at)));
  let usable=relevant.filter(e=>status(e,at)==='supported'&&sourceSnapshots[e.url]?.sha256===e.sourceSnapshot?.sha256);
  if(category==='financial'){
   const latest=dossier?.financials?.rows?.[0]?.reportPeriod;
   if(!latest)usable=[];else usable=usable.filter(e=>e.reportPeriod===latest);
  }
  if(category==='valuation')usable=usable.filter(e=>at-e.dataAsOf<=3*DAY&&e.dataAsOf<=at+60000&&quote?.asOf&&Math.abs(e.dataAsOf-quote.asOf)<=20*60000);
  if(category==='risk')usable=usable.filter(e=>e.searchScope&&at-e.searchScope.to<=DAY);
  checks[category]={label:LABELS[category],status:conflicts.length?'conflict':usable.length?'supported':'insufficient',evidenceIds:usable.map(e=>e.id)};
  if(checks[category].status!=='supported')issues.push(LABELS[category]+(conflicts.length?'存在未解决分歧':'缺少同一证据的双人正文核验或时效/口径不符'));
 }
 if(!dossier||dossier.symbol!==symbol||at-dossier.fetchedAt>DAY||dossier.fetchedAt>at+60000)issues.push('个股资料包缺失、身份不符或超过24小时');
 if(dossier?.announcements?.complete!==true)issues.push('最近90日公告检索未完整读完或来源失败');
 if(dossier?.financials?.status!=='available')issues.push('最新财务期次缺少结构化交叉参考');
 return {symbol,sectorId,status:issues.length?'insufficient':'supported',checks,issues,checkedAt:at,scope:'有限范围资料与Agent互核记录；不是全网完整性、无风险或盈利保证。'};
}
const sources=[
 {category:'policy',label:'国务院政策文件库',url:'https://sousuo.www.gov.cn/zcwjk/policyDocumentLibrary'},
 {category:'policy',label:'国家发展改革委',url:'https://www.ndrc.gov.cn/xxgk/'},
 {category:'policy',label:'工业和信息化部',url:'https://www.miit.gov.cn/zwgk/index.html'},
 {category:'policy',label:'人民银行',url:'https://www.pbc.gov.cn/'},
 {category:'risk',label:'证监会',url:'https://www.csrc.gov.cn/'},
 {category:'announcement',label:'巨潮公告',url:'https://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice'},
 {category:'risk',label:'上交所风险警示板',url:'https://www.sse.com.cn/disclosure/listedinfo/riskplate/'},
 {category:'risk',label:'深交所风险警示板',url:'https://www.szse.cn/disclosure/listed/warn/index.html'},
 {category:'policy',label:'国家统计局',url:'https://www.stats.gov.cn/'}
];
function sourceUrl(s){const u=publicUrl(s);if(!SOURCE_HOSTS.includes(u.hostname))fail('原文来源不在固定白名单。');return u.href;}
function bindTradingEvent(e,dossier,at=Date.now()){
 if(!dossier||dossier.symbol!==e.symbol||!Number.isFinite(dossier.fetchedAt)||at-dossier.fetchedAt>DAY||dossier.fetchedAt>at+60000)fail('停复牌事件须先获取同股票24小时内的官方公告资料包。');
 const row=dossier.announcements?.rows?.find(x=>x.symbol===e.symbol&&x.url===e.url);
 if(!row||!row.id||!Number.isFinite(row.publishedMs)||row.publishedMs!==e.publishedMs||!e.sourceSnapshot||e.contentLevel!=='full_text_reviewed')fail('停复牌原文须与同股票官方公告列表URL/日期匹配，并先保存正文指纹。');
 return {symbol:e.symbol,announcementId:row.id,url:row.url,publishedMs:row.publishedMs,dossierFetchedAt:dossier.fetchedAt,sha256:e.sourceSnapshot.sha256};
}
function observation(stock,{news=[],sourceSnapshots={},analysisAt=0,at=Date.now()}={}){
 const symbol=stock.symbol,today=new Date(at+8*3600000).toISOString().slice(0,10);
 const events=news.filter(e=>e.symbol===symbol&&e.category==='announcement'&&e.tradingEvent&&primary(e.url,'announcement')&&e.publishedMs<=at&&e.tradingEvent.effectiveDate<=today).sort((a,b)=>a.tradingEvent.effectiveDate.localeCompare(b.tradingEvent.effectiveDate)||a.publishedMs-b.publishedMs);
 const suspensions=events.filter(e=>e.tradingEvent.state==='suspended');
 const lastStop=suspensions.at(-1),last=events.at(-1);
 const supported=e=>status(e,at)==='supported'&&e.issuerBinding?.symbol===symbol&&e.issuerBinding?.url===e.url&&e.issuerBinding?.sha256===e.sourceSnapshot?.sha256&&sourceSnapshots[e.url]?.sha256===e.sourceSnapshot?.sha256;
 const base={stage:stock.valueTier?'investment_candidate':'industry_member',label:stock.valueTier?'投资候选（非买入指令）':'行业成员（尚非投资候选）',allocationBlocked:false,quoteMissing:!Number.isFinite(stock.quote?.price)||stock.quote.price<=0};
 const latestPeers=last?events.filter(e=>e.tradingEvent.effectiveDate===last.tradingEvent.effectiveDate&&e.publishedMs===last.publishedMs):[];
 if(new Set(latestPeers.map(e=>e.tradingEvent.state)).size>1)return {...base,stage:'trading_status_unverified',label:'停复牌证据冲突待核验',allocationBlocked:true,reason:'相同生效日与发布时间存在相反事件，不能按提交顺序推断复牌。'};
 if(lastStop){
  if(!last||last.tradingEvent.state!=='resumed'||!supported(last))return {...base,stage:supported(lastStop)?'suspension_watch':'trading_status_unverified',label:supported(lastStop)?'停牌观察':'停复牌状态待核验',allocationBlocked:true,evidenceId:lastStop.id,reason:'停牌记录不能因报价恢复或证据到期自动解除；须核验后续复牌公告并重新分析。'};
 }
 if(last?.tradingEvent.state==='resumed'){
  const boundary=Math.max(last.fetchedAt||0,...(last.reviews||[]).map(x=>x.checkedAt||0),Date.parse(last.tradingEvent.effectiveDate+'T00:00:00+08:00'));
  if(!supported(last)||analysisAt<boundary||!Number.isFinite(stock.quote?.asOf)||stock.quote.asOf<boundary)return {...base,stage:'resumption_review',label:'复牌待重新评估',allocationBlocked:true,evidenceId:last.id,reason:'复牌公告、后续有效报价和本次重新分析须齐备，旧判断不能自动恢复。'};
 }
 return base;
}
return {SOURCE_HOSTS,sourceUrl,CATEGORIES,LABELS,evidence,review,status,coverage,observation,bindTradingEvent,primary,sources};
});
