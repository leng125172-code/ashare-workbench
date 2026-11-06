'use strict';
globalThis.AShareFeedback={render(target,{kind='empty',title,description='',detail='',retry=null,retryLabel='重新读取'}){
  target.replaceChildren();target.hidden=false;target.className='feedback-state feedback-'+kind;
  target.setAttribute('role',kind==='error'?'alert':'status');target.setAttribute('aria-live','polite');target.setAttribute('aria-busy',String(kind==='loading'));
  const icon=document.createElement('span');icon.className='feedback-icon';icon.setAttribute('aria-hidden','true');
  icon.innerHTML=kind==='loading'?'<span class="loading-ring"></span>':kind==='error'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v1"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h5M8 16h3"/></svg>';
  const heading=document.createElement('h3');heading.textContent=title;
  const text=document.createElement('p');text.textContent=description;target.append(icon,heading,text);
  if(kind==='loading'){const skeleton=document.createElement('div');skeleton.className='skeleton-lines';skeleton.setAttribute('aria-hidden','true');skeleton.innerHTML='<i></i><i></i><i></i>';target.append(skeleton);}
  if(detail){const d=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='查看错误详情';pre.textContent=detail;d.append(summary,pre);target.append(d);}
  if(retry){const b=document.createElement('button');b.type='button';b.className='retry-button';b.textContent=retryLabel;b.onclick=async()=>{if(b.disabled)return;const done=AShareButton.begin(b,'读取中…');try{await retry();}catch{/* The owning read operation keeps its scoped error visible. */}finally{done();}};target.append(b);}
  return target;
}};
