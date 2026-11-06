() => {
 const rgb=value=>{const parts=value.match(/[\d.]+/g)?.map(Number);if(!parts||parts.length<3)throw Error('Unknown color '+value);return parts.slice(0,3);};
 const lum=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>{const x=lum(rgb(a)),y=lum(rgb(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 const placeholder=document.querySelector('[name=industryIds]'),input=document.querySelector('[name=cash]'),button=document.querySelector('#save-config'),article=document.querySelector('[data-form-step="0"]');
 const pairs=[['正文',getComputedStyle(article).color,getComputedStyle(article).backgroundColor],['字段内容',getComputedStyle(input).color,getComputedStyle(input).backgroundColor],['占位文字',getComputedStyle(placeholder,'::placeholder').color,getComputedStyle(placeholder).backgroundColor],['主要按钮',getComputedStyle(button).color,getComputedStyle(button).backgroundColor],['辅助说明',getComputedStyle(input.closest('label').querySelector('small')).color,getComputedStyle(article).backgroundColor]];
 const error=document.createElement('div');error.className='notice error';error.textContent='错误说明';document.body.append(error);pairs.push(['错误提示',getComputedStyle(error).color,getComputedStyle(error).backgroundColor]);
 const results=pairs.map(([name,foreground,background])=>{const ratio=contrast(foreground,background);return {name,foreground,background,ratio:Number(ratio.toFixed(2)),passed:ratio>=4.5};});
 error.remove();return {colorScheme:getComputedStyle(document.documentElement).colorScheme,passed:results.every(x=>x.passed),results};
}
