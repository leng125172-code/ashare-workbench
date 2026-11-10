'use strict';
const network = require('./network.cjs');
const C = require('../core.js');
const ALLOWED = new Set(['push2.eastmoney.com','push2his.eastmoney.com','qt.gtimg.cn','ifzq.gtimg.cn','zhibo.sina.com.cn','np-listapi.eastmoney.com','search-api-web.eastmoney.com']);
const text = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
function get(url, gbk = false) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ALLOWED.has(u.hostname) || u.port || u.username || u.password) throw new Error('数据源地址不在固定白名单。');
  const referer=u.hostname==='search-api-web.eastmoney.com'?'https://so.eastmoney.com/':u.hostname.endsWith('.eastmoney.com')?'https://finance.eastmoney.com/':'https://finance.sina.com.cn/';
  return network.request(u,{headers:{'User-Agent':'Mozilla/5.0 Cindy-AShare/1.0',Accept:'application/json,text/plain,*/*',Referer:referer},headersOnlyOnError:true,limitMessage:'行情响应超过8MiB。'}).then(r=>{
    if(r.statusCode!==200)throw Object.assign(new Error('数据源HTTP '+r.statusCode),{code:'HTTP_STATUS_ERROR',statusCode:r.statusCode});
    return gbk?new TextDecoder('gb18030').decode(r.body):r.body.toString('utf8');
  });
}
async function json(url) {
  const s = await get(url); try { return JSON.parse(s); } catch { const m = s.match(/^[\w.$]+\s*\(([\s\S]*)\)\s*;?$/); if (!m) throw new Error('数据源返回非JSON内容。'); return JSON.parse(m[1]); }
}
function timeCN(s) {
  const v = String(s || ''); const m = v.match(/^(\d{4})-?(\d{2})-?(\d{2})[ T]?(\d{2}):?(\d{2}):?(\d{2})$/);
  return m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`) : null;
}
const {row,list,sectors,members}=require('../clist.js').create({request:json,core:C});
async function quotes(symbols) {
  if (!symbols.length) return {};
  const codes = [...new Set(symbols.map(C.symbol))]; if (codes.length > 100) throw new Error('一次最多读取100只报价。');
  const s = await get('https://qt.gtimg.cn/q='+codes.join(','), true), result = {};
  for (const match of s.matchAll(/v_((?:sh|sz|bj)\d{6})="([^"]*)"/g)) {
    const a = match[2].split('~'); if (a.length < 40) continue;
    // STAR packets observed in production do not share the mainboard volume
    // scale. Keep their source value without guessing an undocumented unit.
    const volumeRaw=C.number(a[6]), ambiguousVolume=a[61]==='GP-A-KCB';
    result[match[1]] = { name:a[1], price:C.number(a[3]), previousClose:C.number(a[4]), changePct:C.number(a[32]), high:C.number(a[33]), low:C.number(a[34]),
      volume:ambiguousVolume||volumeRaw===null?null:volumeRaw*100, volumeRaw,
      ...(ambiguousVolume?{volumeUnit:'unknown',volumeWarning:'腾讯科创板成交量口径未核实；保留原值，不换算为股数。'}:{}),
      amount:C.number(a[37]) === null ? null : Number(a[37])*10000,
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
  const rows = [], warnings = [], sources = [];
  let searchMeta=null;
  const query=String(keyword||'').trim();
  if(query.length>100)throw new Error('专项资讯关键词最多100字符。');
  async function load(name,scope,fetchRows){
    const requestedAt=Date.now();
    try{
      const items=await fetchRows();
      rows.push(...items);
      sources.push({source:name,scope,status:items.length?'ok':'empty',count:items.length,requestedAt,checkedAt:Date.now(),metadataOnly:true});
    }catch(e){
      const statusCode=Number.isInteger(e.statusCode)?e.statusCode:null;
      const error=String(e.message||e).slice(0,180);
      sources.push({source:name,scope,status:'failed',count:0,requestedAt,checkedAt:Date.now(),metadataOnly:true,errorCode:e.code||'DATA_SOURCE_ERROR',statusCode,error});
      warnings.push((scope==='keyword'?'行业/股票专项资讯检索':name==='eastmoney'?'东财资讯':'新浪资讯')+'获取失败：'+error+'。');
    }
  }
  await Promise.all([
    load('sina','market',async()=>{
      const d=await json('https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=60&zhibo_id=152&tag_id=0&dire=f&dpc=1');
      const feed=d.result?.data?.feed?.list;if(!Array.isArray(feed))throw new Error('新浪资讯结构不完整。');
      return feed.map(n=>{let ext={};try{ext=JSON.parse(n.ext||'{}');}catch{}return {id:'sina-'+n.id,title:text(n.rich_text).slice(0,700),source:'sina',publishedAt:n.create_time,publishedMs:timeCN(n.create_time),url:n.docurl||ext.docurl||'https://finance.sina.com.cn/',fetchedAt:Date.now()};});
    }),
    load('eastmoney','market',async()=>{
      const d=await json('https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=60');
      if(!Array.isArray(d.data?.fastNewsList))throw new Error('东财资讯结构不完整。');
      return d.data.fastNewsList.map(n=>({id:'em-'+(n.code||n.realSort),title:text(n.title||n.summary).slice(0,700),source:'eastmoney',publishedAt:n.showTime,publishedMs:timeCN(n.showTime),url:n.url||'https://kuaixun.eastmoney.com/',fetchedAt:Date.now()}));
    }),
    ...(query?[load('eastmoney-search','keyword',async()=>{
      // Contract observed in Eastmoney's own search_main.js/searchZiXun:
      // explicit JSONP callback and nonempty em tags; results remain metadata.
      const param={uid:'',keyword:query,type:['cmsArticleWebOld'],client:'web',clientType:'web',clientVersion:'curr',param:{cmsArticleWebOld:{searchScope:'default',sort:'time',pageIndex:1,pageSize:8,preTag:'<em>',postTag:'</em>'}}};
      const d=await json('https://search-api-web.eastmoney.com/search/jsonp?'+new URLSearchParams({cb:'jQueryAShareNews',param:JSON.stringify(param)}));
      if(d.code!==undefined&&d.code!==0)throw Object.assign(new Error('专项检索服务返回错误：'+String(d.code)),{code:'SEARCH_RESPONSE_ERROR'});
      const list=d.result?.cmsArticleWebOld||d.result?.data?.cmsArticleWebOld;
      if(!Array.isArray(list))throw new Error('检索资讯结构不完整。');
      if(list.length>8||(!list.length&&Number(d.hitsTotal)>0))throw new Error('检索首屏数量与请求或总量不一致。');
      const reportedHits=(typeof d.hitsTotal==='number'||typeof d.hitsTotal==='string'&&d.hitsTotal.trim()!=='')&&Number.isFinite(Number(d.hitsTotal))?Number(d.hitsTotal):null;
      searchMeta={queryKind:'fulltext_keyword',page:1,pageSize:8,sort:'time',reportedHits,complete:false,note:'仅按时间排序的首屏关键词结果，来源总量可能封顶；不代表行业/公司资讯、公告或五类正文完整覆盖。'};
      return list.map(n=>{
        const title=text(n.title).slice(0,700),snippet=text(n.content).slice(0,800),publishedMs=timeCN(n.date);
        let url;try{url=new URL(n.url);if(url.protocol==='http:')url.protocol='https:';}catch{throw new Error('专项检索缺少有效文章URL。');}
        if(!title||!Number.isFinite(publishedMs)||url.protocol!=='https:'||url.username||url.password||url.port||!(url.hostname==='eastmoney.com'||url.hostname.endsWith('.eastmoney.com'))||url.pathname==='/')throw new Error('专项检索文章标题、发布时间或来源URL无效。');
        return {id:'search-'+(n.code||url.href),title,source:'eastmoney-search',publishedAt:n.date,publishedMs,url:url.href,fetchedAt:Date.now(),keyword:query,contentLevel:'metadata',summary:snippet,matchedIn:[...(title.includes(query)?['title']:[]),...(snippet.includes(query)?['snippet']:[])],relationVerified:false};
      });
    })]:[])
  ]);
  const market=sources.filter(s=>s.scope==='market'),specialized=sources.find(s=>s.scope==='keyword');
  const coverage={market:market.every(s=>s.status==='failed')?'unavailable':market.some(s=>s.status==='failed')?'partial':'available',specialized:specialized?(specialized.status==='failed'?'unavailable':specialized.status==='empty'?'empty':'available'):'not_requested',keyword:query||null,metadataOnly:true};
  if(specialized?.status==='failed')warnings.push('专项检索未完成；市场快讯不能替代行业/公司原文，不将失败解释为没有相关资讯。');
  if(query)warnings.push('专项结果仅为全文关键词检索元数据，包含字面同名或代码误匹配的可能；须逐条核对公司/行业关联及原文，不替代五类证据互核。');
  return {rows:[...new Map(rows.filter(n=>n.title).map(n=>[n.id,n])).values()].sort((a,b)=>(b.publishedMs||0)-(a.publishedMs||0)),warnings,fetchedAt:Date.now(),coverage,diagnostics:{sources,search:searchMeta}};
}
async function assess(items, progress = ()=>{}) {
  const missing=items.filter(x=>!C.quoteValid(x.quote,Date.now(),20));
  let backup={},backupError=null;
  if(missing.length){try{backup=await quotes(missing.map(x=>x.symbol));}catch(e){backupError=String(e.message||e).slice(0,180);}}
  const out = [];
  for (const item of items) {
    let s = { ...item, warnings:[] };
    if(!C.quoteValid(item.quote,Date.now(),20)){
      if(C.finite(item.quote?.price)&&item.quote.price>0){s.lastKnownQuote={...item.quote,usage:'dated_reference_only'};s.quote={...item.quote,price:null};}
      const q=backup[item.symbol],valid=C.quoteValid(q,Date.now(),20);
      s.quoteDiagnostics={state:valid?'recovered':'missing',reason:valid?'backup_quote_recovered':backupError?'backup_source_failed':q?'backup_quote_stale_or_invalid':'source_no_valid_price',primarySource:item.quote?.source||null,checkedAt:Date.now(),suspensionInferred:false};
      if(valid){s.quote=q;s.warnings.push('行业列表缺报价，已通过备用源取得带实际时点的有效报价；不等于交易状态已核实。');}
      else{if(q&&C.finite(q.price)&&q.price>0&&Number.isFinite(q.asOf)&&(!Number.isFinite(s.lastKnownQuote?.asOf)||q.asOf>s.lastKnownQuote.asOf))s.lastKnownQuote={...q,usage:'dated_reference_only'};s.warnings.push('缺少有效报价：'+s.quoteDiagnostics.reason+'；停复牌状态需官方公告核验，旧价格仅作带日期参考。');}
    }
    try { const k = await kline(item.symbol); s.indicators = C.indicators(k.bars); s.klineSource=k.source; s.adjustment=k.adjustment; s.klineAsOf=k.bars.at(-1)?.date; s.warnings.push(...k.warnings); }
    catch { s.indicators={ready:false,count:0}; s.warnings.push('K线主备源不可用，未分档。'); }
    out.push(s); progress(out.length,items.length);
  }
  return out;
}
module.exports = { get, json, timeCN, row, list, sectors, members, quotes, kline, news, assess };
