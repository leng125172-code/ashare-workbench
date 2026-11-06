'use strict';
const now=Date.now();
const allocation={equity:10000,equityWeight:.1,cashWeight:.9,cashTarget:9000,positions:[{symbol:'sh600001',name:'示例公司',sectorId:'BK0001',weight:.1,targetValue:1000,actualQuantity:0,deltaValue:1000,stop:90,target:120,price:100,entryCondition:'本轮证据充分且价格条件核验后才考虑；样例非交易指令。',waitCondition:'数据过期或资讯不足则等待。',invalidationCondition:'原经营判断失效或触达参考点位时重新研究。',reason:'界面验收样例，不是投资建议。'}],currentHoldings:[],omittedHoldings:[],advisoryOnly:true};
const plan={id:'plan-demo',revision:1,status:'active',createdAt:now,updatedAt:now,nextReviewAt:now+3600000,expiresAt:now+86400000,reviewMinutes:60,scheduleId:null,allocation};
const stocks=['一档','二档','三档'].map((tier,i)=>({symbol:'sh60000'+(i+1),name:'示例公司'+(i+1),valueTier:tier,valueReason:'仅用于离线界面验收。',technicalScore:70-i*10}));
const report={id:'run-demo',finishedAt:now,status:'completed',summary:'离线界面验收：展示行业分组、股票价值分档、建议和计划。所有数据都是样例。',trigger:'离线样例',industries:[{id:'BK0001',name:'示例行业',group:'主投行业',reason:'这是测试样例，没有进行真实研究。',stocks,coverage:'样例3/3只',ungraded:0}],allocation,planId:plan.id,planSnapshot:plan,planChanged:true,news:[],warnings:[],markdown:'# 离线验收报告\n全部为样例。未发送IM，未创建调度。'};
const config={cash:10000,holdings:[],maxEquityWeight:.7,maxStockWeight:.2,maxIndustryWeight:.4,riskPerStock:.01,horizonDays:30,reviewMinutes:60,trackingEnabled:false,allowAutoRevision:true,industryIds:[],newsMaxAgeHours:48,quoteMaxAgeMinutes:20,partnerTarget:null,advisoryOnly:true};
const state={schema:1,revision:1,config,runs:[],reports:[{id:report.id,finishedAt:now,summary:report.summary,planId:plan.id,status:'completed',archivePath:'reports/run-demo.json'}],plans:[plan],actions:[{id:'demo-wechat',operation:'send_report',format:'text',status:'pending',reportId:report.id,planId:plan.id}],events:[],requests:{},monitorStatus:'离线样例'};
const scenario=new URL(location.href).searchParams.get('scenario');
if(scenario==='first'){state.config=null;state.plans=[];state.reports=[];state.actions=[{id:'fixture-failure',operation:'send_report',format:'file',status:'failed',message:'WORKING_DIR_UNAVAILABLE（离线布局验收样例；非真实回执）'}];}
if(scenario==='ready'){state.plans=[];state.reports=[];state.actions=[];}
const P=globalThis.ASharePaper,t0=Date.parse('2026-11-02T09:00:00+08:00'),t1=Date.parse('2026-11-02T10:00:00+08:00'),t2=Date.parse('2026-11-03T10:00:00+08:00');
const quote=(price,at)=>({symbol:'sh600001',name:'合成标的',price,asOf:at,source:'offline-synthetic',dataKind:'synthetic',priceBasis:'unadjusted'});
let paper=P.setup({ledgerId:'offline-paper',label:'离线合成成本验收',initialCash:10000,at:t0,dataKind:'synthetic',feeModel:{assumptionLabel:'纯演示假设，非券商收费',commissionRate:.001,buyTaxRate:0,sellTaxRate:.001,transferFeeRate:0,minCommission:5,slippageBps:100}});
paper=P.trade(paper,{expectedVersion:paper.version,symbol:'sh600001',side:'buy',quantity:100,at:t1,quote:quote(10,t1),note:'离线合成买入'}).account;
paper=P.mark(paper,{expectedVersion:paper.version,at:t1+60000,quotes:[quote(10,t1+60000)]}).account;
paper=P.trade(paper,{expectedVersion:paper.version,symbol:'sh600001',side:'sell',quantity:100,at:t2,quote:quote(11,t2),note:'离线合成卖出'}).account;
paper=P.mark(paper,{expectedVersion:paper.version,at:t2+60000,quotes:[]}).account;
const sim={schema:1,revision:1,config:null,runs:[],reports:[],plans:[],actions:[],events:[],requests:{},paperAccounts:[paper],monitorStatus:'离线模拟'};
const files=new Map([['state.json',JSON.stringify(state)],['reports/run-demo.json',JSON.stringify({report,plan})],['simulation/state.json',JSON.stringify(sim)]]);
window.cindy={onHostMessage(){},library:async r=>r.op==='open'?{ok:true}:r.op==='read'?files.has(r.path)?{ok:true,content:files.get(r.path)}:{ok:false,errorCode:'NOT_FOUND'}:r.op==='write'?(files.set(r.path,r.content),{ok:true}):{ok:false,message:'离线预览不打开原生文件对话框。'},send:async()=>({ok:true,accepted:0}),
 node:{request:async r=>{
  if(r.method==='sync_monitor')return {ok:true,result:{listening:false}};
  if(r.method==='quotes')return {ok:true,result:{sh600001:{name:'示例公司',price:100,asOf:now}}};
  if(r.method==='information')return {ok:true,result:{symbol:r.params.symbol,fetchedAt:now,announcements:{complete:false,total:8,rows:[{title:'离线展示：季度报告链接（仅界面样例）',url:'https://static.cninfo.com.cn/finalpage/2026-10-31/1225649896.PDF',publishedMs:now-86400000}]},financials:{status:'available',rows:[{reportPeriod:'2026-09-30',noticeDate:'2026-10-31',updateDate:'2026-10-31',metrics:{basicEps:{providerField:'EPSJB',value:1.23,unit:'CNY/share'},revenue:{providerField:'OPERATE_INCOME_PK',value:1000000,unit:'CNY'}}}]},warnings:['离线资料包示例：政策/公告/财报/估值/风险正文尚未互核。']}};
  if(r.method==='news')return {ok:true,result:{rows:[{title:'离线示例资讯',source:'fixture',publishedAt:new Date(now).toISOString()}],warnings:[]}};
  if(r.method==='kline')return {ok:true,result:{source:'fixture',adjustment:'qfq',period:r.params.period||'day',warnings:[],bars:Array.from({length:80},(_,i)=>({date:new Date(now-(79-i)*86400000*({day:1,week:7,month:30}[r.params.period||'day'])).toISOString().slice(0,10),open:80+i*.2,close:80+i*.2+Math.sin(i)*.5,high:81+i*.2,low:79+i*.2,volume:1000}))}};
  return {ok:false,message:'离线预览不执行该研究操作。'};
 }},targets:{list:async()=>({targets:[]})},tasks:{create:async()=>({taskId:'preview-task',revision:1}),send:async()=>({accepted:true})}};
