'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {host}=require('./helpers/host.cjs');
const {prepareInformation}=require('./helpers/information.cjs');
const cfg={cash:10000,holdings:[],maxEquityWeight:.7,maxStockWeight:.2,maxIndustryWeight:.4,riskPerStock:.01,horizonDays:30,reviewMinutes:60,trackingEnabled:true,allowAutoRevision:true};
async function configured(h){let r=await h.call('get_state');assert.equal(r.ok,true);const args={requestKey:'config-1',expectedRevision:r.result.revision,config:cfg};r=await h.call('configure',args);assert.equal(r.ok,true);assert.deepEqual((await h.call('configure',args)).result,r.result);}
async function research(h,key='start-1',change={},expectedError=null){
 const r=await h.call('begin_research',{requestKey:key});assert.equal(r.ok,true);const runId=r.result.runId;
 let b=await h.call('collect_batch',{requestKey:key+'-collect',runId,batchSize:4});assert.equal(b.ok,true);assert.equal(b.result.status,'collected');
 await prepareInformation(h,runId);
 const judgment={requestKey:key+'-judge',runId,industry:{id:'BK0001',group:'主投行业',reason:'行业行情与资讯共同支持研究。',newsIds:['n1']},stockValues:[1,2,3].map(i=>({symbol:'sh60000'+i,tier:['一档','二档','三档'][i-1],reason:'已核对本轮K线、指标、资讯与估值数据。',newsIds:['n1']}))};
 assert.equal((await h.call('record_judgment',judgment)).ok,true);
 const args={requestKey:key+'-final',runId,summary:'本轮投资建议',allocations:[{symbol:'sh600001',weight:.2,stop:90,target:120,entryCondition:'本轮证据充分且价格条件核验后才考虑；样例非交易指令。',waitCondition:'数据过期或资讯不足则等待。',invalidationCondition:'原经营判断失效或触达参考点位时重新研究。',reason:'根据本轮证据配置。',...change}]};
 const f=await h.call('finalize_research',args);if(expectedError){assert.equal(f.errorCode,expectedError,JSON.stringify(f));return {runId,errorCode:f.errorCode};}assert.equal(f.ok,true,JSON.stringify(f));assert.deepEqual((await h.call('finalize_research',args)).result,f.result);
 return {runId,result:f.result};
}
test('complete advisory workflow, native action receipts, pause and restart persistence',async()=>{
 const h=host();await configured(h);const {runId,result}=await research(h);
 let s=(await h.call('get_state')).result;assert.equal(s.reports.length,1);assert.deepEqual(s.config.holdings,[]);assert.equal(s.latestRun.status,'completed');assert.equal(s.latestRun.stockCount,3);
 assert.equal(s.activePlan.allocation.positions[0].weight,.1);assert.equal(s.activePlan.scheduleId,null);
 const actions=(await h.call('pending_actions',{reportId:runId})).result;
 assert.match(actions.imText,/仅提供建议/);assert.ok(actions.fullReportAvailable);assert.equal(actions.report.allocation.cashWeight,.9);
 const schedule=actions.actions.find(a=>a.operation==='create');
 let bad=await h.call('record_receipt',{requestKey:'receipt-before-claim',actionId:schedule.id,status:'succeeded',externalId:'fixture-schedule'});assert.equal(bad.errorCode,'ACTION_NOT_CLAIMED');
 assert.equal((await h.call('claim_action',{requestKey:'claim-1',actionId:schedule.id})).ok,true);
 assert.equal((await h.call('claim_action',{requestKey:'claim-other',actionId:schedule.id})).errorCode,'ACTION_NOT_PENDING');
 assert.equal((await h.call('record_receipt',{requestKey:'receipt-1',actionId:schedule.id,status:'succeeded',externalId:'fixture-schedule'})).ok,true);
 assert.equal((await h.call('export_report',{reportId:runId})).ok,true);assert.equal(h.exported.size,1);
 s=(await h.call('get_state')).result;assert.equal(s.activePlan.scheduleId,'fixture-schedule');
 const plan=s.activePlan;
 assert.equal((await h.call('plan_control',{requestKey:'pause-1',planId:plan.id,expectedRevision:plan.revision,action:'pause'})).ok,true);
 s=(await h.call('get_state')).result;assert.equal(s.activePlan,null);assert.equal(s.latestPlan.status,'paused');assert.equal(h.monitor.at(-1).plan,null);
 const restarted=host(h.files);const restored=(await restarted.call('get_state')).result;assert.equal(restored.latestPlan.status,'paused');assert.equal(restored.reports.length,1);
 assert.ok((await restarted.call('get_research',{runId})).result.sectors.length===1);
});
test('uncertain schedule result blocks automatic plan replacement, failure produces an IM report',async()=>{
 const h=host();await configured(h);const a=await research(h);
 const action=(await h.call('pending_actions')).result.actions.find(x=>x.operation==='create');
 await h.call('claim_action',{requestKey:'claim-u',actionId:action.id});await h.call('record_receipt',{requestKey:'uncertain-u',actionId:action.id,status:'uncertain',message:'外部回执超时'});
 const begin=await h.call('begin_research',{requestKey:'new-run'}),runId=begin.result.runId;
 await h.call('collect_batch',{requestKey:'collect-u',runId,batchSize:4});
 await prepareInformation(h,runId);
 await h.call('record_judgment',{requestKey:'judge-u',runId,industry:{id:'BK0001',group:'主投行业',reason:'复查',newsIds:['n1']},stockValues:[{symbol:'sh600001',tier:'一档',reason:'复查证据',newsIds:['n1']}]});
 const final=await h.call('finalize_research',{requestKey:'final-u',runId,summary:'复查',allocations:[{symbol:'sh600001',weight:.2,stop:90,target:120,entryCondition:'复查后才考虑',waitCondition:'证据不足则等待',invalidationCondition:'原理由失效时重评',reason:'复查'}]});assert.equal(final.errorCode,'RECONCILE_SCHEDULE');
 const before=(await h.call('get_state')).result.activePlan.revision;
 const failed=await h.call('record_failure',{requestKey:'failure-u',runId,message:'调度结果未知，未替换计划。'});assert.equal(failed.ok,true);
 const s=(await h.call('get_state')).result;assert.equal(s.activePlan.revision,before);assert.equal(s.reports[0].status,'failed');
 assert.ok((await h.call('pending_actions')).result.actions.some(x=>x.reportId===runId&&x.operation==='send_report'));
});
test('library outage never initializes an empty replacement over existing user data',async()=>{const files=new Map([['state.json','retained-original']]);const h=host(files,true);const r=await h.call('get_state');assert.equal(r.ok,false);assert.equal(files.get('state.json'),'retained-original');});
test('same mutation key with different payload is rejected',async()=>{const h=host();await configured(h);const r=await h.call('configure',{requestKey:'config-1',expectedRevision:0,config:{...cfg,cash:50000}});assert.equal(r.errorCode,'REQUEST_CONFLICT');});

