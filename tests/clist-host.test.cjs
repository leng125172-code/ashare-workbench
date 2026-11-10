'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../plugin/core.js'),L=require('../plugin/clist.js'),{host}=require('./helpers/host.cjs');
const rows=()=>Array.from({length:171},(_,i)=>({f12:'BK'+String(1000+i),f14:'离线行业'+i,f6:1000000+i,f124:Math.floor(Date.now()/1000)}));
test('shared source reads all pages with unchanged scope, units and source time',async()=>{
 const data=rows(),urls=[],client=L.create({core:C,request:async url=>{const u=new URL(url);urls.push(u);return {rc:0,data:{total:171,diff:data.slice((Number(u.searchParams.get('pn'))-1)*100,Number(u.searchParams.get('pn'))*100)}};}});
 const r=await client.sectors();assert.equal(r.complete,true);assert.equal(r.total,171);assert.equal(r.rows.length,171);assert.equal(urls.length,2);for(const u of urls){assert.equal(u.hostname,'push2.eastmoney.com');assert.equal(u.searchParams.get('fs'),'m:90+t:2');assert.equal(u.searchParams.get('fltt'),'2');}assert.equal(r.rows[0].amount,1000000);assert.equal(r.rows[0].asOf,data[0].f124*1000);
});
test('shared list rejects changed/missing totals and never labels missing or duplicate pages complete',async()=>{
 for(const total of [null,undefined,'',true,-1,20001]){const client=L.create({core:C,request:async()=>({rc:0,data:{total,diff:[]}})});await assert.rejects(client.sectors());}
 let page=0;await assert.rejects(L.create({core:C,request:async()=>({rc:0,data:{total:171+page++,diff:rows().slice(0,100)}})}).sectors());
 for(const part of [[],rows().slice(0,71)]){let p=0;const client=L.create({core:C,request:async()=>({rc:0,data:{total:171,diff:p++?part:rows().slice(0,100)}})});assert.equal((await client.sectors()).complete,false);}
});
test('native capability sends clist through host network; failure never rotates to Node',async()=>{
 let fetched=0;const h=host(new Map(),false,false,{hostClist:true,fetchHandler:async r=>{fetched++;const u=new URL(r.url),p=Number(u.searchParams.get('pn'));assert.ok(r.callId);assert.equal(r.headers.Cookie,undefined);return {ok:true,status:200,truncated:false,body:JSON.stringify({rc:0,data:{total:171,diff:rows().slice((p-1)*100,p*100)}})};}});
 const before=await h.call('get_state'),r=await h.call('get_research',{view:'industry_catalog',refresh:true,limit:3});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.result.directoryTotal,171);assert.equal(r.result.selection.selectedCount,120);assert.equal(fetched,2);assert.equal(r.result.sourceProvenance.finalUrlExposed,false);assert.equal(r.result.sourceProvenance.pages.length,2);assert.match(r.result.sourceProvenance.pages[0].sha256,/^[a-f0-9]{64}$/);const after=(await h.call('get_state')).result;for(const key of ['revision','config','latestRun','activePlan','latestPlan','pendingActions','reports','storage'])assert.deepEqual(after[key],before.result[key]);
 for(const response of [{ok:false,status:429},{ok:true,status:200,truncated:true,body:'{}'},{ok:true,status:200,body:'<html>login</html>'}]){const bad=host(new Map(),false,false,{hostClist:true,fetchResponse:response}),out=await bad.call('get_research',{view:'industry_catalog',refresh:true});assert.equal(out.ok,false);assert.equal((await bad.call('get_state')).result.revision,0);}
});
test('host member rows share numeric basis and quotes retain original timestamps',async()=>{
 const client=L.create({core:C,request:async u=>{assert.equal(new URL(u).searchParams.get('fs'),'b:BK1000');return {rc:0,data:{total:1,diff:[{f12:'600900',f13:1,f14:'离线公司',f2:10,f6:1000000,f124:1700000000}]}};}}),r=await client.members('BK1000');assert.equal(r.complete,true);assert.equal(r.rows[0].symbol,'sh600900');assert.equal(r.rows[0].quote.amount,1000000);assert.equal(r.rows[0].quote.asOf,1700000000000);await assert.rejects(client.members('bad'));
});

test('network diagnostics are opt-in, read-only and disabled in simulation',async()=>{const h=host(new Map(),false,false,{hostClist:true});const ordinary=await h.call('get_state');assert.equal(ordinary.result.networkDiagnostics,undefined);const detail=await h.call('get_state',{includeNetworkStatus:true});assert.deepEqual(detail.result.networkDiagnostics.capabilities,['host_clist_transport']);const sim=await h.call('get_state',{mode:'simulation',includeNetworkStatus:true});assert.deepEqual(sim.result.networkDiagnostics,{networkDisabled:true});assert.equal(detail.result.revision,ordinary.result.revision);});
