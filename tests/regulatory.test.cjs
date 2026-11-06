'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const R=require('../plugin/regulatory.js'),{host}=require('./helpers/host.cjs');
const at=Date.parse('2026-11-06T10:00:00+08:00'),args={symbol:'sh600900',from:'2026-08-08',to:'2026-11-06'};
const hash=async s=>crypto.createHash('sha256').update(s).digest('hex');
function row(i=1,extra={}){return {stockcode:'600900',channelId:'10010',docId:'offline-'+i,docTitle:'离线监管样例，不是真实市场记录',createTime:'2026-11-02 10:00:00',docURL:'www.sse.com.cn/disclosure/credibility/supervision/measures/other/c/1/test.pdf',...extra};}
function response(rows=[],total=rows.length,page=1,extra={}){return {ok:true,status:200,headers:{'content-type':'application/json'},body:'?('+JSON.stringify({sqlId:'BS_KCB_GGLL_NEW',actionErrors:[],fieldErrors:{},result:rows,pageHelp:{total,pageCount:Math.ceil(total/5),pageNo:page,pageSize:5},...extra})+')'};}
function client(request,clock=()=>at,files=new Map()){return {files,api:R.createClient({request:async url=>{const r=await request(url);return r.transport==='cindy.fetch'?r:{...r,url:r.url||url,transport:r.transport||'node:https-no-redirect',rawSha256:r.rawSha256||await hash(r.body)};},hash,now:clock,read:async p=>files.get(p)??null,write:async(p,s)=>files.set(p,s)})};}
async function nativeResponse(p){const r=response();return {...r,url:R.urlFor(R.scope(p,Date.now()),p.page),transport:'node:https-no-redirect',rawSha256:await hash(r.body)};}
test('fixed official query encodes verified company/category/date/page parameters; JSONP is never evaluated',()=>{
 const s=R.scope(args,at),u=new URL(R.urlFor(s,2));assert.equal(u.origin,'https://query.sse.com.cn');assert.equal(u.pathname,'/commonSoaQuery.do');
 assert.equal(u.searchParams.get('sqlId'),'BS_KCB_GGLL_NEW');assert.equal(u.searchParams.get('stockcode'),'600900');assert.equal(u.searchParams.get('channelId'),'10007,10008,10009,10010');assert.equal(u.searchParams.get('createTime'),'2026-08-08 00:00:00');assert.equal(u.searchParams.get('pageHelp.pageNo'),'2');
 for(const change of [{symbol:'sz000001'},{symbol:'sh900001'},{from:'2026-02-30'},{from:'2026-11-07'},{to:'2026-11-07'},{regulatoryKind:'dynamic'}])assert.throws(()=>R.scope({...args,...change},at));
 assert.throws(()=>R.parse('evil({}); globalThis.bad=true'));assert.throws(()=>R.parse('<html>blocked</html>'));assert.equal(globalThis.bad,undefined);
});
test('complete pagination is bounded, identity checked and retains response hashes; cache is replayed without re-dating',async()=>{
 let calls=0,t=at;const c=client(async url=>{calls++;const n=+new URL(url).searchParams.get('pageHelp.pageNo');return response(n===1?[1,2,3,4,5].map(i=>row(i)):[row(6)],6,n);},()=>t);
 const a=await c.api.query(args);assert.equal(a.complete,true);assert.equal(a.total,6);assert.equal(a.rows.length,6);assert.equal(calls,2);assert.equal(a.bundle.pages[0].sha256,await hash(a.bundle.pages[0].body));
 t+=60000;const b=await c.api.query(args);assert.equal(b.transport,'cache');assert.equal(b.bundle.fetchedAt,at);assert.equal(calls,2);
});
test('empty result is a finite empty dataset, not an automatic risk conclusion',async()=>{
 const c=client(async()=>response());const x=await c.api.query(args);assert.equal(x.complete,true);assert.equal(x.total,0);assert.equal(x.rows.length,0);assert.equal(x.riskConclusion,undefined);
});
test('wrong issuer, channel, date, source URL, duplicate IDs, changed totals and pagination are rejected',async()=>{
 for(const change of [{stockcode:'600519'},{channelId:'999'},{createTime:'2026-08-01 00:00:00'},{createTime:'2026-11-07 00:00:00'},{docURL:'https://evil.example/disclosure/a.pdf'},{docURL:'http://www.sse.com.cn/disclosure/a.pdf'}]){
  await assert.rejects(client(async()=>response([row(1,change)])).api.query(args));
 }
 await assert.rejects(client(async()=>response([row(1),row(1)])).api.query(args),/重复/);
 await assert.rejects(client(async u=>{const page=+new URL(u).searchParams.get('pageHelp.pageNo');return response(page===1?[1,2,3,4,5].map(i=>row(i)):[row(6)],page===1?6:7,page);}).api.query(args),/总数/);
 await assert.rejects(client(async()=>response([],0,2)).api.query(args),/分页/);
 await assert.rejects(client(async()=>({...response(),truncated:true})).api.query(args));
 await assert.rejects(client(async()=>response([],0,1,{actionErrors:['bad']})).api.query(args));
});
test('missing pages and maximum page budget cannot be cached as complete',async()=>{
 const c=client(async u=>{const page=+new URL(u).searchParams.get('pageHelp.pageNo');return response(page===1?[1,2,3,4,5].map(i=>row(i)):[],6,page);});
 const r=await c.api.query(args);assert.equal(r.complete,false);assert.equal(r.usable,false);assert.equal([...c.files.keys()].some(p=>p.includes('/cache/')),false);
 let count=0;const b=client(async u=>{count++;const page=+new URL(u).searchParams.get('pageHelp.pageNo');return response(Array.from({length:5},(_,i)=>row(page*10+i)),105,page);});
 assert.equal((await b.api.query(args)).complete,false);assert.equal(count,20);
});
test('cache integrity, scope, per-response bytes and freshness are rechecked; stale never serves network failure',async()=>{
 let t=at;const c=client(async()=>response(),()=>t);const a=await c.api.query(args),cache=[...c.files.keys()].find(p=>p.includes('/cache/'));
 const original=c.files.get(cache),tamper=JSON.parse(original);tamper.pages[0].body='{}';c.files.set(cache,JSON.stringify(tamper));await assert.rejects(c.api.query({...args,cache:'only'}),{code:'REGULATORY_CACHE_INVALID'});
 c.files.set(cache,original);t+=R.TTL;const b=await c.api.query({...args,cache:'only'});assert.equal(b.fresh,false);assert.equal(b.usable,false);assert.equal(b.bundle.fetchedAt,at);
 const bad=client(async()=>{throw Error('offline');},()=>t,c.files);await assert.rejects(bad.api.query(args),/offline/);
 await assert.rejects(c.api.query({...args,symbol:'sh600519',cache:'only'}),{code:'REGULATORY_CACHE_MISS'});
 const x=JSON.parse(original);x.scope.symbol='sh600519';await assert.rejects(c.api.validate(x,R.scope(args,at)));
 const fresh=client(async()=>{throw Error('offline');},()=>at+1,c.files);assert.equal((await fresh.api.query({...args,cache:'refresh'})).transport,'cache-after-network-error');
 const malformed=client(async()=>response([row(1,{stockcode:'600519'})]),()=>at+1,c.files);await assert.rejects(malformed.api.query({...args,cache:'refresh'}),/公司/);
});
test('host capture supports only live; independent query changes no holdings/plans; reload uses verified cache',async()=>{
 let calls=0;const files=new Map(),options={regulatoryPageHandler:async p=>{calls++;return nativeResponse(p);}},h=host(files,false,false,options);
 const today=new Date(Date.now()+28800000).toISOString().slice(0,10),input={...args,to:today,view:'regulatory'};
 const before=(await h.call('get_state')).result,a=await h.call('stock_detail',input);assert.equal(a.ok,true,JSON.stringify(a));assert.equal(a.result.receipt.complete,true);assert.equal(a.result.saved,false);assert.equal(calls,1);
 const after=(await h.call('get_state')).result;for(const k of ['revision','config','activePlan','pendingActions','latestRun'])assert.deepEqual(after[k],before[k]);
 const again=await host(files,false,false,options).call('stock_detail',{...input,cache:'only',rawPage:1});assert.equal(again.ok,true,JSON.stringify(again));assert.equal(again.result.transport,'cache');assert.ok(again.result.rawPage.body);assert.equal(calls,1);
 const saved=[...files];const sim=await h.call('stock_detail',{...input,mode:'simulation'});assert.equal(sim.errorCode,'LIVE_INFORMATION_ONLY');assert.deepEqual([...files],saved);
});
test('saving a receipt clears old judgments and explicit risk binding must match scope; no review votes are created',async()=>{
 const h=host(new Map(),false,false,{regulatoryPageHandler:nativeResponse}),today=new Date(Date.now()+28800000).toISOString().slice(0,10);
 const config={cash:10000,holdings:[],maxEquityWeight:.6,maxStockWeight:.2,maxIndustryWeight:.3,riskPerStock:.01,horizonDays:30,reviewMinutes:60,trackingEnabled:false};
 await h.call('configure',{requestKey:'cfg',expectedRevision:0,config});const start=await h.call('begin_research',{requestKey:'begin'}),runId=start.result.runId;await h.call('collect_batch',{requestKey:'collect',runId});
 // Fixture run contains sh600001; a wrong issuer response is rejected before any cache is saved.
 const r=await h.call('stock_detail',{view:'regulatory',symbol:'sh600001',from:'2026-08-08',to:today,runId,requestKey:'reg'});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.result.judgmentsCleared,true);
 const q=r.result.receipt,doc='https://static.cninfo.com.cn/finalpage/2026-11-02/test.PDF';
 await h.call('stock_detail',{view:'source',url:doc,runId,requestKey:'risk-doc'});
 const n={category:'risk',symbol:'sh600001',title:'离线范围核对',summary:'离线回执，不代表无风险',url:doc,publishedAt:new Date(q.fetchedAt).toISOString(),contentLevel:'full_text_reviewed',searchScope:q.searchScope,regulatoryReceiptId:q.id};
 const index=await h.call('add_evidence',{requestKey:'index-is-not-body',runId,news:[{...n,url:q.sourceUrl}]});assert.equal(index.errorCode,'INVALID_INFORMATION');
 const missingRecord=await h.call('add_evidence',{requestKey:'fake-record',runId,news:[{...n,regulatoryRecordId:'invented'}]});assert.equal(missingRecord.errorCode,'REGULATORY_SCOPE_MISMATCH');
 const bad=await h.call('add_evidence',{requestKey:'bad',runId,news:[{...n,searchScope:{...q.searchScope,to:new Date(q.fetchedAt-100000).toISOString()}}]});assert.equal(bad.errorCode,'REGULATORY_SCOPE_MISMATCH');
 const good=await h.call('add_evidence',{requestKey:'good',runId,news:[n]});assert.equal(good.ok,true,JSON.stringify(good));assert.equal(good.result.news[0].reviews.length,0);assert.equal(good.result.news[0].regulatoryQuery.id,q.id);assert.equal(good.result.news[0].regulatoryQuery.association,'search-scope-only');
});

