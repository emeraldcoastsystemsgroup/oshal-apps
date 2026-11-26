/** CHANGE LOG
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Lane APPLY-BATCH: Fill in several on my Chrome. The approval answers the form's site too ({site}), approve, bind, start, Go on, Career's writers and the job's row are exported, and the queue's routes (lib/career-apply-batch-routes.js: GET/POST /apply-batch, /advance, /pause, /go-on, /stop, /skip, /next, /clear) are mounted on this router with its signed-in wrapper, so each queued job is approved and started exactly as a single one.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | 1.76.3 (Roger's Honeycomb run, 2026-11-25: approved before a Job Apply computer was chosen, the kernel refused the start and failed the run's ticket; Go on then failed with "a failed ticket has no phase to dispatch", Stop could not cancel it, and a new approval of the job was refused for a day): Go on on a run that never started, whose ticket has ended, binds a fresh ticket and starts the same approved input on it.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Lane APPLY-I: POST /saved-answers also changes How Career fills in a form ({revision, flags}: input, window, submit), with Undo; the packet reads the settings into task.flags.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.72.0: the packet's Word résumé is the parse résumé, the one laid out for an employer's résumé parser: the packet's own Resume_Parse.docx when generation wrote it, else rendered from its application.json by docx_resume.py export-packet --kind parse (the same bytes every time). The executive Resume_ATS.docx stays a download and is no longer uploaded.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.71.0 (lane APPLY-G): the job's row carries its company's engine and token and the posting's engine id, as Career's source recorded them, so a company page that embeds an engine's form is filled at that engine's own address.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0: POST /saved-answers also switches the two Attestations ({revision, attest}) and undoes the last change ({revision, undo}); the packet reads the switches into task.attest.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0: Go on starts an attempt that was published but whose start was refused, instead of refusing it as not paused.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0 (Fill it in on my Chrome, design APPLY-ORBIT 5.1 to 5.4): the routes of an assisted application, every one the signed-in person's own. GET /apply-review/:postingId shows the exact packet (this job's Word and PDF résumé and its cover letter with their versions, the facts that may be typed, the résumé's roles with dates, education, the saved answers, the site and the stop at Review) and changes nothing. POST /apply-runs approves that exact packet and publishes its frozen input before any kernel call; /bind makes the career-apply ticket; /start starts the published attempt on executor orbit-apply-v1; /go-on publishes and starts the next attempt of a paused run while its approval lasts; /sync reads the kernel's record (career-apply-sync.js); /kept takes what the person's page read of the kernel's card route (GET /api/apply/cards `kept`, lane D) and writes it with Career's own writers. GET /apply-runs, /apply-runs/:id/receipt, /picture/:n and /confirmation read what was kept, each picture checked against its digest. GET and POST /saved-answers and the page GET /saved-answers-ui are Saved answers under Settings. A Word résumé is the packet's own Resume_ATS.docx when it has one, else rendered by docx_resume.py, which now gives the same bytes every time.
 */
'use strict';
const {Router}=require('express'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createChildLogger}=require('@/shared/logger');
const queue=require('./career-submission-queue'),drafts=require('./career-application-draft'),docx=require('./career-docx-export');
const packet=require('./career-apply-packet'),runs=require('./career-apply-runs'),answers=require('./career-apply-answers'),applySync=require('./career-apply-sync');
const batchRoutes=require('./career-apply-batch-routes');
const {callerSub,userPaths,openUserDb}=require('../routes/career-user-store');
const {loadAutofillProfile}=require('../routes/career-autofill-routes');
const {resolveContainedRegularFile}=require('../routes/career-resume-preview');
const {registerCareerAuthorization}=require('../routes/career-authorization');
const {runCareerCliAwait}=require('../routes/career-engine-dispatch');
const {createCareerToolFileHandler}=require('../routes/career-surface-routes');
const logger=createChildLogger({module:'career-apply-routes'});
const DONE=['applied','interview','offer','rejected'],MAX_DOCUMENT=350000,MAX_RECORD=4*1024*1024;
const LIMITS={wall_ms:2*60*60*1000,output_tokens:16000,artifact_bytes:12*1024*1024};
const PROMPT='Run only the approved browser-task.json form run on the person’s own Chrome. Enter only the approved values, stop at the employer’s Review page and never press Submit.';
const fail=(code,message,status=409)=>{throw new queue.SubmissionError(code,message,status);};

