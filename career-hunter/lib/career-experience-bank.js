/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Keep optional additional experience separate from the master, seed only the owner's saved portfolio, and require revision-checked writes and per-application selection.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 4, 11, 12, 13 and 14: one name for each page and for each role. Every refusal says other experience, the page's name (was additional experience). Words only; the file, its fields and its status codes are unchanged.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.68.1 (Roger, 2026-11-16: "it fully generated my resume without asking me about adding in my optional addendum"): read() also answers `last`, the Other experience the person chose for the last application they prepared (lib/career-experience-choice.js), kept to entries still offered (null when they never chose), so Prepare application and bulk Prepare can tick it again. The revision is unchanged: it still covers only this file and the main résumé. Guard: tests/career-prepare-other-experience-route.test.mjs.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.68.7 (Roger, 2026-11-17: "the bullets for oshal now should be oswarm and updated"): the saved portfolio has its own Edit form (field portfolio of POST /resume/master-edit), which job scoring and résumés both read. Saving that entry through this list's own form wrote a copy into this file, which résumés then used while job scoring kept reading the portfolio, so update() refuses it (409) while the entry still comes from the main résumé; a copy saved before 1.68.7 is edited here as before. Guard: tests/career-portfolio-edit.test.mjs.
 */
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const choice=require('./career-experience-choice');
const FILE='experience-bank.json',KINDS=new Set(['project','work','volunteer','skills']),LEGACY='saved-portfolio';
const error=(message,status=400)=>Object.assign(Error(message),{status});
function bytes(file,max){try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw error('Other experience is unavailable.',503);return fs.readFileSync(file);}catch(e){if(e.code==='ENOENT')return Buffer.alloc(0);throw e;}}
function text(v,max,required=false){if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)||required&&!v.trim())throw error('Enter a title and factual work details within the displayed limits.');return v.trim();}
function clean(entry){if(!entry||typeof entry!=='object'||Array.isArray(entry)||Object.keys(entry).some(k=>!['title','kind','organization','period','facts','skills'].includes(k)))throw error('Use the fields the Other experience page shows.');if(!KINDS.has(entry.kind)||!Array.isArray(entry.skills)||entry.skills.length>128)throw error('Choose an experience type and at most 128 skills.');return {title:text(entry.title,160,true),kind:entry.kind,organization:text(entry.organization||'',160),period:text(entry.period||'',100),facts:text(entry.facts,32000,true),skills:[...new Set(entry.skills.map(s=>text(s,100,true)))]};}
function read(dir){
 const raw=bytes(path.join(dir,FILE),512*1024),master=bytes(path.join(dir,'career_db.json'),4*1024*1024);
 let data=raw.length?JSON.parse(raw):{version:1,entries:[]};if(data.version!==1||!Array.isArray(data.entries)||data.entries.length>64)throw error('Other experience is invalid.',503);
 const entries=data.entries.map(e=>{if(typeof e.id!=='string'||! /^[a-zA-Z0-9-]{8,80}$/.test(e.id)||typeof e.archived!=='boolean')throw error('Other experience is invalid.',503);return {...e,...clean({title:e.title,kind:e.kind,organization:e.organization,period:e.period,facts:e.facts,skills:e.skills})};});
 if(!entries.some(e=>e.id===LEGACY)&&master.length){const portfolio=JSON.parse(master).oss_portfolio;if(portfolio&&typeof portfolio==='object'&&!Array.isArray(portfolio)&&Object.keys(portfolio).length){entries.unshift({id:LEGACY,title:String(portfolio.name||portfolio.entry?.org||portfolio.label||'Saved independent work').slice(0,160),kind:'project',organization:typeof portfolio.entry?.org==='string'?portfolio.entry.org:'Independent project',period:typeof portfolio.entry?.span==='string'?portfolio.entry.span:'',facts:JSON.stringify(portfolio,null,2),skills:Array.isArray(portfolio.skills)?portfolio.skills:[],archived:false,source:'Saved career portfolio'});}}
 const revision=crypto.createHash('sha256').update(Buffer.concat([Buffer.from('experience-bank/v1\0'),raw,Buffer.from('\0'),master])).digest('hex');
 return {version:1,entries,revision,last:lastChoice(dir,entries)};
}
/** @description The person's remembered choice kept to the entries still offered; null when they never chose. @param {string} dir Owner store. @param {object[]} entries The library. @returns {{experienceIds:string[],savedAt:string}|null} */
function lastChoice(dir,entries){const kept=choice.read(dir);return kept?{experienceIds:kept.experienceIds.filter(id=>entries.some(e=>e.id===id&&!e.archived)),savedAt:kept.savedAt}:null;}
/** @description Whether this list's own file keeps an entry under the saved portfolio's id (a copy saved on this page before 1.68.7). @param {string} dir Owner store. @returns {boolean} */
function heldCopy(dir){const raw=bytes(path.join(dir,FILE),512*1024);if(!raw.length)return false;const data=JSON.parse(raw);return Array.isArray(data.entries)&&data.entries.some(e=>e&&e.id===LEGACY);}
function update(dir,input){
 if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['operation','expectedRevision','id','entry'].includes(k)))throw error('Use the Other experience page.');
 const current=read(dir);if(input.expectedRevision!==current.revision)throw error('The experience library changed. Reload it before saving.',409);
 if(input.operation==='save'&&input.id===LEGACY&&!heldCopy(dir))throw error('Your saved portfolio has its own Edit form on this page, which job scoring and résumés both read. Open the entry to change it there. Nothing was saved.',409);
 const entries=current.entries.map(e=>({...e}));let index=entries.findIndex(e=>e.id===input.id);
 if(input.operation==='save'){
  const entry=clean(input.entry);if(input.id&&index<0)throw error('This experience entry no longer exists.',404);
  if(index<0){if(entries.length>=64)throw error('The library supports 64 entries.');entries.push({...entry,id:crypto.randomUUID(),archived:false,source:'Your recorded work',updatedAt:new Date().toISOString()});}
  else entries[index]={...entries[index],...entry,updatedAt:new Date().toISOString()};
 }else if(['archive','restore'].includes(input.operation)&&index>=0)entries[index].archived=input.operation==='archive';else throw error('Choose an existing experience entry.');
 const output=JSON.stringify({version:1,entries})+'\n';if(Buffer.byteLength(output)>512*1024)throw error('Your other experience list is full.');
 const file=path.join(dir,FILE),temp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temp,output,{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
 return read(dir);
}
function selection(dir,ids,revision){const bank=read(dir);if(!Array.isArray(ids)||ids.length>12||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))throw error('Select at most twelve other experience entries.');if(ids.length&&revision!==bank.revision)throw error('Your other experience changed. Reopen preparation to select its current version.',409);if(ids.some(id=>!bank.entries.some(e=>e.id===id&&!e.archived)))throw error('An experience entry is no longer available.');return bank;}
module.exports={read,update,selection,heldCopy,LEGACY};
