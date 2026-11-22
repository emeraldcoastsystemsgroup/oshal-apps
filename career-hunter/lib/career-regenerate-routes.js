/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-REGEN (Roger, 2026-11-21: 200 applications by Monday; his 251 open jobs need Generate résumé & cover letter again, and one at a time that is 251 presses): Generate again, the routes, every one the signed-in person's own. GET /regenerate/older lists his open jobs whose documents are older than today's Career. POST /regenerate puts the jobs he chose in his queue (at most 300 in one run; a job applied or later, removed, closed by its employer or held by an approved or submitted application is refused with its reason). POST /regenerate/advance moves the queue on one step: it settles the job Career wrote last (done, or failed with its reason and tried once more), takes the next job, and in the step after starts it through the job page's own Generate (startGeneration in src-routes/career-board-routes.ts: the job's tailoring notes, its Other experience choice, its draft), one job at a time and never while any Career run of his holds his store. A job is taken in one step and started in the next because on the native kernel a background run's writes are kept only when it succeeds: the take is saved first, so a run that is lost still counts as a try. A job he generated himself after the queue took it is skipped: his press wins. The page calls advance every few seconds; the career-regenerate schedule calls it every minute, so it goes on with no Career page open. GET /regenerate reads the queue; /pause, /go-on, /stop and /clear change it.
 */
'use strict';
const {randomUUID}=require('node:crypto');
const {createChildLogger}=require('@/shared/logger');
const {callerSub,findUserPaths,openUserDb}=require('../routes/career-user-store');
const board=require('./career-board-state'),drafts=require('./career-application-draft'),runs=require('./career-apply-runs');
const submissions=require('./career-submission-queue'),experienceBank=require('./career-experience-bank');
const workflowRoutes=require('./career-workflow-routes'),pasted=require('./career-pasted-details');
const q=require('./career-regenerate');
const logger=createChildLogger({module:'career-regenerate-routes'});
/** A job taken this long ago and still not started was started by a run that was lost (or nothing came to start it). */
const CLAIM_FRESH_MS=3*60*1000;
/** The kernel ends a background run at 30 minutes. */
const RUN_LIMIT_MS=31*60*1000;
/** A run just started may not hold the store yet off the native kernel. */
const GRACE_MS=5000;
const W={
 applied:'Already applied. Career keeps a sent application’s documents as they were.',
 removed:'You removed this job, so Career left it alone.',
 closed:'The employer’s posting is no longer open.',
 held:'This application has approved or submitted work, so its documents are kept as they are.',
 gone:'This job is no longer in Career.',
 yours:'You generated this job’s documents yourself after Generate again took it, so Career left them as you made them.',
 stopped:'The generation stopped before it finished, so nothing was saved.',
 tooLong:'Career did not finish this job within 30 minutes.',
 waiting:'Waiting for Career to finish what it is doing on your account.',
 notReached:'Stopped before Career reached it.',
 choose:'This job has no Other experience choice yet. Open it, choose its Other experience, and generate it there.',
};
/** The engine's reason codes, in words. */
const REASONS={resume_required:'Upload your résumé first.',posting_not_found:'This posting is no longer available.',
 score_unavailable:'Career could not check this job’s fit, so it made no documents.',renderer_unavailable:'This server cannot make PDF documents right now.',
 already_submitted:'This application is already submitted.',job_details_unavailable:pasted.NEEDED,job_context_unavailable:pasted.NEEDED,job_details_needed:pasted.NEEDED,
 job_context_too_large:'The employer’s description is too large to prepare in one request.',profile_too_large_for_scoring:'Your career profile is too large for one scoring request.',
 model_identity_unavailable:'Career’s writer was not available.',model_identity_mismatch:'Career’s writer was not available.',
 experience_selection_invalid:'Your other experience changed. Open the job and choose it again.',experience_selection_changed:'Your other experience changed. Open the job and choose it again.',
 experience_unavailable:'Your other experience could not be read. Open the job and choose it again.',preparation_failed:'Career could not make the documents.',
 stopped:W.stopped,too_long:W.tooLong,choose:W.choose};
