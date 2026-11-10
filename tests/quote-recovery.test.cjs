'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {EventEmitter}=require('node:events'),C=require('../plugin/core.js');
const at=Date.parse('2026-11-06T10:00:00+08:00');
function fixture({stamp='20261106100000',failure=false}={}){
 let requests=0;const fields=Array(62).fill('');Object.assign(fields,{1:'离线样本',3:'10',30:stamp});
 const https={get(url,opts,cb){const req=new EventEmitter();req.setTimeout=()=>req;req.destroy=e=>req.emit('error',e);queueMicrotask(()=>{
  const res=new EventEmitter();res.resume=()=>{};const quote=String(url).includes('qt.gtimg.cn');if(quote)requests++;
  res.statusCode=quote&&failure?503:200;cb(res);
  if(res.statusCode===200){res.emit('data',Buffer.from(quote?`v_sz002001="${fields.join('~')}";`:JSON.stringify({rc:0,data:{klines:Array.from({length:100},()=> '2026-11-05,10,10,11,9,1000,10000')}})));res.emit('end');}
 });return req;}};
 const module={exports:{}};class Clock extends Date{static now(){return at;}}
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../plugin/node/market.cjs'),'utf8'),{module,exports:module.exports,require:n=>n==='../clist.js'?require('../plugin/clist.js'):n==='../kline.js'?require('../plugin/kline.js'):n==='./network.cjs'?require('./helpers/network-fixture.cjs')(https):n==='node:https'?https:n==='../core.js'?C:require(n),Date:Clock,Buffer,URL,URLSearchParams,TextDecoder});
 return {M:module.exports,count:()=>requests};
}
const input=()=>[{symbol:'sz002001',name:'离线样本',quote:{price:null,source:'eastmoney'}}];
test('missing primary price uses a valid individually identified backup quote with provenance and warning',async()=>{const {M,count}=fixture();const [s]=await M.assess(input());assert.equal(count(),1);assert.equal(s.quote.price,10);assert.equal(s.quote.source,'tencent');assert.equal(s.quoteDiagnostics.reason,'backup_quote_recovered');assert.equal(s.quoteDiagnostics.suspensionInferred,false);assert.ok(s.warnings.length);});
test('stale fallback remains dated reference, never fills current quote',async()=>{const {M}=fixture({stamp:'20261102150000'});const [s]=await M.assess(input());assert.equal(s.quote.price,null);assert.equal(s.lastKnownQuote.price,10);assert.equal(s.lastKnownQuote.usage,'dated_reference_only');assert.equal(s.quoteDiagnostics.reason,'backup_quote_stale_or_invalid');});
test('backup failure retains missing value and explicit diagnosis without claiming suspension',async()=>{const {M}=fixture({failure:true});const [s]=await M.assess(input());assert.equal(s.quote.price,null);assert.equal(s.quoteDiagnostics.reason,'backup_source_failed');assert.equal(s.quoteDiagnostics.suspensionInferred,false);});
test('healthy batch does not add backup network calls',async()=>{const {M,count}=fixture();await M.assess([{...input()[0],quote:{price:10,asOf:at}}]);assert.equal(count(),0);});

test('stale primary price is segregated as dated reference and triggers backup even when nonzero',async()=>{
 const {M,count}=fixture({failure:true});const [s]=await M.assess([{...input()[0],quote:{price:9,asOf:at-86400000,source:'primary'}}]);assert.equal(count(),1);assert.equal(s.quote.price,null);assert.equal(s.lastKnownQuote.price,9);assert.equal(s.lastKnownQuote.usage,'dated_reference_only');
});
