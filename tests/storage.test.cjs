'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const S=require('../plugin/storage.js'),{host}=require('./helpers/host.cjs');
const config={cash:1000000,holdings:[],maxEquityWeight:.7,maxStockWeight:.2,maxIndustryWeight:.4,riskPerStock:.01,horizonDays:30,reviewMinutes:60,trackingEnabled:false,allowAutoRevision:false};
function io(files,fail=()=>false){return {read:async path=>files.has(path)?{ok:true,content:files.get(path)}:{ok:false,errorCode:'NOT_FOUND'},write:async(path,content)=>{if(fail(path))return {ok:false,errorCode:'FIXTURE_WRITE_FAILED'};files.set(path,content);return {ok:true};}};}
function legacy(){
 const sectors=Array.from({length:496},(_,i)=>({id:'BK'+(1000+i),name:'隔离容量行业'+i,source:'offline-fixture'})),stocks={};
 for(let i=0;i<12221;i++){const sectorId=sectors[i%sectors.length].id,symbol='sh'+String(100000+i%5659);stocks[sectorId+':'+symbol]={symbol,sectorId,name:'合成容量样本'+(i%5659),quote:{price:100,asOf:1700000000000+i,source:'offline-fixture',priceBasis:'unadjusted'},indicators:{ready:false,reason:'容量测试不是行情研究'},padding:'0123456789'.repeat(100)};}
 const run={id:'capacity-fixture',status:'collecting',startedAt:Date.now(),config,configRevision:1,sectors,sectorCursor:430,members:Array.from({length:99},(_,i)=>({symbol:'sh'+String(600001+i),name:'隔离续采样例',quote:{price:100,asOf:Date.now(),source:'offline-fixture'}})),memberCursor:64,stocks,industryData:{},judgments:{},news:[],warnings:[],coverage:{selectedIndustryCount:496}};
 return {schema:1,revision:1734,config,runs:[run],reports:[],plans:[],scans:[],events:[],actions:[],requests:{},monitorStatus:'fixture'};
}
test('lossless per-chunk compression preserves Unicode, object order, quote dates and reuses identical pieces',async()=>{
 const files=new Map(),original=JSON.stringify({unicode:'中文🙂'.repeat(30000),random:crypto.randomBytes(350000).toString('base64'),quotes:[{asOf:1},{asOf:2}]});
 const a=await S.pack(original,io(files),{force:true});assert.equal(a.packed,true);assert.ok(a.manifest.chunks.length>1);assert.ok(a.manifest.chunks.every(x=>x.characters<=S.CHUNK_CHARS));assert.ok(a.manifest.chunks.every(x=>x.path.split('/').every(segment=>segment.length<=40&&/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(segment))));assert.equal(await S.unpack(a.content,io(files)),original);const count=files.size;const b=await S.pack(original,io(files),{force:true});assert.equal(b.chunksWritten,0);assert.equal(files.size,count);assert.equal(b.content,a.content);
 const refs=a.manifest.chunks,old=files.get(refs[0].path);files.set(refs[0].path,'X'+old.slice(1));await assert.rejects(S.unpack(a.content,io(files)),e=>e.code==='STORAGE_INTEGRITY');files.delete(refs[0].path);await assert.rejects(S.unpack(a.content,io(files)),e=>e.code==='STORAGE_UNAVAILABLE');
});
test('large legacy root is backed up, migrated with exact run/cursor/request semantics, and resumes collection after restart',async()=>{
 const old=legacy(),raw=JSON.stringify(old);assert.ok(Buffer.byteLength(raw)>12*1024*1024);assert.ok(Buffer.byteLength(raw)<16*1024*1024);const files=new Map([['state.json',raw]]),h=host(files);
 let state=(await h.call('get_state')).result;assert.equal(state.latestRun.stockCount,12221);assert.equal(state.latestRun.industryCursor,64);const args={mode:'live',action:'storage_compact',requestKey:'capacity-migrate',storage:{expectedRevision:1734}};
 const r=await h.call('plan_control',args);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.result.storage.layout,'chunked');assert.ok(r.result.storage.indexBytes<100*1024);assert.ok(r.result.storage.payloadBytes<Buffer.byteLength(raw));assert.equal(files.get(r.result.storage.legacyBackup.path),raw);assert.ok(r.result.storage.legacyBackup.path.split('/').every(segment=>segment.length<=40&&/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(segment)));assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),r.result.storage.legacyBackup.sha256);
 assert.deepEqual((await h.call('plan_control',args)).result,r.result);
 const h2=host(files),restored=(await h2.call('get_state')).result;assert.equal(restored.revision,1735);assert.deepEqual(restored.config,old.config);assert.equal(restored.latestRun.stockCount,12221);assert.equal(restored.latestRun.sectorCursor,430);assert.equal(restored.latestRun.industryCursor,64);
 const page=(await h2.call('get_research',{runId:'capacity-fixture',view:'overview',limit:25})).result;assert.equal(page.sectors.length,25);assert.equal(page.totalSectors,496);assert.equal(page.nextOffset,25);
 const resume={runId:'capacity-fixture',requestKey:'capacity-resume',batchSize:1};const step=await h2.call('collect_batch',resume);assert.equal(step.ok,true,JSON.stringify(step));assert.equal(step.result.stocksDone,12222);assert.deepEqual((await h2.call('collect_batch',resume)).result,step.result);
 const h3=host(files),last=(await h3.call('get_state')).result;assert.equal(last.latestRun.sectorCursor,430);assert.equal(last.latestRun.industryCursor,65);assert.equal(last.latestRun.stockCount,12222);assert.deepEqual(last.config,config);
 const diag=(await h3.call('get_research',{runId:'capacity-fixture',view:'storage'})).result;assert.equal(diag.memberships,12222);assert.equal(diag.uniqueSymbols,5660);assert.equal(diag.memberCursor,65);assert.equal(diag.storage.layout,'chunked');
});
test('failed piece write leaves exact legacy root and in-memory revision intact; same request can safely retry',async()=>{
 const raw=JSON.stringify(legacy()),files=new Map([['state.json',raw]]);let fail=true;const h=host(files,false,false,{failLibraryWrite:path=>fail&&path.startsWith('storage/chunks/')});
 const args={action:'storage_compact',requestKey:'failed-pieces',storage:{expectedRevision:1734}};const r=await h.call('plan_control',args);assert.equal(r.errorCode,'FIXTURE_WRITE_FAILED');assert.equal(files.get('state.json'),raw);assert.equal((await h.call('get_state')).result.revision,1734);fail=false;assert.equal((await h.call('plan_control',args)).ok,true);
});
test('failed root commit preserves old root after all pieces; verified orphan pieces are reusable and never auto-applied',async()=>{
 const raw=JSON.stringify(legacy()),files=new Map([['state.json',raw]]);let fail=true;const h=host(files,false,false,{failLibraryWrite:path=>fail&&path==='state.json'}),args={action:'storage_compact',requestKey:'failed-root',storage:{expectedRevision:1734}};
 assert.equal((await h.call('plan_control',args)).errorCode,'FIXTURE_WRITE_FAILED');assert.equal(files.get('state.json'),raw);assert.equal((await host(files).call('get_state')).result.revision,1734);const count=files.size;fail=false;assert.equal((await h.call('plan_control',args)).ok,true);assert.equal(files.size,count);
});
test('missing or corrupt root piece fails closed and cannot be replaced with a new empty account',async()=>{
 const raw=JSON.stringify(legacy()),files=new Map([['state.json',raw]]),h=host(files);assert.equal((await h.call('plan_control',{action:'storage_compact',requestKey:'corrupt-test',storage:{expectedRevision:1734}})).ok,true);const root=files.get('state.json'),m=JSON.parse(root);files.delete(m.chunks[1].path);const reply=await host(files).call('get_state');assert.equal(reply.errorCode,'STORAGE_UNAVAILABLE');assert.equal(files.get('state.json'),root);
});
test('simulation compaction uses isolated paths and cannot alter real state',async()=>{
 const raw=JSON.stringify(legacy()),live=JSON.stringify({schema:1,revision:0,config:null,runs:[],reports:[],plans:[],scans:[],events:[],actions:[],requests:{}}),files=new Map([['state.json',live],['simulation/state.json',raw]]),h=host(files);
 const r=await h.call('plan_control',{mode:'simulation',action:'storage_compact',requestKey:'sim-compact',storage:{expectedRevision:1734}});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(files.get('state.json'),live);assert.ok([...files.keys()].filter(x=>x.includes('/storage/')).every(x=>x.startsWith('simulation/')));assert.equal((await host(files).call('get_state',{mode:'simulation'})).result.latestRun.stockCount,12221);
});
test('UTF8 fallback still uses bounded immutable pieces when gzip APIs are unavailable',async()=>{
 const original=global.CompressionStream;global.CompressionStream=undefined;
 try{const raw=JSON.stringify({text:'中文🙂'.repeat(120000)}),files=new Map(),packed=await S.pack(raw,io(files),{force:true});assert.ok(packed.manifest.chunks.every(x=>x.codec==='utf8'));assert.ok([...files.values()].every(s=>s.length<=S.CHUNK_CHARS));assert.equal(await S.unpack(packed.content,io(files)),raw);}finally{global.CompressionStream=original;}
});
test('large report and frozen-commit archive recover through the same logical JSON without altering advice hashes',async()=>{
 const {prepareInformation}=require('./helpers/information.cjs');let h=host();assert.equal((await h.call('configure',{requestKey:'archive-config',expectedRevision:0,config})).ok,true);const runId=(await h.call('begin_research',{requestKey:'archive-start'})).result.runId;await h.call('collect_batch',{runId,requestKey:'archive-collect',batchSize:8});await prepareInformation(h,runId);
 const disk=JSON.parse(h.files.get('state.json'));disk.runs[0].retainedResearchText='不可截断的原始研究明细'.repeat(40000);h.files.set('state.json',JSON.stringify(disk));const files=h.files;h=host(files,false,false,{failReportOnce:true});
 assert.equal((await h.call('record_judgment',{requestKey:'archive-judge',runId,industry:{id:'BK0001',group:'主投行业',reason:'离线归档恢复测试。',newsIds:['n1']},stockValues:[{symbol:'sh600001',tier:'一档',reason:'离线样例',newsIds:['n1']}]})).ok,true);
 const args={requestKey:'archive-final',runId,summary:'仅隔离归档测试',allocations:[{symbol:'sh600001',weight:.1,stop:90,target:120,reason:'离线容量验证',entryCondition:'只有隔离样例，不用于真实投资',waitCondition:'资料缺失等待',invalidationCondition:'来源变化重新核验'}]};
 const failed=await h.call('finalize_research',args);assert.equal(failed.ok,false);const intent=[...files.keys()].find(x=>x.startsWith('advice-commits/'));assert.equal(JSON.parse(files.get(intent)).storageFormat,S.FORMAT);const logical=JSON.parse(await S.unpack(files.get(intent),io(files)));assert.ok(logical.body.reportArchive.run.retainedResearchText.length>100000);
 const resumed=await h.call('finalize_research',args);assert.equal(resumed.ok,true,JSON.stringify(resumed));const read=await h.call('pending_actions',{reportId:runId});assert.equal(read.ok,true,JSON.stringify(read));assert.ok(read.result.report.summary.includes('隔离'));
 const advice=await h.call('plan_control',{action:'performance_advice',requestKey:'archive-advice-read',performance:{reportId:runId}});assert.equal(advice.ok,true,JSON.stringify(advice));
 assert.deepEqual((await h.call('finalize_research',args)).result,resumed.result);
});
test('overview, information and delegation pages cover a large catalog without hiding unready stocks',async()=>{
 const state=legacy();state.runs[0].status='collected';const h=host(new Map([['state.json',JSON.stringify(state)]]));
 const sectors=[];for(let offset=0;offset!==null;){const x=(await h.call('get_research',{runId:'capacity-fixture',view:'overview',offset,limit:100})).result;assert.ok(x.sectors.length<=100);sectors.push(...x.sectors.map(s=>s.id));offset=x.nextOffset;}assert.equal(sectors.length,496);assert.equal(new Set(sectors).size,496);
 const a=(await h.call('get_research',{runId:'capacity-fixture',view:'delegation',limit:10})).result;assert.equal(a.assignments.length,10);assert.equal(a.totalAssignments,496);assert.equal(a.nextOffset,10);
 const sector=state.runs[0].sectors[0].id,detail=(await h.call('get_research',{runId:'capacity-fixture',view:'delegation',sectorId:sector,limit:5})).result;assert.equal(detail.stocks.length,5);assert.equal(detail.nextOffset,5);assert.ok(detail.totalStocks>5);assert.ok(detail.stocks.every(s=>!s.indicators.ready));
 const info=(await h.call('get_research',{runId:'capacity-fixture',view:'information',limit:10})).result;assert.equal(info.stocks.length,10);assert.equal(info.totalStocks,12221);assert.equal(info.nextOffset,10);assert.equal(info.pageDossierCount,0);assert.equal(Object.keys(info.dossiers).length,0);
});
test('gzip archive cannot silently decode into an empty store when decompression support is absent',async()=>{const files=new Map(),packed=await S.pack(JSON.stringify({text:'protected'.repeat(10000)}),io(files),{force:true});assert.ok(packed.manifest.chunks.some(x=>x.codec==='gzip'));const original=global.DecompressionStream;global.DecompressionStream=undefined;try{await assert.rejects(S.unpack(packed.content,io(files)),e=>e.code==='STORAGE_CODEC_UNAVAILABLE');}finally{global.DecompressionStream=original;}});