/** Reasons another try cannot change: the job's own posting, description, choice or state. */
const NO_RETRY=new Set(['resume_required','posting_not_found','already_submitted','job_details_unavailable','job_context_unavailable','job_details_needed','pasted_details_invalid',
 'job_context_too_large','profile_too_large_for_scoring','experience_selection_invalid','experience_selection_changed','experience_unavailable','application_locked','choose']);
const ROW=`SELECT s.posting_id AS id,s.status,s.resume_path,s.cover_path,s.ai_fit_score,p.active,p.url,p.title,c.name AS company,
 CASE WHEN s.resume_path IS NOT NULL AND s.resume_path<>'' THEN 1 ELSE 0 END AS has_resume,
 CASE WHEN s.cover_path IS NOT NULL AND s.cover_path<>'' THEN 1 ELSE 0 END AS has_cover
 FROM user_signals s JOIN corpus.postings_corpus p ON p.id=s.posting_id LEFT JOIN corpus.companies c ON c.id=p.company_id`;

/** @description His job rows (all with documents, or the named ones), by id. @param {string} sub @param {number[]} [ids] @returns {Map<number,object>} */
function jobRows(sub,ids){
 const db=openUserDb(sub);if(!db)return new Map();
 try{
  const rows=ids?db.prepare(`${ROW} WHERE s.posting_id IN (${ids.map(()=>'?').join(',')})`).all(...ids):db.prepare(`${ROW} WHERE s.resume_path IS NOT NULL AND s.resume_path<>''`).all();
  return new Map(rows.map(row=>[Number(row.id),{...row,id:Number(row.id)}]));
 }finally{try{db.close();}catch(error){logger.error({err:error},'regenerate job database close failed');}}
}
/** @description The jobs with approved or submitted work: a held submission, or a run Career sent. @param {string} dir @returns {Set<number>} */
function heldIds(dir){
 const held=new Set(),latest=new Map();
 for(const item of Object.values(submissions.read(dir).items)){
  if(item.status==='cancelled')continue;const seen=latest.get(item.postingId);
  if(!seen||item.createdAt>seen.createdAt||item.createdAt===seen.createdAt&&item.updatedAt>seen.updatedAt)latest.set(item.postingId,item);
 }
 for(const [id,item] of latest)if(drafts.HELD.has(item.status))held.add(id);
 for(const run of Object.values(runs.read(dir).runs))if(run.status==='submitted'||run.status==='not_seen'&&run.pressedByCareer)held.add(run.postingId);
 return held;
}
/** @description Why a job is not open for new documents, as [code, words], or null. @param {object|undefined} row @param {Set<number>} held */
function closedWhy(row,held){
 if(!row)return ['not_found',W.gone];
 if(row.status==='dismissed')return ['removed',W.removed];
 if(q.CLOSED.has(row.status||''))return ['applied',W.applied];
 if(row.active===0)return ['closed',W.closed];
 if(held.has(row.id))return ['held',W.held];
 return null;
}
/** @description Whether he generated this job himself after the queue took it (or is generating it now): his press wins. */
function hisOwn(saved,entry){
 const latest=saved.generationDraft?.requestId||saved.requestId;
 if(!latest||entry.requestIds.includes(latest))return false;
 const at=Date.parse(saved.requestedAt||saved.completedAt||'');
 return Number.isFinite(at)&&at>=Date.parse(entry.queuedAt);
}
/** @description A failure: tried once more while the queue runs and the reason allows it, else ended with its words. */
function failed(state,entry,code,now,said){
 const why=q.words(said)||REASONS[code]||REASONS.preparation_failed;
 if(entry.attempts<2&&!NO_RETRY.has(code)&&state.state!=='stopped'){Object.assign(entry,{state:'queued',retry:'Trying once more: '+why,note:'',claimedAt:null,startedAt:null});return;}
 q.end(entry,'failed',why,now);
 logger.info({postingId:entry.postingId,code,attempts:entry.attempts},'regenerate job failed');
}
/**
 * @description Settle the job Career is writing: its receipt ends it (done or failed); while a run of his still holds the
 * store it is still being written; a run gone without its receipt failed. @returns {Promise<boolean>} True while still written.
 */
