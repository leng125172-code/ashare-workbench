const allowed=new Set(['type','oneOf','properties','required','additionalProperties','items','enum','const','description','title','default','examples']);
/** DSH's enforced JSON-schema subset has no numeric/length keywords or type arrays.
 * Shared business validators remain authoritative; union types become disjoint oneOf branches. */
export function dshSchema(source={}){
  if(Array.isArray(source.type))return {oneOf:source.type.map(type=>dshSchema({...source,type,...(source.enum?{enum:source.enum.filter(v=>type==='null'?v===null:typeof v===type)}:{})}))};
  const out={};for(const [key,value]of Object.entries(source)){if(!allowed.has(key))continue;if(key==='properties')out[key]=Object.fromEntries(Object.entries(value).map(([k,s])=>[k,dshSchema(s)]));else if(key==='items')out[key]=dshSchema(value);else if(key==='oneOf')out[key]=value.map(dshSchema);else out[key]=value;}return out;
}
const json=value=>JSON.parse(JSON.stringify(value));
const render=(_args,value)=>[{type:'text',text:JSON.stringify(value)}];
const readOnly=new Set(['get_state','get_research','list_industries']);
export function definitions(runtime,hostActions){
  const tools=runtime.manifest.tools.map(tool=>({
    name:'ashare_'+tool.name,
    description:tool.description+' DSH独立资料，非Cindy账户；子代理只读，配置/保存/计划/调度/IM由主代理独占。',
    parameters:dshSchema(tool.parameters),output:{schema:{type:'object'},render},
    async execute(args,exec){
      const depth=Math.max(exec.agent?.session?.header?.delegationDepth||0,exec.agent?.options?.subagentDepth||0);
      if(depth&&!readOnly.has(tool.name))return {ok:false,errorCode:'PARENT_ONLY_WRITE',message:'子代理只能读取行业/资讯输入，不可写配置、研究、计划或回执。'};
      const workDir=exec.agent?.session?.header?.cwd;
      return json(await runtime.call(tool.name,args,{signal:exec.signal,workDir}));
    }
  }));
  tools.push({name:'ashare_host_action',description:'读取DSH实际通道能力，或显式执行/核对本研究的原生调度待办。不会自动发送微信。未绑定独立微信时保留待发送。',parameters:{type:'object',properties:{operation:{type:'string',enum:['capabilities','apply_schedule','reconcile_schedule']},mode:{type:'string',enum:['live','simulation']},actionId:{type:'string'},requestKey:{type:'string'},retryFailed:{type:'boolean'}},required:['operation'],additionalProperties:false},output:{schema:{type:'object'},render},execute:(a,e)=>hostActions(a,e)});
  return tools;
}
