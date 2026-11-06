async () => {
 const results=[],check=(name,passed,detail)=>{results.push({name,passed:!!passed,...(detail?{detail}:{})});if(!passed)throw Error(name);};
 const css=n=>getComputedStyle(n),visible=n=>!!n.getClientRects().length;
 go('stock');$('#stock-code').value='600001';await loadStock();
 check('普通操作按钮统一46px，标签组统一44px',css($('#stock-form button')).minHeight==='46px'&&[...document.querySelectorAll('.trend-segment button')].every(n=>css(n).minHeight==='44px')&&[...document.querySelectorAll('.trend-pages button')].every(n=>css(n).minHeight==='46px'));
 check('窄屏保留顶部简化布局，标题不挤成多行',innerWidth>650||(css($('#launch')).display==='none'&&$('#page-title').offsetHeight<40));
 check('所有导航标签点击区域至少44px',[...document.querySelectorAll('[data-tab]')].every(n=>visible(n)&&n.offsetHeight>=44));
 const day=$('[data-trend-period=day]'),week=$('[data-trend-period=week]');
 check('选中标签以底边、字重和背景区分',css(day).borderBottomWidth==='3px'&&css(day).fontWeight==='700'&&css(day).backgroundColor!==css(week).backgroundColor);
 $('[data-trend-kind=line]').click();check('切换标签后选中样式跟随真实状态',$('[data-trend-kind=line]').getAttribute('aria-pressed')==='true'&&$('[data-trend-kind=candle]').getAttribute('aria-pressed')==='false'&&css($('[data-trend-kind=line]')).fontWeight==='700');
 const button=$('#stock-form button'),label=button.textContent,width=button.offsetWidth;let release,calls=0;
 const p=busy(button,()=>{calls++;return new Promise(r=>release=r);});
 check('加载按钮有文字、转圈、独立背景，不淡化',button.disabled&&button.getAttribute('aria-busy')==='true'&&button.textContent==='查询中…'&&css(button).opacity==='1'&&getComputedStyle(button,'::before').content!== 'none'&&button.offsetWidth>=width);
 await busy(button,()=>{calls++;});check('加载期间阻止重复操作',calls===1);
 check('加载时320px不横向溢出',document.documentElement.scrollWidth<=innerWidth,{viewport:innerWidth,scroll:document.documentElement.scrollWidth});
 release();await p;check('加载结束恢复原标签与可用状态',button.textContent===label&&!button.disabled&&!button.hasAttribute('aria-busy'));
 await busy(button,async()=>{throw Error('FIXTURE_ACTION_FAILED');});check('失败保留错误提示，不冒充确认成功',$('#status').classList.contains('error')&&!button.hasAttribute('data-confirmed')&&!button.disabled);
 const box=document.createElement('div');box.className='settings';document.body.append(box);
 let mockState=await AShareUIClient.request('get_state',{},'live'),saveResolve,saveCalls=0,fail=false,mismatch=false;
 const mock=AShareConfigEditor.mount(box,{request:async(op,args)=>{if(op==='configure'){saveCalls++;await new Promise(r=>saveResolve=r);if(fail)throw Error('FIXTURE_SAVE_FAILED');mockState={...mockState,revision:mockState.revision+1,config:args.config};return {configured:true};}if(op==='get_state')return mismatch?{...mockState,config:{...mockState.config,cash:321}}:mockState;return {targets:[]};}});
 try{
  mock.setState(mockState);box.querySelector('#config-next').click();box.querySelector('#config-next').click();const form=box.querySelector('form'),save=box.querySelector('#save-config');
  const saving=form.onsubmit(new Event('submit',{cancelable:true}));
  check('保存期间按钮显示保存中，字段锁定',save.textContent==='保存中…'&&save.getAttribute('aria-busy')==='true'&&save.disabled&&box.querySelector('#config-fields').disabled);
  await form.onsubmit(new Event('submit',{cancelable:true}));check('保存期间不重复写入',saveCalls===1);
  saveResolve();await saving;
  check('核验保存后显示勾号完成态及下一步',save.textContent==='已保存'&&save.dataset.confirmed==='true'&&save.disabled&&!box.querySelector('#config-saved-next').hidden&&save.getAttribute('aria-busy')==='false');
  await form.onsubmit(new Event('submit',{cancelable:true}));check('已确认后不重复提交同一资料',saveCalls===1);
  const cash=form.elements.cash;cash.value='20000';cash.dispatchEvent(new Event('input',{bubbles:true}));
  check('编辑资料后清除完成态并可再次保存',!save.hasAttribute('data-confirmed')&&!save.disabled&&save.textContent==='保存配置'&&box.querySelector('#config-saved-next').hidden);
  fail=true;const failed=form.onsubmit(new Event('submit',{cancelable:true}));saveResolve();await failed;
  check('保存失败清除加载且没有完成态',!save.disabled&&save.getAttribute('aria-busy')==='false'&&!save.hasAttribute('data-confirmed')&&box.querySelector('#config-message').textContent.includes('FIXTURE_SAVE_FAILED'));
  fail=false;mismatch=true;const different=form.onsubmit(new Event('submit',{cancelable:true}));saveResolve();await different;
  check('保存回读不一致时保留待核对，不显示已保存',!save.hasAttribute('data-confirmed')&&save.disabled&&!box.querySelector('#reconcile-config').hidden&&box.querySelector('#config-saved-next').hidden);
  mismatch=false;await box.querySelector('#reconcile-config').onclick();
  check('核对一致后才恢复完成态和下一步',save.dataset.confirmed==='true'&&!box.querySelector('#config-saved-next').hidden&&!box.querySelector('#config-fields').disabled);
 }finally{box.remove();}
 go('stock');check('最终页面无横向溢出',document.documentElement.scrollWidth<=innerWidth);
 return {passed:results.filter(x=>x.passed).length,total:results.length,results};
}
