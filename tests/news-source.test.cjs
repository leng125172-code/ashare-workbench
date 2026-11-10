'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const core=require('../plugin/core.js');
const item={code:'offline-article',title:'<em>离线行业</em>合成资讯',date:'2026-11-09 10:00:00',url:'https://finance.eastmoney.com/a/200001010000000000.html'};
function fixture({fastStatus=200,searchStatus=200,list=[item],searchBody,timeout=false}={}){
 const requests=[];
 const https={get(url,options,callback){
  const u=new URL(url);requests.push({url:u,options});const req=new EventEmitter();let expiry;
  req.setTimeout=(_ms,fn)=>{expiry=fn;return req;};req.destroy=e=>req.emit('error',e);
  queueMicrotask(()=>{
   if(timeout&&u.hostname==='search-api-web.eastmoney.com'){expiry();return;}
   const response=new EventEmitter();response.resume=()=>{};
   const search=u.hostname==='search-api-web.eastmoney.com';response.statusCode=search?searchStatus:u.hostname==='np-listapi.eastmoney.com'?fastStatus:200;callback(response);
   if(response.statusCode!==200)return;
   const data=search?(searchBody??{code:0,result:{cmsArticleWebOld:list}}):u.hostname==='np-listapi.eastmoney.com'?{data:{fastNewsList:[]}}:{result:{data:{feed:{list:[]}}}};
   response.emit('data',Buffer.from(typeof data==='string'?data:JSON.stringify(data)));response.emit('end');
  });return req;
 }};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../plugin/node/market.cjs'),'utf8'),{module,exports:module.exports,require:n=>n==='../clist.js'?require('../plugin/clist.js'):n==='./network.cjs'?require('./helpers/network-fixture.cjs')(https):n==='node:https'?https:n==='../core.js'?core:require(n),Date,Buffer,URL,URLSearchParams,TextDecoder});
 return {market:module.exports,requests};
}
test('specialized search returns dated article metadata and source-specific headers',async()=>{
 const f=fixture(),r=await f.market.news('离线行业'),s=r.rows.find(x=>x.source==='eastmoney-search');
 assert.equal(s.title,'离线行业 合成资讯');assert.equal(s.keyword,'离线行业');assert.equal(s.contentLevel,'metadata');assert.equal(s.publishedMs,Date.parse('2026-11-09T10:00:00+08:00'));assert.equal(r.coverage.specialized,'available');
 assert.equal(f.requests.find(x=>x.url.hostname==='search-api-web.eastmoney.com').options.headers.Referer,'https://so.eastmoney.com/');assert.equal(f.requests.length,3);
 const request=f.requests.find(x=>x.url.hostname==='search-api-web.eastmoney.com').url;
 assert.equal(request.searchParams.get('cb'),'jQueryAShareNews');const spec=JSON.parse(request.searchParams.get('param')).param.cmsArticleWebOld;
 assert.equal(spec.preTag,'<em>');assert.equal(spec.postTag,'</em>');assert.equal(spec.sort,'time');assert.equal(spec.pageSize,8);assert.equal(r.diagnostics.search.complete,false);assert.equal(s.relationVerified,false);
});
test('failed broad feed is not mistaken for failed specialized search',async()=>{
 const {market}=fixture({fastStatus:567}),r=await market.news('离线行业');assert.equal(r.coverage.market,'partial');assert.equal(r.coverage.specialized,'available');assert.equal(r.diagnostics.sources.find(x=>x.source==='eastmoney').statusCode,567);assert.ok(r.warnings.some(x=>x.includes('567')));
});
test('HTTP search rejection preserves failure code and cannot mean no related news',async()=>{
 const f=fixture({searchStatus:400}),r=await f.market.news('离线行业');assert.equal(r.coverage.specialized,'unavailable');const s=r.diagnostics.sources.find(x=>x.scope==='keyword');assert.equal(s.status,'failed');assert.equal(s.statusCode,400);assert.equal(s.errorCode,'HTTP_STATUS_ERROR');assert.ok(r.warnings.some(x=>x.includes('不将失败解释')));assert.equal(f.requests.length,3);
});
test('legitimate empty search result is distinct from unavailable search',async()=>{
 const {market}=fixture({list:[]}),r=await market.news('不存在的离线名称');assert.equal(r.coverage.specialized,'empty');assert.equal(r.diagnostics.sources.find(x=>x.scope==='keyword').status,'empty');assert.ok(!r.warnings.some(x=>x.includes('获取失败')));
});
test('malformed or blocked search responses fail closed',async()=>{
 for(const searchBody of ['<html>unavailable</html>',{code:400,result:null},{result:{cmsArticleWebOld:{not:'a list'}}}]){
  const {market}=fixture({searchBody}),r=await market.news('离线行业');assert.equal(r.coverage.specialized,'unavailable');assert.equal(r.rows.length,0);assert.ok(r.warnings.length);
 }
});
test('a search timeout has explicit diagnosis and market results remain separate',async()=>{
 const {market}=fixture({timeout:true}),r=await market.news('离线行业');assert.equal(r.coverage.specialized,'unavailable');assert.equal(r.diagnostics.sources.find(x=>x.scope==='keyword').errorCode,'DATA_SOURCE_TIMEOUT');assert.equal(r.coverage.market,'available');
});
test('market-only query does not fabricate specialized coverage or issue a keyword request',async()=>{
 const f=fixture(),r=await f.market.news();assert.equal(r.coverage.specialized,'not_requested');assert.equal(f.requests.length,2);await assert.rejects(f.market.news('x'.repeat(101)),/100/);assert.equal(f.requests.length,2);
});
test('valid JSONP is parsed without executing its callback',async()=>{
 const {market}=fixture({searchBody:'jQueryAShareNews('+JSON.stringify({code:0,result:{cmsArticleWebOld:[item]}})+');'}),r=await market.news('离线行业');assert.equal(r.coverage.specialized,'available');assert.equal(r.rows.length,1);
});
test('invalid article identities and conflicting totals cannot manufacture usable results',async()=>{
 for(const list of [[{...item,url:'javascript:alert(1)'}],[{...item,date:'not-a-date'}],[{...item,url:'https://outside.invalid/article'}]]){
  const {market}=fixture({list}),r=await market.news('离线行业');assert.equal(r.coverage.specialized,'unavailable');assert.equal(r.rows.length,0);
 }
 const {market}=fixture({searchBody:{code:0,hitsTotal:5,result:{cmsArticleWebOld:[]}}});assert.equal((await market.news('离线行业')).coverage.specialized,'unavailable');
});
test('missing or nonnumeric provider totals stay unknown rather than zero',async()=>{
 for(const hitsTotal of [null,undefined,'',true,'unknown']){
  const {market}=fixture({searchBody:{code:0,hitsTotal,result:{cmsArticleWebOld:[item]}}});const r=await market.news('离线行业');assert.equal(r.diagnostics.search.reportedHits,null);
 }
});
