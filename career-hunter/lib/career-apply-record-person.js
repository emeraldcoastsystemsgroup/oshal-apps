/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career 1.78.0 (answers from the person's record, design career-self-improving-applications-2026-11-27 part 3): the person view career-apply-record-rules.js answers from, built only from the signed-in person's own store for one job: the facts an approval may type (career-apply-packet.js facts, with this employer and the current one), the record's roles and education with their dates, the words the roles and skills use, the standing answers, every saved answer, the Attestations switches, the Matching area (home, radius, remote), the job's company, place and distance from home, and the first two paragraphs of the letter Career wrote for this job. view() is pure; forJob() reads the files. Nothing here is written, and nothing is named for one person.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createChildLogger}=require('@/shared/logger');
const packet=require('./career-apply-packet'),answers=require('./career-apply-answers'),place=require('./career-job-place');
const logger=createChildLogger({module:'career-apply-record-person'});
const MAX_RECORD=4*1024*1024,MAX_LETTER=1100,MAX_TEXT=40000;
const words=value=>typeof value==='string'||typeof value==='number'?String(value).replace(/\s+/g,' ').trim():'';
const list=value=>Array.isArray(value)?value:[];

/** @description The record's roles with their dates as recorded. @param {object} careerDb @returns {object[]} */
const rolesOf=careerDb=>list(careerDb?.roles).filter(role=>role&&typeof role==='object').slice(0,60)
 .map(role=>({title:words(role.title),org:words(role.org||role.employer),start:words(role.start)||null,end:words(role.end)||null}));
/** @description Every word the record's roles and skills use, for "do you have experience with ...". @param {object} careerDb @returns {string} */
function recordText(careerDb){
 const skills=Array.isArray(careerDb?.skills)?careerDb.skills:Object.values(careerDb?.skills&&typeof careerDb.skills==='object'?careerDb.skills:{}).flatMap(group=>list(group?.items||group));
 const parts=[...list(careerDb?.roles).flatMap(role=>[role?.title,role?.org,...list(role?.deliverables),...list(role?.skills)]),...skills,careerDb?.headline,careerDb?.summary];
 return parts.map(words).filter(Boolean).join(' . ').slice(0,MAX_TEXT);
}
/** @description The first two paragraphs of the job's letter, the words a "why us" box takes. @param {object|null} cover @returns {string} */
function letterOf(cover){
 const paragraphs=list(cover?.paragraphs).map(words).filter(Boolean).slice(0,2);
 const text=paragraphs.join(' ');return text.length<=MAX_LETTER?text:text.slice(0,MAX_LETTER).replace(/\s+\S*$/,'');
}
/**
 * @description The person view for one job. @param {object} input {profile (normalizeAutofillProfile), standing, saved (Saved
 * answers' list), attest, careerDb, cover, posting {company,title,location,lat,lon,remote}, home (Matching area or null), today}
 * @returns {object} What career-apply-record-rules.js settle() reads.
 */
function view({profile,standing,saved,attest,careerDb,cover,posting,home,today}){
 const facts=packet.facts(profile||{},standing||{}),roles=rolesOf(careerDb),current=roles.find(role=>!role.end)||roles[0];
 if(words(current?.org))facts['work.employer']=words(current.org);
 const job=posting?place.decorate({title:posting.title,location:posting.location,remote:posting.remote,lat:posting.lat,lon:posting.lon},home||null):null;
 return {facts,standing:standing||{},saved:list(saved).map(item=>({text:words(item.text),value:words(item.value)})),attest:{terms:attest?.terms===true,selfIdSignature:attest?.selfIdSignature===true},
  roles,education:packet.education(careerDb||{}),recordText:recordText(careerDb),currentTitle:words(current?.title),
  home:home?{near:words(home.near),radiusMiles:Number(home.radiusMiles),includeRemote:home.includeRemote===true}:null,
  job:job?{company:words(posting.company),title:words(posting.title),location:job.location,workplaceType:job.workplaceType,distanceMiles:job.distanceMiles}:null,
  country:facts['address.country']||'',state:facts['address.state']||'',stateAbbrev:facts['address.state_abbrev']||'',city:facts['address.city']||'',
  letter:letterOf(cover),today:today||new Date().toISOString().slice(0,10)};
}
/** @description One of the person's JSON files, or null when it is missing; a link or an oversized file is refused. */
function readJson(file){
 let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_RECORD)throw Object.assign(Error('A record file is unavailable.'),{code:'record_unavailable'});
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
/**
 * @description The person view for one of the signed-in person's jobs, read from their own store. A file that cannot be
 * read leaves its part empty (logged), so a rule that needs it settles nothing rather than guessing.
 * @param {string} sub The signed-in person. @param {string} dir Their store. @param {number} postingId The job.
 * @param {{profile:Function,posting:Function,home:Function}} deps loadAutofillProfile, the job's row, the Matching area.
 * @returns {Promise<object>} The view.
 */
async function forJob(sub,dir,postingId,deps){
 const saved=answers.read(dir),row=deps.posting(sub,postingId)||null;
 let careerDb=null,cover=null,home=null;
 try{careerDb=readJson(path.join(dir,'career_db.json'));}catch(error){logger.error({err:error},'record unreadable for answers from the record');}
 try{home=deps.home(dir);}catch(error){logger.error({err:error},'matching area unreadable for answers from the record');}
 try{const folder=row?.resume_path&&path.dirname(path.resolve(dir,row.resume_path));
  if(folder&&path.resolve(folder).startsWith(path.resolve(dir)+path.sep))cover=readJson(path.join(folder,'application.json'))?.generated?.cover||null;}
 catch(error){logger.error({err:error,postingId},'letter unreadable for answers from the record');}
 return view({profile:await deps.profile(sub),standing:saved.standing,saved:saved.answers,attest:saved.attest,careerDb,cover,posting:row,home});
}
module.exports={view,forJob,recordText,letterOf,rolesOf};
