(function(root,factory){const node=typeof module==='object'&&module.exports,api=factory(node?require('./core.js'):root.AShareCore,node?require('./calendar.js'):root.AShareCalendar);if(node)module.exports=api;else root.AShareExecution=api;})(globalThis,function(C,Cal){
'use strict';
const DAY=86400000,RULES={asOf:'2026-11-05',validFrom:'2026-07-06',reviewAfter:'2026-12-31',sources:[
'https://www.sse.com.cn/lawandrules/sselawsrules2025/trade/universal/c/c_20260424_10816492.shtml',
'https://www.szse.cn/lawrules/rule/trade/current/t20260424_620190.html',
'https://www.bse.cn/jygl_list/200028217.html']};
const finite=n=>typeof n==='number'&&Number.isFinite(n),num=x=>finite(x)?x:null;
function board(s){return /^sh60[0135]\d{3}$/.test(s)?{id:'main_sh',name:'沪市主板',minimum:100,step:100,odd:100}:/^sz00[0123]\d{3}$/.test(s)?{id:'main_sz',name:'深市主板',minimum:100,step:100,odd:100}:/^sh688\d{3}$/.test(s)?{id:'star',name:'科创板',minimum:200,step:1,odd:200}:/^sz30[01]\d{3}$/.test(s)?{id:'chinext',name:'创业板',minimum:100,step:100,odd:100}:/^bj(?:[48]\d{5}|92\d{4})$/.test(s)?{id:'bse',name:'北交所',minimum:100,step:1,odd:100}:null;}
function fees(value,side,f){if(!f||!String(f.assumptionLabel||'').trim())return null;for(const k of ['commissionRate','buyTaxRate','sellTaxRate','transferFeeRate'])if(!finite(f[k])||f[k]<0||f[k]>.1)return null;if(!finite(f.minCommission)||f.minCommission<0||f.minCommission>1000)return null;const cents=n=>Math.round(n*100);const commission=Math.max(cents(f.minCommission),Math.round(cents(value)*f.commissionRate)),tax=Math.round(cents(value)*(side==='buy'?f.buyTaxRate:f.sellTaxRate)),transfer=Math.round(cents(value)*f.transferFeeRate);return {commission:commission/100,tax:tax/100,transferFee:transfer/100,total:(commission+tax+transfer)/100,assumptionLabel:f.assumptionLabel};}
function evaluate(snapshot,order={},at=Date.now()){
 const issues=[],unknown=[],add=(code,message,uncertain=false)=>(uncertain?unknown:issues).push({code,message});
 const symbol=snapshot?.symbol,b=board(symbol||''),cal=Cal.check(at),q=snapshot?.quote||{},identity=snapshot?.identity;
 if(!b)add('NOT_SUPPORTED_A_SHARE','代码不属于本版识别的沪深北普通A股范围，排除B股、基金、债券、CDR及指数。');
 if(!identity||identity.symbol!==symbol||identity.category!=='A股'||!Number.isFinite(identity.fetchedAt)||at-identity.fetchedAt>DAY||identity.fetchedAt>at+60000)add('A_SHARE_IDENTITY_UNKNOWN','官方主体目录的A股类别、身份或时效未核验。',true);
 if(!cal.known||cal.date<RULES.validFrom||cal.date>RULES.reviewAfter)add('RULES_OR_CALENDAR_UNKNOWN','交易规则或官方日历未覆盖此日期。',true);
 const minute=new Date(at+8*3600000).getUTCHours()*60+new Date(at+8*3600000).getUTCMinutes();
 if(!cal.isTradingDay||!((minute>=570&&minute<690)||(minute>=780&&minute<897)))add('SESSION_NOT_SUPPORTED','本技术检查仅覆盖连续竞价时段；集合竞价、收盘后和休市均等待。');
 if(q.symbol!==symbol)add('QUOTE_IDENTITY_MISMATCH','报价主体与所查股票不一致。',true);
 if(!finite(q.price)||q.price<=0||!finite(q.asOf)||q.asOf>at+60000||at-q.asOf>120000||Cal.dateCN(q.asOf)!==cal.date)add('QUOTE_NOT_CURRENT','没有同一交易日两分钟内的未复权报价；旧收盘价仅作参考。',true);
 if(snapshot?.priceBasis!=='unadjusted')add('PRICE_BASIS_UNKNOWN','执行检查必须使用未复权报价。',true);
 const safety=C.recommendationSafety({name:identity?.name},q);if(!safety.allowed&&order.side!=='sell')add(safety.code,safety.message);
 if(b&&!order.permissions?.includes(b.id))add('BOARD_ACCESS_UNCONFIRMED','该板块的账户交易权限未明确提供；不从100万元资金推定已开通。',true);else if(b&&(!finite(order.permissionsAsOf)||order.permissionsAsOf>at||at-order.permissionsAsOf>DAY||!String(order.permissionsSource||'').trim()))add('BOARD_ACCESS_DECLARED_ONLY','权限声明缺少来源或最近24小时核对时间，不等于券商认证。',true);
 // Public aggregate feeds do not currently supply a verified trading-status contract.
 const status=snapshot?.tradingStatus;if(!status||status.value==='unknown'||status.authoritative!==true||!finite(status.asOf)||Math.abs(at-status.asOf)>120000||Cal.dateCN(status.asOf)!==cal.date||!String(status.source||'').trim())add('TRADING_STATUS_UNKNOWN','停牌/复牌等交易状态缺少经过核实的及时来源。',true);else if(status.value!=='normal')add('NOT_NORMAL_TRADING','当前交易状态不是正常连续交易。');
 const limits=snapshot?.limits;
 if(!limits||limits.verifiedAcrossSources!==true||limits.date!==cal.date||!finite(limits.asOf)||!finite(limits.secondaryAsOf)||limits.asOf>at+60000||limits.secondaryAsOf>at+60000||at-limits.asOf>120000||at-limits.secondaryAsOf>120000||!Array.isArray(limits.sources)||limits.sources.length<2||!finite(limits.upper)||!finite(limits.lower)||limits.lower<=0||limits.upper<=limits.lower)add('LIMITS_UNCONFIRMED','缺少当日、双源一致的实际涨跌停价格；不按板块比例猜测。',true);
 let price=finite(order.limitPrice)?order.limitPrice:num(q.price),quantity=order.quantity;
 if(!['buy','sell'].includes(order.side))add('ORDER_SIDE_REQUIRED','须明确模拟检查方向buy/sell。');
 if(!Number.isSafeInteger(quantity)||quantity<=0||quantity>10000000)add('QUANTITY_INVALID','数量须为1至1000万股的整数。');
 if(!finite(price)||price<=0||price>1000000||Math.abs(price*100-Math.round(price*100))>1e-6)add('PRICE_TICK_INVALID','A股参考申报价须为正数、精确到0.01元。');
 if(b&&Number.isSafeInteger(quantity)&&quantity>0){
  if(order.side==='buy'&&(quantity<b.minimum||(quantity-b.minimum)%b.step!==0))add('BUY_LOT_INVALID',b.name+'买入数量不符合最小数量及递增规则。');
  if(order.side==='sell'){
   const lots=order.holdingLots;
   if(!Array.isArray(lots)||!lots.length||lots.some(l=>!/^\d{4}-\d{2}-\d{2}$/.test(l.date)||l.date>cal.date||!Number.isSafeInteger(l.quantity)||l.quantity<=0)||lots.reduce((n,l)=>n+l.quantity,0)!==order.positionQuantity)add('T1_LOTS_UNKNOWN','缺少与持仓一致的取得日期批次，不能独立核对T+1。',true);
   else if(quantity>lots.filter(l=>l.date<cal.date).reduce((n,l)=>n+l.quantity,0))add('T1_UNAVAILABLE','模拟取得日期批次显示当日买入数量不可卖出。');
   if(!Number.isSafeInteger(order.positionQuantity)||!Number.isSafeInteger(order.sellableQuantity)||order.sellableQuantity<0||order.sellableQuantity>order.positionQuantity||!Number.isFinite(order.sellableAsOf)||order.sellableAsOf>at||at-order.sellableAsOf>120000)add('SELLABLE_UNKNOWN','需要明确持仓及同日及时的可卖数量（含T+1核对），不从建议推定已成交。',true);
   else if(quantity>order.sellableQuantity)add('OVERSELL_OR_T1','卖出数量超过可卖数量，可能为T+1限制或超卖。');
   if(quantity<b.minimum){if(quantity!==order.sellableQuantity)add('ODD_LOT_PARTIAL','不足最小数量的可卖余股须一次性卖出。');}
   else if(b.step===100&&quantity%100&&!(quantity===order.positionQuantity&&quantity===order.sellableQuantity))add('SELL_LOT_INVALID','整手数量及不足一手余股需分开核对，本检查不生成混合申报。');
  }
 }
 if(finite(price)&&limits?.verifiedAcrossSources&&limits.date===cal.date){if(price>limits.upper||price<limits.lower)add('PRICE_OUTSIDE_LIMIT','参考申报价超出当日实际涨跌停范围。');if(order.side==='buy'&&q.price>=limits.upper)add('AT_UPPER_LIMIT','已达涨停，不能假定买得到。');if(order.side==='sell'&&q.price<=limits.lower)add('AT_LOWER_LIMIT','已达跌停，不能假定卖得出。');}
 const book=snapshot?.book;
 if(!book||!finite(book.bid)||!finite(book.ask)||book.bid<=0||book.ask<=0||book.bid>book.ask)add('BOOK_NOT_USABLE','买卖盘口缺失或不可信；不能据最新成交价保证可成交。',true);
 if(finite(order.maxDayAmountParticipation)){
  if(order.maxDayAmountParticipation<=0||order.maxDayAmountParticipation>1)add('LIQUIDITY_ASSUMPTION_INVALID','测试参与率阈值须大于0且不超过1。');
  else if(!finite(q.amount)||q.amount<=0)add('LIQUIDITY_UNKNOWN','成交额缺失，无法做显式测试阈值检查。',true);
  else if(finite(price)&&quantity*price/q.amount>order.maxDayAmountParticipation)add('LIQUIDITY_TEST_LIMIT','参考金额超过设定的当日累计成交额参与率；这不是实际冲击成本预测。');
 }
 const notional=finite(price)&&Number.isSafeInteger(quantity)&&quantity>0?Math.round(price*quantity*100)/100:null,fee=notional!==null?fees(notional,order.side,order.feeModel):null;
 if(!fee)add('FEES_UNCONFIRMED','佣金和费用模型未明确；不把测试假设当真实券商费率。',true);
 const requiredCash=notional!==null&&fee?Math.round((notional+fee.total)*100)/100:null;
 if(order.side==='buy'){if(!finite(order.cash)||order.cash<0)add('CASH_UNKNOWN','检查所用可用现金未明确。',true);else if(requiredCash!==null&&requiredCash>order.cash)add('CASH_INSUFFICIENT','参考价款加费用超过可用现金。');}
 return {symbol,board:b,rules:RULES,checkedAt:at,status:issues.length?'blocked':unknown.length?'unverified':'checks_passed',canAssumeFill:false,issues,unknown,estimate:{price,quantity,notional,fees:fee,cashRequired:order.side==='buy'?requiredCash:null,netProceeds:order.side==='sell'&&notional!==null&&fee?Math.round((notional-fee.total)*100)/100:null},marketSnapshot:snapshot,limitations:'只读、有限的技术检查，不下单；通过也不代表一定成交。未模拟撮合、队列、冲击成本、除权、盘中临停、竞价边界和券商动态规则。'};
}
return {RULES,board,fees,evaluate};
});