function contained(name,dir,limit=MAX_DOCUMENT){
 const file=typeof name==='string'&&name&&resolveContainedRegularFile(name,dir);if(!file)return null;
 const stat=fs.lstatSync(file);if(stat.nlink!==1||stat.size>limit)fail('packet_unavailable','An application document exceeds the size Career can send to your computer.');
 return fs.readFileSync(file);
}
function json(name,dir){const bytes=contained(name,dir,MAX_RECORD);if(!bytes)return null;try{return JSON.parse(bytes.toString('utf8'));}catch{fail('record_unreadable','Your record could not be read.',503);}}
/** This job's Word résumé for upload forms: the packet's own Resume_Parse.docx (what Download gives as Resume (for upload)), else a render of its application.json. */
async function wordResume(folder,dir){
 const own=contained(path.join(folder,'Resume_Parse.docx'),dir);if(own)return own;
 const source=resolveContainedRegularFile(path.join(folder,'application.json'),dir);
 if(!source)fail('packet_unavailable','This job’s Word résumé is unavailable. Generate the documents again.');
 return (await docx.renderPacketArtifact({packetJsonPath:source,kind:'parse',format:'docx'})).bytes;
}
function postingRow(sub,id){
 if(!Number.isSafeInteger(id)||id<1)fail('invalid_posting','Select one job.',400);
 const db=openUserDb(sub);if(!db)fail('no_data','Prepare an application first.',404);
 try{return db.prepare(`SELECT p.id,p.title,p.url,p.active,p.ats_job_id AS atsJobId,c.name AS company,c.ats_type AS atsType,c.ats_token AS atsToken,s.status,s.resume_path,s.cover_path
  FROM user_signals s JOIN corpus.postings_corpus p ON p.id=s.posting_id JOIN corpus.companies c ON c.id=p.company_id WHERE s.posting_id=?`).get(id);}finally{db.close();}
}
/**
 * @description Everything one approval covers, read by the server from the person's own store: never from the page.
 * @param {string} sub The signed-in person. @param {number} id The job. @returns {Promise<object>} material for career-apply-packet build().
 */
async function material(sub,id){
 const posting=postingRow(sub,id);
 if(!posting||!posting.active)fail('posting_unavailable','This employer posting is unavailable.');
 if(DONE.includes(posting.status))fail('already_submitted','This application is already recorded.');
 const {userDir}=userPaths(sub);drafts.assertReady(userDir,id,{status:posting.status,has_resume:!!posting.resume_path,has_cover:!!posting.cover_path});
 const resumePdf=contained(posting.resume_path,userDir);if(!resumePdf)fail('packet_unavailable','Generate and review both the résumé and cover letter first.');
 const folder=path.dirname(resolveContainedRegularFile(posting.resume_path,userDir)),record=json(path.join(folder,'application.json'),userDir);
 const saved=answers.read(userDir);
 return {posting,folder,profile:await loadAutofillProfile(sub),standing:answers.standingFacts(saved),answers:saved.answers,
  careerDb:json(path.join(userDir,'career_db.json'),userDir)||{},resume:record?.generated?.resume||{},
  attest:saved.attest,flags:saved.flags,resumeDocx:await wordResume(folder,userDir),resumePdf,coverPdf:posting.cover_path?contained(posting.cover_path,userDir):null};
}
/** Career's own writers for a run: the main résumé's revision-checked edit, the application's row, the job's folder. */
function writers(ctx,sub,dir,run){
 return {
  folder:()=>{try{const row=postingRow(sub,run.postingId),file=row&&resolveContainedRegularFile(row.resume_path,dir);return file?path.dirname(file):null;}
   catch(error){logger.error({err:error,postingId:run.postingId},'apply receipt folder unavailable');return null;}},
  month:async edit=>{
   const file=path.join(dir,'career_db.json'),revision=crypto.createHash('sha256').update(fs.readFileSync(file,'utf8')).digest('hex');
   const result=await runCareerCliAwait(ctx.pool,sub,['resume','base-patch'],{CH_RESUME_DOC:JSON.stringify({revision,edits:[edit]})});
   const start=String(result.out||'').indexOf('{');let parsed=null;try{parsed=start>=0?JSON.parse(String(result.out).slice(start)):null;}catch(error){logger.error({err:error},'apply month write answer unreadable');}
   if(parsed?.ok!==true||!result.ok)logger.error({postingId:run.postingId,error:parsed?.error||result.err},'apply month write refused');
   return parsed?.ok===true&&result.ok===true;
  },
  recordSubmitted:async(saved,confirmation)=>{
   const db=openUserDb(sub,false);if(!db)throw Error('Career store unavailable');
   try{if(!db.prepare('SELECT posting_id FROM user_signals WHERE posting_id=?').get(saved.postingId))throw Error('Original application row unavailable');
    db.prepare(`UPDATE user_signals SET status=CASE WHEN status IN ('interview','offer','rejected') THEN status ELSE 'applied' END,
     applied_at=COALESCE(applied_at,?),application_source='verified-submission',application_task_id=?,confirmation_path=? WHERE posting_id=?`).run(saved.submittedAt,saved.workId,confirmation,saved.postingId);}
   finally{db.close();}
  }};
}
const isId=value=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value||'');
/**
 * @description Approve one job's exact packet: the digest the person reviewed must be the packet as it is now. Publishes
 * the first attempt's frozen input; starts nothing. @returns {Promise<object>} {ok, deduped, run}
 */
