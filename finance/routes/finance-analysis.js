"use strict";
/**
 * A requested analysis that runs after the press has answered: what the kernel is asked, what the caller's saved
 * request reads as, and the request row itself. The routes that start a request and take the kernel's hand-over are
 * in finance-routes.ts.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.6.5 (Roger, 2026-11-14: "yes background analysis"). One turn of a slow model takes longer than the 60 s a package request may last, so the analyst's turn is asked of the kernel, which runs it after the request has answered and hands the answer to this package's own route as the same person. This module holds the kernel's port (found by its `backgroundTurn` function, absent on another platform or an earlier kernel), the caller's one request row (oshal_finance_analysis) and what that row reads as: working, done, or failed in words. A request the kernel no longer holds, or one past its time, reads as not finished; a brief saved after the request reads as done whatever the row says. It imports nothing from the framework when it loads.
 * -----------------------------------------------------------------------------
 *
 * @module finance-analysis
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SNAPSHOT_CHANGED_MESSAGE = exports.ANALYSIS_BUSY_MESSAGE = exports.ANALYSIS_LATE_MESSAGE = exports.ANALYSIS_NOT_FINISHED_MESSAGE = exports.ANALYSIS_TRIGGER = exports.ANALYSIS_LOST_GRACE_MS = exports.ANALYSIS_OVERDUE_MS = exports.ANALYSIS_TURN_SECONDS = exports.ANALYSIS_RESULT_ROUTE = void 0;
exports.analysisView = analysisView;
exports.backgroundTurns = backgroundTurns;
exports.readAnalysis = readAnalysis;
exports.currentAnalysis = currentAnalysis;
exports.openAnalysis = openAnalysis;
exports.closeAnalysis = closeAnalysis;
exports.dropAnalysis = dropAnalysis;
/** Where the kernel hands a background analysis over: this package's own route. */
exports.ANALYSIS_RESULT_ROUTE = '/api/finance/brief/analysis-result';
/** The longest the analyst's one turn may take when it runs after the press has answered. */
exports.ANALYSIS_TURN_SECONDS = 300;
/** After this a request still marked working is over: the turn's limit, the kernel's hand-over time and a margin. */
exports.ANALYSIS_OVERDUE_MS = (exports.ANALYSIS_TURN_SECONDS + 120) * 1000;
/** A request younger than this is not called lost when the kernel does not list its run yet. */
exports.ANALYSIS_LOST_GRACE_MS = 15_000;
/** The header value only the kernel's hand-over carries; a browser's request never has it. */
exports.ANALYSIS_TRIGGER = 'background-turn';
exports.ANALYSIS_NOT_FINISHED_MESSAGE = 'The analysis did not finish, so nothing was saved. Your earlier analysis, if any, is unchanged. Request analysis again.';
exports.ANALYSIS_LATE_MESSAGE = 'Your finance analyst did not answer within 5 minutes, so nothing was saved. Your earlier analysis, if any, is unchanged. Try Request analysis again later.';
exports.ANALYSIS_BUSY_MESSAGE = 'Another request of yours is still being worked on, so this analysis was not started and nothing was saved. Try Request analysis again in a few minutes.';
exports.SNAPSHOT_CHANGED_MESSAGE = 'The account snapshot changed while analysis was running. The previous saved analysis is unchanged. Request analysis again.';
/** A stored instant as ISO text, or null when it is missing or unreadable. */
function instant(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const at = value instanceof Date ? value.getTime() : Date.parse(String(value));
    return Number.isFinite(at) ? new Date(at).toISOString() : null;
}
/**
 * @description What a person's latest analysis request reads as now. The row alone is not trusted while it says
 * working: a brief saved after the request means it is done; a request past its time, or one the kernel no longer
 * holds (a restart ends its runs), did not finish and says so in words.
 * @param row - The saved request, if there is one.
 * @param briefAt - When the saved brief was written, if there is one.
 * @param now - Epoch milliseconds.
 * @param held - The run ids the kernel holds for this person, or null when it was not asked.
 * @returns The state, its dates and, for a failure, the words to show.
 */
