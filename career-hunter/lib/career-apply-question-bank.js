/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career 1.78.0 (design career-self-improving-applications-2026-11-27 part 3): the questions the person's application runs met, kept in their own store (apply-questions.json, at most 500) with Career's question id, the question's words, its field type and the options its card listed, so every later approval answers them from the record before asking (answersFor: the record rules' answer for each one Saved answers do not already answer, in the packet under the question's exact id, which the run fills without raising a card). A question is learned from the job on the computer as Career reads it (the kernel's work record says what it waits on and which cards are open; each card's question id is recovered by matching the id the kernel derives for the card, so a guess never enters) and from the cards the person's own page reads. Nothing here answers a card: the kernel answers a card only in the person's own session.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const answerIds=require('./career-apply-answers'),applySync=require('./career-apply-sync'),rules=require('./career-apply-record-rules');
const FILE='apply-questions.json',MOST=500,MAX_BYTES=768*1024,MAX_OPTIONS=100,MAX_TEXT=500,MAX_JOBS=20;
/** The field types a card's question can have (the kernel's FieldKind words), the lists first. */
const KINDS=['select','radio','listbox','prompt','checkbox','text','textarea','date'];
const ID=/^question:[a-f0-9]{64}$/,CARD=/^apply-[a-f0-9]{32}$/;
const ASKS=/asks you in Approvals:\s*([\s\S]*?)\.\s*Career types your answer in for you\.?\s*$/;
const clean=(value,limit=MAX_TEXT)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,limit):'';

/** @description The person's question bank. @param {string} dir Their store. @returns {{version:number,questions:object[]}} */
function read(dir){
 const file=path.join(dir,FILE);let stat;
 try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return {version:1,questions:[]};throw error;}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>MAX_BYTES)throw Object.assign(Error('The questions Career kept are unavailable.'),{code:'questions_unavailable'});
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 return {version:1,questions:(Array.isArray(data?.questions)?data.questions:[]).filter(item=>ID.test(item?.id||'')&&clean(item.text)).slice(-MOST)};
}
function write(dir,state){
 const file=path.join(dir,FILE),temp=file+'.'+crypto.randomUUID()+'.tmp',bytes=JSON.stringify({version:1,questions:state.questions.slice(-MOST)})+'\n';
 try{fs.writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}
 finally{try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
/** @description The kind whose question id this is for these words, or ''. @param {string} text @param {string} id @returns {string} */
const kindOf=(text,id)=>KINDS.find(kind=>answerIds.questionId(text,kind)===id)||'';
/**
 * @description Keep questions the person's runs met: each by its id, its options the longest list seen, and the jobs it
 * stopped. @param {string} dir @param {object[]} items [{id, text, type?, options?}] @param {number} [postingId]
 * @returns {number} How many were added or changed.
 */
function remember(dir,items,postingId){
 const state=read(dir),now=new Date().toISOString();let changed=0;
 for(const item of Array.isArray(items)?items:[]){
  const id=String(item?.id||''),text=clean(item?.text);if(!ID.test(id)||!text)continue;
  const options=(Array.isArray(item.options)?item.options:[]).map(option=>clean(option,300)).filter(Boolean).slice(0,MAX_OPTIONS),type=clean(item.type,20)||kindOf(text,id);
  const found=state.questions.find(entry=>entry.id===id),jobs=Number.isSafeInteger(postingId)?[postingId]:[];
  if(found){
   const more=options.length>found.options.length,job=jobs.some(one=>!found.jobs.includes(one));
   if(!more&&!job&&(found.type||!type))continue;
   Object.assign(found,{options:more?options:found.options,type:found.type||type,jobs:[...new Set([...found.jobs,...jobs])].slice(-MAX_JOBS),lastSeen:now});
  }else state.questions.push({id,text,type,options,jobs,firstSeen:now,lastSeen:now});
  changed+=1;
 }
 if(changed)write(dir,state);
 return changed;
}
/**
 * @description The questions the job on the computer waits on, from the kernel's work record as Career keeps it (run.live:
 * the waiting words, which give the questions' exact words joined by " / ", and the open card ids). A question's id is the
 * one whose card id (the kernel's derivation from this run and that id) is open, so words that only look like a question
 * never enter. @param {object} run Career's run record. @returns {object[]} [{id, text, type}]
 */
function waiting(run){
 const live=run?.live||{},cards=new Set((Array.isArray(live.cards)?live.cards:[]).filter(id=>CARD.test(id)));
 const asked=ASKS.exec(String(live.reason?.text||''));if(!asked||!cards.size||!run?.id)return [];
 const parts=asked[1].split(' / '),found=[];
 for(let from=0;from<parts.length;from+=1)for(let to=from;to<parts.length;to+=1){
  const text=clean(parts.slice(from,to+1).join(' / '));if(!text)continue;
  for(const kind of KINDS){
   const id=answerIds.questionId(text,kind);
   if(cards.has(applySync.cardId(run.id,id))&&!found.some(item=>item.id===id))found.push({id,text,type:kind});
  }
 }
 return found;
}
/**
 * @description What the record answers of the questions Career kept, for one job's approval: for each question Saved
 * answers do not answer, the rules' answer as the run takes it (an option's exact words, or the words for a box). An
 * option answer needs the options its card listed. @param {string} dir @param {object} person The person view.
 * @param {Set<string>} answeredIds The question ids Saved answers already answer. @returns {object[]} [{id, text, value, rule}]
 */
function answersFor(dir,person,answeredIds){
 const out=[];
 for(const question of read(dir).questions){
  if(answeredIds.has(question.id))continue;
  const result=rules.settle(question.text,question.options,person);if(!rules.answered(result))continue;
  const value=Number.isInteger(result.option)?question.options[result.option]:result.answer;
  if(clean(value,2000))out.push({id:question.id,text:question.text,value:String(value).trim().slice(0,2000),rule:result.rule});
 }
 return out.slice(0,200);
}
/**
 * @description What the record answers of the cards the person's own page read for one run: each card whose id is the one
 * the kernel derives from this run and its question id is kept in the bank, and answered when a rule settles it (the page
 * then gives that answer on the card, in the person's own session). @param {string} dir @param {object} run Career's run.
 * @param {object[]} cards [{id, questionId, question, options}] as the card route lists them. @param {object} person
 * @returns {object[]} [{card, option?, answer?, rule}]
 */
function cardAnswers(dir,run,cards,person){
 const own=(Array.isArray(cards)?cards:[]).filter(card=>CARD.test(card?.id||'')&&ID.test(card?.questionId||'')&&applySync.cardId(run.id,card.questionId)===card.id&&clean(card.question));
 remember(dir,own.map(card=>({id:card.questionId,text:card.question,options:card.options})),run.postingId);
 const out=[];
 for(const card of own){
  const options=(Array.isArray(card.options)?card.options:[]).map(option=>clean(option,300)).filter(Boolean),result=rules.settle(card.question,options,person);
  if(!rules.answered(result))continue;
  out.push(Number.isInteger(result.option)?{card:card.id,option:result.option,rule:result.rule}:{card:card.id,answer:result.answer,rule:result.rule});
 }
 return out;
}
module.exports={FILE,KINDS,read,remember,waiting,answersFor,cardAnswers};
