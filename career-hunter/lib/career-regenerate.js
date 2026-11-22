/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-REGEN (Roger, 2026-11-21: 200 applications by Monday, and 251 open jobs whose documents were made before this week's fixes: one copy of each role, the years truth, the résumé for upload forms): Generate again's queue, regenerate-queue.json in the person's own store beside board-state.json, so it survives a reload and a kernel restart. One entry per job, in his order, at most 300 in one run; each entry is In line, Starting, Writing now, Done, Failed (with its reason in words) or Skipped. Which open jobs have older documents: a packet made by an earlier Career (application.json's career_version below this manifest's version, or none) or without Resume_Parse.docx. Every change is under one lock file, so a second tab, the background job and a retry never start a job twice.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createChildLogger}=require('@/shared/logger');
const logger=createChildLogger({module:'career-regenerate'});
const FILE='regenerate-queue.json',LOCK='regenerate-queue.lock',MOST=300,MAX_BYTES=1024*1024,LOCK_MS=120000;
const ID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
/** Each job's place in the queue. */
const STATES=new Set(['queued','claimed','running','done','failed','skipped']);
const QUEUE_STATES=new Set(['running','paused','stopped','done']);
/** Jobs that are not open: applied or later, or removed. Their documents are never made again. */
const CLOSED=new Set(['applied','interview','offer','rejected','dismissed']);
const PARSE='Resume_Parse.docx';
class RegenerateError extends Error{constructor(code,message,status=409){super(message);this.code=code;this.status=status;}}
const fail=(code,message,status)=>{throw new RegenerateError(code,message,status);};
const iso=now=>new Date(now).toISOString();
const words=(value,limit=600)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,limit):'';

