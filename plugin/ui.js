'use strict';
const $=s=>document.querySelector(s),onMobile=!!globalThis.cindyMobile;
let state=null,report=null,chart=null,chartQuery=null,stockGeneration=0,reportGeneration=0,workspaceReady=false;
const fmt=(n,p=2)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('zh-CN',{maximumFractionDigits:p}):'—';
const at=t=>t?new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'未确认';
const statusLabel=s=>({active:'计划有效',paused:'已暂停',expired:'已到期',completed:'已完成',failed:'未完成',pending:'待处理',inflight:'处理中 / 等待回执',uncertain:'结果待确认',superseded:'已由新计划替代',proposal_only:'建议待采用'})[s]||s;
const actionLabel=a=>a.operation==='send_report'?(a.format==='image'?'微信K线图片 '+(a.symbol||''):a.format==='file'?'微信完整报告':'微信摘要'):({create:'创建复查任务',update:'更新复查任务',pause:'暂停复查任务'})[a.operation]||'计划跟踪';
function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function notice(text,error=false){$('#status').hidden=false;$('#status').textContent=text;$('#status').className='notice'+(error?' error':'');}
function request(operation,args={},mode=$('#data-mode').value){return AShareUIClient.request(operation,args,mode);}
AShareUIClient.subscribe(m=>{
  if(m?.type==='startup-error')notice(m.message,true);
  if(m?.type==='changed'&&(!m.mode||m.mode===$('#data-mode').value))refresh().catch(()=>{});
});
const editor=AShareConfigEditor.mount($('#configuration'),{request,onSaved:async s=>{state=s;renderState();},onNext:()=>{go('overview');startResearch().catch(e=>notice(e.message,true));}});
const trendViewer=AShareTrendChart.mount($('#trend-chart'),{onPeriod:async period=>{if(!chartQuery)return;const prior={...chartQuery,period};$('#stock-code').value=prior.symbol;$('#stock-name').value=prior.keyword;$('#stock-period').value=period;await loadStock();}});
let refreshGeneration=0;
async function busy(button,fn){
  if(button.disabled||button.getAttribute('aria-busy')==='true')return;
  const label=({'launch':'发起中…','home-primary':'处理中…','export':'导出中…','send-stock':'提交中…','send-recommended':'提交中…','scan-plan':'提交中…','paper-refresh':'读取中…'})[button.id]||(button.closest('#stock-form')?'查询中…':'处理中…');
  const done=AShareButton.begin(button,label);
  try{await fn();}catch(e){notice(e.message,true);}finally{done();if(button.isConnected){if(button.id==='send-stock')button.disabled=onMobile||!workspaceReady||!chart?.bars?.length||!state?.config?.partnerTarget;if(button.id==='launch'||button.id==='home-primary')button.disabled=!workspaceReady;}}
}
function stat(container,label,value){const d=el('div',undefined,'stat');d.append(el('small',label),el('strong',value));container.append(d);}
function row(container,title,detail){const d=el('div',undefined,'row');d.append(el('strong',title),el('p',detail,'muted'));container.append(d);}
function sourceLink(container,label,url){try{const u=new URL(url);if(u.protocol!=='https:')return;const a=el('a',label);a.href=u.href;a.rel='noopener noreferrer';container.append(a);}catch{}}
function renderInformation(info,sources){
  const box=$('#stock-news'),a=info.announcements||{},f=info.financials||{};
  row(box,'资讯资料包：待正文互核',`近90日公告 ${a.rows?.length||0}/${a.total??'未知'} · ${a.complete?'本次目录读完':'目录不完整'}；目录不代表无风险。`);
  for(const n of (a.rows||[]).slice(0,10)){const d=el('div',undefined,'row');sourceLink(d,n.title,n.url);d.append(el('p',`${at(n.publishedMs)} · 官方披露目录，尚未读取PDF正文。`,'muted'));box.append(d);}
  const last=f.rows?.[0];if(last){row(box,'财务参考 · '+last.reportPeriod,`披露日期 ${last.noticeDate||'缺失'}；更新日期 ${last.updateDate||'缺失'}；来源东方财富聚合数据，需对照同一期官方报告。`);for(const [key,m] of Object.entries(last.metrics||{}))row(box,m.providerField,`${m.value??'缺失'} ${m.unit} · ${key}；不同字段不可互相替代。`);}
  for(const w of info.warnings||[])row(box,'资料提示',w);
  if(sources.length){const d=el('div',undefined,'row');d.append(el('strong','官方检索入口（按行业/公司继续核验）'));for(const source of sources){const line=el('p');sourceLink(line,source.label,source.url);d.append(line);}box.append(d);}
}
function go(tab){
  const titles={overview:['今日总览','投研工作台'],reports:['行业研究','从行业方向到投资依据'],stock:['个股研判','行情 · K线 · 公司资料'],plans:['投资计划','把每个判断放进可复查的计划'],activity:['消息与复查','关注结果，也保留过程'],config:['账户设置','资金与仓位设置'],paper:['模拟账本','观察扣费后的结果']};
  for(const section of document.querySelectorAll('.tab'))section.hidden=section.id!==tab;
  for(const b of document.querySelectorAll('[data-tab]')){const selected=b.dataset.tab===tab;b.setAttribute('aria-selected',String(selected));if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
  $('#page-title').textContent=titles[tab][0];$('#page-kicker').textContent=titles[tab][1];$('#status').hidden=true;$('#research-guide').hidden=true;
  if(tab==='config')editor.focus();if(tab==='reports')readReport().catch(()=>{});if(tab==='stock')draw();
}
const dashboardReports=new Map();
function placeholder(container,title,description,buttonText,action){const d=el('div',undefined,'empty-state');d.append(el('span','◫','empty-glyph'),el('h3',title),el('p',description));if(buttonText){const b=el('button',buttonText,'primary');b.onclick=action;d.append(b);}container.replaceChildren(d);}
function renderDashboard(){
  const m=AShareViewModel.overview(state),p=state.latestPlan,c=state.config;
  const text={first:['填写账户资料','保存资金、持仓和风险设置后，即可开始研究。也可以直接查股票。','填写资金与持仓'],ready:['资料已就绪，开始第一轮研究','研究将结合行业、公司消息和K线，给出有依据的候选与计划。保存的资料不会自动触发研究。',m.hasPartner?'开始第一轮研究':'查看如何开始研究'],researching:['这一轮研究正在进行','已保存的进度会继续保留。研究结论、计划和报告以实际完成记录为准。','查看研究记录'],active:['先看当前计划，再决定下一步','对照最近一次研究与计划条件，再决定下一步；不要把历史点位直接当作当前买入信号。','查看当前计划'],paused:['当前计划已暂停','暂停期间保留原判断和记录。先核对计划有效期和研究依据，再决定是否恢复。','检查暂停的计划'],expired:['计划已到期，先重新评估','到期计划保留供复盘，不能继续当作当前配置依据。重新研究不会自动执行交易。','查看到期计划'],completed:['上一份计划已结束','可以查看历史判断和复盘记录；若要开启下一轮，先确认账户资料仍然准确。','查看历史计划'],proposal_only:['建议已生成，等待你评估','先看建议依据、风险与失效条件，再决定是否采用。建议不代表已买入。','查看建议计划']}[m.stage]||['查看当前计划','以最近一次核验的状态和依据为准。','查看计划'];
  $('#hero-label').textContent=m.hasConfig?'当前进度':'开始你的投研流程';$('#hero-title').textContent=text[0];$('#hero-description').textContent=text[1];$('#home-primary').textContent=text[2];$('#home-primary').disabled=false;
  $('#home-primary').onclick=e=>busy(e.currentTarget,async()=>{if(m.stage==='first')go('config');else if(m.stage==='ready')await startResearch();else if(m.stage==='researching')go('reports');else go('plans');});
  $('#launch').disabled=false;$('#launch').textContent=m.hasConfig?'发起研究':'完善账户资料';
  $('#home-journey').replaceChildren();for(const [i,title,done] of [[1,'建立账户资料',!!c],[2,'形成研究建议',m.reportCount>0],[3,'核对复查安排',false]]){const d=el('div',undefined,'journey-step'+(done?' done':''));d.append(el('small',(done?'已记录 · ':'STEP ')+String(i).padStart(2,'0')),el('strong',title));$('#home-journey').append(d);}
  $('#account-summary').replaceChildren();$('#edit-config').textContent=c?'修改资料 →':'完善资料 →';
  if(c){$('#account-summary').append(el('span','已记录可用现金','account-caption'));const amount=el('div',undefined,'account-amount');amount.append(el('small','¥'),document.createTextNode(fmt(c.cash)));$('#account-summary').append(amount);const facts=el('div',undefined,'account-facts');facts.append(el('span','实际持仓 '+c.holdings.length+' 只'),el('strong','股票上限 '+fmt(c.maxEquityWeight*100)+'%'));$('#account-summary').append(facts);}else{$('#account-summary').append(el('p','尚未填写账户资料'),el('p','填入实际资金与风险范围后，才能生成适合你的配仓建议。','muted'));}
  $('#stats').hidden=!c;$('#stats').replaceChildren();if(c){stat($('#stats'),'完成的研究',m.reportCount+' 轮');stat($('#stats'),'计划状态',p?statusLabel(m.planStatus):'尚未形成');stat($('#stats'),'待核对事项',m.actionCount+' 项');}
  $('#home-attention').replaceChildren();$('#attention-count').textContent=m.actionCount?m.actionCount+' 项':'暂无计划待办';
  const item=(title,description)=>{const d=el('div',undefined,'attention-item');d.append(el('strong',title),el('p',description));$('#home-attention').append(d);};
  if(m.failed)item('有 '+m.failed+' 项操作未完成','报告投递或复查需要核对。详细原因已保留，不会自动重试。');
  if(m.uncertain)item('有 '+m.uncertain+' 项结果待确认','先核对回执，避免重复发送或创建任务。');
  if(!m.failed&&!m.uncertain)item(m.actionCount?'还有待处理事项':'当前计划暂无待办',m.actionCount?'查看各条报告与复查的实际进度。':'这里只统计计划关联记录，不代表微信连接正常或所有原生任务都已核验。');
  $('#nav-action-count').hidden=!m.actionCount;$('#nav-action-count').textContent=String(m.actionCount);
  $('#home-plan-card').hidden=!p;$('#home-plan').replaceChildren();if(p){row($('#home-plan'),'计划 · '+statusLabel(m.planStatus),`下次计划复查 ${at(p.nextReviewAt)}；计划有效期至 ${at(p.expiresAt)}。`);if(m.planStatus!=='active')row($('#home-plan'),'先核对再行动','本计划当前未在有效跟踪状态。历史仓位与点位供复盘查看。');}
  const completed=state.reports.find(r=>r.status==='completed'),cacheKey=state.mode+':'+completed?.id;
  if(!completed){$('#home-insights').replaceChildren();const d=el('div',undefined,'industry-preview');for(const [title,desc] of [['主投行业','优先研究的方向与依据'],['二级投资行业','次级机会与观察条件'],['三级投资行业','等待进一步验证的方向'],['不推荐行业','暂时避开及原因']]){const cell=el('div');cell.append(el('strong',title),el('small',desc));d.append(cell);}$('#home-insights').append(el('p','研究完成后，在这里查看行业优先级与依据；目前没有可用结论。','muted'),d);}
  else if(dashboardReports.has(cacheKey))renderHomeReport(dashboardReports.get(cacheKey));
  else{row($('#home-insights'),'最近一次完成的研究',completed.summary||'正在读取本轮结论。');if(!dashboardReports.has(cacheKey+'-loading')){dashboardReports.set(cacheKey+'-loading',true);request('read_report',{reportId:completed.id},state.mode).then(r=>{dashboardReports.set(cacheKey,r);if(state.mode+':'+state.reports.find(x=>x.status==='completed')?.id===cacheKey)renderHomeReport(r);}).catch(()=>{dashboardReports.delete(cacheKey+'-loading');});}}
  $('#activity-summary').replaceChildren();stat($('#activity-summary'),'未完成',String(m.failed));stat($('#activity-summary'),'结果待确认',String(m.uncertain));stat($('#activity-summary'),'全部待办',String(m.actionCount));
  $('#plan-tools').hidden=onMobile||!m.canReview;$('#plan-tools-note').textContent=m.canReview?'复查和图片投递交给所选伙伴执行，以实际回执为准。':!p?'形成有效计划后，这里会提供复查入口。':!m.hasPartner?'需要在账户设置选择研究伙伴后，才能从这里投递复查。':'暂停、结束或到期计划不提供当前复查操作。';
  $('#send-stock').disabled=onMobile||!chart?.bars?.length||!m.hasPartner;$('#stock-delivery-note').textContent=onMobile?'手机端可在当前对话请求发送该股票K线图片；此页不直接投递。':m.hasPartner?'发送请求由研究伙伴执行；微信连接和送达结果以实际回执为准。':'先查行情即可。若要从工作台发送图片，请在账户设置选择研究伙伴。';
}
function renderHomeReport(r){$('#home-insights').replaceChildren();$('#home-insights').append(el('p',r.summary,'insight-summary'),el('p','研究完成于 '+at(r.finishedAt)+' · 历史结论，使用前核对时效','fine-print'));const d=el('div',undefined,'industry-preview');for(const name of ['主投行业','二级投资行业','三级投资行业','不推荐行业']){const cell=el('div');cell.append(el('small',name),el('strong',(r.industries||[]).filter(x=>x.group===name).map(x=>x.name).slice(0,3).join('、')||'本轮无充分依据的行业'));d.append(cell);}$('#home-insights').append(d);}
async function startResearch(){
  if(!state){notice('资料仍在读取，请稍候。');return;}if(!state.config){go('config');return;}
  if(onMobile||!state.config.partnerTarget){$('#research-guide-description').textContent=onMobile?'在当前Cindy对话发送下面这句继续研究。手机插件页可以查看行情、图表和已有记录；任务与投递由对话核对执行。':'当前未选择研究伙伴。资料已保存，可以在对话继续，或在账户设置选择伙伴。';$('#research-command').textContent='/ashare-research 使用已保存的'+(state.simulation?'模拟':'真实')+'资料开展研究，先核对配置与计划状态，仅提供建议，不自动交易。';$('#research-guide').hidden=false;$('#research-guide').scrollIntoView({behavior:'smooth',block:'center'});return;}
  await request('launch_research');notice('已交给研究伙伴处理。完成的研究、计划与消息回执会分别记录；当前尚未确认研究完成。');
}

function renderState(){
  $('#mode-banner').textContent=state.simulation?'模拟研究使用合成行情；账本的观察报价来源见各账本，不是真实持仓或成交。':'真实资料';
  renderPaper();editor.setState(state);renderDashboard();
  const p=state.latestPlan;
  $('#plan').replaceChildren();
  if(p){
    row($('#plan'),'当前计划 · 第'+p.revision+'版',`下次复查 ${at(p.nextReviewAt)}；有效期 ${at(p.expiresAt)}。`);
    for(const x of p.allocation.positions)row($('#plan'),`${x.name} · 建议${fmt(x.weight*100)}%`,`目标金额 ${fmt(x.targetValue)} 元；实际持有 ${fmt(x.actualQuantity,0)} 股；止损参考 ${fmt(x.stop)}，目标参考 ${fmt(x.target)}。${x.reason}`);
    const risk=globalThis.AShareCore.riskEstimate(p.allocation);
    row($('#plan'),'先看风险，再看建议',risk.available?`按建议仓位跌到止损参考价，合计估算损失 ${fmt(risk.stopDistanceLoss)} 元（权益 ${fmt(risk.equityFraction*100)}%）。${risk.basis}`:'缺少价格或止损依据，暂不展示风险金额；先等待核验。');
    for(const x of p.allocation.positions.filter(x=>x.weight>0)){
      const stockRisk=globalThis.AShareCore.riskEstimate({...p.allocation,positions:[x]});
      const detail=el('details',undefined,'technical-details');detail.append(el('summary',x.name+' · 风险与考虑条件'));
      row(detail,x.name+' · 止损距离估算损失',stockRisk.available?fmt(stockRisk.stopDistanceLoss)+' 元；按建议仓位计算，不是实际亏损上限。':'依据不足，未计算。');
      row(detail,x.name+' · 考虑条件',x.entryCondition||'历史建议未记录条件，补齐前先等待核验。');
      row(detail,'何时等待',x.waitCondition||'历史建议未记录，不要只看仓位数字行动。');
      row(detail,'何时重新研究',x.invalidationCondition||'历史建议未记录，需重新评估。');$('#plan').append(detail);
    }
    row($('#plan'),'建议现金比例',fmt(p.allocation.cashWeight*100)+'%');
    const actions=el('div',undefined,'toolbar');
    if(!onMobile)for(const [label,action]of [[p.status==='paused'?'恢复跟踪':'暂停跟踪',p.status==='paused'?'resume':'pause'],['结束计划','complete']]){
      const b=el('button',label);b.disabled=['expired','completed'].includes(AShareViewModel.overview(state).planStatus);
      b.onclick=()=>busy(b,async()=>{await request('plan_control',{requestKey:crypto.randomUUID(),planId:p.id,expectedRevision:p.revision,action,reason:'用户在工作台操作'});await refresh();notice('计划状态已保存；原生调度变更仍须由研究伙伴对账。');});actions.append(b);
    }$('#plan').append(actions);
  }else placeholder($('#plan'),'还没有投资计划',state.config?'完成一轮研究后，在这里查看建议配置、考虑条件和复查安排。':'先填写账户事实与风险范围，再开展研究；也可以直接查看股票行情。',state.config?'开始研究':'填写账户资料',()=>state.config?startResearch().catch(e=>notice(e.message,true)):go('config'));
  $('#actions').replaceChildren();
  if(!state.pendingActions.length)placeholder($('#actions'),'当前计划暂无待办','后续的报告投递和计划复查回执会保留在这里；不据此推断微信已连接。');
  for(const a of state.pendingActions){const summary=AShareViewModel.actionSummary(a),card=el('article',undefined,'activity-item'),head=el('div',undefined,'section-heading');head.append(el('h3',actionLabel(a)),el('span',summary.title,'state-label '+summary.tone));card.append(head,el('p',summary.text));const detail=el('details',undefined,'technical-details');detail.append(el('summary','查看原始回执与处理线索'));detail.append(el('pre',a.message||'尚未返回最终执行回执。'));detail.append(el('p','记录状态：'+a.status+' · 操作ID：'+a.id,'fine-print'));card.append(detail);$('#actions').append(card);}
  $('#recommendations').replaceChildren();
  for(const p of state.activePlan?.allocation.positions.filter(p=>p.weight>0)||[]){const b=el('button','查看 '+p.name+' 的K线与资讯');b.onclick=()=>{document.querySelector('[data-tab=stock]').click();$('#stock-code').value=p.symbol;$('#stock-name').value=p.name;$('#stock-form').requestSubmit();};$('#recommendations').append(b);}
  $('#holdings').replaceChildren();$('#holdings').className='';$('#holdings').removeAttribute('role');
  for(const h of state.config?.holdings||[]){const d=el('div',undefined,'security-row'),body=el('div');body.append(el('h3',h.name),el('span',h.symbol,'security-code'));const facts=el('div',undefined,'holding-metrics');for(const [title,value]of [['实际股数',fmt(h.quantity,0)+' 股'],['每股成本',fmt(h.cost)+' 元']]){const cell=el('div');cell.append(el('small',title),el('strong',value));facts.append(cell);}body.append(facts);d.append(body);$('#holdings').append(d);}
  if(!state.config?.holdings.length)AShareFeedback.render($('#holdings'),{title:state.config?'当前记录为空仓':'尚未填写持仓资料',description:state.config?'以已保存的现金和风险范围进行研究；新增持仓请按实际成交更新。':'填写真实资金与持仓后，在这里查看账户事实。',retry:async()=>go('config'),retryLabel:state.config?'更新账户资料':'填写账户资料'});
  const selected=$('#report-select').value;$('#report-select').replaceChildren(el('option','选择研究报告'));
  $('#report-select').firstChild.value='';
  for(const r of state.reports){const o=el('option',at(r.finishedAt)+' · '+(r.status==='completed'?'研究完成':'未完成记录'));o.value=r.id;$('#report-select').append(o);}
  $('#report-select').value=selected||state.reports[0]?.id||'';
  $('#export').disabled=!$('#report-select').value;$('#today-label').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'long'}).format(new Date());
}
async function refresh(){
  const generation=++refreshGeneration,mode=$('#data-mode').value,workspace=document.querySelector('.workspace');
  workspaceReady=false;workspace.classList.add('is-unavailable');$('#launch').disabled=true;$('#home-primary').disabled=true;if(!editor.isDirty())editor.setLoading();
  AShareFeedback.render($('#workspace-read-state'),{kind:'loading',title:'正在读取'+(mode==='live'?'真实':'模拟')+'资料',description:'正在核对账户、研究记录与计划。读取完成前暂不能操作。'});
  try{const result=await request('get_state',{},mode);if(generation!==refreshGeneration||mode!==$('#data-mode').value)return;state=result;workspaceReady=true;workspace.classList.remove('is-unavailable');$('#workspace-read-state').hidden=true;renderState();}
  catch(e){if(generation!==refreshGeneration||mode!==$('#data-mode').value)return;AShareFeedback.render($('#workspace-read-state'),{kind:'error',title:'资料暂时无法读取',description:'当前模式的数据不可用。已暂停页面操作，重新读取成功后继续。',detail:e.message,retry:()=>refresh()});throw e;}
}
async function readReport(){
  const generation=++reportGeneration,mode=$('#data-mode').value,reportId=$('#report-select').value;
  report=null;$('#industry-groups').replaceChildren();$('#report-text').textContent='';$('#export').disabled=true;
  if(!reportId){AShareFeedback.render($('#report-summary'),{title:'还没有研究记录',description:'完成第一轮研究后，在这里查看行业、股票分档与依据。缺少证据的项目会保留未评估状态。'});return;}
  AShareFeedback.render($('#report-summary'),{kind:'loading',title:'正在读取研究记录',description:'正在加载本轮结论与来源。'});
  try{
    const result=await request('read_report',{reportId},mode);if(generation!==reportGeneration||mode!==$('#data-mode').value||reportId!==$('#report-select').value)return;report=result;
    $('#report-summary').replaceChildren();$('#report-summary').className='';$('#report-summary').removeAttribute('aria-busy');$('#report-summary').removeAttribute('role');$('#export').disabled=onMobile;$('#export').title=onMobile?'请在当前对话请求导出报告。':'';
    $('#report-text').textContent=report.markdown;
    row($('#report-summary'),report.summary,`${report.status==='completed'?(report.planChanged?'本轮修订计划':'本轮维持计划'):report.status==='proposal_only'?'本轮建议待采用':'本轮研究未完成'} · ${at(report.finishedAt)}`);
    for(const x of report.information||[])row($('#report-summary'),x.symbol+' · 资讯核验',x.status==='supported'?'本轮五类证据已互核；有限范围，不代表无风险。':(x.issues||[]).join('；'));
    for(const x of report.observations||[])row($('#report-summary'),x.name+' · '+x.symbol,x.observation.label+'；'+(x.observation.reason||'缺报价不推断停牌，需核对官方状态。'));
    const group=$('#industry-groups');
    for(const name of ['主投行业','二级投资行业','三级投资行业','不推荐行业']){
      group.append(el('h2',name,'group-title'));const industries=(report.industries||[]).filter(s=>s.group===name);
      if(!industries.length)group.append(el('p','本轮暂无充分依据的行业。','muted'));
      for(const s of industries){const card=el('article',undefined,'industry');card.append(el('h3',s.name),el('p',s.reason),el('small',s.coverage||''));if(s.analysis?.method==='subagent')card.append(el('p','子代理分工分析 · 主代理汇总核验','fine-print'));
        for(const tier of ['一档','二档','三档']){const d=el('div',undefined,'tier');d.append(el('strong',tier));const stocks=s.stocks.filter(x=>x.valueTier===tier&&!x.observation?.allocationBlocked);
          if(!stocks.length)d.append(el('p','暂无充分依据的候选。','muted'));
          for(const x of stocks){const list=el('div',undefined,'security-row'),body=el('div'),metric=el('div',undefined,'security-metric');body.append(el('h3',x.name),el('span',x.symbol,'security-code'),el('p',x.observation?.label||'投资候选（非买入指令）','muted'),el('p',x.valueReason));metric.append(el('strong',fmt(x.technicalScore??x.score,1)),el('small','技术筛选分'));list.append(body,metric);d.append(list);}card.append(d);
        }if(s.ungraded)card.append(el('p',`${s.ungraded}只未充分评估，未强行分档。`,'muted'));group.append(card);
      }
    }
  }catch(e){if(generation!==reportGeneration||mode!==$('#data-mode').value||reportId!==$('#report-select').value)return;AShareFeedback.render($('#report-summary'),{kind:'error',title:'研究记录读取失败',description:'已清除上一份报告的展示，避免与当前选择混淆。你可以重新读取。',detail:e.message,retry:()=>readReport()});throw e;}
}
function resetStock(){
  trendViewer.clear();chart=null;chartQuery=null;$('#kline').hidden=true;$('#market-legend').hidden=true;$('#send-stock').disabled=true;$('#indicators').replaceChildren();$('#stock-news').replaceChildren();$('#stock-news').className='';$('#stock-news').removeAttribute('role');$('#stock-news-card').hidden=true;
}
async function loadStock(){
  const queryScroll=scrollY,generation=++stockGeneration,mode=$('#data-mode').value,symbol=$('#stock-code').value,period=$('#stock-period').value,keyword=$('#stock-name').value;
  resetStock();$('#stock-heading').textContent='股票行情';$('#stock-meta').textContent='正在读取 '+symbol+'，上一份查询结果已收起。';
  AShareFeedback.render($('#stock-empty'),{kind:'loading',title:'正在读取行情与K线',description:'正在核对报价时间，并加载技术指标与公司资料。'});
  try{const result=await request('stock_detail',{symbol,keyword,period},mode);if(generation!==stockGeneration||mode!==$('#data-mode').value)return;
    if(result.bars?.length)trendViewer.setData(result,period);
    chart=result;chartQuery={symbol,period,keyword,mode};$('#stock-heading').textContent=(chart.quote?.name||'股票行情')+' · '+symbol;
    $('#market-legend span:last-child').textContent=({qfq:'前复权K线',hfq:'后复权K线',none:'未复权K线'}[chart.adjustment]||'复权口径未确认');
    const hasBars=Array.isArray(chart.bars)&&chart.bars.length>0;
    $('#stock-empty').hidden=hasBars;$('#kline').hidden=!hasBars;$('#market-legend').hidden=!hasBars;$('#stock-news-card').hidden=false;renderDashboard();$('#send-stock').disabled=onMobile||!hasBars||!state?.config?.partnerTarget;
    if(!hasBars)AShareFeedback.render($('#stock-empty'),{title:'本次没有可绘制的K线',description:'当前来源未返回有效K线。下面保留本次实际取得的公司资料与来源说明。',retry:()=>loadStock(),retryLabel:'重新查询'});
    $('#stock-meta').textContent=`${chart.quote?.name||symbol} · 未复权行情参考价 ${fmt(chart.quote?.price)} · 报价时间 ${at(chart.quote?.asOf)}；K线 ${chart.source}/${chart.adjustment}，末根 ${chart.bars?.at(-1)?.date||'无'}。`;
    if(hasBars)draw();const i=chart.indicators;if(i?.ready)for(const [label,v]of [['MA5',i.ma5],['MA20',i.ma20],['MA60',i.ma60],['RSI14',i.rsi14],['MACD柱',i.macd.histogram],['ATR14',i.atr14]])stat($('#indicators'),label,fmt(v));
    if(chart.information)renderInformation(chart.information,chart.informationSources||[]);
    for(const n of (chart.news||[]).slice(0,12))row($('#stock-news'),n.title,`${n.source} · ${n.publishedAt||'时间未确认'}`);
    if(!chart.information&&!(chart.news||[]).length)AShareFeedback.render($('#stock-news'),{title:'本次未取得公司资料',description:'未查到数据不代表没有公告或风险。请通过公司披露来源继续核验。'});
    row($('#stock-news'),'研究阶段',chart.researchNotice||'单股资料查询，不代表已评为值得买。');
    if(chart.warnings?.length)row($('#stock-news'),'本次资料提示',chart.warnings.join('；'));
    if(matchMedia('(max-width:650px)').matches&&!$('#stock').hidden&&Math.abs(scrollY-queryScroll)<96)requestAnimationFrame(()=>document.querySelector('.chart-card').scrollIntoView({block:'start',behavior:'auto'}));
  }catch(e){if(generation!==stockGeneration||mode!==$('#data-mode').value)return;resetStock();$('#stock-meta').textContent='当前查询未完成，暂未展示价格或K线。';AShareFeedback.render($('#stock-empty'),{kind:'error',title:'行情暂时未能读取',description:'未沿用上一只股票的图表。请检查代码，或稍后重新查询。',detail:e.message,retry:()=>loadStock(),retryLabel:'重新查询'});throw e;}
}

