'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),F=require('../plugin/performance.js'),{host}=require('./helpers/host.cjs');
const t=Date.parse('2026-11-04T10:00:00+08:00'),fee={assumptionLabel:'离线测试非真实费率',commissionRate:.001,buyTaxRate:0,sellTaxRate:.0005,transferFeeRate:0,minCommission:5,slippageBps:10};
const quote=(symbol,price,at)=>({symbol,name:'普通离线样例',price,asOf:at,source:'offline-fixture',dataKind:'observed_manual',priceBasis:'unadjusted'});
const advice={id:'frozen_advice',finishedAt:t-1,status:'completed',adviceSha256:'a'.repeat(64),allocation:{equity:10000,positions:[{symbol:'sh600001',weight:.2}]}};
function setup(){return F.setup({ledgerId:'performance_fixture',label:'离线效果验收',initialCash:10000,at:t,dataKind:'observed_manual',feeModel:fee,benchmarkCostBps:10,benchmarkQuote:quote('sh000300',100,t)},advice);}
test('no advice/trades is not profitability, frozen setup cannot backfill or change capital',()=>{
 const j=setup();assert.equal(F.view(j).performance,null);assert.equal(F.view(j).status,'no_model_trades_not_strategy_results');
 assert.throws(()=>F.setup({initialCash:10000},null),{code:'PERFORMANCE_ADVICE'});assert.throws(()=>F.setup({initialCash:999},advice),{code:'PERFORMANCE_CAPITAL'});
 assert.throws(()=>F.trade(j,{symbol:'sh600999',at:t+1}),{code:'PERFORMANCE_TRADE'});assert.equal(j.account.trades.length,0);
});
test('net costs, slippage and drawdown remain in portfolio; benchmark exposure uses previous checkpoint, not future price',()=>{
 let j=setup();j=F.trade(j,{at:t+1000,symbol:'sh600001',side:'buy',quantity:100,quote:quote('sh600001',10,t+1000),note:'明确模拟成交'});assert.equal(F.view(j).performance,null);
 j=F.mark(j,{at:t+2000,quotes:[quote('sh600001',10,t+2000)],benchmarkQuote:quote('sh000300',100,t+2000)});
 assert.equal(j.account.trades[0].relatedReportId,advice.id);assert.equal(j.observations[1].benchmarkFee,1); // target approximately10%, 10bp cost
 const previous=structuredClone(j),prev=j.observations.at(-1),price=110;
 j=F.mark(j,{at:t+60000,quotes:[quote('sh600001',9,t+60000)],benchmarkQuote:quote('sh000300',price,t+60000)});
 const v=F.view(j);assert.ok(v.performance.netPnl< -100);assert.equal(v.performance.totalFees,5);assert.equal(v.performance.slippageAlreadyIncluded,1);assert.ok(v.performance.maxDrawdown>0);assert.ok(v.performance.benchmarkNetReturn>0);
 const gross=prev.benchmarkEquity*(1-prev.benchmarkWeight+prev.benchmarkWeight*1.1);assert.ok(Math.abs(gross-j.observations.at(-1).benchmarkEquity-j.observations.at(-1).benchmarkFee)<.02);assert.equal(previous.version,3);
 const raw=JSON.stringify(j);assert.throws(()=>F.mark(j,{at:t+120000,quotes:[],benchmarkQuote:quote('sh000300',110,t+120000)}));assert.equal(JSON.stringify(j),raw);
 assert.throws(()=>F.mark(j,{at:t+120000,quotes:[quote('sh600001',9,t+120000)],benchmarkQuote:quote('sh000300',110,t+60000)}),{code:'PERFORMANCE_TIME'});
});
test('archive and performance directories are empty on existing technical state; read cannot invent advice',async()=>{
 const h=host();const r=await perf(h,{action:'list'});assert.deepEqual(r.result.advice,[]);assert.deepEqual(r.result.evaluations,[]);
 assert.equal((await perf(h,{action:'setup',requestKey:'no-fake',reportId:'nonexistent',ledgerId:'no_fake',parameters:{}})).errorCode,'ADVICE_NOT_FROZEN');
 assert.equal((await h.call('get_state')).result.config,null);
});

function perf(h,a){const {action,requestKey,mode,...performance}=a;return h.call('plan_control',{action:'performance_'+action,requestKey,mode,performance});}
