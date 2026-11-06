'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{host}=require('./helpers/host.cjs'),Cal=require('../plugin/calendar.js');
test('real observation RPC remains simulation-isolated, survives reload and has stable idempotency',async()=>{
 const files=new Map(),date=Cal.expectedDailyBar(Date.now()),h=host(files,false,false,{quoteAsOf:Date.parse(date+'T15:05:00+08:00')});
 const before=(await h.call('get_state',{mode:'live'})).result,liveBytes=files.get('state.json');
 const a={mode:'simulation',action:'forward_setup',requestKey:'technical-frozen-setup',forward:{journalId:'technical_host',initialCash:1000000,symbols:['sh600519','sz000001']}};
 const r=await h.call('plan_control',a);assert.equal(r.ok,true,JSON.stringify(r));assert.match(r.result.protocolSha256,/^[a-f0-9]{64}$/);assert.equal(r.result.portfolioPnl,0);
 assert.deepEqual((await h.call('plan_control',a)).result,r.result);assert.equal(files.get('state.json'),liveBytes);
 assert.equal((await h.call('plan_control',{...a,forward:{...a.forward,initialCash:999999}})).errorCode,'REQUEST_CONFLICT');
 const reloaded=host(files,false,false,{quoteAsOf:Date.parse(date+'T15:05:00+08:00')});
 const read=await reloaded.call('plan_control',{mode:'simulation',action:'forward_get',forward:{journalId:'technical_host'}});assert.deepEqual(read.result,r.result);
 const obs=await reloaded.call('plan_control',{mode:'simulation',action:'forward_observe',requestKey:'technical-observe',forward:{journalId:'technical_host',expectedVersion:1}});assert.equal(obs.result.alreadyObserved,true);assert.equal(obs.result.newCompletedSessionCount,0);
 const exported=await reloaded.call('export_report',{mode:'simulation',format:'forward_markdown',journalId:'technical_host'});assert.equal(exported.ok,true);assert.ok(reloaded.exported.get(exported.result.relativePath).split('\n').length>8);
 const simPath=[...files.keys()].find(k=>k.includes('simulation')&&k.endsWith('state.json'));assert.ok(simPath);const saved=JSON.parse(files.get(simPath));saved.forwardJournals[0].protocol.initialCash=123;saved.forwardJournals[0].protocolCanonical=JSON.stringify(saved.forwardJournals[0].protocol);files.set(simPath,JSON.stringify(saved));const tampered=host(files);assert.equal((await tampered.call('plan_control',{mode:'simulation',action:'forward_get',forward:{journalId:'technical_host'}})).errorCode,'FORWARD_INTEGRITY');
 const after=(await reloaded.call('get_state',{mode:'live'})).result;assert.deepEqual(after.config,before.config);assert.deepEqual(after.activePlan,before.activePlan);assert.deepEqual(after.reports,before.reports);assert.equal(files.get('state.json'),liveBytes);
 assert.equal((await reloaded.call('plan_control',{...a,mode:'live',requestKey:'forbidden'})).errorCode,'SIMULATION_ONLY');
});
test('execution data is read-only and unknown status never passes even with available cash',async()=>{
 const h=host(),before=(await h.call('get_state',{mode:'live'})).result,bytes=h.files.get('state.json');
 const r=await h.call('stock_detail',{mode:'live',symbol:'sh600519',view:'execution',order:{side:'buy',quantity:100,cash:1000000}});
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.result.canAssumeFill,false);assert.ok(r.result.unknown.some(x=>x.code==='TRADING_STATUS_UNKNOWN'));assert.equal(h.files.get('state.json'),bytes);
 assert.deepEqual((await h.call('get_state',{mode:'live'})).result.config,before.config);
 assert.equal((await h.call('stock_detail',{mode:'simulation',symbol:'sh600519',view:'execution'})).errorCode,'LIVE_INFORMATION_ONLY');
});
