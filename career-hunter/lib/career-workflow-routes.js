/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Queue original-owner saved-job preparation only after explicit consent, using the existing draft and background engine writers; refuse automatic retries and submission.
 */
'use strict';
const {randomUUID}=require('node:crypto');
const {callerSub,userPaths,findUserPaths,openUserDb}=require('../routes/career-user-store');
const board=require('./career-board-state'),drafts=require('./career-application-draft'),workflow=require('./career-application-workflow');
function job(db,id){return db.prepare(`SELECT p.id,p.url,p.active,s.status,s.resume_path,s.cover_path,
 CASE WHEN s.resume_path IS NOT NULL AND s.resume_path<>'' THEN 1 ELSE 0 END AS has_resume,
 CASE WHEN s.cover_path IS NOT NULL AND s.cover_path<>'' THEN 1 ELSE 0 END AS has_cover
 FROM corpus.postings_corpus p LEFT JOIN user_signals s ON s.posting_id=p.id WHERE p.id=?`).get(id);}
function queueOne(db,dir,id,choice,batchId){
 const saved=board.readBoardState(dir).jobs[id],row=job(db,id);
 if(!saved?.favorite||saved.workflow||!row||['applied','interview','offer','rejected','dismissed'].includes(row.status))return false;
 const application=drafts.view(dir,id,row);if(application.locked||application.busy)return false;
 db.prepare("INSERT INTO user_signals(posting_id,status,promoted_at)VALUES(?,'promoted',datetime('now')) ON CONFLICT(posting_id)DO UPDATE SET status='promoted',promoted_at=COALESCE(promoted_at,datetime('now'))").run(id);
 board.updateBoardState(dir,id,{workflow:{batchId,mode:choice.mode},workflowEnteredAt:saved.workflowEnteredAt||new Date().toISOString(),phase:'queued',error:null,completedAt:null});
 if(row.active===0||!workflow.address(row.url)){board.updateBoardState(dir,id,{phase:'failed',error:row.active===0?'The employer posting is no longer available.':'The employer form link is unavailable.',completedAt:new Date().toISOString()});return false;}
 try{drafts.begin(dir,id,row,application.draft,randomUUID(),true);}
 catch(e){board.updateBoardState(dir,id,{phase:'failed',error:e.message,completedAt:new Date().toISOString()});return false;}
 return true;
}
/** Called inside the admitted save writer; OFF and repeat saves never dispatch anything. */
async function prepareSaved(ctx,sub,ids,start){
 const owner=findUserPaths(sub);if(!owner)return {queued:0};const dir=owner.userDir;let choice;try{choice=workflow.read(dir);}catch{return {queued:0,unavailable:true};}if(!choice.enabled)return {queued:0};
 const db=openUserDb(sub,false);if(!db)return {queued:0};
 const batchId=randomUUID(),queued=[];
 try{for(const id of ids||board.favoriteIds(board.readBoardState(dir)))if(queueOne(db,dir,id,choice,batchId))queued.push(id);}
 finally{db.close();}
 if(!queued.length)return {queued:0};
 let started;
 try{started=await start(ctx.pool,sub,['prepare-saved'],{CH_WORKFLOW_BATCH:batchId});}
 catch{started={started:false};}
 if(!started.started)for(const id of queued){const saved=board.readBoardState(dir).jobs[id];drafts.refused(dir,id,saved.generationDraft.requestId);board.updateBoardState(dir,id,{phase:'failed',error:'Preparation could not start. Open the application and retry generation.',completedAt:new Date().toISOString()});}
 return {queued:queued.length,started:started.started===true};
}
function register(router,ctx,start){
 const run=handler=>async(req,res)=>{
  const sub=callerSub(req);if(!sub)return res.status(401).json({error:'unauthorized'});
  res.setHeader('Cache-Control','private, no-store');
  try{await handler(req,res,sub);}catch(e){res.status(e.status||503).json({error:e.status?e.message:'Preparation choice could not be saved or read.'});}
 };
 router.get('/application-workflow',run(async(_req,res,sub)=>res.json(workflow.read(findUserPaths(sub)?.userDir))));
 router.post('/application-workflow',run(async(req,res,sub)=>{
  const value=workflow.save(userPaths(sub).userDir,req.body);const result=value.enabled?await prepareSaved(ctx,sub,undefined,start):{queued:0};res.json({ok:true,...value,...result});
 }));
}
function decorate(db,dir,row){
 if(!row.board?.workflow)return row;
 const paths=db.prepare('SELECT resume_path,cover_path FROM user_signals WHERE posting_id=?').get(row.id)||{};
 return {...row,preparation:drafts.view(dir,row.id,{...row,...paths}).workflow};
}
module.exports={register,prepareSaved,decorate};
