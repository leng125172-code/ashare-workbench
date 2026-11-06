'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),E=require('../plugin/execution.js'),N=require('../plugin/node/execution.cjs');
const at=Date.parse('2026-11-04T10:00:00+08:00'),fee={assumptionLabel:'纯技术测试费率，不代表实际券商',commissionRate:.0003,buyTaxRate:0,sellTaxRate:.0005,transferFeeRate:.00001,minCommission:5};
function snapshot(symbol='sh600519'){return {symbol,fetchedAt:at,priceBasis:'unadjusted',identity:{symbol,name:'普通A股技术样例',category:'A股',fetchedAt:at},quote:{symbol,name:'普通A股技术样例',price:10,asOf:at,amount:10000000},limits:{upper:11,lower:9,date:'2026-11-04',asOf:at,secondaryAsOf:at,sources:['offline-a','offline-b'],verifiedAcrossSources:true},book:{bid:9.99,ask:10},tradingStatus:{value:'normal',authoritative:true,source:'offline-status-fixture',asOf:at}};}
const order={side:'buy',quantity:100,limitPrice:10,cash:1000000,permissionsAsOf:at,permissionsSource:'explicit-offline-test',permissions:['main_sh','main_sz','star','chinext','bse'],feeModel:fee};
const codes=x=>[...x.issues,...x.unknown].map(x=>x.code);
test('ordinary A-share board rules exclude B/ETF/index/CDR and never infer permission from capital',()=>{
 for(const s of ['sh600519','sz000001','sh688981','sz300750','bj920001'])assert.ok(E.board(s));
 for(const s of ['sh900901','sz200002','sh510300','sh000300','sh689009','sh113001','hk00700'])assert.equal(E.board(s),null);
 let r=E.evaluate(snapshot(),order,at);assert.equal(r.status,'checks_passed');assert.equal(r.canAssumeFill,false);
 assert.ok(codes(E.evaluate(snapshot(),{...order,permissions:[]},at)).includes('BOARD_ACCESS_UNCONFIRMED'));
 const wrong=snapshot();wrong.identity.category='CDR';assert.ok(codes(E.evaluate(wrong,order,at)).includes('A_SHARE_IDENTITY_UNKNOWN'));
});
test('buy lots use board-specific minimum and increment; sellability/tick/cash include fees',()=>{
 assert.ok(codes(E.evaluate(snapshot(),{...order,quantity:101},at)).includes('BUY_LOT_INVALID'));
 assert.ok(codes(E.evaluate(snapshot('sh688981'),order,at)).includes('BUY_LOT_INVALID'));
 assert.equal(E.evaluate(snapshot('sh688981'),{...order,quantity:201},at).status,'checks_passed');
 assert.equal(E.evaluate(snapshot('bj920001'),{...order,quantity:101},at).status,'checks_passed');
 assert.ok(codes(E.evaluate(snapshot('sz300750'),{...order,quantity:101},at)).includes('BUY_LOT_INVALID'));
 const cash=E.evaluate(snapshot(),{...order,cash:1000},at);assert.ok(codes(cash).includes('CASH_INSUFFICIENT'));assert.equal(cash.estimate.cashRequired,1005.01);
 assert.ok(codes(E.evaluate(snapshot(),{...order,limitPrice:10.001},at)).includes('PRICE_TICK_INVALID'));
 const sell={...order,side:'sell',holdingLots:[{date:'2026-11-04',quantity:100}],positionQuantity:100,sellableQuantity:0,sellableAsOf:at};assert.ok(codes(E.evaluate(snapshot(),sell,at)).includes('OVERSELL_OR_T1'));
 const odd={...sell,quantity:51,positionQuantity:51,sellableQuantity:51,holdingLots:[{date:'2026-11-03',quantity:51}]};assert.equal(E.evaluate(snapshot(),odd,at).status,'checks_passed');assert.ok(codes(E.evaluate(snapshot(),{...odd,quantity:50},at)).includes('ODD_LOT_PARTIAL'));
});
test('halt, missing contract, stale/previous-session quotes, price limits and liquidity cannot imply fills',()=>{
 const unknown=snapshot();unknown.tradingStatus={value:'unknown',authoritative:false};assert.equal(E.evaluate(unknown,order,at).status,'unverified');
 const halted=snapshot();halted.tradingStatus.value='halted';assert.ok(codes(E.evaluate(halted,order,at)).includes('NOT_NORMAL_TRADING'));
 const stale=snapshot();stale.quote.asOf=at-121000;assert.ok(codes(E.evaluate(stale,order,at)).includes('QUOTE_NOT_CURRENT'));
 const missing=snapshot();missing.limits.verifiedAcrossSources=false;assert.ok(codes(E.evaluate(missing,order,at)).includes('LIMITS_UNCONFIRMED'));
 const limit=snapshot();limit.quote.price=11;assert.ok(codes(E.evaluate(limit,order,at)).includes('AT_UPPER_LIMIT'));
 assert.ok(codes(E.evaluate(snapshot(),{...order,limitPrice:11.01},at)).includes('PRICE_OUTSIDE_LIMIT'));
 assert.ok(codes(E.evaluate(snapshot(),{...order,maxDayAmountParticipation:.000001},at)).includes('LIQUIDITY_TEST_LIMIT'));
 assert.ok(codes(E.evaluate(snapshot(),order,Date.parse('2026-11-04T14:58:00+08:00'))).includes('SESSION_NOT_SUPPORTED'));
});
test('market collector checks exact identity and dual-source limits; status remains unknown',async()=>{
 const M={quotes:async()=>({sh600519:{price:10,upperLimit:11,lowerLimit:9,bid1:9.99,ask1:10,asOf:at}}),json:async()=>({data:{f57:'600519',f43:10,f51:11,f52:9,f86:at/1000}})},I={instrument:async symbol=>({symbol,category:'A股'})};
 let s=await N.createClient(M,I).snapshot('sh600519');assert.equal(s.limits.verifiedAcrossSources,true);assert.equal(s.tradingStatus.value,'unknown');assert.equal(s.book.bid,9.99);
 M.json=async()=>({data:{f57:'000001',f51:11,f52:9,f86:at/1000}});s=await N.createClient(M,I).snapshot('sh600519');assert.equal(s.limits.verifiedAcrossSources,false);
});
