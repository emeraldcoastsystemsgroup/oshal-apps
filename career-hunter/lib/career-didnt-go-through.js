/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.77.6 (the owner, 2026-11-27: "for any aplication that doesnt submit correctly have a new tab that listas the failed aplications and what went wrong"): Didn't go through on My jobs reads this. GET /didnt-go-through lists every job of the signed-in person's that Career tried to apply to and did not submit, newest first, one row per job (its latest attempt): company, title, the employer's site, when it ended, what went wrong in Career's own words and what to do next with its button. It reads the person's own store only and writes nothing: the assisted-application runs (apply-runs.json: failed, stopped, paused, not seen, an approval that ended, a form left open at Review), the Fill in several queue (apply-batch.json: failed, skipped, waiting for you, left open at Review) and Generate again (regenerate-queue.json: a failed job, or one skipped because its posting closed). A job applied, removed, or whose latest attempt was sent or is still going is not listed. A source that cannot be read leaves the others listed and is named in `unread`. `onComputer` names the jobs Career's records say are being filled in on the person's computer now, so the page's Go on starts no second one beside them, as the fill-in queue starts none.
 */
'use strict';
const {createChildLogger}=require('@/shared/logger');
const {callerSub,findUserPaths,openUserDb}=require('../routes/career-user-store');
const runs=require('./career-apply-runs'),batch=require('./career-apply-batch'),regen=require('./career-regenerate'),{SITES}=require('./career-apply-sites');
const logger=createChildLogger({module:'career-didnt-go-through'});
/** Job statuses that are not listed: applied or later, and removed. */
const GONE=new Set(['applied','interview','offer','rejected','dismissed']);
/** A run approved but not started on the computer this long ago did not go through (its start was refused or never came). */
const IDLE_MS=10*60*1000;
/** What a person reads under What to do next. Each names the button the page has for it. */
const NEXT={
 goOn:'Press Go on: Career fills it in again on your Chrome from where it stopped, with the documents you approved, and the job’s page opens so you can follow it.',
 start:'Press Go on to start it on your Chrome. The job’s page opens so you can follow it.',
 again:'Press Approve again to put it back in your fill-in queue. You check its documents once more before Career starts it.',
 check:'Check the employer’s site or your email for their confirmation. If it went through, open the job and press I applied. If not, open the job and press Fill it in on my Chrome.',
 leftOpen:'If you pressed Submit in that Chrome window, open the job and press I applied. If not, open the job and press Fill it in on my Chrome.',
 documents:'Open the job and press Generate résumé & cover letter to make its documents again.',
 needsDocuments:'Open the job and press Generate résumé & cover letter first: Career fills in a form only with the job’s own résumé and cover letter.',
 closed:'Nothing to send: the employer’s posting is no longer open.',
};
/** Career's words for an attempt whose record carries none of its own. */
const WHAT={
 failed:'Your computer stopped before the form reached Review. Nothing was submitted.',
 paused:'It paused before the form reached Review. Nothing was submitted.',
 stopped:'You stopped it. Nothing was submitted.',
 notSeen:'Career did not see the employer’s confirmation.',
 neverStarted:'The approval for this application ended before Career started it on your computer. Nothing was submitted.',
 idle:'Career has not started it on your computer yet.',
 leftOpen:'Career filled it in and left it open at the employer’s Review page in its Chrome window. Career did not see it submitted.',
 ready:'Career filled it in and stopped at the employer’s Review page.',
 readyEnded:'Career did not see it submitted, and the approval for this application ended.',
 ended:'The approval for this application ended before it went through.',
 documents:'Career could not make the documents.',
 closed:'The employer’s posting is no longer open.',
};
const words=batch.words;
const time=value=>{const at=Date.parse(value||'');return Number.isFinite(at)?at:0;};
/** @description One sentence: Career's words as they are, with a full stop when they end without one. @param {string} text @returns {string} */
const sentence=text=>{const said=words(text);return !said||/[.?!]$/.test(said)?said:said+'.';};

/** @description Whether a run's 24-hour approval has ended. @param {object} run @param {number} now @returns {boolean} */
const expired=(run,now)=>time(run.expiresAt)<=now;
/**
 * @description Whether the job page would offer Go on for this run: a paused or failed run whose last attempt started, or an
 * approved run whose last attempt has not started on its bound ticket, while its approval lasts (career-apply-routes goOn).
 * @param {object} run @param {number} now @returns {boolean}
 */
