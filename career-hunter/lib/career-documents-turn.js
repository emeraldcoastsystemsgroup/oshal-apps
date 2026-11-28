/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career 1.78.0 (design career-self-improving-applications-2026-11-27 part 1): documents and Fill in several share the person's store (the kernel refuses every other write of theirs while a document run holds it, career_run_in_progress), so they take turns. documentsMayRun says whether a job's documents may be written now: not while their fill-in queue runs with three or more approved jobs waiting.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Career 1.78.0 (the coordinator, 2026-11-27: a Career release must not make every person's documents be written again, one at a time, ~3.5 minutes each): staleWhy names two things only. (1) letter-day: the cover letter is dated an earlier day than today in the zone the letter is dated in (the engine's _today: CAREER_TIME_ZONE, else the zone Career's schedules run on), read from the letter itself (CoverLetter.html), else from when the documents were last written. (2) revision: the packet records an older documents revision than the engine's (engine/jobhunter/documents_revision.py DOCUMENTS_REVISION, which only a change to how documents are written moves; a packet that records none was written under revision 1). The Career version a packet records no longer counts, so documents made today by an earlier Career stay fresh.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createChildLogger}=require('@/shared/logger');
const batch=require('./career-apply-batch');
const logger=createChildLogger({module:'career-documents-turn'});
/** The approved jobs waiting in the fill-in queue from which documents wait for their turn. */
const QUEUE_TURN=3;
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
const MAX_LETTER=512*1024,MAX_RECORD=4*1024*1024,HEAD=4096;
/** @description The zone a cover letter is dated in, the engine's own (generate.py _today). @returns {string} */
const letterZone=()=>process.env.CAREER_TIME_ZONE||'America/Chicago';
/** @description The calendar day of an instant in a zone, YYYY-MM-DD. @param {number} ms @param {string} zone @returns {string} */
function dayIn(ms,zone){
 const format=timeZone=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
 try{return format(zone);}catch{return format('America/Chicago');}
}
let revision=null;
/**
 * @description The revision of how documents are written now: the engine's DOCUMENTS_REVISION
 * (engine/jobhunter/documents_revision.py), read once. 1 when it cannot be read, so nothing is made stale by a guess.
 * @returns {number}
 */
function documentsRevision(){
 if(revision!==null)return revision;
 try{
  const text=fs.readFileSync(path.join(__dirname,'..','engine','jobhunter','documents_revision.py'),'utf8');
  revision=Number((/^DOCUMENTS_REVISION\s*=\s*(\d+)\s*(?:#.*)?$/m.exec(text)||[])[1])||1;
 }catch(error){logger.error({err:error},'documents revision unreadable; taken as 1');revision=1;}
 return revision;
}
/** @description One of the packet's files, if it is a plain file within the limit. @returns {Buffer|null} */
function readPlain(file,limit){
 let stat;try{stat=fs.lstatSync(file);}catch{return null;}
 return stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=limit?fs.readFileSync(file):null;
}
/**
 * @description The documents revision a packet records (application.json documents_revision, written right after
 * career_version), or 1 for a packet made before revisions were recorded. @param {string|null} folder @returns {number}
 */
function packetRevision(folder){
 const bytes=folder&&readPlain(path.join(folder,'application.json'),MAX_RECORD);if(!bytes)return 1;
 const head=/"documents_revision"\s*:\s*(\d+)/.exec(bytes.subarray(0,HEAD).toString('utf8'));
 if(head)return Number(head[1]);
 try{const recorded=JSON.parse(bytes.toString('utf8'))?.documents_revision;return Number.isSafeInteger(recorded)&&recorded>=0?recorded:1;}catch{return 1;}
}
/** @description The day the job's cover letter is dated, YYYY-MM-DD, read from the letter (CoverLetter.html), or null. @param {string|null} folder @returns {string|null} */
function letterDay(folder){
 const bytes=folder&&readPlain(path.join(folder,'CoverLetter.html'),MAX_LETTER);if(!bytes)return null;
 const text=bytes.toString('utf8').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ');
 const found=new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{1,2}),\\s+(\\d{4})\\b`,'i').exec(text);
 if(!found)return null;
 const month=MONTHS.indexOf(found[1].toLowerCase())+1,day=Number(found[2]);
 return day>=1&&day<=31?`${found[3]}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`:null;
}
/**
 * @description Whether a job's documents may be written now: not while the person's fill-in queue runs with three or
 * more approved jobs waiting (the queue has the store then). @param {string} dir Their store.
 * @returns {{may:boolean,waiting:number}}
 */
function documentsMayRun(dir){
 let state=null;try{state=batch.read(dir);}catch{return {may:true,waiting:0};}
 const waiting=state&&state.state==='running'?state.entries.filter(entry=>entry.state==='waiting').length:0;
 return {may:waiting<QUEUE_TURN,waiting};
}
/** @description The words a turn waits with. @param {number} waiting @returns {string} */
const turnWords=waiting=>`Waiting while Fill in several has ${waiting} approved jobs to fill in; documents are written again when fewer than ${QUEUE_TURN} wait.`;
/**
 * @description When the job's documents were last written: its row's generated_at, or its preparation receipt when that is later.
 * @param {object} row The job's row (generated_at). @param {object|null} receipt Its board-state entry. @returns {number} ms, or NaN.
 */
function madeAt(row,receipt){
 const times=[Date.parse(row?.generated_at||''),receipt?.phase==='ready'?Date.parse(receipt.completedAt||''):NaN].filter(Number.isFinite);
 return times.length?Math.max(...times):NaN;
}
/**
 * @description Why a job's documents must be written again before Fill in several approves it, or '' when they are
 * fresh: 'letter-day' (its cover letter is dated an earlier day than today in the letter's zone) or 'revision' (they
 * were written under an older documents revision). The Career version a packet records never makes it stale.
 * @param {{row:object,folder:string|null,receipt:object|null,now:number,current?:number}} input current: the documents
 * revision now (the engine's, when not given). @returns {string}
 */
function staleWhy({row,folder,receipt,now,current=documentsRevision()}){
 const zone=letterZone(),today=dayIn(now,zone),dated=letterDay(folder),made=madeAt(row,receipt);
 const letter=dated||(Number.isFinite(made)?dayIn(made,zone):null);
 if(letter&&letter<today)return 'letter-day';
 return folder&&packetRevision(folder)<current?'revision':'';
}
const STALE={'letter-day':'Its cover letter is dated an earlier day.',revision:'Its documents were written before Career changed how it writes them.'};
/** @description The refusal's words for a stale job. @param {string} why staleWhy's answer. @returns {string} */
const staleWords=why=>`${STALE[why]||'Its documents are not today’s.'} Career is writing them again now; approve it once they are new.`;
/** @description The job's packet folder from its row. @param {object} row @param {string} dir @returns {string|null} */
function folderOf(row,dir){
 if(!row?.resume_path)return null;
 const file=path.resolve(dir,row.resume_path);return file.startsWith(path.resolve(dir)+path.sep)?path.dirname(file):null;
}
module.exports={QUEUE_TURN,letterZone,dayIn,documentsRevision,packetRevision,letterDay,documentsMayRun,turnWords,staleWhy,staleWords,folderOf,madeAt};
