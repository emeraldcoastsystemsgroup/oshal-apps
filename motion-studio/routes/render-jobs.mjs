/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Keep real native renders in original-person private stages and publish only complete verified outputs.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Report bounded continuation stages and settle early source failures only under the original current authority.
 */
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {constants} from 'node:fs';
import {open,mkdir,lstat,realpath,rename,unlink,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {MotionError,LIMITS} from './project-store.mjs';
import {access} from './authorization.mjs';
import {framePlan,renderExportTo,RENDER_LIMITS} from './render-export.mjs';
import {stringifyNative} from '../tools/native-json.mjs';
export const JOB_LIMITS=Object.freeze({bytes:RENDER_LIMITS.outputBytes,chunkBytes:8192,sessions:2,receipts:16,lifetimeMs:3600000});
const hash=value=>createHash('sha256').update(value).digest('hex'),fail=(status,code)=>{throw new MotionError(status,code);};
export const jobId=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)?value:fail(400,'motion_invalid_render_id');
const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const require=createRequire(import.meta.url);
export function renderContinuationDiagnostic(ctx,stage,error){
 const code=typeof error?.code==='string'&&/^[a-z][a-z0-9_]{1,100}$/.test(error.code)?error.code:'motion_render_continuation_failed';
 if(!['entered','bound','authority','namespace','source','output','completed','failed'].includes(stage))stage='unknown';
 try{const logger=ctx?.logger??require('@/shared/logger').logger;logger.info({module:'motion-render-continuation',stage,...(error?{code}:{})},'Motion render continuation');}catch{}
 return code;
}

function regular(stat,max=JOB_LIMITS.bytes){if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(stat.mode&0o077)||stat.size>max)fail(503,'motion_render_unsafe_file');return stat;}
async function directory(path){const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)||await realpath(path)!==path)fail(503,'motion_render_unsafe_directory');}
async function syncDir(path){const f=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await f.sync();}finally{await f.close();}}
function metadata(v,id){
 const keys=['id','state','project','revision','requestKey','options','signature','documentSha256','compId','frames','frameRate','startTick','endTick','maxSide','created','expires','runUntil','producedBytes','completedFrames','output','error','chunkHashes','title'];
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k))||v.id!==id||jobId(v.id)!==id||!['queued','rendering','ready','failed','cancelled'].includes(v.state)||!digest(v.documentSha256)||!digest(v.signature)||jobId(v.project)!==v.project||jobId(v.requestKey)!==v.requestKey||!Number.isSafeInteger(v.revision)||v.revision<1||v.revision>LIMITS.revisions||!Number.isSafeInteger(v.created)||v.expires-v.created!==JOB_LIMITS.lifetimeMs||v.runUntil!==v.created+RENDER_LIMITS.deadlineMs||!Number.isSafeInteger(v.producedBytes)||v.producedBytes<0||v.producedBytes>JOB_LIMITS.bytes||!Number.isSafeInteger(v.completedFrames)||v.completedFrames<0||v.completedFrames>v.frames||!['mp4','png-sequence'].includes(v.options?.format))fail(503,'motion_render_invalid_metadata');
 if(typeof v.title!=='string'||!v.title.trim()||v.title.length>LIMITS.title||typeof v.compId!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(v.compId)||BigInt(v.compId)>18446744073709551615n||!Number.isSafeInteger(v.frames)||v.frames<1||![v.frameRate?.num,v.frameRate?.den].every(n=>Number.isSafeInteger(n)&&n>0&&n<=4294967295)||!Number.isSafeInteger(v.maxSide)||v.maxSide<1||v.maxSide>4096||![v.startTick,v.endTick].every(t=>typeof t==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(t)&&BigInt(t)<=9223372036854775807n)||BigInt(v.startTick)>=BigInt(v.endTick)||Object.keys(v.options).some(k=>!['format','compId','startTick','endTick','maxSide'].includes(k))||v.signature!==hash(JSON.stringify([v.project,v.revision,v.options])))fail(503,'motion_render_invalid_metadata');
 if(v.state==='ready'&&(!digest(v.output?.sha256)||!Number.isSafeInteger(v.output?.bytes)||v.output.bytes<1||v.output.bytes>JOB_LIMITS.bytes||v.output.project!==v.project||v.output.revision!==v.revision||v.output.documentSha256!==v.documentSha256||v.output.compId!==v.compId||v.output.format!==v.options.format))fail(503,'motion_render_invalid_metadata');
 if(v.state==='ready'&&(!Array.isArray(v.chunkHashes)||v.chunkHashes.length!==Math.ceil(v.output.bytes/65536)||!v.chunkHashes.every(digest)))fail(503,'motion_render_invalid_metadata');
 if(v.state!=='ready'&&(v.output!==undefined||v.chunkHashes!==undefined))fail(503,'motion_render_invalid_metadata');return v;
}
export function jobReceipt(v){return{id:v.id,state:v.state,project:v.project,title:v.title,revision:v.revision,compId:v.compId,documentSha256:v.documentSha256,format:v.options.format,frames:v.frames,frameRate:v.frameRate,startTick:v.startTick,endTick:v.endTick,maxSide:v.maxSide,completedFrames:v.completedFrames,producedBytes:v.producedBytes,createdAt:new Date(v.created).toISOString(),expiresAt:new Date(v.expires).toISOString(),...(v.output??{}),...(v.error?{error:v.error}:{}),...(v.state==='ready'?{contentUrl:'/api/motion-studio/app?renderJob='+v.id}:{})};}
/** A service is bound freshly inside each HTTP call or signed engine continuation. It never retains
 * a closed request. Locks protect metadata briefly; rendering leaves polling and cancellation free. */
