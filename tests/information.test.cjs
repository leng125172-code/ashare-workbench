'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const I=require('../plugin/information.js'),N=require('../plugin/node/information.cjs'),{host}=require('./helpers/host.cjs'),{prepareInformation}=require('./helpers/information.cjs');
const at=Date.parse('2026-11-05T10:00:00+08:00'),iso=new Date(at).toISOString();
function e(category='announcement',change={}){return {category,symbol:'sh600519',title:'离线原文摘要',summary:'测试摘要，不是实际公司消息。',...(category==='policy'?{validityCheckedAt:iso,validityBasis:'离线假设，当前状态已核对。'}:{}),url:'https://static.cninfo.com.cn/finalpage/2026-10-31/sample.PDF',publishedAt:iso,contentLevel:'full_text_reviewed',...change};}
function reviewed(category,change={}){const x=I.evidence(e(category,change),at);x.sourceSnapshot={url:x.url,sha256:'a'.repeat(64),fetchedAt:at,bytes:100,contentType:'application/pdf'};x.id=category;x.fingerprint='fixture-digest';for(const reviewerId of ['reader','checker'])x.reviews.push(I.review(x,{fingerprint:x.fingerprint,reviewerId,verdict:'supported',checkedAt:iso,sourceUrl:x.url,excerpt:'离线原文摘要',notes:'核对身份、日期和口径，属于离线样例。'},at));return x;}
function full(){const news=[reviewed('policy',{symbol:undefined,sectorId:'BK0001',url:'https://www.gov.cn/zhengce/sample.htm'}),reviewed('announcement'),reviewed('financial',{reportPeriod:'2026-09-30'}),reviewed('valuation',{url:'https://quote.eastmoney.com/sh600519.html',dataAsOf:iso,metrics:[{name:'PE',value:'20',unit:'倍',basis:'来源口径已读，离线'}]}),reviewed('risk',{searchScope:{from:new Date(at-90*86400000).toISOString(),to:iso,urls:['https://www.cninfo.com.cn/new/hisAnnouncement/query'],limitations:'有限范围，不能确认无风险。'}})];return {news,sourceSnapshots:Object.fromEntries(news.map(e=>[e.url,e.sourceSnapshot])),symbol:'sh600519',sectorId:'BK0001',at,quote:{asOf:at},dossier:{symbol:'sh600519',fetchedAt:at,announcements:{complete:true},financials:{status:'available',rows:[{reportPeriod:'2026-09-30'}]}}};}
test('five-class coverage requires body, unique reviewers, same fingerprint and matching identity/period/time',()=>{
 const x=full();assert.equal(I.coverage(x).status,'supported');
 for(const category of I.CATEGORIES)assert.equal(I.coverage({...x,news:x.news.filter(e=>e.category!==category)}).status,'insufficient',category);
 assert.equal(I.coverage({...x,symbol:'sz000001'}).status,'insufficient');
 assert.equal(I.coverage({...x,sectorId:'BK9999'}).status,'insufficient');
 assert.equal(I.coverage({...x,quote:{asOf:at+21*60000}}).status,'insufficient');
 assert.equal(I.coverage({...x,at:at+86400001}).status,'insufficient');
 const bad=structuredClone(x);bad.dossier.financials.rows[0].reportPeriod='2026-12-31';assert.equal(I.coverage(bad).status,'insufficient');
 const changed=structuredClone(x);changed.sourceSnapshots[changed.news[0].url]={...changed.sourceSnapshots[changed.news[0].url],sha256:'b'.repeat(64)};assert.equal(I.coverage(changed).status,'insufficient');
 const partial=structuredClone(x);partial.dossier.announcements.complete=false;assert.equal(I.coverage(partial).status,'insufficient');
 const old=structuredClone(x);old.news[0].contentLevel='metadata';assert.equal(I.coverage(old).status,'insufficient');
 const duplicate=structuredClone(x);duplicate.news[1].reviews[1].reviewerId='reader';assert.equal(I.coverage(duplicate).status,'insufficient');
});
test('conflict and uncertain reviews block coverage even when a second supported record is added',()=>{
 const x=full(),r=x.news[1];r.reviews[1].verdict='contradicted';assert.equal(I.status(r,at),'conflict');
 x.news.push(reviewed('announcement'));assert.equal(I.coverage(x).checks.announcement.status,'conflict');
 r.reviews[1].verdict='uncertain';assert.equal(I.coverage(x).checks.announcement.status,'conflict');
});
test('official source identity, metadata, dates, risk bounds and nonfuture valuation are enforced',()=>{
 assert.throws(()=>I.evidence(e('financial',{reportPeriod:'2026-09-30',url:'https://cninfo.com.cn.evil.test/a.PDF'}),at),{code:'INVALID_INFORMATION'});
 assert.throws(()=>I.evidence(e('financial',{reportPeriod:'2026-02-30'}),at),{code:'INVALID_INFORMATION'});
 assert.throws(()=>I.evidence(e('financial',{reportPeriod:'2026-12-31'}),at),{code:'INVALID_INFORMATION'});
 assert.throws(()=>I.evidence(e('risk'),at),{code:'INVALID_INFORMATION'});
 assert.throws(()=>I.evidence(e('valuation',{dataAsOf:new Date(at+60001).toISOString(),metrics:[]}),at),{code:'INVALID_INFORMATION'});
 const x=reviewed('announcement');assert.throws(()=>I.review(x,{fingerprint:'wrong'},at),{code:'INVALID_INFORMATION'});
 assert.throws(()=>I.review(x,{fingerprint:x.fingerprint,reviewerId:'reader',verdict:'supported',checkedAt:iso},at),{code:'INVALID_INFORMATION'});
 x.contentLevel='metadata';assert.throws(()=>I.review(x,{fingerprint:x.fingerprint},at),{code:'INVALID_INFORMATION'});
});
test('NFRA exact official host is a risk primary source without trusting lookalikes or company disclosure categories',()=>{
 const url='https://www.nfra.gov.cn/cn/static/data/DocInfo/SelectByDocId/data_docId=999999.json';
 assert.equal(I.sourceUrl(url),url);assert.equal(I.primary(url,'risk'),true);
 for(const host of ['www.nfra.gov.cn.evil.test','nfra.gov.cn','other.nfra.gov.cn']){
  const bad=url.replace('www.nfra.gov.cn',host);assert.equal(I.primary(bad,'risk'),false);
  assert.throws(()=>I.sourceUrl(bad),{code:'INVALID_INFORMATION'});
 }
 for(const bad of [url.replace('https:','http:'),url.replace('www.nfra.gov.cn','user@www.nfra.gov.cn'),url.replace('www.nfra.gov.cn','www.nfra.gov.cn:444')])assert.throws(()=>I.sourceUrl(bad),{code:'INVALID_INFORMATION'});
 assert.equal(I.primary(url,'financial'),false);assert.equal(I.primary(url,'announcement'),false);
 assert.throws(()=>I.evidence(e('financial',{url,reportPeriod:'2026-09-30'}),at),{code:'INVALID_INFORMATION'});
});
test('NFRA JSON body capture still requires matching fingerprints, two independent reviews and current risk scope',()=>{
 const url='https://www.nfra.gov.cn/cn/static/data/DocInfo/SelectByDocId/data_docId=999999.json';
 const scope={from:new Date(at-90*86400000).toISOString(),to:iso,urls:[url],limitations:'Synthetic regulator body; scoped only, no issuer-wide absence or trading-status claim.'};
 const n=e('risk',{url,searchScope:scope}),r=I.evidence(n,at);r.id='synthetic-risk';r.fingerprint='synthetic-fingerprint';
 assert.equal(I.status(r,at),'source_not_captured');r.sourceSnapshot={url,sha256:'a'.repeat(64),fetchedAt:at,bytes:100,contentType:'application/json'};
 const vote=reviewerId=>({fingerprint:r.fingerprint,reviewerId,verdict:'supported',checkedAt:iso,sourceUrl:url,excerpt:'Synthetic official body was actually read.',notes:'Synthetic identity, period and scope checked; capture alone is not body verification.'});
 r.reviews.push(I.review(r,vote('nfra-reader'),at));assert.equal(I.status(r,at),'needs_cross_review');
 assert.throws(()=>I.review(r,vote('nfra-reader'),at),{code:'INVALID_INFORMATION'});
 assert.throws(()=>I.review(r,{...vote('nfra-checker'),fingerprint:'different'},at),{code:'INVALID_INFORMATION'});
 r.reviews.push(I.review(r,vote('nfra-checker'),at));assert.equal(I.status(r,at),'supported');
 const x=full();x.news=x.news.filter(n=>n.category!=='risk').concat({...r,symbol:x.symbol});x.sourceSnapshots[url]=r.sourceSnapshot;
 assert.equal(I.coverage(x).status,'supported');
 const changed=structuredClone(x);changed.sourceSnapshots[url]={...changed.sourceSnapshots[url],sha256:'b'.repeat(64)};assert.equal(I.coverage(changed).checks.risk.status,'insufficient');
 assert.equal(I.status({...r,contentLevel:'metadata'},at),'metadata_only');
 assert.throws(()=>I.evidence({...n,searchScope:{...scope,to:new Date(at-86400001).toISOString()}},at),{code:'INVALID_INFORMATION'});
 r.reviews[1].verdict='uncertain';assert.equal(I.coverage(x).checks.risk.status,'conflict');
});
test('read-only NFRA source capture does not configure an account or create research and report actions',async()=>{
 const h=host(),before=(await h.call('get_state')).result;
 const r=await h.call('stock_detail',{view:'source',url:'https://www.nfra.gov.cn/cn/static/data/DocInfo/SelectByDocId/data_docId=999999.json'});
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.result.saved,false);
 const after=(await h.call('get_state')).result;
 for(const key of ['revision','config','activePlan','latestPlan','latestRun','reports','pendingActions','paperAccounts'])assert.deepEqual(after[key],before[key]);
});
test('financial parser preserves units and nulls, separates field definitions, rejects future and wrong-company data',()=>{
 const raw=JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/financial-sh600519-eastmoney-20261105.json'),'utf8'));
 const rows=N.financialRows(raw,'sh600519',at);assert.equal(rows[0].metrics.basicEps.value,51.53);assert.equal(rows[0].metrics.parentNetProfit.unit,'CNY');
 assert.equal(rows[0].metrics.revenue.value,130970743649.04);assert.notEqual(rows[0].metrics.providerTotalOperatingRevenue.value,rows[0].metrics.revenue.value);
 const blank=structuredClone(raw);blank.result.data[0].EPSJB=null;assert.equal(N.financialRows(blank,'sh600519',at)[0].metrics.basicEps.value,null);
 assert.throws(()=>N.financialRows(raw,'sz000001',at),/身份/);assert.throws(()=>N.financialRows(raw,'sh600519',Date.parse('2026-10-01T00:00:00Z')),/未来/);
});
test('official announcement pagination is bounded and fails closed on duplicates, wrong issuer and changing totals',async()=>{
 const make=(i)=>({secCode:'600519',secName:'样例',announcementId:String(i),announcementTime:at-86400000,announcementTitle:'离线目录',adjunctUrl:'finalpage/2026-11-04/'+i+'.PDF'});
 const totals=[];let resolver=0;
 const request=async(url,form)=>{if(!form){resolver++;assert.match(url,/szse_stock.json$/);return {data:{stockList:[{code:'600519',orgId:'gssh0600519',zwjc:'样例'}]},sha256:'offline'};}
 totals.push(form.pageNum);return {data:{totalRecordNum:31,announcements:form.pageNum==='1'?Array.from({length:30},(_,i)=>make(i)): [make(30)],hasMore:form.pageNum==='1'},sha256:'offline'};};
 const client=N.createClient(request),d=await client.announcements('sh600519',at);assert.equal(d.complete,true);assert.deepEqual(totals,['1','2']);assert.equal(resolver,1);
 const duplicate=N.createClient(async(u,f)=>f?{data:{totalRecordNum:2,announcements:[make(1),make(1)],hasMore:false}}:request(u,f));assert.equal((await duplicate.announcements('sh600519',at)).complete,false);
 assert.throws(()=>N.announcementRows({announcements:[{...make(1),secCode:'000001'}]},'sh600519',at),/身份/);
 const failing=N.createClient(async()=>{throw Error('fixture-offline');});const failed=await failing.dossier('sh600519',at);assert.equal(failed.announcements.complete,false);assert.equal(failed.financials.status,'unavailable');
});
const config={cash:10000,holdings:[],maxEquityWeight:.6,maxStockWeight:.2,maxIndustryWeight:.3,riskPerStock:.01,horizonDays:30,reviewMinutes:60,trackingEnabled:false};
async function start(h){await h.call('configure',{requestKey:'configure',expectedRevision:0,config});const b=await h.call('begin_research',{requestKey:'begin'});await h.call('collect_batch',{requestKey:'collect',runId:b.result.runId});return b.result.runId;}
async function finalize(h,runId,key='final'){await h.call('record_judgment',{requestKey:key+'-judgment',runId,industry:{id:'BK0001',group:'主投行业',reason:'离线研究',newsIds:['n1']},stockValues:[{symbol:'sh600001',tier:'一档',reason:'离线候选',newsIds:['n1']}]});return h.call('finalize_research',{requestKey:key,runId,summary:'离线',allocations:[{symbol:'sh600001',weight:.1,stop:90,target:120,reason:'离线',entryCondition:'核验后考虑',waitCondition:'不足则等待',invalidationCondition:'条件失效重评'}]});}
test('generic market news cannot finalize live positive advice; evidence changes clear judgments and successful reports retain audit',async()=>{
 const h=host(),runId=await start(h),before=h.files.get('state.json');let r=await finalize(h,runId);assert.equal(r.errorCode,'INFORMATION_INCOMPLETE');assert.equal((await h.call('get_state')).result.activePlan,null);
 const entries=await prepareInformation(h,runId);assert.equal((await h.call('get_research',{runId})).result.status,'collected');
 r=await finalize(h,runId,'complete');assert.equal(r.ok,true,JSON.stringify(r));
 const report=JSON.parse(h.files.get('reports/'+r.result.reportId+'.json')).report;assert.equal(report.information[0].status,'supported');assert.ok(report.news.some(n=>n.fingerprint&&n.reviews.length===2));assert.match(report.markdown,/资讯核验/);
 assert.equal((await h.call('add_evidence',{requestKey:'closed-change',runId,news:[e()]})).errorCode,'RUN_CLOSED');assert.ok(entries.length>0);assert.notEqual(h.files.get('state.json'),before);
});
test('missing risk coverage keeps old plan untouched and creates no new actions or report',async()=>{
 const h=host(),first=await start(h);await prepareInformation(h,first);assert.equal((await finalize(h,first,'first-final')).ok,true);const before=(await h.call('get_state')).result;
 const begin=await h.call('begin_research',{requestKey:'second-begin'}),runId=begin.result.runId;await h.call('collect_batch',{requestKey:'second-collect',runId});
 await prepareInformation(h,runId,['sh600001'],{omitCategory:'risk'});const r=await finalize(h,runId,'missing-risk-final');assert.equal(r.errorCode,'INFORMATION_INCOMPLETE');const after=(await h.call('get_state')).result;
 assert.deepEqual(after.activePlan,before.activePlan);assert.equal(after.reports.length,before.reports.length);assert.equal(after.pendingActions.length,before.pendingActions.length);assert.deepEqual(after.config,before.config);
});

