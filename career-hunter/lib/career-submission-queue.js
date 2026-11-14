/** CHANGE LOG
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Keep authoritative press history and verified per-step picture references in the owner record.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Bind four individually permitted presses in every new approval; preserve saved approvals unchanged.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Close unknown outcomes only by an explicit owner statement; sent stays blocked, not-sent requires a fresh approval.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Retain immutable native ticket/work references and person-supplied per-job answers without reopening a consumed final action.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bind original-owner submission intents to exact approved packets and retain ambiguity-safe durable execution states.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const FILE = 'submission-queue.json';
const MAX_ITEMS = 2000;
const MAX_PRESSES = 4;
const MAX_BYTES = 8 * 1024 * 1024;
const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const STATES = new Set(['queued','claimed','reviewing','submitting','submitted','needs_you','failed','cancelled','unknown','resolved_sent','resolved_not_sent']);
const ACTIVE = new Set(['queued','claimed','reviewing','submitting','unknown']);
class SubmissionError extends Error {
  constructor(code, message, status = 409) { super(message); this.name='SubmissionError'; this.code=code; this.status=status; }
}
const fail = (code,message,status) => { throw new SubmissionError(code,message,status); };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
const jsonDigest = value => digest(JSON.stringify(canonical(value)));
function read(dir) {
  const file=path.join(dir,FILE);
  let info;
  try { info=fs.lstatSync(file); } catch(e) { if(e.code==='ENOENT')return {version:1,items:{}}; throw e; }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink!==1 || info.size>MAX_BYTES) fail('queue_unavailable','Submission records are unavailable.',503);
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  if (data?.version!==1 || !data.items || typeof data.items!=='object' || Array.isArray(data.items)
      || Object.keys(data.items).length>MAX_ITEMS || Object.entries(data.items).some(([id,v])=>!ID.test(id)||v?.id!==id||!STATES.has(v.status)
        ||!HASH.test(v.packetDigest)||!Number.isSafeInteger(v.postingId)||v.postingId<1
        ||!Number.isFinite(Date.parse(v.authorizationExpiresAt))||!Array.isArray(v.events)||v.events.length>40
        ||(v.nodeId!==null&&(!ID.test(v.nodeId)||!HASH.test(v.claimToken)||!Number.isFinite(Date.parse(v.leaseUntil))))))
    fail('queue_invalid','Submission records need repair.',503);
  return data;
}
/** Writes occur only inside the native request's exclusively locked owner generation. */
function write(dir,state) {
  const bytes=JSON.stringify(state)+'\n';
  if(Buffer.byteLength(bytes)>MAX_BYTES)fail('queue_full','Submission history is full.',409);
  const file=path.join(dir,FILE), temp=file+'.'+crypto.randomUUID()+'.tmp';
  try {
    fs.writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});
    const fd=fs.openSync(temp,'r'); try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(temp,file);
  } finally {try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
/** Production accepts public HTTPS hostnames only. The exact HTTP fixture origin is test-only. */
function jobUrl(value, fixtureOrigin) {
  let url;try{url=new URL(value);}catch{fail('invalid_job_url','The employer posting needs a valid HTTPS URL.',400);}
  const fixture=fixtureOrigin && url.origin===fixtureOrigin && process.env.NODE_ENV==='test';
  if (url.username || url.password || url.hash || (!fixture && (url.protocol!=='https:' || url.port && url.port!=='443'
      || net.isIP(url.hostname) || !url.hostname.includes('.') || /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname))))
    fail('invalid_job_url','The employer posting needs a public HTTPS URL.',400);
  return url.href;
}
/** This input is assembled from the server's owner store, never from model or browser job text. */
function binding(input, fixtureOrigin) {
  if(!Number.isSafeInteger(input.postingId)||input.postingId<1)fail('invalid_posting','Select a job first.',400);
  const url=jobUrl(input.url,fixtureOrigin);
  if(!HASH.test(input.resumeSha256)||input.coverSha256!=null&&!HASH.test(input.coverSha256)||!HASH.test(input.profileSha256))
    fail('packet_unavailable','Prepare and review the resume packet first.',409);
  return {maxPresses:MAX_PRESSES,postingId:input.postingId,url,resumeSha256:input.resumeSha256,coverSha256:input.coverSha256||null,profileSha256:input.profileSha256};
}
function enqueue(dir,input,{now=Date.now(),fixtureOrigin}={}) {
  if(input.approved!==true)fail('submission_approval_required','Approve this job and its exact documents before submitting.',428);
  const bound=binding(input,fixtureOrigin), state=read(dir), packetDigest=jsonDigest(bound);
  const previous=Object.values(state.items).find(item=>item.postingId===bound.postingId
    && (ACTIVE.has(item.status)||['submitted','resolved_sent'].includes(item.status)));
  if(previous) {
    if(previous.packetDigest!==packetDigest)fail('submission_conflict','This job already has a submission in progress or recorded. Review it before changing its packet.');
    return {item:previous,deduped:true};
  }
  if(Object.keys(state.items).length>=MAX_ITEMS)fail('queue_full','Submission history is full.');
  const id=crypto.randomUUID(), at=new Date(now).toISOString();
  const item={id,...bound,packetDigest,mode:'submit',status:'queued',approvedAt:at,createdAt:at,updatedAt:at,
    // Approval is consumed by this one execution; a delayed queue must be reviewed again.
    authorizationExpiresAt:new Date(now+24*60*60*1000).toISOString(),attempt:0,nodeId:null,events:[{at,kind:'approved'}]};
  state.items[id]=item;write(dir,state);return {item,deduped:false};
}
function mutate(dir,id,operation,now) {
  if(!ID.test(id))fail('submission_not_found','Submission not found.',404);
  const state=read(dir),item=state.items[id];
  if(!item)fail('submission_not_found','Submission not found.',404);
  operation(item);
  item.updatedAt=new Date(now).toISOString();write(dir,state);return item;
}
/** nodeId is obtained from native device admission, never trusted from an HTTP body. */
function claim(dir,id,nodeId,packetDigest,now=Date.now()) {
  if(!ID.test(nodeId))fail('worker_invalid','Select an enrolled browser worker.',403);
  return mutate(dir,id,item=>{
    if(item.status!=='queued')fail('submission_not_claimable','This submission is already held or finished.');
    if(item.packetDigest!==packetDigest)fail('packet_changed','The approved packet changed. Review it again.');
    if(Date.parse(item.authorizationExpiresAt)<=now)fail('approval_expired','This queued application needs a fresh review.');
    item.nodeId=nodeId;item.claimToken=crypto.randomBytes(32).toString('hex');item.attempt+=1;item.status='claimed';
    item.leaseUntil=new Date(now+30*60*1000).toISOString();item.events.push({at:new Date(now).toISOString(),kind:'claimed'});
  },now);
}
function held(item,nodeId,claimToken,now) {
  if(item.nodeId!==nodeId||typeof claimToken!=='string'||typeof item.claimToken!=='string'
      ||!HASH.test(claimToken)||!crypto.timingSafeEqual(Buffer.from(item.claimToken),Buffer.from(claimToken)))
    fail('submission_not_owned','This worker does not own the submission.',403);
  if(Date.parse(item.leaseUntil)<=now||Date.parse(item.authorizationExpiresAt)<=now)
    fail('submission_lease_expired','Submission authorization expired.');
}
function transition(dir,id,nodeId,claimToken,next,detail={},now=Date.now()) {
  return mutate(dir,id,item=>{
    held(item,nodeId,claimToken,now);
    const allowed={claimed:['reviewing','needs_you','failed'],reviewing:['submitting','needs_you','failed'],
      submitting:['submitted','unknown']};
    if(!allowed[item.status]?.includes(next))fail('invalid_submission_transition','This submission cannot move to that state.');
    if(next==='submitted'&&(!HASH.test(detail.confirmationSha256)||typeof detail.confirmationText!=='string'||!detail.confirmationText.trim()))
      fail('confirmation_required','Retain the employer confirmation before recording a submission.');
    item.status=next;
    if(next==='submitted'){item.confirmationSha256=detail.confirmationSha256;item.confirmationText=detail.confirmationText.slice(0,500);item.submittedAt=new Date(now).toISOString();}
    if(detail.reason)item.reason=String(detail.reason).slice(0,500);
    item.events.push({at:new Date(now).toISOString(),kind:next});item.events=item.events.slice(-40);
  },now);
}
function cancel(dir,id,now=Date.now()) {
  return mutate(dir,id,item=>{
    if(['submitting','unknown','submitted'].includes(item.status))fail('submission_outcome_review_required','Check the employer outcome before changing this submission.');
    if(!['queued','claimed','reviewing','needs_you','failed'].includes(item.status))fail('submission_finished','This submission has already ended.');
    item.status='cancelled';item.events.push({at:new Date(now).toISOString(),kind:'cancelled'});
  },now);
}
/** A released/expired claim is never auto-requeued, including before a final-click acknowledgement. */
function reconcile(dir,now=Date.now()) {
  const state=read(dir);let changed=0;
  for(const item of Object.values(state.items)) {
    if(['claimed','reviewing','submitting'].includes(item.status)&&Date.parse(item.leaseUntil)<=now) {
      item.status='unknown';item.reason='Worker authorization expired; check the employer outcome before retrying.';
      item.updatedAt=new Date(now).toISOString();item.events.push({at:item.updatedAt,kind:'unknown'});changed++;
    }
  }
  if(changed)write(dir,state);return changed;
}
/** Native references are written only after the owner-scoped ticket port answers. */
function nativeUpdate(dir,id,patch,now=Date.now()) {
  return mutate(dir,id,item=>{
    for(const key of ['nativeTicketId','nativeWorkId','nativeNodeId']) if(patch[key]!=null) {
      if(!ID.test(patch[key])||(item[key]&&item[key]!==patch[key]))fail('native_binding_changed','The original submission reference changed.');
    }
    if(patch.requestDigest!=null&&(!HASH.test(patch.requestDigest)||(item.requestDigest&&item.requestDigest!==patch.requestDigest)))
      fail('native_binding_changed','The original submission input changed.');
    if(patch.status&&!STATES.has(patch.status))fail('invalid_submission_transition','Invalid native submission state.');
    if(['submitted','unknown','cancelled','resolved_sent','resolved_not_sent'].includes(item.status)&&patch.status&&patch.status!==item.status
        &&!(item.status==='unknown'&&patch.status==='submitted'&&HASH.test(patch.confirmationSha256||'')))
      fail('submission_finished','A settled outcome cannot be replayed as new work.');
    if(patch.status==='submitted'&&(!HASH.test(patch.confirmationSha256)||!patch.confirmationText))
      fail('confirmation_required','Retain the employer confirmation before recording a submission.');
    const allowed=['nativeTicketId','nativeWorkId','nativeNodeId','requestDigest','status','nativeState','reason',
      'title','company','questions','approvedAnswers','confirmationSha256','confirmationText','confirmationFile','submittedAt','metrics','milestones','outcomeFile','outcomeSha256','presses','pressesAllowed','pressesEnded','pressPictures'];
    if(Object.keys(patch).some(k=>!allowed.includes(k)))fail('invalid_native_update','Unsupported submission update.');
    const old=item.status;Object.assign(item,patch);
    if(old!==item.status){item.events.push({at:new Date(now).toISOString(),kind:item.status});item.events=item.events.slice(-40);}
  },now);
}
function resolveUnknown(dir,id,outcome,now=Date.now()) {
  if(!['sent','not_sent'].includes(outcome))fail('invalid_outcome','Say whether it was sent or was not sent.',400);
  return mutate(dir,id,item=>{
    if(item.status!=='unknown')fail('outcome_not_unknown','Only an unknown outcome can be closed.');
    item.status='resolved_'+outcome;item.resolvedAt=new Date(now).toISOString();
    item.reason=outcome==='sent'?'You said it was sent. Recorded as your word.':'You said it was not sent. Review and approve a new packet before another attempt.';
    item.events.push({at:item.resolvedAt,kind:item.status,statement:outcome==='sent'?'it was sent':'it was not sent'});
    item.events=item.events.slice(-40);
  },now);
}
function publicItem(item) {const {claimToken,requestDigest,approvedAnswers,...safe}=item;return {...safe,answersSaved:!!approvedAnswers&&Object.keys(approvedAnswers).length>0};}
module.exports={MAX_PRESSES,resolveUnknown,SubmissionError,read,enqueue,claim,transition,cancel,reconcile,nativeUpdate,publicItem,binding,digest,jsonDigest,jobUrl};
