/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Serve per-press pictures only to their original owner with a digest check on every read.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Expose owner-only unknown resolution and hash-checked retained browser pictures.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Expose caller-owned packet review, explicit one-job approval, recoverable native dispatch and retained confirmation through the original Career namespace.
 */
'use strict';
const {Router}=require('express'),fs=require('node:fs');
const queue=require('./career-submission-queue'),native=require('./career-submission-native');
const drafts=require('./career-application-draft');
const {callerSub,userPaths,openUserDb}=require('../routes/career-user-store');
const {loadAutofillProfile}=require('../routes/career-autofill-routes');
const {resolveContainedRegularFile}=require('../routes/career-resume-preview');
const {registerCareerAuthorization}=require('../routes/career-authorization');
function pdf(name,dir){
  const file=typeof name==='string'&&resolveContainedRegularFile(name,dir);
  if(!file)throw new queue.SubmissionError('packet_unavailable','Generate and review both application documents first.');
  const stat=fs.lstatSync(file);
  if(stat.nlink!==1||stat.size>350000)throw new queue.SubmissionError('packet_unavailable','The application document exceeds the browser worker size limit.');
  return fs.readFileSync(file);
}
async function material(sub,id){
  if(!Number.isSafeInteger(id)||id<1)throw new queue.SubmissionError('invalid_posting','Select one job.',400);
  const db=openUserDb(sub);if(!db)throw new queue.SubmissionError('no_data','Prepare an application first.',404);
  let posting;
  try{posting=db.prepare(`SELECT p.id,p.title,p.url,p.active,c.name AS company,s.status,s.resume_path,s.cover_path
    FROM user_signals s JOIN corpus.postings_corpus p ON p.id=s.posting_id
    JOIN corpus.companies c ON c.id=p.company_id WHERE s.posting_id=?`).get(id);}finally{db.close();}
  if(!posting||!posting.active)throw new queue.SubmissionError('posting_unavailable','This employer posting is unavailable.');
  if(['applied','interview','offer','rejected'].includes(posting.status))throw new queue.SubmissionError('already_submitted','This application is already recorded.');
  const {userDir}=userPaths(sub),profile=native.followupProfile(userDir,id,await loadAutofillProfile(sub));
  drafts.assertReady(userDir,id,{status:posting.status,has_resume:!!posting.resume_path,has_cover:!!posting.cover_path});
  return {posting,profile,resume:pdf(posting.resume_path,userDir),cover:pdf(posting.cover_path,userDir)};
}
function record(sub){return async(saved,confirmation)=>{
  const db=openUserDb(sub,false);if(!db)throw Error('Career store unavailable');
  try{
    const found=db.prepare('SELECT posting_id FROM user_signals WHERE posting_id=?').get(saved.postingId);
    if(!found)throw Error('Original application row unavailable');
    db.prepare(`UPDATE user_signals SET status=CASE WHEN status IN ('interview','offer','rejected') THEN status ELSE 'applied' END,
      applied_at=COALESCE(applied_at,?), application_source=CASE WHEN application_source='verified-submission' THEN application_source ELSE 'worker-reported' END,
      application_task_id=?,confirmation_path=? WHERE posting_id=?`).run(saved.submittedAt,saved.nativeWorkId,confirmation,saved.postingId);
  }finally{db.close();}
};}
function recordManual(sub){return async saved=>{
  const db=openUserDb(sub,false);if(!db)throw Error('Career store unavailable');
  try{
    if(!db.prepare('SELECT posting_id FROM user_signals WHERE posting_id=?').get(saved.postingId))throw Error('Original application row unavailable');
    db.prepare(`UPDATE user_signals SET status=CASE WHEN status IN ('interview','offer','rejected') THEN status ELSE 'applied' END,
      applied_at=COALESCE(applied_at,?), application_source='manual-mark' WHERE posting_id=?`).run(new Date().toISOString(),saved.postingId);
  }finally{db.close();}
};}
/** The existing original-person mailbox schedule reconciles work even when no Career tab is open. */
async function reconcileCareerSubmissions(ctx,sub){
  const {userDir}=userPaths(sub),items=Object.values(queue.read(userDir).items)
    .filter(item=>item.nativeTicketId&&!['submitted','cancelled','needs_you','failed','unknown','resolved_sent','resolved_not_sent'].includes(item.status)).slice(0,50);
  const result={checked:0,submitted:0,unavailable:0};
  for(const item of items){
    try{const saved=await native.sync(userDir,item.id,ctx.ticketService,record(sub));result.checked++;if(saved.status==='submitted')result.submitted++;}
    catch{result.unavailable++;}
  }
  return result;
}
function registerEvidenceRoutes(router,run){
  router.post('/submission-queue/:id/resolve',run(async(req,res,sub,dir)=>{
    if(Object.keys(req.body||{}).some(k=>k!=='outcome'))throw new queue.SubmissionError('invalid_request','Record only what happened to this application.',400);
    const item=await require('./career-submission-resolution').resolve(dir,req.params.id,req.body?.outcome,recordManual(sub));
    res.json({ok:true,item});
  }));
  router.get('/submission-queue/:id/outcome-picture',run(async(req,res,_sub,dir)=>{
    const saved=queue.read(dir).items[req.params.id];
    if(!saved?.outcomeFile)return res.status(404).json({error:'No retained browser picture.'});
    const file=resolveContainedRegularFile(require('node:path').join(dir,saved.outcomeFile),dir);
    if(!file||queue.digest(fs.readFileSync(file))!==saved.outcomeSha256)return res.status(409).json({error:'Browser evidence changed.'});
    res.type('png').sendFile(file);
  }));
  router.get('/submission-queue/:id/press-picture/:step',run(async(req,res,_sub,dir)=>{
    const saved=queue.read(dir).items[req.params.id],step=Number(req.params.step);
    const picture=saved?.pressPictures?.find(p=>p.step===step),press=saved?.presses?.find(p=>p.step===step);
    if(!picture||!press||!Number.isInteger(step)||step<1||step>6)return res.status(404).json({error:'No retained press picture.'});
    const file=resolveContainedRegularFile(require('node:path').join(dir,picture.file),dir);
    if(!file||picture.sha256!==press.afterSha256||fs.lstatSync(file).nlink!==1||queue.digest(fs.readFileSync(file))!==press.afterSha256)
      return res.status(409).json({error:'Browser evidence changed.'});
    res.type('png').sendFile(file);
  }));
  router.get('/submission-queue/:id/confirmation',run(async(req,res,_sub,dir)=>{
    const saved=queue.read(dir).items[req.params.id];
    if(!saved?.confirmationFile||saved.status!=='submitted')return res.status(404).json({error:'No retained confirmation.'});
    const file=resolveContainedRegularFile(require('node:path').join(dir,saved.confirmationFile),dir);
    if(!file||queue.digest(fs.readFileSync(file))!==saved.confirmationSha256)return res.status(409).json({error:'Confirmation evidence changed.'});
    res.type('png').sendFile(file);
  }));
}
function createCareerSubmissionRoutes(ctx){
  registerCareerAuthorization(ctx);
  const router=Router();
  const run=handler=>async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const sub=callerSub(req);if(!sub)return res.status(401).json({error:'unauthorized'});
    try{await handler(req,res,sub,userPaths(sub).userDir);}
    catch(e){const known=e instanceof queue.SubmissionError||e instanceof drafts.DraftError;res.status(known?e.status:503).json({error:known?e.message:'Submission service unavailable; your existing intent is retained.',code:e.code||'submission_unavailable'});}
  };
  router.get('/submission-queue',run(async(_req,res,_sub,dir)=>res.json({items:Object.values(queue.read(dir).items).map(queue.publicItem).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))})));
  router.get('/submission-review/:postingId',run(async(req,res,sub,dir)=>{const id=Number(req.params.postingId),review=native.review(await material(sub,id)),previous=drafts.latestIntent(dir,id);res.json({...review,questionLabels:Object.fromEntries((previous?.questions||[]).map(question=>[question.id,question.text]))});}));
  router.post('/submission-queue',run(async(req,res,sub,dir)=>{
    const keys=Object.keys(req.body||{});if(keys.some(k=>!['postingId','packetDigest','approved'].includes(k)))throw new queue.SubmissionError('invalid_request','Only job selection and exact packet approval are accepted.',400);
    res.json(native.approve(dir,await material(sub,Number(req.body?.postingId)),req.body||{}));
  }));
  router.post('/submission-queue/:id/bind',run(async(req,res,sub,dir)=>res.json(await native.bind(dir,req.params.id,ctx.ticketService,sub))));
  router.post('/submission-queue/:id/start',run(async(req,res,_sub,dir)=>res.json(await native.start(dir,req.params.id,ctx.ticketService))));
  router.post('/submission-queue/:id/sync',run(async(req,res,sub,dir)=>res.json({ok:true,item:await native.sync(dir,req.params.id,ctx.ticketService,record(sub))})));
  router.post('/submission-queue/:id/answers',run(async(req,res,_sub,dir)=>{
    if(Object.keys(req.body||{}).some(k=>!['answers','id'].includes(k))||(req.body?.id!==undefined&&req.body.id!==req.params.id))throw new queue.SubmissionError('invalid_request','Only the displayed answers are accepted.',400);
    res.json(native.answer(dir,req.params.id,req.body?.answers));
  }));
  router.post('/submission-queue/:id/cancel',run(async(req,res,sub,dir)=>{
    if(Object.keys(req.body||{}).length)throw new queue.SubmissionError('invalid_request','Select only the previous approval.',400);
    res.json({ok:true,item:await require('./career-submission-cancel').retire(dir,req.params.id,ctx.ticketService,record(sub))});
  }));
  registerEvidenceRoutes(router,run);
  return router;
}
module.exports={createCareerSubmissionRoutes,reconcileCareerSubmissions};
