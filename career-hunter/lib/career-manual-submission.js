/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Correct an explicitly mistaken manual submission mark without changing packets or verified/native submission history.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const board=require('./career-board-state'),queue=require('./career-submission-queue');
function refuse(message,status=409){const error=new Error(message);error.status=status;throw error;}
function replace(file,bytes){const temp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}}
function undoManualSubmission(db,dir,id,reason,at=new Date().toISOString()){
  if(!Number.isSafeInteger(id)||id<1||typeof reason!=='string'||!reason.trim()||reason.length>280)refuse('Explain the mistaken manual submission mark in 1–280 characters.',400);
  const row=db.prepare('SELECT * FROM user_signals WHERE posting_id=?').get(id);
  if(!row||row.status!=='applied'||row.application_source!=='manual-mark')refuse('Only a manually marked submission without later application progress can return to preparation.');
  for(const field of ['confirmation_path','application_task_id','apply_run_id','apply_claim_token','apply_claimed_at','interview_at','offer_at','closed_at'])if(row[field])refuse('This application has submission or follow-up evidence. Its recorded status cannot be reset here.');
  if(Object.values(queue.read(dir).items).some(item=>item.postingId===id))refuse('This job has an approved browser submission record. Its status cannot be reset here.');
  const state=board.readBoardState(dir),prior=state.jobs[id]||{},history=prior.statusCorrections||[];
  if(!Array.isArray(history)||history.length>=16)refuse('The manual status correction history needs review before another correction.');
  const status=row.resume_path?'generated':'promoted';
  const correction={kind:'manual-submission-correction',at,reason:reason.trim(),from:{status:row.status,appliedAt:row.applied_at||null,source:row.application_source},to:status};
  const patch={favorite:true,phase:row.resume_path?'ready':'queued',error:null,requestId:null,completedAt:null,statusCorrections:[...history,correction]};
  const projected={...state,jobs:{...state.jobs,[id]:{...prior,...patch}}};
  if(Buffer.byteLength(JSON.stringify(projected))>2*1024*1024)refuse('Saved job history is full. No status was changed.');
  const file=path.join(dir,'job-board-state.json'),original=fs.existsSync(file)?fs.readFileSync(file):null;
  let written=false;
  db.prepare('BEGIN IMMEDIATE').run();
  try{
    const changed=db.prepare("UPDATE user_signals SET status=?,applied_at=NULL,application_source=NULL WHERE posting_id=? AND status='applied' AND application_source='manual-mark' AND applied_at IS ?").run(status,id,row.applied_at);
    if(changed.changes!==1)refuse('The application changed. Refresh its current status before correcting it.');
    board.updateBoardState(dir,id,patch);written=true;
    db.prepare('COMMIT').run();
    return {ok:true,status,favorite:true,correction};
  }catch(error){
    try{db.prepare('ROLLBACK').run();}catch(_){}
    if(written){if(original===null)fs.unlinkSync(file);else replace(file,original);}
    throw error;
  }
}
module.exports={undoManualSubmission};
