(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AShareStorage=api;})(globalThis,function(){
 'use strict';
 const FORMAT='ashare-json-chunks/1',CHUNK_CHARS=256*1024,LOGICAL_CHUNK=128*1024,THRESHOLD=512*1024,MAX_LOGICAL=256*1024*1024,MAX_INDEX=512*1024;
 const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
 const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
 const bytes=s=>enc.encode(s).byteLength;
 async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?enc.encode(value):value))].map(x=>x.toString(16).padStart(2,'0')).join('');}
 function base64(data){let out='';for(let i=0;i<data.length;i+=32768)out+=String.fromCharCode(...data.subarray(i,i+32768));return btoa(out);}
 function unbase64(s){if(typeof s!=='string'||s.length>CHUNK_CHARS||s.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))fail('STORAGE_INTEGRITY','分片编码不合法。');return Uint8Array.from(atob(s),x=>x.charCodeAt(0));}
 function envelope(x){return x?.storageFormat===FORMAT;}
 async function transform(data,compress,limit){
  const Constructor=compress?globalThis.CompressionStream:globalThis.DecompressionStream;
  if(typeof Constructor!=='function')fail('STORAGE_CODEC_UNAVAILABLE','当前运行环境不能读取gzip资料；保留原记录，不降级为空库。');
  const input=new ReadableStream({start(c){c.enqueue(data);c.close();}}),reader=input.pipeThrough(new Constructor('gzip')).getReader(),parts=[];let size=0;
  try{for(;;){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>limit){await reader.cancel();fail('STORAGE_LOGICAL_LIMIT','解码资料超过声明大小或安全上限。');}parts.push(x.value);}}
  finally{reader.releaseLock();}
  const result=new Uint8Array(size);let at=0;for(const p of parts){result.set(p,at);at+=p.length;}return result;
 }
 async function immutable(io,path,content){
  const old=await io.read(path);if(old.ok){if(old.content!==content)fail('STORAGE_INTEGRITY','内容寻址文件与预期不一致，未覆盖：'+path);return false;}
  if(old.errorCode!=='NOT_FOUND')fail('STORAGE_UNAVAILABLE','无法核对存储文件：'+path+'；Host='+JSON.stringify({errorCode:old.errorCode,code:old.code,error:old.error,message:old.message}).slice(0,700));
  const saved=await io.write(path,content);if(!saved.ok)fail(saved.errorCode||'STORAGE_WRITE_FAILED',saved.message||'分片写入失败，旧索引仍保留。');
  const check=await io.read(path);if(!check.ok||check.content!==content)fail('STORAGE_VERIFY_FAILED','分片或备份回读核对失败，未提交新索引。');return true;
 }
 async function encodedPiece(logical){let codec='utf8',payload=logical;if(typeof globalThis.CompressionStream==='function'&&typeof globalThis.DecompressionStream==='function'){const compressed=await transform(logical,true,LOGICAL_CHUNK+1024);if(compressed.length<logical.length){codec='gzip';payload=compressed;}}const text=base64(payload),sha256=await hash(text),path='storage/chunks/'+sha256.slice(0,32)+'/'+sha256.slice(32)+'.b64';if(text.length>CHUNK_CHARS)fail('STORAGE_CHUNK_LIMIT','单片编码超过安全上限。');return {text,ref:{path,sha256,characters:text.length,codec,logicalBytes:logical.length,logicalSha256:await hash(logical),payloadBytes:payload.length}};}
 async function pack(content,io,{force=false,maxIndexBytes=MAX_INDEX,indexReserveBytes=0}={}){
  if(!Number.isSafeInteger(maxIndexBytes)||maxIndexBytes<128||maxIndexBytes>MAX_INDEX||!Number.isSafeInteger(indexReserveBytes)||indexReserveBytes<0||indexReserveBytes>=maxIndexBytes)fail('STORAGE_INDEX_LIMIT','索引预算超出安全界限，未写分片。');
  const data=enc.encode(content);if(data.length>MAX_LOGICAL)fail('STORAGE_LOGICAL_LIMIT','单条逻辑资料超过256MiB，需使用独立仓储分页；未截断记录。');
  if(!force&&data.length<=THRESHOLD)return {content,packed:false};if(!data.length)fail('STORAGE_INTEGRITY','空资料不能生成分片索引。');
  const chunks=[],hot=data.length<=THRESHOLD?[]:null;let chunksWritten=0,payloadBytes=0;
  // Plan the complete index before touching storage. Large payloads use a second
  // bounded pass instead of retaining all base64 strings in memory.
  for(let at=0;at<data.length;at+=LOGICAL_CHUNK){const part=await encodedPiece(data.subarray(at,at+LOGICAL_CHUNK));chunks.push(part.ref);payloadBytes+=part.ref.payloadBytes;if(hot)hot.push(part.text);}
  const manifest={schema:2,storageFormat:FORMAT,codec:'per-chunk',logicalBytes:data.length,sha256:await hash(data),payloadBytes,chunks},wire=JSON.stringify(manifest);
  if(bytes(wire)+indexReserveBytes>maxIndexBytes)fail('STORAGE_INDEX_LIMIT','分片索引超过安全界限；未写任何新片，请改用独立仓储分页。');
  for(let i=0;i<chunks.length;i++){const ref=chunks[i],text=hot?hot[i]:(await encodedPiece(data.subarray(i*LOGICAL_CHUNK,(i+1)*LOGICAL_CHUNK))).text;if(await hash(text)!==ref.sha256)fail('STORAGE_INTEGRITY','分片编码与预检不一致，未提交索引。');if(await immutable(io,ref.path,text))chunksWritten++;}
  return {content:wire,packed:true,manifest,chunksWritten};
 }

 async function unpack(content,io){
  let m;try{m=JSON.parse(content);}catch{fail('STORAGE_INTEGRITY','资料索引JSON损坏，未覆盖原文件。');}
  if(!envelope(m))return content;
  if(m.schema!==2||m.codec!=='per-chunk'||!Number.isSafeInteger(m.logicalBytes)||m.logicalBytes<1||m.logicalBytes>MAX_LOGICAL||!Number.isSafeInteger(m.payloadBytes)||m.payloadBytes<0||m.payloadBytes>MAX_LOGICAL||!Array.isArray(m.chunks)||!m.chunks.length||m.chunks.length>2048||!/^[a-f0-9]{64}$/.test(m.sha256))fail('STORAGE_INTEGRITY','分片索引不受支持或声明不合法。');
  const parts=[];let total=0,payloadTotal=0;
  for(const ref of m.chunks){
   if(!ref||!/^[a-f0-9]{64}$/.test(ref.sha256)||ref.path!=='storage/chunks/'+ref.sha256.slice(0,32)+'/'+ref.sha256.slice(32)+'.b64'||!Number.isInteger(ref.characters)||ref.characters<4||ref.characters>CHUNK_CHARS||!['gzip','utf8'].includes(ref.codec)||!Number.isInteger(ref.logicalBytes)||ref.logicalBytes<1||ref.logicalBytes>LOGICAL_CHUNK||!Number.isInteger(ref.payloadBytes)||ref.payloadBytes<1||ref.payloadBytes>LOGICAL_CHUNK||!/^[a-f0-9]{64}$/.test(ref.logicalSha256))fail('STORAGE_INTEGRITY','分片地址/大小/编码不合法。');
   const got=await io.read(ref.path);if(!got.ok)fail('STORAGE_UNAVAILABLE','资料分片缺失或不可读；未创建空库：'+ref.path);
   if(got.content.length!==ref.characters||await hash(got.content)!==ref.sha256)fail('STORAGE_INTEGRITY','资料分片摘要不符，未覆盖原记录。');const payload=unbase64(got.content);if(payload.length!==ref.payloadBytes)fail('STORAGE_INTEGRITY','分片压缩字节数不符。');
   const logical=ref.codec==='gzip'?await transform(payload,false,ref.logicalBytes):payload;if(logical.length!==ref.logicalBytes||await hash(logical)!==ref.logicalSha256)fail('STORAGE_INTEGRITY','分片解码摘要或长度不符。');
   total+=logical.length;payloadTotal+=payload.length;if(total>m.logicalBytes||payloadTotal>m.payloadBytes)fail('STORAGE_INTEGRITY','分片累计长度超过声明。');parts.push(logical);
  }
  if(total!==m.logicalBytes||payloadTotal!==m.payloadBytes)fail('STORAGE_INTEGRITY','分片总长度不符。');const data=new Uint8Array(total);let at=0;for(const part of parts){data.set(part,at);at+=part.length;}
  if(await hash(data)!==m.sha256)fail('STORAGE_INTEGRITY','逻辑资料摘要不符。');
  try{return dec.decode(data);}catch{fail('STORAGE_INTEGRITY','逻辑资料不是有效UTF8，未替换或丢弃字段。');}
 }

 function describe(raw){let m;try{m=JSON.parse(raw);}catch{return {layout:'invalid',indexBytes:bytes(raw)};}return envelope(m)?{layout:'chunked',format:FORMAT,indexBytes:bytes(raw),logicalBytes:m.logicalBytes,payloadBytes:m.payloadBytes,codec:m.codec,chunkCount:m.chunks.length,logicalSha256:m.sha256,legacyBackup:m.legacyBackup||null}:{layout:'legacy_inline',indexBytes:bytes(raw),logicalBytes:bytes(raw),codec:'inline',chunkCount:0};}
 return {FORMAT,CHUNK_CHARS,THRESHOLD,MAX_LOGICAL,MAX_INDEX,LOGICAL_CHUNK,hash,bytes,envelope,pack,unpack,immutable,describe};
});