export class MotionRenderJobs{
 #ctx;#root;#store;#original;#queued;
 constructor(ctx,root,store){if(!ctx?.intent||typeof root!=='string'||resolve(root)!==root||!root.startsWith('/'))fail(503,'motion_render_storage_unavailable');this.#ctx=ctx;this.#root=root;this.#store=store;}
 async #authority(){await access(this.#ctx,'export');await this.#store.assertOriginalContext(this.#ctx);const p=(await this.#ctx.intent('auth.caller',{}))?.principal,a=this.#ctx.authorization.currentActor();if(!p||p.state!=='active'||!['id','tenant','issuer','subject'].every(k=>typeof p[k]==='string'&&p[k].length>0&&p[k].length<=2048)||p.issuer!==a.issuer||p.subject!==a.sub)fail(401,'motion_render_verified_principal_required');const original=JSON.stringify(['motion-studio',p.tenant,p.id,p.issuer,p.subject,'render-jobs']);if(this.#original&&this.#original!==original)fail(401,'motion_identity_changed');this.#original=original;await access(this.#ctx,'export');return hash(original);}
 async #namespace(){const key=await this.#authority();await directory(this.#root);const parent=join(this.#root,'.motion-render-jobs');await mkdir(parent,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});await directory(parent);const path=join(parent,key);await mkdir(path,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});await directory(path);return path;}
 async #local(path){
  const actor=this.#ctx.authorization.currentActor(),original=JSON.parse(this.#original);
  if(!actor?.isActive||actor.issuer!==original[3]||actor.sub!==original[4])fail(401,'motion_identity_changed');
  await directory(this.#root);await directory(join(this.#root,'.motion-render-jobs'));await directory(path);
 }
 async #locked(work){const path=await this.#namespace(),result=await this.#lease(path,work);await this.#authority();return result;}
 async #lease(path,work){
  await this.#local(path);const file=join(path,'.lock.sqlite');
  try{const f=await open(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);await f.close();await syncDir(path);}catch(e){if(e.code!=='EEXIST')throw e;}
  const initial=regular(await lstat(file),1048576);await lstat(file+'-journal').then(s=>regular(s,1048576)).catch(e=>{if(e.code!=='ENOENT')throw e;});
  const db=new DatabaseSync(file,{allowExtension:false,timeout:0});
  try{db.exec('PRAGMA trusted_schema=OFF; BEGIN EXCLUSIVE');}catch(e){db.close();if(/locked/i.test(e.message))fail(503,'motion_render_busy');throw e;}
  const check=async()=>{await this.#local(path);const current=regular(await lstat(file),1048576);if(initial.ino!==current.ino||initial.dev!==current.dev)fail(503,'motion_render_lock_changed');};
  let result;try{await check();result=await work(path,check);}finally{try{db.exec('ROLLBACK');}finally{db.close();}}
  // Never hold an OS metadata lease while waiting for a remote authority/source callback.
  return result;
 }
 async #producer(work,until){
  const stop=Math.min(until??Date.now()+5000,Date.now()+5000);
  for(;;){if(Date.now()>=stop)fail(503,'motion_render_busy');try{return await this.#locked(work);}catch(e){if(e.code!=='motion_render_busy')throw e;await new Promise(done=>setTimeout(done,50));}}
 }
 async #load(path,id){jobId(id);const file=join(path,id+'.json'),f=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW).catch(e=>{if(e.code==='ENOENT')fail(404,'motion_render_not_found');throw e;});try{const initial=regular(await f.stat(),1048576),bytes=await f.readFile(),held=regular(await f.stat(),1048576),current=regular(await lstat(file),1048576);if(bytes.length!==initial.size||held.size!==initial.size||held.ino!==current.ino||held.dev!==current.dev)fail(503,'motion_render_file_changed');let v;try{v=metadata(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),id);}catch{fail(503,'motion_render_invalid_metadata');}if(v.expires<=Date.now())fail(410,'motion_render_expired');return v;}finally{await f.close();}}
 async #publish(path,v,check){metadata(v,v.id);const bytes=Buffer.from(JSON.stringify(v));if(bytes.length>1048576)fail(503,'motion_render_invalid_metadata');const temp=join(path,randomUUID()+'.tmp'),file=join(path,v.id+'.json'),f=await open(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);let renamed=false;try{await f.writeFile(bytes);await f.sync();await f.close();await check();await lstat(file).then(s=>regular(s,1048576)).catch(e=>{if(e.code!=='ENOENT')throw e;});await rename(temp,file);renamed=true;await syncDir(path);await check();}finally{await f.close().catch(()=>{});if(!renamed)await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
 async #source(v){await this.#store.reference(v.project,v.revision);await this.#authority();}
 async begin(input){this.#queued=undefined;const allowed=['project','revision','requestKey','format','compId','startTick','endTick','maxSide'];if(!input||Object.keys(input).some(k=>!allowed.includes(k)))fail(400,'motion_invalid_render_input');const projectId=jobId(input.project),requestKey=jobId(input.requestKey);if(!Number.isSafeInteger(input.revision)||input.revision<1||input.revision>LIMITS.revisions)fail(400,'motion_invalid_revision');const{project:_p,revision:_r,requestKey:_k,...options}=input;const project=await this.#store.export(projectId,input.revision),plan=framePlan(project.document,options),documentSha256=hash(stringifyNative(project.document)),signature=hash(JSON.stringify([projectId,input.revision,options]));let result;try{result=await this.#locked(async(path,check)=>{let count=0,receipts=0;const terminal=[];for(const name of await readdir(path)){if(!/^[0-9a-f-]{36}\.json$/.test(name))continue;let old;try{old=await this.#load(path,name.slice(0,-5));}catch(e){if(e.code==='motion_render_expired'){await unlink(join(path,name));await unlink(join(path,name.slice(0,-5)+'.data')).catch(e=>{if(e.code!=='ENOENT')throw e;});continue;}throw e;}if(old.requestKey===requestKey){if(old.signature!==signature)fail(409,'motion_render_replay_conflict');return{render:jobReceipt(old),created:false};}receipts++;if(['queued','rendering','ready'].includes(old.state))count++;else terminal.push(old);}if(receipts>=JOB_LIMITS.receipts){terminal.sort((a,b)=>a.created-b.created);if(!terminal.length)fail(413,'motion_render_capacity');await unlink(join(path,terminal[0].id+'.json'));}if(count>=JOB_LIMITS.sessions)fail(413,'motion_render_capacity');const now=Date.now(),v={id:randomUUID(),state:'queued',project:projectId,title:project.title,revision:input.revision,requestKey,options,signature,documentSha256,compId:plan.compId,frames:plan.frames,frameRate:plan.rate,startTick:String(plan.startTick),endTick:String(plan.endTick),maxSide:plan.maxSide,created:now,expires:now+JOB_LIMITS.lifetimeMs,runUntil:now+RENDER_LIMITS.deadlineMs,producedBytes:0,completedFrames:0};this.#queued={path,id:v.id,signature:v.signature,requestKey:v.requestKey};await this.#publish(path,v,check);return{render:jobReceipt(v),created:true};});await this.#source({project:projectId,revision:input.revision});return result;}catch(error){await this.abandonQueued(error.code).catch(()=>{});throw error;}}
 async abandonQueued(code='motion_render_continuation_unavailable'){
  const own=this.#queued;if(!own)return{abandoned:false};const stop=Date.now()+1000;
  for(;;){try{await this.#lease(own.path,async(path,check)=>{const v=await this.#load(path,own.id);if(v.state!=='queued'||v.signature!==own.signature||v.requestKey!==own.requestKey)return;v.state='failed';v.error=typeof code==='string'&&/^[a-z][a-z0-9_]{1,100}$/.test(code)?code:'motion_render_failed';await this.#publish(path,v,check);});return{abandoned:true};}catch(e){if(e.code!=='motion_render_busy'||Date.now()>=stop)throw e;await new Promise(done=>setTimeout(done,25));}}
 }
 async #current(path,pinned,output,initial){return this.#lease(path,async(p,check)=>{
  const v=await this.#load(p,pinned.id);if(v.signature!==pinned.signature||v.documentSha256!==pinned.documentSha256)fail(503,'motion_render_file_changed');
  if(output){if(v.state!=='ready'||v.output.sha256!==output.sha256||v.output.bytes!==output.bytes)fail(409,'motion_export_cancelled');const file=regular(await lstat(join(p,v.id+'.data')));if(file.size!==output.bytes||initial&&(file.ino!==initial.ino||file.dev!==initial.dev))fail(503,'motion_render_file_changed');}
  await check();return v;
 });}
 async list(){
  const snapshots=await this.#locked(async(path,check)=>{const jobs=[];for(const name of await readdir(path)){if(!/^[0-9a-f-]{36}\.json$/.test(name))continue;try{jobs.push(await this.#load(path,name.slice(0,-5)));}catch(e){if(e.code!=='motion_render_expired')throw e;}}await check();return jobs;});
  const jobs=[];for(const v of snapshots){try{await this.#source(v);}catch(e){if(e.status===404)continue;throw e;}jobs.push(jobReceipt(v));}return jobs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 }
 async status(id){
  const v=await this.#locked(async(path,check)=>{const current=await this.#load(path,id);if(['queued','rendering'].includes(current.state)&&Date.now()>=current.runUntil){current.state='failed';current.error='motion_render_interrupted';await this.#publish(path,current,check);}return current;});
  await this.#source(v);return jobReceipt(await this.#current(join(this.#root,'.motion-render-jobs',hash(this.#original)),v));
 }
 async cancel(id){return this.#locked(async(path,check)=>{const v=await this.#load(path,id);v.state='cancelled';delete v.output;delete v.chunkHashes;delete v.error;await this.#publish(path,v,check);await unlink(join(path,id+'.data')).catch(e=>{if(e.code!=='ENOENT')throw e;});await check();return jobReceipt(v);});}
 async fail(id,code){return this.#producer(async(path,check)=>{const v=await this.#load(path,id);if(v.state==='cancelled'||v.state==='ready')return;if(!/^[a-z][a-z0-9_]{1,100}$/.test(code))code='motion_render_failed';v.state='failed';v.error=code;delete v.output;delete v.chunkHashes;await this.#publish(path,v,check);await unlink(join(path,id+'.data')).catch(e=>{if(e.code!=='ENOENT')throw e;});});}
 async #discardOwned(path,id,initial,signature,code){
  if(!path||!initial)return;const stop=Date.now()+1000;
  for(;;){try{await this.#lease(path,async(p,check)=>{
   const v=await this.#load(p,id);if(v.state==='cancelled'||v.signature!==signature)return;
   const file=join(p,id+'.data'),stat=await lstat(file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
   if(stat){regular(stat);if(stat.ino!==initial.ino||stat.dev!==initial.dev)fail(503,'motion_render_file_changed');}
   v.state='failed';v.error=typeof code==='string'&&/^[a-z][a-z0-9_]{1,100}$/.test(code)?code:'motion_render_failed';delete v.output;delete v.chunkHashes;
   await this.#publish(p,v,check);if(stat)await unlink(file);await check();
  });return;}catch(e){if(e.code!=='motion_render_busy'||Date.now()>=stop)throw e;await new Promise(done=>setTimeout(done,25));}}
 }
 async produce(id){let v,path,initial,f,pinned;
 try{renderContinuationDiagnostic(this.#ctx,'authority');const namespace=await this.#namespace();renderContinuationDiagnostic(this.#ctx,'namespace');pinned=await this.#load(namespace,id);renderContinuationDiagnostic(this.#ctx,'source');await this.#source(pinned);}
 catch(error){const code=renderContinuationDiagnostic(this.#ctx,'failed',error);if(pinned)await this.fail(id,code).catch(()=>{});throw error;}
 renderContinuationDiagnostic(this.#ctx,'output');try{await this.#producer(async(p,check)=>{v=await this.#load(p,id);if(v.state!=='queued')fail(409,'motion_render_not_queued');if(v.signature!==pinned.signature||v.documentSha256!==pinned.documentSha256)fail(503,'motion_render_file_changed');path=p;f=await open(join(path,id+'.data'),constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600);initial=regular(await f.stat());v.state='rendering';await this.#publish(path,v,check);});}catch(error){await this.#discardOwned(path,id,initial,pinned.signature,error.code).catch(()=>{});await f?.close();throw error;}
 let total=0,lastProgress=0;try{const output=await renderExportTo(this.#ctx,this.#store,v.project,v.revision,v.options,async bytes=>{if(await this.#namespace()!==path)fail(401,'motion_identity_changed');const current=await this.#load(path,id);if(current.state!=='rendering')fail(409,'motion_export_cancelled');if(Date.now()>=current.runUntil)fail(503,'motion_export_timeout');await this.#source(current);const s=regular(await lstat(join(path,id+'.data'))),held=regular(await f.stat());if(s.ino!==initial.ino||s.dev!==initial.dev||held.ino!==initial.ino||held.dev!==initial.dev)fail(503,'motion_render_file_changed');if(total+bytes.length>JOB_LIMITS.bytes)fail(413,'motion_export_output_limit');let offset=0;while(offset<bytes.length){const{bytesWritten}=await f.write(bytes,offset,bytes.length-offset,total+offset);if(!bytesWritten)fail(503,'motion_render_write_failed');offset+=bytesWritten;}total+=bytes.length;if(Date.now()-lastProgress>1000){await this.#producer(async(p,check)=>{const progress=await this.#load(p,id);if(progress.state!=='rendering')fail(409,'motion_export_cancelled');progress.producedBytes=total;await this.#publish(p,progress,check);},v.runUntil);lastProgress=Date.now();}}, {onFrame:async completed=>{if(completed===v.frames||Date.now()-lastProgress>1000){await this.#producer(async(p,check)=>{const progress=await this.#load(p,id);if(progress.state!=='rendering')fail(409,'motion_export_cancelled');progress.completedFrames=completed;progress.producedBytes=total;await this.#publish(p,progress,check);},v.runUntil);lastProgress=Date.now();}}});
 await f.sync();
 // Hash complete immutable bytes outside the metadata lease so cancellation stays available.
 const chunks=[],whole=createHash('sha256');
 for(let offset=0;offset<output.bytes;offset+=65536){
  if(await this.#namespace()!==path)fail(401,'motion_identity_changed');
  const current=await this.#load(path,id);if(current.state!=='rendering')fail(409,'motion_export_cancelled');
  if(Date.now()>=current.runUntil)fail(503,'motion_export_timeout');await this.#source(current);
  const now=regular(await lstat(join(path,id+'.data'))),held=regular(await f.stat());
  if(now.ino!==initial.ino||now.dev!==initial.dev||held.ino!==initial.ino||held.dev!==initial.dev||now.size!==output.bytes||held.size!==output.bytes)fail(503,'motion_render_file_changed');
  const bytes=Buffer.alloc(Math.min(65536,output.bytes-offset));let n=0;
  while(n<bytes.length){const{bytesRead}=await f.read(bytes,n,bytes.length-n,offset+n);if(!bytesRead)fail(503,'motion_render_file_changed');n+=bytesRead;}
  whole.update(bytes);chunks.push(hash(bytes));
 }
 if(whole.digest('hex')!==output.sha256)fail(503,'motion_render_integrity_error');
 await this.#source(v);
 await this.#producer(async(p,check)=>{
  const current=await this.#load(p,id);if(current.state!=='rendering')fail(409,'motion_export_cancelled');
  if(Date.now()>=current.runUntil)fail(503,'motion_export_timeout');
  const now=regular(await lstat(join(path,id+'.data'))),held=regular(await f.stat());
  if(now.ino!==initial.ino||now.dev!==initial.dev||held.ino!==initial.ino||held.dev!==initial.dev||now.size!==output.bytes||held.size!==output.bytes||output.documentSha256!==v.documentSha256)fail(503,'motion_render_file_changed');
  current.state='ready';current.chunkHashes=chunks;current.output=output;current.producedBytes=output.bytes;current.completedFrames=output.frames;await this.#publish(p,current,check);
 },v.runUntil);await this.#source(v);await this.#current(path,v,output,initial);return output;
 }catch(error){await this.#discardOwned(path,id,initial,v.signature,error.code).catch(()=>{});throw error;}finally{await f?.close();}}
 async chunk(id,offset,size=JOB_LIMITS.chunkBytes){if(![8192,65536].includes(size))fail(400,'motion_invalid_render_offset');if(!Number.isSafeInteger(offset)||offset<0||offset>JOB_LIMITS.bytes)fail(400,'motion_invalid_render_offset');const path=await this.#namespace(),source=await this.#load(path,id);await this.#source(source);let confirmed;const result=await this.#locked(async(path,check)=>{const v=await this.#load(path,id);if(v.state!=='ready')fail(409,'motion_render_not_ready');if(offset>=v.output.bytes)fail(400,'motion_invalid_render_offset');const file=join(path,id+'.data'),f=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const initial=regular(await f.stat()),current=regular(await lstat(file));confirmed={pinned:v,output:v.output,initial};if(initial.ino!==current.ino||initial.dev!==current.dev||initial.size!==v.output.bytes)fail(503,'motion_render_file_changed');const segment=Math.floor(offset/65536)*65536,full=Buffer.alloc(Math.min(65536,v.output.bytes-segment));let n=0;while(n<full.length){const{bytesRead}=await f.read(full,n,full.length-n,segment+n);if(!bytesRead)fail(503,'motion_render_file_changed');n+=bytesRead;}if(hash(full)!==v.chunkHashes[segment/65536])fail(503,'motion_render_integrity_error');const bytes=full.subarray(offset-segment,Math.min(offset-segment+size,full.length));const after=regular(await lstat(file)),held=regular(await f.stat());if(after.ino!==initial.ino||after.dev!==initial.dev||held.size!==initial.size)fail(503,'motion_render_file_changed');await check();return{offset,bytes:bytes.length,totalBytes:v.output.bytes,sha256:hash(bytes),dataBase64:bytes.toString('base64'),complete:offset+bytes.length===v.output.bytes,nextOffset:offset+bytes.length===v.output.bytes?null:offset+bytes.length};}finally{await f.close();}});await this.#source(source);await this.#current(path,confirmed.pinned,confirmed.output,confirmed.initial);return result;}
}
