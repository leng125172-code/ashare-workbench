async () => {
 const results=[];
 const check=(name,condition,detail)=>{results.push({name,passed:!!condition,...(detail?{detail}:{})});if(!condition)throw Error(name);};
 const st=await AShareUIClient.request('get_state',{},'live');
 const boxes=[...document.querySelectorAll('.checks input')];
 const css=n=>getComputedStyle(n),label=n=>n.closest('label'),status=n=>label(n).querySelector('.switch-state').textContent;
 check('开关统一40×24，整行点击区域至少70px',boxes.length===4&&boxes.every(n=>n.offsetWidth===40&&n.offsetHeight===24&&label(n).offsetHeight>=70));
 check('每个开关有文字标签和语义角色',boxes.every(n=>n.getAttribute('role')==='switch'&&label(n).querySelector('.switch-caption').textContent.trim()));
 const input=boxes[0];label(input).click();
 check('点击整行开启，状态文字同步',input.checked&&status(input)==='已开启');
 const onColor=css(input).backgroundColor,onEdge=css(label(input)).borderLeftColor;
 label(input).click();
 check('关闭后轨道与选中边线均变化',!input.checked&&status(input)==='已关闭'&&css(input).backgroundColor!==onColor&&css(label(input)).borderLeftColor!==onEdge);
 label(input).click();editor.setLoading();
 check('继承fieldset禁用，显示不可用和虚线',boxes.every(n=>n.matches(':disabled')&&status(n)==='不可用'&&css(n).borderTopStyle==='dashed')&&css(input).backgroundColor!==onColor);
 label(input).click();input.click();check('禁用后点击不会切换',input.checked);
 check('禁用保存按钮有虚线标记且文字不被整体淡化',css(document.querySelector('#save-config')).borderTopStyle==='dashed'&&css(document.querySelector('#save-config')).opacity==='1');
 editor.setState(st,{force:true});
 check('解除加载后恢复原始状态',boxes.every(n=>!n.matches(':disabled')&&status(n)===(n.checked?'已开启':'已关闭')));
 const selected=document.querySelector('.config-step[aria-current=step]');
 check('当前步骤有加粗和3px底边',css(selected).borderBottomWidth==='3px'&&Number(css(selected).fontWeight)>=700);
 check('320px无横向溢出',innerWidth===320&&document.documentElement.scrollWidth<=innerWidth,{viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth});
 return {passed:results.filter(x=>x.passed).length,total:results.length,results};
}
