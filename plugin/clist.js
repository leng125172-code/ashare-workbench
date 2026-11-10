(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AShareClist=api;})(globalThis,function(){
'use strict';
function create({request:json,core:C}) {
function row(r) {
  return { symbol:C.symbol((r.f13 === 1 ? 'sh' : /^(?:[48]|92)/.test(String(r.f12)) ? 'bj' : 'sz')+r.f12), name:String(r.f14 || r.f12),
    quote:{ price:C.number(r.f2), changePct:C.number(r.f3), volume:C.number(r.f5), amount:C.number(r.f6), turnover:C.number(r.f8), pe:C.number(r.f9), pb:C.number(r.f23),
      marketCap:C.number(r.f20), flow:C.number(r.f62), asOf:C.number(r.f124) ? Number(r.f124)*1000 : null,
      fetchedAt:Date.now(), source:'eastmoney', priceBasis:'unadjusted' } };
}
async function list(fs, fields, max = 20000) {
  const rows = [], warnings = []; let expected = null;
  for (let page = 1; page <= 200; page++) {
    const p = new URLSearchParams({ pn:String(page), pz:'100', po:'1', np:'1', fltt:'2', invt:'2', fid:'f12', fs, fields });
    const d = await json('https://push2.eastmoney.com/api/qt/clist/get?'+p);
    if (d.rc !== 0 || !d.data || !Array.isArray(d.data.diff)) throw new Error('东方财富列表结构不完整。');
    const total=Number(d.data.total);if(typeof d.data.total!=='number'||!Number.isSafeInteger(total)||total<0||total>max||expected!==null&&total!==expected)throw new Error('行业列表总数缺失、超限或分页期间变化。');expected=total;rows.push(...d.data.diff);
    if (rows.length >= expected || !d.data.diff.length) break;
    if (rows.length >= max) { warnings.push('达到本轮列表读取上限，结果不完整。'); break; }
  }
  const key = r => String(r.f13 ?? '')+':'+r.f12;
  const unique = [...new Map(rows.map(r => [key(r), r])).values()];
  if (unique.length < expected) warnings.push(`返回${unique.length}/${expected}项。`);
  return { rows:unique, total:expected, complete:unique.length === expected&&rows.length===unique.length, warnings, fetchedAt:Date.now(), source:'eastmoney' };
}
async function sectors() {
  const d = await list('m:90+t:2','f2,f3,f6,f12,f14,f62,f104,f105,f128,f136,f184,f124');
  return { ...d, rows:d.rows.map(r => ({ id:r.f12, name:r.f14, amount:C.number(r.f6), changePct:C.number(r.f3), flow:C.number(r.f62), advancing:C.number(r.f104), declining:C.number(r.f105),
    leader:r.f128 || '', asOf:C.number(r.f124) ? Number(r.f124)*1000 : null, source:'eastmoney-industry', fetchedAt:d.fetchedAt })) };
}
async function members(sectorId) {
  if (!/^BK\d+$/.test(sectorId)) throw new Error('行业代码须来自行业目录。');
  const d = await list('b:'+sectorId,'f2,f3,f5,f6,f8,f9,f12,f13,f14,f20,f23,f62,f124');
  return { ...d, rows:d.rows.map(row) };
}
return {row,list,sectors,members};
}
return {create};
});
