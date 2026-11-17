/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.5 (Roger, 2026-11-16: "my cover letter ... lies about my level of expertise on c# ... the cover letter is not acceptable"): what the engine's claims check (engine/jobhunter/claims_check.py, claims_fix.py) did to a prepared packet, read from its application.json for Prepare application. A letter the check marked needs your review (still too thin after Career took out what the records do not support, even after one rewrite) is not ready: it names the problems in the person's words until they edit the letter (its paragraphs no longer match the fingerprint the check took) or say they checked it. A letter the check fixed lists what Career took out or toned down.
 */
'use strict';
const crypto=require('node:crypto');
const SHOWN=4;
/**
 * @description The letter's fingerprint, the engine's claims_fix.digest: SHA-256 of its paragraphs joined by new lines.
 * @param {object} cover The packet's cover ({paragraphs}). @returns {string} Hex digest.
 */
function digest(cover){
 const paragraphs=Array.isArray(cover?.paragraphs)?cover.paragraphs:[];
 return crypto.createHash('sha256').update(paragraphs.map(item=>String(item)).join('\n'),'utf8').digest('hex');
}
/** @description Distinct problem sentences in the order the check wrote them. @param {object[]} problems @returns {string[]} */
function sentences(problems){
 const out=[];
 for(const item of Array.isArray(problems)?problems:[]){const words=typeof item?.words==='string'?item.words.trim():'';if(words&&!out.includes(words))out.push(words);}
 return out;
}
/** @description A list of sentences shortened to SHOWN with a count of the rest. @param {string[]} list @returns {string} */
function listed(list){
 const shown=list.slice(0,SHOWN).join(' ');
 return list.length>SHOWN?`${shown} (${list.length-SHOWN} more.)`:shown;
}
/**
 * @description What the claims check did to this packet, for Prepare application and for sending. needsReview holds
 * only while the letter is the one the check judged (an edited letter is the person's own) and the person has not
 * said they checked it.
 * @param {object|null} application The packet's application.json. @param {string} [reviewed] The fingerprint the
 * person confirmed (board state claimsReviewed).
 * @returns {{status:string,needsReview:boolean,problems:string[],notice:string,fixed:string,digest:string}|null}
 */
function state(application,reviewed){
 const receipt=application?.claims_check;
 if(!receipt||typeof receipt!=='object'||typeof receipt.status!=='string')return null;
 const current=digest(application?.generated?.cover),same=current===receipt.cover_digest;
 const problems=sentences(receipt.problems),review=sentences((receipt.review||[]).map(words=>({words})));
 const needsReview=receipt.status==='needs_review'&&same&&reviewed!==current;
 const notice=needsReview?`Your cover letter needs your review before you send it. ${listed([...review,...problems])}`:'';
 const fixed=receipt.status==='fixed'&&problems.length?`Career checked these documents against your records. ${listed(problems)}`:'';
 return {status:receipt.status,needsReview,problems,notice,fixed,digest:current,regenerated:receipt.regenerated===true};
}
module.exports={digest,state,sentences};
