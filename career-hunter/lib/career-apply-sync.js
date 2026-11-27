/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Lane APPLY-I (ADR-222): two more ends of an attempt, submitted_by_career (Career pressed Submit once after his approval and the employer's confirmation was seen; the picture is verified and the job recorded as for his own Submit, with submittedBy career) and submit_not_seen (pressed once, no confirmation seen; Not seen yet). The job page's lines for a run that stopped because he used the mouse (window: "Paused because you used the mouse. It goes on by itself when you stop, or press Stop.") or because its window is not in front (window-front), and for Career's Submit while it waits for the confirmation (confirming); the run's ready words (why Career did not press Submit, when his approval let it) are kept beside them, and the kernel's notes (a paste that could not put his clipboard back) go on the receipt.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.76.4 (Roger's Honeycomb run, 2026-11-25 22:05: stopped while it waited on him, its ticket cancelled, then every sync answered not_found and the run held the job for a day): a run whose work the kernel no longer answers for reads its ticket; a cancelled ticket ends the run as stopped, a failed one as failed.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.76.5 (the same Honeycomb run): its cancelled ticket's work read as completed with no answer ("completed ticket work is unavailable"); that read also ends the run with its ticket (endedWithTicket).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0: only the latest attempt is read. A Go on whose start was refused left its new attempt unstarted, the sync read the ended attempt before it again and put the run back to Paused, and the next Go on was refused, so the person could not go on at all.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0 (Fill it in on my Chrome, design APPLY-ORBIT 4.6, 5.2 and 5.3): read an assisted application's progress from the kernel's work record for executor orbit-apply-v1 (the person's own ticket, through the package ticket port), say it as the job page's one line, and when an attempt ends read its accepted answer only when its intent, attempt and request digest are the approved ones. It keeps the pictures the run took, each checked against the digest the kernel recorded; writes apply-receipt.json in the job's folder (the files uploaded with their digests, each change with where its value came from, the questions, the hand-backs, the pictures, how it ended); records Submitted by you only with the employer's confirmation picture verified; and writes back what the person kept on a question card, as his own page reads it from the kernel's card route (GET /api/apply/cards `kept`, lane D) and hands it to POST /apply-runs/:id/kept: an answer into Saved answers by its question id, a month (2012-05, 05/2012, May or May 2012) into that role's start or end through the main résumé's own revision-checked edit, and only where the record held that year alone.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | The owner, 2026-11-26 ("are you building a bank of my answers ... use oswarm directly to do all functions"): answers kept on cards stayed in the kernel and never reached Saved answers, because only the job page's Keep wrote them, and no page was open. Career now banks them itself when it reads an ended attempt in sync, the moment it already holds the run's verified answer as the signed-in person (the card route answers only his own browser session, and a package request carries no credential, so Career reads the run's own answer): every question card he answered with Keep goes into Saved answers through keepCards and answers.keep, once per card, the ledger the job page's Keep shares. The answer names a card's question by its words; its question id is the one an entered value of that answer was filled from (card:question:<id>) whose card id the kernel derives from this run and that id (apply_cards.rs card_id), so a card of another run is never taken and a month card (its value fills the record) is left to the job page. An attempt whose end Career read is marked (bankedAttempts); an attempt that ended before this version is read once at the next sync of any of the person's runs, at most three a sync. A refusal (Saved answers full or unreadable) is logged and never stops the run's end being recorded.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createChildLogger}=require('@/shared/logger');
const logger=createChildLogger({module:'career-apply-sync'});
const queue=require('./career-submission-queue'),runs=require('./career-apply-runs'),answers=require('./career-apply-answers'),packet=require('./career-apply-packet');
const EXECUTOR='orbit-apply-v1',ID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
const PNG=Buffer.from([137,80,78,71,13,10,26,10]),MAX_PICTURE=1024*1024,MAX_PICTURES=24,MAX_ROWS=400;
const OUTCOMES={submitted_by_you:'submitted',submitted_by_career:'submitted',not_seen:'not_seen',submit_not_seen:'not_seen',paused:'paused',stopped:'stopped'};
/** The ends that need the employer's confirmation picture: his own Submit, or Career's one Submit after his approval. */
const CONFIRMED=['submitted_by_you','submitted_by_career'];
const PAGE_WORDS={fixed:'fixed',filled:'filled',added:'added',deleted:'removed',answered:'answered'};
/** A run's ends: its latest attempt has ended and Go on, if any, starts another. */
const ENDED=['submitted','not_seen','stopped','failed','paused'];
/** An entered value his card answer filled: card:question:<id> (model: when the planner pointed at that answer). */
const CARD_SOURCE=/^(?:model:)?card:(question:[a-f0-9]{64})$/;
/** How many attempts that ended before Career banked by itself one sync reads. */
const EARLIER_PER_SYNC=3;
const REASONS={'sign-in':'Waiting for you to sign in','code':'Waiting for you to enter the code','check':'Waiting for you to solve the check',
 'question':'Needs your answer','field':'Needs you to set a field','errors':'Needs you to fix what the site marked','off-site':'Waiting for you on another site',
 'window':'Paused because you used the mouse. It goes on by itself when you stop, or press Stop.',
 'window-front':'Paused because Career’s Chrome window is not in front. It goes on by itself when you bring it to the front, or press Stop.'};
const fail=(code,message,status=409)=>{throw new queue.SubmissionError(code,message,status);};
const words=(value,limit=500)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,limit):'';
const list=(value,limit)=>(Array.isArray(value)?value:[]).filter(item=>item&&typeof item==='object'&&!Array.isArray(item)).slice(0,limit);

