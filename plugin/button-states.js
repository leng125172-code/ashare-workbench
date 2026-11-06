'use strict';
// A shared visual busy state. Completion is shown only by the owning operation.
globalThis.AShareButton={begin(button,label='处理中…'){
  const disabled=button.disabled,children=Array.from(button.childNodes),width=button.style.minWidth;
  const busy=button.getAttribute('aria-busy');
  button.style.minWidth='min('+Math.ceil(button.getBoundingClientRect().width)+'px, 100%)';
  button.disabled=true;button.setAttribute('aria-busy','true');button.textContent=label;
  return ()=>{button.style.minWidth=width;button.replaceChildren(...children);button.disabled=disabled;if(busy===null)button.removeAttribute('aria-busy');else button.setAttribute('aria-busy',busy);};
}};
