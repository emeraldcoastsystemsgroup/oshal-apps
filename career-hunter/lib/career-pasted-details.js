/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.66.0 (Roger, 2026-11-15: "make the user get the position details and paste them before generating the resume"): the description a person pastes from a job's posting, checked the way the engine keeps it (job_context.remember_pasted: 200 to 20,000 characters, line breaks kept, other control characters removed), and whether a job is one Career already knows it cannot read (marked "details needed" by the nightly pass, no AI fit, no description of its own or saved), so preparation refuses it before the engine starts and says to paste the description.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.66.1 (Lane VER15 on the test server, 2026-11-15: asked to draft a résumé for a job the nightly pass had not marked, the Concierge said "The draft stopped … the job details are unavailable" and pointed to Getting ready, never to the paste box): notice(job) is the one rule for when a person must paste a job's description, and the same rule as the application page's (tools/career-application.js pasteRequired): the job has no description (no listing text, no saved copy) and either the nightly pass marked it or its last preparation stopped because Career had no description it could use (job_details_unavailable or job_context_unavailable; a paste starts a new run, so that stop means nothing was pasted since). It answers NEEDED, which GET /jobs/:id carries as details_needed for the Concierge and Jarvis, and the saved-job preparation receipt says. What the engine reads, and when it tries the employer page, are unchanged. Guard: tests/career-paste-details-unmarked.test.mjs.
 */
'use strict';
const {needsDetails}=require('./career-fit');
const {applyJobContext}=require('./career-job-context');

/** The fewest and most characters of a pasted description; the engine holds the same bounds. */
const MIN=200,MAX=20000;
/** What a person reads when a job's description is needed first: the page, the Concierge and Jarvis all say this. */
const NEEDED='Career could not read this job’s details, so it cannot check your fit or write a résumé for it yet. Open the job’s posting, copy the job description, paste it in Prepare application, step 1 · Tailor, and generate your résumé and cover letter there.';
const TOO_SHORT='Paste the whole job description from the posting: at least 200 characters.';
const TOO_LONG='That is longer than one job description (20,000 characters at most). Paste only the job description.';

/** The engine's reasons a preparation stopped with no description it could use (engine/jobhunter/job_context.py). */
const DETAIL_FAILURES=new Set(['job_details_unavailable','job_context_unavailable']);

/**
 * @description The pasted description as the engine keeps it. Lone surrogates become U+FFFD and control characters
 * other than line breaks and tabs are removed, so the text can travel to the engine and be stored as UTF-8.
 * @param {unknown} value - The request's jobDescription.
 * @returns {{text?:string,error?:string}} The text to keep, nothing when none was given, or the reason it is refused.
 */
function read(value){
  if(value===undefined||value===null||value==='')return {};
  if(typeof value!=='string')return {error:TOO_SHORT};
  const text=value.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,'�')
    .replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim();
  const length=Array.from(text).length;
  if(length<MIN)return {error:TOO_SHORT};
  if(length>MAX)return {error:TOO_LONG};
  return {text};
}

/**
 * @description Whether this person's job is one the nightly pass could not read and that still has no description:
 * no listing text and no saved copy (an employer read or an earlier paste).
 * @param {{prepare:Function}} db - The person's store with the corpus attached.
 * @param {string} userDir - The person's private folder (their saved copies).
 * @param {number} postingId - The job.
 * @returns {boolean} True when the description must be pasted before preparation.
 */
function needed(db,userDir,postingId){
  const row=db.prepare(`SELECT p.*, s.ai_fit_score, s.ai_model FROM corpus.postings_corpus p
    LEFT JOIN user_signals s ON s.posting_id=p.id WHERE p.id=?`).get(postingId);
  if(!row||row.ai_fit_score!=null||!needsDetails(row.ai_model))return false;
  let known=row;
  try{known=applyJobContext(userDir,row);}catch{known=row;/* a copy that cannot be verified is no description */}
  return !/\S/.test(String(known.description||''));
}

/**
 * @description Whether a preparation that stopped for this reason stopped for want of the job's description, for a
 * job that still has none. Shared by the job read and the saved-job preparation receipt so both say the same.
 * @param {unknown} reason - The board receipt's error (the engine's reason code).
 * @param {unknown} description - The job's description after the person's saved copy, as the job read has it.
 * @returns {boolean} True when the person has to paste the description before Career can prepare the job.
 */
function stoppedForDetails(reason,description){return DETAIL_FAILURES.has(reason)&&!/\S/.test(String(description||''));}

/**
 * @description The words a person reads when Career cannot prepare this job until they paste its description: the job
 * has no description and the nightly pass marked it, or its last preparation stopped for missing details. Anything
 * else answers null. tools/career-application.js pasteRequired() decides the same for the page, which then shows the
 * box these words name and keeps Generate off until the description is pasted.
 * @param {{description?:unknown,fit_assessment?:{kind?:string},board?:{error?:unknown}}} job - The job as GET /jobs/:id
 * reads it: its description after the person's saved copy, its fit assessment and its board receipt.
 * @returns {string|null} NEEDED, or null.
 */
function notice(job){
  if(!job||/\S/.test(String(job.description||'')))return null;
  return job.fit_assessment?.kind==='needs-details'||stoppedForDetails(job.board?.error,job.description)?NEEDED:null;
}

module.exports={read,needed,notice,stoppedForDetails,DETAIL_FAILURES,MIN,MAX,NEEDED,TOO_SHORT,TOO_LONG};
