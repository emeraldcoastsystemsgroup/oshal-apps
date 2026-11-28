/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career 1.79.0, Answers to review (design career-self-improving-applications-2026-11-27 part 4): the routes, every one the signed-in person's own, mounted on the assisted application's router. GET /answers-to-review-ui is the page; GET /answers-to-review reads what it shows and changes nothing (lib/career-answers-review.js view). POST /answers-to-review/refresh takes the waiting cards the person's own page read from the kernel (none from the career-answers-review schedule), keeps what their jobs wait on, gives an answered question back to the jobs that stopped on it again (the same question at another employer), with Answer written questions without my review on uses each ready draft, and asks Career's specialist for the drafts still missing: one background engine run (answers-draft, jobhunter/written_answers.py) whose every model call goes through the Career worker rail on the Career bot with its cost on the person, never while another Career run of theirs holds their store. POST /answers-to-review/approve keeps the person's answer (Approve, Edit then Approve, Write my own) in Saved answers and puts every job that stopped on it back in Fill in several, each approved again with its packet as it is now (a run paused on the question is replaced, as nothing was submitted; a job already in line there is back as it is; a job whose documents are stale goes to Generate again first, as an approval into Fill in several does); a job still waiting on its card is answered by the page in the person's own session (answerCards), since the kernel takes a card's answer only there. /skip and /reopen set a question aside and put it back.
 */
'use strict';
const crypto=require('node:crypto');
const {createChildLogger}=require('@/shared/logger');
const queue=require('./career-submission-queue'),drafts=require('./career-application-draft'),packet=require('./career-apply-packet'),runs=require('./career-apply-runs');
const answers=require('./career-apply-answers'),batch=require('./career-apply-batch'),batchRoutes=require('./career-apply-batch-routes'),didnt=require('./career-didnt-go-through'),review=require('./career-answers-review');
const regenRoutes=require('./career-regenerate-routes');
const {runCareerCliAsync}=require('../routes/career-engine-dispatch');
const {nativeEngineRunStatus,tryAcquireRun,releaseRun}=require('../routes/career-engine-runner');
const {createCareerToolFileHandler}=require('../routes/career-surface-routes');
const logger=createChildLogger({module:'career-answers-review-routes'});
/** The most jobs one press or refresh puts back in Fill in several (each is approved again, inside the kernel's 60 seconds a
 * package call has); the rest go back at the next refresh. */
const MOST_BACK=10;
const REPLACED='Put back in Fill in several with your answer. Nothing was submitted.';
const known=error=>error instanceof queue.SubmissionError||error instanceof drafts.DraftError;

/**
 * @description Whether a Career run of the person's holds their store now: the kernel's own runs on the native kernel,
 * else the runner's user-store lease (career-board-routes careerRunInFlight's rule). A status that cannot be read is busy.
 * @param {string} sub @returns {Promise<boolean>}
 */
async function engineBusy(sub){
 let status;
 try{status=await nativeEngineRunStatus();}catch(error){logger.error({err:error},'career run status unavailable for drafting');return true;}
 if(status)return status.runs.length>0;
 const lease=tryAcquireRun(sub,'user-store');if(lease.status!=='ok')return true;
 releaseRun(lease);return false;
}
/**
 * @description Ask Career's specialist to draft these questions: one background engine run (answers-draft) that writes
 * answer-drafts.json. Nothing starts while another run of the person's holds their store; the next refresh asks again.
 * @param {object} ctx @param {string} sub @param {string} dir @param {object[]} wanted [{key, text, postingId}] @returns {Promise<object|null>}
 */
async function startDrafts(ctx,sub,dir,wanted){
 if(!wanted.length)return null;
 if(await engineBusy(sub))return {started:false,busy:true};
 const request=crypto.randomUUID(),env={CH_ANSWER_DRAFTS:JSON.stringify({request,questions:wanted})};
 let started;
 try{started=await runCareerCliAsync(ctx.pool,sub,['answers-draft'],env);}
 catch(error){logger.error({err:error},'answer drafts not started');return {started:false};}
 if(!started?.started){logger.info({limitReason:started?.limitReason||null},'answer drafts waiting for the person\'s store');return {started:false,busy:true};}
 await review.markAsked(dir,wanted.map(item=>item.key),request);
 logger.info({questions:wanted.length},'answer drafts asked');
 return {started:true,request};
}
/** @description Replace a run of this job that paused (its attempt ended, nothing submitted) so a new approval can hold the job. */
function replacePaused(dir,postingId,now=Date.now()){
 for(const run of Object.values(runs.read(dir).runs))
  if(run.postingId===postingId&&run.status==='paused'&&Date.parse(run.expiresAt)>now)runs.update(dir,run.id,{status:'stopped',reason:REPLACED});
}
/**
 * @description Put jobs back in Fill in several, each approved again with its packet as it is now (the answer just kept
 * is in it). A job already in line or on the computer there is back as it is; a job that cannot be approved says why and
 * the others go on. @returns {Promise<{back:number[],refused:object[]}>}
 */