test('typed body evidence requires an actual captured source receipt; stale publications cannot be refreshed by fetching',async()=>{
 const h=host(),runId=await start(h);const r=await h.call('add_evidence',{runId,requestKey:'uncaptured',news:[{...e('announcement'),symbol:'sh600001',publishedAt:new Date().toISOString()}]});assert.equal(r.errorCode,'SOURCE_NOT_CAPTURED');
 const x=reviewed('announcement',{publishedAt:'2020-01-01T00:00:00+08:00'});assert.equal(I.status(x,at),'stale');
 const old=reviewed('financial',{publishedAt:'2025-04-01T00:00:00+08:00',reportPeriod:'2024-12-31'});assert.equal(I.status(old,at),'stale');
});

test('live daily scan requires current captured five-class evidence and rejects a changed source snapshot',async()=>{
 const options={},h=host(new Map(),false,false,options),runId=await start(h),entries=await prepareInformation(h,runId);let f=await finalize(h,runId);assert.equal(f.ok,true,JSON.stringify(f));
 const p=(await h.call('get_state')).result.activePlan;
 const scanResult=await h.call('plan_control',{requestKey:'live-scan',action:'scan',planId:p.id,expectedRevision:p.revision,daily:false,batchSize:5});assert.equal(scanResult.ok,true,JSON.stringify(scanResult));
 const scanId=scanResult.result.scanId;
 let scan=(await h.call('plan_control',{requestKey:'read-scan',action:'get_scan',scanId})).result;assert.equal(scan.samples[0].mechanical.information.status,'insufficient');
 const finding={symbol:'sh600001',verdict:'consistent',reason:'离线核验',newsIds:['n1']};
 assert.equal((await h.call('plan_control',{requestKey:'premature',action:'record_scan',scanId,findings:[finding]})).errorCode,'BAD_FINDINGS');
 for(const [i,url] of [...new Set(entries.map(e=>e.url))].entries())assert.equal((await h.call('stock_detail',{requestKey:'scan-source-'+i,scanId,view:'source',url})).ok,true);
 const submitted=await h.call('add_evidence',{requestKey:'scan-evidence',scanId,news:entries.map(e=>({...e,...(e.validityCheckedAt?{validityCheckedAt:new Date(e.validityCheckedAt).toISOString()}:{}),...(e.dataAsOf?{dataAsOf:new Date(e.dataAsOf).toISOString()}:{}),...(e.searchScope?{searchScope:{...e.searchScope,from:new Date(e.searchScope.from).toISOString(),to:new Date(e.searchScope.to).toISOString()}}:{})}))});assert.equal(submitted.ok,true,JSON.stringify(submitted));
 const reviews=submitted.result.news.flatMap(e=>['offline-scan-reader','offline-scan-checker'].map(reviewerId=>({evidenceId:e.id,fingerprint:e.fingerprint,reviewerId,verdict:'supported',checkedAt:new Date().toISOString(),sourceUrl:e.url,excerpt:'离线',notes:'离线样例，不是实际互核。'})));
 assert.equal((await h.call('add_evidence',{requestKey:'scan-review',scanId,reviews})).ok,true);
 scan=(await h.call('plan_control',{requestKey:'read-reviewed',action:'get_scan',scanId})).result;assert.equal(scan.samples[0].mechanical.status,'within_reference_range',JSON.stringify(scan.samples[0].mechanical));
 options.sourceDigest='b'.repeat(64);const url=entries[0].url;await h.call('stock_detail',{requestKey:'changed-source',scanId,view:'source',url});
 assert.equal((await h.call('plan_control',{requestKey:'changed-cannot-pass',action:'record_scan',scanId,findings:[finding]})).errorCode,'BAD_FINDINGS');
 options.sourceDigest='a'.repeat(64);await h.call('stock_detail',{requestKey:'same-original-bytes',scanId,view:'source',url});
 f=await h.call('plan_control',{requestKey:'scan-complete',action:'record_scan',scanId,findings:[finding],summary:'离线互核完成'});assert.equal(f.ok,true,JSON.stringify(f));assert.equal(f.result.needsReview,false);
});

