'use strict';
const nativeHttps = require('node:https');
const ENV_KEYS = ['HTTP_PROXY','HTTPS_PROXY','NO_PROXY','http_proxy','https_proxy','no_proxy','ALL_PROXY','all_proxy','NODE_USE_ENV_PROXY','NODE_EXTRA_CA_CERTS','NODE_USE_SYSTEM_CA'];
function workerEnv(env=process.env) {
  const out={PATH:env.PATH||'',LANG:env.LANG||'C.UTF-8',HOME:env.HOME||''};
  for(const key of ENV_KEYS) if(typeof env[key]==='string') out[key]=env[key];
  return out;
}
function failure(code) {
  const messages={ENOTFOUND:'域名解析失败，请检查网络或 DNS。',EAI_AGAIN:'域名解析暂不可用，请稍后重试。',ECONNRESET:'连接被重置，请检查网络及已配置的代理规则。',ECONNREFUSED:'连接被拒绝，请检查数据源或已配置的代理。',ETIMEDOUT:'网络请求超时，请检查网络及代理。',DATA_SOURCE_TIMEOUT:'网络请求超时，请检查网络及代理。',ABORT_ERR:'数据请求已取消。',DATA_SIZE_LIMIT:'数据响应超过允许大小，已停止读取。',NETWORK_PROXY_UNSUPPORTED:'当前代理配置不受支持；请配置 HTTP(S) 代理或明确选择直连。',NETWORK_RUNTIME_UNSUPPORTED:'当前 Node.js 不支持环境代理，请使用 Node.js 22.22 或更新的受支持版本。',NETWORK_TLS_ERROR:'TLS 证书验证失败，请检查证书信任与网络配置。'};
  return Object.assign(new Error(messages[code]||'网络请求失败；请检查数据源、网络及代理配置。'),{code});
}
function safeError(error) {
  const code=typeof error?.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'DATA_SOURCE_ERROR';
  if(/CERT|TLS|SSL/.test(code)) return failure('NETWORK_TLS_ERROR');
  return failure(code);
}
function proxyOptions(env,version) {
  if(env.NODE_USE_ENV_PROXY==='0')return {};
  const proxy=env.https_proxy!==undefined?env.https_proxy:env.HTTPS_PROXY;
  if(proxy) {
    let url;try{url=new URL(proxy);}catch{throw failure('NETWORK_PROXY_UNSUPPORTED');}
    if(!['http:','https:'].includes(url.protocol))throw failure('NETWORK_PROXY_UNSUPPORTED');
    // The feature was backported to 22.21 and introduced on the new line in
    // 24.5; the intervening, retired 23.x line does not have it.
    const [major,minor]=version.split('.').map(Number);
    if(!(major===22&&minor>=21||major===24&&minor>=5||major>24))throw failure('NETWORK_RUNTIME_UNSUPPORTED');
    return {proxyEnv:Object.fromEntries(ENV_KEYS.filter(k=>typeof env[k]==='string').map(k=>[k,env[k]]))};
  }
  // ALL_PROXY/SOCKS is not supported by Node's HTTPS Agent. Never silently leak
  // such a request over a direct route. An explicit empty https_proxy is direct.
  if(proxy===undefined&&(env.all_proxy||env.ALL_PROXY))throw failure('NETWORK_PROXY_UNSUPPORTED');
  return {};
}
function createTransport({https=nativeHttps,env=process.env,version=process.versions.node}={}) {
  return async function request(url,{method='GET',headers={},body,signal,timeoutMs=9000,maxBytes=8*1024*1024,headersOnlyOnError=false,limitMessage}={}) {
    const u=new URL(url);
    if(u.protocol!=='https:'||u.username||u.password)throw Object.assign(new Error('仅允许无凭据的 HTTPS 来源。'),{code:'NETWORK_URL_INVALID'});
    if(signal?.aborted)throw failure('ABORT_ERR');
    let agent;try{agent=new https.Agent({keepAlive:false,rejectUnauthorized:true,...proxyOptions(env,version)});}catch(e){throw safeError(e);}
    return new Promise((resolve,reject)=>{
      let req,res,timer,done=false;
      const finish=(error,result)=>{
        if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
        res?.destroy?.();req?.destroy();agent.destroy();
        error?reject(error):resolve(result);
      };
      const abort=()=>finish(failure('ABORT_ERR'));
      const onResponse=r=>{
        res=r;const chunks=[];let size=0;
        r.on('error',e=>finish(safeError(e)));
        r.on('aborted',()=>finish(failure('ECONNRESET')));
        if(headersOnlyOnError&&r.statusCode!==200){finish(null,{statusCode:r.statusCode,headers:r.headers||{},body:Buffer.alloc(0)});return;}
        r.on('data',b=>{
          size+=b.length;if(size>maxBytes){const e=failure('DATA_SIZE_LIMIT');if(limitMessage)e.message=limitMessage;finish(e);}else chunks.push(b);
        });
        r.on('end',()=>finish(null,{statusCode:r.statusCode,headers:r.headers||{},body:Buffer.concat(chunks)}));
        r.on('close',()=>{if(!done)finish(failure('ECONNRESET'));});
      };
      try{
        req=method==='GET'?https.get(u,{headers,agent},onResponse):https.request(u,{method,headers,agent},onResponse);
        req.on('error',e=>finish(safeError(e)));
        req.setTimeout(timeoutMs,()=>finish(failure('DATA_SOURCE_TIMEOUT')));
        timer=setTimeout(()=>finish(failure('DATA_SOURCE_TIMEOUT')),timeoutMs);
        signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted){abort();return;}
        if(method!=='GET')req.end(body);
      }catch(e){finish(safeError(e));}
    });
  };
}
function diagnostics(env=process.env){return {policy:env.NODE_USE_ENV_PROXY==='0'?'explicit_direct':'environment_if_configured',httpsProxyConfigured:!!(env.https_proxy!==undefined?env.https_proxy:env.HTTPS_PROXY),noProxyConfigured:!!(env.no_proxy!==undefined?env.no_proxy:env.NO_PROXY),allProxyConfigured:!!(env.all_proxy||env.ALL_PROXY),limitation:'配置摘要不是具体目标的有效路由；系统TUN和宿主网络策略需另行核对。'};}
module.exports={request:createTransport(),createTransport,workerEnv,proxyOptions,diagnostics};