/**
 * @description One page's line: "My Experience: 2 fixed, 1 added". @param {object} page {label, fixed, filled, added, deleted, answered}
 * @returns {string} The line, or '' for a page nothing was done on.
 */
function pageLine(page){
 const done=Object.entries(PAGE_WORDS).filter(([key])=>Number.isSafeInteger(page?.[key])&&page[key]>0).map(([key,word])=>page[key]+' '+word);
 return words(page?.label,80)&&done.length?words(page.label,80)+': '+done.join(', '):'';
}
/**
 * @description What the job page shows of a run in progress, from the work row's `apply` record.
 * @param {object} row The kernel's work row. @returns {{status:string,live:object}}
 */
function live(row){
 const apply=row.apply&&typeof row.apply==='object'?row.apply:{},state=words(apply.state,40),reason=REASONS[apply.reason?.kind]?apply.reason.kind:null;
 const pages=list(apply.pages,20).map(pageLine).filter(Boolean);
 const status=row.state==='queued'?'queued':state==='ready'?'ready':state==='waiting_for_you'||reason?'waiting':'running';
 const line=status==='queued'?'Waiting for your computer':status==='ready'?'Ready for you to submit':reason?REASONS[reason]
  :state==='opening'?'Opening the form':state==='uploading'?'Uploading your résumé':state==='confirming'?'Career pressed Submit; waiting for the employer’s confirmation'
  :words(apply.page?.label,80)||'Filling in the form';
 return {status,live:{line,reason:reason?{kind:reason,text:words(apply.reason.text,500)}:null,page:words(apply.page?.label,80),pages,ready:words(apply.ready,600)||null}};
}
const MONTH_NAMES=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
/**
 * @description The month a kept answer gives for a year the record holds: 2012-05, 05/2012, 5, May or May 2012. A
 * value that names another year gives none. @param {*} value The answer. @param {string} year The recorded year. @returns {string|null} YYYY-MM.
 */
function monthOf(value,year){
 const text=words(value,40).toLowerCase(),named=MONTH_NAMES.findIndex(name=>new RegExp('^'+name+'[a-z]*\\.?(?:,?\\s+(\\d{4}))?$').test(text));
 const iso=/^(\d{4})-(\d{1,2})$/.exec(text),us=/^(\d{1,2})\/(\d{4})$/.exec(text),bare=/^(\d{1,2})$/.exec(text);
 const [y,m]=iso?[iso[1],+iso[2]]:us?[us[2],+us[1]]:bare?[year,+bare[1]]:named>=0?[(text.match(/\d{4}/)||[year])[0],named+1]:[null,0];
 return y===year&&m>=1&&m<=12?year+'-'+String(m).padStart(2,'0'):null;
}
/**
 * @description Check one kept month against the role it names: the record must hold that date as a year alone.
 * @param {object} run The run (its private role links). @param {object} item {slot:"role.N.start|end", value}
 * @returns {object|null} The main-résumé edit, or null when the record does not hold a year alone there.
 */
