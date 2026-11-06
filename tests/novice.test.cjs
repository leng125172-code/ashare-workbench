'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../plugin/core.js');
const now=Date.now(),cfg=C.config({cash:100000,holdings:[],maxEquityWeight:.6,maxStockWeight:.2,maxIndustryWeight:.3,riskPerStock:.01,horizonDays:30,reviewMinutes:60});
const conditions={entryCondition:'公开证据未变且当前价格条件核验后再考虑。',waitCondition:'资讯或报价过期就等待。',invalidationCondition:'原经营假设失效则重新研究。'};
const stock={symbol:'sh600001',name:'普通合成标的',sectorId:'BK1'},quote={name:'普通合成标的',price:10,asOf:now,source:'synthetic-test'},decision={symbol:stock.symbol,weight:.2,stop:9,target:12,reason:'合成测试',...conditions};
const alloc=(s=stock,q=quote,a=decision,c=cfg)=>C.allocate(c,[s],[a],{[stock.symbol]:q},now);
test('risk names from either source reject positive advice including normalized ST variants',()=>{
 for(const name of ['ST合成','*ST合成',' ｓｔ 合成','＊ＳＴ合成','合成退','退市合成']){
  assert.throws(()=>alloc({...stock,name}),{code:'RISK_NAME_BLOCKED'},name);
  assert.throws(()=>alloc(stock,{...quote,name}),{code:'RISK_NAME_BLOCKED'},name);
 }
 assert.equal(alloc({...stock,name:'测试TEST公司'},{...quote,name:'测试TEST公司'}).positions[0].weight,.1);
});
test('unknown quote identity rejects positive advice but risk holding exits preserve actual facts',()=>{
 for(const name of [undefined,'','600001','sh600001'])assert.throws(()=>alloc(stock,{...quote,name}),{code:'IDENTITY_UNVERIFIED'});
 const c={...cfg,holdings:[{symbol:stock.symbol,name:'ST合成',quantity:100,cost:8}]},before=JSON.stringify(c);
 const out=C.allocate(c,[],[{symbol:stock.symbol,weight:0,reason:'研究退出，不是成交'}],{[stock.symbol]:{...quote,name:'*ST合成'}},now);
 assert.equal(out.positions[0].weight,0);assert.equal(out.positions[0].actualQuantity,100);assert.equal(JSON.stringify(c),before);
});
test('all three nonblank conditions are required; an empty-portfolio wait plan stays valid',()=>{
 for(const key of Object.keys(conditions))for(const value of [undefined,' ',12,'x'.repeat(1201)])assert.throws(()=>alloc(stock,quote,{...decision,[key]:value}),{code:'ADVICE_CONDITIONS_REQUIRED'});
 const empty=C.allocate(cfg,[],[],{},now);assert.equal(empty.cashWeight,1);assert.equal(empty.riskEstimate.stopDistanceLoss,0);assert.deepEqual(empty.currentHoldings,[]);
});
test('stop-distance estimates use final constrained positions and do not claim actual loss ceilings',()=>{
 const out=C.allocate(cfg,[stock,{...stock,symbol:'sh600002',sectorId:'BK2'}],[decision,{...decision,symbol:'sh600002'}],{sh600001:quote,sh600002:quote},now);
 assert.equal(out.positions[0].targetValue,10000);assert.equal(out.positions[0].stopDistanceLoss,1000);assert.equal(out.riskEstimate.stopDistanceLoss,2000);assert.equal(out.riskEstimate.equityFraction,.02);
 assert.match(out.riskEstimate.basis,/不是实际最大亏损/);assert.match(out.riskEstimate.basis,/费用、跳空或滑点/);
 const report={id:'novice',mode:'simulation',finishedAt:now,trigger:'合成测试',summary:'样例',status:'completed',industries:[],allocation:out,warnings:[],news:[]};
 const md=C.reportMarkdown(report,null);assert.match(md,/考虑条件/);assert.match(md,/等待条件/);assert.match(md,/失效条件/);assert.match(md,/估算损失合计：2000元/);assert.match(C.imSummary(report,null),/不是实际最大亏损/);
});
test('legacy or incomplete snapshots show missing conditions and never make up risk amounts',()=>{
 const allocation={equity:100000,positions:[{symbol:'sh600001',weight:.1,targetValue:10000}]};assert.equal(C.riskEstimate(allocation).available,false);assert.equal(C.riskEstimate(allocation).stopDistanceLoss,null);
 const md=C.reportMarkdown({id:'old',finishedAt:now,industries:[],allocation:{...allocation,omittedHoldings:[]},warnings:[],news:[]},null);assert.match(md,/历史建议未记录/);assert.match(md,/风险金额缺少计算依据/);
});
