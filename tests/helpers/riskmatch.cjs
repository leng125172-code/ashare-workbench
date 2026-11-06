const Cal=require('../../plugin/calendar.js');
function fixture(){const at=Date.parse('2026-11-04T16:00:00+08:00'),knownAt=at-1800000,dates=['2026-11-04'];for(let i=0;i<60;i++)dates.unshift(Cal.previousTradingDate(dates[0]));
 const make=(symbol,sector,weight)=>({symbol,sector,classificationSource:'SYNTHETIC-test-classification',knownAt,...(weight?{weight}:{})});
 const portfolio=[make('sh600001','A',.3),make('sz000001','B',.2)],assets=[make('sh510001','A'),make('sh510002','A'),make('sz159001','B'),make('sz159002','B')];
 const lowA=Array.from({length:60},(_,i)=>.006*Math.sin(i*1.7)+.002*Math.cos(i*.4)),highA=lowA.map((x,i)=>x*3+.002*Math.sin(i*.9)),lowB=lowA.map((x,i)=>x*.3+.005*Math.cos(i*1.1)),highB=lowB.map((x,i)=>x*2.8+.003*Math.sin(i*2.1));
 const vectors=[lowA.map((x,i)=>(x+highA[i])/2),lowB.map((x,i)=>(x+highB[i])/2),lowA,highA,lowB,highB];
 return {decisionAt:at,classificationSystem:'SYNTHETIC-level1-v1',classificationKnownAt:knownAt,window:60,volTolerance:.005,portfolio,assets,series:[...portfolio,...assets].map((s,k)=>{let price=100;return {symbol:s.symbol,dataKind:'synthetic',basis:'point_in_time_adjusted_price',knownAt,source:'SYNTHETIC-known-at-fixture',prices:dates.map((date,i)=>({date,close:i?(price*=1+vectors[k][i-1]):price}))};})};}
module.exports={fixture};
