'use strict';
// An accidental direct invocation must fail before loading research data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const script=fs.realpathSync(process.argv[1]);
const unit='cc-audit-'+crypto.createHash('sha256').update(script).digest('hex').slice(0,24)+'.service';
const group=fs.readFileSync('/proc/self/cgroup','utf8').split('\n').find(x=>x.startsWith('0::'))?.slice(3);
let verified=false;
try{
 const base=path.join('/sys/fs/cgroup',group||'');
 const read=name=>fs.readFileSync(path.join(base,name),'utf8').trim();
 const heap=process.execArgv.find(x=>/^--max-old-space-size=\d+$/.test(x));
 verified=process.env.CC_AUDIT_GUARDED==='1'&&path.basename(base)===unit&&
  /^\d+$/.test(read('memory.max'))&&Number(read('memory.max'))<=512*1024*1024&&
  read('memory.swap.max')==='0'&&read('memory.oom.group')==='1'&&
  Number(read('pids.max'))<=32&&heap&&Number(heap.split('=')[1])<=128;
}catch{}
if(!verified){console.error('AUDIT_GUARD_REQUIRED: 请通过 scripts/audit_guard.py 启动核验。');process.exit(78);}
