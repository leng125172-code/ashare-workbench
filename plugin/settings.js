'use strict';
const mode=document.querySelector('#data-mode'),message=document.querySelector('#settings-status'),readState=document.querySelector('#settings-read-state');
let currentMode='live',generation=0;
const editor=AShareConfigEditor.mount(document.querySelector('#configuration'),{request:AShareUIClient.request});
async function refresh(){
  const version=++generation,selected=currentMode;if(!editor.isDirty())editor.setLoading();document.querySelector('#configuration').hidden=true;
  AShareFeedback.render(readState,{kind:'loading',title:'正在读取账户资料',description:'读取完成后，可以按步骤填写或修改。'});
  try{const state=await AShareUIClient.request('get_state',{},selected);if(version!==generation||currentMode!==selected)return;editor.setState(state);readState.hidden=true;document.querySelector('#configuration').hidden=false;message.textContent=state.simulation?'模拟资料 · 独立保存，不影响真实持仓。':'真实资料 · 不会自动导入模拟资金或风险。';}
  catch(e){if(version!==generation||currentMode!==selected)return;message.textContent='所选资料模式暂不可用。';AShareFeedback.render(readState,{kind:'error',title:'账户资料读取失败',description:'原配置未被覆盖。请重新读取后再继续填写。',detail:e.message,retry:()=>refresh()});}
}
mode.onchange=async()=>{if(editor.isDirty()){mode.value=currentMode;message.textContent='请先保存、核对保存结果，或放弃草稿，再切换资料模式。';return;}currentMode=mode.value;await refresh();};
AShareUIClient.subscribe(m=>{if(m?.type==='changed'&&(!m.mode||m.mode===currentMode))refresh();if(m?.type==='startup-error'){message.textContent='插件启动未完成，请重新读取。';AShareFeedback.render(readState,{kind:'error',title:'插件暂不可用',description:'请检查插件状态后重新读取。',detail:m.message,retry:()=>refresh()});}});
refresh().then(()=>editor.partners());
