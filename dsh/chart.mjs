import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const Chart=require('../plugin/chart.js');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const fmt=v=>Number.isFinite(v)?Number(v).toFixed(2):'缺失';
/** Host-specific raster output; original chart.model decides bars and simulation identity. */
export async function renderChart(detail,options={},sharpImpl){
  const sharp=sharpImpl||(await import('sharp')).default,m=Chart.model(detail,options),bars=m.bars,width=1100,height=780,left=96,right=1050,top=145,bottom=485;
  const lo=Math.min(...bars.map(b=>b.low)),hi=Math.max(...bars.map(b=>b.high)),pad=(hi-lo||hi*.05)*.08,min=lo-pad,max=hi+pad,y=v=>top+(max-v)/(max-min)*(bottom-top),at=i=>left+(i+.5)*(right-left)/bars.length,bw=Math.max(3,(right-left)/bars.length*.64),shapes=[];
  const text=(value,x,y,size=18,fill='#20242a',anchor='start')=>shapes.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${esc(value)}</text>`);
  text(m.title,28,44,27);text(`未复权报价 ${fmt(detail.quote?.price)}  报价时间 ${detail.quote?.asOf?new Date(detail.quote.asOf).toISOString():'未取得'}`,28,79,18,'#59636f');text(`K线 ${detail.source}/${detail.adjustment}  ${bars[0].date} — ${bars.at(-1).date}  阳线红 / 阴线绿`,28,109,18,'#59636f');
  for(let i=0;i<=4;i++){const p=min+(max-min)*i/4,yy=y(p);shapes.push(`<path d="M${left},${yy}H${right}" stroke="#e4e8ed"/>`);text(fmt(p),16,yy+6,17,'#59636f');}
  bars.forEach((b,i)=>{const color=b.close>=b.open?'#b83b3b':'#237855';shapes.push(`<path d="M${at(i)},${y(b.high)}V${y(b.low)}" stroke="${color}"/><rect x="${at(i)-bw/2}" y="${Math.min(y(b.open),y(b.close))}" width="${bw}" height="${Math.max(2,Math.abs(y(b.close)-y(b.open)))}" fill="${color}"/>`);});
  for(const [period,color]of [[5,'#3d5d99'],[20,'#8d5a98']]){const points=[];bars.forEach((_b,i)=>{if(i>=period-1){const avg=bars.slice(i-period+1,i+1).reduce((n,b)=>n+b.close,0)/period;points.push(at(i)+','+y(avg));}});shapes.push(`<polyline points="${points.join(' ')}" stroke="${color}" stroke-width="2" fill="none"/>`);}
  text(bars[0].date,left,515,17,'#59636f');text(bars.at(-1).date,right,515,17,'#59636f','end');text('成交量（以来源口径为准）',28,553,17,'#59636f');const volumes=bars.map(b=>Number.isFinite(b.volume)&&b.volume>0?b.volume:0),vmax=Math.max(...volumes,1);bars.forEach((b,i)=>{const h=volumes[i]/vmax*50;shapes.push(`<rect x="${at(i)-bw/2}" y="${610-h}" width="${bw}" height="${h}" fill="${b.close>=b.open?'#b83b3b':'#237855'}"/>`);});
  const i=detail.indicators;text(i?.ready?`MA5 ${fmt(i.ma5)}  MA20 ${fmt(i.ma20)}  RSI14 ${fmt(i.rsi14)}  MACD柱 ${fmt(i.macd?.histogram)}  ATR14 ${fmt(i.atr14)}`:'技术指标未取得或本周期未计算',28,639,18);const p=options.position;text(p?`计划未复权参考：目标 ${fmt(p.target)} / 止损 ${fmt(p.stop)}；建议仓位 ${fmt(p.weight*100)}%`:'指定股票行情查询；未据此生成投资建议',28,674,18);text('计划点位与前复权历史坐标分列，未直接叠加。MA5蓝 / MA20紫。',28,707,17,'#59636f');text(m.simulation?'【模拟测试】合成价格、K线和资讯，不是真实行情或投资建议。':'仅供研究参考；结合资讯、数据时间与计划依据，不自动交易。',28,741,17,'#59636f');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="white"/><g font-family="Noto Sans CJK SC, sans-serif">${shapes.join('')}</g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
