'use strict';
// All pages use the same single-writer bridge. No library data is written by a page.
globalThis.AShareUIClient=(()=>{
  const channel=new BroadcastChannel('ashare-workbench'),pending=new Map(),listeners=new Set();
  async function request(operation,args={},mode='live'){
    const reqId=crypto.randomUUID();
    // Mobile Host connects the declared channel when opening a page. Its fetch
    // allowlist excludes /wake; only desktop pages call that endpoint.
    if(!globalThis.cindyMobile){
      const wake=await fetch('/wake');
      if(!wake.ok)throw new Error('插件未能唤醒，请检查插件是否已启用。');
    }
    const msg={type:'request',reqId,operation,args:{...args,mode}};
    return new Promise((resolve,reject)=>{
      const timer=setInterval(()=>channel.postMessage(msg),1000);
      const expiry=setTimeout(()=>{clearInterval(timer);pending.delete(reqId);reject(Object.assign(new Error('请求结果尚未确认。请核对保存结果，不要重复提交。'),{code:'UI_UNCERTAIN'}));},180000);
      pending.set(reqId,{resolve,reject,timer,expiry});channel.postMessage(msg);
    });
  }
  channel.onmessage=e=>{
    const m=e.data;
    if(m?.type==='response'){
      const p=pending.get(m.reqId);if(!p)return;
      clearInterval(p.timer);clearTimeout(p.expiry);pending.delete(m.reqId);
      m.ok?p.resolve(m.result):p.reject(Object.assign(new Error((m.errorCode?m.errorCode+'：':'')+m.message),{code:m.errorCode}));
    }else for(const listener of listeners)listener(m);
  };
  return {request,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
})();
