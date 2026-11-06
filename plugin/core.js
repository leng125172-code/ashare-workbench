/* Original implementation. Shared by Cindy's browser logic and the Node worker. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AShareCore = api;
})(globalThis, function () {
  'use strict';
  const GROUPS = ['主投行业', '二级投资行业', '三级投资行业', '不推荐行业'];
  const TIERS = ['一档', '二档', '三档'];
  class DomainError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const fail = (code, text) => { throw new DomainError(code, text); };
  const finite = v => v !== null && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));
  const number = v => finite(v) ? Number(v) : null;
  const round = (v, p = 4) => finite(v) ? Number(Number(v).toFixed(p)) : null;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  function symbol(input) {
    const s = String(input || '').trim().toLowerCase();
    let m = s.match(/^(sh|sz|bj)(\d{6})$/);
    if (m) return m[1] + m[2];
    m = s.match(/^(\d{6})\.(sh|sz|bj)$/);
    if (m) return m[2] + m[1];
    if (!/^\d{6}$/.test(s)) fail('INVALID_SYMBOL', '股票代码须为6位数字或带sh/sz/bj前缀。');
    return (/^92/.test(s) ? 'bj' : /^[569]/.test(s) ? 'sh' : /^[48]/.test(s) ? 'bj' : 'sz') + s;
  }
  function config(input) {
    if (!input || typeof input !== 'object') fail('CONFIG_REQUIRED', '请先提供持仓、可用资金和风险配置。');
    const cash = number(input.cash);
    if (cash === null || cash < 0) fail('INVALID_CONFIG', 'cash须为非负的可用现金金额。');
    const bounds = { maxEquityWeight: [0, 1], maxStockWeight: [0.01, 1], maxIndustryWeight: [0.01, 1], riskPerStock: [0.001, 0.1] };
    const c = { cash, holdings: [], currency: 'CNY', advisoryOnly: true };
    for (const [k, [lo, hi]] of Object.entries(bounds)) {
      const v = number(input[k]);
      if (v === null || v < lo || v > hi) fail('INVALID_CONFIG', `${k}须显式填写为${lo}至${hi}之间的比例。`);
      c[k] = v;
    }
    if (c.maxStockWeight > c.maxIndustryWeight || c.maxIndustryWeight > c.maxEquityWeight)
      fail('INVALID_CONFIG', '单股上限≤行业上限≤总股票仓位上限。');
    c.horizonDays = Number(input.horizonDays);
    c.reviewMinutes = Number(input.reviewMinutes);
    if (!Number.isInteger(c.horizonDays) || c.horizonDays < 1 || c.horizonDays > 365)
      fail('INVALID_CONFIG', 'horizonDays须为1至365天。');
    if (!Number.isInteger(c.reviewMinutes) || c.reviewMinutes < 15 || c.reviewMinutes > 10080)
      fail('INVALID_CONFIG', 'reviewMinutes须为15至10080分钟。');
    c.trackingEnabled = input.trackingEnabled === true;
    c.allowAutoRevision = input.allowAutoRevision !== false;
    c.newsMaxAgeHours = clamp(Number(input.newsMaxAgeHours) || 48, 1, 168);
    c.quoteMaxAgeMinutes = clamp(Number(input.quoteMaxAgeMinutes) || 20, 1, 120);
    c.reportChannel = 'wechat-clawbot';
    c.dailyScanEnabled=input.dailyScanEnabled!==false;
    c.dailyScanTime=String(input.dailyScanTime||'15:15');
    if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(c.dailyScanTime))fail('INVALID_CONFIG','dailyScanTime须为HH:mm上海时间。');
    c.sendKlineImages=input.sendKlineImages!==false;
    c.partnerTarget = input.partnerTarget && input.partnerTarget.kind === 'bot'
      ? { kind: 'bot', id: String(input.partnerTarget.id) } : null;
    if(input.industryIds!==undefined&&!Array.isArray(input.industryIds))fail('INVALID_INDUSTRY_PREFERENCE','倾向行业必须是行业ID数组。');
    const industryIds=[...new Set((input.industryIds||[]).map(x=>String(x).trim()))];
    c.industrySelectionMode=input.industrySelectionMode||(industryIds.length?'manual':'hot120');
    if(!['hot120','manual'].includes(c.industrySelectionMode)||industryIds.some(x=>!/^BK\d+$/.test(x)))fail('INVALID_INDUSTRY_PREFERENCE','倾向行业须选择成交额前120或手动行业，代码来自行业目录。');
    if(c.industrySelectionMode==='manual'&&!industryIds.length)fail('INDUSTRY_SELECTION_REQUIRED','手动模式至少选择一个倾向行业，留空不会抓取全行业。');
    c.industryIds=c.industrySelectionMode==='manual'?industryIds:[];
    const seen = new Set();
    for (const h of input.holdings || []) {
      const code = symbol(h.symbol), quantity = number(h.quantity), cost = number(h.cost);
      if (seen.has(code) || quantity === null || quantity < 0 || !Number.isInteger(quantity) || cost === null || cost < 0)
        fail('INVALID_HOLDING', '持仓代码须唯一，数量须为非负整数，成本须非负。');
      seen.add(code); c.holdings.push({ symbol: code, quantity, cost, name: String(h.name || code) });
    }
    return c;
  }
  function industryCatalog(data) {
    if(!Array.isArray(data?.rows)||!data.rows.length)fail('NO_MARKET_DATA','行业目录为空，不能确定研究范围。');
    const seen=new Set();
    for(const s of data.rows)if(!/^BK\d+$/.test(s.id)||seen.has(s.id)){fail('INVALID_INDUSTRY_DIRECTORY','行业目录标识无效或重复，未建立排名。');}else seen.add(s.id);
    const missing=data.rows.filter(s=>!finite(s.amount)||Number(s.amount)<0).map(s=>s.id);
    const complete=data.complete===true&&Number(data.total)===data.rows.length&&missing.length===0&&data.rows.some(s=>Number(s.amount)>0);
    const rows=data.rows.map(s=>({...s,amount:number(s.amount)})).sort((a,b)=>((b.amount??-1)-(a.amount??-1))||(a.id<b.id?-1:a.id>b.id?1:0)).map((s,i)=>({...s,rank:complete?i+1:null}));
    return {rows,ranking:{metric:'amount',label:'成交额',limit:120,complete,missingAmountIds:missing,source:data.source||rows[0]?.source||'unknown',fetchedAt:data.fetchedAt||null,basis:'来源行业板块本次快照的成交额降序、同额按行业ID排序；热度不代表投资价值，各层级可能重叠。'},directoryTotal:Number(data.total),directoryComplete:data.complete===true};
  }
  function selectIndustries(data,config,override) {
    const catalog=industryCatalog(data),ids=override?.length?[...new Set(override)]:config.industryIds||[],mode=override?.length?'manual':config.industrySelectionMode||(ids.length?'manual':'hot120');
    if(!['hot120','manual'].includes(mode))fail('INVALID_INDUSTRY_PREFERENCE','研究范围模式无效。');
    if(mode==='hot120'&&!catalog.ranking.complete)fail('INDUSTRY_RANKING_INCOMPLETE','行业目录或成交额不完整，无法确认成交额前120；请重试数据源或手动选择，不降级全行业。');
    if(mode==='manual'&&(!ids.length||ids.some(id=>!/^BK\d+$/.test(id))))fail('INDUSTRY_SELECTION_REQUIRED','手动模式需非空有效行业ID，留空不扫描全目录。');
    const selected=mode==='manual'?catalog.rows.filter(x=>ids.includes(x.id)):catalog.rows.slice(0,120);
    if(!selected.length||(mode==='manual'&&selected.length!==ids.length))fail('INVALID_INDUSTRY','部分倾向行业不在当前目录，未静默省略或扩大范围。');
    return {selected,selection:{mode,metric:mode==='hot120'?'amount':null,limit:mode==='hot120'?120:null,selectedCount:selected.length,source:catalog.ranking.source,fetchedAt:catalog.ranking.fetchedAt,directoryTotal:catalog.directoryTotal,directoryComplete:catalog.directoryComplete,rankingComplete:catalog.ranking.complete,basis:mode==='hot120'?catalog.ranking.basis:'仅研究账户中手动选择的行业；不是全市场覆盖。'}};
  }
  const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  function ema(xs, n) {
    if (xs.length < n) return [];
    const out = Array(n - 1).fill(null); let last = mean(xs.slice(0, n)); out.push(last);
    for (let i = n; i < xs.length; i++) { last += 2 / (n + 1) * (xs[i] - last); out.push(last); }
    return out;
  }
  function indicators(raw) {
    const bars = raw.filter(b => ['open', 'high', 'low', 'close', 'volume'].every(k => finite(b[k])) && b.close > 0 && b.high >= b.low)
      .map(b => ({ ...b, close: Number(b.close), high: Number(b.high), low: Number(b.low), volume: Number(b.volume) }));
    if (bars.length < 35) return { ready: false, count: bars.length, reason: '至少需要35根有效日K。' };
    const xs = bars.map(b => b.close), last = xs.at(-1);
    const ma = n => xs.length >= n ? round(mean(xs.slice(-n))) : null;
    const e12 = ema(xs, 12), e26 = ema(xs, 26);
    const difs = xs.slice(25).map((_, i) => e12[i + 25] - e26[i + 25]);
    const dea = ema(difs, 9).at(-1), dif = difs.at(-1);
    let gain = 0, loss = 0;
    for (let i = 1; i <= 14; i++) { const d = xs[i] - xs[i - 1]; gain += Math.max(d, 0) / 14; loss += Math.max(-d, 0) / 14; }
    for (let i = 15; i < xs.length; i++) { const d = xs[i] - xs[i - 1]; gain = (gain * 13 + Math.max(d, 0)) / 14; loss = (loss * 13 + Math.max(-d, 0)) / 14; }
    const tr = bars.slice(1).map((b, i) => Math.max(b.high - b.low, Math.abs(b.high - bars[i].close), Math.abs(b.low - bars[i].close)));
    let atr = mean(tr.slice(0, 14)); for (const v of tr.slice(14)) atr = (atr * 13 + v) / 14;
    let k = 50, d = 50;
    for (let i = 8; i < bars.length; i++) { const w = bars.slice(i - 8, i + 1), lo = Math.min(...w.map(b => b.low)), hi = Math.max(...w.map(b => b.high)); const r = hi === lo ? 50 : (xs[i] - lo) / (hi - lo) * 100; k = 2 * k / 3 + r / 3; d = 2 * d / 3 + k / 3; }
    const mid = mean(xs.slice(-20)), std = Math.sqrt(mean(xs.slice(-20).map(v => (v - mid) ** 2)));
    return { ready: true, count: bars.length, asOf: bars.at(-1).date, close: last,
      ma5: ma(5), ma10: ma(10), ma20: ma(20), ma60: ma(60), ema12: round(e12.at(-1)), ema26: round(e26.at(-1)),
      macd: { dif: round(dif), dea: round(dea), histogram: round(2 * (dif - dea)) },
      rsi14: round(loss === 0 ? gain === 0 ? 50 : 100 : 100 - 100 / (1 + gain / loss)), atr14: round(atr),
      kdj: { k: round(k), d: round(d), j: round(3 * k - 2 * d) },
      boll20: { middle: round(mid), upper: round(mid + 2 * std), lower: round(mid - 2 * std) },
      return5: round((last / xs.at(-6) - 1) * 100), return20: round((last / xs.at(-21) - 1) * 100),
      volumeRatio5: round(bars.at(-1).volume / (mean(bars.slice(-6, -1).map(b => b.volume)) || 1)),
      method: '日K/前复权；RSI与ATR使用Wilder平滑；MACD(12,26,9)，柱=2*(DIF-DEA)；BOLL(20,2)，总体标准差；KDJ(9,3,3)' };
  }
  function stockScore(s) {
    const i = s.indicators;
    if (!i?.ready || !finite(s.quote?.price)) return null;
    let score = 50;
    score += i.close > i.ma20 ? 8 : -8;
    if (i.ma60 !== null) score += i.ma20 > i.ma60 ? 7 : -7;
    score += i.macd.histogram > 0 ? 7 : -7;
    score += i.rsi14 >= 40 && i.rsi14 <= 70 ? 5 : -5;
    score += clamp(i.return20, -15, 15);
    if (finite(s.quote.pe) && s.quote.pe <= 0) score -= 8;
    if (/ST|退/.test(s.name)) score -= 25;
    return round(clamp(score, 0, 100), 1);
  }
  function rankedStocks(stocks) {
    const ready = stocks.filter(s => stockScore(s) !== null).sort((a, b) => stockScore(b) - stockScore(a));
    return ready.map((s, i) => ({ ...s, technicalScore: stockScore(s), tier: TIERS[Math.min(2, Math.floor(i * 3 / ready.length))],
      gradeBasis: '同一行业内相对技术与报价筛选；AI投资价值结论另列，不是获利概率。' }));
  }
  function quoteValid(q, now, maxMinutes) {
    return q && finite(q.price) && q.price > 0 && finite(q.asOf) && now >= q.asOf - 60000 && now - q.asOf <= maxMinutes * 60000;
  }
  function referenceValid(q, now, maxMinutes) {
    if (quoteValid(q, now, maxMinutes)) return true;
    const d = new Date(now + 8 * 3600000), minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
    const open = d.getUTCDay() > 0 && d.getUTCDay() < 6 && minutes >= 570 && minutes <= 900;
    return !open && q && finite(q.price) && q.price > 0 && finite(q.asOf) && q.asOf <= now && now - q.asOf <= 7 * 86400000;
  }
  function equity(c, quotes) {
    let total = c.cash;
    for (const h of c.holdings) {
      if (!h.quantity) continue;
      const q = quotes[h.symbol];
      if (!q || !finite(q.price) || q.price <= 0) fail('HOLDING_PRICE_MISSING', `持仓${h.symbol}缺少报价，不能计算配仓。`);
      total += h.quantity * q.price;
    }
    if (total <= 0) fail('NO_CAPITAL', '可用现金与实际持仓市值合计须大于0。');
    return total;
  }
  function recommendationSafety(stock,quote){
    const normalized=v=>typeof v==='string'?v.normalize('NFKC').replace(/[\s*]/g,'').toUpperCase():'';
    const names=[stock?.name,quote?.name].map(normalized);
    if(names.some(n=>/^ST/.test(n)||/退/.test(n)))return {allowed:false,code:'RISK_NAME_BLOCKED',message:'名称出现ST或退市相关标识，不进入正权重建议；已有持仓可继续研究或给出退出建议。'};
    const q=names[1];
    if(!q||/^(?:(?:SH|SZ|BJ))?\d{6}$/.test(q))return {allowed:false,code:'IDENTITY_UNVERIFIED',message:'定稿报价缺少可确认的股票名称，不能生成正权重建议。'};
    return {allowed:true,code:'NAME_CHECK_ONLY',message:'仅通过名称风险检查；交易资格、停牌、涨跌停和可卖数量仍须核验。'};
  }
  function adviceConditions(a){
    const out={};
    for(const k of ['entryCondition','waitCondition','invalidationCondition']){
      if(typeof a[k]!=='string'||!a[k].trim()||a[k].length>1200)fail('ADVICE_CONDITIONS_REQUIRED','正权重建议须分别填写考虑条件、等待条件、失效条件（每项1至1200字符）。');
      out[k]=a[k].trim();
    }
    return out;
  }
  function riskEstimate(allocation){
    const positive=(allocation?.positions||[]).filter(p=>p.weight>0);
    const valid=positive.every(p=>finite(p.price)&&p.price>0&&finite(p.stop)&&p.stop>0&&p.stop<p.price&&finite(p.targetValue)&&p.targetValue>=0);
    const amount=valid?round(positive.reduce((sum,p)=>sum+p.targetValue*(p.price-p.stop)/p.price,0),2):null;
    return {available:valid&&finite(allocation?.equity)&&allocation.equity>0,stopDistanceLoss:amount,
      equityFraction:valid&&finite(allocation?.equity)&&allocation.equity>0?round(amount/allocation.equity,6):null,
      basis:'按建议目标仓位、定稿现价到止损参考价的距离估算；不是实际最大亏损，不含费用、跳空或滑点；不代表能以该价格卖出。'};
  }
  function allocate(c, candidates, decisions, quotes, now) {
    const total = equity(c, quotes);
    const output = [], industries = {}, seen = new Set(); let used = 0;
    if (!Array.isArray(decisions)) fail('BAD_AI_OUTPUT', '模型未给出配置建议数组。');
    for (const a of decisions) {
      const weight = number(a.weight), matches = candidates.filter(s=>s.symbol===a.symbol && (!a.sectorId || s.sectorId===a.sectorId));
      if(matches.length>1) fail('AMBIGUOUS_INDUSTRY','候选涉及多个行业，请明确配置建议的主行业sectorId。');
      const holding=c.holdings.find(h=>h.symbol===a.symbol && h.quantity>0);
      const s=matches[0] || (holding && weight===0 ? {...holding,sectorId:'unclassified'} : null);
      if (!s || seen.has(a.symbol) || weight === null || weight < 0 || weight > 1)
        fail('BAD_AI_OUTPUT', '配置建议含未知或重复股票、非法比例。');
      seen.add(a.symbol);
      const q = quotes[s.symbol];
      if (!referenceValid(q, now, c.quoteMaxAgeMinutes)) fail('STALE_QUOTE', `配置候选${s.symbol}报价过期；保留原计划。`);
      const safety=recommendationSafety(s,q);
      if(weight&&!/^(?:sh60[0135]\d{3}|sh688\d{3}|sz00[0123]\d{3}|sz30[01]\d{3}|bj(?:[48]\d{5}|92\d{4}))$/.test(s.symbol))fail('ASSET_SCOPE_BLOCKED','本工作台正仓位仅限普通A股代码，排除B股、基金、指数、CDR和债券。');
      if(weight&&!safety.allowed)fail(safety.code,`${s.symbol}：${safety.message}`);
      const conditions=weight?adviceConditions(a):{};
      const stop = number(a.stop), target = number(a.target);
      if (weight && (stop === null || stop <= 0 || stop >= q.price || target === null || target <= q.price))
        fail('BAD_AI_OUTPUT', '正权重候选须有低于当前未复权价格的止损参考及更高的目标。');
      let w = Math.min(weight, c.maxStockWeight, Math.max(0, c.maxEquityWeight - used), Math.max(0, c.maxIndustryWeight - (industries[s.sectorId] || 0)));
      if (w) w = Math.min(w, c.riskPerStock / ((q.price - stop) / q.price));
      const actual = c.holdings.find(h => h.symbol === s.symbol)?.quantity || 0;
      // A-share minimum order rules differ by board; keep targets in money/weight until an explicit instrument rule is provided.
      output.push({ symbol: s.symbol, name: s.name, sectorId: s.sectorId, weight: round(w, 6), targetValue: round(w * total, 2),
        estimatedShares: round(w * total / q.price, 2), actualQuantity: actual,
        actualValue: round(actual * q.price, 2), deltaValue: round(w * total - actual * q.price, 2),
        price: q.price, priceAsOf:q.asOf, priceSource:q.source||'未确认', stop, target, reason: String(a.reason || ''), clamped: Math.abs(w - weight) > 0.000001,
        ...conditions,safety,
        stopDistanceLoss:w?round(w*total*(q.price-stop)/q.price,2):0,
        actionableOrder: false, note: '金额/仓位建议；估算股数未按交易板块整手、费用、可卖数量或T+1校验。' });
      used += w; industries[s.sectorId] = (industries[s.sectorId] || 0) + w;
    }
    if(c.holdings.some(h=>h.quantity>0&&!seen.has(h.symbol)))fail('HOLDING_DECISION_REQUIRED','每只实际持仓都需要明确保留/调整/退出建议，不能默认把遗漏持仓视为现金。');
    const result={ equity: round(total, 2), equityWeight: round(used, 6), cashWeight: round(1 - used, 6), cashTarget: round((1 - used) * total, 2), positions: output,
      currentHoldings: c.holdings.map(h => ({ ...h, marketPrice: quotes[h.symbol]?.price ?? null, marketValue: round(h.quantity * quotes[h.symbol]?.price, 2), coveredByAdvice: seen.has(h.symbol) })),
      omittedHoldings: c.holdings.filter(h => h.quantity && !seen.has(h.symbol)).map(h => h.symbol), advisoryOnly: true };
    result.riskEstimate=riskEstimate(result);return result;
  }
  function validateIndustryDecision(d, sectors, newsIds) {
    const expected = new Set(sectors.map(s => s.id));
    if (!Array.isArray(d) || d.length !== expected.size) fail('BAD_AI_OUTPUT', '行业分类须完整覆盖本批已分析行业，不能漏项。');
    const used = new Set();
    for (const x of d) {
      if (!expected.has(x.id) || used.has(x.id) || !GROUPS.includes(x.group) || typeof x.reason !== 'string' || !x.reason.trim())
        fail('BAD_AI_OUTPUT', '行业分类包含未知、重复或缺理由的条目。');
      used.add(x.id);
      if (!Array.isArray(x.newsIds) || !x.newsIds.length || x.newsIds.some(id => !newsIds.has(id)))
        fail('BAD_AI_OUTPUT', '行业判断须引用本轮已有资讯编号；无直接相关新闻可明确说明宏观参考。');
    }
    return d;
  }
  function planEvents(plan, quotes, now, c) {
    if (!plan || plan.status !== 'active' || !c.trackingEnabled) return [];
    const events = [];
    for (const p of plan.allocation.positions) {
      if (!p.weight) continue;
      const q = quotes[p.symbol]; if (!quoteValid(q, now, c.quoteMaxAgeMinutes)) continue;
      const kind = q.price <= p.stop ? 'stop_reached' : q.price >= p.target ? 'target_reached' : null;
      if (kind) events.push({ id: `${plan.id}.${plan.revision}.${p.symbol}.${kind}`, type: 'plan.target_reached', occurredAt: now,
        subject: plan.id, data: { planId: plan.id, revision: plan.revision, symbol: p.symbol, kind, price: q.price, sourceTime: q.asOf } });
    }
    if (now >= plan.expiresAt || now >= plan.nextReviewAt) events.push({ id: `${plan.id}.${plan.revision}.review.${plan.nextReviewAt}`, type: 'plan.review_due', occurredAt: now,
      subject: plan.id, data: { planId: plan.id, revision: plan.revision, expired: now >= plan.expiresAt, nextReviewAt: plan.nextReviewAt } });
    return events;
  }
  function scheduleIntent(plan, c, now) {
    const desired = { name: `A股投研 · ${plan.id}`, cronExpr:'0 * * * *', intervalMs: plan.reviewMinutes * 60000, timezone: 'Asia/Shanghai', recurring: true, silentWhenIdle: false,
      bindToCurrentSession:true,notify:{desktop:true,feishu:false},expireAt:plan.expiresAt,
      prompt: `/ashare-research mode=${plan.mode||'live'} 定时复查计划 ${plan.id}。模拟模式只用模拟资料，不改写真实账户。先读取get_state核对该计划最新状态；已暂停、完成、过期时只对账并暂停本计划绑定的两条调度，不重建计划。仍有效才重新获取资讯、行业行情和K线，核对持仓事实；执行研究、建议、计划修订与两条调度对账；无变化也发送本轮微信报告及推荐股票K线图片。另调用plan_control(action:performance_list)；仅对已建立且关联本计划报告的效果账本用refresh更新完整估值与基准，缺数据保留缺项，不自动生成模型成交或新账本。只提供建议，不自动交易。` };
    return { id: `${plan.id}.schedule.${plan.revision}`, role:'review',mode:plan.mode||'live',planId: plan.id, planRevision: plan.revision,
      operation: plan.status === 'active' && c.trackingEnabled ? plan.scheduleId ? 'update' : 'create' : plan.scheduleId ? 'pause' : 'none',
      scheduleId: plan.scheduleId || null, desired, createdAt: now, status: 'pending',
      instructions: '由伙伴/当前Agent调用Cindy原生scheduler，先核对已绑定任务，获得真实回执后record_receipt；插件不冒充调度存储。' };
  }
  function calendarApi(){return typeof module==='object'&&module.exports?require('./calendar.js'):globalThis.AShareCalendar;}
  function scheduleIntents(plan,c,now){
    const dailyEnabled=plan.status==='active'&&c.trackingEnabled&&c.dailyScanEnabled!==false;
    const [hour,minute]=(c.dailyScanTime||'15:15').split(':');
    const daily={id:`${plan.id}.daily.${plan.revision}`,role:'daily_scan',mode:plan.mode||'live',planId:plan.id,planRevision:plan.revision,
      operation:dailyEnabled?plan.dailyScheduleId?'update':'create':plan.dailyScheduleId?'pause':'none',scheduleId:plan.dailyScheduleId||null,createdAt:now,status:'pending',
      desired:{name:`A股开盘日扫描 · ${plan.id}`,cronExpr:`${Number(minute)} ${Number(hour)} * * 1-5`,timezone:'Asia/Shanghai',recurring:true,silentWhenIdle:false,bindToCurrentSession:true,notify:{desktop:true,feishu:false},expireAt:plan.expiresAt,
        prompt:`/ashare-research mode=${plan.mode||'live'} 每个开盘日扫描计划 ${plan.id}。先核对最新计划状态和官方交易日历，休市跳过、未知年份停止并更新日历；暂停/结束/过期只暂停本计划两条调度。用plan_control(action:scan)分批获取推荐股票的K线、资讯与机械检查，结合计划依据逐股AI核验，用record_scan保存符合/需调整/证据不足结论；必要时重新研究并更新计划与两条调度。每轮调用plan_control(action:performance_list)，按实际已建立的关联效果账本refresh更新估值与基准；无建议/无成交不展示选股收益，不自动建账或模型成交。每轮向已绑定微信发送结果与推荐股票K线PNG；只建议不交易，模拟模式不能改写真实资料。`},
      preRunHookScript:calendarApi().preRunHookScript(),calendar:calendarApi().calendar,
      instructions:'独立于周期复查的第二条原生任务；创建/更新后通过schedule_set_pre_run_hook安装并自测此交易日脚本，休市跳过不启动模型；读取真实调度ID后记回执。'};
    return [scheduleIntent(plan,c,now),daily];
  }
  function conformity(position,detail,c,at=Date.now()){
    const q=detail.quote,i=detail.indicators,bar=detail.bars?.at(-1),calendar=calendarApi().check(at),expected=calendarApi().expectedDailyBar(at),flags=[];
    if(!referenceValid(q,at,c.quoteMaxAgeMinutes)||q?.asOf&&expected&&calendarApi().dateCN(q.asOf)<expected)flags.push({code:'QUOTE_MISSING_OR_STALE',message:'报价缺失或日期过旧。'});
    if(!bar||expected&&bar.date<expected)flags.push({code:'KLINE_MISSING_OR_STALE',message:'K线未覆盖应有交易日。'});
    if(!i?.ready)flags.push({code:'INDICATORS_MISSING',message:'技术指标不足。'});
    const freshNews=(detail.news||[]).filter(n=>finite(n.publishedMs)&&n.publishedMs<=at+60000&&at-n.publishedMs<=c.newsMaxAgeHours*3600000);
    if(!freshNews.length)flags.push({code:'NEWS_MISSING',message:'本轮没有有效时限内的资讯。'});
    if(finite(q?.price)&&q.price<=position.stop)flags.push({code:'STOP_REACHED',message:'现价达到或低于未复权止损参考，需要复核计划。'});
    if(finite(q?.price)&&q.price>=position.target)flags.push({code:'TARGET_REACHED',message:'现价达到或高于未复权目标参考，需要复核计划。'});
    const information=detail.information?globalThis.AShareInformation?.coverage({news:detail.news,dossier:detail.information,sourceSnapshots:detail.sourceSnapshots||{},symbol:position.symbol,sectorId:position.sectorId,quote:q,at}):null;
    if(detail.information&&information?.status!=='supported')flags.push({code:'INFORMATION_REVIEW_MISSING',message:'本轮政策/公告/财报/估值/风险正文互核不足：'+(information?.issues||['核验模块不可用']).join('；')});
    const missing=flags.some(f=>/MISSING|STALE/.test(f.code));
    return {symbol:position.symbol,information,status:missing?'insufficient_data':flags.length?'review_required':'within_reference_range',flags,expectedDailyBar:expected,lastBar:bar?.date||null,
      trend:i?.ready&&finite(q?.price)?q.price>=i.ma20?'above_ma20':'below_ma20':'not_available',freshNewsIds:freshNews.map(n=>n.id),
      caution:'机械检查不替代AI对资讯、原计划理由和投资价值的判断。'};
  }
  function reportMarkdown(report, plan) {
    const lines = [`# ${report.mode==='simulation'?'【模拟测试】':''}A股投研 ${report.id}`, `分析时间：${new Date(report.finishedAt).toISOString()} · ${report.trigger}`, '', '**仅投资建议，无自动交易。**', ...(report.mode==='simulation'?['**本报告使用模拟资金、合成行情和模拟资讯，不是真实账户或荐股结论。**']:[]), '', report.summary || '', '', '## 行业与股票'];
    if(report.scanFindings){lines.push('', '## 推荐股票与计划符合校验');for(const f of report.scanFindings)lines.push(`- ${f.symbol}：${{consistent:'符合原计划',adjust:'需要调整或复查',insufficient:'证据不足'}[f.verdict]}；${f.reason}；证据${(f.newsIds||[]).join('、')}。`);}
    const value=v=>finite(v)?round(v,4):'缺失';
    for(const o of report.scanObservations||[])lines.push(`- 本轮扫描 ${o.symbol}：现价${value(o.quote?.price)}；报价时间${o.quote?.asOf?new Date(o.quote.asOf).toISOString():'未确认'}；来源${o.quote?.source||o.source||'未确认'}；日K末根${o.lastBar||'缺失'}；MA20=${value(o.indicators?.ma20)}，RSI14=${value(o.indicators?.rsi14)}；原计划止损${o.stop}、目标${o.target}；机械状态${o.mechanical.status}。`);
    if(report.coverage)lines.push(`研究范围：选择${report.coverage.selectedIndustryCount}个行业；来源目录共${report.coverage.marketIndustryCount}项；目录${report.coverage.completeDirectory?'完整':'不完整，不代表全市场'}。`);
    if(report.coverage?.selection){const s=report.coverage.selection;lines.push(`账户倾向行业：${s.mode==='hot120'?'成交额前120':'手动选择'}；实际${s.selectedCount}个；来源${s.source}；快照读取${s.fetchedAt?new Date(s.fetchedAt).toISOString():'未确认'}。${s.basis}`);}
    for (const group of GROUPS) {
      lines.push('', `### ${group}`);
      for (const s of report.industries.filter(s => s.group === group)) {
        lines.push(`- ${s.name}：${s.reason}`);
        lines.push(`  - 行业行情：涨跌${value(s.changePct)}%；资金流${value(s.flow)}元；来源${s.source||'未确认'}；抓取时间${s.fetchedAt?new Date(s.fetchedAt).toISOString():'未确认'}；证据${(s.newsIds||[]).join('、')}。`);
        for (const tier of TIERS) {
          const stocks = s.stocks.filter(x => x.valueTier === tier);
          lines.push(`  - ${tier}：${stocks.map(x => `${x.name}(${x.symbol}) ${x.valueReason || ''}`).join('；') || '无充分依据的候选'}`);
          for(const x of stocks){
            const q=x.quote||{},i=x.indicators||{};
            lines.push(`    - ${x.symbol}：未复权报价${value(q.price)}；报价时间${q.asOf?new Date(q.asOf).toISOString():'未确认'}（${q.source||'未确认'}）；PE${value(q.pe)}，PB${value(q.pb)}；K线${x.klineSource||'未确认'}/${x.adjustment||'未确认'}，末根${x.klineAsOf||'未确认'}；MA5/20/60=${value(i.ma5)}/${value(i.ma20)}/${value(i.ma60)}，RSI14=${value(i.rsi14)}，MACD柱=${value(i.macd?.histogram)}，ATR14=${value(i.atr14)}；证据${(x.newsIds||[]).join('、')}。`);
          }
        }
        if (s.ungraded) lines.push(`  - 未充分评估：${s.ungraded}只；${s.coverage || ''}`);
      }
    }
    const insufficient=report.industries.filter(s=>s.assessment==='insufficient');if(insufficient.length){lines.push('', '### 证据不足，未分组（不等于不推荐）');for(const s of insufficient)lines.push(`- ${s.name}：${s.reason}；缺项：${(s.missingReasons||[]).join('；')}；未分档${s.ungraded}只；${s.coverage||''}`);}
    if(report.contextReview)lines.push('', '## 最终跨行业复核', `行业分析快照：${new Date(report.contextReview.analysisAsOf).toISOString()}（非实时）；最新市场上下文：${new Date(report.contextReview.marketAsOf).toISOString()}；复核${report.contextReview.reviewedSectorIds.length}个行业。`,report.contextReview.reason,'流程完成不代表所有股票均已分档；证据不足保留缺口，未自动判为不推荐。');
    lines.push('', '## 配仓/调仓建议', report.allocation
      ? `账户市值与现金合计参考：${report.allocation.equity}元；建议现金比例：${round(report.allocation.cashWeight * 100, 2)}%`
      : '本轮未生成配仓/调仓建议；账户权益与现金比例未计算。');
    if(report.allocation){const r=riskEstimate(report.allocation);lines.push(r.available?`建议仓位的止损距离估算损失合计：${r.stopDistanceLoss}元，占参考权益${round(r.equityFraction*100,2)}%。`:'建议仓位风险金额缺少计算依据。',r.basis,'正权重是待核验的研究建议，不是下单指令；空仓或等待也是合法结果。');}
    for (const p of report.allocation?.positions || []) lines.push(`- ${p.name} ${p.symbol}：建议${round(p.weight * 100, 2)}%，金额${p.targetValue}元，较实际持仓差额${p.deltaValue}元；止损参考${p.stop}，目标参考${p.target}。${p.reason}${p.clamped ? '（已按风险上限收缩）' : ''} 定稿报价${p.price}，时间${p.priceAsOf?new Date(p.priceAsOf).toISOString():'未确认'}（${p.priceSource||'未确认'}）。`);
    for(const p of report.allocation?.positions||[])if(p.weight>0){const risk=riskEstimate({...report.allocation,positions:[p]});lines.push(`- ${p.symbol} 考虑条件：${p.entryCondition||'此历史建议未记录，补齐前先等待核验。'}`,`  - 等待条件：${p.waitCondition||'此历史建议未记录；不要只看仓位数字行动。'}`,`  - 失效条件：${p.invalidationCondition||'此历史建议未记录；需重新研究。'}`,`  - 本股止损距离估算损失：${risk.available?risk.stopDistanceLoss+'元':'依据不足，未计算'}。`, `  - 风险检查：${p.safety?.message||'历史建议未执行本版名称保护，需重新核验。'}`);}
    if (report.allocation?.omittedHoldings.length) lines.push(`- 未纳入配置方案的实际持仓：${report.allocation.omittedHoldings.join('、')}；保留事实，不推断已卖出。`);
    lines.push('', '## 计划与复查', plan ? `计划${plan.id} · 版本${plan.revision} · ${plan.status}；${report.planChanged ? '本轮已修订建议计划' : '本轮维持原建议计划'}；下次复查${new Date(plan.nextReviewAt).toISOString()}` : '数据或配置不足，未改写投资计划。',
      `原生调度：${plan ? plan.scheduleId || '待创建/对账' : '本轮未创建正式投资调度'}。调度与IM是否成功以独立回执为准。`, '', '## 数据状态', ...(report.warnings || []).map(w => '- ' + w), '', '## 资讯来源');
    for(const x of report.information||[]){lines.push('',`### ${x.symbol} 资讯核验：${x.status}`, ...Object.values(x.checks).map(c=>`- ${c.label}：${c.status}；证据${c.evidenceIds.join('、')||'缺失'}`),...x.issues.map(m=>'- '+m),x.scope);}
    for (const n of report.news || []) {lines.push(`- ${n.id}：[${n.source} · ${n.publishedAt || '时间未确认'}](${n.url || 'https://finance.sina.com.cn/'}) ${n.title}${n.category?'；类别'+n.category+'；正文状态'+(n.contentLevel||'metadata')+'；互核'+(globalThis.AShareInformation?.status(n,report.finishedAt)||'未核验'):''}`);
      if(n.summary)lines.push(`  - 原文摘要：${n.summary}；证据指纹${n.fingerprint||'未记录'}；原文响应SHA256 ${n.sourceSnapshot?.sha256||'未采集'}（${n.sourceSnapshot?.hashBasis||'未标注口径'}）；期末${n.reportPeriod||'不适用'}。`);
      for(const r of n.reviews||[])lines.push(`  - 核验者${r.reviewerId}：${r.verdict}；${new Date(r.checkedAt).toISOString()}；来源${r.sourceUrl}；核验说明${r.notes}。`);
    }
    return lines.join('\n');
  }
  function imSummary(report,plan){
    const lines=[`${report.mode==='simulation'?'【模拟测试】':''}A股投研｜${report.id}`,`时间：${new Date(report.finishedAt).toISOString()}；状态：${report.status}`,'仅提供建议，不自动交易。',...(report.mode==='simulation'?['模拟资金、合成行情与资讯，不是真实账户或荐股。']:[]),report.summary||''];
    if(report.information?.length)lines.push(`资讯核验：${report.information.filter(x=>x.status==='supported').length}/${report.information.length}只通过本轮五类证据互核；有限范围核验，不代表无风险。`);
    if(report.coverage?.selection)lines.push(`研究范围：${report.coverage.selection.mode==='hot120'?'成交额前120':'手动倾向行业'}，实际${report.coverage.selectedIndustryCount}个；来源目录${report.coverage.marketIndustryCount}项，所选范围不代表全市场。`);
    if(report.allocation){const r=riskEstimate(report.allocation);lines.push(r.available?`建议仓位跌至止损参考价的估算损失合计${r.stopDistanceLoss}元（权益${round(r.equityFraction*100,2)}%）。`:'风险金额依据不足，先等待核验。',r.basis);}
    for(const f of report.scanFindings||[])lines.push(`${f.symbol}：${{consistent:'符合原计划',adjust:'需复查调整',insufficient:'证据不足'}[f.verdict]}；${f.reason}`);
    for(const o of report.scanObservations||[])lines.push(`${o.symbol}：本轮现价${o.quote?.price??'缺失'}（${o.quote?.source||o.source||'来源未确认'}）；原目标${o.target}、止损${o.stop}；日K末根${o.lastBar||'缺失'}。`);
    if(!report.industries.length)lines.push('行业优先级与股票价值分档：本轮未完成评估。');
    else for(const group of GROUPS){const rows=report.industries.filter(x=>x.group===group);lines.push(`${group}（${rows.length}）：${rows.map(x=>x.name).slice(0,15).join('、')||'无'}${rows.length>15?'等，详见完整报告':''}`);}
    if(report.industries.some(x=>x.assessment==='insufficient'))lines.push(`证据不足、未分组：${report.industries.filter(x=>x.assessment==='insufficient').length}个行业，详见附件；不计入不推荐行业。`);
    for(const s of report.industries.filter(s=>GROUPS.includes(s.group)&&s.group!=='不推荐行业').slice(0,6)){
      lines.push(`${s.name}：`+TIERS.map(t=>`${t} ${s.stocks.filter(x=>x.valueTier===t).map(x=>x.name).slice(0,4).join('/')||'无充分依据候选'}`).join('；'));
    }
    for(const p of report.allocation?.positions||[])lines.push(`${p.name}：建议${round(p.weight*100,2)}%，参考金额${p.targetValue}元；止损${p.stop}，目标${p.target}。`);
    for(const p of (report.allocation?.positions||[]).filter(p=>p.weight>0).slice(0,3))lines.push(`${p.symbol} 考虑：${p.entryCondition||'历史条件未记录，先等待核验'}；等待：${p.waitCondition||'历史条件未记录'}；失效：${p.invalidationCondition||'历史条件未记录'}。`);
    lines.push(plan?`计划${plan.id} v${plan.revision}：${report.planChanged?'已修订建议':'维持原建议'}；下次复查${new Date(plan.nextReviewAt).toISOString()}。`:'未修改投资计划。',
      `数据提示：${(report.warnings||[]).slice(0,5).join('；')||'详见数据来源与时间。'}`,'本轮完整状态、证据与已有分析见报告附件。');
    return lines.join('\n').slice(0,12000);
  }
  return { GROUPS, TIERS, DomainError, fail, finite, number, round, clamp, symbol, config, industryCatalog, selectIndustries, indicators, stockScore, rankedStocks, quoteValid, referenceValid, equity, allocate, recommendationSafety, riskEstimate,
    validateIndustryDecision, planEvents, scheduleIntent, scheduleIntents, conformity, reportMarkdown, imSummary };
});
