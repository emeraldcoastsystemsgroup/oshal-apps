/** CHANGE LOG
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Retain kernel press words even without a result and verify each accepted press picture.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Publish the approved four-press bound in immutable native input.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Retain unknown-outcome browser pictures and leave owner-closed results immutable.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Publish exact approved form intents before native dispatch, recover lost acknowledgements by original ticket, and reconcile retained employer evidence without retrying a final action.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const queue=require('./career-submission-queue');
const ID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const fail=(code,message,status=409)=>{throw new queue.SubmissionError(code,message,status);};
const file=(dir,id)=>path.join(dir,'submission-'+id+'.json');
function item(dir,id){if(!ID.test(id)||!queue.read(dir).items[id])fail('submission_not_found','Submission not found.',404);return queue.read(dir).items[id];}
function snapshot(dir,id){
  const name=file(dir,id),stat=fs.lstatSync(name);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>1024*1024)fail('input_unavailable','The approved input is unavailable.');
  const input=JSON.parse(fs.readFileSync(name,'utf8')),saved=item(dir,id);
  const {requestDigest,...bound}=input;
  if(input.intentId!==id||requestDigest!==saved.requestDigest||queue.jsonDigest(bound)!==requestDigest)
    fail('input_changed','The original approved input changed.');
  return input;
}
function saveSnapshot(dir,id,input){
  const name=file(dir,id),temp=name+'.'+crypto.randomUUID()+'.tmp',bytes=JSON.stringify(input);
  if(Buffer.byteLength(bytes)>1024*1024)fail('packet_too_large','The browser packet exceeds its size limit.');
  try{fs.writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});fs.renameSync(temp,name);}
  finally{try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
/** material contains only server-resolved posting, facts, and actual caller-owned PDF bytes. */
function review(material){
  const {posting,profile,resume,cover}=material;
  if(!Buffer.isBuffer(resume)||!resume.subarray(0,5).equals(Buffer.from('%PDF-'))
      ||!Buffer.isBuffer(cover)||!cover.subarray(0,5).equals(Buffer.from('%PDF-')))
    fail('packet_unavailable','Generate and review both the resume and cover letter first.');
  if(!profile?.email||!profile.fullName&&!profile.firstName)fail('profile_incomplete','Add your name and submission email in Apply Profile first.');
  const binding=queue.binding({postingId:posting.id,url:posting.url,resumeSha256:queue.digest(resume),
    coverSha256:queue.digest(cover),profileSha256:queue.jsonDigest(profile)});
  return {...binding,packetDigest:queue.jsonDigest(binding),title:posting.title,company:posting.company,
    profile,documents:[{kind:'resume',name:'Resume_ATS.pdf',sha256:binding.resumeSha256,byteLength:resume.length},
      {kind:'cover',name:'CoverLetter.pdf',sha256:binding.coverSha256,byteLength:cover.length}]};
}
/** First request publishes approval and immutable bytes, with no external work started. */
function approve(dir,material,input){
  const approved=review(material);
  if(input.approved!==true||input.packetDigest!==approved.packetDigest)
    fail('packet_review_required','Review this job, application facts and these exact documents before authorizing submission.',428);
  const result=queue.enqueue(dir,{...approved,approved:true});
  if(!result.deduped){
    const saved=result.item;
    const task={version:1,submissionId:saved.id,mode:'submit',approved:true,...queue.binding(saved),
      packetDigest:saved.packetDigest,profile:material.profile,
      documents:{'Resume_ATS.pdf':material.resume.toString('base64'),'CoverLetter.pdf':material.cover.toString('base64')}};
    const bound={version:1,intentId:saved.id,origin:new URL(saved.url).origin,maxPresses:saved.maxPresses,
      expiresAt:Date.parse(saved.authorizationExpiresAt),task};
    const requestDigest=queue.jsonDigest(bound);saveSnapshot(dir,saved.id,{...bound,requestDigest});
    queue.nativeUpdate(dir,saved.id,{requestDigest,title:approved.title,company:approved.company});
  }
  return {ok:true,deduped:result.deduped,item:queue.publicItem(item(dir,result.item.id))};
}
/** A separate published request binds a queued native ticket. Creation alone cannot run a browser. */
async function bind(dir,id,tickets,ownerSub){
  const saved=item(dir,id);snapshot(dir,id);
  if(saved.nativeTicketId)return {ok:true,item:queue.publicItem(saved)};
  if(saved.status!=='queued'||Date.parse(saved.authorizationExpiresAt)<=Date.now())fail('approval_expired','Review this application again before starting.');
  const ticket=await tickets.createTicket({ticketType:'career-submission',ownerSub});
  const ticketId=ticket?.ticketId||ticket?.id;
  if(!ID.test(ticketId||''))fail('ticket_unavailable','The native submission ticket was not created.',503);
  return {ok:true,item:queue.publicItem(queue.nativeUpdate(dir,id,{nativeTicketId:ticketId}))};
}
/** Retries always start the already-published ticket with the byte-identical admitted input. */
async function start(dir,id,tickets){
  const saved=item(dir,id);
  if(saved.status!=='queued')return {ok:true,item:queue.publicItem(saved)};
  if(!saved.nativeTicketId)fail('ticket_not_bound','Save the native submission ticket before starting.');
  const input=snapshot(dir,id);if(input.expiresAt<=Date.now())fail('approval_expired','Review this application again before starting.');
  const bytes=Buffer.from(JSON.stringify(input));
  const started=await tickets.startTicket(saved.nativeTicketId,{executor:'browser-form-v1',
    prompt:'Execute only the approved browser-task.json form intent. Stop for unanswered questions or uncertain outcomes.',
    files:[{path:'browser-task.json',digest:[...Buffer.from(queue.digest(bytes),'hex')],bytes:[...bytes]}],
    limits:{wall_ms:120000,output_tokens:1,artifact_bytes:2097152}});
  const workId=started?.envelope?.id;
  if(!ID.test(workId||''))fail('dispatch_unavailable','Check submission status before retrying; the start acknowledgement was incomplete.',503);
  return {ok:true,item:queue.publicItem(queue.nativeUpdate(dir,id,{nativeWorkId:workId,nativeState:'queued'}))};
}
function resultData(saved,input,accepted){
  let answer;try{answer=JSON.parse(accepted.answer);}catch{fail('result_invalid','The retained submission result could not be verified.');}
  if(answer.version!==1||answer.intentId!==saved.id||answer.requestDigest!==input.requestDigest
      ||answer.data?.submissionId!==saved.id||answer.data?.postingId!==saved.postingId
      ||!['completed','needs_review','unknown'].includes(answer.outcome))fail('result_mismatch','The retained result differs from the approved application.');
  if(answer.outcome==='completed'&&(answer.data.status!=='submitted'||!answer.data.confirmationText
      ||answer.data.confirmationSha256!==answer.confirmationSha256))fail('result_invalid','The submission confirmation is incomplete.');
  return answer;
}
function answer(dir,id,answers){
  const saved=item(dir,id),questions=saved.questions;
  if(saved.status!=='needs_you'||!Array.isArray(questions)||!questions.length||!answers||typeof answers!=='object'||Array.isArray(answers))
    fail('questions_unavailable','This application has no unanswered employer questions.');
  const allowed=new Set(questions.map(q=>q.id));
  if(Object.keys(answers).length>20||Object.entries(answers).some(([key,value])=>!allowed.has(key)||!/^question:[a-f0-9]{64}$/.test(key)
      ||typeof value!=='string'||!value.trim()||value.length>2000))fail('answers_invalid','Answer only the employer questions shown for this application.',400);
  queue.nativeUpdate(dir,id,{approvedAnswers:answers});return {ok:true};
}
function followupProfile(dir,postingId,profile){
  const previous=Object.values(queue.read(dir).items).filter(i=>i.postingId===postingId&&i.status==='needs_you'&&i.approvedAnswers)
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  return {...profile,...previous?.approvedAnswers};
}
async function retainConfirmed(dir,id,saved,patch,answer,data,tickets,row,recordApplication){
      const evidence=await tickets.getAcceptedArtifact(saved.nativeTicketId,row.id,answer.confirmationArtifact);
      const bytes=Buffer.from(evidence?.base64||'','base64');
      if(evidence?.name!=='confirmation.png'||bytes.length>2097152||bytes.length!==evidence.byteLength
          ||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
          ||queue.digest(bytes)!==answer.confirmationSha256||evidence.sha256!==answer.confirmationSha256)
        fail('evidence_invalid','The retained employer confirmation could not be verified.');
      const name='submission-'+id+'-confirmation.png',target=path.join(dir,name);
      if(fs.existsSync(target)){
        const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||queue.digest(fs.readFileSync(target))!==answer.confirmationSha256)
          fail('evidence_changed','The retained confirmation changed.');
      }else fs.writeFileSync(target,bytes,{mode:0o600,flag:'wx'});
      patch.confirmationSha256=answer.confirmationSha256;patch.confirmationText=String(data.confirmationText).slice(0,500);
      patch.confirmationFile=name;patch.submittedAt=saved.submittedAt||new Date().toISOString();
      await recordApplication({...saved,...patch},target);
}
/** Reads exact accepted bytes through native owner/package/source checks; no browser is dispatched here. */
async function sync(dir,id,tickets,recordApplication){
  const saved=item(dir,id);
  if(!saved.nativeTicketId||['submitted','cancelled','resolved_sent','resolved_not_sent'].includes(saved.status))return queue.publicItem(saved);
  const rows=await tickets.getTicketWork(saved.nativeTicketId);
  if(!Array.isArray(rows)||rows.length>1)fail('native_binding_changed','The submission has unexpected work references.');
  const row=rows[0];if(!row)return queue.publicItem(saved);
  if(row.executor!=='browser-form-v1'||!ID.test(row.id||'')||saved.nativeWorkId&&saved.nativeWorkId!==row.id)
    fail('native_binding_changed','The submission work reference changed.');
  const patch={nativeWorkId:row.id,nativeState:row.state,presses:(row.presses||[]).slice(0,6).map(press=>
    Object.fromEntries(['step','kind','label','origin','allowedAt','result','reportedAt','afterSha256'].filter(k=>press[k]!=null).map(k=>[k,press[k]]))),
    pressesAllowed:row.pressesAllowed??null,pressesEnded:row.pressesEnded??null};
  if(row.nodeId)patch.nativeNodeId=row.nodeId;
  if(row.state==='completed'){
    const input=snapshot(dir,id),accepted=await tickets.getAcceptedWork(saved.nativeTicketId,row.id);
    if(!accepted)fail('result_unavailable','The accepted submission result is unavailable.',503);
    const answer=resultData(saved,input,accepted),data=answer.data;
    patch.status={completed:'submitted',needs_review:'needs_you',unknown:'unknown'}[answer.outcome];
    patch.reason=String(data.reason||'').slice(0,500);patch.questions=(Array.isArray(data.questions)?data.questions:[]).slice(0,20);
    patch.metrics={elapsedMs:data.elapsedMs,actions:data.actions,screenshots:data.screenshots};
    patch.milestones=(Array.isArray(data.milestones)?data.milestones:[]).slice(0,30);
    Object.assign(patch,await require('./career-submission-resolution').retainPicture(dir,{...saved,...patch},answer,tickets,row.id));
    if(patch.status==='submitted'){
      await retainConfirmed(dir,id,saved,patch,answer,data,tickets,row,recordApplication);
    }
  }else if(['unknown','failed'].includes(row.state)){
    patch.status=row.state==='unknown'?'unknown':'failed';patch.reason=row.state==='unknown'
      ?'The worker outcome is uncertain. Check the employer before retrying.':'The worker stopped before a confirmed submission.';
  }else patch.status={claimed:'claimed',browser_reviewing:'reviewing',browser_submitting:'submitting',queued:'queued'}[row.state]||saved.status;
  // A prior uncertain outcome cannot silently return to an executable state.
  if(saved.status==='unknown'&&patch.status!=='submitted')patch.status='unknown';
  if(Object.entries(patch).every(([key,value])=>JSON.stringify(saved[key])===JSON.stringify(value)))return queue.publicItem(saved);
  return queue.publicItem(queue.nativeUpdate(dir,id,patch));
}
module.exports={review,approve,bind,start,sync,snapshot,answer,followupProfile};
