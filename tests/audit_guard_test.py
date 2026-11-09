import argparse, hashlib, importlib.util, json, os, pathlib, signal, subprocess, sys, tempfile, time, unittest
from unittest import mock
ROOT=pathlib.Path(__file__).resolve().parents[1]
GUARD=ROOT/'scripts/audit_guard.py'
SPEC=importlib.util.spec_from_file_location('audit_guard',GUARD)
MODULE=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(MODULE)
class GuardTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.base=pathlib.Path(self.tmp.name)
 def tearDown(self):self.tmp.cleanup()
 def script(self,name,body):
  p=self.base/name;p.write_text(body);return p
 def cmd(self,p,*opts):return [sys.executable,str(GUARD),'--memory-mib','128','--heap-mib','32','--seconds','6',*opts,str(p)]
 def run_guard(self,p,*opts):
  r=subprocess.run(self.cmd(p,*opts),capture_output=True,text=True,timeout=20)
  return r,json.loads(r.stdout or r.stderr)
 def alive(self,pid):
  try:
   s=pathlib.Path(f'/proc/{pid}/stat').read_text();return s[s.rfind(')')+2:].split()[0]!='Z'
  except FileNotFoundError:return False
 def test_healthy_and_direct_entry_rejection(self):
  p=self.script('ok.cjs',f"require({json.dumps(str(ROOT/'scripts/audit_guard_entry.cjs'))}); console.log('ok');")
  direct=subprocess.run(['node',str(p)],capture_output=True,text=True);self.assertEqual(direct.returncode,78)
  for _ in range(2):
   r,d=self.run_guard(p);self.assertEqual(r.returncode,0,d);self.assertTrue(d['limitsVerified']);self.assertIn('ok',d['stdoutTail']);self.assertEqual(d['limits']['memory.swap.max'],'0')
 def test_working_directory_and_core_limit_are_preserved(self):
  (self.base/'input.txt').write_text('relative-input-ok')
  p=self.script('relative.cjs',"const fs=require('node:fs');console.log(fs.readFileSync('input.txt','utf8'));const row=fs.readFileSync('/proc/self/limits','utf8').split('\\n').find(x=>x.startsWith('Max core file size'));if(!/^Max core file size\\s+0\\s+0\\s+bytes$/.test(row.trim()))throw Error('CORE_DUMP_LIMIT_NOT_ZERO');")
  r=subprocess.run(self.cmd(p),cwd=self.base,capture_output=True,text=True,timeout=20);d=json.loads(r.stdout or r.stderr)
  self.assertEqual(r.returncode,0,d);self.assertEqual(d['reason'],'COMPLETED');self.assertIn('relative-input-ok',d['stdoutTail'])
 def test_external_memory_and_descendants_are_capped(self):
  p=self.script('memory.cjs',"const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e',\"const a=[];setInterval(()=>a.push(Buffer.alloc(16*1024*1024,1)),5)\"],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},100);")
  r,d=self.run_guard(p);self.assertNotEqual(r.returncode,0,d);self.assertEqual(d['reason'],'MEMORY_LIMIT',d);self.assertTrue(d['limitsVerified']);self.assertGreater(int(d['metrics']['memory.peak']),0);self.assertLessEqual(int(d['metrics']['memory.peak']),160*1024*1024)
  pid=int(d['stdoutTail'].strip());time.sleep(.15);self.assertFalse(self.alive(pid))
 def test_timeout_cleans_descendants(self):
  p=self.script('timeout.cjs',"const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},100)'],{stdio:'ignore',detached:true});console.log(c.pid);setInterval(()=>{},100);")
  r,d=self.run_guard(p,'--seconds','1');self.assertNotEqual(r.returncode,0,d);self.assertEqual(d['reason'],'TIME_LIMIT');pid=int(d['stdoutTail'].strip());time.sleep(.15);self.assertFalse(self.alive(pid))
 def test_output_limit_and_reusable_lock(self):
  p=self.script('output.cjs',"setInterval(()=>process.stdout.write('x'.repeat(65536)),1);")
  for _ in range(2):
   r,d=self.run_guard(p,'--output-bytes','2048');self.assertNotEqual(r.returncode,0,d);self.assertEqual(d['reason'],'OUTPUT_LIMIT');self.assertLessEqual(len(d['stdoutTail']),8192)
 def test_same_script_mutex_and_signal_cleanup(self):
  p=self.script('mutex.cjs',"console.log('started');setInterval(()=>{},100);")
  first=subprocess.Popen(self.cmd(p),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  unit='cc-audit-'+hashlib.sha256(str(p.resolve()).encode()).hexdigest()[:24]+'.service'
  try:
   for _ in range(60):
    q=subprocess.run(['systemctl','--user','show',unit,'-p','ActiveState','--value'],capture_output=True,text=True)
    if q.stdout.strip()=='active':break
    time.sleep(.05)
   second,d=self.run_guard(p);self.assertNotEqual(second.returncode,0);self.assertIn(d['reason'],['AUDIT_ALREADY_RUNNING','AUDIT_UNIT_ALREADY_EXISTS'])
   first.send_signal(signal.SIGTERM);out,err=first.communicate(timeout=10);self.assertNotEqual(first.returncode,0);self.assertEqual(json.loads(out)['reason'],'CANCELLED')
   q=subprocess.run(['systemctl','--user','show',unit,'-p','ActiveState','--value'],capture_output=True,text=True);self.assertNotIn(q.stdout.strip(),['active','activating','deactivating'])
  finally:
   if first.poll() is None:first.kill();first.wait()
 def test_unavailable_manager_fails_closed(self):
  p=self.script('never.cjs',"require('node:fs').writeFileSync('MUST_NOT_RUN','bad')")
  env={**os.environ,'DBUS_SESSION_BUS_ADDRESS':'unix:path=/nonexistent-cc-guard-bus'}
  r=subprocess.run(self.cmd(p),cwd=self.base,env=env,capture_output=True,text=True,timeout=10);self.assertNotEqual(r.returncode,0);self.assertFalse((self.base/'MUST_NOT_RUN').exists())
 def test_launcher_sigkill_still_has_kernel_deadline(self):
  marker=self.base/'pid'
  p=self.script('sigkill.cjs',f"require('node:fs').writeFileSync({json.dumps(str(marker))},String(process.pid));setInterval(()=>{{}},100);")
  first=subprocess.Popen(self.cmd(p,'--seconds','2'),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  unit='cc-audit-'+hashlib.sha256(str(p.resolve()).encode()).hexdigest()[:24]+'.service'
  try:
   for _ in range(80):
    if marker.exists():break
    time.sleep(.025)
   self.assertTrue(marker.exists());pid=int(marker.read_text());first.kill();first.wait(timeout=3)
   second,d=self.run_guard(p);self.assertNotEqual(second.returncode,0);self.assertEqual(d['reason'],'AUDIT_UNIT_ALREADY_EXISTS')
   for _ in range(80):
    if not self.alive(pid):break
    time.sleep(.05)
   self.assertFalse(self.alive(pid),'systemd runtime deadline must survive launcher SIGKILL')
  finally:
   if first.poll() is None:first.kill();first.wait()
   subprocess.run(['systemctl','--user','stop',unit],capture_output=True)
   subprocess.run(['systemctl','--user','reset-failed',unit],capture_output=True)
 def test_rejects_existing_unit_without_stopping_it(self):
  p=self.script('foreign.cjs',"console.log('MUST_NOT_RUN');")
  unit='cc-audit-'+hashlib.sha256(str(p.resolve()).encode()).hexdigest()[:24]+'.service'
  subprocess.run(['systemd-run','--user','--quiet','--unit='+unit,'--property=RuntimeMaxSec=5','sleep','5'],check=True,capture_output=True)
  try:
   r,d=self.run_guard(p);self.assertNotEqual(r.returncode,0);self.assertEqual(d['reason'],'AUDIT_UNIT_ALREADY_EXISTS')
   q=subprocess.run(['systemctl','--user','show',unit,'-p','ActiveState','--value'],capture_output=True,text=True);self.assertEqual(q.stdout.strip(),'active')
  finally:
   subprocess.run(['systemctl','--user','stop',unit],capture_output=True)
   subprocess.run(['systemctl','--user','reset-failed',unit],capture_output=True)
 def test_worker_failure_before_ready_is_cleaned(self):
  p=self.script('not-executed.cjs',"throw Error('must not execute');")
  unit=MODULE.unit_for(p.resolve());runtime=self.base/'runtime';runtime.mkdir()
  a=argparse.Namespace(memory_mib=128,heap_mib=32,seconds=2,output_bytes=2048,args=[])
  original=subprocess.Popen
  def failed_worker(cmd,**kw):
   # Keep real manager settings/ownership; fail before the ready handshake.
   return original(cmd[:cmd.index(sys.executable)]+['/bin/false'],**kw)
  with mock.patch.object(MODULE.subprocess,'Popen',side_effect=failed_worker):
   # ctl() uses Popen too; only intercept systemd-run.
   def route(cmd,**kw):return failed_worker(cmd,**kw) if cmd[0]=='systemd-run' else original(cmd,**kw)
   with mock.patch.object(MODULE.subprocess,'Popen',side_effect=route):
    for _ in range(2):
     self.assertEqual(MODULE.run_unit(a,p,'/usr/bin/node',unit,runtime),1)
  q=subprocess.run(['systemctl','--user','show',unit,'-p','LoadState','--value'],capture_output=True,text=True);self.assertEqual(q.stdout.strip(),'not-found')
 def test_corrupt_handshake_and_manager_failure_still_cleanup(self):
  p=self.script('fake.cjs','');runtime=self.base/'runtime';runtime.mkdir()
  a=argparse.Namespace(memory_mib=128,heap_mib=32,seconds=2,output_bytes=2048,args=[])
  original=subprocess.Popen;children=[]
  def fake(cmd,**kw):
   ready=cmd[cmd.index('--ready')+1]
   child=original([sys.executable,'-c',"import pathlib,time;pathlib.Path("+repr(ready)+").write_text('{bad');print('started',flush=True);time.sleep(10)"],**kw);children.append(child);return child
  previous=signal.getsignal(signal.SIGTERM)
  with mock.patch.object(MODULE.subprocess,'Popen',side_effect=fake),mock.patch.object(MODULE,'ctl',side_effect=subprocess.TimeoutExpired('fake',.01)):
   with self.assertRaises(json.JSONDecodeError):MODULE.run_unit(a,p,'/usr/bin/node',MODULE.unit_for(p),runtime)
  self.assertIsNotNone(children[0].poll());self.assertTrue(children[0].stdout.closed);self.assertTrue(children[0].stderr.closed);self.assertEqual(signal.getsignal(signal.SIGTERM),previous)
 def test_incomplete_handshake_does_not_poison_ownership(self):
  p=self.script('incomplete.cjs','');runtime=self.base/'runtime';runtime.mkdir()
  a=argparse.Namespace(memory_mib=128,heap_mib=32,seconds=2,output_bytes=2048,args=[])
  original=subprocess.Popen;children=[];manager_calls=[]
  def fake(cmd,**kw):
   ready=cmd[cmd.index('--ready')+1];nonce=cmd[cmd.index('--nonce')+1]
   child=original([sys.executable,'-c',"import pathlib,time;pathlib.Path("+repr(ready)+").write_text("+repr(json.dumps({'nonce':nonce}))+ ");print('started',flush=True);time.sleep(10)"],**kw);children.append(child);return child
  def manager(*args):
   manager_calls.append(args)
   return subprocess.CompletedProcess(args,0,'InvocationID='+'a'*32+'\nDescription=foreign\n','')
  with mock.patch.object(MODULE.subprocess,'Popen',side_effect=fake),mock.patch.object(MODULE,'ctl',side_effect=manager):
   with self.assertRaisesRegex(RuntimeError,'GUARD_HANDSHAKE_INVALID'):MODULE.run_unit(a,p,'/usr/bin/node',MODULE.unit_for(p),runtime)
  self.assertIsNotNone(children[0].poll());self.assertGreaterEqual(len(manager_calls),2);self.assertFalse(any(c[0] in ['stop','reset-failed'] for c in manager_calls))
if __name__=='__main__':unittest.main(verbosity=2)
