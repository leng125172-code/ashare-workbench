async () => {
 const results=[],check=(name,pass)=>{results.push({name,passed:!!pass});if(!pass)throw Error(name);};
 const originalRequest=request,saved=structuredClone(state);let pendingResolve,pendingReject;
 const clone=x=>structuredClone(x);
 try{
  // A failed mode read must hide the old mode's actionable view.
  $('#data-mode').value='simulation';request=(op,args,mode)=>op==='get_state'?new Promise((resolve,reject)=>{pendingResolve=resolve;pendingReject=reject;}):originalRequest(op,args,mode);
  const loading=refresh().catch(()=>{});
  check('资料加载时显示骨架状态并禁用操作',$('#workspace-read-state').getAttribute('aria-busy')==='true'&&$('.workspace').classList.contains('is-unavailable')&&$('#launch').disabled);
  pendingReject(Error('FIXTURE_STATE_UNAVAILABLE'));await loading;
  check('切模式失败不把旧数据当作新资料展示',$('.workspace').classList.contains('is-unavailable')&&$('#workspace-read-state').textContent.includes('暂时无法读取')&&getComputedStyle($('#overview')).display==='none');
  const sim={...clone(saved),mode:'simulation',simulation:true};request=(op,args,mode)=>op==='get_state'?Promise.resolve(sim):originalRequest(op,args,mode);
  await $('#workspace-read-state .retry-button').onclick();
  check('资料读取可通过只读重试恢复',!$('.workspace').classList.contains('is-unavailable')&&state.mode==='simulation'&&$('#workspace-read-state').hidden);
  $('#data-mode').value='live';request=originalRequest;editor.setState(saved,{force:true});state=clone(saved);renderState();
  go('stock');$('#stock-code').value='600001';await loadStock();
  check('成功查询展示K线及红涨绿跌文字图例',!$('#kline').hidden&&!$('#market-legend').hidden&&$('#market-up-label').textContent.includes('红')&&$('#market-down-label').textContent.includes('绿'));
  $('#stock-code').value='600002';request=(op,args,mode)=>op==='stock_detail'?new Promise((resolve,reject)=>{pendingResolve=resolve;pendingReject=reject;}):originalRequest(op,args,mode);
  const stockPending=loadStock().catch(()=>{});
  check('换股票加载时清除旧图和旧资讯',$('#stock-empty').getAttribute('aria-busy')==='true'&&$('#kline').hidden&&$('#send-stock').disabled&&$('#stock-news').children.length===0);
  pendingReject(Error('FIXTURE_QUOTE_UNAVAILABLE'));await stockPending;
  check('查询失败有局部错误与重试入口且无旧图',$('#stock-empty').textContent.includes('未能读取')&&!!$('#stock-empty .retry-button')&&$('#kline').hidden&&chart===null);
  request=originalRequest;$('#stock-code').value='600001';await $('#stock-empty .retry-button').onclick();
  check('查询重试成功后恢复图表',!$('#kline').hidden&&chart!==null);
  go('reports');request=(op,args,mode)=>op==='read_report'?new Promise((resolve,reject)=>{pendingResolve=resolve;pendingReject=reject;}):originalRequest(op,args,mode);
  const reportPending=readReport().catch(()=>{});
  check('报告加载清除旧正文与旧分组',$('#report-summary').getAttribute('aria-busy')==='true'&&$('#report-text').textContent===''&&$('#industry-groups').children.length===0&&$('#export').disabled);
  pendingReject(Error('FIXTURE_REPORT_UNAVAILABLE'));await reportPending;
  check('报告错误不会导出上一份内容',$('#report-summary').textContent.includes('读取失败')&&$('#export').disabled&&!!$('#report-summary .retry-button'));
  request=originalRequest;await $('#report-summary .retry-button').onclick();
  check('报告只读重试恢复分组和导出',!$('#export').disabled&&$('#industry-groups').textContent.includes('一档'));
  go('config');editor.setState(saved,{force:true});const form=$('#config-form'),f=form.elements;
  f.maxStockWeight.value='90';await form.onsubmit(new Event('submit',{cancelable:true}));
  check('业务错误定位到风险步骤与字段',!document.querySelector('[data-form-step="1"]').hidden&&f.maxStockWeight.getAttribute('aria-invalid')==='true'&&f.maxStockWeight.closest('label').textContent.includes('不能高于'));
  check('字段错误有关联说明且保留资金草稿',f.maxStockWeight.getAttribute('aria-describedby').includes('-error')&&f.cash.value==='10000');
  f.maxStockWeight.value='20';f.maxStockWeight.dispatchEvent(new Event('input',{bubbles:true}));
  check('编辑问题字段后清除错误标记',!f.maxStockWeight.hasAttribute('aria-invalid'));
  editor.setState(saved,{force:true});chart=null;state.config.partnerTarget=null;
  await busy($('#send-stock'),async()=>{});
  check('忙碌结束不绕过图片发送条件',$('#send-stock').disabled&&!$('#send-stock').hasAttribute('aria-busy'));
  go('overview');return {passed:results.filter(x=>x.passed).length,total:results.length,results,width:innerWidth};
 }finally{request=originalRequest;$('#data-mode').value='live';state=saved;editor.setState(saved,{force:true});workspaceReady=true;$('.workspace').classList.remove('is-unavailable');$('#workspace-read-state').hidden=true;renderState();}
}
