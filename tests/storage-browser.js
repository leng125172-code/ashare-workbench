async () => {
 const results=[],check=(name,pass,detail)=>{results.push({name,passed:!!pass,...(detail?{detail}:{})});if(!pass)throw new Error(name);};
 const original=AShareUIClient.request;let fail=false,hold=null,empty=false,lastExecute=null,uncertainNext=false,writeKeys=[];
 const fixture={indexRevision:1,canMigrate:true,repositoryEnabled:false,storage:{rootBytes:24000000,indexBytes:1800,backupRetention:'保留原库备份、正式建议与效果记录。'},snapshots:5659,memberships:12222,archivedRuns:2,warnings:['隔离界面验收：所有数据为样例，不执行真实删除。']};
 AShareUIClient.request=async(operation,args,mode)=>{
  if(operation!=='plan_control'||!args.action?.startsWith('storage_'))return original(operation,args,mode);
  if(args.action==='storage_status'){if(fail)throw new Error('隔离验收：状态暂不可用');if(hold)return hold;return structuredClone(fixture);}
  if(args.action==='storage_cleanup_preview')return {cleanupToken:'a'.repeat(64),expectedRevision:state.revision,candidateCount:empty?0:3,candidateBytes:empty?0:32000,protectedCount:6000,canExecute:!empty,items:empty?[]:[{key:'object:stock_snapshot:'+('b'.repeat(64)),bytes:32000}],warnings:['隔离清理样例，不删除实际文件。']};
  if(args.action==='storage_cleanup_execute'){lastExecute={args,mode};writeKeys.push(args.requestKey);if(uncertainNext){uncertainNext=false;throw Object.assign(new Error('隔离验收：回执未知'),{code:'UI_UNCERTAIN'});}return {status:'completed',deletedObjects:3,deletedFiles:0};}
  if(args.action==='storage_migrate'){fixture.canMigrate=false;fixture.repositoryEnabled=true;return {migrated:true};}
  if(args.action==='storage_archive_completed')return {archived:0};
  throw new Error('unexpected fixture action');
 };
 try{
  if(!state)await refresh();
  go('config');await loadStorage();check('状态数量和保留说明显示',document.querySelector('#storage-status').textContent.includes('12,222')&&document.querySelector('#storage-status').textContent.includes('保留原库备份'));
  check('旧存储显示升级入口',!document.querySelector('#storage-migrate').hidden);
  let resolveHold;hold=new Promise(r=>resolveHold=r);const loading=loadStorage();check('加载有明确忙碌态',document.querySelector('#storage-status').getAttribute('aria-busy')==='true'&&document.querySelector('#storage-refresh').disabled);resolveHold(structuredClone(fixture));await loading;hold=null;
  fail=true;await loadStorage();check('失败显示可重试提示并隐藏操作',document.querySelector('#storage-status').textContent.includes('读取失败')&&document.querySelector('#storage-actions').hidden);fail=false;await loadStorage();
  empty=true;await document.querySelector('#storage-preview').onclick({currentTarget:document.querySelector('#storage-preview')});check('空候选不会显示确认删除',document.querySelector('#storage-confirm-area').hidden&&document.querySelector('#storage-preview-result').textContent.includes('没有可清理'));
  empty=false;await document.querySelector('#storage-preview').onclick({currentTarget:document.querySelector('#storage-preview')});check('预览后仍须明确确认',!document.querySelector('#storage-confirm-area').hidden&&document.querySelector('#storage-execute').disabled);
  const checkbox=document.querySelector('#storage-confirm-check');checkbox.checked=true;checkbox.onchange();check('确认后才允许执行',!document.querySelector('#storage-execute').disabled);await document.querySelector('#storage-execute').onclick({currentTarget:document.querySelector('#storage-execute')});check('执行使用当前版本和原预览令牌',lastExecute?.args.storage.expectedRevision===state.revision&&lastExecute.args.storage.confirm===true&&lastExecute.args.storage.cleanupToken==='a'.repeat(64)&&lastExecute.mode==='live');
  const retryStorage={expectedRevision:state.revision,cleanupToken:'c'.repeat(64),confirm:true};uncertainNext=true;try{await storageWrite('storage_cleanup_execute',retryStorage,'live');}catch{}await storageWrite('storage_cleanup_execute',retryStorage,'live');check('未知回执后显式重试沿用原请求键',writeKeys.at(-1)===writeKeys.at(-2));
  const region=document.querySelector('#storage-management');check('窄屏维护区无横向溢出',region.scrollWidth<=region.clientWidth+1,{clientWidth:region.clientWidth,scrollWidth:region.scrollWidth});check('页面无横向溢出',document.documentElement.scrollWidth<=innerWidth+1,{width:innerWidth,scrollWidth:document.documentElement.scrollWidth});
  const minHeight=Math.min(...[...region.querySelectorAll('button')].filter(b=>!b.closest('[hidden]')).map(b=>b.getBoundingClientRect().height));check('维护按钮触摸高度至少40px',minHeight>=40,{minHeight});
  let resolveOld;hold=new Promise(r=>resolveOld=r);const oldLoad=loadStorage();hold=null;fixture.snapshots=7;const mode=document.querySelector('#data-mode');mode.value='simulation';await mode.onchange();resolveOld({...structuredClone(fixture),snapshots:99999});await oldLoad;check('切模式丢弃旧状态回包',document.querySelector('#storage-status').textContent.includes('7')&&!document.querySelector('#storage-status').textContent.includes('99,999'));check('切模式清空旧清理确认',document.querySelector('#storage-confirm-area').hidden&&!document.querySelector('#storage-confirm-check').checked);mode.value='live';await mode.onchange();fixture.snapshots=5659;
  await loadStorage();region.scrollIntoView({block:'center'});
 }finally{AShareUIClient.request=original;}
 return {width:innerWidth,results,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,fixtureOnly:true};
}
