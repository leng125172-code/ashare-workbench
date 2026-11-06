import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const OWNER='.ashare-dsh-owner.json';
const LOCK='.ashare-dsh-runtime.lock';
const fail=(code,message)=>Object.assign(new Error(message),{code});
export async function atomicWrite(file,content){
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const temp=file+'.tmp-'+randomUUID();let handle;
  try{handle=await fs.open(temp,'wx',0o600);await handle.writeFile(content);await handle.sync();await handle.close();handle=null;await fs.rename(temp,file);const dir=await fs.open(path.dirname(file),'r');try{await dir.sync();}finally{await dir.close();}}
  finally{await handle?.close();await fs.rm(temp,{force:true}).catch(()=>{});}
}
/** Dedicated plugin-owned storage. Never opens a Cindy Library or another profile's credentials. */
export async function createLibrary(root,{signal=()=>null}={}){
  if(typeof root!=='string'||!path.isAbsolute(root))throw fail('DSH_PATH_INVALID','DSH数据根必须是专用绝对路径，不能隐式写进项目工作目录。');
  root=path.resolve(root);await fs.mkdir(root,{recursive:true,mode:0o700});
  if(await fs.realpath(root)!==root)throw fail('DSH_STORAGE_SYMLINK','数据根不能是符号链接。');
  const existing=await fs.readdir(root);let owner;
  try{owner=JSON.parse(await fs.readFile(path.join(root,OWNER),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!owner&&existing.length)throw fail('DSH_STORAGE_NOT_OWNED','指定数据目录非空且没有本插件所有权标记；拒绝接管。');
  if(owner&&owner.owner!=='ashare-workbench-dsh')throw fail('DSH_STORAGE_NOT_OWNED','数据目录属于其他应用，拒绝读取。');
  if(!owner)await atomicWrite(path.join(root,OWNER),JSON.stringify({owner:'ashare-workbench-dsh',schema:1}));
  let lock;
  for(let attempt=0;attempt<2;attempt++){
    try{lock=await fs.open(path.join(root,LOCK),'wx',0o600);await lock.writeFile(JSON.stringify({pid:process.pid,instance:randomUUID()}));await lock.sync();break;}
    catch(e){if(e.code!=='EEXIST')throw e;let old,stat;try{stat=await fs.lstat(path.join(root,LOCK));old=JSON.parse(await fs.readFile(path.join(root,LOCK),'utf8'));}catch{throw fail('DSH_STORAGE_BUSY','现有实例锁不可核对，未接管或删除。');}
      if(attempt||stat.isSymbolicLink()||!Number.isSafeInteger(old.pid)||old.pid<=0)throw fail('DSH_STORAGE_BUSY','现有实例锁无效或已变化，未接管。');
      try{process.kill(old.pid,0);throw fail('DSH_STORAGE_BUSY','此数据目录已被活跃实例占用；不要启动第二个写入者。');}catch(probe){if(probe.code!=='ESRCH')throw probe;}
      const current=await fs.lstat(path.join(root,LOCK));if(current.ino!==stat.ino||current.mtimeMs!==stat.mtimeMs)throw fail('DSH_STORAGE_BUSY','实例锁发生变化，未接管。');await fs.unlink(path.join(root,LOCK));
    }
  }
  const databases=new Map();let closed=false;
  async function file(relative,{allowRoot=false}={}){
    if(typeof relative!=='string'||path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').some(p=>p==='..')||relative.split('/').some(p=>p===OWNER||p===LOCK))throw fail('DSH_PATH_INVALID','存储路径无效。');
    const target=path.resolve(root,relative);if((target===root&&!allowRoot)||!(target===root||target.startsWith(root+path.sep)))throw fail('DSH_PATH_INVALID','路径超出插件数据目录。');
    let current=root;for(const part of path.relative(root,target).split(path.sep).filter(Boolean)){current=path.join(current,part);try{if((await fs.lstat(current)).isSymbolicLink())throw fail('DSH_STORAGE_SYMLINK','数据路径包含符号链接，拒绝跟随。');}catch(e){if(e.code!=='ENOENT')throw e;}}
    return target;
  }
  async function entries(relative='',recursive=false){
    const dir=await file(relative,{allowRoot:true}),out=[];
    try{for(const e of await fs.readdir(dir,{withFileTypes:true})){if(e.name.startsWith('.ashare-dsh-'))continue;const rel=path.posix.join(relative,e.name),abs=await file(rel);const s=await fs.lstat(abs);if(s.isSymbolicLink())throw fail('DSH_STORAGE_SYMLINK','数据目录包含符号链接。');out.push({path:rel,kind:s.isDirectory()?'dir':'file',bytes:s.isDirectory()?0:s.size,mtime:s.mtimeMs});if(recursive&&s.isDirectory())out.push(...await entries(rel,true));}}catch(e){if(e.code!=='ENOENT')throw e;}return out;
  }
  async function request(r){
    if(closed)return {ok:false,errorCode:'DSH_STORAGE_CLOSED',message:'插件数据目录已关闭。'};
    try{
      signal()?.throwIfAborted();
      if(r.op==='open'||r.op==='status'){const files=(await entries('',true)).filter(x=>x.kind==='file'),disk=await fs.statfs(root);return {ok:true,state:'ready',usedBytes:files.reduce((n,x)=>n+x.bytes,0),fileCount:files.length,diskFreeBytes:disk.bavail*disk.bsize,location:'dsh-private-plugin-storage'};}
      if(r.op==='list'){const all=(await entries(r.path||'',r.recursive===true)).sort((a,b)=>a.path.localeCompare(b.path)),after=r.cursor?Buffer.from(r.cursor,'base64url').toString():'';const remaining=all.filter(x=>x.path>after),page=remaining.slice(0,Math.min(500,r.limit||100)),hasMore=remaining.length>page.length;return {ok:true,entries:page,hasMore,nextCursor:hasMore?Buffer.from(page.at(-1).path).toString('base64url'):null};}
      if(r.op==='db.open'){const abs=await file(r.dbPath);await fs.mkdir(path.dirname(abs),{recursive:true,mode:0o700});if(!databases.has(r.dbPath)){const db=new DatabaseSync(abs);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON');databases.set(r.dbPath,db);}return {ok:true,opened:true};}
      if(r.op.startsWith('db.')){const db=databases.get(r.dbPath);if(!db)throw fail('DB_NOT_OPEN','请先打开本插件数据库。');if(r.op==='db.check'){const rows=db.prepare('PRAGMA quick_check').all();return {ok:true,healthy:rows.length===1&&Object.values(rows[0])[0]==='ok',detail:String(Object.values(rows[0]||{})[0]||'')};}
        if(r.op==='db.exec'){const stmt=db.prepare(r.sql);if(stmt.columns().length)return {ok:true,rows:stmt.all(...(r.params||[]))};const out=stmt.run(...(r.params||[]));return {ok:true,changes:Number(out.changes),lastInsertRowid:Number(out.lastInsertRowid)};}
        if(r.op==='db.batch'){if(!Array.isArray(r.statements)||!r.statements.length||r.statements.length>200)throw fail('DB_PARAMS_INVALID','批量SQL数量无效。');db.exec('BEGIN IMMEDIATE');try{for(const s of r.statements)db.prepare(s.sql).run(...(s.params||[]));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return {ok:true,applied:r.statements.length};}
      }
      const abs=await file(r.path);
      if(r.op==='read')return {ok:true,content:await fs.readFile(abs,'utf8')};
      if(r.op==='write'){if(typeof r.content!=='string')throw fail('INVALID_CONTENT','存储内容须为文本。');await atomicWrite(abs,r.content);return {ok:true,bytes:Buffer.byteLength(r.content)};}
      if(r.op==='stat'){const s=await fs.stat(abs);return {ok:true,path:r.path,kind:s.isDirectory()?'dir':'file',bytes:s.size,mtime:s.mtimeMs};}
      if(r.op==='delete'){for(const [key,db]of databases){if(key===r.path||key.startsWith(r.path+'/')){db.close();databases.delete(key);}}const existed=await fs.stat(abs).then(()=>true,()=>false);await fs.rm(abs,{force:true,recursive:r.recursiveDelete===true});return {ok:true,existed};}
      throw fail('DSH_LIBRARY_UNSUPPORTED','当前适配器不支持存储操作：'+r.op);
    }catch(e){return {ok:false,errorCode:e.code==='ENOENT'?'NOT_FOUND':e.code||'DSH_STORAGE_ERROR',message:String(e.message||e)};}
  }
  return {root,request,resolve:file,async close(){if(closed)return;closed=true;for(const db of databases.values())db.close();databases.clear();await lock.close();await fs.rm(path.join(root,LOCK),{force:true});}};
}
