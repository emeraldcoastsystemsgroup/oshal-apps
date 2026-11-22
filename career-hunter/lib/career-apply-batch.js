/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane APPLY-BATCH (Roger, 2026-11-21: "i really need to be able to post 200 resumes by monday ... these local jobs will fill up fast"): Fill in several on my Chrome, the person's own queue of assisted applications, apply-batch.json beside apply-runs.json in his store. Each job in it is one approved run (career-apply-runs, one packet and digest per job, exactly as a single approval), and the queue starts the next job only when the one on his computer has ended: submitted, stopped, failed, paused, or Ready at Review that he left open with Next job. A run waiting for him (sign-in, a question card) keeps the queue waiting. No other run of his may be on the computer when the next starts, so two never run at once. A job whose 24-hour approval ended is not started (it asks for approval again); a job applied meanwhile is skipped. At most 50 jobs wait at once. Every change is under one lock file, so a second tab, a reload or a retry never starts a job twice; the queue survives a reload and a kernel restart because the next advance reads it from the store and resumes.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createChildLogger}=require('@/shared/logger');
const queue=require('./career-submission-queue'),runs=require('./career-apply-runs');
const logger=createChildLogger({module:'career-apply-batch'});
const FILE='apply-batch.json',LOCK='apply-batch.lock',MOST=50,MAX_ENTRIES=200,MAX_BYTES=1024*1024,LOCK_MS=120000;
const ID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
/** Each job's place in the queue, as the panel names it. */
const STATES=new Set(['waiting','filling','needs-you','ready','submitted','skipped','failed']);
const QUEUE_STATES=new Set(['running','paused','stopped','done']);
/** A run of his that is on the computer now. */
const ON_COMPUTER=new Set(['queued','running','waiting','ready']);
const DONE=['applied','interview','offer','rejected'];
const fail=(code,message,status=409)=>{throw new queue.SubmissionError(code,message,status);};
const iso=now=>new Date(now).toISOString();
const words=(value,limit=600)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,limit):'';

function validEntry(entry){
 return entry&&Number.isSafeInteger(entry.postingId)&&ID.test(entry.runId||'')&&STATES.has(entry.state)&&typeof entry.active==='boolean';
}
/**
 * @description The person's queue, or null when he has none. @param {string} dir His own store. @returns {object|null}
 */
function read(dir){
 const file=path.join(dir,FILE);let stat;
 try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>MAX_BYTES)fail('batch_unavailable','Your fill-in queue is unavailable.',503);
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 if(data?.version!==1||!ID.test(data.id||'')||!QUEUE_STATES.has(data.state)||!Array.isArray(data.entries)||data.entries.length>MAX_ENTRIES||!data.entries.every(validEntry)
   ||data.entries.filter(entry=>entry.active).length>1)fail('batch_invalid','Your fill-in queue needs repair.',503);
 return data;
}
function write(dir,state,now=Date.now()){
 state.updatedAt=iso(now);
 const bytes=JSON.stringify(state)+'\n',file=path.join(dir,FILE),temp=file+'.'+crypto.randomUUID()+'.tmp';
 if(Buffer.byteLength(bytes)>MAX_BYTES)fail('batch_full','Your fill-in queue is full. Clear it first.');
 try{fs.writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});const fd=fs.openSync(temp,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);}
 finally{try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
 return state;
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
/** Take the queue's lock file, or null while another change holds it (a lock older than two minutes is a crashed holder's). */
function take(file){
 try{fs.closeSync(fs.openSync(file,'wx',0o600));return true;}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  let age=0;try{age=Date.now()-fs.statSync(file).mtimeMs;}catch(gone){if(gone.code==='ENOENT')return take(file);throw gone;}
  if(age<LOCK_MS)return false;
  logger.error({ageMs:Math.round(age)},'apply batch lock left by a crashed change; taken over');
  try{fs.unlinkSync(file);}catch(gone){if(gone.code!=='ENOENT')throw gone;}
  return take(file);
 }
}
/**
 * @description Run one change of the queue under its lock. With `wait`, a person's press waits up to that long for a
 * change in flight; without it the caller hears busy (an advance already moving the queue on). @param {string} dir
 * @param {Function} work @param {{wait?:number}} [options] @returns {Promise<*>} work's answer, or {busy:true}.
 */
