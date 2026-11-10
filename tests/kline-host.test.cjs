'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const K=require('../plugin/kline.js'),C=require('../plugin/core.js'),M=require('../plugin/node/market.cjs'),N=require('../plugin/node/network.cjs'),{host}=require('./helpers/host.cjs');
const now=Date.now(),last=new Date(now+8*3600000-86400000).toISOString().slice(0,10);
function data(code='600001'){return {rc:0,data:{code,market:1,klines:Array.from({length:140},(_,i)=>new Date(Date.parse(last+'T00:00:00Z')-(139-i)*86400000).toISOString().slice(0,10)+',100,101,102,99,1000,100000')}};}
function wire(code='sh600001'){const body=JSON.stringify(data(code.slice(2)));return {url:K.url(code),body,sha256:crypto.createHash('sha256').update(body).digest('hex'),fetchedAt:Date.now(),hashBasis:'utf8-decoded-response',transport:'host-text',finalUrlExposed:false};}
test('shared day source keeps the original fixed qfq request, dates, numeric units and caller identity',()=>{
 const u=new URL(K.url('sh600001'));assert.equal(u.origin,'https://push2his.eastmoney.com');assert.equal(u.pathname,'/api/qt/stock/kline/get');
 assert.equal(u.searchParams.get('secid'),'1.600001');assert.equal(u.searchParams.get('klt'),'101');assert.equal(u.searchParams.get('fqt'),'1');assert.equal(u.searchParams.get('lmt'),'140');
 const k=K.parse(data(),'sh600001');assert.equal(k.bars.length,140);assert.equal(k.bars.at(-1).date,last);assert.equal(k.bars.at(-1).volume,1000);assert.equal(k.adjustment,'qfq');
 const adjusted=data();adjusted.data.klines[0]=adjusted.data.klines[0].split(',')[0]+',-5,-4,-3,-6,1000,100000';assert.equal(K.parse(adjusted,'sh600001').bars[0].close,-4);
 assert.throws(()=>K.url('https://other.test'),{code:'KLINE_SOURCE_INVALID'});
});
test('source parser rejects wrong company, malformed/duplicate/future dates, values, count and provenance time',()=>{
 const variants=[d=>d.rc=1,d=>d.data.code='600002',d=>d.data.market=0,d=>d.data.klines=[],d=>d.data.klines.push(d.data.klines.at(-1)),d=>d.data.klines[0]='2026-02-30,100,101,102,99,1000,100000',d=>d.data.klines[1]=d.data.klines[0],d=>d.data.klines[0]=d.data.klines[0].replace(',100,101',',,101'),d=>d.data.klines[0]=d.data.klines[0].replace(',102,99,',',90,99,'),d=>d.data.klines[0]=d.data.klines[0].replace(',1000,',',-1,'),d=>d.data.klines[139]='2099-01-01,100,101,102,99,1000,100000'];
 for(const change of variants){const d=data();change(d);assert.throws(()=>K.parse(d,'sh600001'),{code:'KLINE_SOURCE_INVALID'});}
 assert.throws(()=>K.parse(data(),'sh600001',{fetchedAt:now-86400001}),{code:'KLINE_SOURCE_INVALID'});
});
test('worker checks the exact internal host response fingerprint and never accepts arbitrary bars or source URL',()=>{
 const w=wire();assert.equal(M.hostKline(w,'sh600001').bars.length,140);
 for(const change of [w=>w.url='https://other.test/a',w=>w.body+=' ',w=>w.sha256='0'.repeat(64),w=>w.transport='unverified',w=>w.finalUrlExposed=true,w=>w.body='x'.repeat(K.MAX_BYTES+1),w=>w.fetchedAt=Date.now()+120000,w=>delete w.fetchedAt]){const x={...w};change(x);assert.throws(()=>M.hostKline(x,'sh600001'));}
 assert.throws(()=>M.hostKline({...w,body:JSON.stringify(data('600002')),sha256:crypto.createHash('sha256').update(JSON.stringify(data('600002'))).digest('hex')},'sh600001'));
 const manifest=require('../plugin/ghost.json');assert.equal(manifest.tools.find(t=>t.name==='stock_detail').parameters.properties.hostKlines,undefined);
});
test('nonpositive historical qfq is preserved but a nonpositive last bar cannot relabel older indicators as current',async()=>{
 const history=data();history.data.klines[0]=history.data.klines[0].split(',')[0]+',-5,-4,-3,-6,1000,100000';
 const historical=K.parse(history,'sh600001');assert.equal(K.indicators(historical.bars,C).ready,true);assert.equal(K.indicators(historical.bars,C).asOf,last);
 history.data.klines[139]=last+',-5,-4,-3,-6,1000,100000';const k=K.parse(history,'sh600001');assert.equal(C.indicators(k.bars).ready,true);assert.notEqual(C.indicators(k.bars).asOf,last);assert.equal(K.indicators(k.bars,C).ready,false);
 const w={...wire(),body:JSON.stringify(history)};w.sha256=crypto.createHash('sha256').update(w.body).digest('hex');const r=(await M.assess([{symbol:'sh600001',name:'离线',quote:{price:100,asOf:Date.now()}}],()=>{},{sh600001:w}))[0];assert.equal(r.indicators.ready,false);assert.notEqual(r.indicators.asOf,r.klineAsOf);
});
test('host day query is read-only and exposes text-hash provenance without claiming raw bytes or final host',async()=>{
 const h=host(new Map(),false,false,{hostKline:true,fetchHandler:async()=>({ok:true,status:200,body:JSON.stringify(data())})}),before=(await h.call('get_state')).result;
 const r=await h.call('stock_detail',{symbol:'sh600001',includeInformation:false});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.result.source,'eastmoney');assert.equal(r.result.bars.length,140);assert.equal(r.result.sourceProvenance.hashBasis,'utf8-decoded-response');assert.equal(r.result.sourceProvenance.finalUrlExposed,false);
 const after=(await h.call('get_state')).result;
 // Independent startup monitoring status is ephemeral; all persisted summary
 // fields and the actual library remain unchanged by this read-only path.
 const {monitorStatus:beforeMonitor,...beforeStored}=before,{monitorStatus:afterMonitor,...afterStored}=after;
 assert.deepEqual(afterStored,beforeStored);assert.equal(h.files.has('state.json'),false);
});
test('host-assessed Kline keeps an old quote dated and untradeable instead of renewing its timestamp',async t=>{
 const old=Math.floor(Date.now()/1000)*1000-2*3600000,stamp=new Date(old+8*3600000).toISOString().replace(/[-:T]/g,'').slice(0,14),a=Array(70).fill('');a[1]='离线主体';a[3]='101';a[30]=stamp;
 t.mock.method(N,'request',async u=>{assert.equal(u.hostname,'qt.gtimg.cn');return {statusCode:200,body:Buffer.from('v_sh600001="'+a.join('~')+'";')};});
 const item={symbol:'sh600001',name:'离线主体',quote:{price:101,asOf:old,source:'fixture'}},r=(await M.assess([item],()=>{},{sh600001:wire()}))[0];
 assert.equal(r.indicators.ready,true);assert.equal(r.quote.price,null);assert.equal(r.lastKnownQuote.asOf,old);assert.equal(r.lastKnownQuote.usage,'dated_reference_only');assert.equal(r.quoteDiagnostics.reason,'backup_quote_stale_or_invalid');assert.equal(r.klineSourceProvenance.hashBasis,'utf8-decoded-response');
});
test('wrong-source identity fails closed without silently selecting another provider',async t=>{
 let count=0;t.mock.method(N,'request',async()=>{count++;return {statusCode:200,body:Buffer.from(JSON.stringify(data('600002')))};});
 await assert.rejects(M.kline('sh600001'),{code:'KLINE_SOURCE_INVALID'});assert.equal(count,1);
});
test('native dual-source failures retain source status separately from suspension and never grade',async t=>{
 t.mock.method(N,'request',async u=>{if(u.hostname==='push2his.eastmoney.com')throw Object.assign(Error('offline reset'),{code:'ECONNRESET'});return {statusCode:501,body:Buffer.alloc(0)};});
 const r=(await M.assess([{symbol:'sh600001',name:'离线',quote:{price:100,asOf:Date.now()}}]))[0];assert.equal(r.indicators.ready,false);assert.deepEqual(r.klineDiagnostics.sources,[{source:'eastmoney',code:'ECONNRESET',statusCode:null},{source:'tencent',code:'HTTP_STATUS_ERROR',statusCode:501}]);assert.equal(r.observation,undefined);
});
test('a rejected host source retains its error code and never retries through another transport',async t=>{
 t.mock.method(N,'request',async()=>{throw Error('must not bypass rejected host');});
 const r=(await M.assess([{symbol:'sh600001',name:'离线',quote:{price:100,asOf:Date.now()}}],()=>{},{sh600001:{errorCode:'DATA_SOURCE_ERROR',sourceCode:'CONNECTION_RESET',sourceStage:'host-request',message:'宿主日K未取得：CONNECTION_RESET'}}))[0];
 assert.equal(r.indicators.ready,false);assert.equal(r.klineDiagnostics.sourceCode,'CONNECTION_RESET');assert.equal(r.klineDiagnostics.stage,'host-request');assert.equal(r.klineDiagnostics.transport,'host-text');
});
const config={cash:10000,holdings:[],maxEquityWeight:.6,maxStockWeight:.2,maxIndustryWeight:.3,riskPerStock:.01,horizonDays:30,reviewMinutes:60,trackingEnabled:false};
async function start(h){await h.call('configure',{requestKey:'configure',expectedRevision:0,config});const b=await h.call('begin_research',{requestKey:'begin'});const c=await h.call('collect_batch',{requestKey:'collect',runId:b.result.runId,batchSize:8});assert.equal(c.ok,true,JSON.stringify(c));return b.result.runId;}
test('a complete empty industry advances without calling either host or worker assessment',async()=>{
 const assessCalls=[],h=host(new Map(),false,false,{hostKline:true,items:[],assessCalls,fetchHandler:async()=>{throw Error('empty industry must not fetch');}}),runId=await start(h),s=(await h.call('get_state')).result;
 assert.equal(s.latestRun.id,runId);assert.equal(s.latestRun.status,'collected');assert.equal(s.latestRun.sectorCursor,1);assert.equal(s.latestRun.stockCount,0);assert.equal(assessCalls.length,0);
});
test('capable host uses the fixed source for a batch with at most two concurrent requests and bounded internal snapshots',async()=>{
 let active=0,peak=0;const requests=[],assessCalls=[],h=host(new Map(),false,false,{hostKline:true,assessCalls,fetchHandler:async r=>{active++;peak=Math.max(peak,active);requests.push(r);await new Promise(resolve=>setTimeout(resolve,5));active--;assert.ok(r.callId);const u=new URL(r.url);return {ok:true,status:200,body:JSON.stringify(data(u.searchParams.get('secid').split('.')[1]))};}});
 const runId=await start(h);assert.equal(requests.length,3);assert.ok(peak<=2);assert.equal(Object.keys(assessCalls[0].hostKlines).length,3);
 const r=await h.call('get_research',{runId,sectorId:'BK0001'});assert.equal(r.result.stocks.every(s=>s.indicators.ready&&s.adjustment==='qfq'&&s.klineAsOf===last),true);
 assert.equal((await h.call('get_state')).result.activePlan,null);
});
test('same-key candidate refresh can recover a known uncommitted source failure without losing prior research',async()=>{
 let valid=false;const options={hostKline:true,fetchHandler:async r=>({ok:true,status:200,body:valid?JSON.stringify(data(new URL(r.url).searchParams.get('secid').split('.')[1])):'<html>unavailable</html>'})},h=host(new Map(),false,false,options),runId=await start(h);
 await h.call('refresh_context',{runId,requestKey:'freeze',incremental:true});const before=(await h.call('get_state')).result,args={runId,requestKey:'refresh-same-key',view:'refresh_analysis',symbol:'sh600001'};
 const failed=await h.call('stock_detail',args);assert.equal(failed.errorCode,'STALE_KLINE');assert.equal((await h.call('get_state')).result.revision,before.revision);
 valid=true;const recovered=await h.call('stock_detail',args);assert.equal(recovered.ok,true,JSON.stringify(recovered));assert.equal(recovered.result.klineAsOf,last);assert.equal((await h.call('get_state')).result.revision,before.revision+1);assert.equal((await h.call('stock_detail',args)).ok,true);assert.equal((await h.call('get_state')).result.revision,before.revision+1);
});
test('recovered host Kline does not bypass five-class original-body or final advice gates',async()=>{
 const h=host(new Map(),false,false,{hostKline:true,fetchHandler:async r=>({ok:true,status:200,body:JSON.stringify(data(new URL(r.url).searchParams.get('secid').split('.')[1]))})}),runId=await start(h);
 assert.equal((await h.call('record_judgment',{requestKey:'judgment',runId,industry:{id:'BK0001',group:'主投行业',reason:'Synthetic source mechanics only',newsIds:['n1']},stockValues:[{symbol:'sh600001',tier:'一档',reason:'Synthetic, no actual recommendation',newsIds:['n1']}]})).ok,true);
 const r=await h.call('finalize_research',{requestKey:'cannot-finalize',runId,summary:'Synthetic gate test',allocations:[{symbol:'sh600001',weight:.1,stop:90,target:120,reason:'Synthetic',entryCondition:'All evidence must pass',waitCondition:'Missing evidence waits',invalidationCondition:'Re-evaluate when inputs change'}]});
 assert.equal(r.errorCode,'INFORMATION_INCOMPLETE');const s=(await h.call('get_state')).result;assert.equal(s.activePlan,null);assert.equal(s.reports.length,0);assert.equal(s.pendingActions.length,0);
});
test('failed/truncated/foreign host responses stay unavailable, while old workers keep their original route',async()=>{
 for(const response of [{ok:false,errorCode:'CONNECTION_RESET'},{ok:true,status:200,truncated:true,body:'{}'},{ok:true,status:200,body:JSON.stringify(data('600002'))}]){
  const h=host(new Map(),false,false,{hostKline:true,items:[{symbol:'sh600001',name:'离线',quote:{price:100,asOf:Date.now()}}],fetchResponse:response}),runId=await start(h),r=await h.call('get_research',{runId,sectorId:'BK0001'});assert.equal(r.result.stocks[0].indicators.ready,false);assert.equal((await h.call('get_state')).result.activePlan,null);
 }
 const legacy=host(new Map(),false,false,{fetchHandler:async()=>{throw Error('must not use host with old capability');}}),r=await legacy.call('stock_detail',{symbol:'sh600001',includeInformation:false});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.result.source,'offline-fixture');
});