function analysisView(row, briefAt, now, held) {
    if (!row || typeof row.run_id !== 'string' || typeof row.state !== 'string')
        return { state: 'idle', requestedAt: null, finishedAt: null, message: null };
    const requestedAt = instant(row.requested_at);
    const finishedAt = instant(row.finished_at);
    if (row.state === 'done')
        return { state: 'done', requestedAt, finishedAt, message: null };
    if (row.state !== 'working')
        return { state: 'failed', requestedAt, finishedAt, message: row.failure || exports.ANALYSIS_NOT_FINISHED_MESSAGE };
    const asked = requestedAt ? Date.parse(requestedAt) : NaN;
    const saved = instant(briefAt);
    if (saved && Number.isFinite(asked) && Date.parse(saved) >= asked)
        return { state: 'done', requestedAt, finishedAt: saved, message: null };
    const age = Number.isFinite(asked) ? now - asked : Infinity;
    const lost = held !== null && !held.includes(row.run_id) && age > exports.ANALYSIS_LOST_GRACE_MS;
    if (age > exports.ANALYSIS_OVERDUE_MS || lost)
        return { state: 'failed', requestedAt, finishedAt: null, message: exports.ANALYSIS_NOT_FINISHED_MESSAGE };
    return { state: 'working', requestedAt, finishedAt: null, message: null };
}
/**
 * @description The native kernel's background-run port, when this kernel can run a turn after the request has
 * answered. Another platform, or a kernel from before that ability, has none, and Request analysis keeps its 45 s path.
 * @returns The port, or null.
 */
function backgroundTurns() {
    try {
        const port = require('@/shared/package-runs');
        return port && typeof port.backgroundTurn === 'function' ? port : null;
    }
    catch {
        return null;
    }
}
/**
 * @description The run ids the kernel holds for the caller.
 * @param log - Where a failed ask is recorded.
 * @returns The ids, or null when the kernel cannot be asked.
 */
async function heldRuns(log) {
    const port = backgroundTurns();
    if (!port || typeof port.status !== 'function')
        return null;
    try {
        return ((await port.status()).runs || []).map((run) => String(run.runId));
    }
    catch (err) {
        log.error({ err }, 'finance could not ask the kernel which analysis runs it holds');
        return null;
    }
}
/**
 * @description The caller's saved analysis request.
 * @param pool - The caller's store.
 * @param sub - The caller.
 * @returns The row, or undefined when the caller never asked.
 */
async function readAnalysis(pool, sub) {
    const found = await pool.query('SELECT run_id, state, snapshot, requested_at, finished_at, failure FROM oshal_finance_analysis WHERE user_sub = $1', [sub]);
    return found.rows[0];
}
/**
 * @description What the caller's latest analysis request reads as now. Only a request still marked working needs the
 * saved brief's date and the kernel's held runs.
 * @param pool - The caller's store.
 * @param sub - The caller.
 * @param log - Where a failed ask of the kernel is recorded.
 * @returns The state, its dates and, for a failure, the words to show.
 */
async function currentAnalysis(pool, sub, log) {
    const row = await readAnalysis(pool, sub);
    if (!row || row.state !== 'working')
        return analysisView(row, null, Date.now(), null);
    const brief = (await pool.query('SELECT brief_at FROM oshal_finance_data WHERE user_sub = $1', [sub])).rows[0];
    return analysisView(row, brief?.brief_at, Date.now(), await heldRuns(log));
}
/**
 * @description Record the caller's request as working, fenced to the exact snapshot it reads. A person has one row:
 * a new request replaces the earlier, closed one.
 * @param pool - The caller's store.
 * @param sub - The caller.
 * @param runId - The run the kernel is asked for.
 * @param snapshot - The saved snapshot exactly as stored.
 * @returns Nothing.
 */
async function openAnalysis(pool, sub, runId, snapshot) {
    await pool.query(`INSERT INTO oshal_finance_analysis (user_sub, run_id, state, snapshot, requested_at, finished_at, failure)
       VALUES ($1, $2, 'working', $3, now(), NULL, NULL)
     ON CONFLICT (user_sub) DO UPDATE SET run_id = EXCLUDED.run_id, state = EXCLUDED.state, snapshot = EXCLUDED.snapshot,
       requested_at = now(), finished_at = NULL, failure = NULL`, [sub, runId, snapshot]);
}
/**
 * @description Close the caller's working request: done, or failed with the words to show. A closed request, or
 * another run's, is not touched.
 * @param pool - The caller's store.
 * @param sub - The caller.
 * @param runId - The run being closed.
 * @param failure - The words to show, or null when the analysis was saved.
 * @returns Nothing.
 */
async function closeAnalysis(pool, sub, runId, failure) {
    await pool.query(`UPDATE oshal_finance_analysis SET state = $3, failure = $4, finished_at = now() WHERE user_sub = $1 AND run_id = $2 AND state = 'working'`, [sub, runId, failure === null ? 'done' : 'failed', failure]);
}
/**
 * @description Remove a request the kernel never started, so nothing reads as working or failed.
 * @param pool - The caller's store.
 * @param sub - The caller.
 * @param runId - The run that was not started.
 * @returns Nothing.
 */
async function dropAnalysis(pool, sub, runId) {
    await pool.query('DELETE FROM oshal_finance_analysis WHERE user_sub = $1 AND run_id = $2', [sub, runId]);
}
//# sourceMappingURL=finance-analysis.js.map