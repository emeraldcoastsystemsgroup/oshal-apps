/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.67.3 (Roger, 2026-11-16: "it would leave out my active role ... i cant submit any resimes untill this is taken care of"): which recorded roles a prepared résumé must carry, read the same way the engine's role_plan.py reads them (a current role, no end or an end of Present/current, and every role that ended within 20 years), so a résumé prepared before the engine checked it is named as leaving a role out instead of reading as ready. tests/career-resume-roles-parity.test.mjs holds this file and role_plan.py to one answer.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve recorded month/year precision and restore dates on a cloned saved packet only from its own uniquely matched profile snapshot.
 */
'use strict';
const YEARS_CARRIED=20;
const CURRENT_WORDS=['present','current','currently','now','today','ongoing'];
const SAYS_CURRENT=/\b(present|current|currently|now|today|ongoing)\b/i;
const MONTH_NAMES=[['jan','january'],['feb','february'],['mar','march'],['apr','april'],['may'],['jun','june'],['jul','july'],
 ['aug','august'],['sep','sept','september'],['oct','october'],['nov','november'],['dec','december']];
const MONTHS=new Map(MONTH_NAMES.flatMap((names,index)=>names.map(name=>[name,index+1])));
const ORG_NOISE=new Set(['inc','llc','ltd','corp','corporation','co','company','the','plc','gmbh','lp','llp']);
const text=value=>String(value||'').replace(/\s+/g,' ').trim();
const words=value=>text(value).toLowerCase().replaceAll('&',' and ').replace(/[^a-z0-9]+/g,' ').trim();
const orgWords=value=>words(value).split(' ').filter(word=>word&&!ORG_NOISE.has(word)).join(' ');
/**
 * @description The [year, month] a recorded date names, or null; a bare year is January as a start and December as
 * an end (the last year wins). The engine's role_plan.month, line for line.
 * @param {*} value A role's start or end. @param {boolean} [last] Whether the date ends a span.
 * @returns {number[]|null} [year, month] or null.
 */
function month(value,last=false){
 const lower=text(value).toLowerCase();
 for(const [pattern,yearFirst] of [[/\b(\d{4})[-/.](\d{1,2})\b/,true],[/\b(\d{1,2})[-/.](\d{4})\b/,false]]){
  const found=lower.match(pattern);
  if(found){const [year,number]=yearFirst?[found[1],found[2]]:[found[2],found[1]];if(+year>=1900&&+year<=2100&&+number>=1&&+number<=12)return [+year,+number];}
 }
 const named=lower.match(/\b([a-z]{3,9})\.?,?\s+(\d{4})\b/);
 if(named&&MONTHS.has(named[1]))return [+named[2],MONTHS.get(named[1])];
 const years=lower.match(/\b(19\d{2}|20\d{2})\b/g);
 if(!years)return null;
 return last?[+years[years.length-1],12]:[+years[0],1];
}
/** @description A role the candidate holds now: no end, or an end that says Present or current. @param {object} role @returns {boolean} */
function isCurrent(role){
 if(role.end===null||role.end===undefined)return true;
 const end=text(role.end).toLowerCase();
 return !end||CURRENT_WORDS.some(word=>end===word||end.startsWith(word+' '));
}
function displayDate(value){
 const source=text(value),numeric=source.match(/^(19\d{2}|20\d{2}|2100)(?:[-/.](\d{1,2})(?:[-/.]\d{1,2})?)?$/);
 const reverse=source.match(/^(\d{1,2})[-/.](19\d{2}|20\d{2}|2100)$/),named=source.toLowerCase().match(/^([a-z]{3,9})\.?,?\s+(19\d{2}|20\d{2}|2100)$/);
 let year,number;
 if(numeric){year=+numeric[1];number=numeric[2]?+numeric[2]:null;}
 else if(reverse){year=+reverse[2];number=+reverse[1];}
 else if(named&&MONTHS.has(named[1])){year=+named[2];number=MONTHS.get(named[1]);}
 else return '';
 if(number===null)return String(year);
 if(number<1||number>12)return '';
 const name=MONTH_NAMES[number-1][0];return `${name[0].toUpperCase()+name.slice(1)} ${year}`;
}
function span(role,current){
 const first=displayDate(role.start),final=current?'Present':displayDate(role.end);
 if(!first)return final;
 if(!final||first===final)return first;
 return `${first} to ${final}`;
}
function rank(role,current){return [current?1:0,...(current?[9999,12]:month(role.end,true)||[0,0]),...(month(role.start)||[0,0])];}
function compare(a,b){for(let index=0;index<a.length;index++)if(a[index]!==b[index])return a[index]-b[index];return 0;}
function required(role,current,year){if(current)return true;const dated=month(role.end,true)||month(role.start);return !!dated&&dated[0]>=year-YEARS_CARRIED;}
/**
 * @description Every recorded role with a title or employer, most recent first, with `required` marking the roles a
 * prepared résumé must carry. The engine's role_plan.plan.
 * @param {object} profile The main résumé (career_db.json). @param {Date} [now] When "within 20 years" is measured from.
 * @returns {{key:string,index:number,title:string,org:string,span:string,current:boolean,required:boolean}[]} The plan.
 */
