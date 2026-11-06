(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./core.js'):root.AShareCore,typeof module==='object'&&module.exports?require('./calendar.js'):root.AShareCalendar);if(typeof module==='object'&&module.exports)module.exports=api;else root.AShareSimulation=api;})(globalThis,function(C,Cal){
  'use strict';
  const codes=['sh600519','sz000001','sz300750','sh600036','sz000333','sh601318','sh600900','sz002594','sh601012','sh600028','sh601398','sh600030'];
  const sectors=Array.from({length:4},(_,i)=>({id:'BK900'+(i+1),name:'模拟行业'+String.fromCharCode(65+i),changePct:2-i,amount:(4-i)*100000000,flow:(3-i)*1000000,source:'simulation',simulation:true}));
  function base(symbol){const n=codes.indexOf(C.symbol(symbol));return 50+(n<0?7:n)*10;}
  function quote(symbol,scenario='normal',at=Date.now()){const code=C.symbol(symbol),price=base(code)*(scenario==='target'?1.25:scenario==='stop'?.75:1);return {symbol:code,name:'模拟标的 '+code,price,previousClose:base(code)*.99,changePct:1.01,pe:15,pb:2,volume:100000,amount:price*100000,source:'simulation',priceBasis:'unadjusted',asOf:scenario==='stale'?at-2*86400000:at,fetchedAt:at,simulation:true};}
  function kline(symbol,period='day',at=Date.now()){
    const price=base(symbol),date=Cal.dateCN(at);let t=Date.parse(date+'T12:00:00+08:00'),dates=[];
    while(dates.length<140){const d=Cal.dateCN(t),c=Cal.check(d);if((c.known?c.isTradingDay:![0,6].includes(new Date(d+'T12:00:00Z').getUTCDay())))dates.unshift(d);t-=(period==='week'?7:period==='month'?30:1)*86400000;}
    const bars=dates.map((date,i)=>{const close=price*(.82+.18*i/139)+Math.sin(i*.6)*price*.006;return {date,open:C.round(close-price*.003,3),close:C.round(i===139?price:close,3),high:C.round(close+price*.012,3),low:C.round(close-price*.012,3),volume:100000+i*300,amount:close*(100000+i*300)};});
    return {source:'simulation',adjustment:'qfq',period,fetchedAt:at,bars,simulation:true,warnings:['模拟合成K线与价格，仅供功能测试，不是真实行情。']};
  }
  function news(keyword='',at=Date.now()){return {rows:[{id:'sim-news-'+(keyword||'market'),title:'【模拟资讯】'+(keyword||'市场')+'测试情景：经营与风险假设保持不变；不是真实新闻。',source:'simulation',keyword,publishedAt:new Date(at).toISOString(),publishedMs:at,fetchedAt:at,url:null,simulation:true}],warnings:['模拟资讯，不代表真实公司或市场事件。'],fetchedAt:at};}
  async function request(method,p={}){
    const at=p.asOf||Date.now();
    if(method==='sectors')return {rows:sectors.map(s=>({...s,asOf:at,fetchedAt:at})),total:4,complete:true,source:'simulation',warnings:['模拟行业目录，仅4个测试行业。'],fetchedAt:at};
    if(method==='members'){const index=sectors.findIndex(s=>s.id===p.sectorId);if(index<0)throw new Error('模拟行业不存在。');return {rows:codes.slice(index*3,index*3+3).map(symbol=>({symbol,name:'模拟标的 '+symbol,quote:quote(symbol,'normal',at)})),total:3,complete:true,warnings:[],fetchedAt:at};}
    if(method==='quotes')return Object.fromEntries((p.symbols||[]).filter(()=>p.scenario!=='missing').map(s=>[C.symbol(s),quote(s,p.scenario,at)]));
    if(method==='kline')return kline(p.symbol,p.period,at);
    if(method==='news')return news(p.keyword,at);
    if(method==='assess')return (p.items||[]).map(s=>({...s,indicators:C.indicators(kline(s.symbol,'day',at).bars),adjustment:'qfq',klineSource:'simulation',klineAsOf:kline(s.symbol,'day',at).bars.at(-1).date,warnings:['模拟样例，不是真实证券价值判断。'],simulation:true}));
    throw new Error('模拟模式不支持此行情操作。');
  }
  const defaultConfig={cash:100000,holdings:[],maxEquityWeight:.6,maxStockWeight:.2,maxIndustryWeight:.3,riskPerStock:.01,horizonDays:2,reviewMinutes:60,trackingEnabled:true,allowAutoRevision:true,newsMaxAgeHours:48,industryIds:[],dailyScanEnabled:true,dailyScanTime:'15:15'};
  return {codes,sectors,quote,kline,news,request,defaultConfig};
});
