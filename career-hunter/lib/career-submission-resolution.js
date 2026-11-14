/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Fetch only explicitly retained press pictures so optional missing artifacts cannot block settlement.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Retain each reported press picture against the authoritative kernel digest.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Keep hash-checked unknown pictures and record the owner's explicit outcome without dispatching or reusing approval. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),queue=require('./career-submission-queue');
function keepPicture(dir,name,evidence,hash){
  const bytes=Buffer.from(evidence?.base64||'','base64');
  if(bytes.length>2097152||bytes.length!==evidence?.byteLength||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      ||queue.digest(bytes)!==hash||evidence.sha256!==hash)
    throw new queue.SubmissionError('evidence_invalid','The retained browser picture could not be verified.');
  const file=path.join(dir,name);
  if(fs.existsSync(file)){
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||queue.digest(fs.readFileSync(file))!==hash)
      throw new queue.SubmissionError('evidence_changed','The retained browser picture changed.');
  }else fs.writeFileSync(file,bytes,{mode:0o600,flag:'wx'});
  return name;
}
async function retainPicture(dir,saved,answer,tickets,workId) {
  const patch={},pressPictures=[];
  if(answer.data.outcomeArtifact){
    const evidence=await tickets.getAcceptedArtifact(saved.nativeTicketId,workId,answer.data.outcomeArtifact);
    if(answer.data.outcomeArtifact!=='review.png'||evidence?.name!=='review.png')
      throw new queue.SubmissionError('evidence_invalid','The retained browser picture could not be verified.');
    patch.outcomeFile=keepPicture(dir,'submission-'+saved.id+'-outcome.png',evidence,answer.data.outcomeSha256);
    patch.outcomeSha256=answer.data.outcomeSha256;
  }
  for(const press of saved.presses||[]){
    if(!press.afterSha256)continue;
    if(answer.outcome==='completed'&&press.step===saved.presses.at(-1).step&&press.afterSha256===answer.confirmationSha256){
      pressPictures.push({step:press.step,file:'submission-'+saved.id+'-confirmation.png',sha256:press.afterSha256});continue;
    }
    const kept=(answer.data.pressPictures||[]).find(p=>p.step===press.step);if(!kept)continue;
    const name='press-'+press.step+'.png';
    if(kept.artifact!==name||kept.sha256!==press.afterSha256)throw new queue.SubmissionError('evidence_invalid','The retained browser picture could not be verified.');
    const evidence=await tickets.getAcceptedArtifact(saved.nativeTicketId,workId,name);
    if(evidence.name!==name)throw new queue.SubmissionError('evidence_invalid','The retained browser picture could not be verified.');
    const file=keepPicture(dir,'submission-'+saved.id+'-'+name,evidence,press.afterSha256);
    pressPictures.push({step:press.step,file,sha256:press.afterSha256});
  }
  return {...patch,pressPictures};
}
async function resolve(dir,id,outcome,recordManual) {
  if(!['sent','not_sent'].includes(outcome))throw new queue.SubmissionError('invalid_outcome','Say whether it was sent or was not sent.',400);
  const saved=queue.read(dir).items[id];
  if(!saved)throw new queue.SubmissionError('submission_not_found','Submission not found.',404);
  if(saved.status==='resolved_'+outcome)return queue.publicItem(saved);
  if(saved.status!=='unknown')throw new queue.SubmissionError('outcome_not_unknown','Only an unknown outcome can be closed.');
  if(outcome==='sent')await recordManual(saved);
  return queue.publicItem(queue.resolveUnknown(dir,id,outcome));
}
module.exports={retainPicture,resolve};
