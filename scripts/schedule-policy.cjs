'use strict';
const Cal=require('../plugin/calendar.js');
function deliveryKey(planId,symbol,kind,date){const normalized={stop_reached:'stop_review',target_reached:'target_review'}[kind]||kind;return `${planId}.${symbol}.${normalized}.${date}`;}
function session(at){const c=Cal.check(at),d=new Date(at+8*3600000),m=d.getUTCHours()*60+d.getUTCMinutes();return {...c,continuous:c.isTradingDay&&((m>=570&&m<690)||(m>=780&&m<897))};}
function validateProjection(p,at){if(!p||p.schema!==1||!Array.isArray(p.symbols)||p.symbols.length>20||new Set(p.symbols).size!==p.symbols.length||p.symbols.some(x=>!/^((sh|sz|bj)\d{6})$/.test(x))||!Number.isSafeInteger(p.publishedAt)||p.publishedAt>at||!Number.isSafeInteger(p.validUntil)||p.validUntil<=at||p.validUntil>p.publishedAt+86400000)return 'PROJECTION_STALE_OR_INVALID';if(!['technical_only','formal_plan'].includes(p.kind))return 'PROJECTION_KIND_UNKNOWN';if(p.kind==='formal_plan'&&(!p.planId||!p.reportId||!p.configured||!p.planExpiresAt||p.planExpiresAt<=at||p.validUntil>p.planExpiresAt||p.planStatus!=='active'))return 'PLAN_NOT_ACTIVE';return null;}
function inspect(p,quotes,at,previous={}){const c=session(at),errors=[],events=[];if(!c.known||!c.continuous)return {status:'skipped',reason:c.known?'OUTSIDE_CONTINUOUS_SESSION':'CALENDAR_UNKNOWN',events,errors};const problem=validateProjection(p,at);if(problem)return {status:'unavailable',errors:[problem],events};
 for(const s of p.symbols){const q=quotes[s];if(!q||!q.name||!Number.isFinite(q.price)||q.price<=0||q.priceBasis!=='unadjusted'||!Number.isSafeInteger(q.asOf)||q.asOf>at+5000||at-q.asOf>120000||Cal.dateCN(q.asOf)!==c.date||!q.source||(previous[s]&&q.asOf<previous[s])){errors.push(s+':QUOTE_STALE_OR_INVALID');continue;}
  if(p.kind!=='formal_plan')continue;const t=p.conditions?.find(x=>x.symbol===s);if(!t)continue;
  const kind=Number.isFinite(t.stop)&&q.price<=t.stop?'stop_review':Number.isFinite(t.target)&&q.price>=t.target?'target_review':t.entryRangeConfirmed===true&&Array.isArray(t.entryRange)&&t.entryRange.length===2&&t.entryRange.every(Number.isFinite)&&t.entryRange[0]>0&&t.entryRange[1]>=t.entryRange[0]&&q.price>=t.entryRange[0]&&q.price<=t.entryRange[1]?'entry_price_review':null;
  if(kind)events.push({key:deliveryKey(p.planId,s,kind,c.date),symbol:s,kind,price:q.price,quoteAt:q.asOf,planId:p.planId,planRevision:p.planRevision,reportId:p.reportId,note:'只触发同会话复核，不代表可以买卖或已成交。'});
 }
 return {status:errors.length?'partial_or_unavailable':'collected',events,errors};}
module.exports={session,validateProjection,inspect,deliveryKey};
