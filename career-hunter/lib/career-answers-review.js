/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career 1.79.0, Answers to review (the owner, 2026-11-27, about written questions on applications: "there should be an option to have that automated without review but i would like to review them for now.. so when we have those there will need to have an approval page"; design career-self-improving-applications-2026-11-27 part 4): the questions the person's jobs stopped on that only they, or a draft from their record, can answer, kept in their own store (answers-review.json, at most 200). A question is learned from Career's own records with no page open (a run waiting on question cards says them in its waiting words; an ended run's receipt lists the cards nobody answered, each with the id the run looks up; a job skipped, stopped or stepped past while it waited keeps the words) and from the waiting cards the person's own page reads from the kernel. Only a job's latest run counts, and a job applied, removed or gone counts none. Each question is one entry across employers (career-answers-kinds key): its exact words, its kind (written, plain or check), the options its card listed, the ids it is known by, its state (open, answered, skipped) and the answer it was given. What the engine drafted is read from answer-drafts.json, which only the engine writes. view() is read-only and is what GET answers; refresh(), decide() and skip() write under one lock.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createChildLogger}=require('@/shared/logger');
const queue=require('./career-submission-queue'),runs=require('./career-apply-runs'),batch=require('./career-apply-batch'),answers=require('./career-apply-answers');
const {cardId}=require('./career-apply-sync'),kinds=require('./career-answers-kinds');
const logger=createChildLogger({module:'career-answers-review'});
const FILE='answers-review.json',DRAFTS='answer-drafts.json',LOCK='answers-review.lock';
const MOST=200,MAX_IDS=16,MAX_JOBS=20,MAX_BYTES=768*1024,MAX_RECEIPT=4*1024*1024,LOCK_MS=60000,MAX_ANSWER=2000;
/** A draft asked for this long ago with nothing back is asked again; a question is drafted at most three times. */
const ASK_AGAIN_MS=10*60*1000,MAX_DRAFT_TRIES=3;
/** How many times the same job goes back with the same saved answer before the question is the person's again. */
const MAX_REUSE=2;
const GONE=new Set(['applied','interview','offer','rejected','dismissed']);
const ENDED=new Set(['paused','stopped','failed']);
const KEY=/^k:[a-f0-9]{32}$/,ID=/^question:[a-f0-9]{64}$/,CARD=/^apply-[a-f0-9]{32}$/,RUN=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const STATES=new Set(['open','answered','skipped']),HOW=new Set(['approved','edited','own','automatic']);
const fail=(code,message,status=409)=>{throw new queue.SubmissionError(code,message,status);};
const iso=now=>new Date(now).toISOString();
const words=(value,limit=300)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,limit):'';
/** @description An answer's words: lines kept, other control characters and edge spaces dropped. @param {*} value @returns {string} */
const answerWords=value=>typeof value==='string'?value.replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g,' ').trim():'';

/** @description One JSON file of the person's store, or null when it is missing; a link, a shared or oversized file is refused. */
function readJson(dir,name,limit){
 const file=path.resolve(dir,name),inside=path.relative(dir,file);
 if(!inside||inside.startsWith('..')||path.isAbsolute(inside))fail('review_unavailable','Answers to review are unavailable.',503);
 let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>limit)fail('review_unavailable','Answers to review are unavailable.',503);
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
/** @description Whether a stored question is whole. @param {object} item @returns {boolean} */
const valid=item=>KEY.test(item?.key||'')&&kinds.clean(item.text)&&['written','plain','check'].includes(item.kind)&&STATES.has(item.state)
 &&Array.isArray(item.ids)&&Array.isArray(item.options);