test('queued target events are cancelled after pause and are not republished after restart',async()=>{
 const h=host(new Map(),false,true);await configured(h);await research(h);
 const p=(await h.call('get_state')).result.activePlan;
 const event={id:p.id+'.'+p.revision+'.sh600001.target_reached',type:'plan.target_reached',occurredAt:Date.now(),subject:p.id,data:{planId:p.id,revision:p.revision,symbol:'sh600001',kind:'target_reached',price:120,sourceTime:Date.now()}};
 h.emit({type:'event',name:'node-notification',method:'monitor_events',params:{events:[event]}});await h.call('get_state');
 assert.equal(h.published.length,1);
 await h.call('plan_control',{requestKey:'pause-with-event',planId:p.id,expectedRevision:p.revision,action:'pause'});
 const restarted=host(h.files);await restarted.call('get_state');
 assert.equal(restarted.published.length,0);
 const stored=JSON.parse(h.files.get('state.json'));assert.equal(stored.events[0].cancelled,true);
});
test('historical IM report retains its own plan revision and failed delivery can be retried explicitly',async()=>{
 const h=host();await configured(h);const first=await research(h);
 const actions=(await h.call('pending_actions')).result.actions;const text=actions.find(x=>x.operation==='send_report'&&x.format==='text');
 await h.call('claim_action',{requestKey:'claim-text',actionId:text.id});await h.call('record_receipt',{requestKey:'fail-text',actionId:text.id,status:'failed',message:'NO_PEER_CONTEXT'});
 assert.equal((await h.call('claim_action',{requestKey:'retry-text',actionId:text.id,retryFailed:true})).ok,true);
 await research(h,'second-run');
 const archivePath='reports/'+first.runId+'.json', archived=JSON.parse(h.files.get(archivePath));delete archived.report.planSnapshot;h.files.set(archivePath,JSON.stringify(archived));
 const old=(await h.call('pending_actions',{reportId:first.runId})).result.imText;assert.match(old,/ v1：/);
 const exported=await h.call('export_report',{reportId:first.runId});assert.equal(exported.ok,true);const markdown=[...h.exported.values()].at(-1);assert.match(markdown,/MA5\/20\/60/);assert.match(markdown,/n1：/);assert.match(markdown,/定稿报价100/);
});

