async () => {
 const results=[],check=(name,pass)=>{results.push({name,passed:!!pass});if(!pass)throw Error(name);};
 const saved=structuredClone(state),copy=x=>structuredClone(x),show=s=>{state=s;renderState();};
 const first={...copy(saved),config:null,latestPlan:null,activePlan:null,latestRun:null,reports:[{id:'failed-fixture',status:'failed',finishedAt:Date.now(),summary:'WORKING_DIR_UNAVAILABLE'}],pendingActions:[{id:'failed-action',status:'failed',operation:'send_report',format:'file',message:'WORKING_DIR_UNAVAILABLE synthetic diagnostic'}]};
 show(first);go('overview');
 check('首次首页有单一配置主动作且不铺空统计',document.querySelector('#hero-title').textContent.includes('建立')&&document.querySelector('#stats').hidden&&document.querySelector('#home-primary').textContent.includes('填写'));
 check('失败安装记录不当作研究结论或占据首页',!document.querySelector('#overview').innerText.includes('WORKING_DIR_UNAVAILABLE')&&!document.querySelector('#home-insights').innerText.includes('failed-fixture'));
 check('无计划不显示复查与推荐发送工具',document.querySelector('#plan-tools').hidden);
 document.querySelector('#home-primary').click();check('首次主动作直接进入可填写账户页',!document.querySelector('#config').hidden&&document.querySelector('[data-form-step="0"]').hidden===false);
 const form=document.querySelector('#config-form'),f=form.elements;
 check('真实风险不预填',f.cash.value===''&&f.maxEquityWeight.value==='');
 f.cash.value='1000000';f.holdingMode.value='empty';f.cash.dispatchEvent(new Event('input',{bubbles:true}));f.holdingMode.dispatchEvent(new Event('change',{bubbles:true}));
 document.querySelector('#config-next').click();check('资金事实可进入风险步骤',!document.querySelector('[data-form-step="1"]').hidden&&document.querySelector('#save-config').hidden);
 check('风险为空时不会跳过或保存',!f.maxEquityWeight.checkValidity());
 for(const [k,v] of Object.entries({maxEquityWeight:60,maxStockWeight:20,maxIndustryWeight:30,riskPerStock:1,horizonDays:30,reviewMinutes:60}))f[k].value=v;
 document.querySelector('#config-next').click();check('填齐后进入偏好步骤并显示保存',!document.querySelector('[data-form-step="2"]').hidden&&!document.querySelector('#save-config').hidden);
 go('stock');go('config');check('切页保留未保存草稿',f.cash.value==='1000000'&&f.riskPerStock.value==='1');
 // Force-reset the isolated page draft; no configure/native service is called here.
 editor.setState(saved,{force:true});
 const ready={...copy(saved),latestPlan:null,activePlan:null,reports:[],pendingActions:[]};show(ready);go('overview');
 check('有配置无计划突出首次研究入口',document.querySelector('#home-primary').textContent.includes('开始研究')&&!document.querySelector('#stats').hidden);
 await startResearch();check('未选伙伴提供对话入口而不误报投递',!document.querySelector('#research-guide').hidden&&document.querySelector('#research-command').textContent.includes('/ashare-research'));
 const expired={...copy(saved),latestPlan:{...copy(saved.latestPlan),expiresAt:Date.now()-1},activePlan:{...copy(saved.activePlan),expiresAt:Date.now()-1}};show(expired);go('plans');check('到期计划不显示当前复查操作',document.querySelector('#plan-tools').hidden&&document.querySelector('#hero-title').textContent.includes('到期'));
 show(first);go('activity');const detail=document.querySelector('#actions details');check('技术回执保留于消息页折叠详情',!detail.open&&detail.textContent.includes('WORKING_DIR_UNAVAILABLE')&&document.querySelector('#actions').textContent.includes('未完成'));
 show(saved);go('reports');await readReport();check('研究页仍可读取行业与分档',document.querySelector('#industry-groups').textContent.includes('主投行业')&&document.querySelector('#industry-groups').textContent.includes('一档'));
 go('stock');document.querySelector('#stock-code').value='600001';document.querySelector('#stock-form').requestSubmit();
 await new Promise((resolve,reject)=>{const deadline=Date.now()+10000;const t=setInterval(()=>{if(!document.querySelector('#kline').hidden){clearInterval(t);resolve();}else if(Date.now()>deadline){clearInterval(t);reject(Error('stock fixture timeout'));}},50);});
 check('独立行情路径显示K线且缺伙伴时不开放发送',!document.querySelector('#kline').hidden&&document.querySelector('#send-stock').disabled);
 go('overview');window.workspaceAcceptance=results;
 return {passed:results.filter(x=>x.passed).length,total:results.length,results,width:innerWidth,scrollWidth:document.documentElement.scrollWidth};
}
