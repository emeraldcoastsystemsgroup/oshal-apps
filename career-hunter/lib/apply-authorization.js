/**
 * Career auto-submit authorization — package-owned settings lookup used by the OSHAL kernel's
 * dynamic installed-app bridge. The kernel deliberately does not know this app's table name or
 * schema. Its authenticated request-scoped pool is passed here, so FORCE RLS remains the authority.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-05 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial fail-closed exact-user
 *   auto-submit decision. Missing rows and false settings are disabled; invalid dependencies and
 *   query failures are unavailable. The exact subject is used unchanged as the SQL parameter.
 */

'use strict';

const { autoSubmitAllowed } = require('./automation-gate.js');

const ENABLED = Object.freeze({ authorized: true, reason: 'enabled' });
const DISABLED = Object.freeze({ authorized: false, reason: 'disabled' });
const UNAVAILABLE = Object.freeze({ authorized: false, reason: 'unavailable' });

/**
 * @description Read the exact user's package-owned auto-submit setting through the caller's
 * authenticated, RLS-aware pool. This function never establishes or fabricates an identity; callers
 * must already be executing in the signed-in user's request context. It fails closed without throwing.
 * @param {{query(sql:string, params:unknown[]):Promise<{rows?:unknown[]}>}} pool authenticated pool
 * @param {string} userSub exact OIDC subject; passed to PostgreSQL without trimming or truncation
 * @returns {Promise<{authorized:boolean,reason:'enabled'|'disabled'|'unavailable'}>} strict decision
 */
async function readAutoSubmitAuthorization(pool, userSub) {
  if (!pool || typeof pool.query !== 'function' || typeof userSub !== 'string' || userSub.length === 0) {
    return UNAVAILABLE;
  }
  try {
    const result = await pool.query(
      'SELECT auto_submit FROM career_automation_settings WHERE user_sub=$1 LIMIT 1',
      [userSub],
    );
    const row = Array.isArray(result && result.rows) ? result.rows[0] : undefined;
    return autoSubmitAllowed(row) ? ENABLED : DISABLED;
  } catch {
    return UNAVAILABLE;
  }
}

module.exports = { readAutoSubmitAuthorization };
