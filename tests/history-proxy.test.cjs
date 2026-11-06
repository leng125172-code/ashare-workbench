'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),R=require('../scripts/index-proxy.cjs');
const bar=(date,open,close)=>({date,open,close,high:Math.max(open,close)+1,low:Math.min(open,close)-1});
const bars=[bar('2026-01-05',100,100),bar('2026-01-06',100,100),bar('2026-01-07',100,120),bar('2026-01-08',120,80),bar('2026-01-09',60,66)];
const options={start:'2026-01-08',end:'2026-01-09',fast:2,slow:3,targetWeight:.6,costBps:0};
test('history proxy uses only prior completed closes and retains old exposure through overnight gaps',()=>{
 const r=R.evaluate(bars,options);assert.equal(r.curve[0].signalDate,'2026-01-07');assert.equal(r.curve[0].signalLong,true);assert.equal(r.curve[0].targetWeight,.6);assert.ok(Math.abs(r.curve[0].equity-.8)<1e-12);
 assert.equal(r.curve[1].targetWeight,0);assert.ok(Math.abs(r.curve[1].equity-.7)<1e-12);assert.ok(Math.abs(r.curve[1].overnightReturn+.125)<1e-12);
 const changed=bars.map(x=>({...x}));changed[3]=bar('2026-01-08',120,140);const altered=R.evaluate(changed,options);assert.equal(altered.curve[0].targetWeight,r.curve[0].targetWeight);assert.equal(altered.curve[1].targetWeight,.6);
});
test('costs solve self-financing weights and apply to benchmark entry and hypothetical exit',()=>{
 const b=R.rebalance(1,0,100,.6,.001);assert.ok(Math.abs(b.fee-.0006/1.0006)<1e-12);assert.ok(Math.abs(b.fee-.001*b.notional)<1e-12);assert.ok(Math.abs(b.units*100/b.after-.6)<1e-12);
 const flat=[bar('2026-01-05',100,100),bar('2026-01-06',100,100)];const r=R.evaluate(flat,{start:'2026-01-05',end:'2026-01-06',method:'constant',targetWeight:1,costBps:10});assert.ok(Math.abs(r.netReturnMarked-(1/1.001-1))<1e-12);assert.ok(Math.abs(r.netReturnAfterHypotheticalExit-(.999/1.001-1))<1e-12);assert.equal(r.rebalanceTrades,1);
});
test('cash benchmark stays flat and each window starts with cash while retaining prior signal warm-up',()=>{
 const zero=R.evaluate(bars,{...options,method:'constant',targetWeight:0,costBps:30});assert.equal(zero.netReturnMarked,0);assert.equal(zero.totalFrictionOnInitialNAV,0);assert.equal(zero.closeMaxDrawdown,0);
 assert.throws(()=>R.evaluate(bars,{...options,start:'2026-01-05'}),/warm-up/);const r=R.evaluate(bars,options);assert.equal(r.curve[0].priorEquity,1);assert.equal(r.curve[0].overnightReturn,0);
});
test('invalid, missing, duplicated or unordered prices fail without compressing a bad history',()=>{
 assert.throws(()=>R.validateBars([...bars,bars[0]]),/session/);assert.throws(()=>R.validateBars([bar('2026-01-05',100,100),bar('2026-02-05',100,100)]),/gap/);
 assert.throws(()=>R.validateBars([{...bars[0],open:null}]),/OHLC/);assert.throws(()=>R.validateBars([{...bars[0],date:'2026-02-30'}]),/session/);assert.throws(()=>R.evaluate(bars,{...options,end:'2027-01-01'}),/coverage/);
});
