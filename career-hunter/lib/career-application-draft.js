/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Persist owner/job tailoring with revision checks and bind document readiness to the actual generation inputs and receipt.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 4, 11, 12, 13 and 14: one name for each page and for each role. One refusal says other experience (was additional experience). Words only.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const board=require('./career-board-state'),bank=require('./career-experience-bank'),queue=require('./career-submission-queue');
const DONE=new Set(['applied','interview','offer','rejected']),HELD=new Set(['queued','claimed','reviewing','submitting','unknown','submitted']);
class DraftError extends Error{constructor(code,message,status=409){super(message);this.code=code;this.status=status;}}
const fail=(code,message,status)=>{throw new DraftError(code,message,status);};
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
function latestIntent(dir,id){return Object.values(queue.read(dir).items).filter(item=>item.postingId===id&&item.status!=='cancelled')
 .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.updatedAt.localeCompare(a.updatedAt))[0]||null;}
function mutable(dir,id,job){const intent=latestIntent(dir,id);if(DONE.has(job.status)||intent&&HELD.has(intent.status))
 fail('application_locked','This application has approved or submitted work. Check its outcome before changing the documents.');}
function source(dir,value,validateRevision=false){
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.guidance!=='string'||value.guidance.length>2000
  ||!Array.isArray(value.experienceIds)||value.experienceIds.length>12||value.experienceIds.some(id=>typeof id!=='string'||id.length>100))
  fail('draft_invalid','Keep tailoring within 2,000 characters and select recorded experience.',400);
 const ids=[...new Set(value.experienceIds)].sort(),current=bank.read(dir);
 const selection=bank.selection(dir,ids,validateRevision?value.experienceRevision:current.revision);
 const profile=path.join(dir,'career_db.json');let profileHash='';
 if(fs.existsSync(profile)){const info=fs.lstatSync(profile);if(!info.isFile()||info.isSymbolicLink()||info.size>2*1024*1024)fail('profile_unavailable','The core résumé is unavailable.',503);profileHash=hash(fs.readFileSync(profile));}
 const clean={guidance:value.guidance.trim(),experienceIds:ids,experienceRevision:current.revision};
 const inputsHash=hash(JSON.stringify({guidance:clean.guidance,experienceIds:ids,experience:selection.entries.filter(entry=>ids.includes(entry.id)),profileHash}));
 return {...clean,inputsHash};
}
function effectiveGeneration(saved){
 const pending=saved.generationDraft;
 if(pending&&saved.requestId===pending.requestId&&saved.phase==='ready'&&saved.completedAt)return pending;
 return saved.documentGeneration||null;
}
function settled(saved){const pending=saved.generationDraft;if(pending&&saved.requestId===pending.requestId&&saved.completedAt)return {generationDraft:{...pending,state:saved.phase==='ready'?'ready':'failed'}};return {};}
function packetHashes(dir,job){const resolve=require('../routes/career-resume-preview').resolveContainedRegularFile;const output={};for(const [kind,name]of [['resume',job.resume_path],['cover',job.cover_path]]){const file=typeof name==='string'&&resolve(name,dir);if(!file)return null;const stat=fs.lstatSync(file);if(stat.size>2*1024*1024)return null;output[kind]=hash(fs.readFileSync(file));}return output;}
function view(dir,id,job){
 const saved=board.readBoardState(dir).jobs[id]||{},stored=saved.applicationDraft;
 const draft=stored||{revision:0,guidance:'',experienceIds:saved.experienceIds||[],experienceRevision:bank.read(dir).revision};
 let input,unavailable=null;try{input=source(dir,draft);}catch(error){unavailable=error.message;}
 const generated=effectiveGeneration(saved),held=latestIntent(dir,id),hasDocuments=!!job.has_resume&&!!job.has_cover;
 const receiptDone=saved.generationDraft?.requestId===saved.requestId&&!!saved.completedAt;
 const busy=saved.generationDraft?.state==='requested'&&!receiptDone&&saved.documentGeneration?.requestId!==saved.generationDraft.requestId;
 const acknowledged=saved.reviewedPrevious?.afterAttempt===saved.generationDraft?.requestId&&saved.reviewedPrevious?.inputsHash===input?.inputsHash;
 const failed=!acknowledged&&(['refused','failed'].includes(saved.generationDraft?.state)||saved.phase==='failed'&&saved.generationDraft?.requestId===saved.requestId);
 const baseline=generated?.inputsHash||stored?.legacyInputsHash;
 const outdated=!!unavailable||!!baseline&&baseline!==input?.inputsHash;
 return {draft:{...draft,experienceIds:[...(draft.experienceIds||[])]},intent:held?queue.publicItem(held):null,
  legacy:!generated,needsGeneration:!hasDocuments||busy||failed||outdated,documentsOutdated:outdated,
  busy,failed,unavailable,canRestoreDocuments:!!(saved.documentGeneration?.inputs||stored?.legacyInputs)&&hasDocuments&&!busy,inputsHash:input?.inputsHash||null,documentRequestId:generated?.requestId||null,
  locked:DONE.has(job.status)||!!held&&HELD.has(held.status)};
}
function save(dir,id,job,input){
 mutable(dir,id,job);
 if(Object.keys(input||{}).some(key=>!['revision','guidance','experienceIds','experienceRevision'].includes(key)))fail('draft_invalid','Unsupported application draft field.',400);
 const state=board.readBoardState(dir).jobs[id]||{},previous=state.applicationDraft,expected=input?.revision;
 if(!Number.isSafeInteger(expected)||expected<0)fail('draft_invalid','Read the current draft before saving.',400);
 if(expected!==(previous?.revision||0))fail('draft_conflict','This draft changed in another tab. Your unsaved text is retained; reload the saved draft before continuing.');
 const clean=source(dir,input,true),generated=effectiveGeneration(state);
 let legacyInputsHash=previous?.legacyInputsHash;
 if(!previous&&!generated&&job.has_resume&&job.has_cover){try{legacyInputsHash=source(dir,{guidance:'',experienceIds:state.experienceIds||[]}).inputsHash;}catch{/* Incomplete legacy sources require regeneration. */}}
 const same=previous&&previous.guidance===clean.guidance&&JSON.stringify(previous.experienceIds)===JSON.stringify(clean.experienceIds)&&previous.experienceRevision===clean.experienceRevision;
 const legacyInputs=previous?.legacyInputs||(!previous&&!generated&&legacyInputsHash?{guidance:'',experienceIds:state.experienceIds||[],experienceRevision:clean.experienceRevision}:null);
 const draft={revision:same?previous.revision:expected+1,guidance:clean.guidance,experienceIds:clean.experienceIds,
  experienceRevision:clean.experienceRevision,savedAt:new Date().toISOString(),...(legacyInputsHash?{legacyInputsHash,legacyInputs}:{})};
 board.updateBoardState(dir,id,{applicationDraft:draft,...settled(state),...(generated?{documentGeneration:generated}:{})});
 return view(dir,id,job);
}
function begin(dir,id,job,input,requestId,documents){
 const saved=board.readBoardState(dir).jobs[id]||{},generated=effectiveGeneration(saved);
 if(!documents){if(generated||saved.generationDraft)board.updateBoardState(dir,id,{...settled(saved),...(generated?{documentGeneration:generated}:{})});return;}
 mutable(dir,id,job);
 const previous=saved.applicationDraft,clean=source(dir,input,true);
 if(previous&&input.revision!==previous.revision&&(input.revision!==undefined||clean.inputsHash!==source(dir,previous).inputsHash))fail('draft_conflict','Save the current application draft before generating.');
 const current=save(dir,id,job,{revision:previous?.revision||0,guidance:clean.guidance,experienceIds:clean.experienceIds,experienceRevision:clean.experienceRevision});
 board.updateBoardState(dir,id,{generationDraft:{requestId,inputsHash:current.inputsHash,inputs:{guidance:clean.guidance,experienceIds:clean.experienceIds,experienceRevision:clean.experienceRevision},previousDocumentHashes:packetHashes(dir,job),draftRevision:current.draft.revision,state:'requested'},...(generated?{documentGeneration:generated}:{})});
 return current;
}
function assertReady(dir,id,job){const state=view(dir,id,job);if(state.needsGeneration)fail('documents_outdated',state.unavailable||'Generate and review documents for the current tailoring and experience before submitting.');return state;}
function refused(dir,id,requestId){const saved=board.readBoardState(dir).jobs[id]||{};if(saved.generationDraft?.requestId===requestId)board.updateBoardState(dir,id,{generationDraft:{...saved.generationDraft,state:'refused'}});}
function restore(dir,id,job,input){mutable(dir,id,job);if(Object.keys(input||{}).some(key=>!['revision','restore'].includes(key))||input.restore!==true)fail('draft_invalid','Select the previous version explicitly.',400);const saved=board.readBoardState(dir).jobs[id]||{},current=view(dir,id,job);if(current.busy)fail('generation_active','Wait for the current generation to finish.');if(input.revision!==current.draft.revision)fail('draft_conflict','Read the current saved draft before restoring.');const previous=saved.documentGeneration,inputs=previous?.inputs||current.draft.legacyInputs,expected=previous?.inputsHash||current.draft.legacyInputsHash;if(!inputs||!expected)fail('previous_unavailable','The earlier document inputs are unavailable. Generate a fresh packet.');const bankNow=bank.read(dir),clean=source(dir,{...inputs,experienceRevision:bankNow.revision},true);if(clean.inputsHash!==expected)fail('previous_outdated','Your résumé or other experience changed. Generate a current packet.');const proof=saved.generationDraft?.previousDocumentHashes;if(saved.generationDraft&&(!proof||JSON.stringify(proof)!==JSON.stringify(packetHashes(dir,job))))fail('previous_changed','The previous document bytes could not be verified. Generate a fresh packet.');save(dir,id,job,{revision:current.draft.revision,guidance:clean.guidance,experienceIds:clean.experienceIds,experienceRevision:clean.experienceRevision});board.updateBoardState(dir,id,{reviewedPrevious:{inputsHash:expected,afterAttempt:saved.generationDraft?.requestId||null,at:new Date().toISOString()}});return view(dir,id,job);}
module.exports={DraftError,view,save,begin,refused,restore,assertReady,latestIntent,effectiveGeneration,mutable};
