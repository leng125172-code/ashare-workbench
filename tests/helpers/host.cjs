'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto').webcrypto;
const {DatabaseSync}=require('node:sqlite');
const C=require('../../plugin/core.js');
const root=path.join(__dirname,'../../plugin'),now=Date.now();
// Keep the in-memory SQLite files alive when a test creates a fresh fake host
// around the same library Map, matching the persistence of a real Library.
const databasesByFiles=new WeakMap();
function databaseMap(files){let dbs=databasesByFiles.get(files);if(!dbs){dbs=new Map();databasesByFiles.set(files,dbs);}return dbs;}
function dbFailure(e){return {ok:false,errorCode:'DB_ERROR',message:e?.message||String(e)};}
function dbParams(params){if(params===undefined||params===null)return [];return Array.isArray(params)?params:[params];}
const bars=Array.from({length:100},(_,i)=>({date:new Date(now-(99-i)*86400000).toISOString().slice(0,10),open:80+i*.2,close:80+i*.2+.1,high:81+i*.2,low:79+i*.2,volume:1000}));
function host(files=new Map(),unavailable=false,failEvents=false,options={}){
 let failReportOnce=!!options.failReportOnce;let listener;const published=[];const results=new Map(),exported=new Map(),monitor=[];const dbs=databaseMap(files);
 const libraryList=(r)=>{
  const prefix=typeof r.path==='string'&&r.path?r.path.replace(/\/$/,'')+'/':'';
  const recursive=r.recursive===true,limit=Number.isInteger(r.limit)&&r.limit>0?Math.min(r.limit,500):100;
  const all=new Map();
  for(const [p,content] of files){if(typeof p!=='string')continue;const normalized=p.replace(/^\/+|\/+$/g,'');if(prefix&&!normalized.startsWith(prefix))continue;const rest=prefix?normalized.slice(prefix.length):normalized;if(!recursive&&rest.includes('/')){const dir=prefix+rest.split('/')[0];if(!all.has(dir))all.set(dir,{path:dir,kind:'dir',bytes:0,mtime:0});continue;}all.set(normalized,{path:normalized,kind:'file',bytes:Buffer.byteLength(String(content)),mtime:0});}
  // Databases are virtual files for listings/capacity only. They are never
  // copied into `files`, where they could overwrite a user file or be deleted.
  for(const dbPath of dbs.keys()){if(prefix&&!dbPath.startsWith(prefix))continue;const rest=prefix?dbPath.slice(prefix.length):dbPath;if(!recursive&&rest.includes('/')){const dir=prefix+rest.split('/')[0];if(!all.has(dir))all.set(dir,{path:dir,kind:'dir',bytes:0,mtime:0});continue;}if(!all.has(dbPath))all.set(dbPath,{path:dbPath,kind:'file',bytes:0,mtime:0});}
  const entries=[...all.values()].sort((a,b)=>a.path.localeCompare(b.path));let after='';if(r.cursor){try{after=Buffer.from(r.cursor,'base64').toString('utf8');}catch{}}
  const remaining=entries.filter(e=>e.path>after),page=remaining.slice(0,limit),hasMore=remaining.length>page.length;
  return {ok:true,op:'list',entries:page,hasMore,nextCursor:hasMore&&page.length?Buffer.from(page.at(-1).path).toString('base64'):null};
 };
 const items=options.items||[1,2,3].map(i=>({symbol:'sh60000'+i,name:'股票'+i,quote:{price:100,asOf:now,source:'fixture'}}));
 const cindy={
  fetch:async r=>options.fetchHandler?options.fetchHandler(r):options.fetchResponse||{ok:false,message:'fixture-fallback-offline'},
  onHostMessage:f=>{listener=f;},
  library:async r=>{
   if(unavailable)return {ok:false,errorCode:'LIBRARY_UNAVAILABLE'};
   if(r.op==='open')return {ok:true,state:'ready',usedBytes:[...files.values()].reduce((n,x)=>n+Buffer.byteLength(String(x)),0),fileCount:files.size+dbs.size,location:'fixture'};
   if(r.op==='status')return {ok:true,state:'ready',usedBytes:[...files.values()].reduce((n,x)=>n+Buffer.byteLength(String(x)),0),fileCount:files.size+dbs.size,location:'fixture'};
   if(r.op==='read')return files.has(r.path)?{ok:true,content:files.get(r.path)}:{ok:false,errorCode:'NOT_FOUND'};
   if(r.op==='write'){if(options.failLibraryWrite?.(r.path,r.content))return {ok:false,errorCode:'FIXTURE_WRITE_FAILED',message:'fixture storage write failure'};if(failReportOnce&&r.path.startsWith('reports/')){failReportOnce=false;return {ok:false,message:'fixture archive failure'};}files.set(r.path,r.content);return {ok:true};}
   if(r.op==='list')return libraryList(r);
   if(r.op==='stat'){const p=r.path;if(dbs.has(p))return {ok:true,op:'stat',path:p,kind:'file',bytes:0,mtime:0};if(files.has(p))return {ok:true,op:'stat',path:p,kind:'file',bytes:Buffer.byteLength(String(files.get(p))),mtime:0};return {ok:false,errorCode:'NOT_FOUND'};}
   if(r.op==='delete'){
    if(dbs.has(r.path))return {ok:false,errorCode:'LIBRARY_READONLY',message:'fixture database files cannot be deleted'};
    if(options.failLibraryDelete?.(r))return {ok:false,errorCode:'FIXTURE_DELETE_FAILED',message:'fixture library delete failure'};
    let existed=files.delete(r.path);if(r.recursiveDelete===true){const prefix=String(r.path).replace(/\/$/,'')+'/';for(const p of [...files.keys()])if(p.startsWith(prefix))existed=files.delete(p)||existed;}
    return {ok:true,op:'delete',path:r.path,existed};
   }
   if(r.op==='db.open'){
    try{const dbPath=String(r.dbPath||'');if(!dbPath)throw new Error('dbPath is required');if(!dbs.has(dbPath))dbs.set(dbPath,new DatabaseSync(':memory:'));return {ok:true,op:'db.open',opened:true};}catch(e){return dbFailure(e);}
   }
   if(r.op==='db.exec'){
    try{const db=dbs.get(String(r.dbPath||''));if(!db)return {ok:false,errorCode:'DB_NOT_OPEN',message:'database is not open'};const stmt=db.prepare(String(r.sql||''));if(stmt.columns().length>0)return {ok:true,op:'db.exec',rows:stmt.all(...dbParams(r.params))};const out=stmt.run(...dbParams(r.params));return {ok:true,op:'db.exec',changes:Number(out.changes),lastInsertRowid:typeof out.lastInsertRowid==='bigint'?out.lastInsertRowid.toString():out.lastInsertRowid};}catch(e){return dbFailure(e);}
   }
   if(r.op==='db.batch'){
    try{const dbPath=String(r.dbPath||''),db=dbs.get(dbPath);if(!db)return {ok:false,errorCode:'DB_NOT_OPEN',message:'database is not open'};const statements=r.statements;if(!Array.isArray(statements)||statements.length===0||statements.length>200)return {ok:false,errorCode:'DB_PARAMS_INVALID',message:'statements must contain 1 to 200 entries'};if(options.failLibraryDb?.(r))throw new Error('fixture database failure');db.exec('BEGIN');try{for(const st of statements){const stmt=db.prepare(String(st.sql||''));stmt.run(...dbParams(st.params));}db.exec('COMMIT');}catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}return {ok:true,op:'db.batch',applied:statements.length};}catch(e){return dbFailure(e);}
   }
   if(r.op==='db.check'){
    try{const db=dbs.get(String(r.dbPath||''));if(!db)return {ok:false,errorCode:'DB_NOT_OPEN',message:'database is not open'};const rows=db.prepare('PRAGMA quick_check').all();return {ok:true,op:'db.check',healthy:rows.length===1&&Object.values(rows[0])[0]==='ok',detail:String(Object.values(rows[0]||{})[0]||'')};}catch(e){return dbFailure(e);}
   }
   throw new Error(r.op);
  },
  fs:async r=>{assert.equal(r.root,'workdir');assert.ok(r.callId);exported.set(r.path,r.content);return {ok:true,bytes:Buffer.byteLength(r.content)};},
  send:async r=>{if(r.type==='routine-request'&&r.action==='publish'){published.push(r.event);if(failEvents)return {ok:false,errorCode:'FIXTURE_OFFLINE'};}if(r.type==='tool-result'){results.get(r.callId)(r);results.delete(r.callId);}return {ok:true,accepted:0,duplicate:false};},
  node:{request:async r=>{const p=r.params;let result;
   switch(r.method){case'sync_monitor':monitor.push(p);result={listening:!!p.plan};break;
   case'sectors':result={rows:(options.sectors||[{id:'BK0001',name:'行业A',changePct:1}]).map((s,i)=>({amount:(10000-i)*1000000,...s})),total:(options.sectors||[1]).length,complete:true,warnings:[]};break;
   case'news':result={rows:[{id:'n1',title:'本轮真实测试资讯',source:'fixture',url:'https://example.com/news',publishedMs:now,publishedAt:new Date(now).toISOString(),keyword:p.keyword}],warnings:[]};break;
   case'members':result={rows:items,total:3,complete:true,warnings:[],fetchedAt:now};break;
   case'assess':result=p.items.map(s=>({...s,indicators:C.indicators(options.bars||bars),klineAsOf:(options.bars||bars).at(-1)?.date,adjustment:'qfq',klineSource:'fixture'}));break;
   case'kline':result={source:'offline-fixture',adjustment:'qfq',period:'day',warnings:[],bars};break;
   case'information_source':if(options.failInformationSource)throw new Error('fixture-direct-offline');result={url:p.url,fetchedAt:Date.now(),sha256:options.sourceDigest||'a'.repeat(64),bytes:100,contentType:'application/pdf',isPdf:true,notice:'离线指纹样例'};break;
   case'information':result={symbol:p.symbol,fetchedAt:Date.now(),announcements:{status:'available',complete:true,total:1,rows:[]},financials:{status:'available',rows:[{reportPeriod:'2026-09-30',noticeDate:'2026-10-31'}]},warnings:['离线资料包样例，不是真实公司证据。']};break;
   case'regulatory_page':if(!options.regulatoryPageHandler)throw Error('fixture-native-regulatory-unavailable');result=await options.regulatoryPageHandler(p);break;
   case'instrument':result={symbol:p.symbol,category:'A股',name:'离线主体样例',fetchedAt:Date.now(),source:'offline-fixture'};break;
   case'execution':result=options.executionSnapshot||{symbol:p.symbol,priceBasis:'unadjusted',tradingStatus:{value:'unknown'}};break;
   case'quotes':result=Object.fromEntries(p.symbols.map(s=>[s,{name:options.quoteNames?.[s]||'股票'+s,price:100,asOf:options.quoteAsOf||Date.now(),priceBasis:'unadjusted',source:'fixture'}]));break;
   default:throw new Error('Unexpected RPC '+r.method);}
   return {ok:true,result};}}
 };
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[options.now()]));}static now(){return options.now();}}
 const context=vm.createContext({Date:options.now?ClockDate:Date,cindy,crypto,TextEncoder,TextDecoder,URL,URLSearchParams,console,btoa,atob,ReadableStream,CompressionStream,DecompressionStream,BroadcastChannel:class{postMessage(){}},setTimeout,clearTimeout,globalThis:null});context.globalThis=context;
 for(const name of ['core.js','calendar.js','simulation.js','chart.js','paper.js','information.js','regulatory.js','incremental.js','execution.js','forward.js','matching.js','history.js','performance.js','storage.js','repository.js','history-reset.js']){const file=path.join(root,name);if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),context);}
 const main=fs.readFileSync(path.join(root,'main.js'),'utf8').replace(/import\('[^']+'\)/g,'Promise.resolve()');
 vm.runInContext(main,context);
 async function call(tool,args={}){const callId=crypto.randomUUID();const reply=await new Promise(resolve=>{results.set(callId,resolve);listener({type:'tool-call',tool,args,callId});});return JSON.parse(JSON.stringify(reply));}
 return {call,files,monitor,exported,published,library:r=>cindy.library(r),emit:msg=>listener(msg)};
}

module.exports={host};
