'use strict';
const C=require('../core.js');
function createClient(M,information){
 return {async snapshot(code){const symbol=C.symbol(code),at=Date.now(),secid=(symbol.startsWith('sh')?'1.':'0.')+symbol.slice(2),fields='f43,f47,f48,f51,f52,f57,f58,f86,f19,f20,f39,f40',url='https://push2.eastmoney.com/api/qt/stock/get?'+new URLSearchParams({secid,fields,fltt:'2',invt:'2'});
  const r=await Promise.allSettled([M.quotes([symbol]),M.json(url),information.instrument(symbol)]),q=r[0].status==='fulfilled'?r[0].value[symbol]:null,em=r[1].status==='fulfilled'?r[1].value?.data:null,identity=r[2].status==='fulfilled'?r[2].value:null,warnings=r.map((x,i)=>x.status==='rejected'?['腾讯报价','东方财富复核','官方主体目录'][i]+'读取失败。':null).filter(Boolean);
  const validEm=em&&String(em.f57)===symbol.slice(2),number=C.number;
  const upper=number(q?.upperLimit),lower=number(q?.lowerLimit),cross=validEm&&upper>0&&lower>0&&number(em.f51)>0&&number(em.f52)>0&&Math.abs(upper-number(em.f51))<.005&&Math.abs(lower-number(em.f52))<.005;
  const dateCN=n=>Number.isFinite(n)?new Date(n+8*3600000).toISOString().slice(0,10):null,emAsOf=number(em?.f86)?number(em.f86)*1000:null;
  if(!cross)warnings.push('实际涨跌停价格未取得双源一致核验。');
  return {symbol,fetchedAt:at,priceBasis:'unadjusted',identity,quote:q?{...q,symbol}:null,limits:{upper,lower,date:dateCN(q?.asOf),asOf:q?.asOf||null,verifiedAcrossSources:!!cross&&dateCN(q?.asOf)===dateCN(emAsOf),sources:['tencent','eastmoney'],secondaryAsOf:emAsOf},book:q?{bid:q.bid1,ask:q.ask1,bidSizeRaw:q.bid1SizeRaw,askSizeRaw:q.ask1SizeRaw,quantityUnit:'provider-raw-unverified',source:'tencent'}:null,tradingStatus:{value:'unknown',authoritative:false,asOf:null,source:null},secondary:validEm?{price:number(em.f43),upper:number(em.f51),lower:number(em.f52),asOf:emAsOf,sourceUrl:url}:null,warnings:[...warnings,'公开报价接口没有核实可用的停复牌状态契约；未知不等于正常交易。']};
 }};
}
module.exports={createClient};