function draw(){if(chart)trendViewer.draw();}
$('#launch').onclick=e=>busy(e.currentTarget,startResearch);
$('#report-select').onchange=()=>readReport().catch(()=>{});
$('#export').onclick=e=>busy(e.currentTarget,async()=>{const id=$('#report-select').value;if(!id)throw new Error('先选择报告。');await request('export_report',{reportId:id});});
$('#stock-form').onsubmit=e=>{e.preventDefault();if(e.currentTarget.contains(document.activeElement))document.activeElement.blur();const button=e.currentTarget.querySelector('button');busy(button,()=>loadStock().catch(()=>{}));};
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>go(b.dataset.tab);
for(const b of document.querySelectorAll('[data-go]'))b.onclick=()=>go(b.dataset.go);
$('#quick-stock-form').onsubmit=e=>{e.preventDefault();$('#stock-code').value=$('#quick-stock-code').value;go('stock');$('#stock-form').requestSubmit();};
$('#close-research-guide').onclick=()=>$('#research-guide').hidden=true;
new ResizeObserver(draw).observe($('#kline'));
new MutationObserver(draw).observe(document.head,{childList:true,subtree:true,attributes:true});
refresh().then(()=>editor.partners()).catch(()=>{});

$('#edit-config').onclick=()=>go('config');
$('#view-stock').onclick=()=>document.querySelector('[data-tab=stock]').click();
let selectedMode='live';
$('#data-mode').onchange=async()=>{
  if(editor.isDirty()){$('#data-mode').value=selectedMode;notice('有未保存内容或保存待确认。请先保存、核对，或放弃草稿，再切换资料模式。',true);return;}
  selectedMode=$('#data-mode').value;storageGeneration++;storageSnapshot=null;storagePreview=null;$('#storage-status').replaceChildren(el('p','正在切换资料模式…','muted'));$('#storage-preview-result').hidden=true;$('#storage-confirm-area').hidden=true;$('#storage-confirm-check').checked=false;$('#storage-actions').hidden=true;$('#storage-migrate').hidden=true;trendViewer.clear();editor.setLoading();stockGeneration++;reportGeneration++;report=null;chart=null;chartQuery=null;$('#stock-empty').hidden=false;$('#kline').hidden=true;$('#stock-news-card').hidden=true;$('#send-stock').disabled=true;$('#stock-heading').textContent='股票行情';$('#report-summary').replaceChildren();$('#industry-groups').replaceChildren();$('#report-text').textContent='';$('#indicators').replaceChildren();$('#stock-news').replaceChildren();$('#stock-meta').textContent='切换资料模式后请重新查询，防止混用行情。';$('#kline').getContext('2d').clearRect(0,0,$('#kline').width,$('#kline').height);
  try{await refresh();if(!$('#config').hidden)await loadStorage();}catch{}
};
$('#send-stock').onclick=e=>busy(e.currentTarget,async()=>{if(!chartQuery)throw new Error('请先查询并取得K线。');await request('launch_chart',{selector:'specified',symbol:chartQuery.symbol,period:chartQuery.period},chartQuery.mode);notice('K线图片发送请求已投递给所选伙伴；以微信真实回执为准。');});
$('#send-recommended').onclick=e=>busy(e.currentTarget,async()=>{if(!state.activePlan)throw new Error('当前模式没有推荐计划。');await request('launch_chart',{selector:'recommended',period:'day'});notice('推荐股票图片请求已投递；以微信回执为准。');});
$('#scan-plan').onclick=e=>busy(e.currentTarget,async()=>{if(!state.activePlan)throw new Error('当前模式没有计划。');await request('launch_scan');notice('计划符合性扫描已投递给所选伙伴。');});

