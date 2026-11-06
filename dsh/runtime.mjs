import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID, webcrypto } from 'node:crypto';
import { createLibrary,atomicWrite } from './library.mjs';
import { renderChart } from './chart.mjs';

const pluginDir=fileURLToPath(new URL('../plugin/',import.meta.url));
export class DataWorker{
  constructor({directory=pluginDir,notify=()=>{}}={}){this.directory=directory;this.notify=notify;this.pending=new Map();this.child=null;this.nextId=0;}
  start(){if(this.child)return;const child=spawn(process.execPath,[path.join(this.directory,'node/worker.cjs')],{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH||'',LANG:process.env.LANG||'C.UTF-8',HOME:process.env.HOME||''},windowsHide:true});this.child=child;let buffered=0;const lines=readline.createInterface({input:child.stdout});child.stdout.on('data',b=>{buffered+=b.length;if(buffered>16*1024*1024)this.stop(Object.assign(new Error('数据源返回超过16MiB，停止而不截断。'),{code:'DATA_SIZE_LIMIT'}));});lines.on('line',line=>{buffered=0;let m;try{m=JSON.parse(line);}catch{return;}if(m.id!==undefined){const p=this.pending.get(m.id);if(p){this.pending.delete(m.id);p.cleanup();m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}}else this.notify(m);});child.stderr.on('data',()=>{});child.stdin.on('error',e=>void this.stop(e));child.on('error',e=>this.stop(e));child.on('exit',()=>{if(this.child!==child)return;this.child=null;for(const p of this.pending.values()){p.cleanup();p.reject(Object.assign(new Error('数据工作进程已停止。'),{code:'DATA_WORKER_STOPPED'}));}this.pending.clear();});}
  async stop(error=Object.assign(new Error('数据请求已取消。'),{code:'ABORT_ERR'})){const child=this.child;this.child=null;const pending=[...this.pending.values()];this.pending.clear();for(const p of pending)p.cleanup();if(child&&child.exitCode===null&&!child.killed){await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');},2000);timer.unref();child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});}for(const p of pending)p.reject(error);}
  async request(method,params,{signal,timeoutMs=60000}={}){signal?.throwIfAborted();if(method==='sync_monitor')return {listening:false,reason:'DSH uses explicitly reconciled native schedules; no hidden Cindy monitor or credentials.'};this.start();const id=++this.nextId;return new Promise((resolve,reject)=>{let timer;const abort=()=>{void this.stop(signal?.reason instanceof Error?signal.reason:Object.assign(new Error('数据请求已取消。'),{code:'ABORT_ERR'}));};const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};this.pending.set(id,{resolve,reject,cleanup});signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>void this.stop(Object.assign(new Error('数据请求超时，工作进程已终止。'),{code:'DATA_TIMEOUT'})),timeoutMs);timer.unref();this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
}

/** Run the identical audited business engine behind DSH-owned IO seams; no tests/helpers dependency. */
export async function createRuntime({dataDir,rpc,onProgress=()=>{},directory=pluginDir,pngRenderer=renderChart}={}){
  if(!dataDir)throw new Error('必须指定独立DSH数据目录。');let current=null,listener,closed=false,tail=Promise.resolve();const callbacks=new Map(),channels=new Set();
  const library=await createLibrary(dataDir,{signal:()=>current?.signal});
  const worker=rpc?null:new DataWorker({directory,notify:m=>listener?.({type:'event',name:'node-notification',method:m.method,params:m.params})});
  async function outputPath(relative){if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split(/[\\/]/).some(x=>x==='..'))throw new Error('导出路径无效。');const base=current?.workDir||path.join(dataDir,'exports'),root=path.resolve(base),target=path.resolve(root,relative);if(!target.startsWith(root+path.sep))throw new Error('导出路径越界。');await fs.mkdir(root,{recursive:true,mode:0o700});let cursor=root;for(const part of path.relative(root,target).split(path.sep)){cursor=path.join(cursor,part);try{if((await fs.lstat(cursor)).isSymbolicLink())throw new Error('导出路径含符号链接。');}catch(e){if(e.code!=='ENOENT')throw e;}}return target;}
  const host={
    onHostMessage:fn=>{listener=fn;},library:library.request,
    node:{request:async r=>{try{current?.signal?.throwIfAborted();return {ok:true,result:await (rpc?rpc(r.method,r.params,{signal:current?.signal}):worker.request(r.method,r.params,{signal:current?.signal,timeoutMs:r.timeoutMs}))};}catch(e){return {ok:false,message:String(e.message||e),errorCode:e.code||'DATA_SOURCE_ERROR'};}}},
    fetch:async r=>{try{const signal=AbortSignal.any([...(current?.signal?[current.signal]:[]),AbortSignal.timeout(r.timeoutMs||15000)]),u=new URL(r.url);if(u.protocol!=='https:'||u.username||u.password)throw new Error('仅允许公开HTTPS原文。');const response=await fetch(u,{method:r.method||'GET',headers:r.headers,signal,redirect:'error'});const reader=response.body?.getReader(),parts=[];let size=0;if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8*1024*1024){await reader.cancel();throw new Error('原文超过8MiB，拒绝截断。');}parts.push(Buffer.from(value));}return {ok:response.ok,status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.concat(parts).toString('utf8'),truncated:false};}catch(e){return {ok:false,message:String(e.message||e),errorCode:e.code||'SOURCE_UNAVAILABLE'};}},
    fs:async r=>{try{current?.signal?.throwIfAborted();if(r.op!=='write'||r.root!=='workdir'||!r.callId||r.callId!==current?.id)throw new Error('仅当前原生工具可导出文件。');const absolutePath=await outputPath(r.path),data=r.encoding==='base64'?Buffer.from(r.content,'base64'):Buffer.from(r.content);await atomicWrite(absolutePath,data);return {ok:true,bytes:data.length,absolutePath};}catch(e){return {ok:false,errorCode:e.code||'EXPORT_FAILED',message:String(e.message||e)};}},
    targets:{list:async()=>({targets:[]}),resolve:async()=>{throw new Error('DSH不使用Cindy伙伴目标。');},send:async()=>{throw new Error('DSH未连接独立消息通道，未发送。');}},
    send:async m=>{if(m.type==='tool-result'){const p=callbacks.get(m.callId);if(p){callbacks.delete(m.callId);p(JSON.parse(JSON.stringify(m)));}return {ok:true};}if(m.type==='tool-progress'){onProgress(m.message);return {ok:true};}if(m.type==='routine-request')return {ok:false,errorCode:'DSH_NATIVE_ROUTINE_UNBOUND',message:'使用DSH原生调度与独立IM回执，不自动投递Cindy例行任务。'};return {ok:false,errorCode:'DSH_UNSUPPORTED_HOST_CALL'};}
  };
  class LocalChannel{constructor(){channels.add(this);}postMessage(){}close(){channels.delete(this);}}
  const context=vm.createContext({cindy:host,crypto:webcrypto,TextEncoder,TextDecoder,URL,URLSearchParams,console,btoa,atob,ReadableStream,CompressionStream,DecompressionStream,BroadcastChannel:LocalChannel,setTimeout,clearTimeout,globalThis:null},{codeGeneration:{strings:false,wasm:false}});context.globalThis=context;
  try{
    const source=await fs.readFile(path.join(directory,'main.js'),'utf8'),imports=[...source.matchAll(/import\(['"](.\/[^'"]+\.js)['"]\)/g)].map(x=>x[1]);
    for(const name of new Set(imports)){if(name.includes('..'))throw new Error('业务模块路径越界。');vm.runInContext(await fs.readFile(path.join(directory,name),'utf8'),context,{filename:name});}
    vm.runInContext(source.replace(/import\(['"](.\/[^'"]+\.js)['"]\)/g,'Promise.resolve()'),context,{filename:'ashare-main.js'});
  }catch(e){await worker?.stop();await library.close();throw e;}
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'ghost.json'),'utf8'));
  async function dispatch(tool,args,id){return new Promise(resolve=>{callbacks.set(id,resolve);listener({type:'tool-call',tool,args:JSON.parse(JSON.stringify(args)),callId:id});});}
  async function execute(tool,args={},options={}){if(closed)throw new Error('DSH投研运行时已关闭。');options.signal?.throwIfAborted();const id=randomUUID();current={...options,id};try{
    if(tool==='export_report'&&args.format==='kline_png'){
      const reply=await dispatch('stock_detail',{...args,includeInformation:false},id);if(!reply.ok)return reply;const data=reply.result,items=data.items||[data],files=[];
      for(const item of items){options.signal?.throwIfAborted();const png=await pngRenderer(item,{mode:args.mode||'live',symbol:item.symbol,position:item.position});options.signal?.throwIfAborted();if(png.length>5*1024*1024)throw new Error('导出PNG超过微信5MiB限制。');const relativePath='ashare-charts/'+(args.mode||'live')+'/'+(data.planId||'specified')+'/'+item.symbol+'-'+(args.period||'day')+'-'+Date.now()+'.png',absolutePath=await outputPath(relativePath);await atomicWrite(absolutePath,png);files.push({symbol:item.symbol,relativePath,absolutePath,bytes:png.length,simulation:args.mode==='simulation',source:item.source,lastBar:item.bars.at(-1)?.date,actionId:args.reportId?args.reportId+'.wechat.image.'+item.symbol+'.'+(args.period||'day'):null});}
      return {type:'tool-result',callId:id,ok:true,result:{mode:args.mode||'live',format:'png',files,total:data.total||files.length,nextOffset:data.nextOffset??null,planId:data.planId||null,planRevision:data.planRevision||null}};
    }
    return await dispatch(tool,args,id);
  }catch(e){return {type:'tool-result',callId:id,ok:false,errorCode:e.code||'DSH_RUNTIME_ERROR',message:String(e.message||e)};}finally{current=null;}}
  return {manifest,dataDir,library:library.request,context,call(tool,args,options={}){const task=tail.then(()=>execute(tool,args,options));tail=task.catch(()=>{});return task;},async close(){if(closed)return;closed=true;await worker?.stop();await tail.catch(()=>{});for(const channel of channels)channel.close();await library.close();}};
}
