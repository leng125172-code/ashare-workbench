(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AShareCalendar=api;})(globalThis,function(){
  'use strict';
  const calendar={year:2026,validThrough:'2026-12-31',verifiedAt:'2026-11-04',source:'https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml',
    closures:[['2026-01-01','2026-01-03'],['2026-02-15','2026-02-23'],['2026-04-04','2026-04-06'],['2026-05-01','2026-05-05'],['2026-06-19','2026-06-21'],['2026-09-25','2026-09-27'],['2026-10-01','2026-10-07']]};
  function dateCN(at=Date.now()){const n=typeof at==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(at)?Date.parse(at+'T12:00:00+08:00'):Number(at);if(!Number.isFinite(n))throw new Error('无效的扫描日期。');return new Date(n+8*3600000).toISOString().slice(0,10);}
  function check(at=Date.now()){
    const date=dateCN(at),known=date.startsWith(calendar.year+'-'),weekday=new Date(date+'T12:00:00Z').getUTCDay();
    const holiday=calendar.closures.some(([a,b])=>date>=a&&date<=b);
    return {date,known,isTradingDay:known&&weekday!==0&&weekday!==6&&!holiday,reason:!known?'交易日历未覆盖该年份，停止自动扫描并更新官方日历。':weekday===0||weekday===6?'周末休市':holiday?'交易所公告休市':'交易日',source:calendar.source,validThrough:calendar.validThrough};
  }
  function previousTradingDate(date){let t=Date.parse(date+'T12:00:00+08:00');for(let n=0;n<370;n++){t-=86400000;const c=check(t);if(!c.known)return null;if(c.isTradingDay)return c.date;}return null;}
  function expectedDailyBar(at=Date.now()){const c=check(at),shifted=new Date(Number(at)+8*3600000),minutes=shifted.getUTCHours()*60+shifted.getUTCMinutes();return c.isTradingDay&&minutes>=910?c.date:previousTradingDate(c.date);}
  function preRunHookScript(){return `// Verified exchange calendar; unknown year fails closed.\nconst calendar=${JSON.stringify(calendar)};\nconst date=new Date(Date.now()+8*3600000).toISOString().slice(0,10);\nif(!date.startsWith(calendar.year+'-'))throw new Error('TRADING_CALENDAR_EXPIRED: refresh official exchange calendar');\nconst day=new Date(date+'T12:00:00Z').getUTCDay();\nconst closed=day===0||day===6||calendar.closures.some(([a,b])=>date>=a&&date<=b);\nconsole.log('CINDY_PRECHECK_OK');\nprocess.exit(closed?2:0);\n`;}
  return {calendar,dateCN,check,previousTradingDate,expectedDailyBar,preRunHookScript};
});
