'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),P=require('../plugin/paper.js'),{host}=require('./helpers/host.cjs');
const at=s=>Date.parse(s+'+08:00'),start=at('2026-11-02T09:00:00'),day1=at('2026-11-02T10:00:00'),day2=at('2026-11-03T10:00:00');
const feeModel={assumptionLabel:'纯合成费用例子，非券商费率',commissionRate:.001,buyTaxRate:0,sellTaxRate:.001,transferFeeRate:0,minCommission:5,slippageBps:100};
const setup={ledgerId:'paper-cost-test',label:'手算模拟账本',initialCash:10000,at:start,dataKind:'synthetic',feeModel};
const quote=(price,t,symbol)=>({symbol:symbol||'sh600001',name:'普通合成股',price,asOf:t,source:'synthetic-fixture',dataKind:'synthetic',priceBasis:'unadjusted'});
function trade(a,side,price,t,quantity=100){return P.trade(a,{expectedVersion:a.version,symbol:'sh600001',side,quantity,at:t,quote:quote(price,t),note:'明确提交的模拟成交'});}
test('paper roundtrip matches hand calculation including minimum fees, sell tax and adverse slippage once',()=>{
 const initial=P.setup(setup),b=trade(initial,'buy',10,day1);assert.equal(initial.trades.length,0);assert.equal(b.event.executionPrice,10.1);assert.equal(b.account.cashCents,898500);assert.equal(b.account.positions[0].bookCostCents,101500);
 const marked=P.mark(b.account,{expectedVersion:b.account.version,at:day1+60000,quotes:[quote(10,day1+60000,'sh600001')]});assert.equal(marked.valuation.totalPnl,-15);assert.equal(marked.valuation.unrealizedPnl,-15);assert.equal(marked.valuation.realizedPnl,0);
 const s=trade(marked.account,'sell',11,day2),final=P.mark(s.account,{expectedVersion:s.account.version,at:day2+60000,quotes:[]});
 assert.equal(s.event.executionPrice,10.89);assert.equal(s.event.fees,6.09);assert.equal(final.valuation.equity,10067.91);assert.equal(final.valuation.totalPnl,67.91);assert.equal(final.valuation.realizedPnl,67.91);assert.equal(final.valuation.unrealizedPnl,0);assert.equal(final.valuation.totalFees,11.09);assert.equal(final.valuation.slippageCost,21);assert.equal(final.valuation.totalPnl,100-final.valuation.totalFees-final.valuation.slippageCost);
 assert.equal(final.valuation.maxDrawdown,.0015);assert.match(P.markdown(final.account),/非券商实际收费/);
});
test('T+1 uses lots for sellability and weighted average costs for partial realized PnL',()=>{
 let a=P.setup({...setup,feeModel:{...feeModel,slippageBps:0,sellTaxRate:0}});a=trade(a,'buy',10,day1).account;
 assert.throws(()=>trade(a,'sell',12,day1+60000),{code:'PAPER_T1'});a=trade(a,'buy',20,day2).account;
 const sold=trade(a,'sell',30,day2+60000);assert.equal(sold.event.realizedPnl,1490);assert.equal(sold.account.positions[0].bookCostCents,150500);assert.equal(sold.account.positions[0].lots[0].date,'2026-11-03');
 assert.throws(()=>trade(sold.account,'sell',30,day2+120000),{code:'PAPER_T1'});
 const v=P.mark(sold.account,{expectedVersion:sold.account.version,at:day2+180000,quotes:[quote(20,day2+180000,'sh600001')]}).valuation;
 assert.equal(v.unrealizedPnl,495);assert.equal(v.totalPnl,1985);assert.equal(v.totalPnl,v.realizedPnl+v.unrealizedPnl);
});
test('cash, lot size, risk names, calendar and short sales reject unsupported fills atomically',()=>{
 const a=P.setup(setup),before=JSON.stringify(a);
 assert.throws(()=>trade(P.setup({...setup,initialCash:1000}),'buy',10,day1),{code:'PAPER_CASH'});
 assert.throws(()=>trade(a,'buy',10,day1,101),{code:'PAPER_LOT'});assert.throws(()=>trade(a,'sell',10,day1),{code:'PAPER_OVERSELL'});
 assert.throws(()=>trade(a,'buy',10,at('2026-11-07T10:00:00')));assert.throws(()=>trade(a,'buy',10,at('2026-11-02T12:00:00')),{code:'PAPER_SESSION'});
 assert.throws(()=>P.trade(a,{expectedVersion:1,at:day1,symbol:'sh688001',side:'buy',quantity:100,quote:quote(10,day1),note:'模拟'}),{code:'PAPER_UNSUPPORTED'});
 assert.throws(()=>P.trade(a,{expectedVersion:1,at:day1,symbol:'sh600001',side:'buy',quantity:100,quote:{...quote(10,day1),name:'*ST合成'},note:'模拟'}),{code:'RISK_NAME_BLOCKED'});
 assert.equal(JSON.stringify(a),before);
});
test('provenance, chronology and mark completeness cannot invent current equity',()=>{
 let a=trade(P.setup(setup),'buy',10,day1).account;assert.equal(P.view(a).currentValuation,null);assert.equal(P.view(a).needsValuation,true);
 assert.throws(()=>P.mark(a,{expectedVersion:a.version,at:day1+60000,quotes:[]}),{code:'PAPER_MARK_INCOMPLETE'});
 for(const override of [{symbol:'sh600002'},{dataKind:'observed_manual'},{priceBasis:'qfq'},{asOf:day1+120000},{asOf:day1-8*86400000}])assert.throws(()=>P.mark(a,{expectedVersion:a.version,at:day1+60000,quotes:[{...quote(11,day1+60000,'sh600001'),...override}]}));
 a=P.mark(a,{expectedVersion:a.version,at:day1+60000,quotes:[quote(11,day1+60000,'sh600001')]}).account;
 const aged=P.mark(a,{expectedVersion:a.version,at:day2,quotes:[quote(11,day1+60000,'sh600001')]});assert.equal(aged.valuation.hasAgedQuotes,true);assert.equal(aged.valuation.oldestQuoteAt,day1+60000);
 assert.throws(()=>P.mark(a,{expectedVersion:a.version,at:day1+60000,quotes:[quote(12,day1+60000,'sh600001')]}),{code:'PAPER_TIME'});
 assert.throws(()=>P.mark(a,{expectedVersion:a.version,at:day1+120000,quotes:[quote(10,day1,'sh600001')]}),{code:'PAPER_QUOTE_TIME'});
 assert.throws(()=>P.trade(a,{expectedVersion:a.version,at:day2,symbol:'sh600001',side:'sell',quantity:100,quote:quote(10,day2,'sh600002'),note:'错配报价'}),{code:'PAPER_QUOTE_SYMBOL'});
 assert.throws(()=>trade(a,'sell',11,day1),{code:'PAPER_TIME'});assert.throws(()=>P.setup({...setup,feeModel:{...feeModel,commissionRate:undefined}}),{code:'PAPER_FEES'});
});
test('native handler paper state is isolated, durable and idempotent; suggestions stay separate',async()=>{
 const h=host();await h.call('get_state');await new Promise(r=>setTimeout(r,0));const before=(await h.call('get_state')).result,monitor=h.monitor.length;
 const call=(action,paper,key)=>h.call('plan_control',{mode:'simulation',action,paper,requestKey:key});
 assert.equal((await h.call('plan_control',{action:'paper_setup',paper:setup,requestKey:'live-forbidden'})).errorCode,'SIMULATION_ONLY');
 const init=await call('paper_setup',setup,'paper-create');assert.equal(init.ok,true);assert.equal(init.result.ledger.version,1);
 const args={ledgerId:setup.ledgerId,expectedVersion:1,side:'buy',symbol:'sh600001',quantity:100,at:day1,quote:quote(10,day1),note:'纯合成验收成交'};
 const first=await call('paper_trade',args,'paper-buy');assert.equal(first.ok,true);assert.deepEqual((await call('paper_trade',args,'paper-buy')).result,first.result);
 assert.equal((await call('paper_trade',{...args,quantity:200},'paper-buy')).errorCode,'REQUEST_CONFLICT');assert.equal((await call('paper_trade',args,'paper-buy-other-key')).errorCode,'PAPER_VERSION');
 assert.equal((await call('paper_setup',setup,'paper-overwrite')).errorCode,'PAPER_EXISTS');
 const sim=(await h.call('get_state',{mode:'simulation'})).result;assert.equal(sim.config,null);assert.equal(sim.activePlan,null);assert.equal(sim.reports.length,0);assert.equal(sim.pendingActions.length,0);
 const reboot=host(h.files),restored=await reboot.call('plan_control',{mode:'simulation',action:'paper_get',requestKey:'paper-read',paper:{ledgerId:setup.ledgerId}});assert.equal(restored.result.tradeCount,1);assert.equal(restored.result.cash,8985);
 const exported=await reboot.call('export_report',{mode:'simulation',format:'paper_markdown',ledgerId:setup.ledgerId});assert.equal(exported.ok,true);assert.match(reboot.exported.get(exported.result.relativePath),/当前权益\/净收益未计算/);
 assert.deepEqual((await h.call('get_state')).result,before);assert.equal(h.monitor.length,monitor);
});
