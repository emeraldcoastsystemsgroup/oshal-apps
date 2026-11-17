/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.1 (Roger, 2026-11-16: "when i get to the application screen it fully generated my resume without asking me about adding in my optional addendum"; "this is not a choice in bulk edit"): the Other experience a person chose for the last application they prepared, kept in their own store (experience-choice.json, 0600, written whole). Prepare application and bulk Prepare tick it again for a job with no choice of its own, and saved-job preparation uses it for such a job; a person who never chose has none, and that preparation waits. An unreadable or unexpected file reads as no choice, never as a failed read. Guard: tests/career-prepare-other-experience-route.test.mjs.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const FILE='experience-choice.json',MAX_BYTES=4096,ID=/^[a-zA-Z0-9-]{8,80}$/;

/**
 * @description Whether a list is an Other experience selection the routes accept: at most twelve distinct entry ids.
 * @param {*} ids The candidate list.
 * @returns {boolean}
 */
function validIds(ids){return Array.isArray(ids)&&ids.length<=12&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'&&ID.test(id));}

/**
 * @description The person's remembered choice: the entry ids they chose for the last application they prepared, and when.
 * A missing, oversized, linked or malformed file is no remembered choice, so a read of the person's experience never fails on it.
 * @param {string} dir The person's own store folder.
 * @returns {{experienceIds:string[], savedAt:string}|null}
 */
function read(dir){
 if(!dir)return null;
 try{
  const file=path.join(dir,FILE),info=fs.lstatSync(file);
  if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_BYTES)return null;
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!data||data.version!==1||!validIds(data.experienceIds)||typeof data.savedAt!=='string')return null;
  return {experienceIds:[...data.experienceIds],savedAt:data.savedAt};
 }catch{return null;/* no remembered choice yet, or one that cannot be read: the person is asked */}
}

/**
 * @description Keep the choice a person just prepared an application with as their last choice (an empty list is a choice too).
 * Written to a new file and renamed over the old one, so a reader never sees half a file.
 * @param {string} dir The person's own store folder.
 * @param {string[]} ids The entry ids they chose.
 * @returns {{experienceIds:string[], savedAt:string}} What was kept.
 */
function remember(dir,ids){
 if(!validIds(ids)){const error=Error('Select at most twelve other experience entries.');error.status=400;throw error;}
 const value={version:1,experienceIds:[...ids],savedAt:new Date().toISOString()};
 const file=path.join(dir,FILE),temp=file+'.'+crypto.randomUUID()+'.tmp';
 try{fs.writeFileSync(temp,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}
 finally{fs.rmSync(temp,{force:true});}
 return {experienceIds:value.experienceIds,savedAt:value.savedAt};
}

/**
 * @description Whether a job's own tailoring holds an Other experience choice the person made: one they saved or prepared with
 * on Prepare application or in bulk Prepare (experienceChosen), or any entry ticked (a non-empty list is a choice).
 * @param {object|null|undefined} draft The job's saved tailoring (applicationDraft).
 * @returns {boolean}
 */
function chosen(draft){return !!draft&&(draft.experienceChosen===true||(Array.isArray(draft.experienceIds)&&draft.experienceIds.length>0));}

module.exports={read,remember,chosen,validIds,FILE};
