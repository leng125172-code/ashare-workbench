(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AShareIncremental=api;})(globalThis,function(){
'use strict';
const HOUR=3600000;
function enabled(r){return r.researchProtocol===2;}
function dateCN(ms){return new Date(ms+8*HOUR).toISOString().slice(0,10);}
function sector(r,id){return (r.analysisSectors||r.sectors).find(x=>x.id===id);}
function scope(r,id){
 const s=sector(r,id),stocks=Object.values(r.stocks).filter(x=>x.sectorId===id),symbols=new Set(stocks.map(x=>x.symbol));
 const news=r.news.filter(n=>n.sectorId===id||symbols.has(n.symbol)||(!n.symbol&&!n.sectorId&&(n.keyword===s.name||String(n.title||'').includes(s.name))));
 return {sector:s,stocks,symbols,news};
}
function fresh(n,r,at){return Number.isFinite(n.publishedMs)&&n.publishedMs<=at+60000&&at-n.publishedMs<=r.config.newsMaxAgeHours*HOUR;}
function input(r,id,information,at=Date.now()){
 const x=scope(r,id),urls=new Set(x.news.map(n=>n.url)),receipts=Object.values(r.regulatoryReceipts||{}).filter(q=>x.symbols.has(q.scope.symbol));
 return {schema:2,runId:r.id,configRevision:r.configRevision,config:r.config,analysisAsOf:r.analysisAsOfBySector?.[id]||r.analysisAsOf,sector:x.sector,stocks:x.stocks,coverage:r.industryData[id]||null,
  news:x.news.map(n=>({record:n,fresh:fresh(n,r,at),status:n.category&&n.category!=='market'?information.status(n,at):null})),
  dossiers:Object.fromEntries(Object.entries(r.dossiers||{}).filter(([s])=>x.symbols.has(s))),
  sources:Object.fromEntries(Object.entries(r.sourceSnapshots||{}).filter(([url])=>urls.has(url))),
  receipts:receipts.map(q=>({record:q,usable:q.usable&&at<q.expiresAt})),informationPolicy:r.informationPolicy||0};
}
async function token(r,id,mode,hash,information,at=Date.now()){return hash(JSON.stringify({mode,input:input(r,id,information,at)}));}
async function states(r,mode,hash,information,at=Date.now()){
 const rows=[];for(const s of r.sectors){const contextToken=await token(r,s.id,mode,hash,information,at),j=r.judgments[s.id];rows.push({sectorId:s.id,contextToken,state:!j?'pending':j.analysis?.protocolVersion===2&&j.analysis.contextToken===contextToken?'current':'needs_reanalysis',assessment:j?.assessment||null});}return rows;
}
async function reviewToken(r,mode,hash,information,at=Date.now()){
 return hash(JSON.stringify({schema:2,mode,runId:r.id,config:r.config,configRevision:r.configRevision,contextEpoch:r.contextEpoch,contextRefreshedAt:r.contextRefreshedAt,sectors:r.sectors,
  marketNews:r.news.map(n=>({record:n,fresh:fresh(n,r,at),status:n.category&&n.category!=='market'?information.status(n,at):null})),dossiers:r.dossiers||{},sources:r.sourceSnapshots||{},receipts:r.regulatoryReceipts||{},
  states:await states(r,mode,hash,information,at),judgments:r.judgments}));
}
function validateReview(r,review,expected,at,fail){
 if(at-(r.contextRefreshedAt||r.startedAt)>2*HOUR)fail('STALE_RESEARCH','最新市场上下文超过2小时，refresh_context后做最终跨行业复核；不覆盖未变化行业快照。');
 if(dateCN(r.analysisAsOf)!==dateCN(at))fail('STALE_ANALYSIS_DAY','冻结分析快照已跨中国自然日，不能仅刷新时间续期；须重新取得新日分析数据，不把旧日K当实时行情。');
 if(!review||review.expectedContextToken!==expected)fail('CONTEXT_REVIEW_REQUIRED','读取get_research(view:revalidation)及最新资讯，主代理完成全行业/跨行业风险复核，携带当前token。');
 const ids=review.reviewedSectorIds;if(!Array.isArray(ids)||ids.length!==r.sectors.length||new Set(ids).size!==ids.length||ids.some(id=>!r.sectors.some(s=>s.id===id)))fail('INCOMPLETE_CONTEXT_REVIEW','最终复核须完整覆盖本轮行业，不能重复或省略。');
 if(typeof review.reason!=='string'||!review.reason.trim()||review.reason.length>12000)fail('INVALID_CONTEXT_REVIEW','最终复核须说明最新动态对冻结行业分析和配置的影响与局限。');
 const latest=new Set((r.latestMarketNewsIds||[]).filter(id=>r.news.some(n=>n.id===id&&fresh(n,r,at))));
 if(!Array.isArray(review.newsIds)||!review.newsIds.length||review.newsIds.some(id=>!latest.has(id)))fail('STALE_NEWS','最终复核须引用最近一次refresh_context取得且仍有效的市场资讯。');
}
return {enabled,dateCN,sector,scope,fresh,input,token,states,reviewToken,validateReview};
});
