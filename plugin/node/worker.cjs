'use strict';
const readline = require('node:readline');
const M = require('./market.cjs');
const C = require('../core.js');
const regulatory=require('./regulatory.cjs');
const information=require('./information.cjs').createClient();
const execution=require('./execution.cjs').createClient(M,information);
const reply = m => process.stdout.write(JSON.stringify(m)+'\n');
let monitor={plan:null,config:null}, polling=false;
async function tick() {
  if (polling || !monitor.plan || !monitor.config?.trackingEnabled) return;
  polling=true;
  try {
    const codes=monitor.plan.allocation.positions.filter(p=>p.weight>0).map(p=>p.symbol);
    const q=await M.quotes(codes.slice(0,100));
    const events=C.planEvents(monitor.plan,q,Date.now(),monitor.config);
    if(events.length) reply({jsonrpc:'2.0',method:'monitor_events',params:{events}});
  } catch { reply({jsonrpc:'2.0',method:'monitor_error',params:{message:'行情监测未完成；等待下次重试，未触发目标事件。'}}); }
  finally { polling=false; }
}
setInterval(tick,60000).unref();
const methods={
  regulatory_page:p=>regulatory.page(p),
  sectors:()=>M.sectors(), members:p=>M.members(p.sectorId), quotes:p=>M.quotes(p.symbols || []),
  kline:p=>M.kline(p.symbol,p.period), news:p=>M.news(p.keyword), information:p=>information.dossier(p.symbol), information_source:p=>information.source(p.url),execution:p=>execution.snapshot(p.symbol),instrument:p=>information.instrument(p.symbol),
  assess:p=>M.assess(p.items || [],(done,total)=>reply({jsonrpc:'2.0',method:'progress',params:{done,total}})),
  sync_monitor:p=>{monitor={plan:p.plan || null,config:p.config || null}; return {listening:!!monitor.plan,intervalSeconds:60};},
  health:()=>({runtime:process.version,advisoryOnly:true,capabilities:['industry','members','quotes','qfq_kline','indicators','news','local_monitor']})
};
readline.createInterface({input:process.stdin}).on('line',async line=>{
  let r;
  try {r=JSON.parse(line);}catch {reply({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}});return;}
  if(!Object.hasOwn(r,'id'))return;
  try {
    if(!Object.hasOwn(methods,r.method))throw Object.assign(new Error('Unknown method'),{code:-32601});
    const result=await methods[r.method](r.params || {});reply({jsonrpc:'2.0',id:r.id,result});
  } catch(e) {reply({jsonrpc:'2.0',id:r.id,error:{code:typeof e.code==='number'?e.code:-32000,message:String(e.message || '数据请求失败。').slice(0,180)}});}
});
