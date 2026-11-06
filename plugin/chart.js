(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AShareChart=api;})(globalThis,function(){
  'use strict';
  const number=n=>typeof n==='number'&&Number.isFinite(n);
  const fmt=(n,p=2)=>number(n)?n.toFixed(p):'未取得';
  const time=n=>n?new Date(n).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'时间未确认';
  function model(detail,options={}){
    const bars=(detail.bars||[]).filter(b=>[b.open,b.close,b.high,b.low].every(number)&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)).slice(-80);
    if(bars.length<2)throw new Error('有效K线不足，不能生成图片。');
    const simulation=options.mode==='simulation'||detail.simulation===true||detail.source==='simulation';
    return {bars,simulation,title:(simulation?'【模拟测试】':'')+(detail.quote?.name||options.symbol||'股票')+' · '+({day:'日K',week:'周K',month:'月K'}[detail.period]||detail.period),detail,options};
  }
  function png(detail,options={}){
    const m=model(detail,options),canvas=document.createElement('canvas');canvas.width=1100;canvas.height=780;
    const x=canvas.getContext('2d');if(!x)throw new Error('当前运行时不支持图像导出。');
    const ink='#20242a',muted='#59636f',up='#b83b3b',down='#237855';
    x.fillStyle='#fff';x.fillRect(0,0,1100,780);x.fillStyle=ink;x.font='bold 27px system-ui';x.fillText(m.title.slice(0,54),28,44);
    x.font='19px system-ui';x.fillStyle=muted;x.fillText(`未复权报价 ${fmt(detail.quote?.price)}   报价时间 ${time(detail.quote?.asOf)}`,28,79);
    x.fillText(`K线 ${detail.source}/${detail.adjustment}   ${m.bars[0].date} — ${m.bars.at(-1).date}   阳线红 / 阴线绿`,28,109);
    const left=96,right=1050,top=145,bottom=485,width=right-left,bars=m.bars;
    const lo=Math.min(...bars.map(b=>b.low)),hi=Math.max(...bars.map(b=>b.high)),pad=(hi-lo||hi*.05)*.08,min=lo-pad,max=hi+pad;
    const y=v=>top+(max-v)/(max-min)*(bottom-top),at=i=>left+(i+.5)*width/bars.length,bw=Math.max(3,width/bars.length*.64);
    x.font='17px system-ui';
    for(let i=0;i<=4;i++){const p=min+(max-min)*i/4,yy=y(p);x.strokeStyle='#e4e8ed';x.beginPath();x.moveTo(left,yy);x.lineTo(right,yy);x.stroke();x.fillStyle=muted;x.fillText(fmt(p),16,yy+6);}
    bars.forEach((b,i)=>{x.strokeStyle=x.fillStyle=b.close>=b.open?up:down;x.beginPath();x.moveTo(at(i),y(b.high));x.lineTo(at(i),y(b.low));x.stroke();x.fillRect(at(i)-bw/2,Math.min(y(b.open),y(b.close)),bw,Math.max(2,Math.abs(y(b.close)-y(b.open))));});
    for(const [period,color]of [[5,'#3d5d99'],[20,'#8d5a98']]){x.strokeStyle=color;x.lineWidth=2;x.beginPath();let started=false;bars.forEach((b,i)=>{if(i<period-1)return;const avg=bars.slice(i-period+1,i+1).reduce((a,b)=>a+b.close,0)/period;if(started)x.lineTo(at(i),y(avg));else{x.moveTo(at(i),y(avg));started=true;}});x.stroke();}
    x.lineWidth=1;x.fillStyle=muted;x.fillText(bars[0].date,left,515);x.textAlign='right';x.fillText(bars.at(-1).date,right,515);x.textAlign='left';
    const volumes=bars.map(b=>number(b.volume)&&b.volume>0?b.volume:0),vmax=Math.max(...volumes,1);bars.forEach((b,i)=>{x.fillStyle=b.close>=b.open?up:down;const h=volumes[i]/vmax*50;x.fillRect(at(i)-bw/2,610-h,bw,h);});
    x.fillStyle=muted;x.fillText('成交量（以来源口径为准）',28,553);
    const i=detail.indicators;x.fillStyle=ink;x.font='18px system-ui';
    x.fillText(i?.ready?`MA5 ${fmt(i.ma5)}   MA20 ${fmt(i.ma20)}   RSI14 ${fmt(i.rsi14)}   MACD柱 ${fmt(i.macd?.histogram,3)}   ATR14 ${fmt(i.atr14)}`:'技术指标未取得或本周期未计算',28,639);
    const p=options.position;
    x.fillText(p?`计划未复权参考：目标 ${fmt(p.target)} / 止损 ${fmt(p.stop)}；建议仓位 ${fmt(p.weight*100)}%`:'指定股票行情查询；未据此生成投资建议',28,674);
    x.fillStyle=muted;x.font='17px system-ui';x.fillText('计划点位与前复权历史坐标分列，未直接叠加。MA5蓝 / MA20紫。',28,707);
    x.fillText(m.simulation?'模拟合成价格、K线和资讯，仅供功能测试，不是真实行情或投资建议。':'仅供研究参考；请结合资讯、数据时间与计划依据，不自动交易。',28,741);
    return canvas.toDataURL('image/png').split(',')[1];
  }
  return {model,png};
});