let storageSnapshot=null,storagePreview=null,storageGeneration=0,storageOperationBusy=false;
const storageWriteKeys=new Map();
async function storageWrite(action,storage,mode){const signature=JSON.stringify({action,storage,mode});let requestKey=storageWriteKeys.get(signature);if(!requestKey){requestKey=crypto.randomUUID();storageWriteKeys.set(signature,requestKey);}const result=await request('plan_control',{action,requestKey,storage},mode);storageWriteKeys.delete(signature);return result;}
const storageModeIsCurrent=(mode,generation)=>generation===storageGeneration&&mode===$('#data-mode').value&&mode===selectedMode;
async function withStorageModeLock(mode,fn){if(storageOperationBusy)throw new Error('存储维护操作正在进行，请稍候。');if(mode!==$('#data-mode').value||mode!==selectedMode)throw new Error('资料模式已切换，请重新读取后操作。');storageOperationBusy=true;$('#data-mode').disabled=true;for(const id of ['#storage-refresh','#storage-migrate','#storage-archive','#storage-preview','#storage-execute'])$(id).disabled=true;try{return await fn();}finally{storageOperationBusy=false;$('#data-mode').disabled=false;$('#storage-refresh').disabled=false;$('#storage-migrate').disabled=$('#storage-migrate').hidden;$('#storage-archive').disabled=false;$('#storage-preview').disabled=false;$('#storage-execute').disabled=!$('#storage-confirm-check').checked||!storagePreview?.canExecute;}}
const storageBytes=n=>typeof n==='number'&&Number.isFinite(n)?(n<1024?`${fmt(n,0)} B`:n<1048576?`${fmt(n/1024,1)} KB`:`${fmt(n/1048576,2)} MB`):'—';
function storageRevision(){return state?.revision??storageSnapshot?.indexRevision??state?.indexRevision??state?.storage?.revision??state?.storageRevision;}
function renderStorageStatus(data){const box=$('#storage-status');box.replaceChildren();box.className='storage-state';
  if(!data){box.append(el('p','读取后显示当前索引和资料数量。','muted'));return;}
  const grid=el('div',undefined,'storage-stats');
  const value=(v,bytes=false)=>v===undefined||v===null?'—':bytes?storageBytes(v):fmt(v,0);
  for(const [label,v,bytes] of [['资料文件占用',data.storage?.rootBytes,true],['当前索引文件',data.storage?.indexBytes,true],['数据库及日志',data.storage?.databaseBytes,true],['股票快照',data.snapshots,false],['行业归属',data.memberships,false],['已归档批次',data.archivedRuns,false]])stat(grid,label,value(v,bytes));
  box.append(grid);if(data.indexRevision!==undefined)box.append(el('p',`索引版本 ${String(data.indexRevision)}`,'fine-print'));
  const notes=[...(Array.isArray(data.warnings)?data.warnings:[])];
  if(data.storage?.backupRetention||data.storage?.backupPolicy)notes.push(data.storage.backupRetention||data.storage.backupPolicy);
  if(!notes.length)notes.push('保留备份说明：清理功能不会删除备份、研究记录、建议或效果记录。');
  const list=el('ul',undefined,'storage-notes');for(const note of notes)list.append(el('li',typeof note==='string'?note:JSON.stringify(note)));box.append(list);
}
async function loadStorage(){const button=$('#storage-refresh'),mode=$('#data-mode').value,generation=++storageGeneration;button.disabled=true;$('#storage-status').replaceChildren(el('p','正在读取存储状态…','muted'));$('#storage-status').setAttribute('aria-busy','true');
  try{const result=await request('plan_control',{action:'storage_status'},mode);if(!storageModeIsCurrent(mode,generation))return;storageSnapshot=result;storagePreview=null;$('#storage-preview-result').hidden=true;$('#storage-confirm-area').hidden=true;$('#storage-confirm-check').checked=false;renderStorageStatus(result);$('#storage-actions').hidden=false;$('#storage-migrate').hidden=result.canMigrate!==true;}
  catch(e){if(!storageModeIsCurrent(mode,generation))return;const box=$('#storage-status');box.replaceChildren(el('strong','存储状态读取失败'),el('p',e.message,'muted'));box.className='storage-state error';$('#storage-actions').hidden=true;$('#storage-migrate').hidden=true;}
  finally{if(generation===storageGeneration){button.disabled=false;$('#storage-status').removeAttribute('aria-busy');}}
}
$('#storage-refresh').onclick=loadStorage;
$('#storage-migrate').onclick=e=>busy(e.currentTarget,async()=>{const mode=$('#data-mode').value,generation=storageGeneration;await withStorageModeLock(mode,async()=>{await refresh();if(!storageModeIsCurrent(mode,generation))throw new Error('资料模式已切换，请重新读取后操作。');const revision=storageRevision();if(revision===undefined)throw new Error('缺少索引版本，先重新读取存储状态。');await storageWrite('storage_migrate',{expectedRevision:revision},mode);if(storageModeIsCurrent(mode,generation)){await refresh();await loadStorage();notice('存储格式已升级，原库备份已保留。');}});});
$('#storage-archive').onclick=e=>busy(e.currentTarget,async()=>{const mode=$('#data-mode').value,generation=storageGeneration;await withStorageModeLock(mode,async()=>{await refresh();if(!storageModeIsCurrent(mode,generation))throw new Error('资料模式已切换，请重新读取后操作。');const revision=storageRevision();if(revision===undefined)throw new Error('缺少索引版本，先重新读取存储状态。');await storageWrite('storage_archive_completed',{expectedRevision:revision},mode);if(storageModeIsCurrent(mode,generation)){await refresh();await loadStorage();notice('已提交终态批次归档，存储状态已刷新。');}});});
$('#storage-preview').onclick=e=>busy(e.currentTarget,async()=>{const mode=$('#data-mode').value,generation=storageGeneration;await withStorageModeLock(mode,async()=>{const revision=storageRevision();if(revision===undefined)throw new Error('缺少索引版本，先重新读取存储状态。');const result=await request('plan_control',{action:'storage_cleanup_preview',storage:{expectedRevision:revision}},mode);if(!storageModeIsCurrent(mode,generation))return;storagePreview=result;const box=$('#storage-preview-result');box.replaceChildren();box.hidden=false;$('#storage-confirm-area').hidden=true;$('#storage-confirm-check').checked=false;
  const p=storagePreview,summary=el('p',`候选 ${fmt(p.candidateCount,0)} 项 · ${storageBytes(p.candidateBytes)}；受保护 ${fmt(p.protectedCount,0)} 项。`);box.append(summary);
  const items=Array.isArray(p.items)?p.items.slice(0,20):[];if(items.length){const ul=el('ul',undefined,'storage-items');for(const item of items)ul.append(el('li',typeof item==='string'?item:(item.path||item.key||item.name||JSON.stringify(item))));box.append(ul);}else box.append(el('p',p.candidateCount?'候选清单未返回，无法确认删除范围。':'没有可清理的无引用缓存。','muted'));
  for(const warning of p.warnings||[])box.append(el('p',typeof warning==='string'?warning:JSON.stringify(warning),'fine-print'));
  const can=!!p.canExecute&&!!p.cleanupToken&&items.length>0;$('#storage-confirm-area').hidden=!can;$('#storage-execute').disabled=true;
  if(!can)box.append(el('p','当前预览不可执行；不会删除任何内容。','storage-disabled-note'));
});});
$('#storage-confirm-check').onchange=()=>{$('#storage-execute').disabled=!$('#storage-confirm-check').checked||!storagePreview?.canExecute;};
$('#storage-execute').onclick=e=>busy(e.currentTarget,async()=>{const mode=$('#data-mode').value,generation=storageGeneration,preview=storagePreview;if(!$('#storage-confirm-check').checked||!preview?.canExecute||!preview.cleanupToken)throw new Error('请先查看清单并勾选确认。');await withStorageModeLock(mode,async()=>{await refresh();if(!storageModeIsCurrent(mode,generation))throw new Error('资料模式已切换，请重新预览后操作。');const revision=storageRevision();if(revision===undefined)throw new Error('缺少索引版本，请重新读取并预览。');if(preview.expectedRevision!==undefined&&revision!==preview.expectedRevision)throw new Error('资料库版本已变化，请重新生成清理预览。');const receipt=await storageWrite('storage_cleanup_execute',{expectedRevision:revision,cleanupToken:preview.cleanupToken,confirm:true},mode);if(storageModeIsCurrent(mode,generation)){await refresh();await loadStorage();notice(receipt.status==='completed'?`清理完成：数据库记录 ${receipt.deletedObjects||0} 项、缓存文件 ${receipt.deletedFiles||0} 项。数据库空页可继续复用。`:'清理回执尚未确认，请先核对状态。');}});});

