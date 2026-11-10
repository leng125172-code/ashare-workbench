'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const N=require('../plugin/node/network.cjs');
function fixture({env={},reply='ok',fail,hang=false,version='22.22.0'}={}){
 const agents=[],requests=[];
 const https={Agent:class{constructor(options){this.options=options;this.destroyed=false;agents.push(this);}destroy(){this.destroyed=true;}},get(u,options,cb){const req=new EventEmitter();req.destroy=()=>{req.destroyed=true;};req.setTimeout=()=>req;requests.push({u,options,req});queueMicrotask(()=>{if(fail){req.emit('error',fail);return;}if(hang)return;const res=new EventEmitter();res.destroy=()=>{res.destroyed=true;};res.statusCode=200;res.headers={};cb(res);res.emit('data',Buffer.from(reply));res.emit('end');});return req;}};
 return {agents,requests,request:N.createTransport({https,env,version})};
}
test('one request owns its Agent and socket; proxy config never mutates global agent or env',async()=>{
 const env={HTTPS_PROXY:'http://user:secret@127.0.0.1:8080',NO_PROXY:'.example.test'},copy={...env},f=fixture({env});
 assert.equal((await f.request('https://source.test/')).body.toString(),'ok');
 assert.deepEqual(env,copy);assert.deepEqual(f.agents[0].options.proxyEnv,env);assert.equal(f.agents[0].options.rejectUnauthorized,true);assert.equal(f.agents[0].options.keepAlive,false);assert.equal(f.agents[0].destroyed,true);assert.equal(f.requests[0].req.destroyed,true);
 await f.request('https://source.test/');assert.notEqual(f.agents[0],f.agents[1]);
});
test('explicit direct and lower-case precedence are preserved without leaking unsupported proxy traffic',async()=>{
 for(const env of [{},{NODE_USE_ENV_PROXY:'0',HTTPS_PROXY:'socks://bad',ALL_PROXY:'socks://bad'},{HTTPS_PROXY:'http://upper.test',https_proxy:''}]){const f=fixture({env});await f.request('https://source.test/');assert.equal(f.agents[0].options.proxyEnv,undefined);}
 const lower=fixture({env:{HTTPS_PROXY:'socks://ignored',https_proxy:'http://lower.test',no_proxy:'source.test',NO_PROXY:'other.test'}});await lower.request('https://source.test/');assert.equal(lower.agents[0].options.proxyEnv.https_proxy,'http://lower.test');assert.equal(lower.agents[0].options.proxyEnv.no_proxy,'source.test');
 for(const env of [{HTTPS_PROXY:'socks5://user:SECRET@host'},{ALL_PROXY:'socks5://host'},{HTTPS_PROXY:'not a url SECRET'}]){const f=fixture({env});await assert.rejects(f.request('https://source.test/'),e=>e.code==='NETWORK_PROXY_UNSUPPORTED'&&!e.message.includes('SECRET'));assert.equal(f.requests.length,0);}
});
test('unsupported runtime with configured proxy fails closed before any request',async()=>{
 for(const version of ['22.20.0','23.11.0','24.4.0']){const f=fixture({env:{HTTPS_PROXY:'http://local.test'},version});await assert.rejects(f.request('https://source.test/'),{code:'NETWORK_RUNTIME_UNSUPPORTED'});assert.equal(f.requests.length,0);}
 for(const version of ['22.22.0','24.5.0','25.0.0','26.13.0'])await fixture({env:{HTTPS_PROXY:'http://local.test'},version}).request('https://source.test/');
});
test('reset, TLS and DNS diagnostics redact URLs and credentials and release resources',async()=>{
 for(const code of ['ECONNRESET','ENOTFOUND','CERT_HAS_EXPIRED']){const f=fixture({fail:Object.assign(new Error('http://user:SECRET@internal.test'),{code})});await assert.rejects(f.request('https://source.test/'),e=>e.code===(code==='CERT_HAS_EXPIRED'?'NETWORK_TLS_ERROR':code)&&!e.message.includes('SECRET')&&!e.message.includes('internal.test'));assert.equal(f.agents[0].destroyed,true);}
});
test('absolute deadline, cancellation and body bound dispose request-local resources',async()=>{
 const timed=fixture({hang:true});await assert.rejects(timed.request('https://source.test/',{timeoutMs:15}),{code:'DATA_SOURCE_TIMEOUT'});assert.equal(timed.agents[0].destroyed,true);
 const f=fixture({hang:true}),c=new AbortController(),p=f.request('https://source.test/',{signal:c.signal});c.abort();await assert.rejects(p,{code:'ABORT_ERR'});assert.equal(f.agents[0].destroyed,true);
 const big=fixture({reply:'too large'});await assert.rejects(big.request('https://source.test/',{maxBytes:2}),{code:'DATA_SIZE_LIMIT'});assert.equal(big.agents[0].destroyed,true);
 const early=fixture(),aborted=new AbortController();aborted.abort();await assert.rejects(early.request('https://source.test/',{signal:aborted.signal}),{code:'ABORT_ERR'});assert.equal(early.agents.length,0);
});
test('worker environment forwards only network settings and preserves explicit empty values',()=>{
 const env=N.workerEnv({PATH:'/bin',HOME:'/tmp',LANG:'C',HTTPS_PROXY:'http://user:secret@local.test',NO_PROXY:'a.test',https_proxy:'',NODE_USE_ENV_PROXY:'0',NODE_OPTIONS:'--inspect',PRIVATE_TOKEN:'secret'});
 assert.equal(env.https_proxy,'');assert.equal(env.NODE_USE_ENV_PROXY,'0');assert.equal(env.NO_PROXY,'a.test');assert.equal(env.PRIVATE_TOKEN,undefined);assert.equal(env.NODE_OPTIONS,undefined);
});
test('information GET/POST and regulatory requests apply the same environment policy',async t=>{
 const https=require('node:https'),keys=['HTTPS_PROXY','https_proxy','NO_PROXY','no_proxy','NODE_USE_ENV_PROXY'],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{HTTPS_PROXY:'http://127.0.0.1:9',https_proxy:'http://127.0.0.1:9',NO_PROXY:'.offline.test',no_proxy:'.offline.test'});delete process.env.NODE_USE_ENV_PROXY;
 t.after(()=>{for(const [k,v] of Object.entries(old))v===undefined?delete process.env[k]:process.env[k]=v;});
 const seen=[];function fake(u,opts,cb){seen.push({u,opts});const req=new EventEmitter();req.setTimeout=()=>req;req.destroy=()=>{};req.end=body=>{seen.at(-1).body=body;};queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=200;res.headers={'content-type':'application/json'};res.destroy=()=>{};cb(res);res.emit('data',Buffer.from('{}'));res.emit('end');});return req;}
 t.mock.method(https,'get',fake);t.mock.method(https,'request',fake);
 const info=require('../plugin/node/information.cjs');await info.transport('https://www.cninfo.com.cn/new/data/szse_stock.json');await info.transport('https://www.cninfo.com.cn/new/hisAnnouncement/query',{pageNum:'1'});
 const date=new Date(Date.now()+28800000).toISOString().slice(0,10);await require('../plugin/node/regulatory.cjs').page({symbol:'sh600900',from:date,to:date,page:1});
 assert.equal(seen.length,3);for(const r of seen){assert.equal(r.opts.agent.options.proxyEnv.https_proxy,'http://127.0.0.1:9');assert.equal(r.opts.agent.options.proxyEnv.no_proxy,'.offline.test');assert.equal(r.opts.agent.options.rejectUnauthorized,true);assert.equal(r.opts.headers.Authorization,undefined);}assert.equal(seen[1].body,'pageNum=1');
});
test('real Node Agent honors HTTPS_PROXY and NO_PROXY using only a loopback proxy',async t=>{
 const http=require('node:http'),net=require('node:net');let tunnels=0,direct=0;
 const proxy=http.createServer();proxy.on('connect',(_req,socket)=>{tunnels++;socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');});
 const target=net.createServer(socket=>{direct++;socket.destroy();});
 await Promise.all([new Promise(r=>proxy.listen(0,'127.0.0.1',r)),new Promise(r=>target.listen(0,'127.0.0.1',r))]);
 t.after(()=>Promise.all([new Promise(r=>proxy.close(r)),new Promise(r=>target.close(r))]));
 const url='https://127.0.0.1:'+target.address().port+'/',proxyUrl='http://127.0.0.1:'+proxy.address().port;
 await assert.rejects(N.createTransport({env:{HTTPS_PROXY:proxyUrl}})(url,{timeoutMs:1000}));assert.equal(tunnels,1);assert.equal(direct,0);
 await assert.rejects(N.createTransport({env:{HTTPS_PROXY:proxyUrl,NO_PROXY:'127.0.0.1'}})(url,{timeoutMs:1000}));assert.equal(tunnels,1);assert.equal(direct,1);
});
