'use strict';
globalThis.AShareTrendChart={mount(container,{onPeriod=async()=>{}}={}){
  const D=AShareTrendData,canvas=container.querySelector('canvas');
  container.insertAdjacentHTML('afterbegin',`<div class="trend-toolbar"><div class="trend-segment" role="group" aria-label="K线周期"><button type="button" data-trend-period="day" aria-pressed="true">日K</button><button type="button" data-trend-period="week" aria-pressed="false">周K</button><button type="button" data-trend-period="month" aria-pressed="false">月K</button></div><div class="trend-segment" role="group" aria-label="走势类型"><button type="button" data-trend-kind="candle" aria-pressed="true">K线</button><button type="button" data-trend-kind="line" aria-pressed="false">收盘折线</button></div></div><div class="trend-options"><div class="trend-ma-options" role="group" aria-label="均线"><label><input type="checkbox" data-ma="5" checked>MA5</label><label><input type="checkbox" data-ma="20" checked>MA20</label><label><input type="checkbox" data-ma="60" checked>MA60</label></div><div class="trend-segment" role="group" aria-label="副图"><button type="button" data-sub="volume" aria-pressed="true">成交量</button><button type="button" data-sub="macd" aria-pressed="false">MACD</button></div></div><div class="trend-readout" aria-label="选中的K线"><div class="trend-date"></div><div class="trend-ohlc"></div><div class="trend-values"></div><div class="trend-sub-legend" hidden><span class="trend-dif">DIF线</span><span class="trend-dea">DEA线</span><span>柱：正红 / 负绿</span></div></div>`);
  container.insertAdjacentHTML('beforeend',`<div class="trend-navigation"><div class="trend-segment" role="group" aria-label="显示范围"><button type="button" data-count="20">20根</button><button type="button" data-count="60" aria-pressed="true">60根</button><button type="button" data-count="120">120根</button><button type="button" data-count="all">全部</button></div><div class="trend-pages"><button type="button" data-pan="older" aria-label="查看较早的K线">← 较早</button><button type="button" data-pan="newer" aria-label="查看较近的K线">较近 →</button><button type="button" data-pan="latest">回到最新</button></div></div><label class="trend-range-label">显示根数 <span class="trend-range-value"></span><input class="trend-range" type="range" min="1" max="140" value="60" aria-label="缩放K线显示根数"></label><p class="trend-help">轻触或移动指针查看某根K线；左右拖动查看历史，上下滑动仍可滚动页面。也可用方向键选点、加减键缩放。</p><p class="trend-basis"></p><div class="trend-live sr-only" role="status" aria-live="polite"></div><span class="trend-palette trend-ma5" aria-hidden="true"></span><span class="trend-palette trend-ma20" aria-hidden="true"></span><span class="trend-palette trend-ma60" aria-hidden="true"></span><span class="trend-palette trend-dif" aria-hidden="true"></span><span class="trend-palette trend-dea" aria-hidden="true"></span>`);
  const q=s=>container.querySelector(s),all=s=>Array.from(container.querySelectorAll(s));
  let data=null,kind='candle',sub='volume',count=60,offset=0,selected=null,drag=null,frame=0;
  const enabledMA=new Set([5,20,60]);
  const fmt=(v,p=2)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:p}):'—';
  function view(){return D.viewport(data.bars.length,count,offset);}
  function palette(selector,fallback){const e=document.querySelector(selector);return e?getComputedStyle(e).color:fallback;}
  function updateReadout(announce=false){
    if(!data)return;const v=view(),i=selected===null?v.end-1:selected,b=data.bars[i];
    q('.trend-date').textContent=b.date+' · '+({day:'日K',week:'周K',month:'月K'}[data.period])+(selected===null?' · 当前窗口末根':' · 已选中');
    q('.trend-ohlc').replaceChildren();for(const [label,key] of [['开','open'],['高','high'],['低','low'],['收','close']]){const cell=document.createElement('span'),small=document.createElement('small'),strong=document.createElement('strong');small.textContent=label;strong.textContent=fmt(b[key]);cell.append(small,strong);q('.trend-ohlc').append(cell);}
    const pieces=[...enabledMA].map(n=>'MA'+n+' '+fmt(data.ma[n][i]));const m=data.macd[i];pieces.push(sub==='volume'?'成交量 '+fmt(b.volume,0):'DIF '+fmt(m.dif,3)+' / DEA '+fmt(m.dea,3)+' / 柱 '+fmt(m.histogram,3));
    q('.trend-values').textContent=pieces.join(' · ');q('.trend-sub-legend').hidden=sub!=='macd';if(announce)q('.trend-live').textContent=q('.trend-date').textContent+'，开'+fmt(b.open)+'，高'+fmt(b.high)+'，低'+fmt(b.low)+'，收'+fmt(b.close);
  }
  function controls(){if(!data)return;const v=view();count=v.count;offset=v.offset;
    for(const b of all('[data-count]'))b.setAttribute('aria-pressed',String(b.dataset.count==='all'?v.count===data.bars.length:Number(b.dataset.count)===v.count));
    for(const b of all('[data-trend-period]'))b.setAttribute('aria-pressed',String(b.dataset.trendPeriod===data.period));
    q('[data-pan=older]').disabled=v.start===0;q('[data-pan=newer]').disabled=v.end===data.bars.length;q('[data-pan=latest]').disabled=v.end===data.bars.length&&selected===null;
    q('.trend-range').min=Math.min(10,data.bars.length);q('.trend-range').max=data.bars.length;q('.trend-range').value=v.count;
    q('.trend-range-value').textContent=v.count+' / '+data.bars.length+' 根 · '+data.bars[v.start].date+' — '+data.bars[v.end-1].date;
    updateReadout();
  }
  function schedule(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;draw();});}
  function line(ctx,values,y,x,start,end,color){ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();let begun=false;for(let i=start;i<end;i++){const value=values[i];if(value===null||value===undefined){begun=false;continue;}if(begun)ctx.lineTo(x(i),y(value));else{ctx.moveTo(x(i),y(value));begun=true;}}ctx.stroke();}
  function draw(){
    if(!data||container.hidden||canvas.hidden)return;const rect=canvas.getBoundingClientRect();if(rect.width<80)return;
    const w=rect.width,h=400,ratio=Math.min(devicePixelRatio||1,3);canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);const ctx=canvas.getContext('2d');if(!ctx)return;ctx.scale(ratio,ratio);
    const fg=getComputedStyle(container).color,muted=getComputedStyle(q('.trend-help')).color,grid=getComputedStyle(container).getPropertyValue('--ui-line').trim()||muted;
    const up=palette('#market-up-label',fg),down=palette('#market-down-label',fg),v=view(),bars=data.bars.slice(v.start,v.end),left=w<450?48:60,right=10,top=18,bottom=252,subTop=292,subBottom=366,plot=w-left-right;
    const priceValues=bars.flatMap(b=>[b.low,b.high]);for(const n of enabledMA)for(let i=v.start;i<v.end;i++)if(data.ma[n][i]!==null)priceValues.push(data.ma[n][i]);
    const low=Math.min(...priceValues),high=Math.max(...priceValues),pad=(high-low||Math.abs(high)*.02||1)*.08,min=low-pad,max=high+pad;
    const x=i=>left+(i-v.start+.5)*plot/v.count,y=p=>top+(max-p)/(max-min)*(bottom-top),bw=Math.max(1,plot/v.count*.64);
    ctx.font='10px system-ui';ctx.lineWidth=1;
    for(let i=0;i<=4;i++){const value=min+(max-min)*i/4,yy=y(value);ctx.globalAlpha=.45;ctx.strokeStyle=grid;ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right,yy);ctx.stroke();ctx.globalAlpha=1;ctx.fillStyle=muted;ctx.fillText(fmt(value),1,yy+3);}
    if(kind==='candle')bars.forEach((b,j)=>{const i=v.start+j;ctx.strokeStyle=ctx.fillStyle=b.close>=b.open?up:down;ctx.beginPath();ctx.moveTo(x(i),y(b.high));ctx.lineTo(x(i),y(b.low));ctx.stroke();ctx.fillRect(x(i)-bw/2,Math.min(y(b.open),y(b.close)),bw,Math.max(1,Math.abs(y(b.open)-y(b.close))));});
    else line(ctx,data.bars.map(b=>b.close),y,x,v.start,v.end,fg);
    for(const n of enabledMA)line(ctx,data.ma[n],y,x,v.start,v.end,getComputedStyle(q('.trend-ma'+n)).color);
    ctx.fillStyle=muted;ctx.fillText(sub==='volume'?'成交量（源单位）':'MACD · DIF / DEA / 柱',left,281);
    if(sub==='volume'){
      const volumes=bars.map(b=>b.volume).filter(v=>v!==null),vmax=Math.max(...volumes,1);
      bars.forEach((b,j)=>{if(b.volume===null)return;const height=b.volume/vmax*(subBottom-subTop);ctx.fillStyle=b.close>=b.open?up:down;ctx.fillRect(x(v.start+j)-bw/2,subBottom-height,bw,Math.max(height>0?1:0,height));});
      if(!volumes.length){ctx.fillStyle=muted;ctx.fillText('本窗口成交量未取得',left,subTop+30);}
    }else{
      const series=data.macd.slice(v.start,v.end),values=series.flatMap(m=>[m.dif,m.dea,m.histogram]).filter(v=>v!==null);const limit=Math.max(...values.map(Math.abs),.000001)*1.1,sy=p=>subTop+(limit-p)/(2*limit)*(subBottom-subTop),zero=sy(0);
      ctx.strokeStyle=grid;ctx.beginPath();ctx.moveTo(left,zero);ctx.lineTo(w-right,zero);ctx.stroke();
      series.forEach((m,j)=>{if(m.histogram===null)return;ctx.fillStyle=m.histogram>=0?up:down;ctx.fillRect(x(v.start+j)-bw/2,Math.min(zero,sy(m.histogram)),bw,Math.max(1,Math.abs(sy(m.histogram)-zero)));});
      line(ctx,data.macd.map(m=>m.dif),sy,x,v.start,v.end,getComputedStyle(q('.trend-dif')).color);line(ctx,data.macd.map(m=>m.dea),sy,x,v.start,v.end,getComputedStyle(q('.trend-dea')).color);
      if(!values.length){ctx.fillStyle=muted;ctx.fillText('历史根数不足，MACD暂不可用',left,subTop+24);}
    }
    ctx.fillStyle=muted;ctx.textAlign='left';ctx.fillText(data.bars[v.start].date,left,392);ctx.textAlign='right';ctx.fillText(data.bars[v.end-1].date,w-right,392);ctx.textAlign='left';
    if(selected!==null&&selected>=v.start&&selected<v.end){ctx.strokeStyle=fg;ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(x(selected),top);ctx.lineTo(x(selected),subBottom);ctx.moveTo(left,y(data.bars[selected].close));ctx.lineTo(w-right,y(data.bars[selected].close));ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=fg;ctx.beginPath();ctx.arc(x(selected),y(data.bars[selected].close),3,0,2*Math.PI);ctx.fill();}
  }
  function update(announce=false){controls();updateReadout(announce);schedule();}
  all('[data-trend-kind]').forEach(b=>b.onclick=()=>{kind=b.dataset.trendKind;all('[data-trend-kind]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));schedule();});
  all('[data-sub]').forEach(b=>b.onclick=()=>{sub=b.dataset.sub;all('[data-sub]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));update();});
  all('[data-ma]').forEach(input=>input.onchange=()=>{const n=Number(input.dataset.ma);input.checked?enabledMA.add(n):enabledMA.delete(n);update();});
  all('[data-count]').forEach(b=>b.onclick=()=>{if(!data)return;count=b.dataset.count==='all'?data.bars.length:Number(b.dataset.count);selected=null;update();});
  q('.trend-range').oninput=e=>{count=Number(e.target.value);selected=null;update();};
  all('[data-pan]').forEach(b=>b.onclick=()=>{if(!data)return;offset=b.dataset.pan==='latest'?0:offset+(b.dataset.pan==='older'?1:-1)*Math.max(1,Math.floor(count/2));selected=null;update();});
  all('[data-trend-period]').forEach(b=>b.onclick=async()=>{if(!data||data.period===b.dataset.trendPeriod)return;const buttons=all('[data-trend-period]'),done=AShareButton.begin(b,'读取中…');buttons.forEach(x=>x.disabled=true);try{await onPeriod(b.dataset.trendPeriod);}catch{/* Owning query renders its read failure. */}finally{done();buttons.forEach(x=>x.disabled=false);}});
  function selectAt(event,announce=false){if(!data)return;const rect=canvas.getBoundingClientRect(),left=rect.width<450?48:60;selected=D.atX(event.clientX-rect.left,rect.width,view(),left,10);update(announce);}
  canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','可交互价格与指标图；方向键选择K线，加减键缩放，Home和End选择窗口首尾。');
  canvas.addEventListener('pointerdown',event=>{if(!data)return;drag={x:event.clientX,y:event.clientY,offset};try{canvas.setPointerCapture?.(event.pointerId);}catch{}selectAt(event,true);});
  canvas.addEventListener('pointermove',event=>{if(!data)return;if(drag){const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)>8&&Math.abs(dx)>Math.abs(dy)){const rect=canvas.getBoundingClientRect();offset=drag.offset+Math.round(dx/(rect.width-(rect.width<450?48:60)-10)*view().count);selected=null;update();}}else if(event.pointerType!=='touch')selectAt(event);});
  canvas.addEventListener('pointerup',()=>{drag=null;});canvas.addEventListener('pointercancel',()=>{drag=null;});canvas.addEventListener('pointerleave',event=>{if(event.pointerType==='touch')return;if(!drag&&selected!==null){selected=null;update();}});
  canvas.addEventListener('keydown',event=>{if(!data)return;const v=view();let index=selected===null?v.end-1:selected;
    if(event.key==='ArrowLeft')index--;else if(event.key==='ArrowRight')index++;else if(event.key==='Home')index=v.start;else if(event.key==='End')index=v.end-1;else if(event.key==='+'||event.key==='='){count=Math.max(Math.min(10,data.bars.length),count-10);selected=null;event.preventDefault();update(true);return;}else if(event.key==='-'){count=Math.min(data.bars.length,count+10);selected=null;event.preventDefault();update(true);return;}else return;
    event.preventDefault();selected=Math.max(0,Math.min(data.bars.length-1,index));if(selected<v.start)offset=data.bars.length-count-selected;if(selected>=v.end)offset=data.bars.length-selected-1;update(true);
  });
  new ResizeObserver(schedule).observe(canvas);
  return {
    setData(detail,period){data=D.build(detail,period);selected=null;offset=0;count=Math.min(60,data.bars.length);container.hidden=false;canvas.hidden=false;q('.trend-basis').textContent=`${data.source} / ${data.adjustment} · 均线和MACD按当前${{day:'日',week:'周',month:'月'}[data.period]}K计算；不足的历史值显示“—”。MACD(12,26,9)，柱=2×(DIF−DEA)。成交量保留来源单位，未换算。末根K线可能仍在形成。`+(data.nonPositiveAdjusted?' 当前复权历史有'+data.nonPositiveAdjusted+'根含非正数，按来源值在线性坐标显示；不是当时成交价格，不据此计算收益率。':'')+(data.missingVolume?' 有'+data.missingVolume+'根成交量缺失，未补成零。':'');update();},
    clear(){data=null;selected=null;drag=null;container.hidden=true;canvas.hidden=true;},
    draw:schedule,
    snapshot(){return data?{period:data.period,kind,sub,view:view(),selected,bars:data.bars.length}:null;}
  };
}};
