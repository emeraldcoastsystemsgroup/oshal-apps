/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read submission-mail updates through native caller-owned Gmail egress, conservatively match submitted jobs, and retain bounded private receipts without sending mail.
 */
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const FILE='application-email-state.json';
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
function content(part){
  let text='';
  if(part?.body?.data)text=Buffer.from(part.body.data,'base64url').toString('utf8').slice(0,24000).replace(/<[^>]*>/g,' ');
  return text+' '+(part?.parts||[]).slice(0,12).map(content).join(' ');
}
function match(message,jobs){
  const headers=message.payload?.headers||[];
  const header=name=>String(headers.find(h=>h.name.toLowerCase()===name)?.value||'');
  const subject=header('subject').slice(0,500),text=normal(subject+' '+(message.snippet||'')+' '+content(message.payload));
  const at=Number(message.internalDate),date=Number.isFinite(at)?new Date(at).toISOString():null;
  let kind=null;
  if(/(?:offer of employment|job offer|offer letter|pleased to offer)/.test(text))kind='offer';
  else if(/(?:not (?:be )?(?:moving|proceeding)|other candidates|not selected|unsuccessful|regret to inform|will not be|position has been filled)/.test(text))kind='rejected';
  else if(/(?:schedule.{0,30}interview|interview invitation|invite.{0,30}interview|interview availability|interview with|next step.{0,30}interview)/.test(text))kind='interview';
  else if(/(?:application.{0,25}(?:received|submitted|review)|received.{0,25}application|thank you for applying|thanks for applying)/.test(text))kind='acknowledged';
  if(!kind||!date)return null;
  const candidates=jobs.filter(job=>{
    if(!Number.isFinite(timestamp(job.applied_at))||at<timestamp(job.applied_at)-300000)return false;
    const company=normal(job.company).replace(/ (?:inc|llc|ltd|corporation|corp)$/,'');
    const title=normal(job.title);
    return company.length>=3&&title.length>=6&&(' '+text+' ').includes(' '+company+' ')&&(' '+text+' ').includes(' '+title+' ');
  });
  if(!candidates.length)return null;
  return {messageId:String(message.id),threadId:String(message.threadId||''),subject,date,kind,
    postingId:candidates.length===1?Number(candidates[0].id):null,
    candidateIds:candidates.map(j=>Number(j.id)),needsReview:candidates.length!==1};
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
module.exports={read,write,match,decorate,publicState,check,timestamp};