async function settle(sub,dir,state,entry,deps,now){
 const saved=board.readBoardState(dir).jobs[entry.postingId]||{},mine=entry.requestIds.at(-1),began=Date.parse(entry.startedAt||'');
 if(saved.requestId===mine&&saved.completedAt){
  if(saved.phase==='ready'){q.end(entry,'done','',now);logger.info({postingId:entry.postingId,attempts:entry.attempts},'regenerate job done');}
  else failed(state,entry,saved.error||'preparation_failed',now);
  return false;
 }
 if(now-began>RUN_LIMIT_MS){failed(state,entry,'too_long',now);return false;}
 if(await deps.runInFlight(sub)||now-began<GRACE_MS)return true;
 failed(state,entry,'stopped',now);
 return false;
}
/** @description Whether a queued job may be taken now; ends it with its reason when it may not. @returns {boolean} */
function takeable(dir,state,entry,row,held,now){
 const why=closedWhy(row,held);
 if(why){q.end(entry,'skipped',why[1],now);return false;}
 if(hisOwn(board.readBoardState(dir).jobs[entry.postingId]||{},entry)){q.end(entry,'skipped',W.yours,now);return false;}
 return true;
}
/** @description Take the next job in line (saved before it starts, so a lost run still counts as a try). @returns {object|null} */
function claimNext(sub,dir,state,now){
 const waiting=state.entries.filter(entry=>entry.state==='queued');if(!waiting.length)return null;
 const rows=jobRows(sub,waiting.map(entry=>entry.postingId)),held=heldIds(dir);
 for(const entry of waiting){
  if(!takeable(dir,state,entry,rows.get(entry.postingId),held,now))continue;
  Object.assign(entry,{state:'claimed',attempts:entry.attempts+1,requestIds:[...entry.requestIds,randomUUID()].slice(-4),claimedAt:q.iso(now),note:''});
  return entry;
 }
 return null;
}
/** @description What the job page's Generate sends for this job: its own tailoring and Other experience choice, else his last choice. */
function generateBody(dir,entry,row){
 const application=drafts.view(dir,entry.postingId,row);
 if(application.locked)return {skip:W.held};
 const tailoring=workflowRoutes.tailoringFor(dir,application.draft);
 if(!tailoring)return {code:'choose'};
 return {body:{documents:true,requestId:entry.requestIds.at(-1),guidance:tailoring.guidance||'',experienceIds:tailoring.experienceIds||[],
  experienceRevision:experienceBank.read(dir).revision,draftRevision:Number(application.draft.revision)||0,experienceChosen:tailoring.experienceChosen===true}};
}
/** @description Whether a start was refused only because Career is busy on his account (wait, then try again). */
function busy(started){
 const said=String(started.body?.error||'');
 return started.status===429||started.body?.error==='career_run_in_progress'||started.status===409&&/already running/i.test(said);
}
/** @description Start the job taken in the step before, through the job page's own Generate. */
async function startTaken(sub,dir,state,entry,deps,now){
 if(now-Date.parse(entry.claimedAt)>CLAIM_FRESH_MS){failed(state,entry,'stopped',now);return;}
 const row=jobRows(sub,[entry.postingId]).get(entry.postingId);
 if(!takeable(dir,state,entry,row,heldIds(dir),now))return;
 if(await deps.runInFlight(sub)){Object.assign(entry,{note:W.waiting,claimedAt:q.iso(now)});return;}
 const made=generateBody(dir,entry,row);
 if(made.skip){q.end(entry,'skipped',made.skip,now);return;}
 if(made.code){failed(state,entry,made.code,now);return;}
 let started;
 try{started=await deps.generate(sub,entry.postingId,made.body);}
 catch(error){logger.error({err:error,postingId:entry.postingId},'regenerate start failed');failed(state,entry,'preparation_failed',now);return;}
 if(started.status===202){Object.assign(entry,{state:'running',startedAt:q.iso(now),note:''});logger.info({postingId:entry.postingId,attempts:entry.attempts},'regenerate job started');return;}
 if(busy(started)){Object.assign(entry,{note:W.waiting,claimedAt:q.iso(now)});return;}
 failed(state,entry,started.body?.code||(started.status===400?'pasted_details_invalid':'preparation_failed'),now,started.body?.error);
}
/**
 * @description Move his queue on one step: settle the job being written, then start the job taken (or take the next).
 * Starts at most one, and never while a run of his holds his store. @param {string} sub @param {string} dir
 * @param {{generate:Function,runInFlight:Function}} deps @returns {Promise<object|null>} The queue, or null when he has none.
 */
