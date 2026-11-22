/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Expose preparation review/readiness against exact packet bytes and current tailoring, independently of submission.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Persist owner/job tailoring with revision checks and bind document readiness to the actual generation inputs and receipt.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 4, 11, 12, 13 and 14: one name for each page and for each role. One refusal says other experience (was additional experience). Words only.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.67.3 (Roger, 2026-11-16: "it would leave out my active role ... i cant submit any resimes untill this is taken care of"): a prepared résumé that leaves out a role the main résumé requires (a current role, or one that ended within 20 years: lib/career-resume-roles.js, the engine's rules) is not ready. view() names those roles as missingRoles and asks for generation, so Prepare application opens on step 1 · Tailor with Generate résumé & cover letter, and assertReady refuses review and sending in words that name the role. The packet is the one the job's résumé path names, else the job's own folder in applications/. A submitted application keeps its documents as the record.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.68.1 (Roger, 2026-11-16: "it fully generated my resume without asking me about adding in my optional addendum"): a job's tailoring remembers that the person chose its Other experience (experienceChosen, kept once set; not part of the inputs, so it never makes documents outdated). save() accepts it from Prepare application, and begin() from the generate route when Prepare application or bulk Prepare sends it; a generation the person chose for also becomes their last choice (lib/career-experience-choice.js), which Prepare application and bulk Prepare tick again for a job with no choice of its own. Guard: tests/career-prepare-other-experience-route.test.mjs.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.68.5 (Roger, 2026-11-16: "my cover letter ... lies about my level of expertise on c# ... the cover letter is not acceptable"): view() reads what the engine's claims check did to the job's packet (lib/career-letter-claims.js) as claims: a letter it marked needs your review (still too thin after Career took out what the records do not support, even after one rewrite) carries needsReview and a notice that names the problems, and assertReady refuses sending it in those words until the person edits the letter or confirms they checked it (confirmClaims, bound to that letter's fingerprint). A submitted application keeps its documents as the record.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | 1.68.15: surface pre-return career-resume-reviewer quality receipts from application.json as resumeReview on view() via lib/career-resume-review.js.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | 1.68.19: add markEdited(dir,id) so saving an edited tailored packet syncs documentGeneration.inputsHash and clears stale generationDraft/failed state without forcing regeneration, and add acceptCurrent(dir,id,job,input) so a user with both saved documents and no missing required roles can review them directly despite an earlier main-résumé or tailoring change.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | 1.68.25 (store gate, 2026-11-19: a job read said the preparation was complete with no claims check): view() takes the saved job state its caller already read. GET /jobs/:id reads that state once, before the job's row, and answers both the receipt and this view from it, so an answer that says complete always carries the documents: the engine saves the documents and the row first and the completed receipt last. Read after the row, as before, a read the engine finished during said complete over a row with no documents. Callers that pass nothing read it here, as before. Guard: tests/career-ready-with-documents.test.mjs.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-REGEN: export DONE and HELD (the job statuses and submission states that lock an application's documents), so Generate again (lib/career-regenerate-routes.js) refuses exactly the jobs this module locks. No behaviour change.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const board=require('./career-board-state'),bank=require('./career-experience-bank'),queue=require('./career-submission-queue');
const roles=require('./career-resume-roles'),letterClaims=require('./career-letter-claims'),resumeReview=require('./career-resume-review');
const experienceChoice=require('./career-experience-choice');
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
const JSON_LIMIT=4*1024*1024;
function readJson(file){try{const info=fs.lstatSync(file);if(!info.isFile()||info.size>JSON_LIMIT)return null;return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
/** The folder of the job's prepared packet: the one its résumé path names, else its own folder in applications/ (the newest). */
function packetFolder(dir,id,job){
 try{const file=typeof job.resume_path==='string'&&job.resume_path&&require('../routes/career-resume-preview').resolveContainedRegularFile(job.resume_path,dir);if(file)return path.dirname(file);}catch{/* the stored path is another runtime's; look in applications/ */}
 try{const apps=path.join(dir,'applications'),stamp=name=>fs.lstatSync(path.join(apps,name,'application.json')).mtimeMs;
  const found=fs.readdirSync(apps).filter(name=>name.endsWith('__'+id)&&fs.existsSync(path.join(apps,name,'application.json'))).sort((a,b)=>stamp(b)-stamp(a));
  return found.length?path.join(apps,found[0]):null;}catch{return null;}
}
/**
 * @description The roles the main résumé requires (lib/career-resume-roles.js) that this job's prepared résumé leaves
 * out. [] for a job with no résumé, a submitted one, or when the packet or the main résumé cannot be read.
 * @param {string} dir Owner store. @param {number} id Posting. @param {object} job Its row (status, has_resume, resume_path).
 * @returns {{title:string,org:string,current:boolean}[]} The missing roles, most recent first.
 */
function missingRoles(dir,id,job,packet){
 if(!job?.has_resume||DONE.has(job.status))return [];
 const record=packet===undefined?packetRecord(dir,id,job):packet,resume=record?.generated?.resume,profile=readJson(path.join(dir,'career_db.json'));
 if(!resume||typeof resume!=='object'||!profile)return [];
 return roles.missing(resume,roles.plan(profile)).map(({title,org,current})=>({title,org,current}));
}
/** @description The job's prepared packet record (application.json), read once per view. @param {string} dir Owner store.
 * @param {number} id Posting. @param {object} job Its row. @returns {object|null} The record. */
function packetRecord(dir,id,job){const folder=packetFolder(dir,id,job);return folder?readJson(path.join(folder,'application.json')):null;}
/**
 * @description What the engine's claims check did to this job's prepared packet (lib/career-letter-claims.js), with the
 * person's confirmation applied. null for a job with no documents, a submitted one, or a packet the check never saw.
 * @param {object} job Its row. @param {object|null} packet Its packet record. @param {object} saved Its board state.
 * @returns {object|null} The claims state.
 */
function claimsState(job,packet,saved){
 if(!job?.has_cover||DONE.has(job.status)||!packet)return null;
 return letterClaims.state(packet,saved?.claimsReviewed);
}
/** @description Pre-return career-resume-reviewer quality state from application.json, or null. */
function resumeReviewState(job,packet){
 if(!job?.has_resume||DONE.has(job.status)||!packet)return null;
 return resumeReview.state(packet);
}
/**
 * @description The application as Prepare application shows it: the tailoring, whether the documents are current, what
 * the engine's checks did to them and where the preparation stands. A caller that answers with the preparation receipt
 * too (GET /jobs/:id) hands in the saved job state it read BEFORE the job's row, so the receipt and this view come from
 * one read: the engine saves the documents and the row first and the completed receipt last, so a receipt read first
 * never says complete over a row from before the documents.
 * @param {string} dir Owner store. @param {number} id Posting. @param {object} job Its row (status, has_resume, has_cover, resume_path).
 * @param {object} [state] The saved job state (readBoardState) read before `job`; read here when absent.
 * @returns {object} The application view.
 */
function view(dir,id,job,state){
 const saved=(state||board.readBoardState(dir)).jobs[id]||{},stored=saved.applicationDraft;
 const draft=stored||{revision:0,guidance:'',experienceIds:saved.experienceIds||[],experienceRevision:bank.read(dir).revision};
 let input,unavailable=null;try{input=source(dir,draft);}catch(error){unavailable=error.message;}
 const generated=effectiveGeneration(saved),held=latestIntent(dir,id),hasDocuments=!!job.has_resume&&!!job.has_cover;
 const receiptDone=saved.generationDraft?.requestId===saved.requestId&&!!saved.completedAt;
 const busy=saved.generationDraft?.state==='requested'&&!receiptDone&&saved.documentGeneration?.requestId!==saved.generationDraft.requestId;
 const acknowledged=saved.reviewedPrevious?.afterAttempt===saved.generationDraft?.requestId&&saved.reviewedPrevious?.inputsHash===input?.inputsHash;
 const failed=!acknowledged&&(['refused','failed'].includes(saved.generationDraft?.state)||saved.phase==='failed'&&saved.generationDraft?.requestId===saved.requestId);
 const baseline=generated?.inputsHash||stored?.legacyInputsHash;
 const outdated=!!unavailable||!!baseline&&baseline!==input?.inputsHash,packet=job.has_resume||job.has_cover?packetRecord(dir,id,job):null,left=missingRoles(dir,id,job,packet);
 const result={draft:{...draft,experienceIds:[...(draft.experienceIds||[])]},intent:held?queue.publicItem(held):null,
  legacy:!generated,needsGeneration:!hasDocuments||busy||failed||outdated||left.length>0,documentsOutdated:outdated,missingRoles:left,rolesNotice:roles.sentence(left),
  claims:claimsState(job,packet,saved),resumeReview:resumeReviewState(job,packet),busy,failed,unavailable,canRestoreDocuments:!!(saved.documentGeneration?.inputs||stored?.legacyInputs)&&hasDocuments&&!busy,inputsHash:input?.inputsHash||null,documentRequestId:generated?.requestId||null,
  locked:DONE.has(job.status)||!!held&&HELD.has(held.status)};
 return {...result,workflow:require('./career-application-workflow').view(dir,id,job,result,state)};
}
function save(dir,id,job,input){
 mutable(dir,id,job);
 if(Object.keys(input||{}).some(key=>!['revision','guidance','experienceIds','experienceRevision','experienceChosen'].includes(key))||input?.experienceChosen!==undefined&&typeof input?.experienceChosen!=='boolean')fail('draft_invalid','Unsupported application draft field.',400);
 const state=board.readBoardState(dir).jobs[id]||{},previous=state.applicationDraft,expected=input?.revision;
 if(!Number.isSafeInteger(expected)||expected<0)fail('draft_invalid','Read the current draft before saving.',400);
 if(expected!==(previous?.revision||0))fail('draft_conflict','This draft changed in another tab. Your unsaved text is retained; reload the saved draft before continuing.');
 const clean=source(dir,input,true),generated=effectiveGeneration(state);
 let legacyInputsHash=previous?.legacyInputsHash;
 if(!previous&&!generated&&job.has_resume&&job.has_cover){try{legacyInputsHash=source(dir,{guidance:'',experienceIds:state.experienceIds||[]}).inputsHash;}catch{/* Incomplete legacy sources require regeneration. */}}
 const same=previous&&previous.guidance===clean.guidance&&JSON.stringify(previous.experienceIds)===JSON.stringify(clean.experienceIds)&&previous.experienceRevision===clean.experienceRevision;
 const legacyInputs=previous?.legacyInputs||(!previous&&!generated&&legacyInputsHash?{guidance:'',experienceIds:state.experienceIds||[],experienceRevision:clean.experienceRevision}:null);
 const draft={revision:same?previous.revision:expected+1,guidance:clean.guidance,experienceIds:clean.experienceIds,
  experienceRevision:clean.experienceRevision,savedAt:new Date().toISOString(),...(input?.experienceChosen===true||previous?.experienceChosen===true?{experienceChosen:true}:{}),...(legacyInputsHash?{legacyInputsHash,legacyInputs}:{})};
 board.updateBoardState(dir,id,{applicationDraft:draft,...settled(state),...(generated?{documentGeneration:generated}:{})});
 return view(dir,id,job);
}
function begin(dir,id,job,input,requestId,documents){
 const saved=board.readBoardState(dir).jobs[id]||{},generated=effectiveGeneration(saved);
 if(!documents){if(generated||saved.generationDraft)board.updateBoardState(dir,id,{...settled(saved),...(generated?{documentGeneration:generated}:{})});return;}
 mutable(dir,id,job);
 const previous=saved.applicationDraft,clean=source(dir,input,true);
 if(previous&&input.revision!==previous.revision&&(input.revision!==undefined||clean.inputsHash!==source(dir,previous).inputsHash))fail('draft_conflict','Save the current application draft before generating.');
 const current=save(dir,id,job,{revision:previous?.revision||0,guidance:clean.guidance,experienceIds:clean.experienceIds,experienceRevision:clean.experienceRevision,experienceChosen:input.experienceChosen===true});
 if(input.experienceChosen===true)experienceChoice.remember(dir,clean.experienceIds);
 board.updateBoardState(dir,id,{generationDraft:{requestId,inputsHash:current.inputsHash,inputs:{guidance:clean.guidance,experienceIds:clean.experienceIds,experienceRevision:clean.experienceRevision},previousDocumentHashes:packetHashes(dir,job),draftRevision:current.draft.revision,state:'requested'},...(generated?{documentGeneration:generated}:{})});
 return current;
}
function assertReady(dir,id,job){const state=view(dir,id,job);if(state.needsGeneration)fail('documents_outdated',state.unavailable||(state.missingRoles.length&&!state.busy?state.rolesNotice+' Generate résumé & cover letter again before submitting.':'')||'Generate and review documents for the current tailoring and experience before submitting.');if(state.claims?.needsReview)fail('documents_need_review',state.claims.notice+' Edit the cover letter, or confirm you checked it, before sending.');return state;}
/**
 * @description The person says they checked a cover letter the claims check marked needs your review. Bound to that
 * letter's fingerprint: an edited or regenerated letter is judged again.
 * @param {string} dir Owner store. @param {number} id Posting. @param {object} job Its row. @param {string} fingerprint The
 * letter's digest as the page read it. @returns {object} The application view.
 */
function confirmClaims(dir,id,job,fingerprint){
 mutable(dir,id,job);const current=view(dir,id,job).claims;
 if(!current?.needsReview)fail('claims_not_pending','This cover letter has nothing waiting for your review.');
 if(typeof fingerprint!=='string'||fingerprint!==current.digest)fail('claims_changed','The cover letter changed. Review it again before confirming.');
 board.updateBoardState(dir,id,{claimsReviewed:current.digest});
 return view(dir,id,job);
}
function refused(dir,id,requestId){const saved=board.readBoardState(dir).jobs[id]||{};if(saved.generationDraft?.requestId===requestId)board.updateBoardState(dir,id,{generationDraft:{...saved.generationDraft,state:'refused'}});}
/**
 * @description Sync documentGeneration.inputsHash after a direct or concierge edit to a job's tailored packet so
 * returning to Review documents never bounces the person back to step 1 as outdated. Preserves experienceChosen
 * if set; missingRoles still checks the freshly saved application.json truthfully.
 * @param {string} dir Owner store. @param {number} id Posting. @returns {object|null}
 */
function markEdited(dir,id){
 const saved=board.readBoardState(dir).jobs[id]||{},stored=saved.applicationDraft,currentBank=bank.read(dir);
 const rawIds=stored?.experienceIds||saved.experienceIds||[];
 const validIds=rawIds.filter(eid=>currentBank.entries.some(entry=>entry.id===eid&&!entry.archived));
 let current;try{current=source(dir,{guidance:stored?.guidance||'',experienceIds:validIds,experienceRevision:currentBank.revision});}catch{return null;}
 const existing=effectiveGeneration(saved),now=new Date().toISOString();
 const inputs={guidance:current.guidance,experienceIds:current.experienceIds,experienceRevision:current.experienceRevision};
 const nextGen={requestId:existing?.requestId||'manual-edit',inputsHash:current.inputsHash,inputs,editedAt:now};
 const syncDraft=stored||rawIds.length!==validIds.length;
 const nextDraft=stored?{...stored,...inputs,...(stored.experienceChosen===true?{experienceChosen:true}:{})}:{revision:0,...inputs,savedAt:now};
 board.updateBoardState(dir,id,{...(syncDraft?{applicationDraft:nextDraft}:{}),documentGeneration:nextGen,generationDraft:null,...(saved.phase==='failed'?{phase:'ready',error:null,completedAt:saved.completedAt||now}:{})});
 return nextGen;
}
/**
 * @description Explicitly keep and review the current saved tailored documents despite an earlier main-résumé or
 * tailoring change, when both documents exist, no generation is active, and no required work-history roles are missing.
 * @param {string} dir Owner store. @param {number} id Posting. @param {object} job Its row.
 * @param {{acceptCurrent:true,revision:number}} input Explicit confirmation carrying the current draft revision.
 * @returns {object} Updated application view.
 */
function acceptCurrent(dir,id,job,input){
 mutable(dir,id,job);
 if(Object.keys(input||{}).some(key=>!['revision','acceptCurrent'].includes(key))||input.acceptCurrent!==true)fail('draft_invalid','Select the current documents explicitly.',400);
 const current=view(dir,id,job);
 if(current.busy)fail('generation_active','Wait for the current generation to finish.');
 if(!job?.has_resume||!job?.has_cover)fail('documents_unavailable','Generate résumé & cover letter first.');
 if(current.missingRoles.length)fail('roles_missing',current.rolesNotice+' Generate résumé & cover letter again before reviewing.');
 if(input.revision!==current.draft.revision)fail('draft_conflict','Read the current saved draft before continuing.');
 if(current.unavailable)fail('profile_unavailable',current.unavailable,503);
 const saved=board.readBoardState(dir).jobs[id]||{},stored=saved.applicationDraft,clean=source(dir,current.draft);
 const existing=effectiveGeneration(saved),now=new Date().toISOString();
 const inputs={guidance:clean.guidance,experienceIds:clean.experienceIds,experienceRevision:clean.experienceRevision};
 board.updateBoardState(dir,id,{...(stored?{applicationDraft:{...stored,...inputs,...(stored.experienceChosen===true?{experienceChosen:true}:{})}}:{applicationDraft:{revision:0,...inputs,savedAt:now}}),documentGeneration:{requestId:existing?.requestId||'accepted-current',inputsHash:clean.inputsHash,inputs,acceptedAt:now},generationDraft:null,...(saved.phase==='failed'?{phase:'ready',error:null,completedAt:saved.completedAt||now}:{})});
 return view(dir,id,job);
}
function restore(dir,id,job,input){mutable(dir,id,job);if(Object.keys(input||{}).some(key=>!['revision','restore'].includes(key))||input.restore!==true)fail('draft_invalid','Select the previous version explicitly.',400);const saved=board.readBoardState(dir).jobs[id]||{},current=view(dir,id,job);if(current.busy)fail('generation_active','Wait for the current generation to finish.');if(input.revision!==current.draft.revision)fail('draft_conflict','Read the current saved draft before restoring.');const previous=saved.documentGeneration,inputs=previous?.inputs||current.draft.legacyInputs,expected=previous?.inputsHash||current.draft.legacyInputsHash;if(!inputs||!expected)fail('previous_unavailable','The earlier document inputs are unavailable. Generate a fresh packet.');const bankNow=bank.read(dir),clean=source(dir,{...inputs,experienceRevision:bankNow.revision},true);if(clean.inputsHash!==expected)fail('previous_outdated','Your résumé or other experience changed. Generate a current packet.');const proof=saved.generationDraft?.previousDocumentHashes;if(saved.generationDraft&&(!proof||JSON.stringify(proof)!==JSON.stringify(packetHashes(dir,job))))fail('previous_changed','The previous document bytes could not be verified. Generate a fresh packet.');save(dir,id,job,{revision:current.draft.revision,guidance:clean.guidance,experienceIds:clean.experienceIds,experienceRevision:clean.experienceRevision});board.updateBoardState(dir,id,{reviewedPrevious:{inputsHash:expected,afterAttempt:saved.generationDraft?.requestId||null,at:new Date().toISOString()}});return view(dir,id,job);}
module.exports={DraftError,DONE,HELD,view,save,begin,refused,markEdited,acceptCurrent,restore,assertReady,confirmClaims,latestIntent,effectiveGeneration,mutable,packetHashes};