async function locked(dir,work,{wait=0}={}){
 const file=path.join(dir,LOCK),until=Date.now()+wait;
 while(!take(file)){if(Date.now()>=until){if(wait)fail('batch_busy','Career is moving your queue on. Press it again in a moment.');return {busy:true};}await sleep(150);}
 try{return await work();}
 finally{try{fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')logger.error({err:error},'apply batch lock could not be released');}}
}
/** @description The jobs not yet ended, the ones a new batch counts against the 50. @param {object|null} state @returns {object[]} */
const open=state=>(state?.entries||[]).filter(entry=>entry.active||entry.state==='waiting');
function counts(entries){
 const out={waiting:0,filling:0,'needs-you':0,ready:0,submitted:0,skipped:0,failed:0};
 for(const entry of entries)out[entry.state]+=1;
 return {submitted:out.submitted,ready:out.ready,needsYou:out['needs-you'],failed:out.failed,skipped:out.skipped,waiting:out.waiting,filling:out.filling};
}
/**
 * @description The queue as his pages read it: each job's state and one-line reason, the counts, and the job on the computer.
 * @param {object|null} state @returns {object|null}
 */
function publicQueue(state){
 if(!state)return null;
 const entries=state.entries.map(({postingId,runId,ticketId,title,company,site,host,state:at,reason,active,expired,startedAt,endedAt})=>
  ({postingId,runId,ticketId:ticketId||null,title,company,site,host,state:at,reason,active,expired:expired===true,startedAt:startedAt||null,endedAt:endedAt||null}));
 return {id:state.id,state:state.state,reason:state.reason||'',createdAt:state.createdAt,updatedAt:state.updatedAt,most:MOST,entries,
  counts:counts(state.entries),current:entries.find(entry=>entry.active)||null,room:Math.max(0,MOST-open(state).length)};
}
/**
 * @description What a job's run says, as its place in the queue: its state, one line, and whether it has ended.
 * @param {object} run publicRun. @returns {{state:string,reason:string,ended:boolean}}
 */
function fromRun(run){
 const live=run.live||{},why=words(run.reason);
 const table={
  approved:['filling','Starting on your computer',false],queued:['filling','Waiting for your computer',false],
  running:['filling',words(live.line)||'Filling in the form',false],
  waiting:['needs-you',[words(live.line),words(live.reason?.text)].filter(Boolean).join(': ')||'Waiting for you',false],
  ready:['ready',words(live.ready)||'Ready: check it and press Submit in the Chrome window. Or press Next job to leave it open and go on.',false],
  submitted:['submitted',run.submittedBy==='career'?'Submitted by Career after your approval; the employer’s confirmation was seen.':'Submitted by you; the employer’s confirmation was seen.',true],
  not_seen:['needs-you',run.pressedByCareer?why||'Career pressed Submit once; the employer’s confirmation was not seen. Check the employer’s site before anything else.':'Career did not see the employer’s confirmation. Mark it applied when you have.',true],
  paused:['failed','Paused: '+(why||'the run stopped before Review.')+' Open the job and press Go on to try it again.',true],
  failed:['failed',why||'Your computer stopped before the form reached Review. Nothing was submitted.',true],
  stopped:['skipped',why||'You stopped it. Nothing was submitted.',true]};
 const [state,reason,ended]=table[run.status]||['failed','Career could not read this job’s run.',true];
 return {state,reason,ended};
}
function end(entry,state,reason,now){Object.assign(entry,{state,reason:words(reason),active:false,endedAt:iso(now)});}
module.exports={FILE,MOST,ON_COMPUTER,DONE,read,write,locked,open,publicQueue,fromRun,end,words,iso,fail};