function goOnAllowed(run,now){
 const last=run.attempts.at(-1);if(!last||expired(run,now))return false;
 return ['paused','failed'].includes(run.status)&&Boolean(last.workId)||run.status==='approved'&&!last.workId&&Boolean(run.nativeTicketId);
}
/** @description When the run reached its current state: its last status change. @param {object} run @returns {string} ISO time. */
const changedAt=run=>{const event=run.events.at(-1);return event&&event.kind===run.status&&event.at?event.at:run.updatedAt;};
/** @description Whether the run was at the employer's Review page just before it was stopped. @param {object} run @returns {boolean} */
const stoppedAtReview=run=>run.status==='stopped'&&run.events.at(-2)?.kind==='ready';
/** @description What a run that stopped moving last said it was doing, in its own words. @param {object} run @returns {string} */
function lastWords(run){
 const live=run.live||{};
 if(run.status==='waiting')return [words(live.line),words(live.reason?.text)].filter(Boolean).join(': ')||'Waiting for you';
 if(run.status==='queued')return 'Waiting for your computer to start it';
 return words(live.line)||'Filling in the form';
}
/** @description The site a run fills in: its engine's name and the form's host. @param {object} run @returns {{site:string,host:string}} */
function runSite(run){
 let host='';try{host=new URL(run.origin||run.url).hostname;}catch{host='';}
 return {site:(SITES.find(([id])=>id===run.site)||[])[1]||'',host};
}
/** @description A posting address's engine name and host, for a job no run has filled in. @param {string} url @returns {{site:string,host:string}} */
function siteOfUrl(url){
 try{const {hostname}=new URL(url);const found=SITES.find(([id,,hosts])=>id!=='generic'&&hosts.some(pattern=>pattern.test(hostname)));return {site:found?found[1]:'',host:hostname};}
 catch{return {site:'',host:''};}
}
/**
 * @description One run as an attempt: success (submitted), live (still going) or ended (did not go through) with Career's
 * words, the next step and its button. @param {object} run The run. @param {number} now @param {number} wallMs The longest
 * one attempt runs on the computer. @returns {object}
 */
function fromRun(run,now,wallMs){
 const base={postingId:run.postingId,at:changedAt(run),created:run.createdAt,runId:run.id,from:'run',title:run.title,company:run.company,...runSite(run)};
 const allowed=goOnAllowed(run,now),retry=allowed?'go-on':'approve-again',again=allowed?'goOn':'again';
 const end=(what,action,next)=>({...base,state:'ended',what,action,next});
 if(run.status==='submitted')return {...base,state:'success'};
 if(run.status==='not_seen')return end(words(run.reason)||WHAT.notSeen,'open','check');
 if(run.status==='stopped')return stoppedAtReview(run)?end(WHAT.leftOpen,'open','leftOpen'):end(words(run.reason)||WHAT.stopped,'approve-again','again');
 if(run.status==='failed')return end(words(run.reason)||WHAT.failed,retry,again);
 if(run.status==='paused')return end(words(run.reason)||WHAT.paused,retry,again);
 if(run.status==='approved'){
  if(expired(run,now))return end(WHAT.neverStarted,'approve-again','again');
  return allowed&&now-time(changedAt(run))>IDLE_MS?end(WHAT.idle,'go-on','start'):{...base,state:'live'};
 }
 // Queued, running, waiting or ready: an attempt starts only while the approval lasts and ends within the wall limit, so
 // past both the run is not on the computer, whatever its record last said.
 if(time(run.expiresAt)+wallMs>now)return {...base,state:'live',onComputer:true};
 if(run.status==='ready')return end(sentence(run.live?.ready||WHAT.ready)+' '+WHAT.readyEnded,'open','leftOpen');
 return end(sentence(lastWords(run))+' '+WHAT.ended,'approve-again','again');
}
/**
 * @description One Fill in several entry as an attempt. An entry in line or on the computer is live; one that ended says
 * the queue's words for it. @param {object} entry @param {object|null} run Its run. @param {object} queue The queue.
 * @param {number} now @returns {object}
 */