test('read-only source capture keeps configuration empty; host text fallback is bounded and never handles an unknown host',async()=>{
 const h=host(new Map(),false,false,{failInformationSource:true,fetchResponse:{ok:true,status:200,headers:{'content-type':'text/html'},body:'<html>offline policy sample</html>'}});
 const before=(await h.call('get_state')).result;
 const r=await h.call('stock_detail',{view:'source',url:'https://www.ndrc.gov.cn/xxgk/offline.htm'});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.result.saved,false);assert.equal(r.result.snapshot.hashBasis,'utf8-decoded-response');assert.equal(r.result.snapshot.transport,'cindy.fetch');
 const after=(await h.call('get_state')).result;for(const key of ['revision','config','activePlan','latestPlan','latestRun','reports','pendingActions','paperAccounts'])assert.deepEqual(after[key],before[key]);assert.equal(h.files.has('state.json'),false);
 assert.equal((await h.call('stock_detail',{view:'source',url:'https://evil.example/a'})).errorCode,'INVALID_INFORMATION');
 const truncated=host(new Map(),false,false,{failInformationSource:true,fetchResponse:{ok:true,status:200,headers:{'content-type':'text/html'},body:'partial',truncated:true}});
 assert.equal((await truncated.call('stock_detail',{view:'source',url:'https://www.ndrc.gov.cn/xxgk/offline.htm'})).errorCode,'SOURCE_UNAVAILABLE');
});
