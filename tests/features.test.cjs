'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const C=require('../plugin/core.js'),Cal=require('../plugin/calendar.js'),Sim=require('../plugin/simulation.js'),Chart=require('../plugin/chart.js');
const {host}=require('./helpers/host.cjs');
const at=Date.parse('2026-11-04T15:15:00+08:00');
async function simulation(h){
 let s=(await h.call('get_state',{mode:'simulation'})).result;
 assert.equal((await h.call('configure',{mode:'simulation',requestKey:'sim-config',expectedRevision:s.revision,config:Sim.defaultConfig})).ok,true);
 const b=await h.call('begin_research',{mode:'simulation',requestKey:'sim-begin'}),runId=b.result.runId;
 for(let i=0;i<12;i++){const c=await h.call('collect_batch',{mode:'simulation',requestKey:'sim-collect-'+i,runId,batchSize:8});assert.equal(c.ok,true);if(c.result.status==='collected')break;}
 const overview=(await h.call('get_research',{mode:'simulation',runId})).result,allocations=[];
 for(let i=0;i<overview.sectors.length;i++){
  const sector=overview.sectors[i],r=(await h.call('get_research',{mode:'simulation',runId,sectorId:sector.id})).result,newsId=r.news[0].id;
  assert.equal((await h.call('record_judgment',{mode:'simulation',requestKey:'sim-judge-'+i,runId,industry:{id:sector.id,group:C.GROUPS[i],reason:'模拟资讯与合成指标用于验证四组输出，不是真实行业意见。',newsIds:[newsId]},stockValues:r.stocks.map((s,j)=>({symbol:s.symbol,tier:C.TIERS[j],reason:'模拟价值分档，仅验证功能。',newsIds:[newsId]}))})).ok,true);
  if(i<3){const p=r.stocks[0];allocations.push({symbol:p.symbol,sectorId:sector.id,weight:.2,stop:p.quote.price*.9,target:p.quote.price*1.2,entryCondition:'本轮证据充分且价格条件核验后才考虑；样例非交易指令。',waitCondition:'数据过期或资讯不足则等待。',invalidationCondition:'原经营判断失效或触达参考点位时重新研究。',reason:'模拟配置，用于测试仓位上限与计划。'});}
 }
 const f=await h.call('finalize_research',{mode:'simulation',requestKey:'sim-final',runId,summary:'模拟计划，只验证流程，不是真实荐股。',allocations});assert.equal(f.ok,true,JSON.stringify(f));
 return {runId,result:f.result,plan:(await h.call('get_state',{mode:'simulation'})).result.activePlan};
}
test('official calendar distinguishes holidays, make-up weekends, reopening and unknown years',()=>{
 assert.equal(Cal.check('2026-10-07').isTradingDay,false);assert.equal(Cal.check('2026-10-08').isTradingDay,true);assert.equal(Cal.check('2026-10-10').isTradingDay,false);
 assert.equal(Cal.check('2026-02-23').isTradingDay,false);assert.equal(Cal.check('2026-02-24').isTradingDay,true);assert.equal(Cal.check('2027-01-04').known,false);
 assert.equal(Cal.expectedDailyBar(at),'2026-11-04');assert.equal(Cal.expectedDailyBar(Date.parse('2026-11-04T10:00:00+08:00')),'2026-11-03');
});
test('native calendar hook releases trading days, skips closed days and fails closed on unknown year',()=>{
 for(const [date,code,sentinel]of [['2026-11-04',0,true],['2026-10-07',2,true],['2026-10-10',2,true],['2027-01-04',1,false]]){
  const r=spawnSync(process.execPath,['--input-type=module','-e',`Date.now=()=>${Date.parse(date+'T15:15:00+08:00')};\n${Cal.preRunHookScript()}`],{encoding:'utf8'});assert.equal(r.status,code,date);assert.equal(r.stdout.includes('CINDY_PRECHECK_OK'),sentinel,date);
 }
});
test('simulation research is durable and isolated from the live portfolio and monitor',async()=>{
 const h=host();let live=(await h.call('get_state')).result;
 await h.call('configure',{requestKey:'live-config',expectedRevision:live.revision,config:{...Sim.defaultConfig,cash:12345,holdings:[{symbol:'sh600519',name:'真实输入',quantity:100,cost:50}]}});
 const before=h.files.get('state.json'),monitorBefore=h.monitor.length;const {plan,runId}=await simulation(h);
 assert.equal(h.files.get('state.json'),before);assert.equal(h.monitor.length,monitorBefore);assert.ok(h.files.has('simulation/state.json'));assert.equal(plan.mode,'simulation');assert.ok(plan.id.startsWith('sim-'));
 const r=(await h.call('pending_actions',{mode:'simulation',reportId:runId})).result;assert.match(r.imText,/模拟测试/);assert.equal(r.actions.filter(x=>x.role).length,2);assert.equal(r.actions.filter(x=>x.format==='image').length,3);
 const reboot=host(h.files);assert.equal((await reboot.call('get_state',{mode:'simulation'})).result.activePlan.id,plan.id);assert.equal((await reboot.call('get_state')).result.config.cash,12345);
});
test('the two native schedule roles cannot share an ID and pausing creates both pause intents',async()=>{
 const h=host();const {plan}=await simulation(h);const actions=(await h.call('pending_actions',{mode:'simulation'})).result.actions.filter(a=>a.role);
 assert.equal(actions.find(a=>a.role==='daily_scan').desired.cronExpr,'15 15 * * 1-5');assert.ok(actions.find(a=>a.role==='daily_scan').preRunHookScript.includes('CINDY_PRECHECK_OK'));
 for(const role of ['review','daily_scan']){const a=actions.find(a=>a.role===role);await h.call('claim_action',{mode:'simulation',requestKey:'claim-'+role,actionId:a.id});if(role==='daily_scan')assert.equal((await h.call('record_receipt',{mode:'simulation',requestKey:'wrong-daily',actionId:a.id,status:'succeeded',externalId:'native-review'})).errorCode,'SCHEDULE_ROLE_CONFLICT');assert.equal((await h.call('record_receipt',{mode:'simulation',requestKey:'receipt-'+role,actionId:a.id,status:'succeeded',externalId:'native-'+role})).ok,true);}
 await h.call('plan_control',{mode:'simulation',requestKey:'pause-both',planId:plan.id,expectedRevision:plan.revision,action:'pause'});
 const pending=(await h.call('pending_actions',{mode:'simulation'})).result.actions.filter(x=>x.operation==='pause');assert.deepEqual(pending.map(x=>x.scheduleId).sort(),['native-daily_scan','native-review']);
});
test('specified and recommended quotes expose their mode, real sources stay separate and paging is bounded',async()=>{
 const h=host();await simulation(h);const one=(await h.call('stock_detail',{mode:'simulation',symbol:'sh600519',period:'day'})).result;assert.equal(one.source,'simulation');assert.equal(one.bars.length,140);assert.equal(one.simulation,true);
 const recommended=(await h.call('stock_detail',{mode:'simulation',selector:'recommended',limit:1})).result;assert.equal(recommended.items.length,1);assert.equal(recommended.total,3);assert.equal(recommended.nextOffset,1);assert.ok(recommended.items[0].position.target);
 assert.equal((await h.call('stock_detail',{symbol:'sh600519',scenario:'target'})).errorCode,'SIMULATION_ONLY');
 assert.match(Chart.model(one,{mode:'simulation'}).title,/模拟测试/);assert.throws(()=>Chart.model({bars:[]}));
});
test('daily scan requires every recommended stock, current evidence and honest target-hit conclusions',async()=>{
 const h=host();const {plan}=await simulation(h),args={mode:'simulation',planId:plan.id,expectedRevision:plan.revision,action:'scan',batchSize:5,asOf:at};
 const first=await h.call('plan_control',{...args,requestKey:'scan-normal'});assert.equal(first.ok,true);assert.equal(first.result.status,'collected');
 let scan=(await h.call('plan_control',{mode:'simulation',requestKey:'read-normal',action:'get_scan',scanId:first.result.scanId})).result;
 assert.ok(scan.samples.every(s=>s.mechanical.status==='within_reference_range'));
 const findings=scan.samples.map(s=>({symbol:s.position.symbol,verdict:'consistent',reason:'合成资讯假设不变，K线日期、报价与计划参考范围均通过；仅为模拟判断。',newsIds:s.mechanical.freshNewsIds}));
 assert.equal((await h.call('plan_control',{mode:'simulation',requestKey:'bad-coverage',action:'record_scan',scanId:scan.id,findings:[]})).errorCode,'INCOMPLETE_FINDINGS');
 const saved=await h.call('plan_control',{mode:'simulation',requestKey:'record-normal',action:'record_scan',scanId:scan.id,summary:'模拟逐股符合性校验',findings});assert.equal(saved.ok,true);assert.equal(saved.result.needsReview,false);
 const before=(await h.call('get_state',{mode:'simulation'})).result;
 const duplicate=await h.call('plan_control',{...args,requestKey:'scan-normal-again'});assert.equal(duplicate.result.alreadyCompleted,true);assert.equal(duplicate.result.reportId,scan.id);
 assert.equal((await h.call('get_state',{mode:'simulation'})).result.reports.length,before.reports.length);
 const explicit=await h.call('plan_control',{...args,scanId:scan.id,daily:false,requestKey:'scan-completed-explicit'});assert.equal(explicit.result.alreadyCompleted,true);
 const target=await h.call('plan_control',{...args,requestKey:'scan-target',scenario:'target'});scan=(await h.call('plan_control',{mode:'simulation',requestKey:'read-target',action:'get_scan',scanId:target.result.scanId})).result;
 assert.ok(scan.samples.every(s=>s.mechanical.flags.some(f=>f.code==='TARGET_REACHED')));
 const bad=await h.call('plan_control',{mode:'simulation',requestKey:'dishonest-target',action:'record_scan',scanId:scan.id,findings});assert.equal(bad.errorCode,'BAD_FINDINGS');
 const adjusted=await h.call('plan_control',{mode:'simulation',requestKey:'honest-target',action:'record_scan',scanId:scan.id,summary:'达到目标必须重新复核',findings:findings.map(f=>({...f,verdict:'adjust',reason:'模拟报价达到目标，需复核而非无依据上移目标。'}))});assert.equal(adjusted.ok,true);assert.equal(adjusted.result.needsReview,true);
 const pinned=(await h.call('stock_detail',{mode:'simulation',selector:'recommended',reportId:scan.id})).result;
 assert.ok(pinned.items.every(x=>x.quote.price>x.position.target));assert.equal(pinned.items[0].snapshotAt,scan.startedAt);
 const report=(await h.call('pending_actions',{mode:'simulation',reportId:scan.id})).result;
 assert.match(report.imText,/本轮现价62.5/);
 const exported=(await h.call('export_report',{mode:'simulation',reportId:scan.id})).result;assert.match(h.exported.get(exported.relativePath),/本轮扫描 sh600519：现价62.5/);
 assert.equal((await h.call('stock_detail',{mode:'simulation',selector:'recommended',reportId:scan.id,period:'week'})).errorCode,'SNAPSHOT_PERIOD');
 assert.equal((await h.call('get_state',{mode:'simulation'})).result.activePlan.revision,plan.revision);
});
test('stale scan data and plan revisions cannot be accepted as a current compliant plan',async()=>{
 const h=host();const {plan}=await simulation(h);const a=await h.call('plan_control',{mode:'simulation',requestKey:'scan-stale',action:'scan',planId:plan.id,expectedRevision:plan.revision,asOf:at,scenario:'stale',batchSize:5});
 const scan=(await h.call('plan_control',{mode:'simulation',requestKey:'read-stale',action:'get_scan',scanId:a.result.scanId})).result;assert.ok(scan.samples.every(s=>s.mechanical.status==='insufficient_data'));
 await h.call('plan_control',{mode:'simulation',requestKey:'pause-after-scan',action:'pause',planId:plan.id,expectedRevision:plan.revision});
 assert.equal((await h.call('plan_control',{mode:'simulation',requestKey:'record-after-pause',action:'record_scan',scanId:scan.id,findings:[]})).errorCode,'STALE_SCAN');
});
module.exports={simulation};
test('simulation scan continuation cannot mix scenarios or evidence clocks',async()=>{
 const h=host(),{plan}=await simulation(h),args={mode:'simulation',planId:plan.id,expectedRevision:plan.revision,action:'scan',batchSize:1,asOf:at};
 const first=(await h.call('plan_control',{...args,requestKey:'clock-first'})).result;
 assert.equal((await h.call('plan_control',{...args,scanId:first.scanId,requestKey:'clock-changed',asOf:at+60000})).errorCode,'STALE_SCAN');
 assert.equal((await h.call('plan_control',{...args,scanId:first.scanId,requestKey:'scenario-changed',scenario:'target'})).errorCode,'SCENARIO_CONFLICT');
 assert.equal((await h.call('plan_control',{...args,scanId:first.scanId,requestKey:'clock-resume'})).result.scanned,2);
});