module.exports={host,research,configured,cfg};
test('risky fresh quote names cannot finalize a plan or enqueue external actions',async()=>{
 const h=host(new Map(),false,false,{quoteNames:{sh600001:'*ST合成测试'}});await configured(h);
 await research(h,'risky-name',{},'RISK_NAME_BLOCKED');const state=(await h.call('get_state')).result;
 assert.equal(state.activePlan,null);assert.equal(state.reports.length,0);assert.equal(state.pendingActions.length,0);assert.deepEqual(state.config.holdings,[]);
});
test('advice conditions persist and a condition-only revision respects auto-revision choice',async()=>{
 const h=host();await configured(h);const first=await research(h,'condition-first');
 const saved=JSON.parse(h.files.get('reports/'+first.runId+'.json'));
 assert.match(saved.report.allocation.positions[0].entryCondition,/证据充分/);assert.equal(saved.plan.allocation.riskEstimate.stopDistanceLoss,100);
 const second=await research(h,'condition-change',{entryCondition:'新增等待财报核验条件，权重和点位未变。'});
 assert.equal(second.result.planChanged,true);assert.equal(second.result.planRevision,2);
 let state=(await h.call('get_state')).result;
 await h.call('configure',{requestKey:'disable-auto-revision',expectedRevision:state.revision,config:{...cfg,allowAutoRevision:false}});
 const third=await research(h,'condition-proposal',{entryCondition:'另一个条件，需要用户决定是否采用。'});
 assert.equal(third.result.status,'proposal_only');assert.equal(third.result.planChanged,false);state=(await h.call('get_state')).result;
 assert.equal(state.activePlan.revision,2);assert.match(state.activePlan.allocation.positions[0].entryCondition,/等待财报/);
});

 test('every finalized AI advice is frozen with canonical hash and survives restart; tamper is refused',async()=>{
 const h=host();await configured(h);const {runId}=await research(h);const rows=(await perf(h,{action:'list'})).result.advice;assert.equal(rows.length,1);const raw=h.files.get('advice/'+runId+'.json'),frozen=JSON.parse(raw);assert.equal(require('node:crypto').createHash('sha256').update(frozen.canonical).digest('hex'),frozen.sha256);assert.ok(Object.values(frozen.snapshot.candidates).some(x=>x.symbol==='sh600001'));assert.ok(frozen.snapshot.inputAllocations.length);assert.ok(frozen.snapshot.report.industries.length);
 const benchmarkQuote={symbol:'sh000300',price:100,asOf:Date.now(),source:'offline-fixture',priceBasis:'unadjusted'};const setup={action:'setup',ledgerId:'linked_fixture',reportId:runId,requestKey:'performance-setup',parameters:{initialCash:10000,label:'离线关联测试',benchmarkCostBps:10,benchmarkQuote,feeModel:{assumptionLabel:'离线假设',commissionRate:.001,buyTaxRate:0,sellTaxRate:.0005,transferFeeRate:0,minCommission:5,slippageBps:10}}};const made=await perf(h,setup);assert.equal(made.ok,true,JSON.stringify(made));assert.equal(made.result.performance,null);assert.deepEqual((await perf(h,setup)).result,made.result);
 const fresh=host(h.files);assert.equal((await perf(fresh,{action:'advice',reportId:runId})).result.adviceSha256,frozen.sha256);assert.equal(h.files.get('advice/'+runId+'.json'),raw);
 assert.deepEqual((await perf(fresh,{action:'get',ledgerId:'linked_fixture'})).result,made.result);const offline=host(h.files,false,false,{quoteAsOf:Date.now()-86400000});const absent=await perf(offline,{action:'refresh',requestKey:'missing-refresh',ledgerId:'linked_fixture',expectedVersion:1});assert.equal(absent.ok,true);assert.equal(absent.result.status,'observation_unavailable');assert.equal(absent.result.performance,null);assert.equal(absent.result.observations.length,1);assert.equal(absent.result.unavailableAttempts.length,1);assert.deepEqual((await perf(offline,{action:'refresh',requestKey:'missing-refresh',ledgerId:'linked_fixture',expectedVersion:1})).result,absent.result);const state=JSON.parse(h.files.get('state.json'));state.performanceJournals[0].protocol.benchmarkCostBps=0;h.files.set('state.json',JSON.stringify(state));assert.equal((await perf(host(h.files),{action:'get',ledgerId:'linked_fixture'})).errorCode,'PERFORMANCE_INTEGRITY');
 frozen.snapshot.report.summary='篡改';h.files.set('advice/'+runId+'.json',JSON.stringify(frozen));assert.equal((await perf(fresh,{action:'advice',reportId:runId})).errorCode,'STORAGE_STATE_CHANGED');assert.equal((await perf(host(h.files),{action:'advice',reportId:runId})).errorCode,'ADVICE_INTEGRITY');
 });

function perf(h,a){const {action,requestKey,mode,...performance}=a;return h.call('plan_control',{action:'performance_'+action,requestKey,mode,performance});}

test('advice transaction resumes after report archive failure with same original frozen content',async()=>{const h=host(new Map(),false,false,{failReportOnce:true});await configured(h);const before=await research(h,'partial',{},'RESEARCH_ERROR');const paths=[...h.files.keys()];const intent=paths.find(x=>x.startsWith('advice-commits/'));assert.ok(intent);const tx=JSON.parse(h.files.get(intent));const frozen=h.files.get('advice/'+before.runId+'.json');
const a={requestKey:'partial-final',runId:before.runId,summary:'本轮投资建议',allocations:tx.body.advice.snapshot.inputAllocations};const done=await h.call('finalize_research',a);assert.equal(done.ok,true,JSON.stringify(done));assert.equal(h.files.get('advice/'+before.runId+'.json'),frozen);assert.equal(h.monitor.at(-1).plan.id,done.result.planId);assert.equal((await h.call('get_state')).result.reports.length,1);assert.deepEqual((await h.call('finalize_research',a)).result,done.result);});
