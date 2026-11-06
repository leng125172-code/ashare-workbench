'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),F=require('../plugin/forward.js');
const t0=Date.parse('2026-11-02T16:00:00+08:00'),t1=Date.parse('2026-11-03T16:00:00+08:00');
const q=(symbol,price,at)=>({symbol,price,asOf:at,priceBasis:'unadjusted',source:'offline-market-fixture'});
function setup(){return F.setup({journalId:'offline_forward',label:'明确的离线技术样例',initialCash:1000000,currency:'CNY',purpose:'technical_only',at:t0,symbols:['sh600519','sz000001'],identities:['sh600519','sz000001'].map(symbol=>({symbol,category:'A股',fetchedAt:t0})),quotes:{sh600519:q('sh600519',10,t0),sz000001:q('sz000001',20,t0)},benchmarkQuote:q('sh000300',100,t0)});}
test('frozen cash-only protocol is immutable and price moves are never portfolio profits',()=>{
 const j=setup(),raw=JSON.stringify(j),next=F.append(j,{expectedVersion:1,at:t1,quotes:{sh600519:q('sh600519',11,t1),sz000001:q('sz000001',18,t1)},benchmarkQuote:q('sh000300',110,t1)}).journal,v=F.view(next);
 assert.equal(JSON.stringify(j),raw);assert.equal(v.cashEquity,1000000);assert.equal(v.portfolioPnl,0);assert.equal(v.tradeCount,0);assert.equal(v.newCompletedSessionCount,1);assert.ok(Math.abs(v.marketReferenceReturn-.1)<1e-12);assert.ok(Math.abs(v.samplePriceChanges[0].rawPriceReturn-.1)<1e-12);assert.equal(v.evaluationStatus,'awaiting_future_sessions');
 next.protocol.universe.push('sh600036');assert.throws(()=>F.view(next),{code:'FORWARD_FROZEN_CHANGED'});
});
test('missing observations are retained and cannot silently turn into zero or survivors',()=>{
 const j=setup(),missing=F.append(j,{expectedVersion:1,at:t1,quotes:{sh600519:q('sh600519',11,t1)},benchmarkQuote:q('sh000300',110,t1)}).journal;
 let v=F.view(missing);assert.equal(v.unknownAttemptCount,1);assert.equal(v.samplePriceChanges[1].rawPriceReturn,null);assert.equal(v.newCompletedSessionCount,0);
 const fixed=F.append(missing,{expectedVersion:2,at:t1+60000,quotes:{sh600519:q('sh600519',11,t1),sz000001:q('sz000001',20,t1)},benchmarkQuote:q('sh000300',110,t1)}).journal;
 v=F.view(fixed);assert.equal(v.unknownAttemptCount,1);assert.equal(v.newCompletedSessionCount,1);assert.equal(v.observations.length,3);assert.equal(F.append(fixed,{expectedVersion:3,at:t1+120000}).alreadyObserved,true);
});
test('no personal risk config or future market time is fabricated; bad base and versions fail',()=>{
 const j=setup();assert.equal(j.protocol.riskConfigStatus,'not_provided_technical_only');assert.deepEqual(j.protocol.holdings,[]);
 assert.throws(()=>F.append(j,{expectedVersion:0,at:t1}),{code:'FORWARD_VERSION'});
 assert.throws(()=>F.append(j,{expectedVersion:1,at:t0-1}),{code:'FORWARD_TIME'});
 assert.throws(()=>F.setup({journalId:'no_personal',initialCash:500000,purpose:'technical_only',currency:'CNY'}),{code:'FORWARD_SCOPE'});
 const future=F.append(j,{expectedVersion:1,at:t1,quotes:{sh600519:q('sh600519',11,t1+1),sz000001:q('sz000001',20,t1)},benchmarkQuote:q('sh000300',110,t1)}).journal;assert.equal(F.view(future).samplePriceChanges[0].status,'unknown');
 assert.match(F.markdown(j),/不是策略盈亏/);
});