function fromEntry(entry,run,queue,now){
 const site=run?runSite(run):{site:'',host:''},created=entry.approvedAt||queue.createdAt;
 const base={postingId:entry.postingId,runId:entry.runId,from:'queue',title:entry.title,company:entry.company,site:words(entry.site,80)||site.site,host:words(entry.host,200)||site.host,created};
 if(entry.active||entry.state==='waiting')return {...base,state:'live',onComputer:entry.active,at:entry.startedAt||entry.approvedAt||queue.updatedAt};
 const end=(what,action,next)=>({...base,state:'ended',at:entry.endedAt||queue.updatedAt,what,action,next});
 if(entry.state==='submitted')return {...base,state:'success',at:entry.endedAt||queue.updatedAt};
 if(entry.state==='ready')return end(words(entry.reason)||WHAT.leftOpen,'open','leftOpen');
 if(entry.state==='needs-you')return entry.expired?end(words(entry.reason)||WHAT.neverStarted,'approve-again','again'):end(words(entry.reason)||WHAT.notSeen,'open','check');
 const allowed=Boolean(run)&&entry.state==='failed'&&goOnAllowed(run,now);
 return end(words(entry.reason)||(entry.state==='skipped'?WHAT.stopped:WHAT.failed),allowed?'go-on':'approve-again',allowed?'goOn':'again');
}
/**
 * @description Whether a run moved on after its queue entry ended: it was sent, or an attempt started after the entry
 * ended (Go on from the job's page). Then the run says what happened, not the queue. @returns {boolean}
 */
function runMovedOn(run,entry){
 const ended=time(entry.endedAt);
 return run.status==='submitted'||run.attempts.some(attempt=>time(attempt.startedAt)>ended);
}
/** @description A Generate again entry that did not go through: failed, or skipped because its posting closed. @returns {object|null} */
function fromRegenerate(entry,row){
 const base={postingId:entry.postingId,state:'ended',at:entry.endedAt||entry.startedAt||entry.queuedAt,created:entry.queuedAt,from:'documents',title:entry.title,company:entry.company};
 if(entry.state==='failed')return {...base,what:words(entry.reason)||WHAT.documents,action:'open',next:'documents'};
 if(entry.state==='skipped'&&row.active===0)return {...base,what:words(entry.reason)||WHAT.closed,action:'none',next:'closed'};
 return null;
}
/** @description Read one source of the person's store; a source that cannot be read is named and left out. */
function source(name,read,unread){
 try{return read();}
 catch(error){logger.error({err:error,source:name},'didnt-go-through source unreadable');unread.push(name);return null;}
}
/** Older first: by when it reached its state, then by when it was approved. */
const newer=(a,b)=>time(a.at)-time(b.at)||time(a.created)-time(b.created);
/**
 * @description The application attempts in the person's store by posting id, and the Generate again entries. A queue entry
 * and its run are one attempt: while the entry is in line or on the computer it is live, and once it ended its words
 * stand unless the run moved on after it. @returns {{attempts:Map<number,object[]>,documents:Map<number,object>}}
 */
function attemptsOf(dir,now,wallMs,unread){
 const all=source('runs',()=>runs.read(dir).runs,unread)||{},queue=source('queue',()=>batch.read(dir),unread);
 const governed=new Set(),attempts=new Map(),add=item=>{if(!attempts.has(item.postingId))attempts.set(item.postingId,[]);attempts.get(item.postingId).push(item);};
 for(const entry of queue?.entries||[]){
  const run=all[entry.runId]||null;
  if(run&&!(entry.active||entry.state==='waiting')&&runMovedOn(run,entry))continue;
  governed.add(entry.runId);add(fromEntry(entry,run,queue,now));
 }
 for(const run of Object.values(all))if(!governed.has(run.id))add(fromRun(run,now,wallMs));
 const documents=new Map((source('documents',()=>regen.read(dir),unread)?.entries||[]).map(entry=>[entry.postingId,entry]));
 return {attempts,documents};
}
/**
 * @description The next step's words and button for one job, with what the job is now: a closed posting has nothing to
 * send, and Approve again needs the job's own documents. @param {object} item @param {object} row @returns {{action:string,next:string}}
 */
function nextFor(item,row){
 let {action,next}=item;
 if(row.active===0&&(['go-on','approve-again'].includes(action)||item.from==='documents'))[action,next]=['none','closed'];
 else if(action==='approve-again'&&!(row.has_resume&&row.has_cover))[action,next]=['open','needsDocuments'];
 return {action,next:NEXT[next]||''};
}
/**
 * @description Everything of the person's that did not go through, newest first, one row per job: its latest attempt, when
 * no later attempt of it was sent or is still going. @param {string} dir The person's store.
 * @param {(ids:number[])=>Map<number,object>} rowsOf The person's job rows by posting id ({status, title, company, url, active,
 * has_resume, has_cover}). @param {{now?:number,wallMs:number}} options `wallMs`: the longest one attempt runs on the computer.
 * @returns {{count:number,items:object[],onComputer:object[],unread:string[]}}
 */
