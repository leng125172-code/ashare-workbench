(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AShareTrendData=api;})(globalThis,()=>{
  'use strict';
  const finite=x=>typeof x==='number'&&Number.isFinite(x);
  function normalize(raw,{allowAdjustedNonPositive=false}={}){
    if(!Array.isArray(raw)||!raw.length)throw Error('暂未取得K线数据。');
    let previous='';let missingVolume=0;
    const bars=raw.map(b=>{
      if(!b||typeof b.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||!Number.isFinite(Date.parse(b.date+'T00:00:00Z'))||new Date(b.date+'T00:00:00Z').toISOString().slice(0,10)!==b.date)throw Error('K线日期缺失或无效，暂不能绘图。');
      if(b.date<=previous)throw Error('K线日期重复或顺序异常，暂不能绘图。');previous=b.date;
      if(!['open','high','low','close'].every(k=>finite(b[k])&&(allowAdjustedNonPositive||b[k]>0))||['open','high','low','close'].every(k=>b[k]===0)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))throw Error('K线价格缺失或高低价不一致，暂不能绘图。');
      const volume=finite(b.volume)&&b.volume>=0?b.volume:null;if(volume===null)missingVolume++;
      return {...b,volume};
    });
    return {bars,missingVolume};
  }
  function sma(xs,n){let sum=0;return xs.map((v,i)=>{sum+=v;if(i>=n)sum-=xs[i-n];return i<n-1?null:sum/n;});}
  function ema(xs,n){if(xs.length<n)return Array(xs.length).fill(null);const out=Array(n-1).fill(null);let value=xs.slice(0,n).reduce((s,v)=>s+v,0)/n;out.push(value);for(let i=n;i<xs.length;i++){value+=2/(n+1)*(xs[i]-value);out.push(value);}return out;}
  function build(detail,requestedPeriod){
    const period=detail.period||requestedPeriod||'day';if(!['day','week','month'].includes(period)||requestedPeriod&&requestedPeriod!==period)throw Error('返回K线周期与本次查询不一致，请重新查询。');
    const adjusted=['qfq','hfq'].includes(detail.adjustment),data=normalize(detail.bars,{allowAdjustedNonPositive:adjusted}),xs=data.bars.map(b=>b.close),e12=ema(xs,12),e26=ema(xs,26),dif=xs.map((_,i)=>e26[i]===null?null:e12[i]-e26[i]);
    const dea=Array(Math.min(25,xs.length)).fill(null).concat(ema(dif.slice(25),9));
    const macd=xs.map((_,i)=>({dif:dif[i],dea:dea[i]??null,histogram:dif[i]===null||dea[i]===null||dea[i]===undefined?null:2*(dif[i]-dea[i])}));
    return {...data,period,nonPositiveAdjusted:adjusted?data.bars.filter(b=>[b.open,b.high,b.low,b.close].some(v=>v<=0)).length:0,ma:{5:sma(xs,5),20:sma(xs,20),60:sma(xs,60)},macd,source:detail.source||'来源未确认',adjustment:detail.adjustment||'未确认'};
  }
  function viewport(length,count=60,offset=0){const size=Math.max(1,Math.min(length,Math.round(count)||length));const shift=Math.max(0,Math.min(Math.max(0,length-size),Math.round(offset)||0));return {start:Math.max(0,length-size-shift),end:length-shift,count:size,offset:shift};}
  function atX(x,width,view,left=56,right=8){const available=width-left-right;if(available<=0)return view.start;return Math.max(view.start,Math.min(view.end-1,view.start+Math.floor((x-left)/available*view.count)));}
  return {normalize,sma,ema,build,viewport,atX};
});