function monthEdit(run,item){
 const slot=/^role\.(\d{1,2})\.(start|end)$/.exec(item.slot||''),link=slot&&run.links?.[Number(slot[1])-1];if(!link)return null;
 const before=link[slot[2]],recorded=packet.recordedDate(before),value=/^\d{4}$/.test(recorded||'')?monthOf(item.value,recorded):null;
 if(!value)return null;
 return {op:'set',field:'role',roleIndex:link.roleIndex,roleTitle:link.title,...(link.org?{roleOrg:link.org}:{}),key:slot[2],before,value,
  summary:(slot[2]==='start'?'Start':'End')+' month you gave on an application card'};
}
/**
 * @description Write back what the person kept on this run's question cards, once per card: an answer goes to Saved
 * answers, a slot's month to the role. Entries of another run are not this run's. @param {string} dir @param {object} run
 * @param {object[]} kept The kernel card route's kept entries. @param {object} writers {month(edit)} @returns {Promise<object[]>} The handled cards.
 */
async function keepCards(dir,run,kept,writers){
 const handled=[...(run.keptCards||[])],seen=new Set(handled.map(item=>item.card));
 for(const item of list(kept,100)){
  if(!/^apply-[a-f0-9]{32}$/.test(item.id||'')||seen.has(item.id)||item.run!==run.id)continue;
  let result='skipped';
  if(item.slot){const edit=monthEdit(run,item);result=edit?(await writers.month(edit)?'kept':'refused'):'skipped';}
  else result=answers.keep(dir,[item])?'kept':'skipped';
  handled.push({card:item.id,kind:item.slot?'month':'answer',result,at:new Date().toISOString()});seen.add(item.id);
 }
 return handled.slice(-200);
}
/**
 * @description The id the kernel gives the card of one question of one run (crates/api/src/apply_cards.rs card_id):
 * apply- and the first 16 bytes of the SHA-256 of "apply-card", the run and the question id, unit-separated.
 * @param {string} run The approval's run (the input's intentId). @param {string} questionId Career's question id.
 * @returns {string} apply-<32 hex>
 */
const cardId=(run,questionId)=>'apply-'+crypto.createHash('sha256').update(`apply-card\u001f${run}\u001f${questionId}`).digest('hex').slice(0,32);
/**
 * @description What an ended attempt's answer says the person kept on its question cards, in the shape of the kernel
 * card route's kept entries, so keepCards writes it as it writes the job page's. Only a card he answered with Keep. The
 * answer names a card's question by its words; its id is the question id an entered value was filled from
 * (card:question:<id>) whose card id the kernel derives from this run and that id: a card of another run never
 * matches, and a card no entered value names by question id (a month, which fills the record) is not taken.
 * @param {object} run The run. @param {object} data The accepted answer's data. @returns {object[]} The kept entries.
 */
function keptOf(run,data){
 const named=new Map();
 for(const item of list(data?.changes,400)){
  const found=CARD_SOURCE.exec(item.from||''),card=found&&cardId(run.id,found[1]);
  if(card&&!named.has(card))named.set(card,{questionId:found[1],at:words(item.at,40)});
 }
 return list(data?.questions,100).filter(item=>item.keep===true&&typeof item.answer==='string'&&item.answer.trim()&&named.has(item.card))
  .map(item=>({id:item.card,run:run.id,questionId:named.get(item.card).questionId,question:words(item.text,500),value:item.answer,answeredAt:named.get(item.card).at}));
}
/** @description The attempts whose end Career has read for kept answers. @param {object} run @returns {number[]} */
const bankedOf=run=>Array.isArray(run.bankedAttempts)?run.bankedAttempts:[];
/** @description Those attempts with this one. @param {object} run @param {number} n @returns {number[]} */
const readTo=(run,n)=>[...new Set([...bankedOf(run),n])];
/**
 * @description Bank what the person kept on one ended attempt's cards into Saved answers with Career's own writers
 * (keepCards: once per card, the ledger the job page's Keep shares), and mark the attempt read. A refusal (Saved
 * answers full or unreadable) is logged and leaves the cards for the job page; it never stops the run's end being kept.
 * @param {string} dir The person's store. @param {string} id The run. @param {number} n The attempt. @param {object|null} data
 * The attempt's verified answer data, or null when it has none. @param {object} writers Career's own writers.
 * @returns {Promise<{keptCards:object[],bankedAttempts:number[]}>} The run's patch.
 */
