'use strict';
const network=require('./network.cjs'),crypto=require('node:crypto'),C=require('../core.js');
const HOSTS=new Set(require('../information.js').SOURCE_HOSTS);
const text=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
async function transport(url,form,options={}){
 const u=new URL(url);if(u.protocol!=='https:'||!HOSTS.has(u.hostname)||u.username||u.password||u.port)throw new Error('资讯数据源不在固定白名单。');
 const body=form?new URLSearchParams(form).toString():null;
 const r=await network.request(u,{method:form?'POST':'GET',body,headers:{'User-Agent':'Mozilla/5.0 Cindy-AShare/0.3',Accept:'*/*',Referer:'https://www.cninfo.com.cn/',...(form?{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}:{})},headersOnlyOnError:true,limitMessage:'资讯响应超过8MiB。'});
 if(r.statusCode!==200)throw Object.assign(new Error('资讯源HTTP '+r.statusCode),{code:'HTTP_STATUS_ERROR',statusCode:r.statusCode});
 const raw=r.body;let data;
 if(!options.raw){try{data=JSON.parse(raw.toString('utf8'));}catch{throw Object.assign(new Error('资讯源返回非JSON。'),{code:'SOURCE_FORMAT_ERROR'});}}
 return {...(options.raw?{bytes:raw.length,contentType:String(r.headers['content-type']||''),isPdf:raw.subarray(0,5).toString()==='%PDF-',textPreview:/text|json/.test(String(r.headers['content-type']))?text(raw.toString('utf8').replace(/<script[\s\S]*?<\/script>/gi,'')).slice(0,1200):null}:{data}),sha256:crypto.createHash('sha256').update(raw).digest('hex')};
}
const cnDate=at=>new Date(at+8*3600000).toISOString().slice(0,10);
function announcementRows(data,symbol,at){
 if(!Array.isArray(data.announcements))throw new Error('公告列表缺失，不能视为零公告。');
 return data.announcements.map(n=>{
  if(!/^[0-9]+$/.test(String(n.announcementId||'')))throw new Error('公告唯一编号缺失。');
  if(String(n.secCode)!==symbol.slice(2))throw new Error('公告股票身份不匹配。');
  if(!Number.isFinite(n.announcementTime)||n.announcementTime>at+60000||!/^finalpage\/\d{4}-\d{2}-\d{2}\/[\w.-]+\.pdf$/i.test(n.adjunctUrl||''))throw new Error('公告日期或附件路径不完整。');
  return {id:'cninfo-'+n.announcementId,symbol,name:text(n.secName),title:text(n.announcementTitle),publishedMs:n.announcementTime,publishedAt:new Date(n.announcementTime).toISOString(),url:'https://static.cninfo.com.cn/'+n.adjunctUrl,source:'cninfo',sourceKind:'official-disclosure-metadata',contentLevel:'metadata',fetchedAt:at};
 });
}
function financialRows(data,symbol,at){
 const rows=data.result?.data;if(!Array.isArray(rows)||!rows.length)throw new Error('结构化财务数据缺失。');
 return rows.map(r=>{
  const expected=symbol.slice(2)+'.'+symbol.slice(0,2).toUpperCase();if(r.SECUCODE!==expected||r.CURRENCY!=='CNY')throw new Error('财务数据身份或币种不符。');
  const reportPeriod=String(r.REPORT_DATE||'').slice(0,10),noticeDate=String(r.NOTICE_DATE||'').slice(0,10),updateDate=String(r.UPDATE_DATE||'').slice(0,10);
  const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
  if(!validDate(reportPeriod)||!validDate(noticeDate)||noticeDate>cnDate(at)||reportPeriod>noticeDate||!validDate(updateDate)||updateDate>cnDate(at))throw new Error('财务期次/披露日期缺失或在未来。');
  const numeric=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
  return {symbol,name:text(r.SECURITY_NAME_ABBR),reportPeriod,noticeDate,updateDate,reportType:text(r.REPORT_TYPE),currency:'CNY',source:'eastmoney-datacenter',sourceKind:'aggregator',fetchedAt:at,
   metrics:{basicEps:{value:numeric(r.EPSJB),unit:'CNY/share',providerField:'EPSJB'},netAssetsPerShare:{value:numeric(r.BPS),unit:'CNY/share',providerField:'BPS'},revenue:{value:numeric(r.OPERATE_INCOME_PK),unit:'CNY',providerField:'OPERATE_INCOME_PK'},providerTotalOperatingRevenue:{value:numeric(r.TOTALOPERATEREVE),unit:'CNY',providerField:'TOTALOPERATEREVE'},parentNetProfit:{value:numeric(r.PARENTNETPROFIT),unit:'CNY',providerField:'PARENTNETPROFIT'}},
   caution:'来源字段原值；需对照同一期官方报表。OPERATE_INCOME_PK与TOTALOPERATEREVE可能不同，不能互相替代；同比/ROE等未核实口径的比例不自动缩放或计算；银行与非银行不可直接横比。'};
 }).sort((a,b)=>b.reportPeriod.localeCompare(a.reportPeriod));
}
function createClient(request=transport){
 const directories=new Map();
 async function resolve(symbol,at){const file=/^(sh|sz)/.test(symbol)?'szse_stock.json':null;if(!file)throw new Error('当前自动公告采集尚不支持北交所；需要人工官方核验。');
  let d=directories.get(file);if(!d||at-d.at>12*3600000){const r=await request('https://www.cninfo.com.cn/new/data/'+file);if(!Array.isArray(r.data.stockList))throw new Error('官方股票身份目录缺失。');d={at,rows:r.data.stockList,sha256:r.sha256};directories.set(file,d);}
  const matches=d.rows.filter(r=>String(r.code)===symbol.slice(2));if(matches.length!==1||!matches[0].orgId)throw new Error('公告主体未唯一解析；不能改用名称模糊匹配。');return {code:symbol.slice(2),orgId:matches[0].orgId,name:text(matches[0].zwjc),category:text(matches[0].category),symbol,fetchedAt:at,source:'cninfo-stock-directory',directorySha256:d.sha256};
 }
 async function announcements(symbol,at){
  const identity=await resolve(symbol,at),from=cnDate(at-90*86400000),to=cnDate(at),pages=[],records=[];let total=null,complete=false;
  for(let page=1;page<=5;page++){
   const form={pageNum:String(page),pageSize:'30',column:symbol.startsWith('sh')?'sse':'szse',tabName:'fulltext',plate:'',stock:identity.code+','+identity.orgId,searchkey:'',secid:'',category:'',trade:'',seDate:from+'~'+to,sortName:'time',sortType:'desc',isHLtitle:'true'};
   const response=await request('https://www.cninfo.com.cn/new/hisAnnouncement/query',form),d=response.data;
   const count=Number(d.totalAnnouncement??d.totalRecordNum);if(!Number.isInteger(count)||count<0)throw new Error('公告总量字段缺失。');if(total!==null&&count!==total)throw new Error('分页期间公告总数变化，请重取资料。');total=count;
   const part=count===0&&d.announcements===null?[]:announcementRows(d,symbol,at);
   if(part.some(n=>cnDate(n.publishedMs)<from||cnDate(n.publishedMs)>to))throw new Error('公告源未遵守日期范围。');
   pages.push({page,sha256:response.sha256,rows:part.length});records.push(...part);
   if(records.length>=total){complete=true;break;}
   if(!part.length||d.hasMore===false)break;
  }
  const unique=[...new Map(records.map(n=>[n.id,n])).values()];if(unique.length!==records.length)complete=false;
  return {status:'available',identity,from,to,total,rows:unique,complete:complete&&unique.length===total,pages,sourceUrl:'https://www.cninfo.com.cn/new/hisAnnouncement/query',contentLevel:'metadata',caution:'仅最近90日、至多150条官方公告目录；没有读取PDF正文，不能据标题判定无风险。'};
 }
 async function financials(symbol,at){
  const q=new URLSearchParams({reportName:'RPT_F10_FINANCE_MAINFINADATA',columns:'ALL',filter:'(SECUCODE="'+symbol.slice(2)+'.'+symbol.slice(0,2).toUpperCase()+'")',pageNumber:'1',pageSize:'3',sortTypes:'-1',sortColumns:'REPORT_DATE',source:'HSF10',client:'PC'}),url='https://datacenter.eastmoney.com/securities/api/data/v1/get?'+q;
  const r=await request(url);return {status:'available',rows:financialRows(r.data,symbol,at),sourceUrl:url,sha256:r.sha256,coverage:'来源返回最近三个报告期的当前版本；不是历史时点快照或审计结论。'};
 }
 async function dossier(code,at=Date.now()){
  const symbol=C.symbol(code),r=await Promise.allSettled([announcements(symbol,at),financials(symbol,at)]),out={symbol,fetchedAt:at,announcements:null,financials:null,warnings:[],status:'partial'};
  for(let i=0;i<r.length;i++){const k=i?'financials':'announcements';if(r[i].status==='fulfilled')out[k]=r[i].value;else{out[k]={status:'unavailable',rows:[],complete:false,error:String(r[i].reason.message||r[i].reason).slice(0,180)};out.warnings.push((i?'财务参考':'官方公告')+'获取失败：'+out[k].error);}}
  if(out.announcements.status==='available'&&!out.announcements.complete)out.warnings.push('最近90日公告目录未读完；需继续官方检索，不能标成完整。');
  out.warnings.push('资料包不包含政策/PDF正文自动解读；须由当前Agent及独立核验者读取原文并保存互核记录。');return out;
 }
 async function source(url,at=Date.now()){const u=new URL(url);const r=await request(u.href,undefined,{raw:true});if(!r.bytes||!r.sha256||!r.contentType||!r.isPdf&&!/text|json|html/.test(r.contentType))throw new Error('来源正文格式不支持或为空。');return {url:u.href,fetchedAt:at,...r,hashBasis:'raw-response-bytes',notice:'原文字节指纹仅证明抓取到该响应；PDF正文由核验者自行阅读，不把目录或错误页当原文。'};}
 return {dossier,announcements,financials,source,instrument:(code)=>resolve(C.symbol(code),Date.now())};
}
module.exports={createClient,announcementRows,financialRows,transport};