async function advance(sub,dir,deps){
 const answer=await q.locked(dir,async()=>{
  const now=Date.now(),state=q.read(dir);if(!state)return null;
  const running=state.entries.find(entry=>entry.state==='running');
  if(running&&await settle(sub,dir,state,running,deps,now))return q.publicQueue(q.write(dir,state,now));
  if(state.state==='running'){
   const taken=state.entries.find(entry=>entry.state==='claimed');
   if(taken)await startTaken(sub,dir,state,taken,deps,now);else claimNext(sub,dir,state,now);
  }
  if(!q.open(state).length&&state.state!=='stopped')Object.assign(state,{state:'done',reason:''});
  return q.publicQueue(q.write(dir,state,now));
 });
 return answer?.busy?q.publicQueue(q.read(dir)):answer;
}
function checkBody(body){
 const jobs=body?.jobs;
 if(Object.keys(body||{}).some(key=>!['jobs','confirmed'].includes(key))||body.confirmed!==true||!Array.isArray(jobs)||!jobs.length||jobs.length>q.MOST
   ||jobs.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(jobs).size!==jobs.length)
  q.fail('invalid_request',`Choose from 1 to ${q.MOST} jobs and confirm.`,400);
 return jobs;
}
function newEntry(row,now){
 return {postingId:row.id,title:q.words(row.title,300),company:q.words(row.company,200),state:'queued',attempts:0,requestIds:[],reason:'',note:'',queuedAt:q.iso(now),claimedAt:null,startedAt:null,endedAt:null};
}
/**
 * @description Put the jobs he confirmed in his queue, in his order; a job refused keeps the others going. A queue that
 * ended is replaced; one going takes more while it has room. @param {string} sub @param {string} dir @param {object} body
 * {jobs:[posting ids], confirmed:true} @returns {Promise<{queue:object,refused:object[],added:number}>}
 */
