'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {host}=require('./helpers/host.cjs');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const key='strict-path-fixture',args={mode:'live',runId:'intent-fixture',requestKey:key,message:'synthetic failure'};
const paths=a=>{const h=hash(a.requestKey),p=a.mode==='simulation'?'simulation/':'';return {canonical:p+'failure-commits/'+h.slice(0,32)+'/'+h.slice(32)+'.json',legacy:p+'failure-commits/'+h+'.json',root:p+'state.json',report:p+'reports/intent-fixture.json'};};
function fixture(options={},mode='live'){
 const state={schema:1,revision:7,config:{cash:100000,holdings:[]},runs:[{id:'intent-fixture',status:'judging',startedAt:1,config:{cash:100000,holdings:[]},sectors:[],stocks:{},judgments:{},news:[]}],reports:[],plans:[],scans:[],actions:[],events:[],requests:{}};
 const prefix=mode==='simulation'?'simulation/':'',files=new Map([[prefix+'state.json',JSON.stringify(state)]]),calls=[],h=host(files,false,false,{strictLibraryPaths:true,libraryCalls:calls,...options});return {files,calls,h,state,prefix};
}
const diagnostic=(h,a=args,rev=7,extra={})=>h.call('plan_control',{mode:a.mode,action:'failure_commit_status',requestKey:'readonly-diagnostic',failureCommit:{runId:a.runId,requestKey:a.requestKey,requestSignature:hash(JSON.stringify(a)),expectedRevision:rev,...extra}});
async function frozen(options={}){
 const f=fixture({failLibraryWrite:p=>p==='reports/intent-fixture.json',...options});assert.equal((await f.h.call('record_failure',args)).ok,false);assert.ok(f.files.has(paths(args).canonical));return f;
}
test('strict Library rejects legacy 69-character read but sharded intent succeeds without changing key',async()=>{
 const f=fixture(),p=paths(args);assert.equal((await f.h.library({op:'read',path:p.legacy})).errorCode,'PATH_INVALID');
 const d=await diagnostic(f.h);assert.equal(d.result.status,'absent_verified');assert.equal(d.result.reads[1].errorCode,'PATH_INVALID');assert.equal(d.result.legacyPresence.status,'absent');assert.equal(f.calls.filter(x=>x.op==='write').length,0);
 const r=await f.h.call('record_failure',args);assert.equal(r.ok,true,JSON.stringify(r));assert.ok(f.files.has(p.canonical));assert.equal(f.files.has(p.legacy),false);
 assert.ok(p.canonical.split('/').every(s=>s.length<=40));assert.equal(JSON.parse(f.files.get(p.root)).requests[key].signature,hash(JSON.stringify(args)));
 const before=[...f.files];assert.deepEqual((await f.h.call('record_failure',args)).result,r.result);assert.deepEqual([...f.files],before);
 assert.equal((await diagnostic(f.h,args,8)).result.status,'already_committed');
});
test('archive/root failure and restart reuse immutable same-key intent and frozen report time',async()=>{
 for(const stage of ['archive','root']){
  const p=paths(args),f=fixture({now:()=>1000000,failLibraryWrite:path=>path===(stage==='archive'?p.report:p.root)}),root=f.files.get(p.root);
  assert.equal((await f.h.call('record_failure',args)).ok,false);assert.equal(f.files.get(p.root),root);const tx=JSON.parse(f.files.get(p.canonical));
  const h=host(f.files,false,false,{strictLibraryPaths:true,now:()=>2000000});const before=[...f.files],d=await diagnostic(h);assert.equal(d.result.status,'intent_verified');assert.equal(d.result.finishedAt,1000000);assert.deepEqual([...f.files],before);
  assert.equal((await h.call('record_failure',args)).ok,true);assert.equal(JSON.parse(f.files.get(p.report)).report.finishedAt,tx.archive.report.finishedAt);
  assert.equal(JSON.parse(f.files.get(p.root)).actions.length,2);
 }
});
test('readable legacy intent is resumed unchanged; identical dual intent is allowed',async()=>{
 for(const both of [false,true]){
  const f=await frozen(),p=paths(args),content=f.files.get(p.canonical);f.files.set(p.legacy,content);if(!both)f.files.delete(p.canonical);
  const h=host(f.files),before=[...f.files],d=await diagnostic(h);assert.equal(d.result.status,'intent_verified');assert.deepEqual([...f.files],before);
  assert.equal((await h.call('record_failure',args)).ok,true);assert.equal(JSON.parse(f.files.get(p.report)).report.finishedAt,JSON.parse(content).archive.report.finishedAt);assert.equal(f.files.get(p.legacy),content);
 }
});
test('unreadable existing legacy file never counts as absence, including when canonical intent exists',async()=>{
 for(const both of [false,true]){const f=await frozen(),p=paths(args);f.files.set(p.legacy,f.files.get(p.canonical));if(!both)f.files.delete(p.canonical);const h=host(f.files,false,false,{strictLibraryPaths:true}),before=[...f.files],d=await diagnostic(h);assert.equal(d.result.status,'blocked');assert.equal(d.result.legacyPresence.status,'present_unreadable');assert.equal((await h.call('record_failure',args)).errorCode,'ARCHIVE_READ');assert.deepEqual([...f.files],before);}
});
test('conflicting dual intents and immutable report refuse overwriting',async()=>{
 for(const kind of ['dual','report']){const f=await frozen(),p=paths(args);if(kind==='dual')f.files.set(p.legacy,JSON.stringify({...JSON.parse(f.files.get(p.canonical)),expectedRevision:6}));else f.files.set(p.report,'{"existing":"keep"}');const h=host(f.files),before=[...f.files],r=await h.call('record_failure',args);assert.equal(r.errorCode,'ARCHIVE_CONFLICT');assert.deepEqual([...f.files],before);}
});
test('malformed, wrong signature/revision/mode/run/path intent fails closed',async()=>{
 for(const kind of ['null','json','signature','revision','mode','run','path']){const f=await frozen(),p=paths(args),tx=JSON.parse(f.files.get(p.canonical));if(kind==='signature')tx.signature='b'.repeat(64);if(kind==='revision')tx.expectedRevision=6;if(kind==='mode')tx.archive.report.mode='simulation';if(kind==='run')tx.archive.run.id='other-run';if(kind==='path')tx.archivePath='reports/other.json';f.files.set(p.canonical,kind==='null'?'null':kind==='json'?'bad-json':JSON.stringify(tx));const h=host(f.files,false,false,{strictLibraryPaths:true}),before=[...f.files];assert.equal((await h.call('record_failure',args)).ok,false,kind);assert.deepEqual([...f.files],before);assert.equal((await diagnostic(h)).result?.status==='absent_verified',false,kind);assert.deepEqual([...f.files],before);}
});
test('unknown reads, malformed/incomplete listing and page cap remain blocked with bounded diagnostics',async()=>{
 for(const kind of ['read','list','incomplete','repeated','cap']){const f=fixture(),p=paths(args);if(kind==='read')f.h=host(f.files,false,false,{strictLibraryPaths:true,failLibraryRead:path=>path===p.canonical});else{
  const pages=kind==='cap'?901:kind==='repeated'?201:1;for(let i=0;i<pages;i++)f.files.set('failure-commits/item'+String(i).padStart(4,'0')+'.json','{}');
  f.h=host(f.files,false,false,{strictLibraryPaths:true,libraryOverride:r=>r.op==='list'?(kind==='list'?{ok:false,errorCode:'FIXTURE_LIST_FAILED',message:'/private/secret'}:kind==='incomplete'?{ok:true,entries:[],hasMore:true}:kind==='repeated'?{ok:true,entries:[],hasMore:true,nextCursor:'same'}:undefined):undefined});
 }
 const before=[...f.files],d=await diagnostic(f.h);assert.equal(d.result.status,'blocked',kind);assert.ok(JSON.stringify(d).length<3000);assert.equal(JSON.stringify(d).includes('/private/secret'),false);assert.equal((await f.h.call('record_failure',args)).ok,false,kind);assert.deepEqual([...f.files],before);
 }
});
test('diagnostic requires exact run, signature and revision; ignores no arbitrary path contract',async()=>{
 const f=fixture(),before=[...f.files];for(const extra of [{runId:'../state'},{expectedRevision:6},{requestSignature:'x'},{path:'state.json'}])assert.equal((await diagnostic(f.h,args,7,extra)).errorCode,'FAILURE_DIAGNOSTIC_INPUT');assert.deepEqual([...f.files],before);
 const done=await f.h.call('record_failure',args);assert.equal(done.ok,true);assert.equal((await diagnostic(f.h,{...args,message:'changed'},8)).errorCode,'REQUEST_CONFLICT');
});
test('same key is independently scoped to live and simulation, never imports another mode intent',async()=>{
 const f=fixture();f.files.set('simulation/state.json',JSON.stringify(f.state));const sim={...args,mode:'simulation'};
 assert.equal((await f.h.call('record_failure',args)).ok,true);const liveRoot=f.files.get('state.json');assert.equal((await diagnostic(f.h,sim)).result.status,'absent_verified');assert.equal((await f.h.call('record_failure',sim)).ok,true);assert.equal(f.files.get('state.json'),liveRoot);assert.ok(f.files.has(paths(sim).canonical));assert.equal(JSON.parse(f.files.get(paths(sim).report)).report.mode,'simulation');
});
test('legacy absence is proven across bounded pages; matching unreadable file on later page blocks',async()=>{
 for(const found of [false,true]){const f=fixture(),p=paths(args);for(let i=0;i<150;i++)f.files.set('failure-commits/000'+String(i).padStart(4,'0')+'.json','{}');if(found)f.files.set(p.legacy,'{}');const before=[...f.files],d=await diagnostic(f.h);assert.equal(d.result.status,found?'blocked':'absent_verified');assert.equal(d.result.legacyPresence.pages,2);assert.deepEqual([...f.files],before);}
});
test('malformed listing paths and field types never prove absence',async()=>{
 for(const entries of [[{kind:'file',path:'elsewhere/item.json'}],[{kind:'file',path:'failure-commits/deep/item.json'}],[{kind:'file',path:'failure-commits/'}],[{kind:'unknown',path:'failure-commits/file.json'}],null]){const f=fixture({libraryOverride:r=>r.op==='list'?{ok:true,entries,hasMore:false,nextCursor:null}:undefined}),before=[...f.files],d=await diagnostic(f.h);assert.equal(d.result.status,'blocked');assert.equal(d.result.blocked.errorCode,'INVALID_LIST_RESPONSE');assert.deepEqual([...f.files],before);}
});
test('duplicate entries within or across pages and malformed basenames cannot prove absence',async()=>{
 for(const name of ['.','..','nul\0file','trailing.','back\\slash']){const f=fixture({libraryOverride:r=>r.op==='list'?{ok:true,entries:[{kind:'file',path:'failure-commits/'+name}],hasMore:false,nextCursor:null}:undefined});const d=await diagnostic(f.h);assert.equal(d.result.status,'blocked');assert.equal(d.result.blocked.errorCode,'INVALID_LIST_RESPONSE');}
 for(const across of [false,true]){let page=0;const entry={kind:'file',path:'failure-commits/repeated.json'},f=fixture({libraryOverride:r=>r.op==='list'?{ok:true,entries:across?[entry]:[entry,entry],hasMore:across&&++page===1,nextCursor:across&&page===1?'next':null}:undefined});const before=[...f.files],d=await diagnostic(f.h);assert.equal(d.result.status,'blocked');assert.equal(d.result.blocked.errorCode,'INCONSISTENT_LIST');assert.deepEqual([...f.files],before);}
});
test('canonical intent contradicts a missing parent directory or a listing omitting its shard',async()=>{
 for(const missing of [false,true]){const f=await frozen(),h=host(f.files,false,false,{strictLibraryPaths:true,libraryOverride:r=>r.op==='list'?(missing?{ok:false,errorCode:'NOT_FOUND'}:{ok:true,entries:[],hasMore:false,nextCursor:null}):undefined}),before=[...f.files],d=await diagnostic(h);assert.equal(d.result.status,'blocked');assert.equal(d.result.blocked.errorCode,'INCONSISTENT_LIST');assert.equal((await h.call('record_failure',args)).errorCode,'ARCHIVE_READ');assert.deepEqual([...f.files],before);}
});