async function approve(dir,sub,body){
 if(Object.keys(body||{}).some(key=>!['postingId','packetDigest','approved'].includes(key)))fail('invalid_request','Only the job and the exact packet you reviewed are accepted.',400);
 const found=await material(sub,Number(body?.postingId)),built=packet.build(found);
 if(body.approved!==true||body.packetDigest!==built.packetDigest)fail('packet_review_required','Review this job, its documents and the facts Career may type before approving.',428);
 const {run,deduped}=runs.approve(dir,built,found.posting);
 if(!run.attempts.length)runs.publish(dir,run.id,packet.input({id:run.id,attempt:1,expiresAt:Date.parse(run.expiresAt),task:built.task}));
 return {ok:true,deduped,run:runs.publicRun(runs.get(dir,run.id)),site:{id:built.site.id,name:built.site.name}};
}
/** @description Bind the run's own career-apply ticket; making it starts nothing. @returns {Promise<object>} */
async function bind(dir,id,tickets,sub){
 const run=runs.get(dir,id);if(run.nativeTicketId)return {ok:true,run:runs.publicRun(run)};
 if(Date.parse(run.expiresAt)<=Date.now())fail('approval_expired','This approval ended. Review the application again.');
 const ticket=await tickets.createTicket({ticketType:'career-apply',ownerSub:sub}),ticketId=ticket?.ticketId||ticket?.id;
 if(!isId(ticketId))fail('ticket_unavailable','The application ticket was not created.',503);
 return {ok:true,run:runs.publicRun(runs.update(dir,id,{nativeTicketId:ticketId}))};
}
/**
 * @description Start the run's latest published attempt with its byte-identical input. An attempt already started is
 * never started again; a lost acknowledgement retries the same bytes. @returns {Promise<object>}
 */
async function start(dir,id,tickets){
 const run=runs.get(dir,id),attempt=run.attempts.at(-1);
 if(!attempt)fail('input_unavailable','The approved input is unavailable.');
 if(attempt.workId||['submitted','stopped','not_seen'].includes(run.status))return {ok:true,run:runs.publicRun(run)};
 if(!run.nativeTicketId)fail('ticket_not_bound','Save the application ticket before starting.');
 if(Date.parse(run.expiresAt)<=Date.now())fail('approval_expired','This approval ended. Review the application again.');
 const bytes=Buffer.from(JSON.stringify(runs.snapshot(dir,id,attempt.n)));let started;
 try{started=await tickets.startTicket(run.nativeTicketId,{executor:applySync.EXECUTOR,prompt:PROMPT,
  files:[{path:'browser-task.json',digest:[...Buffer.from(queue.digest(bytes),'hex')],bytes:[...bytes]}],limits:LIMITS});}
 catch(error){
  if(error?.code==='apply_device_unavailable')fail('apply_device_unavailable',String(error.message||'')||'Your chosen Job Apply device is unavailable.');
  throw error;
 }
 const workId=started?.envelope?.id;if(!isId(workId))fail('dispatch_unavailable','Check this application before starting again; the start was not acknowledged.',503);
 return {ok:true,run:runs.publicRun(runs.update(dir,id,{attemptWork:{n:attempt.n,workId},status:'queued',reason:'',live:null}))};
}
/**
 * @description Whether a run's ticket has ended in the kernel (failed, cancelled or completed), so nothing can be
 * dispatched on it again. A ticket that cannot be read is taken as not ended. @param {object} tickets The ticket port.
 * @param {string} id The ticket. @returns {Promise<boolean>}
 */
