'use strict';
// A research-only price-index proxy. Never connected to actual or paper-account fills.
function validateBars(bars){
 if(!Array.isArray(bars)||!bars.length)throw new Error('No index bars');
 let last='';for(const b of bars){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||b.date<=last||new Date(b.date+'T00:00:00Z').toISOString().slice(0,10)!==b.date)throw new Error('Duplicate, invalid or unordered session');
  if(!['open','close','high','low'].every(k=>typeof b[k]==='number'&&Number.isFinite(b[k])&&b[k]>0)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))throw new Error('Invalid OHLC; do not silently filter');
  if(last&&(Date.parse(b.date)-Date.parse(last))/86400000>15)throw new Error('Unexplained gap; do not compress missing sessions');last=b.date;
 }
}
function signal(bars,index,fast=20,slow=60){
 if(!Number.isInteger(fast)||!Number.isInteger(slow)||fast<1||slow<=fast)throw new Error('Invalid fixed windows');
 if(index<slow)return {ready:false,date:index?bars[index-1].date:null};
 const mean=n=>bars.slice(index-n,index).reduce((sum,b)=>sum+b.close,0)/n;
 const f=mean(fast),s=mean(slow);return {ready:true,date:bars[index-1].date,fast:f,slow:s,long:f>s};
}
function rebalance(cash,units,open,targetWeight,costRate){
 if(![cash,units,open,targetWeight,costRate].every(Number.isFinite)||cash<0||units<0||open<=0||targetWeight<0||targetWeight>1||costRate<0||costRate>=1)throw new Error('Invalid proxy rebalance inputs');
 const oldValue=units*open,before=cash+oldValue,delta=targetWeight*before-oldValue;
 const fee=Math.abs(delta)<1e-14?0:costRate*Math.abs(delta)/(delta>=0?1+costRate*targetWeight:1-costRate*targetWeight);
 const after=before-fee,nextValue=targetWeight*after,nextCash=(1-targetWeight)*after,nextUnits=nextValue/open,notional=Math.abs(nextValue-oldValue);
 if(after<=0||Math.abs((nextCash+nextUnits*open+fee)-before)>1e-10*Math.max(before,1)||Math.abs(fee-costRate*notional)>1e-10*Math.max(before,1))throw new Error('Self-financing invariant failed');
 return {cash:nextCash,units:nextUnits,before,fee,notional,after};
}
function evaluate(bars,options){
 validateBars(bars);const {start,end,fast=20,slow=60,targetWeight=.6,costBps=10,method='ma'}=options;
 if(!['ma','constant'].includes(method)||typeof start!=='string'||typeof end!=='string'||start>end||!Number.isFinite(costBps)||costBps<0||costBps>1000)throw new Error('Invalid experiment parameters');
 const indices=bars.map((b,i)=>b.date>=start&&b.date<=end?i:-1).filter(i=>i!==-1);if(indices.length<2)throw new Error('Not enough evaluation sessions');
 const first=indices[0],last=indices.at(-1);
 if((Date.parse(bars[first].date)-Date.parse(start))/86400000>7||(Date.parse(end)-Date.parse(bars[last].date))/86400000>7)throw new Error('Incomplete window coverage');
 let cash=1,units=0,totalFees=0,turnover=0,trades=0,switches=0,previousTarget=0,high=1,maxDrawdown=0;const curve=[],years=new Map(),rate=costBps/10000;
 for(const i of indices){
  const b=bars[i],s=method==='ma'?signal(bars,i,fast,slow):null;if(s&&!s.ready)throw new Error('Not enough prior completed bars for warm-up');
  const weight=method==='constant'?targetWeight:s.long?targetWeight:0;
  const priorEquity=curve.at(-1)?.equity??1,overnightEquity=cash+units*b.open;
  const r=rebalance(cash,units,b.open,weight,rate);cash=r.cash;units=r.units;totalFees+=r.fee;turnover+=r.notional;if(r.notional>1e-12)trades++;if(weight!==previousTarget)switches++;previousTarget=weight;
  const equity=cash+units*b.close;if(!Number.isFinite(equity)||equity<=0)throw new Error('Nonpositive NAV');
  high=Math.max(high,equity);const drawdown=(high-equity)/high;maxDrawdown=Math.max(maxDrawdown,drawdown);
  const row={date:b.date,signalDate:s?.date||null,signalLong:s?.long??null,targetWeight:weight,open:b.open,close:b.close,priorEquity,overnightReturn:overnightEquity/priorEquity-1,intradayReturn:b.close/b.open-1,fee:r.fee,turnover:r.notional,equity,drawdown};curve.push(row);
  const year=b.date.slice(0,4);if(!years.has(year))years.set(year,{year,startEquity:priorEquity});years.get(year).endEquity=equity;
 }
 const finalEquity=curve.at(-1).equity,terminalFee=units*bars[last].close*rate,afterExitEquity=finalEquity-terminalFee;
 return {method,targetWeight,costBps,start:bars[first].date,end:bars[last].date,sessions:curve.length,netReturnMarked:finalEquity-1,netReturnAfterHypotheticalExit:afterExitEquity-1,terminalHypotheticalExitCost:terminalFee,totalFrictionOnInitialNAV:totalFees,closeMaxDrawdown:maxDrawdown,rebalanceTrades:trades,targetSwitches:switches,turnoverOnInitialNAV:turnover,investedSessions:curve.filter(x=>x.targetWeight>0).length,annualReturnsMarked:[...years.values()].map(y=>({year:y.year,return:y.endEquity/y.startEquity-1})),curve};
}
module.exports={validateBars,signal,rebalance,evaluate};
