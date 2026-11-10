(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AShareKline=api;})(globalThis,function(){
'use strict';
const MAX_BYTES=256*1024,MAX_BARS=140,MAX_RPC_BYTES=240*1024;
function fail(message){throw Object.assign(new Error(message),{code:'KLINE_SOURCE_INVALID'});}
function symbol(s){if(typeof s!=='string'||!/^(sh|sz|bj)\d{6}$/.test(s))fail('日K证券代码无效。');return s;}
function url(code){const s=symbol(code),p=new URLSearchParams({secid:(s.startsWith('sh')?'1.':'0.')+s.slice(2),fields1:'f1,f2,f3,f4,f5,f6',fields2:'f51,f52,f53,f54,f55,f56,f57',klt:'101',fqt:'1',end:'20500101',lmt:String(MAX_BARS)});return 'https://push2his.eastmoney.com/api/qt/stock/kline/get?'+p;}
function value(v){if(typeof v!=='string'||!v.trim()||!Number.isFinite(Number(v)))fail('日K数值缺失或格式无效。');return Number(v);}
function parse(data,code,{fetchedAt=Date.now(),sourceProvenance}={}){
 const s=symbol(code),today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 if(data?.rc!==0||data.data?.code!==s.slice(2)||data.data?.market!==(s.startsWith('sh')?1:0)||!Array.isArray(data.data.klines)||!data.data.klines.length||data.data.klines.length>MAX_BARS)fail('日K身份、市场、条数或响应状态不一致。');
 if(!Number.isFinite(fetchedAt)||fetchedAt>Date.now()+60000||Date.now()-fetchedAt>86400000)fail('日K抓取时间无效或超过24小时。');
 let last='';const bars=data.data.klines.map(row=>{
  if(typeof row!=='string')fail('日K行格式无效。');const a=row.split(',');
  if(a.length!==7||!/^\d{4}-\d{2}-\d{2}$/.test(a[0])||!Number.isFinite(Date.parse(a[0]+'T00:00:00Z'))||new Date(a[0]+'T00:00:00Z').toISOString().slice(0,10)!==a[0]||a[0]<=last||a[0]>today)fail('日K日期无效、重复、乱序或属于未来。');
  last=a[0];const [open,close,high,low,volume,amount]=a.slice(1).map(value);
  if(high<Math.max(open,close)||low>Math.min(open,close)||volume<0||amount<0)fail('日K价格或量额范围无效。');
  return {date:a[0],open,close,high,low,volume,amount};
 });
 return {source:'eastmoney',adjustment:'qfq',period:'day',fetchedAt,bars,warnings:sourceProvenance?.transport==='host-text'?['日K经宿主正式HTTPS通道取得；指纹针对解码文本，未返回最终URL；不冒充原始传输字节或最终主机证明。']:[],...(sourceProvenance?{sourceProvenance}:{})};
}
function indicators(bars,core){
 const result=core.indicators(bars),last=bars.at(-1);
 if(!last||!['open','close','high','low'].every(k=>Number.isFinite(last[k])&&last[k]>0)||result.ready&&result.asOf!==last.date)return {ready:false,count:result.count,asOf:result.asOf||null,reason:'最新日K无可用正价格，或指标日期与原始末条不一致；不得以较旧指标冒充最新。'};
 return result;
}
function analyzeDaily(bars,core,calendar,at=Date.now()){
 const expectedAsOf=calendar.expectedDailyBar(at),complete=bars.filter(b=>b.date<=expectedAsOf),asOf=complete.at(-1)?.date||null;
 return {indicators:indicators(complete,core),asOf,expectedAsOf,observedAsOf:bars.at(-1)?.date||null};
}
function assessmentBatches(params){
 if(!Array.isArray(params.items)||!params.items.length||params.items.length>8||!params.hostKlines||typeof params.hostKlines!=='object')fail('日K工作进程批次无效。');
 const payload=items=>({...params,items,hostKlines:Object.fromEntries([...new Set(items.map(x=>symbol(x.symbol)))].map(s=>[s,params.hostKlines[s]]))});
 const fits=p=>new TextEncoder().encode(JSON.stringify(p)).byteLength<=MAX_RPC_BYTES;
 const batches=[];let items=[];
 // Preflight every chunk before sending the first one. Escaped raw JSON and
 // the original item fields count towards the host's 256KiB params limit.
 for(const item of params.items){
  const trial=payload([...items,item]);
  if(fits(trial)){items.push(item);continue;}
  if(items.length)batches.push(payload(items));
  items=[item];if(!fits(payload(items)))throw Object.assign(new Error('单项日K分析输入超过工作进程安全体积上限；未截断或发送。'),{code:'DATA_SIZE_LIMIT'});
 }
 if(items.length)batches.push(payload(items));return batches;
}
return {MAX_BYTES,MAX_BARS,MAX_RPC_BYTES,url,parse,indicators,analyzeDaily,assessmentBatches};
});
