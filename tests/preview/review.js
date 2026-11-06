'use strict';
// Preview-only view controls. Never shipped inside the plugin or pointed at native data.
const params=new URL(location.href).searchParams;
const wait=setInterval(async()=>{
 const fields=document.querySelector('#config-fields');if(!fields||fields.disabled||document.querySelector('.workspace.is-unavailable'))return;
 clearInterval(wait);
 const screen=params.get('screen');
 if(screen==='config'&&typeof go==='function')go('config');
 if(screen==='risk'||screen==='preferences'||screen==='disabled'){
  if(typeof go==='function')go('config');document.querySelector('#config-next').click();if(screen==='preferences'||screen==='disabled')document.querySelector('#config-next').click();if(screen==='disabled')editor.setLoading();
 }
 if(screen==='save-loading'||screen==='save-confirmed'){
  if(typeof go==='function')go('config');
  let sample=await AShareUIClient.request('get_state',{},'live');
  const fixtureEditor=AShareConfigEditor.mount(document.querySelector('#configuration'),{request:async(op,args)=>{
   if(op==='configure'){if(screen==='save-loading')return new Promise(()=>{});sample={...sample,revision:sample.revision+1,config:args.config};return {configured:true};}
   if(op==='get_state')return sample;return {targets:[]};
  }});
  fixtureEditor.setState(sample);document.querySelector('#config-next').click();document.querySelector('#config-next').click();document.querySelector('#config-form').onsubmit(new Event('submit',{cancelable:true}));
 }
 if(screen==='field-error'){
  if(typeof go==='function')go('config');document.querySelector('[name=maxStockWeight]').value='90';document.querySelector('#config-form').onsubmit(new Event('submit',{cancelable:true}));
 }
 if(screen?.startsWith('stock')){
  go('stock');document.querySelector('#stock-code').value='600001';
  if(screen==='stock-error'||screen==='stock-loading'){const original=request;request=(op,args,mode)=>op==='stock_detail'?(screen==='stock-error'?Promise.reject(Error('FIXTURE_NETWORK_ERROR（离线样例）')):new Promise(()=>{})):original(op,args,mode);}
  loadStock().then(()=>{if(params.get('capture')==='1')setTimeout(()=>scrollTo(0,0),400);}).catch(()=>{});
 }
 if(screen==='report')go('reports');
},30);
