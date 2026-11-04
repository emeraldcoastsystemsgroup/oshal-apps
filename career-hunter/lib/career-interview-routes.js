/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Read the complete objective listing for the employer-cache binding while preserving the interview response shape.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Check interview freshness against the same exact private employer context used by the engine.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve original-owner interview preparation and practice through bounded background engine runs and the same UI/Jarvis routes, with source freshness checks.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{Router}=require('express');
const {callerSub,userPaths,openUserDb}=require('../routes/career-user-store');
const {resolveContainedRegularFile}=require('../routes/career-resume-preview');
const {registerCareerAuthorization}=require('../routes/career-authorization');
const {createCareerToolFileHandler}=require('../routes/career-surface-routes');
const {runCareerCliAsync}=require('../routes/career-engine-dispatch');
const {rejectEngineStart}=require('../routes/career-engine-response');
const {nativeRunInProgress}=require('../routes/career-engine-runner');
const {applyJobContext}=require('./career-job-context');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function job(sub,id){
  const db=openUserDb(sub);if(!db)return null;
  try{const row=db.prepare(`SELECT p.*,c.name AS company FROM corpus.postings_corpus p
    JOIN corpus.companies c ON c.id=p.company_id WHERE p.id=?`).get(id);return row?applyJobContext(userPaths(sub).userDir,row):null;}finally{db.close();}
}
function read(dir,id){
  const lexical=path.join(dir,'interviews',id+'.json');
  if(!fs.existsSync(lexical)&&!fs.lstatSync(path.dirname(lexical),{throwIfNoEntry:false})?.isSymbolicLink())return null;
  const file=resolveContainedRegularFile(lexical,dir);
  if(!file)throw Error('Interview record unavailable');
  const stat=fs.lstatSync(file);if(stat.nlink!==1||stat.size>1048576)throw Error('Interview record unavailable');
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  if(value?.version!==1||value.postingId!==id)throw Error('Interview record unavailable');
  return value;
}
function stale(dir,record,current){
  if(!record?.source)return false;
  const file=resolveContainedRegularFile(path.join(dir,'career_db.json'),dir);
  if(!file||fs.statSync(file).size>16777216)return true;
  const posting=Object.fromEntries(['company','description','title','url'].map(key=>[key,String(current[key]??'')]));
  return hash(fs.readFileSync(file))!==record.source.profile||hash(JSON.stringify(posting))!==record.source.posting;
}
function createCareerInterviewRoutes(ctx){
  registerCareerAuthorization(ctx);const router=Router();
  const run=handler=>async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const sub=callerSub(req),id=Number(req.params.postingId);
    if(!sub)return res.status(401).json({error:'unauthorized'});
    if(!Number.isSafeInteger(id)||id<1||id>999999999999999)return res.status(400).json({error:'Select one job.'});
    try{const current=job(sub,id);if(!current)return res.status(404).json({error:'Job not found.'});
      await handler(req,res,sub,id,current,userPaths(sub).userDir);
    }catch{if(!res.headersSent)res.status(503).json({error:'Interview preparation is unavailable. Your saved practice is retained.'});}
  };
  router.get('/interview',createCareerToolFileHandler('career-interview.html'));
  router.get('/interview/:postingId',run(async(_req,res,_sub,id,current,dir)=>{
    const record=read(dir,id);
    res.json({job:{postingId:id,title:current.title,company:current.company},record,
      stale:stale(dir,record,current),processing:!!await nativeRunInProgress()});
  }));
  const start=operation=>run(async(req,res,sub,id)=>{
    const input=req.body||{},allowed=operation==='practice'?['postingId','requestId','questionId','answer','planId']:['postingId','requestId'];
    if(Object.keys(input).some(key=>!allowed.includes(key))||input.postingId!==undefined&&input.postingId!==id
      ||input.requestId!==undefined&&(typeof input.requestId!=='string'||! /^[a-zA-Z0-9-]{8,80}$/.test(input.requestId)))return res.status(400).json({error:'Invalid interview request.'});
    if(operation==='practice'&&(typeof input.answer!=='string'||!input.answer.trim()||input.answer.length>8000
      ||! /^q(?:[1-9]|10)$/.test(input.questionId)||! /^[a-f0-9]{32}$/.test(input.planId)))return res.status(400).json({error:'Select a prepared question and enter an answer of at most 8000 characters.'});
    const requestId=input.requestId||crypto.randomUUID();
    const started=await runCareerCliAsync(ctx.pool,sub,['interview-'+operation],{
      CH_JOB:String(id),CH_REQUEST_ID:requestId,CH_QUESTION_ID:input.questionId||'',CH_ANSWER:input.answer||'',CH_PLAN_ID:input.planId||'',
    });
    if(rejectEngineStart(res,started,'interview '+operation))return;
    res.status(202).json({ok:true,requestId,postingId:id,status:'preparing',readUrl:'/api/career-hunter/interview/'+id});
  });
  router.post('/interview/:postingId/prepare',start('prepare'));
  router.post('/interview/:postingId/practice',start('practice'));
  return router;
}
module.exports={createCareerInterviewRoutes,read,stale};
