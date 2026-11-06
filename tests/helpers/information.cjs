'use strict';
const assert=require('node:assert/strict');
// Explicit offline fixtures. These URLs/attestations are NOT actual source verification.
async function prepareInformation(h,runId,symbols=['sh600001'],options={}){
 const now=new Date().toISOString(),news=[{category:'policy',sectorId:'BK0001',title:'离线政策样例',summary:'只验证核验流程，不代表真实政策。',url:'https://www.gov.cn/zhengce/offline-fixture.htm',source:'offline-fixture',publishedAt:now,contentLevel:'full_text_reviewed',validityCheckedAt:now,validityBasis:'离线政策状态假设，不是实际有效性核查。'}];
 for(const symbol of symbols){
  const d=await h.call('stock_detail',{view:'information',symbol,runId,requestKey:runId+'-info-'+symbol});assert.equal(d.ok,true,JSON.stringify(d));
  for(const category of ['announcement','financial','valuation','risk'])news.push({category,symbol,title:'离线'+category+'样例',summary:'明确的离线测试资料，不是实际公司证据。',url:category==='valuation'?'https://quote.eastmoney.com/'+symbol+'.html':'https://static.cninfo.com.cn/finalpage/2026-10-31/offline-'+symbol+'.PDF',publishedAt:now,contentLevel:'full_text_reviewed',...(category==='financial'?{reportPeriod:'2026-09-30'}:{}),...(category==='valuation'?{dataAsOf:new Date(d.result.dossier.valuationReference.asOf).toISOString(),metrics:[{name:'PE',value:'10',unit:'倍',basis:'离线固定假设'}]}:{}),...(category==='risk'?{searchScope:{from:new Date(Date.now()-90*86400000).toISOString(),to:now,urls:['https://www.cninfo.com.cn/new/hisAnnouncement/query'],limitations:'离线目录样例，不保证无风险。'}}:{})});
 }
 for(const url of new Set(news.map(e=>e.url))){const c=await h.call('stock_detail',{view:'source',runId,requestKey:runId+'-source-'+[...new Set(news.map(e=>e.url))].indexOf(url),url});assert.equal(c.ok,true,JSON.stringify(c));}
 const submitted=await h.call('add_evidence',{requestKey:runId+'-evidence',runId,news:news.filter(x=>x.category!==options.omitCategory)});assert.equal(submitted.ok,true,JSON.stringify(submitted));
 const reviews=submitted.result.news.flatMap(e=>['offline-researcher','offline-checker'].map(reviewerId=>({evidenceId:e.id,fingerprint:e.fingerprint,reviewerId,verdict:'supported',checkedAt:new Date().toISOString(),sourceUrl:e.url,excerpt:'离线样例',notes:'仅为隔离宿主测试，不是真实子代理核验。'})));
 const r=await h.call('add_evidence',{requestKey:runId+'-reviews',runId,reviews});assert.equal(r.ok,true,JSON.stringify(r));return submitted.result.news;
}
module.exports={prepareInformation};
