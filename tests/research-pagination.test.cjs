'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {host}=require('./helpers/host.cjs');

async function prepare(incremental,allMissing){
  const items=Array.from({length:7},(_,i)=>({symbol:'sh'+(600001+i),name:'分页离线样本'+i,quote:{price:allMissing||i>=5?null:100+i,asOf:Date.now(),source:'offline-pagination-fixture'}}));
  const files=new Map(),h=host(files,false,false,{sectors:[{id:'BK0001',name:'离线行业',amount:100}],items});
  const config={cash:10000,holdings:[],maxEquityWeight:.7,maxStockWeight:.2,maxIndustryWeight:.4,riskPerStock:.01,horizonDays:30,reviewMinutes:60,trackingEnabled:false,allowAutoRevision:false,industrySelectionMode:'manual',industryIds:['BK0001']};
  assert.equal((await h.call('configure',{requestKey:'config',expectedRevision:0,config})).ok,true);
  const started=await h.call('begin_research',{requestKey:'begin'});assert.equal(started.ok,true,JSON.stringify(started));const runId=started.result.runId;
  let batch=0;
  while((await h.call('get_research',{runId})).result.status==='collecting')assert.equal((await h.call('collect_batch',{runId,requestKey:'batch-'+batch++,batchSize:8})).ok,true);
  assert.equal((await h.call('refresh_context',{runId,requestKey:'refresh',...(incremental?{incremental:true}:{})})).ok,true);
  return {h,files,runId,items};
}
async function pages(h,runId,view){
  const rows=[],ungraded=[];let offset=0,token,total;
  for(let n=0;n<10;n++){
    const x=await h.call('get_research',{runId,sectorId:'BK0001',...(view?{view}:{}),offset,limit:3});assert.equal(x.ok,true,JSON.stringify(x));const p=x.result;
    total=p.totalStocks;rows.push(...p.stocks);ungraded.push(...(p.ungraded||[]));
    if(p.contextToken){if(token)assert.equal(p.contextToken,token);token=p.contextToken;}
    if(p.nextOffset===null)return {rows,ungraded,token,total};
    assert.ok(p.nextOffset>offset);offset=p.nextOffset;
  }
  assert.fail('Pagination did not terminate');
}
for(const incremental of [false,true])for(const allMissing of [false,true]){
  test(`protocol ${incremental?2:1} keeps ${allMissing?'all unquoted':'mixed quoted/unquoted'} members across pages and restart`,async()=>{
    const {h,files,runId,items}=await prepare(incremental,allMissing);
    const revision=(await h.call('get_state')).result.revision;
    const assigned=(await h.call('get_research',{runId,view:'delegation'})).result.assignments[0];
    const delegated=await pages(h,runId,'delegation'),overview=await pages(h,runId);
    assert.equal(assigned.stockCount,items.length);assert.equal(delegated.total,items.length);assert.equal(overview.total,items.length);
    for(const p of [delegated,overview]){
      assert.equal(p.rows.length,items.length);assert.equal(new Set(p.rows.map(s=>s.symbol)).size,items.length);
      assert.deepEqual(new Set(p.rows.map(s=>s.symbol)),new Set(items.map(s=>s.symbol)));
      for(const s of p.rows.filter(s=>s.quote.price===null)){assert.equal(s.indicators.ready,true);assert.equal(s.technicalScore,undefined);assert.equal(s.tier,undefined);}
    }
    const missing=items.filter(s=>s.quote.price===null).map(s=>s.symbol);
    assert.deepEqual(new Set(overview.ungraded.map(s=>s.symbol)),new Set(missing));
    const last=(await h.call('get_research',{runId,sectorId:'BK0001',view:'delegation',offset:items.length,limit:3})).result;
    assert.equal(last.stocks.length,0);assert.equal(last.nextOffset,null);assert.equal(last.totalStocks,items.length);
    const restarted=host(files,false,false,{sectors:[{id:'BK0001',name:'离线行业',amount:100}],items});
    assert.equal((await pages(restarted,runId,'delegation')).token,delegated.token);
    assert.equal((await h.call('get_state')).result.revision,revision);
    if(incremental){
      const args={requestKey:'reject-incomplete-read',runId,expectedContextToken:delegated.token,workerId:'/fixture/pagination-reader',industry:{id:'BK0001',assessment:'insufficient',group:null,reason:'离线分页覆盖回归，缺报价及正文，不能构成投资判断。',missingReasons:['缺报价及五类正文互核'],newsIds:[]},readCoverage:{stocksRead:items.length-2,totalStocks:items.length,limitations:'故意少读两条，必须拒绝。'},stockValues:[]};
      assert.equal((await h.call('record_judgment',args)).errorCode,'BAD_AI_OUTPUT');
      assert.equal((await h.call('get_state')).result.revision,revision);
      const complete={...args,requestKey:'complete-read',readCoverage:{stocksRead:items.length,totalStocks:items.length,limitations:'完整读取离线样本；报价缺失仍保留，不制造分档。'}};
      assert.equal((await h.call('record_judgment',complete)).ok,true);
    }
  });
}
