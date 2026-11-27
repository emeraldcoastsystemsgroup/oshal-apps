/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read submission-mail updates through native caller-owned Gmail egress, conservatively match submitted jobs, and retain bounded private receipts without sending mail.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | An employer's automatic confirmation was recorded as a rejection and its job set to rejected (production, 2026-11-26: two applications, each confirmed within seconds; one confirmation says what to do "if you are not selected for this position"). The rejection words were tested before the acknowledgement words, anywhere in the text. Now (1) a message that confirms receipt is a rejection only when it states a decision; (2) rejection words count only in what a sentence states: a clause that holds "if", "unless", "until", "should we", "in the event", "in case", "whether" or "when the position", or that speaks of candidates in general, does not count, nor does the rest of its sentence; (3) a message dated earlier than five minutes after a job's applied_at, the slack the matcher already allows before it, is not a rejection of that application. The next check relabels a stored rejection whose subject is a confirmation inside that time, and puts its job back when nothing else says rejected.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.76.16 (Roger's PointClickCare application, 2026-11-26): its confirmation's subject is "Thank you for your application to PointClickCare!", words the receipt pattern did not have (it knew "thank you for applying"), so it was stored as a rejection and the repair could not see it as a confirmation. "Thank you for your application" and its near forms confirm receipt.
 */
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const boardState=require('./career-board-state');
const FILE='application-email-state.json';
/** The slack between a message's date and a job's applied_at, in milliseconds. A message up to five minutes before applied_at is still that application's mail; one earlier than five minutes after it cannot be its rejection. */
const SLACK=300000;
const OFFER=/(?:offer of employment|job offer|offer letter|pleased to offer)/;
const INTERVIEW=/(?:schedule.{0,30}interview|interview invitation|invite.{0,30}interview|interview availability|interview with|next step.{0,30}interview)/;
/** The words that confirm an application arrived. */
const CONFIRMS=/(?:application.{0,25}(?:received|submitted|review)|received.{0,25}application|we have your application|thank you for applying|thanks for applying|thank(?:s| you) for (?:your|the|submitting (?:your|an)) application)/;
/** The rejection words as they were. They count in a statement, in a message that does not confirm receipt. */
const REJECTION_WORDS=/(?:not (?:be )?(?:moving|proceeding)|other candidates|not selected|unsuccessful|regret to inform|will not be|position has been filled)/;
/** A stated decision: the only rejection a message that confirms receipt can carry, since a confirmation uses the looser words about everyone. */
const DECISION=new RegExp('(?:regret to inform'
  +'|(?:not|won t|can t|unable to) (?:be |to )?(?:moving|move|proceeding|proceed|progressing|advancing|pursuing|pursue)\\b'
  +'|(?:forward|ahead|proceed|proceeding|go|going|gone|went) with (?:an)?other (?:candidates?|applicants?)'
  +'|(?:pursue|pursuing|selected|chosen|chose|hired) (?:an)?other (?:candidates?|applicants?)'
  +'|(?:unfortunately|regret|sadly)\\b.{0,200}\\b(?:(?:an)?other (?:candidates?|applicants?)|unsuccessful|not (?:been )?(?:selected|successful))'
  +'|(?:was|were|have|has|ve) not (?:been )?selected|(?:been|was|were) unsuccessful|position has been filled)');
/** A clause with one of these is a condition, or speaks of candidates in general; so is the rest of its sentence. */
const CONDITION=new RegExp('\\b(?:if|unless|until|should (?:we|you|your|our|the|it|they)|in the event|in (?:the )?case|whether'
  +'|(?:when|once) (?:the|a|this) (?:position|role|job|vacancy|opening)'
  +'|(?:candidates|applicants|applications|those|individuals|anyone) (?:who |that )?(?:(?:are|were|is|was|have|has|will|do|did) )?not'
  +'|unsuccessful (?:candidates|applicants|applications))\\b');
/** Where one clause ends inside a sentence: a comma, colon, bracket or dash, and before "but" or "however". */
const CLAUSE_END=/[,:()\u2013\u2014]|\s-\s|\s(?=(?:but|however)\s)/i;
/** Where one sentence ends: after ! ? or ; then space, after a full stop when no lower-case letter follows, and at a blank line. */
const SENTENCE_END=/(?<=[!?;])\s+|(?<=\.)\s+(?![a-z\s])|\n\s*\n/;
function read(dir){
  const file=path.join(dir,FILE);
  let stat;try{stat=fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')return {version:1,events:[],seen:[]};throw e;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)throw Error('Application email state unavailable');
  const state=JSON.parse(fs.readFileSync(file,'utf8'));
  if(state.version!==1||!Array.isArray(state.events)||!Array.isArray(state.seen))throw Error('Application email state invalid');
  return state;
}
function write(dir,state){
  const file=path.join(dir,FILE),temp=file+'.'+crypto.randomUUID()+'.tmp';
  state.events=state.events.slice(-300);state.seen=state.seen.slice(-2000);
  try{fs.writeFileSync(temp,JSON.stringify(state)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}
  finally{try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
function normal(value){return String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function timestamp(value){return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value||'')?value:String(value||'').replace(' ','T')+'Z');}
/** @description A message part's text. In HTML the line breaks of the source mean nothing, a tag that ends a block ends the sentence, and a tag inside a sentence is a space, so emphasis does not cut a condition off its words. @param {object} part A payload part. @returns {string} The text of the part and of up to twelve parts inside it. */
function content(part){
  let text='';
  if(part?.body?.data){
    text=Buffer.from(part.body.data,'base64url').toString('utf8').slice(0,24000);
    if(/html/i.test(part.mimeType||'')||/<(?:html|body|div|p|br|table|td)\b/i.test(text))
      text=text.replace(/\s+/g,' ').replace(/<\/?(?:p|div|br|li|ul|ol|tr|td|th|table|h[1-6]|blockquote|hr)\b[^>]*>/gi,'\n\n');
    text=text.replace(/<[^>]*>/g,' ');
  }
  return text+'\n\n'+(part?.parts||[]).slice(0,12).map(content).join('\n\n');
}
/** @description Mail text without its character references: one that stands for an apostrophe becomes one, any other a space, so the semicolon that ends a reference is never read as the end of a sentence. @param {string} text @returns {string} */
function plain(text){return String(text||'').replace(/&(?:#0*39|#x0*27|#8217|#8216|apos|rsquo|lsquo);/gi,"'").replace(/&#?[a-z0-9]{2,8};/gi,' ');}
/** @description The part of one sentence that states something: its clauses up to the first one that holds a condition. "If you are not selected, keep an eye on our careers page" states nothing; "we will not be moving forward, but if another role fits, apply" states its first clause. @param {string} sentence One sentence as written. @returns {string} The stated part, normalised. */
function statement(sentence){
  const clauses=sentence.split(CLAUSE_END).map(normal),condition=clauses.findIndex(clause=>CONDITION.test(clause));
  return (condition<0?clauses:clauses.slice(0,condition)).filter(Boolean).join(' ');
}
/**
 * @description What one message says about an application, from its words alone. An offer comes first. A rejection needs a statement: a stated decision in a message that confirms receipt, a decision or the older rejection words in one that does not. Then an interview, then a confirmation.
 * @param {string} subject The subject line.
 * @param {string} rest The snippet and the body; '' reads the subject alone.
 * @returns {{kind:string|null,otherwise:string|null,text:string}} The kind; the kind with the rejection left out, for a message too early to be one; the normalised text.
 */
function reading(subject,rest){
  const raw=plain(subject)+'\n\n'+plain(rest),text=normal(raw);
  if(OFFER.test(text))return {kind:'offer',otherwise:'offer',text};
  const confirms=CONFIRMS.test(text),otherwise=INTERVIEW.test(text)?'interview':confirms?'acknowledged':null;
  const rejected=raw.split(SENTENCE_END).map(statement).some(said=>DECISION.test(said)||(!confirms&&REJECTION_WORDS.test(said)));
  return {kind:rejected?'rejected':otherwise,otherwise,text};
}
/**
 * @description Matches one mailbox message to the submitted jobs it names (employer and title, dated no earlier than five minutes before applied_at) and reads its kind. A rejection is matched only to applications at least five minutes old when it was sent; when every named application is younger, the message is read without its rejection.
 * @param {object} message A mail API message with its payload.
 * @param {Array<{id:number,title:string,company:string,applied_at:string}>} jobs The person's submitted jobs.
 * @returns {object|null} The event to store, or null when the message is no update for any of them.
 */
function match(message,jobs){
  const headers=message.payload?.headers||[];
  const header=name=>String(headers.find(h=>h.name.toLowerCase()===name)?.value||'');
  const subject=header('subject').slice(0,500),said=reading(subject,(message.snippet||'')+'\n\n'+content(message.payload)),text=said.text;
  const at=Number(message.internalDate),date=Number.isFinite(at)?new Date(at).toISOString():null;
  let kind=said.kind;
  if(!kind||!date)return null;
  let candidates=jobs.filter(job=>{
    if(!Number.isFinite(timestamp(job.applied_at))||at<timestamp(job.applied_at)-SLACK)return false;
    const company=normal(job.company).replace(/ (?:inc|llc|ltd|corporation|corp)$/,'');
    const title=normal(job.title);
    return company.length>=3&&title.length>=6&&(' '+text+' ').includes(' '+company+' ')&&(' '+text+' ').includes(' '+title+' ');
  });
  if(kind==='rejected'){
    const old=candidates.filter(job=>at>=timestamp(job.applied_at)+SLACK);
    if(old.length)candidates=old;else kind=said.otherwise;
  }
  if(!kind||!candidates.length)return null;
  return {messageId:String(message.id),threadId:String(message.threadId||''),subject,date,kind,
    postingId:candidates.length===1?Number(candidates[0].id):null,
    candidateIds:candidates.map(j=>Number(j.id)),needsReview:candidates.length!==1};
}
/**
 * @description Puts right what the earlier reading stored. A stored event of kind "rejected" is relabelled "acknowledged" when its subject reads as a confirmation and its date is earlier than five minutes after the applied_at of every job it was matched to. Such an event's job goes back from "rejected" when nothing else says rejected: the person did not record it (the status route writes manualTracking.status in job-board-state.json; this reader never does) and no other event matched to that job alone is a rejection. It goes back to "interview" when the person recorded one or an interview event is stored, otherwise to "applied". The status is written before the events change, so a failed write is tried again at the next check.
 * @param {string} dir The person's store folder.
 * @param {object} db The person's open database.
 * @param {object} state The stored email state; its events are relabelled in place.
 * @returns {number} How many events were relabelled.
 */
function repair(dir,db,state){
  const rows=new Map(),row=id=>rows.has(id)?rows.get(id):rows.set(id,db.prepare('SELECT status,applied_at FROM user_signals WHERE posting_id=?').get(id)).get(id);
  const early=(event,id)=>Date.parse(event.date)<timestamp(row(id)?.applied_at)+SLACK;
  const wrong=state.events.filter(event=>event.kind==='rejected'&&reading(event.subject,'').kind==='acknowledged'
    &&Array.isArray(event.candidateIds)&&event.candidateIds.length&&event.candidateIds.every(id=>early(event,id)));
  if(!wrong.length)return 0;
  const jobs=boardState.readBoardState(dir).jobs;
  for(const id of new Set(wrong.filter(event=>event.postingId&&!event.needsReview).map(event=>event.postingId))){
    const others=state.events.filter(event=>event.postingId===id&&!event.needsReview&&!wrong.includes(event)).map(event=>event.kind);
    const recorded=jobs[id]?.manualTracking?.status;
    if(row(id)?.status!=='rejected'||recorded==='rejected'||others.includes('rejected'))continue;
    db.prepare("UPDATE user_signals SET status=? WHERE posting_id=? AND status='rejected'").run(recorded==='interview'||others.includes('interview')?'interview':'applied',id);
  }
  for(const event of wrong)event.kind='acknowledged';
  return wrong.length;
}
function expectedMailbox(dir){
  const file=path.join(dir,'career_db.json'),s=fs.lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||s.size>20*1024*1024)throw Error('Resume profile unavailable');
  const profile=JSON.parse(fs.readFileSync(file,'utf8'));
  return String(profile.profile?.email||profile.email||'').trim().toLowerCase();
}
function decorate(state,job){return {...job,emailUpdates:state.events.filter(e=>e.postingId===job.id).slice(-5)};}
function publicState(state){return {mailbox:state.mailbox||null,expectedMailbox:state.expectedMailbox||null,lastCheckedAt:state.lastCheckedAt||null,
  lastSuccessAt:state.lastSuccessAt||null,error:state.error||null,status:state.status||'not-checked',
  pending:!!(state.pageToken||state.pendingIds?.length),events:state.events.slice(-50).reverse()};}
async function check(dir,db,fetcher=fetch,now=Date.now()){
  const state=read(dir),checked=new Date(now).toISOString();
  const api=async url=>{
    const response=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/'+url,{method:'GET',signal:AbortSignal.timeout(5500)});
    if(!response.ok)throw Error([401,403].includes(response.status)?'Connect the submission Gmail account with mail read access in Connections.':'Submission mailbox unavailable (HTTP '+response.status+').');
    return response.json();
  };
  try{
    repair(dir,db,state);
    const expected=expectedMailbox(dir);state.expectedMailbox=expected;
    const profile=await api('profile');state.mailbox=String(profile.emailAddress||'').toLowerCase();
    if(!expected||state.mailbox!==expected)throw Error('The connected Gmail mailbox must match the submission email on your resume ('+(expected||'email missing')+').');
    const since=state.startedAt||(state.startedAt=new Date(now-7*86400000).toISOString());
    const jobs=db.prepare(`SELECT s.posting_id AS id,p.title,c.name AS company,s.status,s.applied_at FROM user_signals s
      JOIN corpus.postings_corpus p ON p.id=s.posting_id JOIN corpus.companies c ON c.id=p.company_id
      WHERE s.status IN ('applied','interview','offer','rejected') AND s.applied_at IS NOT NULL
        AND julianday(s.applied_at)>=julianday(?) ORDER BY s.applied_at DESC LIMIT 200`).all(since);
    if(!state.window){state.window={after:Math.floor((state.lastSuccessAt?Date.parse(state.lastSuccessAt)-86400000:now-7*86400000)/1000),before:Math.floor(now/1000)+1};}
    if(jobs.length){
      if(!state.pendingIds?.length){
        const q='after:'+state.window.after+' before:'+state.window.before+' {application interview "job offer" "offer letter"}';
        const page=await api('messages?maxResults=10&q='+encodeURIComponent(q)+(state.pageToken?'&pageToken='+encodeURIComponent(state.pageToken):''));
        state.pendingIds=(page.messages||[]).map(m=>m.id);state.pageToken=page.nextPageToken||null;
      }
      // Only two messages per bounded native frame. Keep the remaining page durable before advancing.
      for(const id of state.pendingIds.slice(0,2)){
        if(!state.seen.includes(id)){
          const message=await api('messages/'+encodeURIComponent(id)+'?format=full');
          const event=match(message,jobs);
          if(event){
            if(event.postingId&&!event.needsReview){
              const status=event.kind==='acknowledged'?'applied':event.kind;
              const rank={applied:0,interview:1,rejected:2,offer:3};
              const old=jobs.find(j=>j.id===event.postingId);
              const prior=state.events.filter(e=>e.postingId===event.postingId&&!e.needsReview).at(-1);
              if(rank[status]>rank[old.status]&&(!prior||event.date>=prior.date)){
                db.prepare('UPDATE user_signals SET status=? WHERE posting_id=? AND status=?').run(status,event.postingId,old.status);old.status=status;
              }
            }
            event.mailbox=state.mailbox;state.events.push(event);
          }
          state.seen.push(id);
        }
        state.pendingIds.shift();
      }
    }else{state.pendingIds=[];state.pageToken=null;}
    if(!state.pendingIds?.length&&!state.pageToken){state.lastSuccessAt=new Date(state.window.before*1000).toISOString();delete state.window;}
    state.lastCheckedAt=checked;state.status='connected';state.error=null;
  }catch(error){
    state.lastCheckedAt=checked;state.status='unavailable';state.error=String(error.message||'Submission email check failed').slice(0,500);
  }
  write(dir,state);return publicState(state);
}
module.exports={read,write,match,decorate,publicState,check,timestamp,reading,repair};
