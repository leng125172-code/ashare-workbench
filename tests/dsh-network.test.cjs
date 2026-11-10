'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
test('actual DSH subprocess inherits proxy policy, excludes unrelated secrets and exits cleanly',async t=>{
 const {DataWorker}=await import('../dsh/runtime.mjs'),root=await fs.mkdtemp(path.join(os.tmpdir(),'ashare-network-worker-'));
 await fs.mkdir(path.join(root,'node'));
 await fs.writeFile(path.join(root,'node/worker.cjs'),`require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);process.stdout.write(JSON.stringify({id:r.id,result:{proxy:process.env.HTTPS_PROXY,noProxy:process.env.NO_PROXY,direct:process.env.NODE_USE_ENV_PROXY,unrelated:process.env.ASHARE_OFFLINE_TEST_SECRET,options:process.env.NODE_OPTIONS}})+'\\n');});`);
 const values={HTTPS_PROXY:'http://fixture:fake@127.0.0.1:9',NO_PROXY:'.offline.test',NODE_USE_ENV_PROXY:'0',ASHARE_OFFLINE_TEST_SECRET:'must-not-cross'};
 const previous=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);
 const worker=new DataWorker({directory:root});
 t.after(async()=>{await worker.stop();for(const [k,v] of Object.entries(previous))v===undefined?delete process.env[k]:process.env[k]=v;await fs.rm(root,{recursive:true,force:true});});
 const result=await worker.request('echo',{});assert.deepEqual(result,{proxy:values.HTTPS_PROXY,noProxy:values.NO_PROXY,direct:'0'});const pid=worker.child.pid;await worker.stop();assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});
test('DSH host source fetch uses the same bounded per-request transport without following redirects',async t=>{
 const {createRuntime}=await import('../dsh/runtime.mjs'),https=require('node:https'),root=await fs.mkdtemp(path.join(os.tmpdir(),'ashare-network-host-'));let destroyed=0,options;
 t.mock.method(https,'get',(_u,opts,cb)=>{options=opts;const req=new EventEmitter();req.setTimeout=()=>req;req.destroy=()=>{destroyed++;};queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=302;res.headers={location:'https://never-follow.offline.test'};res.destroy=()=>{};cb(res);res.emit('data',Buffer.from('redirect'));res.emit('end');});return req;});
 const runtime=await createRuntime({dataDir:path.join(root,'data'),rpc:async()=>{throw Error('no worker');}});t.after(async()=>{await runtime.close();await fs.rm(root,{recursive:true,force:true});});
 const result=await runtime.context.cindy.fetch({url:'https://source.offline.test/',timeoutMs:500});assert.equal(result.ok,false);assert.equal(result.status,302);assert.equal(result.body,'');assert.equal(destroyed,1);assert.equal(options.agent.options.rejectUnauthorized,true);
});
