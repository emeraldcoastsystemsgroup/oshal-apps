/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0 (design APPLY-ORBIT 5.4): Saved answers, kept in the person's own apply_profile.json. Work authorisation and sponsorship are written under the keys normalizeAutofillProfile already reads (work_authorization, requires_sponsorship), how the person heard about a job and their phone type beside them (how_heard, phone_type), and every answer to an employer's question in an `answers` list keyed by Career's existing question id (question:<sha256 of the question's normalised words and type>, career-submission-browser.js). A page write names the revision it read, so two tabs never overwrite each other; an answer kept on an application card (the kernel card route's `kept`, which lists only answers the person ticked Keep on) is upserted by its question id. Every other key of the file is kept as it was.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0 (the owner's answer to design question 1, "its configuration"): Attestations, two switches kept as `attest: {terms, self_id_signature}` and both off unless he switched one on: tick the employer's terms box for him, and sign the self-identification form with his name and today's date. Every save keeps the file as it was (apply-profile-backups/<revision>.json) and Undo puts it back, only while nothing changed after that save. They are kept here beside the other Saved answers, not in the main résumé: a main-résumé edit changes career_db.json, which every prepared job's documents are judged against (career-application-draft.js source), so a switch there would mark every prepared résumé to be generated again.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Lane APPLY-I: two standing answers beside work authorisation and sponsorship, veteran status and disability status (Yes, No or blank, kept as veteran_status and disability_status; a blank one means Career declines that question on the form), and citizenship (free text, kept as citizenship, for a form that asks it apart from work authorisation). How Career fills in a form (career-apply-flags.js), three settings kept as apply_flags and read with the rest; setFlags changes them with the revision the page read and keeps Undo, as the Attestations do.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const queue=require('./career-submission-queue'),flagsOf=require('./career-apply-flags');
const FILE='apply_profile.json',MAX_BYTES=512*1024,MAX_ANSWERS=200,MAX_VALUE=2000,MAX_TEXT=500;
const STANDING=[['workAuthorization','work_authorization'],['sponsorship','requires_sponsorship'],['heard','how_heard'],['phoneType','phone_type'],
 ['veteranStatus','veteran_status'],['disabilityStatus','disability_status'],['citizenship','citizenship']];
/** Standing answers that are only Yes, No or blank: a blank one is declined on the form. */
const YES_NO=['veteranStatus','disabilityStatus'];
const ID=/^question:[a-f0-9]{64}$/,HASH=/^[a-f0-9]{64}$/,BACKUPS='apply-profile-backups',KEEP_BACKUPS=10;
const ATTEST=[['terms','terms'],['selfIdSignature','self_id_signature']];
const fail=(code,message,status=409)=>{throw new queue.SubmissionError(code,message,status);};
const clean=(value,limit)=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g,' ').trim().slice(0,limit):'';

/**
 * @description Career's id for an employer question: the digest of its words (NFKC, lower case, spaces collapsed) and its
 * field type, the id career-submission-browser.js has always given one. A kernel card names a question by this id.
 * @param {string} words The question's exact words. @param {string} type Its field type. @returns {string} question:<sha256>
 */
function questionId(words,type){return 'question:'+queue.jsonDigest({text:String(words??'').trim().slice(0,MAX_TEXT).normalize('NFKC').toLowerCase().replace(/\s+/g,' '),type});}
function load(dir){
 const file=path.join(dir,FILE);let stat;
 try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return {raw:{},text:''};throw error;}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>MAX_BYTES)fail('answers_unavailable','Your saved answers cannot be read.',503);
 const text=fs.readFileSync(file,'utf8'),raw=JSON.parse(text);
 if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('answers_unavailable','Your saved answers cannot be read.',503);
 return {raw,text};
}
const revisionOf=text=>crypto.createHash('sha256').update(text).digest('hex');
/**
 * @description The person's Saved answers: the standing ones and every kept answer, with the file's revision.
 * @param {string} dir The person's own store. @returns {{revision:string,standing:object,answers:object[],attest:object,flags:object,undo:string|null}}
 */
