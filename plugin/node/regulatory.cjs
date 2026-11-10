'use strict';
const network=require('./network.cjs'),crypto=require('node:crypto'),R=require('../regulatory.js');
// A fixed public GET, no credentials, redirects or browser execution.
async function page(params){
 const s=R.scope(params,Date.now()),url=R.urlFor(s,params.page);
 const res=await network.request(url,{headers:{'User-Agent':'Mozilla/5.0 Cindy-AShare/0.15','Accept':'application/json,text/javascript,*/*','Referer':'https://www.sse.com.cn/'},timeoutMs:10000,maxBytes:262144,headersOnlyOnError:true,limitMessage:'监管响应超过256KiB。'});
 if(res.statusCode!==200)return {ok:true,status:res.statusCode,headers:{},body:'',url,redirected:res.statusCode>=300&&res.statusCode<400,transport:'node:https-no-redirect'};
 const raw=res.body;return {ok:true,status:200,url,headers:{'content-type':res.headers['content-type']||''},body:raw.toString('utf8'),rawSha256:crypto.createHash('sha256').update(raw).digest('hex'),transport:'node:https-no-redirect'};
}
module.exports={page};