test('content addressed cache paths satisfy the installed host 64-character segment limit',()=>{
 for(const path of [R.receiptPath('a'.repeat(64)),R.cachePath('a'.repeat(64))]){
  assert.ok(path.length<=256);assert.ok(path.split('/').every(s=>/^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,63}$/.test(s)));
 }
});

test('native public transport refuses redirects and oversized bodies without browser or credentials',async t=>{
 const https=require('node:https'),{EventEmitter}=require('node:events'),N=require('../plugin/node/regulatory.cjs');
 const today=new Date(Date.now()+28800000).toISOString().slice(0,10),input={...args,to:today,page:1};
 let status=302,oversize=false,destroyed=false,headers;
 t.mock.method(https,'get',(url,opts,callback)=>{
  assert.equal(new URL(url).origin,'https://query.sse.com.cn');headers=opts.headers;
  const req=new EventEmitter();req.setTimeout=()=>req;req.destroy=e=>{destroyed=true;queueMicrotask(()=>req.emit('error',e));};
  queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=status;res.headers={'content-type':'application/json'};res.resume=()=>{};callback(res);if(status===200){res.emit('data',Buffer.alloc(oversize?262145:2,32));if(!oversize)res.emit('end');}});return req;
 });
 const redirected=await N.page(input);assert.equal(redirected.redirected,true);assert.equal(redirected.body,'');assert.equal(headers.Referer,'https://www.sse.com.cn/');assert.equal(headers.Authorization,undefined);
 status=200;oversize=true;await assert.rejects(N.page(input),/256KiB/);assert.equal(destroyed,true);
});
test('unknown redirect provenance, content type and re-signed damaged raw cache are not accepted silently',async()=>{
 await assert.rejects(client(async()=>({...response(),redirected:true})).api.query(args),{code:'REGULATORY_REDIRECT'});
 await assert.rejects(client(async()=>({...response(),headers:{'content-type':'application/octet-stream'}})).api.query(args));
 const c=client(async()=>response());await c.api.query(args);const path=[...c.files.keys()].find(p=>p.includes('/cache/')),b=JSON.parse(c.files.get(path));b.pages[0].body='tampered';delete b.integrity;b.integrity=await hash(JSON.stringify(b));c.files.set(path,JSON.stringify(b));
 await assert.rejects(c.api.query({...args,cache:'only'}),{code:'REGULATORY_CACHE_INVALID'});
});

test('host fallback without final-source provenance stays metadata-only and cannot become current risk scope',async()=>{
 const c=client(async()=>({...response(),transport:'cindy.fetch'}));const r=await c.api.query(args);
 assert.equal(r.complete,true);assert.equal(r.sourceVerified,false);assert.equal(r.usable,false);assert.equal([...c.files.keys()].some(p=>p.includes('/cache/')),false);
 const h=host(new Map(),false,false,{fetchHandler:async()=>response()}),today=new Date(Date.now()+28800000).toISOString().slice(0,10);
 const x=await h.call('stock_detail',{view:'regulatory',...args,to:today});assert.equal(x.ok,true);assert.equal(x.result.receipt.usable,false);assert.equal(x.result.receipt.sourceVerified,false);
});