async function bank(dir,id,n,data,writers){
 const run=runs.get(dir,id);let keptCards=run.keptCards||[];
 try{const kept=data?keptOf(run,data):[];if(kept.length)keptCards=await keepCards(dir,run,kept,writers);}
 catch(error){logger.error({err:error,runId:id,attempt:n},'apply run kept answers not banked; left for the job page');}
 return {keptCards,bankedAttempts:readTo(run,n)};
}
/**
 * @description Read once each attempt of the person's runs that ended before Career banked kept answers itself (its
 * end recorded, its answer never read for them), newest first and at most three a sync, and bank what he kept on
 * its cards. An answer the kernel no longer gives is not asked for again. Never throws.
 * @param {string} dir The person's store. @param {object} tickets The package ticket port. @param {object} writers
 * Career's own writers. @returns {Promise<void>}
 */
async function bankEarlier(dir,tickets,writers){
 try{
  const due=[];
  for(const run of Object.values(runs.read(dir).runs)){
   if(!ID.test(run.nativeTicketId||''))continue;
   for(const attempt of run.attempts)if(ID.test(attempt.workId||'')&&!bankedOf(run).includes(attempt.n)&&(attempt!==run.attempts.at(-1)||ENDED.includes(run.status)))due.push({run,attempt});
  }
  due.sort((a,b)=>String(b.run.updatedAt).localeCompare(String(a.run.updatedAt))||b.attempt.n-a.attempt.n);
  for(const {run,attempt} of due.slice(0,EARLIER_PER_SYNC)){
   let data=null;
   try{const accepted=await tickets.getAcceptedWork(run.nativeTicketId,attempt.workId);if(accepted)data=acceptedAnswer(run,attempt,accepted).data;}
   catch(error){logger.error({err:error,runId:run.id,attempt:attempt.n},'earlier apply attempt unreadable; its kept answers are left for the job page');}
   runs.update(dir,run.id,await bank(dir,run.id,attempt.n,data,writers));
  }
 }catch(error){logger.error({err:error},'earlier apply attempts not banked');}
}
/** @description Keep one picture's exact bytes, refused unless they are a PNG of the recorded digest. @returns {string} Its file name. */
function keepPicture(dir,name,evidence,hash){
 const bytes=Buffer.from(evidence?.base64||'','base64');
 if(!HASH.test(hash||'')||bytes.length>MAX_PICTURE||bytes.length!==evidence?.byteLength||!bytes.subarray(0,8).equals(PNG)||queue.digest(bytes)!==hash||evidence.sha256!==hash)
  fail('evidence_invalid','A picture from this application could not be verified.');
 const file=path.join(dir,name);
 if(fs.existsSync(file)){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||queue.digest(fs.readFileSync(file))!==hash)fail('evidence_changed','A kept picture changed.');}
 else fs.writeFileSync(file,bytes,{mode:0o600,flag:'wx'});
 return name;
}
/**
 * @description Keep every picture an ended attempt reports, each fetched by its exact name and checked against its digest.
 * @returns {Promise<object[]>} [{n, attempt, file, sha256, page, at}]
 */
async function retainPictures(dir,run,n,data,tickets,workId){
 const kept=[];
 for(const [index,item] of list(data.pictures,MAX_PICTURES).entries()){
  if(!/^(?:page|review)-\d{1,3}\.png$/.test(item.artifact||''))fail('evidence_invalid','A picture from this application could not be verified.');
  const evidence=await tickets.getAcceptedArtifact(run.nativeTicketId,workId,item.artifact);
  if(evidence?.name!==item.artifact)fail('evidence_invalid','A picture from this application could not be verified.');
  const file=keepPicture(dir,'apply-'+run.id+'-a'+n+'-'+item.artifact,evidence,item.sha256);
  kept.push({n:index+1,attempt:n,file,sha256:item.sha256,page:words(item.page,80),at:words(item.at,40)});
 }
 return kept;
}
const change=item=>({page:words(item.page,80),label:words(item.label,200),group:words(item.group,120),before:words(item.before,500),after:words(item.after,500),from:words(item.from,120)});
/**
 * @description The receipt of one ended attempt, appended to the job's apply-receipt.json (or the run's own file when the
 * job has no folder). @returns {string} Its path relative to the person's store.
 */
