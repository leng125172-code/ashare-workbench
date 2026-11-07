'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const I=require('../plugin/information.js'),C=require('../plugin/core.js');
const at=Date.parse('2026-11-06T10:00:00+08:00'),sha='a'.repeat(64);
const stock={symbol:'sz002001',name:'离线样本',quote:{price:10,asOf:at}};
function event(state,published=at-3600000){return {id:state,category:'announcement',symbol:stock.symbol,url:'https://static.cninfo.com.cn/finalpage/2026-11-06/example.pdf',publishedMs:published,fetchedAt:at-120000,issuerBinding:{symbol:stock.symbol,url:'https://static.cninfo.com.cn/finalpage/2026-11-06/example.pdf',sha256:sha},contentLevel:'full_text_reviewed',fingerprint:'fixture',sourceSnapshot:{sha256:sha,fetchedAt:at-120000},tradingEvent:{state,effectiveDate:'2026-11-06'},reviews:['a','b'].map(reviewerId=>({reviewerId,verdict:'supported',fingerprint:'fixture',checkedAt:at-60000}))};}
const context=news=>({news,sourceSnapshots:Object.fromEntries(news.map(e=>[e.url,{sha256:sha}])),at});
test('ungraded industry membership is distinct from an investment candidate; missing quotes do not infer suspension',()=>{
 assert.equal(I.observation(stock,{at}).stage,'industry_member');assert.equal(I.observation({...stock,valueTier:'二档'},{at}).stage,'investment_candidate');
 const x=I.observation({...stock,quote:{price:null}},{at});assert.equal(x.quoteMissing,true);assert.equal(x.stage,'industry_member');
});
test('official captured double-reviewed suspension is observation-only even with a valid price',()=>{
 const x=I.observation(stock,context([event('suspended')]));assert.equal(x.stage,'suspension_watch');assert.equal(x.allocationBlocked,true);
 assert.equal(C.recommendationSafety({...stock,observation:x},{name:stock.name,price:10}).code,'OBSERVATION_ONLY');
});
test('expired, conflicting or unreviewed suspension never silently becomes eligible',()=>{
 for(const change of [e=>e.reviews=[],e=>e.reviews[0].verdict='contradicted',e=>e.sourceSnapshot.fetchedAt=at-2*86400000]){
  const e=event('suspended');change(e);const x=I.observation(stock,context([e]));assert.equal(x.stage,'trading_status_unverified');assert.equal(x.allocationBlocked,true);
 }
});
test('resumption requires reviewed disclosure, post-review analysis and post-review quote; old tiers cannot auto-resume',()=>{
 const stop=event('suspended',at-7200000),resume=event('resumed',at-3600000),ctx=context([stop,resume]);
 assert.equal(I.observation({...stock,valueTier:'一档'},ctx).stage,'resumption_review');
 assert.equal(I.observation({...stock,quote:{price:10,asOf:at-300000}},{...ctx,analysisAt:at}).stage,'resumption_review');
 const x=I.observation({...stock,valueTier:'二档'},{...ctx,analysisAt:at});assert.equal(x.stage,'investment_candidate');assert.equal(x.allocationBlocked,false);
 resume.reviews=[];assert.equal(I.observation(stock,{...ctx,analysisAt:at}).allocationBlocked,true);
});
test('nonofficial, nonannouncement and invalid effective dates cannot create trading events',()=>{
 const input={title:'离线公告',url:'https://static.cninfo.com.cn/finalpage/2026-11-06/example.pdf',publishedAt:new Date(at-3600000).toISOString(),category:'announcement',symbol:stock.symbol,summary:'离线样本正文摘要',tradingEvent:{state:'suspended',effectiveDate:'2026-11-06',basis:'公告明确暂停交易'}};
 assert.equal(I.evidence(input,at).tradingEvent.state,'suspended');
 assert.throws(()=>I.evidence({...input,url:'https://example.com/article'},at));
 assert.throws(()=>I.evidence({...input,category:'market'},at));
 assert.throws(()=>I.evidence({...input,tradingEvent:{...input.tradingEvent,effectiveDate:'2026-02-30'}},at));
});

test('simultaneous opposing events always block regardless of submission order',()=>{
 const stop=event('suspended'),resume=event('resumed');for(const news of [[stop,resume],[resume,stop]])assert.equal(I.observation(stock,{...context(news),analysisAt:at}).allocationBlocked,true);
});
test('a company trading event requires captured body and identity-matching official listing',()=>{
 const e=event('suspended'),d={symbol:stock.symbol,fetchedAt:at,announcements:{rows:[{id:'fixture',symbol:stock.symbol,url:e.url,publishedMs:e.publishedMs}]}};
 assert.equal(I.bindTradingEvent(e,d,at).sha256,sha);assert.throws(()=>I.bindTradingEvent(e,{...d,symbol:'sz002002'},at));assert.throws(()=>I.bindTradingEvent(e,{...d,announcements:{rows:[]}},at));
 const unbound={...e,issuerBinding:undefined};assert.equal(I.observation(stock,context([unbound])).stage,'trading_status_unverified');
});