function read(dir){
 const {raw,text}=load(dir),standing={},revision=revisionOf(text),last=lastSave(dir),flags=flagsOf.read(raw);
 for(const [key,field] of STANDING){const value=raw[field];standing[key]=typeof value==='boolean'?(value?'Yes':'No'):clean(value,MAX_VALUE);}
 const answers=(Array.isArray(raw.answers)?raw.answers:[]).filter(item=>ID.test(item?.id||'')&&clean(item.text,MAX_TEXT)&&clean(item.value,MAX_VALUE))
  .map(item=>({id:item.id,text:clean(item.text,MAX_TEXT),type:clean(item.type,40),value:clean(item.value,MAX_VALUE),source:item.source==='card'?'card':'settings',savedAt:clean(item.savedAt,40)}));
 const attest=Object.fromEntries(ATTEST.map(([key,field])=>[key,raw.attest?.[field]===true]));
 return {revision,standing,answers,attest,flags,undo:last?.after===revision?last.before:null};
}
function writeAtomic(file,bytes){
 const temp=file+'.'+crypto.randomUUID()+'.tmp';
 try{fs.writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}
 finally{try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
/** @description What the last save changed: {before, after} revisions, or null. */
function lastSave(dir){
 let last;try{last=JSON.parse(fs.readFileSync(path.join(dir,BACKUPS,'last.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
 return HASH.test(last?.before||'')&&HASH.test(last?.after||'')?last:null;
}
/** @description Keep the file as it was before a save, at most ten, and say what the save changed. */
function keepBackup(dir,before,after){
 const folder=path.join(dir,BACKUPS);fs.mkdirSync(folder,{recursive:true,mode:0o700});
 writeAtomic(path.join(folder,revisionOf(before)+'.json'),before);
 writeAtomic(path.join(folder,'last.json'),JSON.stringify({before:revisionOf(before),after:revisionOf(after)}));
 const kept=fs.readdirSync(folder).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(name=>[name,fs.statSync(path.join(folder,name)).mtimeMs]).sort((a,b)=>b[1]-a[1]);
 for(const [name] of kept.slice(KEEP_BACKUPS))fs.unlinkSync(path.join(folder,name));
}
function save(dir,raw){
 const file=path.join(dir,FILE),bytes=JSON.stringify(raw,null,2)+'\n',before=load(dir).text;
 if(Buffer.byteLength(bytes)>MAX_BYTES)fail('answers_full','Saved answers are full. Remove some before keeping more.');
 keepBackup(dir,before,bytes);writeAtomic(file,bytes);
 return read(dir);
}
function current(dir,revision){
 const loaded=load(dir);
 if(typeof revision!=='string'||revision!==revisionOf(loaded.text))fail('answers_changed','Your saved answers changed in another window. Read them again.');
 return loaded.raw;
}
/**
 * @description Set the standing answers from the Saved answers page. An empty value removes that answer.
 * @param {string} dir @param {string} revision The revision the page read. @param {object} values {workAuthorization, sponsorship, heard, phoneType}
 * @returns {object} The saved answers now.
 */
function setStanding(dir,revision,values){
 if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).some(key=>!STANDING.some(([name])=>name===key)))
  fail('answers_invalid','Give only the standing answers this page shows.',400);
 const raw=current(dir,revision);
 for(const [key,field] of STANDING){
  if(!(key in values))continue;
  if(typeof values[key]!=='string')fail('answers_invalid','Each answer is text.',400);
  const value=clean(values[key],MAX_VALUE);
  if(YES_NO.includes(key)&&!['','Yes','No'].includes(value))fail('answers_invalid','Veteran status and disability status are Yes, No or blank.',400);
  if(value)raw[field]=value;else delete raw[field];
 }
 return save(dir,raw);
}
/**
 * @description Remove one kept answer from the Saved answers page. @param {string} dir @param {string} revision
 * @param {string} id The question id. @returns {object} The saved answers now.
 */
function remove(dir,revision,id){
 if(!ID.test(id||''))fail('answers_invalid','Choose one saved answer.',400);
 const raw=current(dir,revision),before=Array.isArray(raw.answers)?raw.answers:[];
 if(!before.some(item=>item?.id===id))fail('answer_not_found','That answer is not saved.',404);
 raw.answers=before.filter(item=>item?.id!==id);return save(dir,raw);
}
/**
 * @description Keep answers the person gave on application cards with Keep this answer for next time, as the kernel's
 * card route lists them (GET /api/apply/cards `kept`: id, questionId, question, value, answeredAt). Upserted by
 * questionId, so the same kept answer listed again changes nothing. An entry with a slot fills the record, not this list.
 * @param {string} dir @param {object[]} kept The kept entries. @returns {number} How many answers were added or changed.
 */
function keep(dir,kept){
 const valid=(Array.isArray(kept)?kept:[]).filter(item=>ID.test(item?.questionId||'')&&!item.slot&&clean(item.question,MAX_TEXT)&&clean(item.value,MAX_VALUE));
 if(!valid.length)return 0;
 const {raw}=load(dir),list=Array.isArray(raw.answers)?raw.answers.filter(item=>ID.test(item?.id||'')):[];let changed=0;
 for(const item of valid){
  const value=clean(item.value,MAX_VALUE),at=clean(item.answeredAt,40)||new Date().toISOString(),found=list.find(entry=>entry.id===item.questionId);
  if(found&&found.value===value)continue;
  const entry={id:item.questionId,text:clean(item.question,MAX_TEXT),type:found?.type||'',value,source:'card',savedAt:at};
  if(found)Object.assign(found,entry);else list.push(entry);changed++;
 }
 if(!changed)return 0;
 if(list.length>MAX_ANSWERS)fail('answers_full','Saved answers are full. Remove some before keeping more.');
 raw.answers=list;save(dir,raw);return changed;
}
/**
 * @description Set the Attestations switches from the Saved answers page; a switch not named stays as it is.
 * @param {string} dir @param {string} revision The revision the page read. @param {{terms?:boolean,selfIdSignature?:boolean}} values
 * @returns {object} The saved answers now.
 */
function setAttest(dir,revision,values){
 if(!values||typeof values!=='object'||Array.isArray(values)||!Object.keys(values).length||Object.entries(values).some(([key,value])=>!ATTEST.some(([name])=>name===key)||typeof value!=='boolean'))
  fail('answers_invalid','Switch only the two attestations this page shows, on or off.',400);
 const raw=current(dir,revision),attest={...(raw.attest&&typeof raw.attest==='object'&&!Array.isArray(raw.attest)?raw.attest:{})};
 for(const [key,field] of ATTEST)attest[field]=key in values?values[key]:attest[field]===true;
 raw.attest=attest;return save(dir,raw);
}
/**
 * @description Undo: put the Saved answers back as they were before the last save, only while nothing changed after it.
 * @param {string} dir @param {string} revision The revision the page read. @param {string} restore The revision to put back.
 * @returns {object} The saved answers now.
 */
function undo(dir,revision,restore){
 current(dir,revision);const last=lastSave(dir);
 if(!HASH.test(restore||'')||last?.after!==revision||last.before!==restore)fail('undo_unavailable','There is nothing to undo: your saved answers changed after that save.');
 const folder=path.join(dir,BACKUPS),text=fs.readFileSync(path.join(folder,restore+'.json'),'utf8');
 if(revisionOf(text)!==restore)fail('undo_unavailable','The earlier answers could not be read back.',503);
 if(text)writeAtomic(path.join(dir,FILE),text);else fs.rmSync(path.join(dir,FILE),{force:true});
 fs.rmSync(path.join(folder,'last.json'),{force:true});
 return read(dir);
}
/**
 * @description Set How Career fills in a form (career-apply-flags.js) from the Saved answers page; a setting not named
 * stays as it is. @param {string} dir @param {string} revision The revision the page read. @param {object} values Some of {input, window, submit}.
 * @returns {object} The saved answers now.
 */
function setFlags(dir,revision,values){
 const raw=current(dir,revision);
 raw[flagsOf.FIELD]=flagsOf.change(flagsOf.read(raw),values);return save(dir,raw);
}
/**
 * @description The standing answers a packet may carry as facts. @param {object} saved read() output.
 * @returns {{heard:string,phoneType:string,veteranStatus:string,disabilityStatus:string,citizenship:string}}
 */
const standingFacts=saved=>({heard:saved.standing.heard,phoneType:saved.standing.phoneType,veteranStatus:saved.standing.veteranStatus,
 disabilityStatus:saved.standing.disabilityStatus,citizenship:saved.standing.citizenship});
module.exports={FILE,questionId,read,setStanding,setAttest,setFlags,undo,remove,keep,standingFacts};
