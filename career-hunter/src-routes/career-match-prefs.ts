/**
 * CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Offer a strict read for original-owner snapshots so unavailable matching preferences cannot silently broaden Jarvis results.
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The standing matching preferences the AUTOMATED path consults (migration 104). It lives in its own module because the scoring choke point (career-engine-dispatch) may not import career-title-score — that module already imports the dispatcher, and the cycle would be real. Nothing local is imported here, so every consumer can read it safely.
 */

/**
 * Standing per-user matching preferences.
 * @module career-match-prefs
 */
import { createChildLogger } from '@/shared/logger';

const logger = createChildLogger({ module: 'career-match-prefs' });

/** @description A kernel query boundary, typed structurally so both pools satisfy it. */
export interface PrefQueryPool {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/**
 * @description Whether this user matches on remote roles only (`career_score_settings.remote_only`).
 *
 * A read failure returns FALSE — today's behaviour — rather than treating the preference as set.
 * The alternative fails the wrong way: a transient database error would silently stop the user's
 * matching altogether, which looks exactly like the scoring outage this app has already had once.
 * Absence of a row is also false: the preference is opt-in.
 * Strict snapshot reads refuse failures or malformed rows instead of broadening results.
 *
 * @param pool - Any kernel query boundary. Typed structurally so the AppContext pool and the
 *   dispatcher's own local QueryPool both satisfy it without a cast or a cross-module import.
 * @param userSub - The authenticated caller subject.
 * @param options - Request a strict preference read for a snapshot that must state its exact scope.
 * @returns True only when the user has explicitly turned remote-only on.
 */
export async function readRemoteOnly(pool: PrefQueryPool, userSub: string, options: { strict?: boolean } = {}): Promise<boolean> {
  try {
    const r = await pool.query(
      'SELECT remote_only FROM career_score_settings WHERE user_sub=$1', [userSub],
    );
    if (options.strict && (!Array.isArray(r.rows) || r.rows.length > 1
      || (r.rows.length === 1 && typeof r.rows[0]?.remote_only !== 'boolean'))) throw new Error('Remote-only preference is unavailable');
    return r.rows[0]?.remote_only === true;
  } catch (err) {
    if (options.strict) throw new Error('Remote-only preference is unavailable');
    logger.error({ err, userSub }, 'remote-only preference unreadable — matching everything this pass');
    return false;
  }
}