async function queueJobs(sub,dir,body){
 const ids=checkBody(body);
 return q.locked(dir,async()=>{
  const now=Date.now(),current=q.read(dir),refused=[];
  const state=current&&!['done','stopped'].includes(current.state)?current:{version:1,id:randomUUID(),state:'running',reason:'',createdAt:q.iso(now),entries:[]};
  const waiting=new Set(q.open(state).map(entry=>entry.postingId)),rows=jobRows(sub,ids),held=heldIds(dir);let room=q.MOST-waiting.size,added=0;
  for(const id of ids){
   const row=rows.get(id),why=waiting.has(id)?['already_queued','Already in line to be generated again.']:closedWhy(row,held)
    ||(room<=0?['queue_full',`Career makes documents for at most ${q.MOST} jobs in one run. Add this one when the queue has room.`]:null);
   if(why){refused.push({postingId:id,code:why[0],why:why[1]});continue;}
   state.entries=state.entries.filter(entry=>entry.postingId!==id).concat(newEntry(row,now));room-=1;added+=1;waiting.add(id);
  }
  const ended=state.entries.filter(entry=>!['queued','claimed','running'].includes(entry.state));
  if(state.entries.length>q.MOST)state.entries=state.entries.filter(entry=>!ended.slice(0,state.entries.length-q.MOST).includes(entry));
  if(added){Object.assign(state,{state:'running',reason:''});q.write(dir,state,now);logger.info({added,refused:refused.length},'regenerate queue filled');}
  return {queue:q.publicQueue(added?state:current),refused,added};
 },{wait:10000});
}
/** @description Give a job taken but not started back to the line (a pause or stop is saved with no run). */
function untake(state){for(const entry of state.entries)if(entry.state==='claimed')Object.assign(entry,{state:'queued',attempts:Math.max(0,entry.attempts-1),claimedAt:null,note:''});}
/** @description A press on the panel: pause, go-on, stop or clear. @returns {Promise<object|null>} The queue. */
async function press(sub,dir,name,deps){
 const result=await q.locked(dir,async()=>{
  const now=Date.now(),state=q.read(dir);if(!state)q.fail('regenerate_not_found','You have no Generate again queue.',404);
  const going=!['done','stopped'].includes(state.state),writing=state.entries.some(entry=>entry.state==='running');
  if(name==='clear'){if(going)q.fail('regenerate_running','Stop Generate again before clearing it.');q.remove(dir);return {cleared:true};}
  if(!going)q.fail('regenerate_ended','This Generate again has ended. Select jobs and press Generate again to start another.');
  untake(state);
  if(name==='pause')Object.assign(state,{state:'paused',reason:writing?'Paused. Career finishes the job it is writing now and starts no other until you press Go on.':'Paused. Career starts no other job until you press Go on.'});
  else if(name==='go-on')Object.assign(state,{state:'running',reason:''});
  else{for(const entry of state.entries)if(entry.state==='queued')q.end(entry,'skipped',W.notReached,now);
   Object.assign(state,{state:'stopped',reason:writing?'Stopped. Career finishes the job it is writing now and starts no other.':'You stopped Generate again.'});}
  q.write(dir,state,now);return {};
 },{wait:10000});
 if(result.cleared)return null;
 return name==='go-on'?advance(sub,dir,deps):q.publicQueue(q.read(dir));
}
/** @description His open jobs whose documents are older than today's Career. @returns {{version:string,count:number,jobs:object[]}} */
function olderList(sub,dir){
 const held=heldIds(dir),jobs=q.olderJobs(dir,[...jobRows(sub).values()],id=>held.has(id));
 return {version:q.careerVersion(),count:jobs.length,jobs};
}
/**
 * @description Mount Generate again's routes. @param {import('express').Router} router
 * @param {{generate:Function,runInFlight:Function}} deps The job page's Generate (startGeneration) and the run check.
 * @returns {void}
 */
function register(router,deps){
 const run=handler=>async(req,res)=>{
  const sub=callerSub(req);if(!sub)return res.status(401).json({error:'unauthorized'});
  res.setHeader('Cache-Control','private, no-store');
  try{const owner=findUserPaths(sub);await handler(req,res,sub,owner?.userDir||null);}
  catch(error){
   if(error instanceof q.RegenerateError||error instanceof drafts.DraftError)return res.status(error.status||409).json({error:error.message,code:error.code});
   logger.error({err:error,path:req.path},'regenerate route failed');res.status(503).json({error:'Generate again is unavailable right now. Try again shortly.'});
  }
 };
 const empty=req=>{if(Object.keys(req.body||{}).length)q.fail('invalid_request','Press only the queue’s own buttons.',400);};
 const needStore=dir=>{if(!dir)q.fail('resume_required','Upload a résumé first.',404);return dir;};
 router.get('/regenerate',run(async(_req,res,_sub,dir)=>res.json({queue:dir?q.publicQueue(q.read(dir)):null})));
 router.get('/regenerate/older',run(async(_req,res,sub,dir)=>res.json(dir?olderList(sub,dir):{version:q.careerVersion(),count:0,jobs:[]})));
 router.post('/regenerate',run(async(req,res,sub,dir)=>res.json(await queueJobs(sub,needStore(dir),req.body||{}))));
 router.post('/regenerate/advance',run(async(req,res,sub,dir)=>{empty(req);res.json({queue:dir?await advance(sub,dir,deps):null});}));
 const plain=name=>run(async(req,res,sub,dir)=>{empty(req);res.json({queue:await press(sub,needStore(dir),name,deps)});});
 router.post('/regenerate/pause',plain('pause'));router.post('/regenerate/go-on',plain('go-on'));
 router.post('/regenerate/stop',plain('stop'));router.post('/regenerate/clear',plain('clear'));
}
module.exports={register,advance,queueJobs,press,olderList,REASONS,W};