function writeReceipt(dir,run,n,answer,pictures,folder){
 const data=answer.data,input=runs.snapshot(dir,run.id,n);
 const attempt={n,outcome:answer.outcome,endedAt:new Date().toISOString(),reason:words(data.reason,500),
  documents:input.task.documents.map(({id,name,sha256})=>({id,name,sha256})),
  uploads:list(data.uploads,10).map(item=>({document:words(item.document,40),field:words(item.field,200),page:words(item.page,80),name:words(item.name,200),size:Number.isSafeInteger(item.size)?item.size:null,sha256:HASH.test(item.sha256||'')?item.sha256:null})),
  changes:list(data.changes,400).map(change),questions:list(data.questions,100).map(item=>({text:words(item.text,500),answer:words(item.answer,500),from:words(item.from,120)})),
  handBacks:list(data.handBacks,60).map(item=>({reason:words(item.reason,40),text:words(item.text,500),at:words(item.at,40),endedAt:words(item.endedAt,40)})),
  pictures:pictures.map(({file,sha256,page})=>({file,sha256,page})),notes:(Array.isArray(data.notes)?data.notes:[]).slice(0,20).map(note=>words(note,300)).filter(Boolean)};
 const target=folder||dir,name=folder?'apply-receipt.json':'apply-'+run.id+'-receipt.json',file=path.join(target,name);
 let receipt={version:1,runId:run.id,postingId:run.postingId,site:run.site,attempts:[]};
 try{const old=JSON.parse(fs.readFileSync(file,'utf8'));if(old?.runId===run.id&&Array.isArray(old.attempts))receipt=old;}
 catch(error){if(error.code==='ENOENT')receipt.attempts=[];else if(error instanceof SyntaxError)logger.error({err:error,runId:run.id},'apply receipt unreadable; written again from this attempt');else throw error;}
 receipt.attempts=receipt.attempts.filter(item=>item.n!==n).concat(attempt).sort((a,b)=>a.n-b.n);
 fs.writeFileSync(file,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
 return path.relative(dir,file);
}
/**
 * @description An attempt's accepted answer, refused unless it is this run's intent, this attempt and its request digest.
 * @returns {object} The answer.
 */
function acceptedAnswer(run,attempt,accepted){
 let answer;try{answer=JSON.parse(accepted?.answer);}catch{fail('result_invalid','The application’s result could not be verified.');}
 if(answer?.version!==2||answer.intentId!==run.id||answer.attempt!==attempt.n||answer.requestDigest!==attempt.requestDigest||!OUTCOMES[answer.outcome]
   ||!answer.data||typeof answer.data!=='object')fail('result_mismatch','The application’s result differs from what you approved.');
 if(CONFIRMED.includes(answer.outcome)&&(!HASH.test(answer.data.confirmation?.sha256||'')||answer.data.confirmation.artifact!=='confirmation.png'||!words(answer.data.confirmation.text)))
  fail('result_invalid','The employer’s confirmation is incomplete.');
 return answer;
}
/** @description The patch for an ended attempt: its pictures, receipt, kept cards, and for Submitted by you the verified confirmation. */
async function ended(dir,run,attempt,row,tickets,writers){
 const accepted=await tickets.getAcceptedWork(run.nativeTicketId,row.id);if(!accepted)fail('result_unavailable','The application’s result is not available yet.',503);
 const answer=acceptedAnswer(run,attempt,accepted),data=answer.data,pictures=[...(run.pictures||[]).filter(item=>item.attempt!==attempt.n),...await retainPictures(dir,run,attempt.n,data,tickets,row.id)];
 const patch={status:OUTCOMES[answer.outcome],reason:words(data.reason,500),pictures,live:null,pressedByCareer:answer.outcome==='submit_not_seen'};
 patch.receiptFile=writeReceipt(dir,run,attempt.n,answer,pictures.filter(item=>item.attempt===attempt.n),writers.folder());
 if(CONFIRMED.includes(answer.outcome)){
  patch.submittedBy=answer.outcome==='submitted_by_career'?'career':'you';
  const evidence=await tickets.getAcceptedArtifact(run.nativeTicketId,row.id,'confirmation.png');
  if(evidence?.name!=='confirmation.png')fail('evidence_invalid','The employer’s confirmation could not be verified.');
  patch.confirmationFile=keepPicture(dir,'apply-'+run.id+'-confirmation.png',evidence,data.confirmation.sha256);
  patch.confirmationSha256=data.confirmation.sha256;patch.confirmationText=words(data.confirmation.text);patch.submittedAt=run.submittedAt||new Date().toISOString();
  await writers.recordSubmitted({...run,...patch,workId:row.id},path.join(dir,patch.confirmationFile));
 }
 // What he kept on this attempt's cards is banked here, after its end is kept, with no page open.
 return {...patch,...await bank(dir,run.id,attempt.n,data,writers)};
}
/**
 * @description A run whose ticket ended while its work cannot be read (a Stop while the run waited on him leaves the
 * work completed with no answer, or gone): the run ends with its ticket, so the job can be approved again. Its attempt
 * has no answer to read for kept answers, so it is marked read.
 * @param {string} dir The person's store. @param {string} id The run. @param {object} run The run's record.
 * @param {object} tickets The package ticket port. @param {Error} error What the read said.
 * @returns {Promise<object|null>} The run as its owner reads it, or null when the ticket has not ended.
 */
async function endedWithTicket(dir,id,run,tickets,error){
 logger.error({err:error,runId:id,ticketId:run.nativeTicketId},'apply run work read failed');
 const ticket=typeof tickets.getTicket==='function'?await tickets.getTicket(run.nativeTicketId).catch(()=>null):null;
 const state=String(ticket?.status||ticket?.state||''),last=run.attempts.at(-1),bankedAttempts=last?readTo(run,last.n):bankedOf(run);
 if(state==='cancelled')return runs.publicRun(runs.update(dir,id,{status:'stopped',live:null,reason:'You stopped it. Nothing was submitted.',bankedAttempts}));
 if(state==='failed')return runs.publicRun(runs.update(dir,id,{status:'failed',live:null,reason:'Your computer stopped before the form reached Review. Nothing was submitted.',bankedAttempts}));
 return null;
}
/**
 * @description Bring a run's record up to what the kernel holds for its current attempt, banking what the person kept
 * on the cards of an attempt that ended, then read the person's earlier ended attempts not yet read for kept answers
 * (bankEarlier). Reads the kernel only; it never starts, repeats or presses anything. @param {string} dir The person's
 * store. @param {string} id The run. @param {object} tickets The package ticket port.
 * @param {{month:Function,recordSubmitted:Function,folder:Function}} writers Career's own writers.
 * @returns {Promise<object>} The run as its owner reads it.
 */
async function sync(dir,id,tickets,writers){
 const now=await syncRun(dir,id,tickets,writers);
 await bankEarlier(dir,tickets,writers);
 return now;
}
async function syncRun(dir,id,tickets,writers){
 const run=runs.get(dir,id),attempt=run.attempts.at(-1);
 // Only the latest attempt is read: one published but not started yet (a Go on whose start was refused) leaves the run
 // as it is, and an attempt that ended (paused included) is read once; Go on starts the next, which moves the run on again.
 if(!run.nativeTicketId||!attempt?.workId||ENDED.includes(run.status))return runs.publicRun(run);
 let rows;
 try{rows=await tickets.getTicketWork(run.nativeTicketId);}
 catch(error){const gone=await endedWithTicket(dir,id,run,tickets,error);if(gone)return gone;throw error;}
 if(!Array.isArray(rows)||rows.length>MAX_ROWS)fail('native_binding_changed','The application has unexpected work references.');
 const row=rows.find(item=>item?.id===attempt.workId);if(!row)return runs.publicRun(run);
 if(row.executor!==EXECUTOR)fail('native_binding_changed','The application’s work reference changed.');
 let patch;
 if(row.state==='completed'){
  try{patch=await ended(dir,run,attempt,row,tickets,writers);}
  catch(error){const gone=await endedWithTicket(dir,id,run,tickets,error);if(gone)return gone;throw error;}
 }
 else if(['failed','unknown','cancelled'].includes(row.state))patch={status:row.state==='cancelled'?'stopped':'failed',live:null,bankedAttempts:readTo(run,attempt.n),
  reason:row.state==='cancelled'?'You stopped it. Nothing was submitted.':'Your computer stopped before the form reached Review. Nothing was submitted.'};
 else{const now=live(row);patch={status:now.status,live:now.live};}
 return runs.publicRun(runs.update(dir,id,patch));
}
module.exports={EXECUTOR,pageLine,live,monthOf,monthEdit,keepCards,cardId,keptOf,acceptedAnswer,sync};
