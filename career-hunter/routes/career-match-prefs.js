"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The standing matching preferences the AUTOMATED path consults (migration 104). It lives in its own module because the scoring choke point (career-engine-dispatch) may not import career-title-score — that module already imports the dispatcher, and the cycle would be real. Nothing local is imported here, so every consumer can read it safely.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.readRemoteOnly = readRemoteOnly;
/**
 * Standing per-user matching preferences.
 * @module career-match-prefs
 */
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'career-match-prefs' });
/**
 * @description Whether this user matches on remote roles only (`career_score_settings.remote_only`).
 *
 * A read failure returns FALSE — today's behaviour — rather than treating the preference as set.
 * The alternative fails the wrong way: a transient database error would silently stop the user's
 * matching altogether, which looks exactly like the scoring outage this app has already had once.
 * Absence of a row is also false: the preference is opt-in.
 *
 * @param pool - Any kernel query boundary. Typed structurally so the AppContext pool and the
 *   dispatcher's own local QueryPool both satisfy it without a cast or a cross-module import.
 * @param userSub - The authenticated caller subject.
 * @returns True only when the user has explicitly turned remote-only on.
 */
async function readRemoteOnly(pool, userSub) {
    try {
        const r = await pool.query('SELECT remote_only FROM career_score_settings WHERE user_sub=$1', [userSub]);
        return r.rows[0]?.remote_only === true;
    }
    catch (err) {
        logger.error({ err, userSub }, 'remote-only preference unreadable — matching everything this pass');
        return false;
    }
}
//# sourceMappingURL=career-match-prefs.js.map