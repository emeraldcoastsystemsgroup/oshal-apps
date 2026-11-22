/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane APPLY-BATCH (Roger, 2026-11-21: "i really need to be able to post 200 resumes by monday"): the routes of Fill in several on my Chrome, every one the signed-in person's own, mounted beside the assisted application's. POST /apply-batch approves each job's exact packet as a single approval does (POST /apply-runs, one packet and digest per job) and puts it in his queue; a job already sent, already queued, past the 50 waiting at once, or whose packet changed since he reviewed it is refused with its reason and the others go in. POST /apply-batch/advance reads the job on his computer from the kernel's record and, once it has ended and no other run of his is on the computer, starts the next (bind, then start or Go on); it never starts two. GET /apply-batch reads the queue; /pause, /go-on, /stop, /skip, /next and /clear change it. Skip, Next job and Stop refuse while the job's run is still on his computer, so the page stops it first through the kernel's own ticket cancel, which leaves its Chrome tab open.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createChildLogger}=require('@/shared/logger');
const queue=require('./career-submission-queue'),drafts=require('./career-application-draft'),runs=require('./career-apply-runs'),applySync=require('./career-apply-sync');
const batch=require('./career-apply-batch');
const logger=createChildLogger({module:'career-apply-batch-routes'});
const {MOST,ON_COMPUTER,fail,end,iso,fromRun}=batch;
const HASH=/^[a-f0-9]{64}$/;
const EXPIRED='Your approval of this job ended (an approval lasts 24 hours). Approve it again to fill it in.';
const LEFT_OPEN='Left open in its Chrome window for you to check and submit. Press I applied on the job when you have.';
const known=error=>error instanceof queue.SubmissionError||error instanceof drafts.DraftError;
const hostOf=url=>{try{return new URL(url).hostname;}catch{return '';}};

/** Whether Career already sent this job, or pressed Submit for it without the confirmation being seen. */
function sentBefore(dir,postingId){
 return Object.values(runs.read(dir).runs).some(run=>run.postingId===postingId&&(run.status==='submitted'||run.status==='not_seen'&&run.pressedByCareer));
}
function checkBody(body){
 const jobs=body?.jobs;
 if(Object.keys(body||{}).some(key=>!['jobs','approved'].includes(key))||body.approved!==true||!Array.isArray(jobs)||!jobs.length||jobs.length>MOST
   ||jobs.some(job=>Object.keys(job||{}).some(key=>!['postingId','packetDigest'].includes(key))||!Number.isSafeInteger(job.postingId)||job.postingId<1||!HASH.test(job.packetDigest||''))
   ||new Set(jobs.map(job=>job.postingId)).size!==jobs.length)
  fail('invalid_request','Approve from 1 to 50 jobs, each the exact packet you reviewed.',400);
 return jobs;
}
/** A new queue when he has none or the last one ended; else the one he has, going on. */
function current(dir,now){
 const state=batch.read(dir);
 if(state&&!['done','stopped'].includes(state.state))return state;
 return {version:1,id:randomUUID(),state:'running',reason:'',createdAt:iso(now),entries:[]};
}
function entryOf(result,now){
 const {run,site}=result;
 return {postingId:run.postingId,runId:run.id,ticketId:run.nativeTicketId||null,title:batch.words(run.title,300),company:batch.words(run.company,300),
  site:batch.words(site?.name||run.site,80),host:hostOf(run.url),state:'waiting',reason:'',active:false,expired:false,approvedAt:iso(now),startedAt:null,endedAt:null};
}
/**
 * @description Approve each job's exact packet and queue it, in his order. A job refused keeps the others going.
 * @param {string} dir @param {string} sub @param {object} body {jobs:[{postingId, packetDigest}], approved:true}
 * @param {object} deps {approve} @returns {Promise<{queue:object,refused:object[]}>}
 */
