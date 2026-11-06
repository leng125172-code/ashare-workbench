(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AShareHistoryReset=api;})(globalThis,function(){
'use strict';
// All paths below are plugin-Library relative, including simulation/ when used.
// The host adapter owns authorization, the external backup and stopping writers.
const FORMAT='ashare-history-reset/1',DB='storage/research.sqlite',JOURNAL='maintenance/reset-history.json';
const fields=['runs','plans','reports','scans','actions','events','paperAccounts','forwardJournals','performanceJournals','adviceSnapshots'];
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const clone=x=>JSON.parse(JSON.stringify(x));
function stable(x){if(x===undefined)return 'undefined';if(x===null||typeof x!=='object')return JSON.stringify(x);if(Array.isArray(x))return '['+x.map(stable).join(',')+']';return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';}
function modeName(mode){if(mode!=='live'&&mode!=='simulation')fail('RESET_MODE_REQUIRED','历史清理须明确live或simulation模式。');return mode;}
const prefix=mode=>mode==='simulation'?'simulation/':'';
function paths(mode){const p=prefix(mode);return {root:p+'state.json',journal:p+JOURNAL,db:p+DB};}
function validPath(path){if(typeof path!=='string'||!path||path.startsWith('/')||path.includes('\\')||path.includes('\0')||path.includes(':')||path.split('/').some(p=>!p||p==='.'||p==='..'))fail('RESET_INVALID_PATH','资料库清单包含非法相对路径，停止清理。');return path;}
function inMode(path,mode){return mode==='simulation'?path.startsWith('simulation/'):!path.startsWith('simulation/');}
function hostMetadata(path){return path.split('/').includes('.cindy-library');}
function databaseFile(path,mode){const db=paths(mode).db;return path===db||path===db+'-wal'||path===db+'-shm'||path===db+'-journal';}
function validateState(state){if(!state||state.schema!==1||!Number.isSafeInteger(state.revision)||state.revision<0)fail('RESET_INVALID_STATE','历史清理需要当前已解码状态与有效版本。');}
function retainedConfig(state,provided){const config=provided===undefined?state.config:provided;if(state.config===null||state.config===undefined){if(config!==null&&config!==undefined)fail('RESET_CONFIG_CHANGED','历史清理不能顺便创建或替换账户配置。');return null;}if(!config||typeof config!=='object'||Array.isArray(config))fail('RESET_CONFIG_CHANGED','历史清理必须保留账户配置。');for(const k of Object.keys(state.config))if(stable(config[k])!==stable(state.config[k]))fail('RESET_CONFIG_CHANGED','历史清理不能更改已保存的账户字段：'+k+'。');return clone(config);}
function counts(state){return {...Object.fromEntries(fields.map(k=>[k,Array.isArray(state[k])?state[k].length:0])),requests:Object.keys(state.requests||{}).length};}
function emptyState(state,config){return {schema:1,revision:state.revision+1,config,runs:[],reports:[],plans:[],scans:[],actions:[],events:[],requests:{},paperAccounts:[],forwardJournals:[],performanceJournals:[],adviceSnapshots:[],monitorStatus:'未启动'};}
function validateKey(key){if(typeof key!=='string'||key.length<3||key.length>120||!key.trim())fail('REQUEST_KEY_REQUIRED','历史清理需要3至120字符的稳定requestKey。');}
function create(io){
 for(const k of ['read','write','listFiles','remove','hash','clearDatabase','onRootReset'])if(typeof io?.[k]!=='function')fail('RESET_ADAPTER_REQUIRED','历史清理缺少适配接口：'+k+'。');
 async function read(path){const r=await io.read(path);if(r?.ok)return r.content;if(r?.errorCode==='NOT_FOUND')return null;fail(r?.errorCode||'RESET_READ_FAILED',r?.message||'清理资料不可读，未当作不存在。');}
 async function write(path,content){const r=await io.write(path,content);if(!r?.ok)fail(r?.errorCode||'RESET_WRITE_FAILED',r?.message||'历史清理进度未保存，请按原请求核对。');}
 async function rootHash(mode){const content=await read(paths(mode).root);return content===null?null:io.hash(content);}
 async function seal(job){const body={...job};delete body.integrity;return {...body,integrity:await io.hash(stable(body))};}
 async function save(job){const sealed=await seal(job);await write(paths(job.mode).journal,JSON.stringify(sealed));return sealed;}
 async function journal(mode){const raw=await read(paths(mode).journal);if(raw===null)return null;let x;try{x=JSON.parse(raw);}catch{fail('RESET_JOURNAL_INVALID','历史清理进度损坏，停止覆盖。');}const body={...x};delete body.integrity;if(x.format!==FORMAT||x.mode!==mode||!/^[a-f0-9]{64}$/.test(x.integrity||'')||await io.hash(stable(body))!==x.integrity)fail('RESET_JOURNAL_INVALID','历史清理进度摘要或模式不符，停止覆盖。');validateKey(x.requestKey);if(!Number.isSafeInteger(x.sourceRevision)||x.sourceRevision<0||typeof x.cleanRootContent!=='string'||!/^[a-f0-9]{64}$/.test(x.cleanRootHash||'')||!/^[a-f0-9]{64}$/.test(x.signature||'')||!/^[a-f0-9]{64}$/.test(x.previewToken||'')||(x.sourceRootHash!==null&&!/^[a-f0-9]{64}$/.test(x.sourceRootHash||'')))fail('RESET_JOURNAL_INVALID','历史清理根摘要或版本字段无效。');if(!['prepared','root_committed','database_cleared','purging','finalizing','completed'].includes(x.phase)||!Array.isArray(x.files)||!Number.isSafeInteger(x.index)||x.index<0||x.index>x.files.length)fail('RESET_JOURNAL_INVALID','历史清理阶段或文件游标无效。');for(const item of x.files){validPath(item.path);if(hostMetadata(item.path)||!inMode(item.path,mode)||item.path===paths(mode).root||item.path===paths(mode).journal||databaseFile(item.path,mode))fail('RESET_JOURNAL_INVALID','历史清理进度含跨模式或受保护路径。');}if(await io.hash(x.cleanRootContent)!==x.cleanRootHash)fail('RESET_JOURNAL_INVALID','拟提交空状态摘要不符。');return x;}
 async function pending(mode){modeName(mode);const job=await journal(mode);return job&&job.phase!=='completed'?{mode,requestKey:job.requestKey,phase:job.phase,index:job.index,total:job.files.length}:null;}
 async function inventory(mode){const entries=await io.listFiles();if(!Array.isArray(entries))fail('RESET_INVENTORY_INCOMPLETE','资料库完整文件清单不可用，停止清理。');const seen=new Set(),all=[];for(const e of entries){const path=validPath(typeof e==='string'?e:e.path);if(seen.has(path))fail('RESET_INVENTORY_INCOMPLETE','资料库清单重复，须重新完整读取。');seen.add(path);if(typeof e==='object'&&e.kind&&e.kind!=='file')continue;if(!inMode(path,mode)||hostMetadata(path))continue;const size=typeof e==='object'&&Number.isFinite(e.bytes)?e.bytes:null;all.push({path,bytes:size});}return all.sort((a,b)=>a.path.localeCompare(b.path));}
 async function plan({mode,state,config}){
  modeName(mode);validateState(state);const keep=retainedConfig(state,config),active=[...new Map((state.plans||[]).map(p=>[p.id,p])).values()].filter(p=>p.status==='active'&&(p.scheduleId||p.dailyScheduleId));
  if(active.length)fail('RESET_ACTIVE_SCHEDULE','仍有带原生调度的活动计划，先核对并暂停调度后再清理。');
  if((state.actions||[]).some(a=>a.operation!=='send_report'&&(a.status==='uncertain'||(a.status==='pending'&&a.scheduleId))))fail('RESET_SCHEDULE_RECONCILE','有调度暂停/更新待核对或结果未知，先确认原生任务已停再清理。');
  if((state.actions||[]).some(a=>a.status==='inflight'))fail('RESET_ACTION_INFLIGHT','仍有外部动作在途，先停止执行并核对回执后再清理。');
  const sourceRootHash=await rootHash(mode),all=await inventory(mode),p=paths(mode),files=all.filter(e=>e.path!==p.root&&e.path!==p.journal&&!databaseFile(e.path,mode)),databaseFiles=all.filter(e=>databaseFile(e.path,mode));
  const spec={format:FORMAT,mode,sourceRevision:state.revision,sourceRootHash,configHash:await io.hash(stable(keep)),files,databaseFiles,counts:counts(state)};
  return {spec,config:keep,previewToken:await io.hash(stable(spec))};
 }
 async function preview(a){modeName(a.mode);if(await pending(a.mode))fail('RESET_IN_PROGRESS','已有历史清理未完成，请按原requestKey续接。');const p=await plan(a);return {mode:a.mode,expectedRevision:p.spec.sourceRevision,sourceRootHash:p.spec.sourceRootHash,previewToken:p.previewToken,counts:p.spec.counts,fileCount:p.spec.files.length,databaseFiles:p.spec.databaseFiles.map(x=>x.path),files:p.spec.files,preserveConfig:true,requiresStoppedWriters:true,note:'仅预览；账户配置保留。执行前须已在库外备份、停止研究并核对原生任务；不会自动备份或绕过在途动作。'};}
 async function assertRoot(job,allowed){const actual=await rootHash(job.mode);if(!allowed.includes(actual))fail('RESET_SOURCE_CHANGED','根状态在清理期间改变，停止删除；核对外部写入后按原请求恢复。');}
 async function applyRoot(job,content,hash){await write(paths(job.mode).root,content);if(await rootHash(job.mode)!==hash)fail('RESET_ROOT_VERIFY_FAILED','空状态回读摘要不符，未继续删除历史。');await io.onRootReset({mode:job.mode,state:JSON.parse(content),rootContent:content,rootHash:hash});}
 async function execute(a){
  modeName(a.mode);validateKey(a.requestKey);if(!Number.isSafeInteger(a.expectedRevision)||a.expectedRevision<0||!/^[a-f0-9]{64}$/.test(a.previewToken||''))fail('RESET_PREVIEW_REQUIRED','先读取历史清理预览并携带原版本及previewToken。');
  const signature=await io.hash(stable({mode:a.mode,requestKey:a.requestKey,expectedRevision:a.expectedRevision,previewToken:a.previewToken}));let job=await journal(a.mode);
  if(job&&job.requestKey===a.requestKey){if(job.signature!==signature)fail('REQUEST_CONFLICT','同一历史清理requestKey的参数不同。');if(job.phase==='completed')return clone(job.result);}
  else{
   if(job&&job.phase!=='completed')fail('RESET_IN_PROGRESS','另一历史清理尚未完成，不得覆盖其进度。');
   validateState(a.state);if(a.expectedRevision!==a.state.revision)fail('REVISION_CONFLICT','状态版本已改变，重新预览后再清理。');
   const p=await plan(a);if(p.previewToken!==a.previewToken)fail('RESET_PREVIEW_STALE','资料、账户配置或文件清单已变化，重新预览后再清理。');
   const cleanRootContent=JSON.stringify(emptyState(a.state,p.config)),cleanRootHash=await io.hash(cleanRootContent);
   job=await save({format:FORMAT,mode:a.mode,requestKey:a.requestKey,signature,previewToken:a.previewToken,sourceRevision:a.expectedRevision,sourceRootHash:p.spec.sourceRootHash,phase:'prepared',files:p.spec.files,databaseFiles:p.spec.databaseFiles,index:0,deletedFiles:0,missingFiles:0,clearedCounts:p.spec.counts,cleanRootContent,cleanRootHash,startedAt:Date.now()});
  }
  if(job.phase==='prepared'){await assertRoot(job,[job.sourceRootHash,job.cleanRootHash]);await applyRoot(job,job.cleanRootContent,job.cleanRootHash);job=await save({...job,phase:'root_committed'});}
  // Reapply the cache fence on every retry, including after a process restart.
  if(!['prepared','completed'].includes(job.phase)){await assertRoot(job,job.phase==='finalizing'?[job.cleanRootHash,job.finalRootHash]:[job.cleanRootHash]);const content=job.phase==='finalizing'&&await rootHash(job.mode)===job.finalRootHash?job.finalRootContent:job.cleanRootContent;await io.onRootReset({mode:job.mode,state:JSON.parse(content),rootContent:content,rootHash:await io.hash(content)});}
  if(job.phase==='root_committed'){
   await assertRoot(job,[job.cleanRootHash]);const result=await io.clearDatabase({mode:job.mode,dbPath:paths(job.mode).db});if(result?.ok!==true)fail(result?.errorCode||'RESET_DATABASE_FAILED',result?.message||'历史数据库清理未确认，按原请求续接。');job=await save({...job,phase:'database_cleared',databaseResult:result??null});
  }
  if(job.phase==='database_cleared'||job.phase==='purging'){
   if(job.phase==='database_cleared')job=await save({...job,phase:'purging'});
   while(job.index<job.files.length){await assertRoot(job,[job.cleanRootHash]);const item=job.files[job.index],result=await io.remove(item.path);if(!result?.ok&&result?.errorCode!=='NOT_FOUND')fail(result?.errorCode||'RESET_DELETE_FAILED',result?.message||'部分历史文件未清理，按原requestKey继续。');const existed=result?.ok?result.existed!==false:false;job=await save({...job,index:job.index+1,deletedFiles:job.deletedFiles+(existed?1:0),missingFiles:job.missingFiles+(existed?0:1)});}
   await assertRoot(job,[job.cleanRootHash]);const remaining=(await inventory(job.mode)).filter(e=>e.path!==paths(job.mode).root&&e.path!==paths(job.mode).journal&&!databaseFile(e.path,job.mode));if(remaining.length)fail('RESET_NEW_FILES_DETECTED','清理期间出现未纳入预览的新文件，停止完成标记；先停止来源并核对。');
   const result={mode:job.mode,status:'completed',requestKey:job.requestKey,revision:job.sourceRevision+1,deletedFiles:job.deletedFiles,missingFiles:job.missingFiles,clearedCounts:job.clearedCounts,preserveConfig:true,databaseCleared:true,note:'本模式历史已清空，账户配置保留；不代表外部调度已取消，也不保证SQLite文件立即缩小。'};
   const state=JSON.parse(job.cleanRootContent);state.requests[job.requestKey]={signature:job.signature,result};state.historyReset={requestKey:job.requestKey,completedAt:Date.now(),clearedCounts:job.clearedCounts};const finalRootContent=JSON.stringify(state);job=await save({...job,phase:'finalizing',result,finalRootContent,finalRootHash:await io.hash(finalRootContent)});
  }
  if(job.phase==='finalizing'){if(await io.hash(job.finalRootContent)!==job.finalRootHash)fail('RESET_JOURNAL_INVALID','最终空状态摘要不符。');await assertRoot(job,[job.cleanRootHash,job.finalRootHash]);await applyRoot(job,job.finalRootContent,job.finalRootHash);job=await save({...job,phase:'completed',completedAt:Date.now()});}
  return clone(job.result);
 }
 return {preview,execute,pending};
}
return {FORMAT,DB,JOURNAL,create};
});
