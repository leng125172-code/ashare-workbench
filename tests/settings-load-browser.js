async () => {
 const results=[],check=(name,pass)=>{results.push({name,passed:!!pass});if(!pass)throw Error(name);};
 const original=AShareUIClient.request,saved=await original('get_state',{},'live');let reject;
 try{
  currentMode='simulation';document.querySelector('#data-mode').value='simulation';AShareUIClient.request=(op,...args)=>op==='get_state'?new Promise((resolve,no)=>{reject=no;}):original(op,...args);
  const task=refresh();check('手机配置加载期间隐藏旧表单',document.querySelector('#configuration').hidden&&document.querySelector('#settings-read-state').getAttribute('aria-busy')==='true');
  reject(Error('FIXTURE_SETTINGS_UNAVAILABLE'));await task;check('配置读取失败保留恢复入口且不可改旧模式',document.querySelector('#configuration').hidden&&document.querySelector('#settings-read-state').textContent.includes('读取失败')&&!!document.querySelector('#settings-read-state .retry-button'));
  AShareUIClient.request=(op,...args)=>op==='get_state'?Promise.resolve({...saved,mode:'simulation',simulation:true}):original(op,...args);
  await document.querySelector('#settings-read-state .retry-button').onclick();check('配置只读重试恢复到所选模式',!document.querySelector('#configuration').hidden&&document.querySelector('#settings-read-state').hidden&&document.querySelector('#config-message').textContent.includes('模拟资料'));
  return {passed:results.filter(x=>x.passed).length,total:results.length,results};
 }finally{AShareUIClient.request=original;currentMode='live';document.querySelector('#data-mode').value='live';editor.setState(saved,{force:true});document.querySelector('#configuration').hidden=false;document.querySelector('#settings-read-state').hidden=true;}
}
