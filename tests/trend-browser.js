async () => {
 const results=[],check=(name,value)=>{results.push({name,passed:!!value});if(!value)throw Error(name);};
 go('stock');$('#stock-code').value='600001';$('#stock-period').value='day';await loadStock();
 const node=$('#trend-chart'),canvas=$('#kline');
 check('价格、MA和成交量共用完整历史序列',trendViewer.snapshot().bars===80&&trendViewer.snapshot().sub==='volume'&&node.querySelector('.trend-values').textContent.includes('MA60'));
 node.querySelector('[data-trend-kind=line]').click();check('可切到收盘折线',trendViewer.snapshot().kind==='line');
 node.querySelector('[data-sub=macd]').click();check('MACD副图与数值可切换',trendViewer.snapshot().sub==='macd'&&node.querySelector('.trend-values').textContent.includes('DIF'));
 node.querySelector('[data-count="20"]').click();check('显示范围可缩放且保留真实总根数',trendViewer.snapshot().view.count===20&&trendViewer.snapshot().bars===80);
 node.querySelector('[data-pan=older]').click();check('可向前查看已加载历史',trendViewer.snapshot().view.start===50);
 node.querySelector('[data-pan=latest]').click();check('可回到最新窗口',trendViewer.snapshot().view.end===80);
 const dragRect=canvas.getBoundingClientRect();canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerId:18,pointerType:'touch',clientX:dragRect.left+100,clientY:dragRect.top+60}));canvas.dispatchEvent(new PointerEvent('pointermove',{pointerId:18,pointerType:'touch',clientX:dragRect.left+145,clientY:dragRect.top+62}));canvas.dispatchEvent(new PointerEvent('pointerup',{pointerId:18,pointerType:'touch'}));check('水平拖动可查看更早的K线',trendViewer.snapshot().view.offset>0);node.querySelector('[data-pan=latest]').click();
 const rect=canvas.getBoundingClientRect();canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerId:17,pointerType:'touch',clientX:rect.left+rect.width*.5,clientY:rect.top+100,bubbles:true}));canvas.dispatchEvent(new PointerEvent('pointerup',{pointerId:17,pointerType:'touch',bubbles:true}));canvas.dispatchEvent(new PointerEvent('pointerleave',{pointerType:'touch'}));
 check('轻触后保留选中K线并展示OHLC',trendViewer.snapshot().selected!==null&&node.querySelector('.trend-date').textContent.includes('已选中')&&node.querySelectorAll('.trend-ohlc strong').length===4);
 canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));check('键盘可选择窗口首根',trendViewer.snapshot().selected===trendViewer.snapshot().view.start);
 canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'+',bubbles:true}));check('键盘可缩放且不补造K线',trendViewer.snapshot().view.count===10&&trendViewer.snapshot().bars===80);
 await node.querySelector('[data-trend-period=week]').onclick();check('周K查询同步切换周期与指标',trendViewer.snapshot().period==='week'&&chart.period==='week'&&$('#stock-period').value==='week');
 await node.querySelector('[data-trend-period=month]').onclick();check('月K按本周期序列展示',trendViewer.snapshot().period==='month'&&node.querySelector('.trend-basis').textContent.includes('月K计算'));
 node.querySelector('[data-count=all]').click();check('全部只显示当前来源实际根数',trendViewer.snapshot().view.count===80);
 check('图表允许纵向页面滚动',getComputedStyle(canvas).touchAction.includes('pan-y'));
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 check('实际画布已渲染且窄屏不溢出',canvas.width>0&&document.documentElement.scrollWidth<=innerWidth);
 return {passed:results.filter(x=>x.passed).length,total:results.length,results,snapshot:trendViewer.snapshot(),width:innerWidth,scrollWidth:document.documentElement.scrollWidth};
}