async function ticketEnded(tickets,id){
 if(typeof tickets?.getTicket!=='function')return false;
 let ticket;try{ticket=await tickets.getTicket(id);}catch(error){logger.error({err:error,ticketId:id},'apply run ticket read failed');return false;}
 return ['failed','cancelled','completed'].includes(String(ticket?.status||ticket?.state||''));
}
/**
 * @description Go on: a paused run (or one whose computer stopped) starts its next attempt over the same approved task,
 * while the approval lasts; an attempt published but not started (its start was refused) is started as it is. Nothing was submitted, so the next attempt only reads and enters again. @returns {Promise<object>}
 */
async function goOn(dir,id,tickets,sub){
 const run=runs.get(dir,id),last=run.attempts.at(-1);
 if(last&&!last.workId&&run.status==='approved'){
  // A refused start (no Job Apply computer chosen) fails the run's ticket in the kernel: a fresh ticket carries the same approved input.
  if(run.nativeTicketId&&await ticketEnded(tickets,run.nativeTicketId)){runs.update(dir,id,{nativeTicketId:null});await bind(dir,id,tickets,sub);}
  return start(dir,id,tickets);
 }
 if(!['paused','failed'].includes(run.status)||!last?.workId)fail('run_not_paused','This application is not paused.');
 if(Date.parse(run.expiresAt)<=Date.now())fail('approval_expired','This approval ended. Review the application again.');
 const {requestDigest,...bound}=runs.snapshot(dir,id,last.n),next={...bound,attempt:last.n+1};
 runs.publish(dir,id,{...next,requestDigest:queue.jsonDigest(next)});runs.update(dir,id,{status:'approved',reason:''});
 return start(dir,id,tickets);
}
function kept(dir,name){
 const file=typeof name==='string'&&resolveContainedRegularFile(path.join(dir,name),dir);
 if(!file||fs.lstatSync(file).nlink!==1)fail('evidence_unavailable','That record is not kept.',404);return file;
}
function sendPicture(res,dir,name,hash){
 const file=kept(dir,name);if(queue.digest(fs.readFileSync(file))!==hash)fail('evidence_changed','This picture changed after Career kept it.');
 res.type('png').sendFile(file);
}
function registerEvidence(router,run){
 router.get('/apply-runs',run(async(req,res,_sub,dir)=>{
  const postingId=req.query?.postingId===undefined?null:Number(req.query.postingId);
  res.json({runs:Object.values(runs.read(dir).runs).filter(item=>postingId===null||item.postingId===postingId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,100).map(runs.publicRun)});
 }));
 router.get('/apply-runs/:id/receipt',run(async(req,res,_sub,dir)=>{
  const saved=runs.get(dir,req.params.id);if(!saved.receiptFile)fail('receipt_unavailable','Nothing has been recorded for this application yet.',404);
  const receipt=JSON.parse(fs.readFileSync(kept(dir,saved.receiptFile),'utf8'));if(receipt?.runId!==saved.id)fail('evidence_changed','This receipt changed.');res.json(receipt);
 }));
 router.get('/apply-runs/:id/picture/:attempt/:n',run(async(req,res,_sub,dir)=>{
  const saved=runs.get(dir,req.params.id),picture=(saved.pictures||[]).find(item=>item.attempt===Number(req.params.attempt)&&item.n===Number(req.params.n));
  if(!picture)fail('evidence_unavailable','That picture is not kept.',404);sendPicture(res,dir,picture.file,picture.sha256);
 }));
 router.get('/apply-runs/:id/confirmation',run(async(req,res,_sub,dir)=>{
  const saved=runs.get(dir,req.params.id);if(saved.status!=='submitted'||!saved.confirmationFile)fail('evidence_unavailable','No confirmation is kept.',404);
  sendPicture(res,dir,saved.confirmationFile,saved.confirmationSha256);
 }));
}
function registerAnswers(router,run){
 router.get('/saved-answers-ui',createCareerToolFileHandler('career-saved-answers.html'));
 router.get('/saved-answers',run(async(_req,res,_sub,dir)=>res.json(answers.read(dir))));
 router.post('/saved-answers',run(async(req,res,_sub,dir)=>{
  const body=req.body||{},keys=Object.keys(body);
  const actions=['standing','remove','attest','flags','undo'].filter(key=>key in body);
  if(keys.some(key=>key!=='revision'&&!actions.includes(key))||actions.length!==1)fail('invalid_request','Change your standing answers, attestations or how Career fills in a form, remove one saved answer, or undo the last change.',400);
  const action=actions[0],writer={standing:answers.setStanding,remove:answers.remove,attest:answers.setAttest,flags:answers.setFlags,undo:answers.undo}[action];
  res.json(writer(dir,body.revision,body[action]));
 }));
}
/**
 * @description The assisted application routes, mounted at /api/career-hunter. Every route answers only the signed-in
 * person and reads or writes only their own store. @param {object} ctx The package context (ticketService, pool).
 * @returns {import('express').Router}
 */