function plan(profile,now=new Date()){
 const year=now.getFullYear(),entries=[];
 (Array.isArray(profile?.roles)?profile.roles:[]).forEach((role,index)=>{
  if(!role||typeof role!=='object'||Array.isArray(role)||!(text(role.title)||text(role.org)))return;
  const current=isCurrent(role);
  entries.push({key:`R${index+1}`,index,title:text(role.title),org:text(role.org),span:span(role,current),current,required:required(role,current,year),rank:rank(role,current)});
 });
 return entries.map((entry,order)=>({entry,order})).sort((a,b)=>compare(b.entry.rank,a.entry.rank)||a.order-b.order).map(({entry})=>entry);
}
/** @description Whether two employer names are one employer (case, punctuation and company suffixes aside, or one naming the other whole). @param {*} first @param {*} second @returns {boolean} */
function sameOrg(first,second){
 const a=orgWords(first),b=orgWords(second);
 return !!a&&!!b&&(a===b||` ${b} `.includes(` ${a} `)||` ${a} `.includes(` ${b} `));
}
/**
 * @description The planned roles one résumé entry stands for (role_plan.roles_of without the strict mode): the same
 * employer, or the same title when either names none; a current role also needs its title or a span to the present.
 * @param {object} item One experience entry. @param {object[]} entries plan() output. @returns {object[]} Matches.
 */
function rolesOf(item,entries){
 const key=text(item?.role).toUpperCase(),named=entries.filter(entry=>key&&entry.key===key);
 if(named.length)return named;
 const title=words(item?.title);
 return entries.filter(entry=>{
  const titled=!!title&&title===words(entry.title),both=!!entry.org&&!!text(item?.org);
  if(!(both?sameOrg(item?.org,entry.org):titled))return false;
  return !entry.current||titled||SAYS_CURRENT.test(text(item?.span));
 });
}
/**
 * @description The required roles a résumé leaves out, most recent first.
 * @param {object} resume A generated résumé ({experience:[...]}) @param {object[]} entries plan() output.
 * @returns {object[]} Plan entries the résumé does not carry.
 */
function missing(resume,entries){
 const carried=new Set((Array.isArray(resume?.experience)?resume.experience:[]).filter(item=>item&&typeof item==='object')
  .flatMap(item=>rolesOf(item,entries).map(entry=>entry.key)));
 return entries.filter(entry=>entry.required&&!carried.has(entry.key));
}
function dateMatches(item,profile){
 const recorded=(Array.isArray(profile?.roles)?profile.roles:[]).filter(role=>role&&typeof role==='object'&&!Array.isArray(role)&&(text(role.title)||text(role.org)));
 const anchor=value=>text(value).toLowerCase();
 const found=recorded.filter(role=>anchor(item.title)===anchor(role.title)&&anchor(item.org)===anchor(role.org));
 if(item.id!==undefined&&item.id!==null&&item.id!==''){
  if(typeof item.id!=='string'||!/^[A-Za-z0-9_.:-]{1,80}$/.test(item.id))return [];
  const named=recorded.filter(role=>role.id===item.id);
  return named.length===1?(found.includes(named[0])?named:[]):named;
 }
 return found;
}
/**
 * @description Restore display dates on a copy using only uniquely matched roles in this packet's own snapshot.
 * @param {object} resume Saved generated résumé; never mutated.
 * @param {object} profile The same packet's saved profile_snapshot, never a current profile fallback.
 * @returns {{resume:object,dates:{known:number[],updated:number[],ambiguous:number[],unavailable:number[]}}} Copy and original experience-index evidence.
 */
function preserveDates(resume,profile){
 const copy=resume&&typeof resume==='object'&&!Array.isArray(resume)?structuredClone(resume):{};
 const dates={known:[],updated:[],ambiguous:[],unavailable:[]};
 (Array.isArray(copy.experience)?copy.experience:[]).forEach((item,index)=>{
  if(!item||typeof item!=='object'||Array.isArray(item)){dates.unavailable.push(index);return;}
  const found=dateMatches(item,profile);
  if(found.length>1){dates.ambiguous.push(index);return;}
  const role=found.length===1?found[0]:null;
  const complete=role&&displayDate(role.start)&&(isCurrent(role)||displayDate(role.end));
  const value=complete?span(role,isCurrent(role)):'';
  if(!value){dates.unavailable.push(index);return;}
  dates.known.push(index);
  if(item.span!==value){item.span=value;dates.updated.push(index);}
 });
 return {resume:copy,dates};
}
/**
 * @description The words a person reads for roles a prepared résumé leaves out.
 * @param {{title:string,org:string,current:boolean}[]} roles The missing roles. @returns {string} One sentence, or ''.
 */
function sentence(roles){
 if(!roles?.length)return '';
 const named=roles.slice(0,3).map(role=>[role.title,role.org].filter(Boolean).join(' at ')),more=roles.length-named.length;
 const list=more>0?`${named.join(', ')} and ${more} more`:named.length>1?named.slice(0,-1).join(', ')+' and '+named[named.length-1]:named[0];
 const which=roles.some(role=>role.current)?(roles.length===1?'your current role':'roles from your work history, your current role among them'):(roles.length===1?'a role from your work history':'roles from your work history');
 return `This résumé leaves out ${which}: ${list}.`;
}
module.exports={YEARS_CARRIED,month,isCurrent,plan,sameOrg,rolesOf,missing,sentence,preserveDates};