async function putBack(sub,dir,ids,parts,most=MOST_BACK){
 const inLine=new Set(batch.open(batch.read(dir)).map(entry=>entry.postingId)),wanted=[...new Set(ids)],jobs=[],refused=[];
 for(const postingId of wanted.filter(id=>!inLine.has(id)).slice(0,most)){
  try{const built=packet.build(await parts.material(sub,postingId));replacePaused(dir,postingId);jobs.push({postingId,packetDigest:built.packetDigest});}
  catch(error){if(!known(error))throw error;refused.push({postingId,code:error.code||'refused',why:error.message});}
 }
 const already=wanted.filter(id=>inLine.has(id));
 if(!jobs.length)return {back:already,refused};
 // The queue's own approval, with the queue's own helpers: a job whose documents are stale goes to Generate again first.
 const answer=await batchRoutes.approveJobs(dir,sub,{jobs,approved:true},{approve:parts.approve,posting:id=>parts.postingRow(sub,id),
  regenerate:list=>regenRoutes.queueJobs(sub,dir,{jobs:list,confirmed:true})});
 const out=new Map(answer.refused.map(item=>[item.postingId,item]));
 return {back:[...already,...jobs.map(job=>job.postingId).filter(id=>!out.has(id)||out.get(id).code==='already_queued')],
  refused:[...refused,...answer.refused.filter(item=>item.code!=='already_queued')]};
}
/**
 * @description Carry out one answer: the jobs that stopped on it go back in Fill in several, and the cards still waiting are
 * said back for the page to answer (it picks the card's own option with these words, or types them in its box).
 * @param {object} item {kind, value, jobs} @returns {Promise<object>}
 */
async function carryOut(sub,dir,item,parts,most=MOST_BACK){
 const ended=item.jobs.filter(job=>!job.live).map(job=>job.postingId),waiting=item.jobs.filter(job=>job.live&&job.card);
 const {back,refused}=ended.length&&most>0?await putBack(sub,dir,ended,parts,most):{back:[],refused:[]};
 await review.noteBack(dir,item.key,back);
 return {back,refused,answerCards:waiting.map(job=>({card:job.card,value:item.value,postingId:job.postingId}))};
}
/** @description Merge what several answers did. @param {object[]} done @returns {{back:number[],refused:object[],answerCards:object[]}} */
function merged(done){return {back:[...new Set(done.flatMap(one=>one.back))],refused:done.flatMap(one=>one.refused),answerCards:done.flatMap(one=>one.answerCards)};}
/** @description The person's job rows by posting id. @param {string} sub @returns {Function} */
const rowsFor=sub=>ids=>didnt.jobRows(sub,ids);
/** @description Whether Answer written questions without my review is on; off when Saved answers cannot be read. */
function autoOn(dir){try{return answers.read(dir).written.auto;}catch(error){logger.error({err:error},'saved answers unreadable; written questions wait for review');return false;}}
/**
 * @description POST /answers-to-review/refresh: learn, give answers back, use ready drafts when the switch is on, ask for the
 * drafts still missing. @param {object} body {cards?} The waiting cards the person's page read. @returns {Promise<object>}
 */
async function refresh(ctx,sub,dir,body,parts){
 if(Object.keys(body).some(key=>key!=='cards')||body.cards!==undefined&&(!Array.isArray(body.cards)||body.cards.length>50))
  review.fail('invalid_request','Send only the waiting question cards your page read.',400);
 const rowsOf=rowsFor(sub),learned=await review.refresh(dir,body.cards||[],rowsOf,{auto:autoOn(dir)}),done=[];
 let room=MOST_BACK;
 for(const item of learned.work){
  try{const did=await carryOut(sub,dir,item,parts,room);room-=did.back.length+did.refused.length;done.push(did);}
  catch(error){logger.error({err:error,kind:item.kind},'an answer was kept but its jobs were not put back');done.push({back:[],refused:[],answerCards:[]});}
 }
 const drafting=await startDrafts(ctx,sub,dir,learned.draftable);
 return {...review.view(dir,rowsOf),...merged(done),drafting:drafting?.started===true};
}
/** @description POST /answers-to-review/approve: keep the person's answer and put every job that stopped on it back. @returns {Promise<object>} */
async function approve(sub,dir,body,parts){
 const decision=review.checkDecision(body),rowsOf=rowsFor(sub),item=await review.decide(dir,decision,rowsOf);
 const done=await carryOut(sub,dir,item,parts);
 logger.info({kind:item.kind,how:item.how,back:done.back.length,refused:done.refused.length,cards:done.answerCards.length},'answer to review approved');
 return {...review.view(dir,rowsOf),...done,kept:item.kind!=='check'};
}
/**
 * @description Mount Answers to review on the assisted application's router. @param {import('express').Router} router
 * @param {Function} run The router's own signed-in wrapper. @param {object} parts {ctx, approve, material, postingRow}
 * @returns {void}
 */
function register(router,run,parts){
 const {ctx}=parts,one=body=>{if(Object.keys(body||{}).join()!=='key'||!/^k:[a-f0-9]{32}$/.test(body.key))review.fail('invalid_request','Name one question.',400);return body.key;};
 router.get('/answers-to-review-ui',createCareerToolFileHandler('career-answers-review.html'));
 router.get('/answers-to-review',run(async(_req,res,sub,dir)=>res.json(review.view(dir,rowsFor(sub)))));
 router.post('/answers-to-review/refresh',run(async(req,res,sub,dir)=>res.json(await refresh(ctx,sub,dir,req.body||{},parts))));
 router.post('/answers-to-review/approve',run(async(req,res,sub,dir)=>res.json(await approve(sub,dir,req.body||{},parts))));
 router.post('/answers-to-review/skip',run(async(req,res,sub,dir)=>{await review.setState(dir,one(req.body),'skipped',rowsFor(sub));res.json(review.view(dir,rowsFor(sub)));}));
 router.post('/answers-to-review/reopen',run(async(req,res,sub,dir)=>{await review.setState(dir,one(req.body),'open',rowsFor(sub));res.json(review.view(dir,rowsFor(sub)));}));
}
module.exports={register,refresh,approve,putBack,engineBusy,startDrafts};
