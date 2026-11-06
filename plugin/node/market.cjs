'use strict';
const https = require('node:https');
const C = require('../core.js');
const ALLOWED = new Set(['push2.eastmoney.com','push2his.eastmoney.com','qt.gtimg.cn','ifzq.gtimg.cn','zhibo.sina.com.cn','np-listapi.eastmoney.com','search-api-web.eastmoney.com']);
const text = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
function get(url, gbk = false) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ALLOWED.has(u.hostname) || u.port || u.username || u.password) throw new Error('数据源地址不在固定白名单。');
  return new Promise((resolve, reject) => {
    const req = https.get(u, { headers: { 'User-Agent':'Mozilla/5.0 Cindy-AShare/1.0', Accept:'application/json,text/plain,*/*', Referer:'https://finance.sina.com.cn/' } }, r => {
      if (r.statusCode !== 200) { r.resume(); reject(new Error('数据源HTTP '+r.statusCode)); return; }
      const parts = []; let bytes = 0;
      r.on('data', b => { bytes += b.length; if (bytes > 8*1024*1024) req.destroy(new Error('行情响应超过8MiB。')); else parts.push(b); });
      r.on('end', () => { try { const b = Buffer.concat(parts); resolve(gbk ? new TextDecoder('gb18030').decode(b) : b.toString('utf8')); } catch(e) { reject(e); } });
      r.on('error', reject);
    });
    req.setTimeout(9000, () => req.destroy(new Error('行情数据源超时。'))); req.on('error', reject);
  });
}
async function json(url) {
  const s = await get(url); try { return JSON.parse(s); } catch { const m = s.match(/^[\w.$]+\s*\(([\s\S]*)\)\s*;?$/); if (!m) throw new Error('数据源返回非JSON内容。'); return JSON.parse(m[1]); }
}
function timeCN(s) {
  const v = String(s || ''); const m = v.match(/^(\d{4})-?(\d{2})-?(\d{2})[ T]?(\d{2}):?(\d{2}):?(\d{2})$/);
  return m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`) : null;
}
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
    expected = Number(d.data.total); rows.push(...d.data.diff);
    if (rows.length >= expected || !d.data.diff.length) break;
    if (rows.length >= max) { warnings.push('达到本轮列表读取上限，结果不完整。'); break; }
  }
  const key = r => String(r.f13 ?? '')+':'+r.f12;
  const unique = [...new Map(rows.map(r => [key(r), r])).values()];
  if (unique.length < expected) warnings.push(`返回${unique.length}/${expected}项。`);
  return { rows:unique, total:expected, complete:unique.length >= expected, warnings, fetchedAt:Date.now(), source:'eastmoney' };
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
async function quotes(symbols) {
  if (!symbols.length) return {};
  const codes = [...new Set(symbols.map(C.symbol))]; if (codes.length > 100) throw new Error('一次最多读取100只报价。');
  const s = await get('https://qt.gtimg.cn/q='+codes.join(','), true), result = {};
  for (const match of s.matchAll(/v_((?:sh|sz|bj)\d{6})="([^"]*)"/g)) {
    const a = match[2].split('~'); if (a.length < 40) continue;
    result[match[1]] = { name:a[1], price:C.number(a[3]), previousClose:C.number(a[4]), changePct:C.number(a[32]), high:C.number(a[33]), low:C.number(a[34]),
      volume:C.number(a[6]) === null ? null : Number(a[6])*100, amount:C.number(a[37]) === null ? null : Number(a[37])*10000,
      open:C.number(a[5]),upperLimit:C.number(a[47]),lowerLimit:C.number(a[48]),bid1:C.number(a[9]),ask1:C.number(a[19]),bid1SizeRaw:C.number(a[10]),ask1SizeRaw:C.number(a[20]),providerInstrumentType:a[61]||null,turnover:C.number(a[38]), pe:C.number(a[39]), pb:C.number(a[46]), asOf:timeCN(a[30]), fetchedAt:Date.now(), source:'tencent', priceBasis:'unadjusted' };
  }
  return result;
}
async function kline(code, period = 'day') {
  const s = C.symbol(code), cycle = { day:101, week:102, month:103 }[period];
  if (!cycle) throw new Error('K线周期须为day/week/month。');
  const secid = (s.startsWith('sh') ? '1.' : '0.')+s.slice(2);
  const p = new URLSearchParams({ secid, fields1:'f1,f2,f3,f4,f5,f6', fields2:'f51,f52,f53,f54,f55,f56,f57', klt:String(cycle), fqt:'1', end:'20500101', lmt:'140' });
  try {
    const d = await json('https://push2his.eastmoney.com/api/qt/stock/kline/get?'+p);
    if (d.rc !== 0 || !Array.isArray(d.data?.klines)) throw new Error('缺少K线数据。');
    return { source:'eastmoney', adjustment:'qfq', period, fetchedAt:Date.now(), bars:d.data.klines.map(v => { const a = v.split(','); return { date:a[0], open:Number(a[1]), close:Number(a[2]), high:Number(a[3]), low:Number(a[4]), volume:Number(a[5]), amount:Number(a[6]) }; }), warnings:[] };
  } catch (first) {
    const d = await json('https://ifzq.gtimg.cn/appstock/app/fqkline/get?param='+s+','+period+',,,140,qfq');
    const adjusted = d.data?.[s]?.['qfq'+period];
    const rows = Array.isArray(adjusted) ? adjusted : d.data?.[s]?.[period];
    if (!Array.isArray(rows)) throw new Error('主备K线源均未返回有效数据。');
    return { source:'tencent', adjustment:Array.isArray(adjusted)?'qfq':'none', period, fetchedAt:Date.now(), bars:rows.map(a => ({ date:a[0], open:Number(a[1]), close:Number(a[2]), high:Number(a[3]), low:Number(a[4]), volume:Number(a[5]), amount:null })), warnings:[Array.isArray(adjusted)?'东方财富K线不可用，回退腾讯前复权数据；成交量口径以来源为准。':'东方财富K线不可用；腾讯仅返回未复权序列，已标为未复权，不冒充前复权；成交量口径以来源为准。'] };
  }
}
async function news(keyword) {
  const rows = [], warnings = [];
  const attempts = await Promise.allSettled([
    json('https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=60&zhibo_id=152&tag_id=0&dire=f&dpc=1').then(d => {
      const feed = d.result?.data?.feed?.list; if (!Array.isArray(feed)) throw new Error('新浪资讯结构不完整。');
      for (const n of feed) { let ext={}; try { ext=JSON.parse(n.ext || '{}'); } catch {} rows.push({ id:'sina-'+n.id, title:text(n.rich_text).slice(0,700), source:'sina', publishedAt:n.create_time, publishedMs:timeCN(n.create_time), url:n.docurl || ext.docurl || 'https://finance.sina.com.cn/', fetchedAt:Date.now() }); }
    }),
    json('https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=60').then(d => {
      if (!Array.isArray(d.data?.fastNewsList)) throw new Error('东财资讯结构不完整。');
      for (const n of d.data.fastNewsList) rows.push({ id:'em-'+(n.code || n.realSort), title:text(n.title || n.summary).slice(0,700), source:'eastmoney', publishedAt:n.showTime, publishedMs:timeCN(n.showTime), url:n.url || 'https://kuaixun.eastmoney.com/', fetchedAt:Date.now() });
    })
  ]);
  attempts.forEach((r,i) => { if(r.status==='rejected') warnings.push((i ? '东财':'新浪')+'资讯获取失败。'); });
  if (keyword) {
    try {
      const param = { uid:'', keyword, type:['cmsArticleWebOld'], client:'web', clientType:'web', clientVersion:'curr', param:{ cmsArticleWebOld:{ searchScope:'default', sort:'default', pageIndex:1, pageSize:8, preTag:'', postTag:'' } } };
      const d = await json('https://search-api-web.eastmoney.com/search/jsonp?param='+encodeURIComponent(JSON.stringify(param)));
      const list = d.result?.cmsArticleWebOld || d.result?.data?.cmsArticleWebOld;
      if (!Array.isArray(list)) throw new Error('检索资讯结构不完整。');
      for (const n of list) rows.push({ id:'search-'+(n.code || n.url), title:text(n.title).slice(0,700), source:'eastmoney-search', publishedAt:n.date, publishedMs:timeCN(n.date), url:n.url || 'https://finance.eastmoney.com/', fetchedAt:Date.now(), keyword });
    } catch { warnings.push('行业/股票专项资讯检索不可用，仅有市场快讯参考。'); }
  }
  return { rows:[...new Map(rows.filter(n => n.title).map(n=>[n.id,n])).values()].sort((a,b)=>(b.publishedMs || 0)-(a.publishedMs || 0)), warnings, fetchedAt:Date.now() };
}
async function assess(items, progress = ()=>{}) {
  const out = [];
  for (const item of items) {
    let s = { ...item, warnings:[] };
    try { const k = await kline(item.symbol); s.indicators = C.indicators(k.bars); s.klineSource=k.source; s.adjustment=k.adjustment; s.klineAsOf=k.bars.at(-1)?.date; s.warnings.push(...k.warnings); }
    catch { s.indicators={ready:false,count:0}; s.warnings.push('K线主备源不可用，未分档。'); }
    out.push(s); progress(out.length,items.length);
  }
  return out;
}
module.exports = { get, json, timeCN, row, list, sectors, members, quotes, kline, news, assess };
