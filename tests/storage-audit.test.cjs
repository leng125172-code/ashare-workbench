'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {host}=require('./helpers/host.cjs'),S=require('../plugin/storage.js'),R=require('../plugin/repository.js');
const row=sectorId=>({symbol:'sh600001',name:'隔离审查样本',sectorId,quote:{price:100,asOf:1,source:'offline-fixture'},indicators:{ready:false}});
const initial=()=>({schema:1,revision:0,config:null,runs:[{id:'audit-fixture',status:'collecting',config:{newsMaxAgeHours:48},sectors:[{id:'A',name:'隔离行业'}],sectorCursor:0,memberCursor:0,stocks:{'A:sh600001':row('A')},industryData:{},judgments:{},news:[],warnings:[]}],reports:[],plans:[],scans:[],actions:[],events:[],requests:{}});
const repository=h=>R.create({request:r=>h.library(r)});
async function fixture(){const h=host(new Map([['state.json',JSON.stringify(initial())]]));assert.equal((await h.call('plan_control',{action:'storage_migrate',requestKey:'audit-migrate',storage:{expectedRevision:0}})).ok,true);return h;}
async function count(h){return (await h.library({op:'db.exec',dbPath:R.DB,sql:'SELECT COUNT(*) AS n FROM repository_objects'})).rows[0].n;}
test('a JSON-valid but checksum-invalid protected archive prevents preview and deletion',async()=>{
 const h=await fixture(),r=repository(h),raw=JSON.stringify({stocks:{'A:sh600002':{...row('A'),symbol:'sh600002'}}}),valid=await r.pack(raw),broken=JSON.parse(valid);broken.root=[1,[]];h.files.set('advice/corrupt-protected.json',JSON.stringify(broken));const before=await count(h);
 const preview=await h.call('plan_control',{action:'storage_cleanup_preview'});assert.equal(preview.errorCode,'REPOSITORY_INTEGRITY');const attempt=await h.call('plan_control',{action:'storage_cleanup_execute',requestKey:'audit-forbidden-clean',storage:{expectedRevision:1,cleanupToken:'a'.repeat(64),confirm:true}});assert.equal(attempt.errorCode,'REPOSITORY_INTEGRITY');assert.equal(await count(h),before);
 h.files.set('advice/corrupt-protected.json',valid);assert.equal(await repository(host(h.files)).unpack(valid),raw);assert.equal((await host(h.files).call('get_state')).ok,true);
});
test('disk root changes invalidate cached reads and writes without deleting original records',async()=>{
 const h=await fixture(),original=h.files.get('state.json'),before=await count(h),broken=JSON.parse(original);broken.root=[1,[]];h.files.set('state.json',JSON.stringify(broken));assert.equal((await h.call('get_state')).errorCode,'STORAGE_STATE_CHANGED');assert.equal((await h.call('plan_control',{action:'storage_cleanup_preview'})).errorCode,'STORAGE_STATE_CHANGED');assert.equal(await count(h),before);
 const replacement=initial();replacement.revision=99;h.files.set('state.json',JSON.stringify(replacement));assert.equal((await h.call('plan_control',{action:'storage_compact',requestKey:'stale-cache-write',storage:{expectedRevision:1}})).errorCode,'STORAGE_STATE_CHANGED');assert.equal(JSON.parse(h.files.get('state.json')).revision,99);h.files.set('state.json',original);assert.equal((await host(h.files).call('get_state')).result.revision,1);
});
test('missing or empty repository format in a protected schema3 document blocks cleanup',async()=>{
 const h=await fixture(),valid=JSON.parse(await repository(h).pack(JSON.stringify({data:'protected'})));
 for(const format of ['',null,undefined]){const x={...valid};if(format===undefined)delete x.storageFormat;else x.storageFormat=format;h.files.set('advice/unknown-format.json',JSON.stringify(x));assert.equal((await h.call('plan_control',{action:'storage_cleanup_preview'})).errorCode,'STORAGE_PROTECTION_UNAVAILABLE');}
});
test('cache entry/byte budgets also bound the known-key set, including after eviction and reload',async()=>{
 const h=host(),r=R.create({request:x=>h.library(x)},{maxCacheEntries:3,maxCacheBytes:2048});let last;
 for(let i=0;i<40;i++){last=JSON.stringify({stocks:{['A:sh'+i]:{...row('A'),symbol:'sh'+i,quote:{price:100+i,asOf:i,source:'offline'}}}});const packed=await r.pack(last);assert.equal(await r.unpack(packed),last);const c=r.cacheStats();assert.ok(c.entries<=3);assert.equal(c.known,c.entries);assert.ok(c.encodedBytes<=2048);}
 r.clearCache();assert.equal(r.cacheStats().known,0);assert.equal(r.cacheStats().encodedBytes,0);
});
test('large object keys are independently paged and exactly restored',async()=>{
 const h=host(),r=repository(h),key='长字段🙂'.repeat(30000),value={ordinary:1,[key]:{note:'保留原文'.repeat(10000)},last:true},raw=JSON.stringify(value),packed=await r.pack(raw);assert.ok(Buffer.byteLength(packed)<10000);assert.equal(await repository(host(h.files)).unpack(packed),raw);const size=(await h.library({op:'db.exec',dbPath:R.DB,sql:'SELECT MAX(bytes) AS n FROM repository_objects'})).rows[0].n;assert.ok(size<=R.MAX_BODY);
});
test('thousands of industry groups use bounded indexes and preserve shared observations and membership order',async()=>{
 const h=host(),r=repository(h),stocks={};for(let i=0;i<3000;i++)stocks['industry-'+i+':sh600001']=row('industry-'+i);const raw=JSON.stringify({stocks}),packed=await r.pack(raw);assert.ok(Buffer.byteLength(packed)<10000);assert.equal((await r.counts()).snapshots,1);assert.ok((await r.counts()).byKind.some(x=>x.kind==='industry_index'));assert.equal(await repository(host(h.files)).unpack(packed),raw);assert.ok((await h.library({op:'db.exec',dbPath:R.DB,sql:'SELECT MAX(bytes) AS n FROM repository_objects'})).rows[0].n<=R.MAX_BODY);
});
test('legacy repository roots remain readable and first new-format commit backs up the exact previous root',async()=>{
 const h=host(),r=repository(h),legacy=JSON.parse(await r.pack(JSON.stringify(initial())));legacy.storageFormat=R.LEGACY_FORMAT;const raw=JSON.stringify(legacy);h.files.set('state.json',raw);const fresh=host(h.files);assert.equal((await fresh.call('get_state')).result.storage.repositoryFormat,R.LEGACY_FORMAT);const result=await fresh.call('plan_control',{action:'storage_compact',requestKey:'audit-upgrade-codec',storage:{expectedRevision:0}});assert.equal(result.ok,true,JSON.stringify(result));const state=(await host(h.files).call('get_state')).result;assert.equal(state.storage.repositoryFormat,R.FORMAT);assert.equal(h.files.get(state.storage.repositoryBackup.path),raw);assert.equal(state.latestRun.stockCount,1);
});
test('index overflow is rejected before any piece I/O and large two-pass packs round-trip',async()=>{
 const files=new Map(),io={read:async path=>files.has(path)?{ok:true,content:files.get(path)}:{ok:false,errorCode:'NOT_FOUND'},write:async(path,content)=>{files.set(path,content);return {ok:true};}};const raw=JSON.stringify({text:crypto.randomBytes(900000).toString('base64')});await assert.rejects(S.pack(raw,io,{force:true,maxIndexBytes:512}),e=>e.code==='STORAGE_INDEX_LIMIT');assert.equal(files.size,0);const packed=await S.pack(raw,io,{force:true});assert.equal(await S.unpack(packed.content,io),raw);assert.equal(files.size,packed.manifest.chunks.length);
});
