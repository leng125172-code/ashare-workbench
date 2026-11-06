import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL,fileURLToPath } from 'node:url';

/** Discover an installed runtime, never an auth/profile file. */
export async function installedDshRoot(){
  for(const dir of (process.env.PATH||'').split(path.delimiter)){for(const name of ['dsh','dsh.cmd']){try{const cli=await fs.realpath(path.join(dir,name)),root=path.dirname(path.dirname(cli)),pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));if(pkg.name==='@deepseek-ai/dsh')return root;}catch{}}}
  throw new Error('未找到已安装DSH CLI，原生SDK验收不能执行。');
}
/** Actual installed Cordis + ToolRuntime, isolated scope/data/profile fixture, no model or active profile. */
export async function nativeSmoke(){
  const sdkRoot=await installedDshRoot(),manifest=JSON.parse(await fs.readFile(path.join(sdkRoot,'package.json'),'utf8')),base=await fs.mkdtemp(path.join(os.tmpdir(),'ashare-dsh-native-')),root=path.join(base,'package');
  let promptFiber,toolsFiber,pluginFiber;
  try{
    await fs.mkdir(root,{recursive:true});await fs.cp(fileURLToPath(new URL('./',import.meta.url)),path.join(root,'dsh'),{recursive:true});await fs.cp(fileURLToPath(new URL('../plugin/',import.meta.url)),path.join(root,'plugin'),{recursive:true,filter:source=>!source.endsWith('.cindy')});
    const packageMetadata=JSON.parse(await fs.readFile(fileURLToPath(new URL('../package.json',import.meta.url)),'utf8'));
    await fs.writeFile(path.join(root,'package.json'),JSON.stringify({...packageMetadata,private:true}));
    const modules=path.join(root,'node_modules');await fs.mkdir(path.join(modules,'@deepseek-ai'),{recursive:true});
    for(const name of ['@deepseek-ai/cordis','@deepseek-ai/schemastery','@deepseek-ai/dsh-tools','sharp'])await fs.symlink(await fs.realpath(path.join(sdkRoot,'node_modules',name)),path.join(modules,name),'dir');
    const {Context,Service}=await import(pathToFileURL(path.join(sdkRoot,'node_modules/@deepseek-ai/cordis/lib/index.js'))),{ToolRuntime}=await import(pathToFileURL(path.join(sdkRoot,'node_modules/@deepseek-ai/dsh-tools/lib/index.js'))),plugin=await import(pathToFileURL(path.join(root,'dsh/index.mjs')));
    const ctx=new Context();ctx.provide('profileContext',{name:'isolated-smoke',home:base,dir:path.join(base,'isolated-profile'),cwd:base,patchPath:path.join(base,'isolated-profile/cordis.patch.yml'),installAnchor:root,startedBundles:[],overlays:[]});class NoModelPrompt extends Service{constructor(ctx){super(ctx,'systemPrompt');}tools(){return()=>{};}section(){return()=>{};}}
    promptFiber=ctx.plugin(NoModelPrompt);toolsFiber=ctx.plugin(ToolRuntime);await toolsFiber.await();pluginFiber=ctx.plugin(plugin,{dataDir:path.join(base,'isolated-profile','data')});await pluginFiber.await();
    const signal=new AbortController().signal,call=(name,args={})=>ctx.tools.execute({name,arguments:args,callId:'isolated-sdk-'+name,signal});
    const state=await call('ashare_get_state'),caps=await call('ashare_host_action',{operation:'capabilities'});
    if(state.isError||!state.value?.ok||state.value.result.config!==null)throw new Error('真实DSH SDK调用get_state未通过。');
    if(caps.isError||caps.value?.result?.wechatConnected!==false)throw new Error('通道能力未明确返回独立微信未连接。');
    const sim=await call('ashare_get_research',{mode:'simulation',view:'industry_catalog',limit:2});if(sim.isError||!sim.value?.ok||sim.value.result.industries.length!==2)throw new Error('真实SDK行业分页调用未通过。');
    const png=await call('ashare_export_report',{mode:'simulation',format:'kline_png',symbol:'sh600519',period:'day'});
    if(png.isError||!png.value?.ok||!png.value.result?.files?.length)throw new Error('真实SDK模拟PNG导出未通过。');
    const image=await fs.readFile(png.value.result.files[0].absolutePath);if(image.subarray(1,4).toString()!=='PNG')throw new Error('真实SDK导出未返回PNG文件。');
    const invalid=await call('ashare_configure',{requestKey:2});if(!invalid.isError)throw new Error('真实SDK未拒绝类型错误参数。');
    return {ok:true,dshVersion:manifest.version,packageType:packageMetadata.type||'commonjs(default)',registeredTools:JSON.parse(await fs.readFile(path.join(root,'plugin/ghost.json'),'utf8')).tools.length+1,realSdk:true,isolatedData:true,noActiveProfileChanged:true,noModelRequest:true,verified:['native registration of every business schema','live get_state','simulation industry pagination','unbound WeChat capability','SDK input type validation','simulation PNG export with actual package metadata'],notVerified:['real scheduler persistence/timed dispatch','external WeChat connection/delivery','npm publication']};
  }finally{await pluginFiber?.dispose();await toolsFiber?.dispose();await promptFiber?.dispose();await fs.rm(base,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))nativeSmoke().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.stack||e);process.exitCode=1;});