/** @description The installed Career version, the top-level `version:` of this package's manifest ('' when unreadable). @returns {string} */
let version=null;
function careerVersion(){
 if(version!==null)return version;
 try{const text=fs.readFileSync(path.join(__dirname,'..','oshal-app.yaml'),'utf8');version=(/^version:\s*["']?(\d+\.\d+\.\d+)["']?\s*(?:#.*)?$/m.exec(text)||[])[1]||'';}
 catch(error){logger.error({err:error},'career manifest version unreadable');version='';}
 return version;
}
/** @description Whether version a is older than b (x.y.z, numerically). @param {string} a @param {string} b @returns {boolean} */
function older(a,b){
 const x=String(a).split('.').map(Number),y=String(b).split('.').map(Number);
 for(let i=0;i<3;i+=1){if((x[i]||0)!==(y[i]||0))return (x[i]||0)<(y[i]||0);}
 return false;
}
function validEntry(entry){return entry&&Number.isSafeInteger(entry.postingId)&&entry.postingId>0&&STATES.has(entry.state)&&Number.isSafeInteger(entry.attempts)&&Array.isArray(entry.requestIds);}
/** @description His queue, or null when he has none. @param {string} dir His own store. @returns {object|null} */
function read(dir){
 const file=path.join(dir,FILE);let stat;
 try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>MAX_BYTES)fail('regenerate_unavailable','Your Generate again queue is unavailable.',503);
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 if(data?.version!==1||!ID.test(data.id||'')||!QUEUE_STATES.has(data.state)||!Array.isArray(data.entries)||data.entries.length>MOST||!data.entries.every(validEntry)
   ||data.entries.filter(entry=>['claimed','running'].includes(entry.state)).length>1)fail('regenerate_invalid','Your Generate again queue needs repair.',503);
 return data;
}
/** @description Save the queue atomically. @param {string} dir @param {object} state @param {number} [now] @returns {object} The state. */
function write(dir,state,now=Date.now()){
 state.updatedAt=iso(now);
 const bytes=JSON.stringify(state)+'\n',file=path.join(dir,FILE),temp=file+'.'+crypto.randomUUID()+'.tmp';
 if(Buffer.byteLength(bytes)>MAX_BYTES)fail('regenerate_full','Your Generate again queue is full. Clear it first.');
 try{fs.writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}
 finally{try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
 return state;
}
/** @description Remove the queue file (Clear). @param {string} dir @returns {void} */
function remove(dir){try{fs.unlinkSync(path.join(dir,FILE));}catch(error){if(error.code!=='ENOENT')throw error;}}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
/** Take the lock file, or false while another change holds it (a lock older than two minutes is a crashed holder's). */
function take(file){
 try{fs.closeSync(fs.openSync(file,'wx',0o600));return true;}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  let age=0;try{age=Date.now()-fs.statSync(file).mtimeMs;}catch(gone){if(gone.code==='ENOENT')return take(file);throw gone;}
  if(age<LOCK_MS)return false;
  logger.error({ageMs:Math.round(age)},'regenerate lock left by a crashed change; taken over');
  try{fs.unlinkSync(file);}catch(gone){if(gone.code!=='ENOENT')throw gone;}
  return take(file);
 }
}
/**
 * @description Run one change of the queue under its lock. With `wait`, a press waits that long for a change in flight;
 * without it the caller hears {busy:true} (another advance is moving the queue on). @param {string} dir @param {Function} work
 * @param {{wait?:number}} [options] @returns {Promise<*>} work's answer, or {busy:true}.
 */
async function locked(dir,work,{wait=0}={}){
 const file=path.join(dir,LOCK),until=Date.now()+wait;
 while(!take(file)){if(Date.now()>=until){if(wait)fail('regenerate_busy','Career is moving Generate again on. Press it again in a moment.');return {busy:true};}await sleep(150);}
 try{return await work();}
 finally{try{fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')logger.error({err:error},'regenerate lock could not be released');}}
}
/** @description The jobs not yet ended. @param {object|null} state @returns {object[]} */
const open=state=>(state?.entries||[]).filter(entry=>['queued','claimed','running'].includes(entry.state));
function counts(entries){
 const out={queued:0,claimed:0,running:0,done:0,failed:0,skipped:0};
 for(const entry of entries)out[entry.state]+=1;
 return {done:out.done,failed:out.failed,skipped:out.skipped,left:out.queued+out.claimed+out.running,total:entries.length};
}
/**
 * @description The queue as his pages read it: each job's state and reason, the counts (done, left, failed, skipped), the
 * job Career is on, and how many more fit in this run. @param {object|null} state @returns {object|null}
 */
function publicQueue(state){
 if(!state)return null;
 const entries=state.entries.map(({postingId,title,company,state:at,reason,note,retry,attempts,startedAt,endedAt})=>({postingId,title,company,state:at,reason:reason||'',note:note||'',retry:retry||'',attempts,startedAt:startedAt||null,endedAt:endedAt||null}));
 return {id:state.id,state:state.state,reason:state.reason||'',createdAt:state.createdAt,updatedAt:state.updatedAt,most:MOST,entries,
  counts:counts(state.entries),current:entries.find(entry=>['claimed','running'].includes(entry.state))||null,room:Math.max(0,MOST-open(state).length)};
}
/** @description End a job with its reason (a second try's note goes with it). */
function end(entry,state,reason,now){Object.assign(entry,{state,reason:words(reason),note:'',retry:'',endedAt:iso(now)});}

/** @description Each job's packet folder by posting id: the newest applications/<Company>__<id> holding an application.json. */
function packetFolders(dir){
 const apps=path.join(dir,'applications'),found=new Map();let names=[];
 try{names=fs.readdirSync(apps);}catch(error){if(error.code!=='ENOENT')logger.error({err:error},'applications folder unreadable');return found;}
 for(const name of names){
  const id=Number((/__(\d+)$/.exec(name)||[])[1]);if(!Number.isSafeInteger(id)||id<=0)continue;
  let at;try{at=fs.lstatSync(path.join(apps,name,'application.json')).mtimeMs;}catch{continue;}
  if(!found.has(id)||found.get(id).at<at)found.set(id,{folder:path.join(apps,name),at});
 }
 return new Map([...found].map(([id,{folder}])=>[id,folder]));
}
/** @description The Career version a packet records in application.json's first bytes ('' when none). @param {string} folder @returns {string} */
function packetVersion(folder){
 let fd;
 try{fd=fs.openSync(path.join(folder,'application.json'),'r');const head=Buffer.alloc(2048);const n=fs.readSync(fd,head,0,head.length,0);
  return (/"career_version"\s*:\s*"(\d+\.\d+\.\d+)"/.exec(head.subarray(0,n).toString('utf8'))||[])[1]||'';}
 catch{return '';}
 finally{if(fd!==undefined)fs.closeSync(fd);}
}
/**
 * @description Why a job's documents are older than today's Career: 'version' (made by an earlier Career, or one that
 * recorded none), 'parse' (no résumé for upload forms, Resume_Parse.docx), or '' when they are current or there are none.
 * @param {string|null} folder The job's packet folder. @param {string} current This Career's version. @returns {string}
 */
function whyOlder(folder,current){
 if(!folder)return '';
 if(!fs.existsSync(path.join(folder,PARSE)))return 'parse';
 const made=packetVersion(folder);
 return current&&(!made||older(made,current))?'version':'';
}
/**
 * @description Every open job of his whose documents are older than today's Career, best match first. A job applied or
 * later, removed, closed by its employer, or held by an approved or submitted application is left out.
 * @param {string} dir His store. @param {object[]} rows {id,status,active,company,title,ai_fit_score,has_resume}.
 * @param {(id:number)=>boolean} held Whether the job has approved or submitted work. @returns {object[]}
 */
function olderJobs(dir,rows,held){
 const folders=packetFolders(dir),current=careerVersion(),out=[];
 for(const row of rows){
  if(!row.has_resume||CLOSED.has(row.status||'')||row.active===0||held(row.id))continue;
  const why=whyOlder(folders.get(row.id)||null,current);
  if(why)out.push({id:row.id,company:words(row.company,200),title:words(row.title,300),why,match:row.ai_fit_score??null});
 }
 return out.sort((a,b)=>(b.match??-1)-(a.match??-1)||a.id-b.id);
}
module.exports={FILE,MOST,CLOSED,RegenerateError,fail,iso,words,read,write,remove,locked,open,publicQueue,end,careerVersion,older,whyOlder,packetFolders,olderJobs};