function renderPaper(){
  const select=$('#paper-select'),prior=select.value;select.replaceChildren(el('option','选择模拟账本'));select.firstChild.value='';
  const accounts=state?.paperAccounts||[];for(const a of accounts){const option=el('option',a.label+' · v'+a.version);option.value=a.id;select.append(option);}select.value=accounts.some(a=>a.id===prior)?prior:accounts[0]?.id||'';
  for(const id of ['#paper-summary','#paper-positions','#paper-trades'])$(id).replaceChildren();
  if(!state?.simulation){AShareFeedback.render($('#paper-summary'),{title:'模拟账本独立保存',description:'切换资料模式为“模拟测试”，查看模拟费用与收益记录。真实持仓不会写入这里。'});return;}
  const a=accounts.find(a=>a.id===select.value);if(!a){AShareFeedback.render($('#paper-summary'),{title:'还没有模拟账本',description:'在对话提供模拟初始资金与费用假设后开始。不会自动采用真实资金或生成成交。'});return;}$('#paper-summary').className='';$('#paper-summary').removeAttribute('role');$('#paper-summary').removeAttribute('aria-busy');
  row($('#paper-summary'),a.dataKind==='synthetic'?'合成数据样例':'用户录入的观察报价',a.limitations);
  row($('#paper-summary'),'初始资金 / 账面现金',fmt(a.initialCash)+' 元 / '+fmt(a.cash)+' 元；模拟成交 '+a.tradeCount+' 笔。');
  const v=a.currentValuation;
  if(v)row($('#paper-summary'),'完整估值与净盈亏',`${at(v.at)}：权益 ${fmt(v.equity)} 元；净盈亏 ${fmt(v.totalPnl)} 元（${fmt(v.netReturn*100)}%）；已实现 ${fmt(v.realizedPnl)} 元，未实现 ${fmt(v.unrealizedPnl)} 元；记录时点最大回撤 ${fmt(v.maxDrawdown*100)}%。`);
  else row($('#paper-summary'),'需要完整估值','最新模拟成交后尚未提供全持仓报价，当前权益和净收益未计算。');
  row($('#paper-summary'),'累计费用与滑点差额',`${fmt(a.totalFees)} 元 / ${fmt(a.slippageCost)} 元；已计入账本，不再重复扣除。`);
  if(v?.hasAgedQuotes)row($('#paper-summary'),'历史观察报价',`本估值含超过15分钟的报价，最早 ${at(v.oldestQuoteAt)}；不是实时账户估值。`);
  const f=a.feeModel;row($('#paper-summary'),'固定模拟费用假设',`${f.assumptionLabel}；佣金${fmt(f.commissionRate*100,4)}%，最低${fmt(f.minCommission)}元；买/卖税率${fmt(f.buyTaxRate*100,4)}%/${fmt(f.sellTaxRate*100,4)}%；其他双边费用${fmt(f.transferFeeRate*100,4)}%；滑点${fmt(f.slippageBps)}基点。均为假设，非券商实际收费。`);
  for(const p of a.positions)row($('#paper-positions'),p.name+' '+p.symbol,`模拟 ${fmt(p.quantity,0)} 股；含买入费用的账面成本 ${fmt(p.bookCost)} 元，平均每股 ${fmt(p.averageCost,6)} 元。`);
  if(v)for(const q of v.quotes)row($('#paper-positions'),'估值报价 '+q.symbol,`${fmt(q.price,6)} 元 · 未复权 · ${q.source} · ${at(q.asOf)}。`);
  $('#paper-trades').append(el('h3','最近20笔模拟成交（非真实成交）'));for(const t of [...a.trades].reverse())row($('#paper-trades'),`${t.side==='buy'?'模拟买入':'模拟卖出'} ${t.symbol} ${t.quantity}股`,`${at(t.at)}；参考${fmt(t.referenceQuote.price,6)}（${t.referenceQuote.source}）；模型价${fmt(t.executionPrice,6)}；费用${fmt(t.fees)}元；${t.note}`);
}
$('#paper-select').onchange=renderPaper;
$('#paper-refresh').onclick=e=>busy(e.currentTarget,refresh);
// Electron theme CSS can be replaced without a DOM mutation; repaint a visible
// chart only when its computed colors change. This makes no data requests.
let chartTheme='';
setInterval(()=>{if(!chart||$('#stock').hidden||document.visibilityState==='hidden')return;const signature=[getComputedStyle(document.body).color,getComputedStyle($('#market-up-label')).color,getComputedStyle($('#market-down-label')).color,getComputedStyle(document.querySelector('.trend-ma5')).color,getComputedStyle(document.querySelector('.trend-ma20')).color,getComputedStyle(document.querySelector('.trend-ma60')).color].join('|');if(signature!==chartTheme){chartTheme=signature;draw();}},1000);
new MutationObserver(draw).observe(document.documentElement,{attributes:true,attributeFilter:['style','class','data-theme']});

if(onMobile)go('stock');

document.body.classList.toggle('native-mobile',onMobile);
