(function(root,factory){const node=typeof module==='object'&&module.exports,api=factory(node?require('./core.js'):root.AShareCore,node?require('./calendar.js'):root.AShareCalendar);if(node)module.exports=api;else root.ASharePaper=api;})(globalThis,function(C,Cal){
  'use strict';
  const copy=x=>JSON.parse(JSON.stringify(x)),money=c=>c/100;
  const fail=(code,message)=>C.fail(code,message);
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  const cents=n=>{const c=Math.round(n*100);if(!Number.isSafeInteger(c))fail('PAPER_NUMBER','金额超过安全计算范围。');return c;};
  const limitations='仅模拟记账，不是真实成交或盈利证明；仅含主板整手及T+1的有限模型，未模拟撮合、停牌/涨跌停、流动性、分红送股或出入金。回撤仅按完整估值记录时点计算。';
  function text(v,name,max=200){if(typeof v!=='string'||!v.trim()||v.length>max)fail('PAPER_INPUT',name+'须为非空文字。');return v.trim();}
  function time(at,previous=0){if(!Number.isSafeInteger(at)||at<previous||at>Date.now()+60000||!Cal.check(at).known)fail('PAPER_TIME','时间须按先后顺序、在已核实日历内，不能使用未来时间。');return at;}
  function fees(input){
    const out={assumptionLabel:text(input?.assumptionLabel,'费用假设说明')};
    for(const k of ['commissionRate','buyTaxRate','sellTaxRate','transferFeeRate']){if(!finite(input?.[k])||input[k]<0||input[k]>.1)fail('PAPER_FEES',k+'须显式给出0至0.1的模拟费率。');out[k]=input[k];}
    if(!finite(input.minCommission)||input.minCommission<0||input.minCommission>1000||Math.abs(input.minCommission*100-Math.round(input.minCommission*100))>1e-7)fail('PAPER_FEES','最低佣金须显式给出，精确到分。');
    if(!finite(input.slippageBps)||input.slippageBps<0||input.slippageBps>1000)fail('PAPER_FEES','模拟滑点须显式给出0至1000基点。');
    return {...out,minCommission:input.minCommission,slippageBps:input.slippageBps};
  }
  function observation(q,at,kind,previous=0,expectedSymbol){
    if(!q?.symbol||C.symbol(q.symbol)!==expectedSymbol)fail('PAPER_QUOTE_SYMBOL','参考报价的股票代码与记账标的不一致。');
    if(!q||q.dataKind!==kind||q.priceBasis!=='unadjusted'||!finite(q.price)||q.price<=0||q.price>1000000)fail('PAPER_QUOTE','报价须与账本来源类型一致，且为有效未复权价格。');
    if(!Number.isSafeInteger(q.asOf)||q.asOf>at||at-q.asOf>7*86400000||q.asOf<previous)fail('PAPER_QUOTE_TIME','报价时间不能超前、倒退或超过7天。');
    return {symbol:expectedSymbol,name:text(q.name,'报价名称'),price:q.price,asOf:q.asOf,source:text(q.source,'报价来源'),dataKind:q.dataKind,priceBasis:q.priceBasis};
  }
  function setup(a){
    if(!/^[a-zA-Z0-9_-]{3,80}$/.test(a.ledgerId||''))fail('PAPER_INPUT','ledgerId须为3至80位字母数字、横线或下划线。');
    if(!finite(a.initialCash)||a.initialCash<=0||a.initialCash>1e9||Math.abs(a.initialCash*100-Math.round(a.initialCash*100))>1e-7)fail('PAPER_CAPITAL','初始模拟资金须大于0、不超过10亿元，精确到分。');
    if(!['synthetic','observed_manual'].includes(a.dataKind))fail('PAPER_INPUT','来源类型须明确为synthetic或observed_manual。');
    const at=time(a.at),initialCents=cents(a.initialCash);
    return {schema:1,id:a.ledgerId,label:text(a.label,'账本名称'),mode:'simulation',dataKind:a.dataKind,version:1,initialCents,cashCents:initialCents,feeModel:fees(a.feeModel),createdAt:at,lastEventAt:at,realizedCents:0,feesCents:0,slippageCents:0,positions:[],trades:[],observedTimes:{},valuations:[{at,equity:a.initialCash,cash:a.initialCash,marketValue:0,realizedPnl:0,unrealizedPnl:0,totalPnl:0,netReturn:0,totalFees:0,slippageCost:0,drawdown:0,maxDrawdown:0,quotes:[],initial:true}],needsValuation:false,limitations};
  }
  function check(account,a){if(!account)fail('PAPER_NOT_FOUND','模拟账本不存在。');if(a.expectedVersion!==account.version)fail('PAPER_VERSION','账本已变化，先读取最新版本。');time(a.at,account.lastEventAt);}
  function trade(account,a){
    check(account,a);if(account.trades.length>=1000)fail('PAPER_LIMIT','单账本达到1000笔上限，请导出后另建账本。');
    const symbol=C.symbol(a.symbol);if(!/^(?:sh60[0135]\d{3}|sz00[0123]\d{3})$/.test(symbol))fail('PAPER_UNSUPPORTED','本模拟器仅支持沪深主板普通股票代码，不假定其他板块规则。');
    const calendar=Cal.check(a.at),shifted=new Date(a.at+8*3600000),minute=shifted.getUTCHours()*60+shifted.getUTCMinutes();
    if(!calendar.isTradingDay||!((minute>=570&&minute<=690)||(minute>=780&&minute<=900)))fail('PAPER_SESSION','仅在已核实开盘日的09:30–11:30、13:00–15:00记录模型成交。');
    if(!['buy','sell'].includes(a.side)||!Number.isSafeInteger(a.quantity)||a.quantity<=0||a.quantity>1e7)fail('PAPER_QUANTITY','方向须为buy/sell，数量须为1至1000万之间的整数。');
    const q=observation(a.quote,a.at,account.dataKind,account.observedTimes[symbol]||0,symbol);
    if(a.at-q.asOf>15*60000||Cal.dateCN(q.asOf)!==calendar.date)fail('PAPER_QUOTE_TIME','模型成交只接受同一交易日15分钟内的参考报价。');
    if(a.side==='buy'){const safety=C.recommendationSafety({name:q.name},q);if(!safety.allowed)fail(safety.code,safety.message);if(a.quantity%100)fail('PAPER_LOT','本模型买入数量必须为100股的整数倍。');}
    const out=copy(account),p=out.positions.find(x=>x.symbol===symbol),fee=out.feeModel;
    if(a.side==='buy'&&!p&&out.positions.length>=100)fail('PAPER_LIMIT','单账本最多100只模拟持仓。');
    if(a.side==='sell'){
      if(!p||a.quantity>p.quantity)fail('PAPER_OVERSELL','不能卖出超过已记模拟持仓的数量。');
      if(a.quantity%100&&a.quantity!==p.quantity)fail('PAPER_LOT','本有限模型仅允许整手卖出或整仓退出。');
      const available=p.lots.filter(l=>l.date<calendar.date).reduce((n,l)=>n+l.quantity,0);
      if(a.quantity>available)fail('PAPER_T1','当日模拟买入数量不可当日卖出。');
    }
    const executionPrice=C.round(q.price*(1+(a.side==='buy'?1:-1)*fee.slippageBps/10000),6),notionalCents=cents(executionPrice*a.quantity);
    if(executionPrice<=0||notionalCents<=0)fail('PAPER_NUMBER','模型成交金额必须大于0。');
    const commission=Math.max(cents(fee.minCommission),Math.round(notionalCents*fee.commissionRate)),tax=Math.round(notionalCents*(a.side==='buy'?fee.buyTaxRate:fee.sellTaxRate)),transfer=Math.round(notionalCents*fee.transferFeeRate),feeCents=commission+tax+transfer;
    let realizedCents=0;
    if(a.side==='buy'){
      const debit=notionalCents+feeCents;if(debit>out.cashCents)fail('PAPER_CASH','模拟现金不足以覆盖价款和费用。');
      const position=p||{symbol,name:q.name,quantity:0,bookCostCents:0,lots:[]};
      position.quantity+=a.quantity;position.bookCostCents+=debit;position.name=q.name;position.lots.push({date:calendar.date,quantity:a.quantity});if(!p)out.positions.push(position);out.cashCents-=debit;
    }else{
      const credit=notionalCents-feeCents;if(out.cashCents+credit<0)fail('PAPER_CASH','模拟现金不足以承担卖出费用。');
      const removed=a.quantity===p.quantity?p.bookCostCents:Math.round(p.bookCostCents*a.quantity/p.quantity);
      realizedCents=credit-removed;p.bookCostCents-=removed;p.quantity-=a.quantity;let left=a.quantity;
      for(const lot of p.lots){if(lot.date>=calendar.date)continue;const take=Math.min(left,lot.quantity);lot.quantity-=take;left-=take;}
      p.lots=p.lots.filter(l=>l.quantity>0);out.positions=out.positions.filter(x=>x.quantity>0);out.cashCents+=credit;out.realizedCents+=realizedCents;
    }
    const slippageCents=Math.abs(notionalCents-cents(q.price*a.quantity));
    if(![out.cashCents,out.realizedCents,...out.positions.map(p=>p.bookCostCents)].every(Number.isSafeInteger))fail('PAPER_NUMBER','累计金额超过安全计算范围。');
    const event={sequence:out.trades.length+1,at:a.at,symbol,side:a.side,quantity:a.quantity,referenceQuote:q,executionPrice,notional:money(notionalCents),commission:money(commission),tax:money(tax),transferFee:money(transfer),fees:money(feeCents),slippageCost:money(slippageCents),realizedPnl:money(realizedCents),cashAfter:money(out.cashCents),note:text(a.note,'模拟成交说明',500),relatedReportId:typeof a.relatedReportId==='string'?a.relatedReportId.slice(0,120):null,modelFill:true};
    out.trades.push(event);out.feesCents+=feeCents;out.slippageCents+=slippageCents;out.lastEventAt=a.at;out.observedTimes[symbol]=q.asOf;out.version++;out.needsValuation=true;return {account:out,event};
  }
  function mark(account,a){
    check(account,a);if(a.at<=account.valuations.at(-1).at)fail('PAPER_TIME','新估值时间必须晚于上一估值，不覆盖历史。');
    if(account.valuations.length>=1000)fail('PAPER_LIMIT','估值达到1000条上限，请导出后另建账本。');
    if(!Array.isArray(a.quotes)||a.quotes.length!==account.positions.length)fail('PAPER_MARK_INCOMPLETE','必须为每只模拟持仓提供一条报价，不能缺失或重复。');
    const seen=new Set(),observations=[],out=copy(account);let marketCents=0,bookCents=0;
    for(const row of a.quotes){const symbol=C.symbol(row.symbol),p=account.positions.find(p=>p.symbol===symbol);if(!p||seen.has(symbol))fail('PAPER_MARK_INCOMPLETE','估值含未知或重复持仓。');seen.add(symbol);
      const q=observation(row,a.at,account.dataKind,account.observedTimes[symbol]||0,symbol);marketCents+=cents(q.price*p.quantity);bookCents+=p.bookCostCents;if(!Number.isSafeInteger(marketCents)||!Number.isSafeInteger(bookCents))fail('PAPER_NUMBER','组合金额超过安全计算范围。');out.observedTimes[symbol]=q.asOf;observations.push({symbol,...q});
    }
    const equityCents=account.cashCents+marketCents,totalPnlCents=equityCents-account.initialCents,unrealizedCents=marketCents-bookCents;
    if(totalPnlCents!==account.realizedCents+unrealizedCents)fail('PAPER_INVARIANT','账本收益恒等式未通过，未写入估值。');
    if(![equityCents,totalPnlCents,unrealizedCents].every(Number.isSafeInteger))fail('PAPER_NUMBER','估值超过安全计算范围。');
    const high=Math.max(...account.valuations.map(v=>v.equity),money(equityCents)),drawdown=high>0?(high-money(equityCents))/high:0;
    const valuation={at:a.at,cash:money(account.cashCents),marketValue:money(marketCents),equity:money(equityCents),realizedPnl:money(account.realizedCents),unrealizedPnl:money(unrealizedCents),totalPnl:money(totalPnlCents),netReturn:totalPnlCents/account.initialCents,totalFees:money(account.feesCents),slippageCost:money(account.slippageCents),drawdown,oldestQuoteAt:observations.length?Math.min(...observations.map(q=>q.asOf)):a.at,hasAgedQuotes:observations.some(q=>a.at-q.asOf>15*60000),maxDrawdown:Math.max(drawdown,...account.valuations.map(v=>v.maxDrawdown)),quotes:observations};
    out.valuations.push(valuation);out.lastEventAt=a.at;out.version++;out.needsValuation=false;return {account:out,valuation};
  }
  function view(a){return {id:a.id,label:a.label,mode:'simulation',dataKind:a.dataKind,version:a.version,createdAt:a.createdAt,lastEventAt:a.lastEventAt,initialCash:money(a.initialCents),cash:money(a.cashCents),realizedPnl:money(a.realizedCents),totalFees:money(a.feesCents),slippageCost:money(a.slippageCents),positions:a.positions.map(p=>({symbol:p.symbol,name:p.name,quantity:p.quantity,bookCost:money(p.bookCostCents),averageCost:C.round(money(p.bookCostCents)/p.quantity,6),lots:copy(p.lots)})),feeModel:copy(a.feeModel),tradeCount:a.trades.length,trades:copy(a.trades.slice(-20)),needsValuation:a.needsValuation,currentValuation:a.needsValuation?null:copy(a.valuations.at(-1)),lastValuation:copy(a.valuations.at(-1)),curve:a.valuations.map(v=>({at:v.at,equity:v.equity})),limitations};}
  function markdown(a){const v=view(a),n=v.currentValuation,lines=[`# 【模拟账本】${v.label}`,`账本 ${v.id} · 版本${v.version} · 来源类型${v.dataKind}`,'',limitations,`初始模拟资金${v.initialCash}元；当前账面现金${v.cash}元。`, `费用假设：${JSON.stringify(v.feeModel)}。此为模型假设，非券商实际收费。`,n?`完整估值 ${new Date(n.at).toISOString()}：权益${n.equity}元，净盈亏${n.totalPnl}元，净收益率${C.round(n.netReturn*100,4)}%，已实现${n.realizedPnl}元，未实现${n.unrealizedPnl}元，记录时点最大回撤${C.round(n.maxDrawdown*100,4)}%。`:'最新交易后尚未完整估值，当前权益/净收益未计算；不要把旧估值当当前结果。',`累计费用${v.totalFees}元，模型滑点差额${v.slippageCost}元；已计入现金/成本，不重复扣除。`,'','## 模拟持仓'];for(const p of v.positions)lines.push(`- ${p.symbol} ${p.name}：${p.quantity}股，账面成本${p.bookCost}元。`);lines.push('','## 模拟成交（全部）');for(const t of a.trades)lines.push(`- ${new Date(t.at).toISOString()} ${t.side} ${t.symbol} ${t.quantity}股；参考${t.referenceQuote.price}（${t.referenceQuote.source}，${new Date(t.referenceQuote.asOf).toISOString()}）；模型价${t.executionPrice}；费用${t.fees}元；滑点差额${t.slippageCost}元；${t.note}`);if(n){lines.push('',n.hasAgedQuotes?'本次估值含超过15分钟的历史观察报价，不是实时账户估值。':'估值基于列明时间的观察报价，不保证可成交。','## 估值报价');for(const q of n.quotes)lines.push(`- ${q.symbol}：${q.price}，${q.priceBasis}，${q.source}，${new Date(q.asOf).toISOString()}。`);}return lines.join('\n');}
  return {setup,trade,mark,view,markdown,limitations};
});