function createCareerApplyRoutes(ctx){
 registerCareerAuthorization(ctx);
 const router=Router();
 const run=handler=>async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const sub=callerSub(req);if(!sub)return res.status(401).json({error:'unauthorized'});
  try{await handler(req,res,sub,userPaths(sub).userDir);}
  catch(error){
   const known=error instanceof queue.SubmissionError||error instanceof drafts.DraftError;
   if(!known)logger.error({err:error,path:req.path},'assisted application request failed');
   res.status(known?error.status:503).json({error:known?error.message:'Assisted application service unavailable; your approval is kept.',code:error.code||'apply_unavailable'});
  }
 };
 router.get('/apply-review/:postingId',run(async(req,res,sub)=>res.json(packet.review(await material(sub,Number(req.params.postingId))))));
 router.post('/apply-runs',run(async(req,res,sub,dir)=>res.json(await approve(dir,sub,req.body||{}))));
 const empty=req=>{if(Object.keys(req.body||{}).length)fail('invalid_request','Select only this application.',400);};
 router.post('/apply-runs/:id/bind',run(async(req,res,sub,dir)=>{empty(req);res.json(await bind(dir,req.params.id,ctx.ticketService,sub));}));
 router.post('/apply-runs/:id/start',run(async(req,res,_sub,dir)=>{empty(req);res.json(await start(dir,req.params.id,ctx.ticketService));}));
 router.post('/apply-runs/:id/go-on',run(async(req,res,sub,dir)=>{empty(req);res.json(await goOn(dir,req.params.id,ctx.ticketService,sub));}));
 router.post('/apply-runs/:id/sync',run(async(req,res,sub,dir)=>{empty(req);const saved=runs.get(dir,req.params.id);
  res.json({ok:true,run:await applySync.sync(dir,req.params.id,ctx.ticketService,writers(ctx,sub,dir,saved))});}));
 router.post('/apply-runs/:id/kept',run(async(req,res,sub,dir)=>{
  const body=req.body||{};
  if(Object.keys(body).some(key=>key!=='kept')||!Array.isArray(body.kept)||body.kept.length>100)fail('invalid_request','Send only the answers you kept on this application’s cards.',400);
  const saved=runs.get(dir,req.params.id),keptCards=await applySync.keepCards(dir,saved,body.kept,writers(ctx,sub,dir,saved));
  res.json({ok:true,run:runs.publicRun(runs.update(dir,saved.id,{keptCards}))});
 }));
 registerEvidence(router,run);registerAnswers(router,run);
 batchRoutes.register(router,run,{ctx,approve,bind,start,goOn,writers,postingRow});
 return router;
}
module.exports={createCareerApplyRoutes,material,approve,bind,start,goOn,writers,postingRow};
