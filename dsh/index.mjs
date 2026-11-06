import path from 'node:path';
import os from 'node:os';
import z from '@deepseek-ai/schemastery';
import {validateJsonSchemaValue,ToolArgsError} from '@deepseek-ai/dsh-tools';
import { createRuntime } from './runtime.mjs';
import { definitions } from './definitions.mjs';
import { hostActionManager } from './host-actions.mjs';

export const name='ashare-workbench';
export const inject=['tools','profileContext'];
export const Config=z.object({
  dataDir:z.string().description('独立DSH资料目录。留空使用当前profile下的storages/ashare-workbench；不能指向Cindy资料库或非空外部目录。').default(''),
});
export async function apply(ctx,config={}){
  const profile=ctx.profileContext,profileName=profile?.name||'standalone';
  if(!/^[A-Za-z0-9_-]+$/.test(profileName))throw new Error('DSH profile名称不能作为安全目录名。');
  const dataDir=config.dataDir||path.join(profile?.home||path.join(os.homedir(),'.dsh'),'storages','ashare-workbench',profileName);
  const runtime=await createRuntime({dataDir});
  ctx.effect(()=>()=>runtime.close());
  const hostContext={schedule:null};
  ctx.inject(['schedule'],scope=>{const service=scope.schedule;hostContext.schedule=service;scope.effect(()=>()=>{if(hostContext.schedule===service)hostContext.schedule=null;});});
  const hostActions=hostActionManager(runtime,hostContext);
  for(const definition of definitions(runtime,hostActions)){const execute=definition.execute;definition.execute=async(args,exec)=>{const violations=validateJsonSchemaValue(definition.parameters,args);if(violations.length)throw new ToolArgsError(violations);return execute(args,exec);};ctx.tools.register(definition);}
}
