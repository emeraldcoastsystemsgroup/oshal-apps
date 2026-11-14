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

import type { AppContext } from '@/app/composition/app-context';

/** Where the kernel hands a background analysis over: this package's own route. */
export const ANALYSIS_RESULT_ROUTE = '/api/finance/brief/analysis-result';
/** The longest the analyst's one turn may take when it runs after the press has answered. */
export const ANALYSIS_TURN_SECONDS = 300;
/** After this a request still marked working is over: the turn's limit, the kernel's hand-over time and a margin. */
export const ANALYSIS_OVERDUE_MS = (ANALYSIS_TURN_SECONDS + 120) * 1000;
/** A request younger than this is not called lost when the kernel does not list its run yet. */
export const ANALYSIS_LOST_GRACE_MS = 15_000;
/** The header value only the kernel's hand-over carries; a browser's request never has it. */
export const ANALYSIS_TRIGGER = 'background-turn';
export const ANALYSIS_NOT_FINISHED_MESSAGE = 'The analysis did not finish, so nothing was saved. Your earlier analysis, if any, is unchanged. Request analysis again.';
export const ANALYSIS_LATE_MESSAGE = 'Your finance analyst did not answer within 5 minutes, so nothing was saved. Your earlier analysis, if any, is unchanged. Try Request analysis again later.';
export const ANALYSIS_BUSY_MESSAGE = 'Another request of yours is still being worked on, so this analysis was not started and nothing was saved. Try Request analysis again in a few minutes.';
export const SNAPSHOT_CHANGED_MESSAGE = 'The account snapshot changed while analysis was running. The previous saved analysis is unchanged. Request analysis again.';

/** The saved row of a person's latest analysis request (oshal_finance_analysis). */
export interface AnalysisRow {
  run_id: string;
  state: string;
  snapshot: string;
  requested_at: unknown;
  finished_at: unknown;
  failure: string | null;
}

/** What the page is told about the latest analysis request. */
export interface AnalysisView {
  state: 'idle' | 'working' | 'done' | 'failed';
  requestedAt: string | null;
  finishedAt: string | null;
  message: string | null;
}

/** The kernel's background-run port: one turn of a declared bot after the request has answered, and the held runs. */
export interface BackgroundTurns {
  backgroundTurn(request: { runId: string; agentId: string; text: string; deliverTo: string; maxSeconds: number }): Promise<unknown>;
  status?: () => Promise<{ runs?: Array<{ runId?: unknown }> }>;
}

/** The one thing this module logs: a failed ask of the kernel. */
interface ErrorLog { error(fields: object, message: string): void }

/** A stored instant as ISO text, or null when it is missing or unreadable. */
function instant(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
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
export function analysisView(row: AnalysisRow | undefined, briefAt: unknown, now: number, held: string[] | null): AnalysisView {
  if (!row || typeof row.run_id !== 'string' || typeof row.state !== 'string') return { state: 'idle', requestedAt: null, finishedAt: null, message: null };
  const requestedAt = instant(row.requested_at);
  const finishedAt = instant(row.finished_at);
  if (row.state === 'done') return { state: 'done', requestedAt, finishedAt, message: null };
  if (row.state !== 'working') return { state: 'failed', requestedAt, finishedAt, message: row.failure || ANALYSIS_NOT_FINISHED_MESSAGE };
  const asked = requestedAt ? Date.parse(requestedAt) : NaN;
  const saved = instant(briefAt);
  if (saved && Number.isFinite(asked) && Date.parse(saved) >= asked) return { state: 'done', requestedAt, finishedAt: saved, message: null };
  const age = Number.isFinite(asked) ? now - asked : Infinity;
  const lost = held !== null && !held.includes(row.run_id) && age > ANALYSIS_LOST_GRACE_MS;
  if (age > ANALYSIS_OVERDUE_MS || lost) return { state: 'failed', requestedAt, finishedAt: null, message: ANALYSIS_NOT_FINISHED_MESSAGE };
  return { state: 'working', requestedAt, finishedAt: null, message: null };
}

/**
 * @description The native kernel's background-run port, when this kernel can run a turn after the request has
 * answered. Another platform, or a kernel from before that ability, has none, and Request analysis keeps its 45 s path.
 * @returns The port, or null.
 */
export function backgroundTurns(): BackgroundTurns | null {
  try {
    const port = require('@/shared/package-runs') as Partial<BackgroundTurns> | undefined;
    return port && typeof port.backgroundTurn === 'function' ? port as BackgroundTurns : null;
  } catch {
    return null;
  }
}

/**
 * @description The run ids the kernel holds for the caller.
 * @param log - Where a failed ask is recorded.
 * @returns The ids, or null when the kernel cannot be asked.
 */
async function heldRuns(log: ErrorLog): Promise<string[] | null> {
  const port = backgroundTurns();
  if (!port || typeof port.status !== 'function') return null;
  try {
    return ((await port.status()).runs || []).map((run) => String(run.runId));
  } catch (err) {
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
export async function readAnalysis(pool: AppContext['pool'], sub: string): Promise<AnalysisRow | undefined> {
  const found = await pool.query(
    'SELECT run_id, state, snapshot, requested_at, finished_at, failure FROM oshal_finance_analysis WHERE user_sub = $1', [sub]);
  return found.rows[0] as AnalysisRow | undefined;
}

/**
 * @description What the caller's latest analysis request reads as now. Only a request still marked working needs the
 * saved brief's date and the kernel's held runs.
 * @param pool - The caller's store.
 * @param sub - The caller.
 * @param log - Where a failed ask of the kernel is recorded.
 * @returns The state, its dates and, for a failure, the words to show.
 */
export async function currentAnalysis(pool: AppContext['pool'], sub: string, log: ErrorLog): Promise<AnalysisView> {
  const row = await readAnalysis(pool, sub);
  if (!row || row.state !== 'working') return analysisView(row, null, Date.now(), null);
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
export async function openAnalysis(pool: AppContext['pool'], sub: string, runId: string, snapshot: string): Promise<void> {
  await pool.query(
    `INSERT INTO oshal_finance_analysis (user_sub, run_id, state, snapshot, requested_at, finished_at, failure)
       VALUES ($1, $2, 'working', $3, now(), NULL, NULL)
     ON CONFLICT (user_sub) DO UPDATE SET run_id = EXCLUDED.run_id, state = EXCLUDED.state, snapshot = EXCLUDED.snapshot,
       requested_at = now(), finished_at = NULL, failure = NULL`,
    [sub, runId, snapshot]);
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
export async function closeAnalysis(pool: AppContext['pool'], sub: string, runId: string, failure: string | null): Promise<void> {
  await pool.query(
    `UPDATE oshal_finance_analysis SET state = $3, failure = $4, finished_at = now() WHERE user_sub = $1 AND run_id = $2 AND state = 'working'`,
    [sub, runId, failure === null ? 'done' : 'failed', failure]);
}

/**
 * @description Remove a request the kernel never started, so nothing reads as working or failed.
 * @param pool - The caller's store.
 * @param sub - The caller.
 * @param runId - The run that was not started.
 * @returns Nothing.
 */
export async function dropAnalysis(pool: AppContext['pool'], sub: string, runId: string): Promise<void> {
  await pool.query('DELETE FROM oshal_finance_analysis WHERE user_sub = $1 AND run_id = $2', [sub, runId]);
}
