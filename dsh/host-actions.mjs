import { createHash } from 'node:crypto';
const fail=(code,message)=>Object.assign(new Error(message),{code});
const digest=s=>createHash('sha256').update(s).digest('hex').slice(0,24);
const journalPath='dsh-host-action-journal.json';
async function unwrap(runtime,tool,args,exec){const r=await runtime.call(tool,args,{signal:exec?.signal,workDir:exec?.agent?.session?.header?.cwd});if(!r.ok)throw fail(r.errorCode,r.message);return r.result;}
const expectationHash=e=>createHash('sha256').update(JSON.stringify(e)).digest('hex');
const cron=s=>typeof s==='string'?s.trim().replace(/\s+/g,' '):null;
function expectationFor(action,sessionId){
  const desired=action.desired,marker='[AShare action:'+action.id+']';
  if(typeof desired?.name!=='string'||!desired.name.trim()||typeof desired.prompt!=='string'||!desired.prompt.trim())throw fail('DSH_SCHEDULE_EXPECTATION_INVALID','原调度意图缺少完整名称或指令。');
  const timing=action.role==='daily_scan'?{kind:'cron',expression:cron(desired.cronExpr),timeZone:desired.timezone||'Asia/Shanghai'}:{kind:'every',everySeconds:Math.floor(desired.intervalMs/1000)};
  if(timing.kind==='cron'&&(!timing.expression||timing.expression.split(' ').length!==5)||timing.kind==='every'&&(!Number.isSafeInteger(timing.everySeconds)||timing.everySeconds<60))throw fail('DSH_SCHEDULE_EXPECTATION_INVALID','调度意图的周期参数不完整。');
  return {schema:1,actionId:action.id,sessionId,marker,title:desired.name.trim(),prompt:(marker+'\n使用ashare_*工具执行以下计划复核；先读取实际计划状态和到期时间，暂停/结束/过期不重建计划或发送投资报告。DSH没有零模型交易日预钩子，休市先跳过研究。\n'+desired.prompt).trim(),timing};
}
function savedExpectation(old,actionId,sessionId){
  const e=old?.expectation;
  if(!e||e.schema!==1||e.actionId!==actionId||e.sessionId!==sessionId||e.marker!=='[AShare action:'+actionId+']'||typeof e.title!=='string'||typeof e.prompt!=='string'||!e.prompt.startsWith(e.marker+'\n')||!e.timing||!['cron','every'].includes(e.timing.kind)||e.timing.kind==='every'&&(!Number.isSafeInteger(e.timing.everySeconds)||e.timing.everySeconds<60)||e.timing.kind==='cron'&&(typeof e.timing.expression!=='string'||e.timing.expression!==cron(e.timing.expression)||e.timing.expression.split(' ').length!==5||typeof e.timing.timeZone!=='string'||!e.timing.timeZone)||old.expectationSha256!==expectationHash(e))throw fail('DSH_SCHEDULE_EXPECTATION_MISSING','没有调用前完整保存且指纹一致的调度预期；不能仅凭ID或动作标识认定成功。');
  return e;
}
function matchesNative(record,expected,knownId){
  if(!record||typeof record.id!=='string'||!record.id||(knownId&&record.id!==knownId)||record.title!==expected.title||record.prompt!==expected.prompt||!record.prompt.startsWith(expected.marker+'\n'))return false;
  if(Object.hasOwn(record,'sessionId')&&record.sessionId!==expected.sessionId)return false;
  if(record.active===false||record.state==='inactive')return false;
  const t=expected.timing;
  return t.kind==='every'?record.kind==='every'&&record.everySeconds===t.everySeconds:record.kind==='cron'&&cron(record.expression)===t.expression&&record.timeZone===t.timeZone;
}
function changeFor(expected){const t=expected.timing;return t.kind==='cron'?{kind:'cron',cron:{expression:t.expression,time_zone:t.timeZone}}:{kind:'every',every_seconds:t.everySeconds};}
export function hostActionManager(runtime,ctx){
  const native=()=>ctx.get?.('schedule')||ctx.schedule;
  async function journal(){const r=await runtime.library({op:'read',path:journalPath});if(r.ok){const j=JSON.parse(r.content);if(j.schema!==1||!j.actions)throw fail('DSH_JOURNAL_INTEGRITY','调度对账日志格式无效。');return j;}if(r.errorCode==='ENOENT'||r.errorCode==='NOT_FOUND')return {schema:1,actions:{}};throw fail(r.errorCode,r.message);}
  async function save(j){const r=await runtime.library({op:'write',path:journalPath,content:JSON.stringify(j)});if(!r.ok)throw fail(r.errorCode,r.message);}
  let tail=Promise.resolve();
  async function act(a,exec={}){
    const schedule=native(),capabilities={platform:'dsh',nativeSchedule:!!schedule,createSchedule:typeof schedule?.create==='function',updateSchedule:typeof schedule?.update==='function',pauseSchedule:false,nativePreRunHook:false,expiryGuard:'prompt checks actual plan status and expiration; no host expireAt support',wechatConnected:false,reportDelivery:'unbound; report actions remain pending; connect independent DSH channel/MCP and record only actual messageId',dataIsolatedFromCindy:true,advisoryOnly:true};
    if(a.operation==='capabilities')return {ok:true,result:capabilities};
    try{
      exec.signal?.throwIfAborted();const agent=exec.agent,sessionId=agent?.session?.id;
      if(!sessionId)throw fail('DSH_SESSION_REQUIRED','原生调度必须绑定实际DSH调用者Session。');
      if(Math.max(agent.session.header?.delegationDepth||0,agent.options?.subagentDepth||0)>0)throw fail('PARENT_ONLY_WRITE','子代理不能创建、更新或核对原生调度。');
      if(a.mode==='simulation')throw fail('SIMULATION_SIDE_EFFECT_BLOCKED','模拟测试不创建真实DSH原生调度。');
      if(!schedule)throw fail('DSH_SCHEDULE_UNAVAILABLE','当前DSH scope未启用原生Schedule，调度待办保留。');
      if(!a.requestKey||a.requestKey.length<3||a.requestKey.length>80||!a.actionId)throw fail('REQUEST_KEY_REQUIRED','需要3至80字符稳定requestKey及真实actionId。');
      const mode='live',s=await unwrap(runtime,'get_state',{mode},exec),action=s.pendingActions.find(x=>x.id===a.actionId);
      const j=await journal(),old=j.actions[a.actionId],key='dsh-'+digest(a.requestKey+':'+a.actionId);
      if(old?.sessionId&&old.sessionId!==sessionId)throw fail('DSH_SESSION_MISMATCH','这条待办属于另一个DSH Session，不跨会话接管。');
      if(a.operation==='reconcile_schedule'){
        const expected=savedExpectation(old,a.actionId,sessionId),rows=await schedule.list({sessionId}),matches=rows.filter(x=>matchesNative(x,expected,old.externalId));
        if(matches.length!==1)throw fail('DSH_SCHEDULE_UNCONFIRMED','原生调度未唯一匹配已保存的完整指令、名称、周期、Session和已知ID；结果仍未知，不重复创建或标记成功。');
        const actual=matches[0];
        if(!action&&old.state==='succeeded')return {ok:true,result:{actionId:a.actionId,nativeId:actual.id,alreadyRecorded:true,currentNativeVerified:true,historicalAction:true}};
        await unwrap(runtime,'record_receipt',{mode,requestKey:key+'-receipt',actionId:a.actionId,status:'succeeded',externalId:actual.id,message:'DSH原生list唯一匹配调用前保存的完整指令、名称、周期、Session及已知ID；真实调度ID。'});
        j.actions[a.actionId]={...old,state:'succeeded',sessionId,externalId:actual.id,recordedAt:Date.now()};await save(j);return {ok:true,result:{actionId:a.actionId,nativeId:actual.id,reconciled:true,nativePreRunHook:false}};
      }
      if(!action){if(old?.state==='succeeded')return {ok:true,result:{actionId:a.actionId,nativeId:old.externalId,alreadyRecorded:true,historicalReceipt:true}};throw fail('ACTION_NOT_PENDING','待办不在当前未完成目录中。');}
      if(action.operation==='send_report')throw fail('WECHAT_NOT_CONNECTED','DSH没有独立微信连接，未认领、未发送；不能借用Cindy授权。');
      if(action.operation==='pause')throw fail('DSH_PAUSE_UNSUPPORTED','DSH当前Schedule没有暂停接口；保留待办，不删除后假称原ID仍可恢复。');
      if(!['create','update'].includes(action.operation))throw fail('DSH_ACTION_UNSUPPORTED','当前适配器仅执行本计划create/update调度。');
      if(a.operation!=='apply_schedule')throw fail('DSH_ACTION_UNSUPPORTED','未知宿主待办操作。');
      if(old&&old.state!=='failed')throw fail('DSH_RECONCILE_REQUIRED','此动作已有尝试日志，先reconcile_schedule，不重复创建。');
      expectationFor(action,sessionId);
      const claim=await unwrap(runtime,'claim_action',{mode,requestKey:key+'-claim',actionId:action.id,...(a.retryFailed?{retryFailed:true}:{})},exec);
      const expected=expectationFor(claim,sessionId);
      j.actions[action.id]={state:'inflight',sessionId,requestKey:a.requestKey,expectation:expected,expectationSha256:expectationHash(expected),...(claim.operation==='update'?{externalId:claim.scheduleId}:{}),attemptedAt:Date.now()};await save(j);
      let dispatched=false,actual;
      try{
        exec.signal?.throwIfAborted();const timing=changeFor(expected),{title,prompt}=expected;
        if(claim.operation==='create'){dispatched=true;actual=await schedule.create(sessionId,{title,prompt,...(timing.kind==='cron'?{cron:timing.cron}:{every_seconds:timing.every_seconds})},exec.signal);}
        else{
          const rows=await schedule.list({sessionId}),observed=rows.find(x=>x.id===claim.scheduleId);
          if(!observed)throw fail('DSH_SCHEDULE_NOT_FOUND','已绑定原生调度不存在，不自动补建新ID。');
          const previous=Object.entries(j.actions).reverse().filter(([id,entry])=>id!==claim.id&&entry.state==='succeeded'&&entry.externalId===claim.scheduleId&&entry.sessionId===sessionId).sort((a,b)=>(b[1].recordedAt||0)-(a[1].recordedAt||0))[0];
          if(!previous||!matchesNative(observed,savedExpectation(previous[1],previous[0],sessionId),claim.scheduleId))throw fail('DSH_SCHEDULE_UNCONFIRMED','已绑定调度不再匹配最近一次确认的完整预期，拒绝覆盖被外部改用的任务。');
          exec.signal?.throwIfAborted();dispatched=true;const updated=await schedule.update({sessionId,id:observed.id,expected:observed,title,prompt,change:timing},exec.signal);if(!updated.record)throw fail(updated.code||'DSH_SCHEDULE_UPDATE_REFUSED','原生调度拒绝更新。');actual=updated.record;
        }
        if(typeof actual?.id!=='string'||!actual.id)throw fail('DSH_SCHEDULE_NO_RECEIPT','原生调用没有返回实际调度ID。');
        if(claim.operation==='update'&&actual.id!==claim.scheduleId)throw fail('DSH_SCHEDULE_ID_MISMATCH','原生更新返回了不同调度ID，保留原绑定，不确认成功。');
        j.actions[action.id]={...j.actions[action.id],externalId:actual.id,nativeRecord:actual};await save(j);
        const rows=await schedule.list({sessionId});if(rows.filter(x=>matchesNative(x,expected,actual.id)).length!==1)throw fail('DSH_SCHEDULE_UNCONFIRMED','创建/更新后原生完整指令、名称、周期、Session及ID读回未确认，不标记成功。');
        await unwrap(runtime,'record_receipt',{mode,requestKey:key+'-receipt',actionId:action.id,status:'succeeded',externalId:actual.id,message:'真实DSH原生调度已创建/更新且list读回；无原生pre-run-hook/expireAt，提示词核对计划和交易日。'});
        j.actions[action.id]={...j.actions[action.id],state:'succeeded',recordedAt:Date.now()};await save(j);
        return {ok:true,result:{actionId:action.id,nativeId:actual.id,record:actual,nativePreRunHook:false,expiryGuard:'prompt_only'}};
      }catch(e){const status=dispatched?'uncertain':'failed';j.actions[action.id]={...j.actions[action.id],state:status,errorCode:e.code||'DSH_SCHEDULE_ERROR'};await save(j).catch(()=>{});await unwrap(runtime,'record_receipt',{mode,requestKey:key+'-'+status,actionId:action.id,status,...(actual?.id?{externalId:actual.id}:{}),message:String(e.message||e)}).catch(()=>{});throw e;}
    }catch(e){return {ok:false,errorCode:e.code||'DSH_HOST_ERROR',message:String(e.message||e)};}
  }
  return (args,exec)=>{const task=tail.then(()=>act(args,exec));tail=task.catch(()=>{});return task;};
}
