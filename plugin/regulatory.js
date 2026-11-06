(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AShareRegulatory=api;})(globalThis,function(){
'use strict';
const VERSION=1,TTL=3600000,PAGE_SIZE=5,MAX_PAGES=20,MAX_BODY=262144;
const ENDPOINT='https://query.sse.com.cn/commonSoaQuery.do';
const CHANNELS={measures:'10007,10008,10009,10010',inquiries:'10743,10744,10012'};
const receiptPath=hash=>'regulatory/receipts/'+hash.slice(0,32)+'/'+hash.slice(32)+'.json';
const cachePath=hash=>'regulatory/cache/'+hash.slice(0,32)+'/'+hash.slice(32)+'.json';
const SCRIPT='https://www.sse.com.cn/xhtml/home/2021public/querySearch/search_stocksDepositoryReceipts_2021.js';
function fail(message,code='REGULATORY_INVALID'){throw Object.assign(new Error(message),{code});}
const day=at=>new Date(at+28800000).toISOString().slice(0,10);
function date(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)fail('日期须为有效YYYY-MM-DD。');return s;}
function scope(a,at){
 if(!/^sh6\d{5}$/.test(a.symbol||''))fail('监管查询仅支持上交所标准A股代码sh6xxxxx。');
 const kind=a.regulatoryKind||'measures';if(!Object.hasOwn(CHANNELS,kind))fail('监管类别不支持。');
 const from=date(a.from),to=date(a.to);if(from>to||to>day(at)||Date.parse(to)-Date.parse(from)>366*86400000)fail('检索日期须有序、不晚于今天且不超过366日。');
 return {version:VERSION,symbol:a.symbol,kind,from,to,pageSize:PAGE_SIZE};
}
function urlFor(s,page){
 if(!Number.isInteger(page)||page<1||page>MAX_PAGES)fail('监管页号超限。');
 const p=new URLSearchParams({jsonCallBack:'?',isPagination:'true','pageHelp.pageSize':String(PAGE_SIZE),'pageHelp.pageNo':String(page),'pageHelp.beginPage':String(page),'pageHelp.cacheSize':'1','pageHelp.endPage':String(page+4),extTeacher:'',extWTFL:'',siteId:'28',sqlId:'BS_KCB_GGLL_NEW',extGGLX:'',channelId:CHANNELS[s.kind],extGGDL:'',order:'createTime|desc,stockcode|asc',type:'',stockcode:s.symbol.slice(2),createTime:s.from+' 00:00:00',createTimeEnd:s.to+' 23:59:59'});
 return ENDPOINT+'?'+p;
}
function parse(body){
 if(typeof body!=='string'||new TextEncoder().encode(body).byteLength>MAX_BODY)fail('监管响应为空或超过256KiB。');
 let s=body.trim();if(s.startsWith('?(')&&/\)\s*;?$/.test(s))s=s.slice(2).replace(/\)\s*;?$/,'');
 let d;try{d=JSON.parse(s);}catch{fail('监管接口未返回JSON/固定JSONP，不能把网页或脚本当名单。');}
 if(!d||typeof d!=='object'||d.sqlId!=='BS_KCB_GGLL_NEW'||!Array.isArray(d.result)||!d.pageHelp||!Array.isArray(d.actionErrors)||d.actionErrors.length||!d.fieldErrors||Object.keys(d.fieldErrors).length)fail('监管响应结构或错误状态不符。');
 return d;
}
function documentUrl(value){
 if(typeof value!=='string'||!value.trim())fail('监管记录原文地址缺失。');
 const str=value.startsWith('//')?'https:'+value:value.startsWith('/')?'https://www.sse.com.cn'+value:/^www\.sse\.com\.cn\//.test(value)?'https://'+value:value;
 let u;try{u=new URL(str);}catch{fail('监管原文地址无效。');}
 if(u.protocol!=='https:'||u.hostname!=='www.sse.com.cn'||u.port||u.username||u.password||!/^\/disclosure\//.test(u.pathname))fail('监管原文不在上交所公开披露路径。');return u.href;
}
function pageData(body,s,page,at){
 const d=parse(body),h=d.pageHelp;
 for(const k of ['total','pageCount','pageNo','pageSize'])if(!Number.isInteger(h[k])||h[k]<0)fail('监管分页字段缺失。');
 if(h.pageNo!==page||h.pageSize!==PAGE_SIZE||h.pageCount!==Math.ceil(h.total/PAGE_SIZE)||d.result.length>PAGE_SIZE||h.total<d.result.length)fail('监管分页页号/页数/总量不一致。');
 const rows=d.result.map(r=>{
  if(!r||r.stockcode!==s.symbol.slice(2)||!CHANNELS[s.kind].split(',').includes(String(r.channelId)))fail('监管记录公司或类别不匹配。');
  if(typeof r.docId!=='string'||!r.docId||r.docId.length>160||typeof r.docTitle!=='string'||!r.docTitle.trim()||r.docTitle.length>1000)fail('监管记录编号或标题缺失。');
  if(typeof r.createTime!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.createTime))fail('监管记录时间缺失。');
  const publishedAt=r.createTime.replace(' ','T')+'+08:00',ms=Date.parse(publishedAt),datePart=r.createTime.slice(0,10);
  if(!Number.isFinite(ms)||day(ms)!==datePart||datePart<s.from||datePart>s.to||ms>at+60000)fail('监管记录日期越界或在未来。');
  return {id:r.docId,symbol:s.symbol,title:r.docTitle.trim(),publishedAt,url:documentUrl(r.docURL),channelId:String(r.channelId),contentLevel:'metadata'};
 });
 if(h.total===0&&(rows.length||page!==1))fail('空结果分页不一致。');
 return {rows,total:h.total,pageCount:h.pageCount};
}
function createClient({request,read,write,hash,now=Date.now}){
 async function validate(bundle,s){
  if(!bundle||bundle.version!==VERSION||JSON.stringify(bundle.scope)!==JSON.stringify(s)||!Array.isArray(bundle.pages)||!bundle.pages.length||bundle.pages.length>MAX_PAGES)fail('缓存版本或查询范围不匹配。','REGULATORY_CACHE_INVALID');
  const {integrity,...core}=bundle;if(integrity!==await hash(JSON.stringify(core)))fail('缓存清单摘要不一致。','REGULATORY_CACHE_INVALID');
  const rows=[],ids=new Set();let total=null,pageCount=null;
  for(let i=0;i<bundle.pages.length;i++){
   const p=bundle.pages[i];if(p.page!==i+1||p.url!==urlFor(s,i+1)||p.method!=='GET'||p.hashBasis!=='utf8-decoded-response'||!Number.isFinite(p.fetchedAt)||p.fetchedAt>now()+60000||p.fetchedAt<bundle.fetchedAt||await hash(p.body)!==p.sha256)fail('缓存原始响应、页次或摘要损坏。','REGULATORY_CACHE_INVALID');
   if(p.rawSha256&&p.rawSha256!==p.sha256||p.finalUrl&&p.finalUrl!==p.url)fail('监管原始字节或最终地址与回执不一致。','REGULATORY_CACHE_INVALID');
   const d=pageData(p.body,s,i+1,p.fetchedAt);if(total!==null&&(total!==d.total||pageCount!==d.pageCount))fail('分页期间总数变化。');total=d.total;pageCount=d.pageCount;
   for(const row of d.rows){if(ids.has(row.id))fail('监管分页出现重复记录。');ids.add(row.id);rows.push(row);}
  }
  if(!Number.isFinite(bundle.fetchedAt)||bundle.fetchedAt>now()+60000)fail('缓存时间无效。','REGULATORY_CACHE_INVALID');
  const complete=rows.length===total&&bundle.pages.length===Math.max(1,pageCount);
  const fresh=now()-bundle.fetchedAt<TTL&&bundle.scope.to===day(now());
  const sourceVerified=bundle.pages.every(p=>p.transport==='node:https-no-redirect'&&p.finalUrl===p.url&&p.rawSha256===p.sha256);
  return {bundle,rows,total,pageCount,complete,fresh,sourceVerified,usable:complete&&fresh&&sourceVerified};
 }
 async function query(a){
  const s=scope(a,now()),mode=a.cache||'prefer';if(!['prefer','refresh','only'].includes(mode))fail('缓存模式不支持。');
  const key=await hash(JSON.stringify(s)),path=cachePath(key);let cached=null;
  const raw=await read(path);if(raw!==null){try{cached=await validate(JSON.parse(raw),s);}catch(e){fail('监管缓存核对失败：'+e.message,'REGULATORY_CACHE_INVALID');}}
  if(mode==='only'){if(!cached)fail('没有同公司/日期/类别的缓存回执。','REGULATORY_CACHE_MISS');return {...cached,transport:'cache',path};}
  if(mode==='prefer'&&cached?.usable)return {...cached,transport:'cache',path};
  try{
   const bundle={version:VERSION,scope:s,fetchedAt:now(),pages:[]};let total=null;
   for(let page=1;page<=MAX_PAGES;page++){
    const url=urlFor(s,page),response=await request(url);
    if(response?.redirected||response?.url&&response.url!==url)fail('监管响应发生重定向，来源身份需重新核验。','REGULATORY_REDIRECT');
    if(!response?.ok||response.status!==200||response.truncated||typeof response.body!=='string'||!/json|javascript|text/.test(String(response.headers?.['content-type']||'')))fail('官方监管请求失败或响应被截断：'+String(response?.errorCode||response?.status||'NETWORK_ERROR')+' '+String(response?.message||'').slice(0,120),'REGULATORY_UNAVAILABLE');
    const fetchedAt=now(),data=pageData(response.body,s,page,fetchedAt);
    if(total!==null&&data.total!==total)fail('分页期间总数变化。');total=data.total;
    bundle.pages.push({page,url,method:'GET',fetchedAt,body:response.body,sha256:await hash(response.body),hashBasis:'utf8-decoded-response',transport:response.transport||'cindy.fetch',finalUrl:response.url||null,rawSha256:response.rawSha256||null});
    if(page>=data.pageCount||!data.rows.length)break;
   }
   bundle.integrity=await hash(JSON.stringify(bundle));const checked=await validate(bundle,s);
   const audit=receiptPath(bundle.integrity);await write(audit,JSON.stringify(bundle));
   if(checked.complete&&checked.sourceVerified)await write(path,JSON.stringify(bundle));
   return {...checked,transport:'official-public-api',path:audit};
  }catch(e){if(cached?.usable&&(!e.code||e.code==='REGULATORY_UNAVAILABLE'))return {...cached,transport:'cache-after-network-error',path,networkError:{code:e.code||'NETWORK_ERROR',message:String(e.message).slice(0,180)}};throw e;}
 }
 return {query,validate};
}
return {VERSION,TTL,PAGE_SIZE,MAX_PAGES,ENDPOINT,SCRIPT,receiptPath,cachePath,scope,urlFor,parse,pageData,createClient};
});