function listFor(dir,rowsOf,{now=Date.now(),wallMs}){
 if(!(wallMs>0))throw Error('listFor needs the longest time one attempt runs (wallMs)');
 const unread=[],{attempts,documents}=attemptsOf(dir,now,wallMs,unread),items=[],onComputer=[];
 const rows=rowsOf([...new Set([...attempts.keys(),...documents.keys()])]);
 for(const item of [...attempts.values()].flat())if(item.state==='live'&&item.onComputer&&!onComputer.some(one=>one.postingId===item.postingId)){
  const row=rows.get(item.postingId)||{};onComputer.push({postingId:item.postingId,company:words(row.company,300)||words(item.company,300),title:words(row.title,300)||words(item.title,300)});
 }
 for(const [postingId,row] of rows){
  if(!row||GONE.has(row.status||''))continue;
  const own=(attempts.get(postingId)||[]).sort(newer).at(-1);
  if(own&&own.state!=='ended')continue;
  const made=documents.has(postingId)?fromRegenerate(documents.get(postingId),row):null;
  const item=[own,made].filter(Boolean).sort(newer).at(-1);if(!item)continue;
  const place=item.host?{site:item.site,host:item.host}:siteOfUrl(row.url);
  items.push({postingId,company:words(row.company,300)||words(item.company,300),title:words(row.title,300)||words(item.title,300),site:place.site||'',host:place.host||'',
   endedAt:new Date(time(item.at)||now).toISOString(),from:item.from,what:sentence(item.what),...nextFor(item,row),runId:item.runId||null,
   job:{status:row.status||'',has_resume:Boolean(row.has_resume),has_cover:Boolean(row.has_cover)}});
 }
 items.sort((a,b)=>time(b.endedAt)-time(a.endedAt)||b.postingId-a.postingId);
 return {count:items.length,items,onComputer,unread};
}
const ROW=`SELECT s.posting_id AS id,s.status,p.title,p.url,p.active,c.name AS company,
 CASE WHEN s.resume_path IS NOT NULL AND s.resume_path<>'' THEN 1 ELSE 0 END AS has_resume,
 CASE WHEN s.cover_path IS NOT NULL AND s.cover_path<>'' THEN 1 ELSE 0 END AS has_cover
 FROM user_signals s LEFT JOIN corpus.postings_corpus p ON p.id=s.posting_id LEFT JOIN corpus.companies c ON c.id=p.company_id WHERE s.posting_id IN `;
/** @description The person's own job rows for these postings, by id. @param {string} sub @param {number[]} ids @returns {Map<number,object>} */
function jobRows(sub,ids){
 const wanted=ids.filter(id=>Number.isSafeInteger(id)&&id>0);if(!wanted.length)return new Map();
 const db=openUserDb(sub);if(!db)return new Map();
 try{return new Map(db.prepare(ROW+'('+wanted.map(()=>'?').join(',')+')').all(...wanted).map(row=>[Number(row.id),{...row,id:Number(row.id)}]));}
 finally{db.close();}
}
/**
 * @description Mount GET /didnt-go-through: the signed-in person's own list, read only. A person with no Career store has
 * nothing listed. @param {import('express').Router} router @param {{wallMs:number}} options The longest one attempt runs.
 * @returns {void}
 */
function register(router,{wallMs}){
 router.get('/didnt-go-through',async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const sub=callerSub(req);if(!sub)return res.status(401).json({error:'unauthorized'});
  try{const owner=findUserPaths(sub);res.json(owner?listFor(owner.userDir,ids=>jobRows(sub,ids),{wallMs}):{count:0,items:[],onComputer:[],unread:[]});}
  catch(error){logger.error({err:error},'didnt-go-through read failed');res.status(503).json({error:'Career could not read what did not go through just now. Try again in a moment.',code:'didnt_go_through_unavailable'});}
 });
}
module.exports={NEXT,WHAT,IDLE_MS,listFor,jobRows,register,goOnAllowed};