/** @description The person's questions to review. @param {string} dir Their own store. @returns {{version:number,questions:object[],live:object[]}} */
function read(dir){
 const data=readJson(dir,FILE,MAX_BYTES);if(!data)return {version:1,questions:[],live:[]};
 if(data.version!==1||!Array.isArray(data.questions))fail('review_unavailable','Answers to review need repair.',503);
 return {version:1,questions:data.questions.filter(valid).slice(-MOST),live:(Array.isArray(data.live)?data.live:[]).filter(liveValid).slice(0,50)};
}
function write(dir,state){
 const file=path.join(dir,FILE),temp=file+'.'+crypto.randomUUID()+'.tmp',bytes=JSON.stringify({version:1,questions:state.questions.slice(-MOST),live:state.live.slice(0,50)})+'\n';
 if(Buffer.byteLength(bytes)>MAX_BYTES)fail('review_full','Answers to review are full. Answer or skip some first.');
 try{fs.writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}
 finally{try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
 return state;
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
/** Take the lock file, or false while another change holds it (one older than a minute is a crashed holder's). */
function take(file){
 try{fs.closeSync(fs.openSync(file,'wx',0o600));return true;}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  let age=0;try{age=Date.now()-fs.statSync(file).mtimeMs;}catch(gone){if(gone.code==='ENOENT')return take(file);throw gone;}
  if(age<LOCK_MS)return false;
  logger.error({ageMs:Math.round(age)},'answers review lock left by a crashed change; taken over');
  try{fs.unlinkSync(file);}catch(gone){if(gone.code!=='ENOENT')throw gone;}
  return take(file);
 }
}
/** @description Run one change of the person's questions under their lock, waiting up to ten seconds for another. @returns {Promise<*>} */
async function locked(dir,work){
 const file=path.join(dir,LOCK),until=Date.now()+10000;
 while(!take(file)){if(Date.now()>=until)fail('review_busy','Career is saving another answer. Press it again in a moment.');await sleep(120);}
 try{return await work();}
 finally{try{fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')logger.error({err:error},'answers review lock could not be released');}}
}
/** @description What the engine drafted, by question key; a file that cannot be read gives none and is logged. @param {string} dir @returns {object} */
function readDrafts(dir){
 let data;try{data=readJson(dir,DRAFTS,MAX_BYTES);}catch(error){logger.error({err:error},'answer drafts unreadable');return {};}
 const out={},drafts=data?.version===1&&data.drafts&&typeof data.drafts==='object'&&!Array.isArray(data.drafts)?data.drafts:{};
 for(const [key,item] of Object.entries(drafts)){
  if(!KEY.test(key)||!item||!['ready','failed'].includes(item.state))continue;
  const roles=(Array.isArray(item.roles)?item.roles:[]).map(role=>({title:words(role?.title,200),org:words(role?.org,200)})).filter(role=>role.title||role.org).slice(0,6);
  out[key]={state:item.state,question:kinds.clean(item.question),text:answerWords(item.text).slice(0,MAX_ANSWER),roles,code:words(item.code,60),why:words(item.why,400),at:words(item.at,40),request:words(item.request,80)};
 }
 return out;
}
/** @description Whether a waiting card a page handed in is whole. @param {object} item @returns {boolean} */
function liveValid(item){return CARD.test(item?.card||'')&&RUN.test(item?.run||'')&&ID.test(item?.id||'')&&KEY.test(item?.key||'')&&Number.isSafeInteger(item?.postingId);}

/**
 * @description The questions the last attempt of an ended run raised and nobody answered, from its receipt, each with
 * the id its card names. @param {string} dir @param {object} run @returns {{text:string,id:string}[]}
 */
function receiptQuestions(dir,run){
 if(typeof run.receiptFile!=='string'||!run.receiptFile)return [];
 let receipt;try{receipt=readJson(dir,run.receiptFile,MAX_RECEIPT);}catch(error){logger.error({err:error,runId:run.id},'apply receipt unreadable for answers to review');return [];}
 if(receipt?.runId!==run.id||!Array.isArray(receipt.attempts))return [];
 const last=receipt.attempts.at(-1);
 return (Array.isArray(last?.questions)?last.questions:[]).filter(item=>kinds.clean(item?.text)&&!kinds.clean(item.answer))
  .map(item=>({text:kinds.clean(item.text),id:kinds.exactId(run.id,item.card,item.text)})).slice(0,20);
}
/** @description Each job's latest run (its newest approval), by posting id. @param {object[]} all @returns {Map<number,object>} */
function latestRuns(all){
 const latest=new Map(),newer=(a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||String(a.updatedAt).localeCompare(String(b.updatedAt));
 for(const run of all){const seen=latest.get(run.postingId);if(!seen||newer(run,seen)>0)latest.set(run.postingId,run);}
 return latest;
}
/**
 * @description What one job's latest run says it stopped on: a run waiting on question cards (live), or one that ended
 * while it waited (its receipt's unanswered cards, else the words its run or queue entry kept). @returns {object[]} [{text, ids, live}]
 */
function asked(dir,run,entry){
 if(run.status==='waiting')return run.live?.reason?.kind==='question'?kinds.waiting(run.live.reason.text).map(text=>({text,ids:[],live:true})):[];
 if(!ENDED.has(run.status))return [];
 const cards=receiptQuestions(dir,run);
 if(cards.length)return cards.map(item=>({text:item.text,ids:item.id?[item.id]:[],live:false}));
 const said=[...new Set([...kinds.waiting(run.reason),...kinds.waiting(entry?.reason)])];
 return said.map(text=>({text,ids:[],live:false}));
}
/**
 * @description The questions the person's jobs wait on now, from Career's own records (no page needed), each with its job.
 * A source that cannot be read is named in `unread`. @param {string} dir @param {Function} rowsOf Job rows by posting id.
 * @returns {{items:object[],rows:Map<number,object>,latest:Map<number,object>,unread:string[]}}
 */
function gather(dir,rowsOf){
 const unread=[];let all=[],entries=new Map();
 try{all=Object.values(runs.read(dir).runs);}catch(error){logger.error({err:error},'apply runs unreadable for answers to review');unread.push('runs');}
 try{entries=new Map((batch.read(dir)?.entries||[]).map(entry=>[entry.runId,entry]));}catch(error){logger.error({err:error},'fill-in queue unreadable for answers to review');unread.push('queue');}
 const latest=latestRuns(all),rows=rowsOf([...latest.keys()]),items=[];
 for(const [postingId,run] of latest){
  const row=rows.get(postingId);if(!row||GONE.has(row.status||'')||Number(row.active)===0)continue;
  const job={postingId,runId:run.id,company:words(row.company,300)||words(run.company,300),title:words(row.title,300)||words(run.title,300)};
  for(const item of asked(dir,run,entries.get(run.id)))items.push({text:item.text,ids:item.ids,options:[],job:{...job,live:item.live}});
 }
 return {items,rows,latest,unread};
}
/**
 * @description The waiting cards a person's own page read from the kernel (GET /api/apply/cards), kept only when the card is
 * one of this person's waiting runs and its id is the one the kernel derives from that run and its question; a month card
 * (it fills the record) is left to the job page. @param {object[]} cards @param {Map<number,object>} latest @returns {object[]}
 */
function ownCards(cards,latest){
 const waitingRuns=new Map([...latest.values()].filter(run=>run.status==='waiting').map(run=>[run.id,run])),out=[];
 for(const card of (Array.isArray(cards)?cards:[]).slice(0,50)){
  const ask=card?.ask||{},run=waitingRuns.get(card?.run),text=kinds.clean(ask.question);
  if(!run||!CARD.test(card.id||'')||!ID.test(ask.questionId||'')||ask.slot||!text||cardId(run.id,ask.questionId)!==card.id)continue;
  const options=(Array.isArray(ask.options)?ask.options:[]).map(option=>words(option,300)).filter(Boolean).slice(0,100);
  out.push({text,ids:[ask.questionId],options,card:card.id,job:{postingId:run.postingId,runId:run.id,company:words(run.company,300),title:words(run.title,300),live:true}});
 }
 return out;
}
/** @description A new question entry. @returns {object} */
function fresh(text,kind,now){return {key:kinds.key(text),text,kind,options:[],ids:[],state:'open',answer:null,reuse:{},draftAsked:null,firstSeen:iso(now),lastSeen:iso(now)};}
/**
 * @description Keep what was learned in the person's questions: each item under its question's key, its ids and the
 * longest list of options seen. A month question is not kept. @param {object} state @param {object[]} items @param {number} now
 * @returns {Map<string,object[]>} The jobs waiting on each question, by key.
 */
function learn(state,items,now){
 const jobs=new Map();
 for(const item of items){
  const kind=kinds.kindOf(item.text,item.options);if(kind==='month')continue;
  const key=kinds.key(item.text);let question=state.questions.find(one=>one.key===key);
  if(!question){question=fresh(item.text,kind,now);state.questions.push(question);}
  question.ids=[...new Set([...question.ids,...item.ids.filter(id=>ID.test(id))])].slice(0,MAX_IDS);
  if(item.options.length>question.options.length){question.options=item.options;question.kind=kinds.kindOf(question.text,question.options);}
  question.lastSeen=iso(now);
  const list=jobs.get(key)||[];
  const same=list.find(job=>job.postingId===item.job.postingId);
  if(same){same.live=same.live||item.job.live;same.card=same.card||item.card||null;}else if(list.length<MAX_JOBS)list.push({...item.job,card:item.card||null});
  jobs.set(key,list);
 }
 return jobs;
}
/** @description The cards a page handed in that still wait, as items. @param {object} state @param {Map<number,object>} latest @returns {object[]} */
function liveItems(state,latest){
 return state.live.filter(item=>latest.get(item.postingId)?.id===item.run&&latest.get(item.postingId).status==='waiting').map(item=>{
  const question=state.questions.find(one=>one.key===item.key),run=latest.get(item.postingId);
  return question?{text:question.text,ids:[item.id],options:question.options,card:item.card,job:{postingId:item.postingId,runId:item.run,company:words(run.company,300),title:words(run.title,300),live:true}}:null;
 }).filter(Boolean);
}
/**
 * @description Everything Career knows of the person's questions now, in memory: what is stored, what their records say
 * they wait on, and the cards a page handed in. Writes nothing. @param {string} dir @param {Function} rowsOf @param {object[]} [cards]
 * @returns {{state:object,jobs:Map<string,object[]>,unread:string[]}}
 */
function current(dir,rowsOf,cards=[],now=Date.now()){
 const state=read(dir),seen=gather(dir,rowsOf),handed=ownCards(cards,seen.latest);
 const kept=handed.map(item=>({card:item.card,run:item.job.runId,id:item.ids[0],key:kinds.key(item.text),postingId:item.job.postingId,at:iso(now)}));
 state.live=[...kept,...state.live.filter(item=>!kept.some(one=>one.card===item.card))].slice(0,50);
 const jobs=learn(state,[...seen.items,...handed,...liveItems(state,seen.latest)],now);
 return {state,jobs,unread:seen.unread};
}
/** Draft failures that asking again would not change: nothing in the record answers it, or the engine would not draft it. */
const FINAL=new Set(['no_record','not_drafted']);
/**
 * @description The draft of one open written question as the page shows it: ready (its words and the roles it drew on),
 * failed (why, once asking again would not help) or pending (asked, or waiting for Career to be free). @returns {object}
 */
function draftOf(question,drafts){
 const made=drafts[question.key],asked=question.draftAsked,tries=asked?.attempts||0;
 if(made?.state==='ready'&&made.text)return {state:'ready',text:made.text,roles:made.roles,at:made.at};
 const last=!!made&&(!asked||made.request===asked.request);
 if(made?.state==='failed'&&last&&(FINAL.has(made.code)||tries>=MAX_DRAFT_TRIES))return {state:'failed',why:made.why||'Career could not draft this from your record.'};
 return {state:'pending'};
}
/** @description Whether Career asks the engine for this question's draft now. @param {object} question @param {object} drafts @param {number} now @returns {boolean} */
function wantsDraft(question,drafts,now){
 if(question.kind!=='written'||question.state!=='open'||draftOf(question,drafts).state!=='pending')return false;
 const asked=question.draftAsked;if(!asked)return true;
 const back=drafts[question.key]?.request===asked.request;
 return (asked.attempts||0)<MAX_DRAFT_TRIES&&(back||now-Date.parse(asked.at)>ASK_AGAIN_MS);
}
const BOARD='/api/career-hunter/board-native?view=queue&application=';
const jobView=job=>({postingId:job.postingId,company:job.company,title:job.title,live:job.live===true,...(job.live&&job.card?{card:job.card}:{}),href:BOARD+job.postingId});
/** @description One question as the page shows it. @returns {object} */
function questionView(question,jobs,drafts){
 const shown={key:question.key,text:question.text,kind:question.kind,options:question.options,state:question.state,jobs:jobs.map(jobView),lastSeen:question.lastSeen};
 if(question.kind==='written'&&question.state==='open')shown.draft=draftOf(question,drafts);
 if(question.answer)shown.answer={value:question.answer.value,how:question.answer.how,at:question.answer.at,roles:question.answer.roles||[]};
 return shown;
}
const newest=(a,b)=>String(b.lastSeen).localeCompare(String(a.lastSeen));
/**
 * @description What Answers to review shows, read only: the open written questions with their drafts, the plain questions
 * and checks only the person can answer, the questions answered automatically (for a later change) and the skipped ones,
 * each with the jobs waiting on it; the count of open questions and of jobs they hold up; and the switch.
 * @param {string} dir The person's store. @param {Function} rowsOf Their job rows by posting id. @returns {object}
 */
function view(dir,rowsOf,now=Date.now()){
 const {state,jobs,unread}=current(dir,rowsOf,[],now),drafts=readDrafts(dir),held=new Set();
 let auto=false;try{auto=answers.read(dir).written.auto;}catch(error){logger.error({err:error},'saved answers unreadable for answers to review');unread.push('saved-answers');}
 const out={auto,count:0,jobs:0,written:[],plain:[],automatic:[],skipped:[],unread};
 for(const question of state.questions){
  const list=jobs.get(question.key)||[],shown=questionView(question,list,drafts);
  if(question.state==='open'&&list.length){(question.kind==='written'?out.written:out.plain).push(shown);for(const job of list)held.add(job.postingId);}
  else if(question.state==='answered'&&question.answer?.how==='automatic')out.automatic.push(shown);
  else if(question.state==='skipped'&&list.length)out.skipped.push(shown);
 }
 for(const list of [out.written,out.plain,out.automatic,out.skipped])list.sort(newest);
 out.automatic=out.automatic.slice(0,50);out.count=out.written.length+out.plain.length;out.jobs=held.size;
 return out;
}
/** @description Every id the run may look a question up by: those its cards named, then those its words take. @returns {string[]} */
const idsOf=question=>[...new Set([...question.ids,...kinds.idsFor(question.text,question.options)])].slice(0,9);
/** @description Keep an answer as the saved answer to its question (a check is never kept: it is the person's each time). */
function saveAnswer(dir,question,value,how){
 if(question.kind!=='check')answers.saveReviewed(dir,{ids:idsOf(question),text:question.text,value,key:question.key,source:how==='automatic'?'automatic':'review'});
}
/**
 * @description The answered questions a job waits on again: a check, or an answer the person removed from Saved answers,
 * is theirs again; the same answer goes back for a job at most MAX_REUSE times (noteBack counts each), then the question
 * is theirs to answer again (the form kept asking). @param {Set<string>} kept The keys Saved answers still hold. @returns {object[]}
 */
function reuseDue(state,jobs,kept){
 const due=[];
 for(const question of state.questions){
  const list=jobs.get(question.key)||[];if(question.state!=='answered'||!question.answer||!list.length)continue;
  if(question.kind==='check'||!kept.has(question.key)){Object.assign(question,{state:'open',answer:null,reuse:{}});continue;}
  const reuse=question.reuse&&typeof question.reuse==='object'?question.reuse:{};
  if(list.some(job=>!job.live&&(reuse[job.postingId]||0)>=MAX_REUSE)){Object.assign(question,{state:'open',answer:null,reuse:{}});continue;}
  due.push({question,jobs:list,value:question.answer.value,how:question.answer.how});
 }
 return due;
}
/**
 * @description Count the jobs that went back in Fill in several with a question's answer, once each time.
 * @param {string} dir @param {string} key The question. @param {number[]} back The jobs put back. @returns {Promise<void>}
 */
async function noteBack(dir,key,back){
 if(!back.length)return;
 await locked(dir,async()=>{
  const state=read(dir),question=state.questions.find(one=>one.key===key);if(!question)return;
  question.reuse=question.reuse&&typeof question.reuse==='object'?question.reuse:{};
  for(const id of back)question.reuse[id]=(question.reuse[id]||0)+1;
  write(dir,state);
 });
}
/** @description The question keys Saved answers still hold, or null when they cannot be read (logged). @param {string} dir @returns {Set<string>|null} */
function keptKeys(dir){
 try{return new Set(answers.read(dir).answers.map(item=>item.key).filter(Boolean));}
 catch(error){logger.error({err:error},'saved answers unreadable; no answer goes back this time');return null;}
}
/** @description With the switch on, the open written questions whose draft is ready are answered with it, at most five at a time. */
function automatic(state,jobs,drafts,now){
 const due=[];
 for(const question of state.questions){
  const list=jobs.get(question.key)||[],made=drafts[question.key];
  if(due.length>=5||question.state!=='open'||question.kind!=='written'||!list.length||made?.state!=='ready'||!made.text)continue;
  Object.assign(question,{state:'answered',answer:{value:made.text,how:'automatic',at:iso(now),roles:made.roles},reuse:{}});
  due.push({question,jobs:list,value:made.text,how:'automatic'});
 }
 return due;
}
/** @description The job a draft is written for: one with its documents first, as the letter is that job's. @param {object[]} list @returns {number} */
const draftJob=list=>(list.find(job=>!job.live)||list[0]).postingId;
/**
 * @description Learn what the person's jobs wait on now (their records and the cards their page read) and keep it; give
 * answered questions back to the jobs that wait on them again; with the switch on, answer written questions with their
 * ready drafts. Says what the caller does next: the work (each answer and its jobs) and the questions to draft.
 * @param {string} dir @param {object[]} cards @param {Function} rowsOf @param {{auto:boolean}} options @returns {Promise<object>}
 */
async function refresh(dir,cards,rowsOf,{auto},now=Date.now()){
 return locked(dir,async()=>{
  const {state,jobs,unread}=current(dir,rowsOf,cards,now),drafts=readDrafts(dir),kept=keptKeys(dir);
  // Saved answers that cannot be read give no answer back this time and change no question.
  const work=[...(kept?reuseDue(state,jobs,kept):[]),...(auto&&kept?automatic(state,jobs,drafts,now):[])];
  for(const item of work)saveAnswer(dir,item.question,item.value,item.how);
  // At most three a run: a draft run holds the person's store, and their other changes wait for it.
  const draftable=state.questions.filter(question=>(jobs.get(question.key)||[]).length&&wantsDraft(question,drafts,now)).slice(0,3)
   .map(question=>({key:question.key,text:question.text,postingId:draftJob(jobs.get(question.key))}));
  if(state.questions.length||state.live.length||fs.existsSync(path.join(dir,FILE)))write(dir,state);
  return {work:work.map(item=>({key:item.question.key,kind:item.question.kind,options:item.question.options,value:item.value,how:item.how,jobs:item.jobs})),draftable,unread};
 });
}
/** @description Say the engine was asked to draft these questions (one more try each). @param {string} dir @param {string[]} keys @param {string} request */
async function markAsked(dir,keys,request,now=Date.now()){
 return locked(dir,async()=>{
  const state=read(dir);
  for(const question of state.questions)if(keys.includes(question.key))question.draftAsked={at:iso(now),request,attempts:(question.draftAsked?.attempts||0)+1};
  write(dir,state);
 });
}
/**
 * @description The person's answer to one question: kept as the saved answer to it (a check excepted), the question
 * answered, and the jobs waiting on it now said back so the caller puts them in Fill in several and answers the cards
 * still waiting. @param {string} dir @param {{key:string,value:string,how:string}} decision @param {Function} rowsOf @returns {Promise<object>}
 */
async function decide(dir,{key,value,how},rowsOf,now=Date.now()){
 return locked(dir,async()=>{
  const {state,jobs}=current(dir,rowsOf,[],now),question=state.questions.find(one=>one.key===key),drafts=readDrafts(dir);
  if(!question)fail('question_not_found','That question is no longer waiting.',404);
  if(question.options.length&&!question.options.includes(value))fail('answer_invalid','Choose one of the answers the employer listed.',400);
  saveAnswer(dir,question,value,how);
  const roles=how==='own'||question.kind!=='written'?[]:drafts[key]?.roles||[];
  Object.assign(question,{state:'answered',answer:{value,how,at:iso(now),roles},reuse:{}});
  write(dir,state);
  return {key,kind:question.kind,options:question.options,value,how,jobs:jobs.get(key)||[]};
 });
}
/**
 * @description Skip a question for now, or put a skipped one back. @param {string} dir @param {string} key
 * @param {'skipped'|'open'} to @param {Function} rowsOf The person's job rows by posting id.
 */
async function setState(dir,key,to,rowsOf,now=Date.now()){
 return locked(dir,async()=>{
  const {state}=current(dir,rowsOf,[],now),question=state.questions.find(one=>one.key===key);
  if(!question)fail('question_not_found','That question is no longer waiting.',404);
  if(to==='open'&&question.state==='answered'&&question.answer?.how!=='automatic')fail('question_answered','You answered this question. Change it under Saved answers.');
  Object.assign(question,{state:to,lastSeen:iso(now),...(to==='open'?{answer:null,reuse:{}}:{})});
  write(dir,state);
 });
}
/** @description Check a decision a person sends. @param {object} body @returns {{key:string,value:string,how:string}} */
function checkDecision(body){
 if(!body||typeof body!=='object'||Object.keys(body).some(name=>!['key','value','how'].includes(name))||!KEY.test(body.key||'')||!HOW.has(body.how)||body.how==='automatic')
  fail('invalid_request','Approve one answer: its question, your answer and how you gave it.',400);
 const value=answerWords(body.value);
 if(!value||value.length>MAX_ANSWER)fail('answer_invalid','Write an answer of at most 2,000 characters.',400);
 return {key:body.key,value,how:body.how};
}
module.exports={FILE,DRAFTS,MOST,MAX_ANSWER,MAX_REUSE,read,readDrafts,current,view,refresh,markAsked,noteBack,decide,setState,checkDecision,draftOf,wantsDraft,answerWords,iso,fail};