async function approveJobs(dir,sub,body,deps){
 const jobs=checkBody(body),refused=[];
 return batch.locked(dir,async()=>{
  const now=Date.now(),state=current(dir,now),waiting=new Set(batch.open(state).map(entry=>entry.postingId));
  let room=MOST-waiting.size;
  for(const job of jobs){
   try{
    if(waiting.has(job.postingId))fail('already_queued','This job is already in your queue.');
    if(room<=0)fail('queue_full',`Career holds at most ${MOST} jobs waiting at once. Approve this one when the queue has room.`);
    if(sentBefore(dir,job.postingId))fail('already_submitted','Career already sent this application. A job is filled in only once.');
    const result=await deps.approve(dir,sub,{postingId:job.postingId,packetDigest:job.packetDigest,approved:true});
    state.entries=state.entries.filter(entry=>entry.postingId!==job.postingId).concat(entryOf(result,now));room-=1;waiting.add(job.postingId);
   }catch(error){if(!known(error))throw error;refused.push({postingId:job.postingId,code:error.code||'refused',why:error.message});}
  }
  if(state.entries.length)Object.assign(state,{state:'running',reason:''});
  state.entries=state.entries.slice(-200);
  if(state.entries.length)batch.write(dir,state,now);
  return {queue:batch.publicQueue(batch.read(dir)),refused};
 },{wait:10000});
}
/** Another run of his still on the computer (one started from a job's own page): read again, at most five. */
async function otherOnComputer(dir,deps){
 const live=Object.values(runs.read(dir).runs).filter(run=>ON_COMPUTER.has(run.status)&&run.attempts.at(-1)?.workId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,5);
 for(const run of live){const now=await deps.sync(run.id);if(ON_COMPUTER.has(now.status))return now;}
 return null;
}
/** Read the job on his computer and record where it is; true when it is still there. */
async function readActive(dir,state,deps,now){
 const entry=state.entries.find(item=>item.active);if(!entry)return false;
 let run=await deps.sync(entry.runId);
 // A start that was not acknowledged is sent again with the same bytes; a refusal keeps the job claimed with its words.
 if(run.status==='approved'&&run.attempt>run.attemptsStarted){
  try{run=await deps.start(entry.runId);}catch(error){if(!known(error))throw error;entry.reason=batch.words(error.message);return true;}
 }
 const seen=fromRun(run),wasReady=entry.state==='ready';
 if(!seen.ended){Object.assign(entry,{state:seen.state,reason:seen.reason});return true;}
 if(seen.state==='skipped'&&wasReady)end(entry,'ready',LEFT_OPEN,now);else end(entry,seen.state,seen.reason,now);
 return false;
}
/** Revert a claimed job to waiting and pause the queue with the reason. */
function pauseFor(state,entry,reason){Object.assign(entry,{active:false,state:'waiting',reason:'',startedAt:null});Object.assign(state,{state:'paused',reason});}
/** Start one waiting job: refused ones end with their reason; a claimed job is written before the kernel is asked. */
async function startOne(dir,state,entry,deps,now){
 const row=deps.posting(entry.postingId);
 if(!row||batch.DONE.includes(row.status)){end(entry,'skipped',row?'Already applied. Career fills in a job only once.':'This job is no longer in Career.',now);return false;}
 let run;try{run=runs.get(dir,entry.runId);}catch(error){if(error.code!=='run_not_found')throw error;end(entry,'failed','Its approval is no longer kept. Approve it again.',now);return false;}
 if(Date.parse(run.expiresAt)<=now){end(entry,'needs-you',EXPIRED,now);entry.expired=true;return false;}
 if(['submitted','not_seen','stopped'].includes(run.status)){const seen=fromRun(runs.publicRun(run));end(entry,seen.state,seen.reason,now);return false;}
 Object.assign(entry,{active:true,state:'filling',reason:'Starting on your computer',startedAt:iso(now)});batch.write(dir,state,now);
 try{
  const bound=await deps.bind(entry.runId);entry.ticketId=bound.nativeTicketId||entry.ticketId;
  const started=['paused','failed'].includes(run.status)?await deps.goOn(entry.runId):await deps.start(entry.runId),seen=fromRun(started);
  Object.assign(entry,{state:seen.ended?entry.state:seen.state,reason:seen.ended?entry.reason:seen.reason});
 }catch(error){
  if(!known(error)){logger.error({err:error,postingId:entry.postingId},'apply batch start failed');pauseFor(state,entry,'Career could not start the next job, so it paused the queue. Press Go on to try again.');}
  else if(error.code==='apply_device_unavailable')pauseFor(state,entry,error.message+' Career paused the queue; press Go on when your computer is connected.');
  else if(error.code==='dispatch_unavailable')entry.reason='Starting on your computer';
  else{end(entry,'failed',error.message,now);return false;}
 }
 return true;
}
/**
 * @description Move his queue on: read the job on the computer; once it ended and nothing else of his is on the
 * computer, start the next waiting job. Starts at most one. @param {string} dir @param {object} deps
 * {sync, start, goOn, bind, posting} @returns {Promise<object|null>} The queue, or null when he has none.
 */
