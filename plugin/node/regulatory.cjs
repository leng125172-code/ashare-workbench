'use strict';
const https=require('node:https'),crypto=require('node:crypto'),R=require('../regulatory.js');
// A fixed public GET, no credentials, redirects or browser execution.
function page(params){
 const s=R.scope(params,Date.now()),url=R.urlFor(s,params.page);
 return new Promise((resolve,reject)=>{
  const req=https.get(url,{headers:{'User-Agent':'Mozilla/5.0 Cindy-AShare/0.15','Accept':'application/json,text/javascript,*/*','Referer':'https://www.sse.com.cn/'}},res=>{
   if(res.statusCode!==200){res.resume();resolve({ok:true,status:res.statusCode,headers:{},body:'',url,redirected:res.statusCode>=300&&res.statusCode<400,transport:'node:https-no-redirect'});return;}
   const parts=[];let bytes=0;
   res.on('data',b=>{bytes+=b.length;if(bytes>262144)req.destroy(new Error('监管响应超过256KiB。'));else parts.push(b);});res.on('error',reject);
   res.on('end',()=>{const raw=Buffer.concat(parts);resolve({ok:true,status:200,url,headers:{'content-type':res.headers['content-type']||''},body:raw.toString('utf8'),rawSha256:crypto.createHash('sha256').update(raw).digest('hex'),transport:'node:https-no-redirect'});});
  });req.setTimeout(10000,()=>req.destroy(new Error('官方监管接口连接超时。')));req.on('error',reject);
 });
}
module.exports={page};
