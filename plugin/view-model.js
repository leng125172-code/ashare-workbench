(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AShareViewModel=api;})(globalThis,()=>{
  'use strict';
  function overview(state,now=Date.now()){
    const p=state.latestPlan,c=state.config,run=state.latestRun;
    const planStatus=p?.status==='active'&&p.expiresAt<=now?'expired':p?.status;
    const researching=run&&['collecting','collected','judging'].includes(run.status);
    const stage=!c?'first':researching?'researching':planStatus||'ready';
    const reportCount=(state.reports||[]).filter(r=>r.status==='completed').length;
    const actions=state.pendingActions||[];
    const failed=actions.filter(a=>a.status==='failed').length,uncertain=actions.filter(a=>a.status==='uncertain'||a.status==='inflight').length;
    const canReview=!!(c?.partnerTarget&&state.activePlan?.status==='active'&&state.activePlan.expiresAt>now);
    return {stage,planStatus,reportCount,failed,uncertain,actionCount:actions.length,canReview,hasPartner:!!c?.partnerTarget,hasConfig:!!c};
  }
  function actionSummary(a){
    if(a.status==='failed')return {tone:'danger',title:'未完成',text:a.operation==='send_report'?'报告未送达。请先核对微信连接、文件和投递回执，再决定如何处理。':'复查任务未完成，请核对原生任务的实际状态。'};
    if(['uncertain','inflight'].includes(a.status))return {tone:'warning',title:'待确认',text:'尚未确认最终结果。请先核对回执，避免重复发送或重复创建任务。'};
    return {tone:'neutral',title:'待处理',text:a.operation==='send_report'?'报告已留在待办中，尚未确认送达。':'此项计划变更尚待执行或核对。'};
  }
  return {overview,actionSummary};
});
