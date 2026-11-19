/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.15: read structured resume_review receipts written by the pre-return career-resume-reviewer Swarm bot from application.json for Prepare application.
 */
'use strict';
const SHOWN = 4;

/** @description Clean non-empty unique strings from a receipt list. @param {unknown} list @returns {string[]} */
function cleanList(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const text = typeof item === 'string' ? item.trim() : '';
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

/** @description Join up to SHOWN items with an overflow count. @param {string[]} list @returns {string} */
function listed(list) {
  const shown = list.slice(0, SHOWN).join(' ');
  return list.length > SHOWN ? `${shown} (${list.length - SHOWN} more.)` : shown;
}

/**
 * @description Summarize the pre-return career-resume-reviewer receipt on a prepared packet.
 * @param {object|null} application The packet's application.json.
 * @returns {object|null} Review state for Prepare application, or null when absent.
 */
function state(application) {
  const receipt = application?.resume_review;
  if (!receipt || typeof receipt !== 'object' || typeof receipt.status !== 'string') return null;
  const issuesFound = cleanList(receipt.issues_found);
  const issuesFixed = cleanList(receipt.issues_fixed);
  const remainingIssues = cleanList(receipt.remaining_issues);
  const needsReview = receipt.status === 'needs_review' && remainingIssues.length > 0;
  const notice = needsReview
    ? `Your résumé needs your review before you send it. ${listed(remainingIssues)}`
    : '';
  const summary = receipt.status === 'passed'
    ? (issuesFixed.length
      ? `Résumé quality review passed (${issuesFixed.length} ${issuesFixed.length === 1 ? 'issue' : 'issues'} fixed automatically).`
      : 'Résumé quality review passed.')
    : '';
  return {
    status: receipt.status,
    bot: typeof receipt.bot === 'string' ? receipt.bot : 'career-resume-reviewer',
    rubricVersion: typeof receipt.rubric_version === 'string' ? receipt.rubric_version : '',
    attempts: Number.isInteger(receipt.attempts) ? receipt.attempts : 1,
    llmReviewed: receipt.llm_reviewed === true,
    issuesFound,
    issuesFixed,
    remainingIssues,
    needsReview,
    notice,
    summary,
    reviewerNotes: typeof receipt.reviewer_notes === 'string' ? receipt.reviewer_notes.trim() : '',
  };
}

module.exports = { state };
