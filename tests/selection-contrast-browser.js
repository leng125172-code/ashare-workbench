async () => {
 const results=[],check=(name,passed,detail)=>{results.push({name,passed:!!passed,...(detail?{detail}:{})});if(!passed)throw Error(name+': '+JSON.stringify(detail));};
 // Canvas resolves CSS color()/color-mix() to sRGB without approximating browser output.
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
 const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);};
 const lum=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
 const ratio=(fg,bg)=>{const a=lum(rgb(fg)),b=lum(rgb(bg));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
 const sample=(name,node)=>{const s=getComputedStyle(node),contrast=ratio(s.color,s.backgroundColor);check(name,contrast>=4.5,{contrast:Number(contrast.toFixed(2)),color:s.color,background:s.backgroundColor});};
 await refresh();go('overview');sample('侧栏选中项文字对比度≥4.5',document.querySelector('nav [aria-selected=true]'));
 go('stock');$('#stock-code').value='600001';await loadStock();sample('K线标签选中文字对比度≥4.5',$('[data-trend-period=day]'));
 const button=$('#stock-form button'),done=AShareButton.begin(button,'查询中…');sample('加载按钮文字对比度≥4.5',button);done();
 go('config');sample('当前步骤文字对比度≥4.5',document.querySelector('.config-step[aria-current=step]'));
 const root=document.documentElement,old=root.getAttribute('style');
 try{
  root.style.setProperty('--accent-soft','#d3d3d3');root.style.setProperty('--text-primary','#ffffff');root.style.setProperty('--surface','#1e1e1e');
  go('overview');const nav=document.querySelector('nav [aria-selected=true]');sample('截图中的浅强调色不再导致白字浅底',nav);
  check('旧配色可复现问题，实际选中背景不依赖accent-soft',ratio('#ffffff','#d3d3d3')<2&&getComputedStyle(nav).backgroundColor!=='rgb(211, 211, 211)');
  root.style.setProperty('--text-primary','#17263e');root.style.setProperty('--surface','#ffffff');sample('运行中切换为浅色仍保持对比度',nav);
 }finally{if(old===null)root.removeAttribute('style');else root.setAttribute('style',old);}
 check('选中标记保留3px边线和加粗',getComputedStyle(document.querySelector('nav [aria-selected=true]')).borderLeftWidth==='3px'&&getComputedStyle(document.querySelector('nav [aria-selected=true]')).fontWeight==='700');
 check('当前宽度无横向溢出',document.documentElement.scrollWidth<=innerWidth,{viewport:innerWidth,scroll:document.documentElement.scrollWidth});
 return {passed:results.filter(x=>x.passed).length,total:results.length,results};
}
