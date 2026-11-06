'use strict';
globalThis.AShareConfigEditor={mount(container,{request,onSaved=async()=>{},onNext=null}){
  container.innerHTML=`<form id="config-form" novalidate><div class="config-steps" aria-label="账户填写步骤"><button type="button" class="config-step" data-step="0" aria-current="step"><span>STEP 01</span>资金与持仓</button><button type="button" class="config-step" data-step="1"><span>STEP 02</span>风险范围</button><button type="button" class="config-step" data-step="2"><span>STEP 03</span>跟踪偏好</button></div><p id="config-progress" class="config-progress">第1步，共3步</p>
    <div id="config-message" class="notice" role="status" aria-live="polite">正在读取配置…</div>
    <fieldset id="config-fields" disabled>
    <article class="form-step" data-form-step="0"><h2>资金与持仓</h2><p class="muted">金额单位：人民币。</p>
    <label>可用资金（元）<input name="cash" type="number" min="0" step="0.01" inputmode="decimal" required><small>不含已持有股票的市值。</small></label>
    <label>当前持仓<select name="holdingMode" required><option value="">请选择</option><option value="empty">目前无持仓（空仓）</option><option value="positions">填写已有持仓</option></select></label>
    <div id="holding-editor" hidden><p class="muted">按实际股数和成本填写。</p><div id="holding-rows"></div><button type="button" id="add-holding">＋ 添加一只持仓</button></div></article>
    <article class="form-step" data-form-step="1" hidden><h2>仓位与风险</h2><p class="muted">比例填百分数，例如20表示20%。</p><div class="form-grid">
    <label>股票总仓位上限（%）<input name="maxEquityWeight" type="number" min="0" max="100" step="0.01" inputmode="decimal" required><small>股票合计占总资产的上限。</small></label>
    <label>单只股票上限（%）<input name="maxStockWeight" type="number" min="1" max="100" step="0.01" inputmode="decimal" required><small>单只股票占总资产的上限。</small></label>
    <label>单一行业上限（%）<input name="maxIndustryWeight" type="number" min="1" max="100" step="0.01" inputmode="decimal" required><small>同一行业合计占总资产的上限。</small></label>
    <label>单股止损风险预算（%）<input name="riskPerStock" type="number" min="0.1" max="10" step="0.01" inputmode="decimal" required><small>按买入价和止损价估算，占总资产的比例。跳空或停牌时，实际损失可能更高。</small></label>
    <label>计划有效期（天）<input name="horizonDays" type="number" min="1" max="365" step="1" inputmode="numeric" required></label>
    <label>最大复查间隔（分钟）<input name="reviewMinutes" type="number" min="15" max="10080" step="1" inputmode="numeric" required></label></div>
    <p class="muted">单股上限 ≤ 行业上限 ≤ 总仓位上限。风险预算不保证实际亏损上限。</p></article>
    <article class="form-step" data-form-step="2" hidden><h2>研究与提醒</h2>
    <section class="industry-preferences" aria-labelledby="industry-preferences-title"><h3 id="industry-preferences-title">倾向行业</h3><p class="muted">先明确研究范围，再采集这些行业的成分股。成交额排名只反映交易活跃度，不代表投资价值。</p>
    <div class="industry-range-controls"><label>行业范围<select name="industrySelectionMode"><option value="hot120">成交额前120个行业（默认）</option><option value="manual">手动选择行业</option></select></label><button id="industry-ranking-refresh" type="button" aria-describedby="industry-scope-summary">重新获取排名</button></div>
    <input name="industryIds" type="hidden" value="">
    <p id="industry-scope-summary" class="industry-scope-summary" role="status"></p>
    <div id="industry-selected" class="industry-selected" aria-label="已选择的倾向行业" hidden></div>
    <div id="industry-manual-search" hidden><label>搜索行业名称或代码<input name="industrySearch" type="search" placeholder="如：半导体 或 BK1036" maxlength="80" autocomplete="off"></label></div>
    <p id="industry-catalog-meta" class="muted"></p><p id="industry-catalog-status" class="muted" role="status" aria-live="polite">行业目录将在本页读取。</p>
    <div id="industry-catalog-list" class="industry-catalog-list" aria-label="行业目录"></div>
    <div class="industry-catalog-actions"><button id="industry-catalog-retry" type="button">读取行业目录</button><button id="industry-catalog-more" type="button" hidden>显示更多行业</button></div></section>
    <label>研究伙伴<select name="partnerTarget"><option value="">未选择（保存后可在对话调用 /ashare-research）</option></select></label><p id="partner-status" class="muted"></p><button id="partners-retry" type="button" hidden>重新读取伙伴</button>
    <div class="checks"><label><input name="trackingEnabled" type="checkbox">监测点位并定期复查</label><label><input name="dailyScanEnabled" type="checkbox">开盘日扫描提醒</label><label><input name="allowAutoRevision" type="checkbox">允许按以上范围调整建议</label><label><input name="sendKlineImages" type="checkbox">报告附K线图片</label></div>
    <details><summary>更多选项：扫描时间与资讯时效</summary><div class="form-grid">
    <label>开盘日扫描时间（上海时间）<input name="dailyScanTime" type="time" value="15:15" required></label>
    <label>资讯有效时限（小时）<input name="newsMaxAgeHours" type="number" min="1" max="168" step="1" value="48" required></label>
    <label>报价有效时限（分钟）<input name="quoteMaxAgeMinutes" type="number" min="1" max="120" step="1" value="20" required></label>
    </div></details>
    <p class="muted">保存后不会开始研究或发送微信。已有定时任务需到计划页单独暂停。监测开关会应用到已有计划。</p>
    <details><summary>微信报告如何送达</summary><p>报告使用 Cindy 已连接的微信 ClawBot。联系人由宿主确认；此处不填写微信账号、令牌或接收人。</p><p class="muted">在 Cindy 的 IM机器人设置连接个人微信，并先给机器人发一条消息。勾选附图不代表已连接或发送成功，需查看真实回执。</p></details></article>
    </fieldset><div class="form-actions"><button type="button" id="config-back" hidden>上一步</button><button type="button" id="config-next" class="primary" disabled>下一步</button><button type="submit" id="save-config" class="primary" disabled hidden>保存配置</button><button type="button" id="reload-config" disabled>重新读取</button><button type="button" id="discard-config" hidden>放弃修改</button><button type="button" id="reconcile-config" hidden>核对保存结果</button></div>
  <div id="config-saved-next" class="config-saved-next" hidden><strong>资料已保存</strong><p>可以返回总览开始研究。</p><button id="config-research-next" type="button">开始研究 →</button><code id="config-next-command" hidden>/ashare-research 使用已保存的资料开展研究，仅提供建议，不自动交易。</code></div></form>`;
  const form=container.querySelector('form'),q=s=>form.querySelector(s),f=form.elements;
  const percents=['maxEquityWeight','maxStockWeight','maxIndustryWeight','riskPerStock'];
  let base=null,dirty=false,saving=false,loading=true,uncertain=null,partnerList=null,step=0,confirmed=false;
  let industrySelected=new Set(),industryRows=[],industryNames=new Map(),industryNextOffset=null,industryLoading=false,industryGeneration=0,industryLoaded=false,industrySearchTimer=null,industryCatalogToken=null;
  const industryManual=()=>f.industrySelectionMode.value==='manual';
  const say=(message,error=false)=>{q('#config-message').textContent=(error?'填写提示：':'')+message;q('#config-message').className='notice'+(error?' error':'');};
  function controls(){q('#config-next').disabled=loading||!base||saving||!!uncertain;q('#config-back').disabled=saving||!!uncertain;for(const b of form.querySelectorAll('[data-step]'))b.disabled=saving||!!uncertain;q('#config-fields').disabled=loading||!base||saving||!!uncertain;q('#save-config').disabled=loading||!base||saving||!!uncertain||confirmed;q('#save-config').setAttribute('aria-busy',String(saving));q('#save-config').toggleAttribute('data-confirmed',confirmed);if(confirmed)q('#save-config').dataset.confirmed='true';q('#save-config').textContent=saving?'保存中…':confirmed?'已保存':'保存配置';q('#reload-config').disabled=loading||!base||saving||!!uncertain;q('#discard-config').hidden=!dirty||saving||!!uncertain;q('#reconcile-config').hidden=!uncertain;q('#industry-catalog-retry').disabled=loading||!base||saving||!!uncertain||industryLoading;q('#industry-catalog-more').disabled=loading||!base||saving||!!uncertain||industryLoading;q('#industry-ranking-refresh').disabled=loading||!base||saving||!!uncertain||industryLoading;q('#industry-ranking-refresh').setAttribute('aria-busy',String(industryLoading));q('#industry-ranking-refresh').textContent=industryLoading?'正在获取…':'重新获取排名';syncSwitchStates();}
  function mark(){confirmed=false;q('#config-saved-next').hidden=true;dirty=true;controls();say('有未保存的修改。关闭页面前请保存。');}
  function showStep(index){step=index;for(const item of form.querySelectorAll('[data-form-step]'))item.hidden=Number(item.dataset.formStep)!==step;for(const b of form.querySelectorAll('[data-step]')){if(Number(b.dataset.step)===step)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');}q('#config-back').hidden=step===0;q('#config-next').hidden=step===2;q('#save-config').hidden=step!==2;q('#config-progress').textContent=['第1步，共3步','第2步，共3步','第3步，共3步'][step];if(step===2&&base&&!industryLoaded&&!industryLoading)loadIndustries();}
  function decorate(scope){for(const input of scope.querySelectorAll('input,select')){if(input.type==='checkbox'||input.dataset.decorated)return;input.dataset.decorated='true';input.id=input.id||'cfg-'+(input.name||crypto.randomUUID());const hint=input.closest('label')?.querySelector('small');if(hint){hint.id=input.id+'-hint';input.setAttribute('aria-describedby',hint.id);}const unit=percents.includes(input.name)?'%':input.name==='cash'||input.dataset.field==='cost'?'元':input.dataset.field==='quantity'?'股':input.name==='horizonDays'?'天':input.name==='reviewMinutes'?'分钟':null;if(unit){const wrap=document.createElement('span');wrap.className='field-unit';input.before(wrap);wrap.append(input);const suffix=document.createElement('span');suffix.textContent=unit;suffix.setAttribute('aria-hidden','true');wrap.append(suffix);}}}
  function clearError(input){input.removeAttribute('aria-invalid');form.querySelector('[id="'+input.id+'-error"]')?.remove();const hint=form.querySelector('[id="'+input.id+'-hint"]');if(hint)input.setAttribute('aria-describedby',hint.id);else input.removeAttribute('aria-describedby');}
  function clearErrors(){for(const input of form.querySelectorAll('[aria-invalid=true]'))clearError(input);}
  function fieldError(input,text){const part=input.closest('[data-form-step]');if(part)showStep(Number(part.dataset.formStep));for(let p=input.parentElement;p&&p!==form;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;clearError(input);input.setAttribute('aria-invalid','true');const msg=document.createElement('span');msg.className='field-error';msg.id=input.id+'-error';msg.textContent=text;input.closest('label').append(msg);const old=input.getAttribute('aria-describedby');input.setAttribute('aria-describedby',[old,msg.id].filter(Boolean).join(' '));input.focus();}
  function invalidMessage(input){if(input.validity.valueMissing)return input.tagName==='SELECT'?'请选择此项。':'请填写此项。';if(input.validity.rangeUnderflow)return '请填写不小于 '+input.min+' 的数值。';if(input.validity.rangeOverflow)return '请填写不大于 '+input.max+' 的数值。';if(input.validity.stepMismatch)return '请按允许的小数位或整数填写。';return '请检查此项填写内容。';}
  function businessError(input,message){fieldError(input,message);throw new Error(message);}
  function validStep(){clearErrors();const section=form.querySelector('[data-form-step="'+step+'"]');const invalid=Array.from(section.querySelectorAll('input,select')).find(x=>!x.disabled&&!x.checkValidity());if(invalid){fieldError(invalid,invalidMessage(invalid));say('请修改标出的填写项。',true);return false;}if(step===0&&f.holdingMode.value==='positions'&&!q('#holding-rows').children.length){fieldError(f.holdingMode,'请添加至少一只持仓，或选择空仓。');say('请先补充实际持仓。',true);return false;}if(step===1){try{values({checkIndustry:false});}catch(e){say(e.message,true);return false;}}return true;}
  function syncSwitchStates(){for(const input of form.querySelectorAll('.checks input[type=checkbox]')){const disabled=input.matches(':disabled'),status=input.closest('label').querySelector('.switch-state');if(status)status.textContent=disabled?'不可用':input.checked?'已开启':'已关闭';}}
  decorate(form);for(const input of form.querySelectorAll('input[type=checkbox]')){input.setAttribute('role','switch');const label=input.closest('label'),caption=document.createElement('span'),status=document.createElement('span');caption.className='switch-caption';caption.textContent=Array.from(label.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim();for(const n of Array.from(label.childNodes))if(n.nodeType===3)n.remove();input.before(caption);status.className='switch-state';status.setAttribute('aria-hidden','true');input.after(status);}syncSwitchStates();
  q('#config-next').onclick=()=>{if(validStep())showStep(step+1);};q('#config-back').onclick=()=>showStep(step-1);
  for(const b of form.querySelectorAll('[data-step]'))b.onclick=()=>{const index=Number(b.dataset.step);if(index<=step||validStep())showStep(index);};
  q('#config-research-next').onclick=()=>{if(onNext)onNext();else q('#config-next-command').hidden=false;};
  function formatIndustryAmount(value){if(!Number.isFinite(value)||value<0)return '成交额未返回';return value>=100000000?'成交额 '+(value/100000000).toFixed(2)+'亿元':value>=10000?'成交额 '+(value/10000).toFixed(2)+'万元':'成交额 '+value.toFixed(2)+'元';}
  function industryTime(value){return Number.isFinite(value)?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'时间未返回';}
  function syncIndustrySelection(){
    q('#industry-ranking-refresh').hidden=industryManual();q('#industry-catalog-retry').hidden=!industryManual();
    f.industryIds.value=[...industrySelected].join(',');q('#industry-manual-search').hidden=!industryManual();q('#industry-selected').hidden=!industryManual();
    q('#industry-scope-summary').textContent=industryManual()?'已选 '+industrySelected.size+' 个行业；仅研究已选范围。':'每轮按完整成交额快照选取前120个行业；不足120个时按实际可用目录展示。';
    const selected=q('#industry-selected');selected.replaceChildren();
    for(const id of industrySelected){const button=document.createElement('button');button.type='button';button.className='industry-selected-chip';button.textContent=(industryNames.get(id)||id)+' ×';button.setAttribute('aria-label','移除 '+(industryNames.get(id)||id)+' '+id);button.onclick=()=>{industrySelected.delete(id);syncIndustrySelection();renderIndustryRows();clearError(f.industrySelectionMode);mark();};selected.append(button);}
    if(industryManual()&&!industrySelected.size){const empty=document.createElement('span');empty.className='muted';empty.textContent='尚未选择。请在下方目录勾选至少一个行业。';selected.append(empty);}
  }
  function renderIndustryRows(){
    const list=q('#industry-catalog-list');list.replaceChildren();
    for(const row of industryRows){
      const item=document.createElement(industryManual()?'label':'div');item.className='industry-catalog-option';
      if(industryManual()){const input=document.createElement('input');input.type='checkbox';input.checked=industrySelected.has(row.id);input.dataset.industryId=row.id;input.setAttribute('aria-label','选择 '+row.name+' '+row.id);input.onchange=()=>{if(input.checked)industrySelected.add(row.id);else industrySelected.delete(row.id);syncIndustrySelection();clearError(f.industrySelectionMode);mark();};item.append(input);}
      else{const rank=document.createElement('span');rank.className='industry-catalog-rank';rank.textContent='#'+row.rank;item.append(rank);}
      const text=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small');name.textContent=row.name;detail.textContent=row.id+' · '+formatIndustryAmount(row.amount)+(industryManual()&&Number.isFinite(row.rank)?' · 第'+row.rank+'名':'');text.append(name,detail);item.append(text);list.append(item);
    }
    q('#industry-catalog-more').hidden=industryNextOffset===null;
  }
  async function loadIndustries({append=false,refresh=false}={}){
    if(!base||(refresh&&industryLoading))return;const offset=append?industryNextOffset:0;if(offset===null)return;
    const generation=++industryGeneration,mode=base.mode,manual=industryManual(),search=manual?f.industrySearch.value.trim():'';
    industryLoading=true;industryLoaded=true;if(!append&&!refresh){industryRows=[];industryNextOffset=null;renderIndustryRows();}controls();q('#industry-catalog-status').textContent=refresh&&!manual?'正在重新获取成交额前120排名…':append?'正在读取更多行业…':'正在读取行业名称、成交额与排名…';
    try{
      const r=await request('list_industries',{offset,limit:30,...(append&&industryCatalogToken?{catalogToken:industryCatalogToken}:{}),...(refresh?{refresh:true}:{}),...(search?{search}:{})},mode);
      if(generation!==industryGeneration||base.mode!==mode||industryManual()!==manual)return;
      if(!Array.isArray(r.industries))throw new Error('目录响应不完整。');industryCatalogToken=r.catalogToken||null;
      const rows=r.industries.filter(x=>x&&/^BK\d+$/.test(x.id)&&typeof x.name==='string'&&(manual||Number.isFinite(x.rank)&&x.rank<=120));
      industryRows=[...new Map([...(append?industryRows:[]),...rows].map(x=>[x.id,x])).values()];for(const row of rows)industryNames.set(row.id,row.name);
      industryNextOffset=Number.isSafeInteger(r.nextOffset)&&r.nextOffset>offset&&(manual||r.nextOffset<120)?r.nextOffset:null;
      const source=r.source==='eastmoney'||r.source==='eastmoney-industry'?'东方财富行业板块':r.source||'来源未返回',fetchedAt=r.fetchedAt||rows[0]?.fetchedAt,quoteAt=rows.map(x=>x.asOf).filter(Number.isFinite).sort((a,b)=>b-a)[0];
      q('#industry-catalog-meta').textContent='来源：'+source+'；口径：成交额降序；快照读取：'+industryTime(fetchedAt)+(quoteAt?'；行情：'+industryTime(quoteAt):'')+'（上海时间）';
      q('#industry-catalog-status').textContent=industryRows.length?(manual?'当前结果 '+industryRows.length+' / '+r.total+' 个行业。':'已展示成交额前 '+industryRows.length+' 名；默认研究范围为前120名。')+(r.ranking?.complete===false?' 排名数据不完整，请刷新核对；不会降级为全行业。':''):manual?'未找到匹配行业。已选行业仍保留。':'没有可展示的成交额排名，请重新读取。';
      q('#industry-catalog-retry').textContent='重新读取目录';syncIndustrySelection();renderIndustryRows();
    }catch(e){
      if(generation!==industryGeneration)return;q('#industry-catalog-status').textContent='行业目录读取失败。'+(!manual&&industryRows.length?'已保留上次排名，本次未更新。':'')+'已保存的行业和当前选择均保留；不会改为全行业。'+(e.message?' '+String(e.message).slice(0,180):'');q('#industry-catalog-retry').textContent='重试读取目录';
    }finally{if(generation===industryGeneration){industryLoading=false;controls();}}
  }
  q('#industry-ranking-refresh').onclick=()=>loadIndustries({refresh:true});
  q('#industry-catalog-retry').onclick=()=>loadIndustries({refresh:true});q('#industry-catalog-more').onclick=()=>loadIndustries({append:true});
  f.industrySelectionMode.onchange=()=>{syncIndustrySelection();loadIndustries();};
  f.industrySearch.oninput=()=>{clearTimeout(industrySearchTimer);industrySearchTimer=setTimeout(()=>loadIndustries(),300);};
  f.industrySearch.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(industrySearchTimer);loadIndustries();}};

  function holding(h={}){
    const d=document.createElement('div');d.className='holding-card';
    d.innerHTML='<div class="form-grid"><label>股票代码<input data-field="symbol" placeholder="如600519" maxlength="12" required></label><label>股票名称（可选）<input data-field="name" maxlength="80"></label><label>实际股数<input data-field="quantity" type="number" min="0" step="1" inputmode="numeric" required></label><label>每股成本（元）<input data-field="cost" type="number" min="0" step="0.0001" inputmode="decimal" required></label></div><button type="button">删除这只持仓</button>';
    for(const input of d.querySelectorAll('input'))input.value=h[input.dataset.field]??'';
    d.querySelector('button').onclick=()=>{d.remove();mark();};q('#holding-rows').append(d);decorate(d);
  }
  function holdingMode(){const active=f.holdingMode.value==='positions';q('#holding-editor').hidden=!active;for(const input of q('#holding-rows').querySelectorAll('input'))input.disabled=!active;}
  function partnerOptions(saved){
    const select=f.partnerTarget;select.replaceChildren(new Option('未选择（可用 /ashare-research）',''));
    for(const t of partnerList||[])select.add(new Option(t.label||t.id,t.id));
    if(saved&&!Array.from(select.options).some(x=>x.value===saved))select.add(new Option('已保存伙伴（当前列表未返回）',saved));select.value=saved||'';
  }
  function setState(s,{force=false}={}){
    if((dirty||saving||uncertain)&&!force){if(base&&s.mode===base.mode&&s.revision!==base.revision)say('后台资料有更新。你的草稿已保留；重新读取前不会覆盖新版本。',true);return;}
    base=s;loading=false;dirty=false;uncertain=null;confirmed=false;++industryGeneration;clearTimeout(industrySearchTimer);industryLoading=false;industryLoaded=false;industryRows=[];industryNextOffset=null;industryCatalogToken=null;industryNames=new Map();q('#config-saved-next').hidden=true;form.reset();
    // Synthetic defaults are deliberately never copied into a real account form.
    const c=s.config;
    for(const k of ['cash','horizonDays','reviewMinutes'])f[k].value=c?.[k]??'';
    for(const k of percents)f[k].value=c?.[k]===undefined?'':Number((c[k]*100).toFixed(8));
    for(const k of ['newsMaxAgeHours','quoteMaxAgeMinutes'])f[k].value=c?.[k]??(k==='newsMaxAgeHours'?48:20);
    q('#holding-rows').replaceChildren();for(const h of c?.holdings||[])holding(h);
    f.holdingMode.value=c?(c.holdings.length?'positions':'empty'):'';holdingMode();
    industrySelected=new Set(c?.industryIds||[]);f.industrySelectionMode.value=c?.industrySelectionMode||(industrySelected.size?'manual':'hot120');f.industrySearch.value='';syncIndustrySelection();renderIndustryRows();q('#industry-catalog-meta').textContent='';q('#industry-catalog-status').textContent='行业目录将在本页读取。';f.dailyScanTime.value=c?.dailyScanTime||'15:15';
    for(const k of ['trackingEnabled','dailyScanEnabled','allowAutoRevision','sendKlineImages'])f[k].checked=c?.[k]===true;
    partnerOptions(c?.partnerTarget?.id);
    controls();showStep(step);say((s.simulation?'模拟资料（独立保存）':'真实资料')+(c?' · 已保存':' · 未配置'));
  }
  async function partners(){const button=q('#partners-retry');button.disabled=true;button.hidden=true;q('#partner-status').textContent='正在读取可选研究伙伴…';try{const r=await request('list_partners',{},base.mode),list=r.targets||r;partnerList=Array.isArray(list)?list:[];partnerOptions(f.partnerTarget.value);q('#partner-status').textContent=partnerList.length?'可选伙伴已读取。':'暂无可选伙伴；保存后仍可在普通对话调用技能。';}catch{q('#partner-status').textContent='伙伴列表读取失败，已保留原选择。可以重新读取，或在对话中调用技能。';button.hidden=false;}finally{button.disabled=false;}}
  q('#partners-retry').onclick=partners;
  function values({checkIndustry=true}={}){
    if(!f.holdingMode.value)throw new Error('请选择空仓，或填写已有持仓。');
    const c={};for(const k of ['cash','horizonDays','reviewMinutes','newsMaxAgeHours','quoteMaxAgeMinutes']){if(f[k].value==='')throw new Error('请填写所有必填项。');c[k]=Number(f[k].value);}
    for(const k of percents){if(f[k].value==='')throw new Error('请自行填写风险范围，未使用默认比例。');c[k]=Number(f[k].value)/100;}
    c.holdings=f.holdingMode.value==='empty'?[]:Array.from(q('#holding-rows').children).map(row=>{
      const h={};for(const input of row.querySelectorAll('input'))h[input.dataset.field]=input.value.trim();
      if(!h.symbol||h.quantity===''||h.cost==='')throw new Error('每只持仓都需要代码、实际股数和每股成本；不需要的行可删除。');
      return {...h,quantity:Number(h.quantity),cost:Number(h.cost)};
    });
    if(f.holdingMode.value==='positions'&&!c.holdings.length)businessError(f.holdingMode,'请至少添加一只持仓，或选择“目前无持仓”。');
    if(c.maxStockWeight>c.maxIndustryWeight)businessError(f.maxStockWeight,'单股上限不能高于行业上限。');
    if(c.maxIndustryWeight>c.maxEquityWeight)businessError(f.maxIndustryWeight,'行业上限不能高于总股票仓位上限。');
    const seen=new Set();for(let i=0;i<c.holdings.length;i++){const row=q('#holding-rows').children[i],input=row.querySelector('[data-field=symbol]');let code;try{code=AShareCore.symbol(c.holdings[i].symbol);}catch{businessError(input,'请填写6位股票代码，或带sh/sz/bj前缀的代码。');}if(seen.has(code))businessError(input,'这只股票已填写，请合并为一条实际持仓。');seen.add(code);}
    if(checkIndustry&&industryManual()&&!industrySelected.size)businessError(f.industrySelectionMode,'手动选择模式须至少选择一个倾向行业，不能留空为全行业。');c.industrySelectionMode=f.industrySelectionMode.value;c.industryIds=industryManual()?[...industrySelected]:[];c.dailyScanTime=f.dailyScanTime.value;
    for(const k of ['trackingEnabled','dailyScanEnabled','allowAutoRevision','sendKlineImages'])c[k]=f[k].checked;
    if(f.partnerTarget.value)c.partnerTarget={kind:'bot',id:f.partnerTarget.value};
    if(!checkIndustry&&industryManual()&&!industrySelected.size)c.industrySelectionMode='hot120';
    return globalThis.AShareCore.config(c);
  }
  form.addEventListener('keydown',e=>{if(e.key==='Enter'&&step<2&&e.target.tagName==='INPUT'){e.preventDefault();if(validStep())showStep(step+1);}});
  form.addEventListener('input',e=>{if(e.target.matches('input,select'))clearError(e.target);if(e.target!==f.industrySearch)mark();});form.addEventListener('change',()=>{holdingMode();mark();});
  q('#add-holding').onclick=()=>{holding();holdingMode();mark();};
  async function reload(){try{const s=await request('get_state',{},base.mode);setState(s,{force:true});await onSaved(s);}catch(e){say(e.message,true);}}
  q('#reload-config').onclick=async()=>{if(dirty){say('草稿尚未保存。请先保存，或点击“放弃修改”后重新读取。',true);return;}const done=AShareButton.begin(q('#reload-config'),'读取中…');try{await reload();}finally{done();controls();}};
  q('#discard-config').onclick=async()=>{const done=AShareButton.begin(q('#discard-config'),'读取中…');try{await reload();}finally{done();controls();}};
  form.onsubmit=async e=>{
    e.preventDefault();if(loading||!base||saving||uncertain||confirmed)return;
    try{
      clearErrors();const invalid=Array.from(form.querySelectorAll('#config-fields input,#config-fields select')).find(x=>!x.disabled&&!x.checkValidity());if(invalid){fieldError(invalid,invalidMessage(invalid));say('请修改标出的填写项。',true);return;}
      const config=values(),attempt={requestKey:crypto.randomUUID(),expectedRevision:base.revision,config},mode=base.mode;
      saving=true;controls();say('正在保存'+(mode==='simulation'?'模拟':'真实')+'配置…');
      let acknowledged=false;
      try{
        await request('configure',attempt,mode);acknowledged=true;dirty=false;
        const s=await request('get_state',{},mode);if(!s.config||JSON.stringify(AShareCore.config(s.config))!==JSON.stringify(config))throw new Error('读取的配置与本次提交不同，请先核对。');saving=false;setState(s,{force:true});await onSaved(s);
        confirmed=true;controls();say('配置已保存。');q('#config-saved-next').hidden=false;
      }catch(e){if(acknowledged||e.code==='UI_UNCERTAIN'){uncertain={...attempt,mode};say(acknowledged?'保存已受理，但读取确认失败。请点“核对保存结果”，不要重复保存。':'保存结果未知，草稿已保留。请点“核对保存结果”，不要重复保存。',true);}else say(e.message+(e.code==='REVISION_CONFLICT'?' 草稿已保留，请核对后台更新；放弃草稿后可读取最新配置。':''),true);}
    }catch(e){say(e.message,true);}finally{saving=false;controls();}
  };
  q('#reconcile-config').onclick=async()=>{
    if(!uncertain)return;const button=q('#reconcile-config'),done=AShareButton.begin(button,'核对中…');
    try{const s=await request('get_state',{},uncertain.mode);const canonical=x=>JSON.stringify(globalThis.AShareCore.config(x));
      if(s.config&&canonical(s.config)===canonical(uncertain.config)){saving=false;dirty=false;setState(s,{force:true});await onSaved(s);confirmed=true;controls();q('#config-saved-next').hidden=false;say('已核对：当前已保存配置与本次提交一致。');}
      else say('当前配置与提交内容不一致，保存结果仍需核对；未再次提交或覆盖。',true);
    }catch(e){say(e.message,true);}finally{done();controls();}
  };
  return {setState,partners,setLoading(){loading=true;controls();say('正在读取所选资料模式，暂不能保存。');},isDirty:()=>dirty||saving||!!uncertain,focus:()=>{form.querySelector('[data-form-step="'+step+'"] input:not([disabled]),[data-form-step="'+step+'"] select:not([disabled])')?.focus();}};
}};
