/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-24 02:30:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Explicit opt-in automation gate (operator directive 2026-07-24): pure default-deny decision helpers over a career_automation_settings row. Absent row, malformed row, or anything but an explicit TRUE means automation stays OFF. Plain CommonJS with zero deps so the node:test guard runs anywhere (store repo has no vitest runner — apply-prompt.test.mjs precedent).
 */
'use strict';

/**
 * @description True ONLY for an explicit Postgres/JS true. pg returns real booleans for
 * boolean columns; 't'/'true' cover raw-text drivers. Everything else — undefined, null,
 * 1, 'yes', 'on', '' — is NOT an opt-in. Default-deny is the whole point of this module.
 * @param {unknown} v the raw column value
 * @returns {boolean} whether the value is an explicit opt-in
 */
function explicitTrue(v) {
  return v === true || v === 't' || v === 'true';
}

/**
 * @description Whether automated draft GENERATION (the nightly score/title/enqueue chain)
 * may run for the user this settings row belongs to. No row → false.
 * @param {unknown} row the user's career_automation_settings row, or undefined/null
 * @returns {boolean} true only when the row explicitly opts in to auto-generation
 */
function autoGenerateAllowed(row) {
  return !!row && typeof row === 'object' && explicitTrue(row.auto_generate);
}

/**
 * @description Whether automated bulk SUBMISSION (enqueue-queue / batch minting of
 * job-apply tickets without a per-job human action) may run for this user. No row → false.
 * Independent of auto_generate — opting in to drafts does NOT opt in to submissions.
 * @param {unknown} row the user's career_automation_settings row, or undefined/null
 * @returns {boolean} true only when the row explicitly opts in to auto-submission
 */
function autoSubmitAllowed(row) {
  return !!row && typeof row === 'object' && explicitTrue(row.auto_submit);
}

module.exports = { autoGenerateAllowed, autoSubmitAllowed };