async function advance(dir,deps){
 const answer=await batch.locked(dir,async()=>{
  const now=Date.now(),state=batch.read(dir);if(!state)return null;
  if(await readActive(dir,state,deps,now)||state.state!=='running')return batch.publicQueue(batch.write(dir,state,now));
  const other=state.entries.some(entry=>entry.state==='waiting')&&await otherOnComputer(dir,deps);
  if(other){state.reason=`Waiting for the form Career is filling in for ${batch.words(other.company,120)||'another job'} to end; the next job starts after it.`;return batch.publicQueue(batch.write(dir,state,now));}
  state.reason='';
  for(const entry of state.entries)if(entry.state==='waiting'&&await startOne(dir,state,entry,deps,now))break;
  if(!state.entries.some(entry=>entry.active||entry.state==='waiting'))Object.assign(state,{state:'done',reason:''});
  return batch.publicQueue(batch.write(dir,state,now));
 });
 return answer?.busy?batch.publicQueue(batch.read(dir)):answer;
}
/** The job a press names: the one on the computer, or (for Skip) one still waiting. */
function named(state,body,{waitingToo}){
 if(Object.keys(body||{}).some(key=>key!=='postingId')||!Number.isSafeInteger(body?.postingId))fail('invalid_request','Name the job.',400);
 const entry=state.entries.find(item=>item.postingId===body.postingId&&(item.active||waitingToo&&item.state==='waiting'));
 if(!entry)fail('batch_job_not_current','That job is not the one Career is on now.');
 return entry;
}
/** Refuse while the job's run is still on his computer; the page stops it through the kernel's own cancel first. */
async function ended(entry,deps){
 const run=await deps.sync(entry.runId);
 if(ON_COMPUTER.has(run.status))fail('run_still_live','Career is still on this job on your computer. Stop it first; Career starts no other until it ends.');
 return run;
}
/** @description A press on the panel: pause, go-on, stop, skip, next or clear. @returns {Promise<object|null>} The queue. */
async function press(dir,name,body,deps){
 const result=await batch.locked(dir,async()=>{
  const now=Date.now(),state=batch.read(dir);if(!state)fail('batch_not_found','You have no fill-in queue.',404);
  const going=!['done','stopped'].includes(state.state);
  if(name==='clear'){if(going)fail('batch_running','Stop the queue before clearing it.');fs.unlinkSync(path.join(dir,batch.FILE));return {cleared:true};}
  if(!going)fail('batch_ended','This queue has ended. Select jobs and approve a new batch.');
  if(name==='pause'){Object.assign(state,{state:'paused',reason:state.entries.some(entry=>entry.active)?'Paused by you. Career finishes the job on your computer and starts no other until you press Go on.':'Paused by you. Career starts no other job until you press Go on.'});}
  else if(name==='go-on')Object.assign(state,{state:'running',reason:''});
  else if(name==='stop')await stopAll(state,deps,now);
  else{
   const entry=named(state,body,{waitingToo:name==='skip'});
   if(name==='next'&&entry.state!=='ready')fail('batch_job_not_ready','Next job is for a job ready at Review. Use Skip this job.');
   const run=entry.active?await ended(entry,deps):null,seen=run&&fromRun(run);
   if(seen&&['submitted','not_seen'].includes(run.status))end(entry,seen.state,seen.reason,now);
   else end(entry,name==='next'?'ready':'skipped',name==='next'?LEFT_OPEN:'You skipped it. Nothing was submitted.',now);
  }
  batch.write(dir,state,now);return {};
 },{wait:10000});
 if(result.cleared)return null;
 return ['go-on','skip','next'].includes(name)?advance(dir,deps):batch.publicQueue(batch.read(dir));
}
async function stopAll(state,deps,now){
 const active=state.entries.find(entry=>entry.active);
 if(active){
  const run=await ended(active,deps),seen=fromRun(run);
  if(['submitted','not_seen'].includes(run.status))end(active,seen.state,seen.reason,now);
  else if(active.state==='ready')end(active,'ready',LEFT_OPEN,now);else end(active,'skipped','Stopped with the queue. Nothing was submitted.',now);
 }
 for(const entry of state.entries)if(entry.state==='waiting')end(entry,'skipped','The queue was stopped before this job. Nothing was submitted.',now);
 Object.assign(state,{state:'stopped',reason:'You stopped the queue.'});
}
/**
 * @description Mount the queue's routes on the assisted application's router. @param {import('express').Router} router
 * @param {Function} run The router's own signed-in wrapper. @param {object} parts {ctx, approve, bind, start, goOn, writers, postingRow}
 * @returns {void}
 */
function register(router,run,parts){
 const {ctx}=parts,tickets=ctx.ticketService;
 const deps=(sub,dir)=>({approve:parts.approve,
  sync:id=>applySync.sync(dir,id,tickets,parts.writers(ctx,sub,dir,runs.get(dir,id))),
  start:async id=>(await parts.start(dir,id,tickets)).run,goOn:async id=>(await parts.goOn(dir,id,tickets)).run,
  bind:async id=>(await parts.bind(dir,id,tickets,sub)).run,posting:id=>parts.postingRow(sub,id)});
 const empty=req=>{if(Object.keys(req.body||{}).length)fail('invalid_request','Press only the queue’s own buttons.',400);};
 router.get('/apply-batch',run(async(_req,res,_sub,dir)=>res.json({queue:batch.publicQueue(batch.read(dir))})));
 router.post('/apply-batch',run(async(req,res,sub,dir)=>res.json(await approveJobs(dir,sub,req.body||{},deps(sub,dir)))));
 router.post('/apply-batch/advance',run(async(req,res,sub,dir)=>{empty(req);res.json({queue:await advance(dir,deps(sub,dir))});}));
 const plain=name=>run(async(req,res,sub,dir)=>{empty(req);res.json({queue:await press(dir,name,{},deps(sub,dir))});});
 const onJob=name=>run(async(req,res,sub,dir)=>res.json({queue:await press(dir,name,req.body||{},deps(sub,dir))}));
 router.post('/apply-batch/pause',plain('pause'));router.post('/apply-batch/go-on',plain('go-on'));
 router.post('/apply-batch/stop',plain('stop'));router.post('/apply-batch/clear',plain('clear'));
 router.post('/apply-batch/skip',onJob('skip'));router.post('/apply-batch/next',onJob('next'));
}
module.exports={register,approveJobs,advance,press};
