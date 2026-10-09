"use strict";
/**
 * The week ledger — every week's advice recorded before kickoff, graded once the week is over.
 *
 * WHAT IS RECORDED, AND WHEN. When a lineup is served, the week's decision is written: the lineup
 * advised, the highest-projected lineup, the win probability each claimed, the swaps that made them
 * differ, and the lineup actually set at that moment. A variance-swap week is then provable from the
 * ledger, not from a screenshot.
 *
 * WHAT IS GRADED, AND FROM WHAT. Once a week is complete, the advised lineup's ACTUAL points are
 * compared with the ACTUAL points of the lineup the manager actually started — for an ESPN league the
 * lineup ESPN holds for that week, for a hand-typed league the one recorded — both scored under the
 * league's own rules from the caller's stored completed weeks (ff_player_weeks). The week's feed
 * cache is NOT used: it is refreshed only while its week is current, so reading actuals from it
 * graded against numbers that never arrived.
 *
 * WHEN A WEEK IS COMPLETE. Strictly before the current week, AND the caller's store already holds
 * that week's actual lines (at least one row). The second condition is what keeps a half-played or
 * not-yet-refreshed week from being graded with every player at zero; once the week's lines are in,
 * a player with no row did not play and scored nothing, which is the truth.
 *
 * A WEEK DOES NOT CLOSE WITH UNGRADED RECOMMENDATIONS: the start/sit calls registered for it are
 * graded from the same actuals first, and the week is marked graded only when none remain open.
 *
 * Grading reads and writes only the caller's own rows; there is no cross-user pass, and it runs in
 * the caller's own requests (the lineup route grades what is due before it builds, and POST /grade).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — record the week's decision at lineup time, grade completed weeks from stored actuals against the lineup actually started, settle the week's start/sit calls first, and roll the ledger up.
 *
 * @module fantasy-grading
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordWeek = recordWeek;
exports.openWeeks = openWeeks;
exports.weekActuals = weekActuals;
exports.gradeWeek = gradeWeek;
exports.weekRecord = weekRecord;
const fantasy_scoring_1 = require("./fantasy-scoring");
const fantasy_store_1 = require("./fantasy-store");
/**
 * @description Record (or refresh, until graded) a week's decision before kickoff.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param d - The decision.
 * @returns Rows written (0 when the week is already graded).
 */
async function recordWeek(pool, userSub, d) {
    const r = await pool.query(`INSERT INTO ff_weeks (user_sub, season, league_key, week, source, advised, mean_lineup, started, swaps,
       win_probability, mean_win_probability, projected_advised, projected_started)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (user_sub, season, league_key, week) DO UPDATE
     SET advised = EXCLUDED.advised, mean_lineup = EXCLUDED.mean_lineup, started = EXCLUDED.started,
         swaps = EXCLUDED.swaps, win_probability = EXCLUDED.win_probability,
         mean_win_probability = EXCLUDED.mean_win_probability, projected_advised = EXCLUDED.projected_advised,
         projected_started = EXCLUDED.projected_started, recorded_at = now()
     WHERE ff_weeks.graded = FALSE`, [userSub, d.season, d.leagueKey, d.week, d.source, JSON.stringify(d.advised), JSON.stringify(d.meanLineup),
        JSON.stringify(d.started), JSON.stringify(d.swaps), d.winProbability, d.meanWinProbability,
        d.projectedAdvised, d.projectedStarted]);
    return r.rowCount || 0;
}
/**
 * @description The caller's ungraded weeks strictly before `beforeWeek`.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param season - Season year.
 * @param beforeWeek - The current week; it and later weeks are in progress.
 * @returns Open weeks, oldest first.
 */
async function openWeeks(pool, userSub, season, beforeWeek) {
    const r = await pool.query(`SELECT season, league_key, week, source, advised, started FROM ff_weeks
     WHERE user_sub = $1 AND season = $2 AND week < $3 AND graded = FALSE ORDER BY week ASC LIMIT 100`, [userSub, season, beforeWeek]);
    return r.rows.map((x) => ({
        season: Number(x.season), leagueKey: x.league_key, week: Number(x.week), source: x.source,
        advised: x.advised.map(Number), started: x.started.map(Number),
    }));
}
/**
 * @description The caller's stored actual points for one completed week, scored under a league's
 * rules — or null when the store holds no line at all for that week yet (not complete).
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param season - Season year.
 * @param week - The week.
 * @param scoring - The league's rules.
 * @returns Points by player id (absent = did not play), or null.
 */
async function weekActuals(pool, userSub, season, week, scoring) {
    const r = await pool.query('SELECT player_id, stats FROM ff_player_weeks WHERE user_sub = $1 AND season = $2 AND week = $3', [userSub, season, week]);
    if (!r.rows.length)
        return null;
    return new Map(r.rows.map((x) => [Number(x.player_id), (0, fantasy_scoring_1.applyScoring)(x.stats, scoring)]));
}
/**
 * @description Grade one open week: settle its start/sit calls from the same actuals, then close the
 * week with the advised lineup's actual points against the started lineup's.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @param open - The open week.
 * @param inputs - The league's rules and the lineup actually started.
 * @returns 'graded', or 'incomplete' when the week's actual lines are not in yet.
 */
async function gradeWeek(pool, userSub, open, inputs) {
    const actual = await weekActuals(pool, userSub, open.season, open.week, inputs.scoring);
    if (!actual)
        return 'incomplete';
    const pts = (ids) => Math.round(ids.reduce((s, id) => s + (actual.get(id) || 0), 0) * 100) / 100;
    for (const call of await (0, fantasy_store_1.openCallsForWeek)(pool, userSub, open.season, open.leagueKey, open.week)) {
        await (0, fantasy_store_1.gradeCall)(pool, userSub, call.id, actual.get(call.startPlayerId) || 0, actual.get(call.sitPlayerId) || 0);
    }
    if ((await (0, fantasy_store_1.openCallsForWeek)(pool, userSub, open.season, open.leagueKey, open.week)).length)
        return 'incomplete';
    const started = inputs.startedIds ?? open.started;
    const advised = pts(open.advised);
    const startedPts = pts(started);
    await pool.query(`UPDATE ff_weeks SET graded = TRUE, started = $5, actual_advised = $6, actual_started = $7, actual_gain = $6::numeric - $7::numeric, graded_at = now()
     WHERE user_sub = $1 AND season = $2 AND league_key = $3 AND week = $4 AND graded = FALSE`, [userSub, open.season, open.leagueKey, open.week, JSON.stringify(started), advised, startedPts]);
    return 'graded';
}
/**
 * @description The caller's week ledger, newest first, with its rollup.
 * @param pool - Postgres pool.
 * @param userSub - Caller's subject.
 * @returns The rollup and rows.
 */
async function weekRecord(pool, userSub) {
    const r = await pool.query(`SELECT season, league_key, week, source, advised, mean_lineup, started, swaps, win_probability,
            mean_win_probability, projected_advised, projected_started, graded, actual_advised, actual_started,
            actual_gain, recorded_at, graded_at
     FROM ff_weeks WHERE user_sub = $1 ORDER BY season DESC, week DESC LIMIT 60`, [userSub]);
    const graded = r.rows.filter((x) => x.graded);
    return {
        weeks: r.rows.length,
        graded: graded.length,
        actualGain: Math.round(graded.reduce((s, x) => s + Number(x.actual_gain || 0), 0) * 100) / 100,
        varianceWeeks: r.rows.filter((x) => Array.isArray(x.swaps) && x.swaps.length > 0).length,
        rows: r.rows,
    };
}
//# sourceMappingURL=fantasy-grading.js.map