/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the Futures panel's routes on the native kernel (GET/POST/DELETE /autopilot/futures, POST /autopilot/futures/run, pause/resume) answered by the native Schwab study instead of the platform scheduler the native kernel does not have. Each person has their own study over their own Schwab connection; any other host returns null and keeps its existing path.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The nightly schedule (FUT-01 slice 2): the package's futures-research schedule fires POST /futures/tick as the activating person, which runs the saved study at most once per New York day; GET and Save name that schedule (kernelSchedule) so the page can activate, pause and resume the person's own job; pause/resume themselves are the kernel's.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Research review (FUT-01 slice 3): the 'review' action reviews one of the person's runs on the accounted bot rail (futures/review.js), and GET attaches each run's review so the panel's review card shows it.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Forward calls, the Schwab check and capture on the native kernel: 'predictions' grades due calls then lists the latest 50, 'prediction' returns one call's frozen inputs, 'probe' checks each root's live contract (quote, hourly and daily bars - statuses and counts only), and capture/catch-up/import answer that they are not needed because every run reads Schwab directly.
 *
 * @module futures/native
 */
'use strict';

const crypto = require('crypto');
const store = require('./store');
const { normalizeNativeFuturesConfig } = require('./config');
const { runNativeStudy } = require('./run');
const { reviewNativeRun } = require('./review');
const predictions = require('./predictions');
const { schwabFuturesSource, liveContract } = require('./source');

const CAPTURE_NOTE = 'Not needed on this installation: the Futures study reads your Schwab connection directly on every run, so there are no private bars to capture, catch up or import.';

/** The Schwab check: per root, the live contract's quote and its hourly and daily bars (statuses and counts, never the bars). */
async function probe(ctx, at) {
  const src = schwabFuturesSource(ctx, () => at);
  const roots = [];
  for (const root of ['ES', 'CL']) {
    const live = liveContract(root, at), sym = live ? live.symbol : null;
    const row = { root, datedContract: sym, quote: { state: 'unavailable' }, minute: { state: 'unavailable', bars: 0, volumeBars: 0 }, daily: { state: 'unavailable', bars: 0 } };
    try { const q = await ctx.intent('trading.quotes', { symbols: ['/' + sym] }); const one = ((q && q.quotes) || [])[0]; row.quote = { state: one && one.price ? 'available' : 'empty', asOf: one && (one.tradeAt || one.quoteAt) || null }; } catch { row.quote = { state: 'rejected' }; }
    try { const h = await src.closedBars(sym, '1Hour', at, 4096); row.minute = { state: h.length ? 'available' : 'empty', bars: h.length, volumeBars: h.filter((b) => b.v > 0).length, first: h[0] ? new Date(h[0].ms).toISOString() : undefined, last: h.at(-1) ? new Date(h.at(-1).ms).toISOString() : undefined }; } catch { row.minute = { state: 'rejected', bars: 0, volumeBars: 0 }; }
    try { const d = await src.closedBars(sym, '1Day', at, 400); row.daily = { state: d.length ? 'available' : 'empty', bars: d.length }; } catch { row.daily = { state: 'rejected', bars: 0 }; }
    row.forwardBarCandidate = row.minute.state === 'available';
    roots.push(row);
  }
  return { roots, note: 'Read live through your Schwab connection (30-minute bars combined into hours); nothing is stored. ' + CAPTURE_NOTE };
}

/** The package schedule that runs the study nightly; the person activates it (Save / enable, Resume). */
const FUTURES_SCHEDULE = { app: 'intelligent-trades', name: 'futures-research', cron: '15 2 * * 2-6', timezone: 'America/New_York' };
const NOTE = 'Runs nightly at 02:15 New York (Tuesday to Saturday) once you enable it, and on demand with Run once.';

/** The New York calendar day of an instant. */
const nyDay = (at) => new Date(at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** @description Whether this host is the native kernel (it hands the route the kernel intent call). @param {object} ctx - Route context. @returns {boolean} */
function nativeFuturesHost(ctx) { return Boolean(ctx && typeof ctx.intent === 'function' && ctx.pool); }

async function status(ctx, sub) {
  const [study, listed, reviews] = await Promise.all([store.loadStudy(ctx.pool, sub), store.listRuns(ctx.pool, sub), store.listReviews(ctx.pool, sub)]);
  const runs = listed.map((r) => (reviews.has(r.runId) ? { ...r, review: reviews.get(r.runId) } : r));
  const schedule = study ? { id: 'native', cron: `${FUTURES_SCHEDULE.cron} (${FUTURES_SCHEDULE.timezone})`, status: 'saved', nextRunAt: null, lastRunAt: runs[0] ? runs[0].createdAt : null,
    executionCount: runs.length, config: study.config } : null;
  // Whether the person's schedule is active lives in the kernel; the page reads it (GET /api/v1/agent/schedules).
  return { status: 200, body: { ok: true, native: true, enabled: null, note: NOTE, kernelSchedule: FUTURES_SCHEDULE, schedule, runs } };
}

/**
 * @description Answer one Futures panel action on the native kernel, or null on any other host.
 * @param {object} ctx - Route context.
 * @param {'get'|'save'|'run'|'tick'|'review'|'delete'|'pause'|'resume'} action - The route.
 * @param {string} sub - Caller.
 * @param {object} [body] - Request body.
 * @param {{newId?: () => string, now?: () => Date}} [deps] - Id and clock.
 * @returns {Promise<{status: number, body: object}|null>} The answer.
 */
async function nativeFutures(ctx, action, sub, body, deps = {}) {
  if (!nativeFuturesHost(ctx)) return null;
  const now = deps.now || (() => new Date());
  try {
    if (action === 'get') return await status(ctx, sub);
    if (action === 'save') {
      const config = normalizeNativeFuturesConfig(body || {}, now().getTime());
      await store.saveStudy(ctx.pool, sub, config, now());
      return { status: 201, body: { ok: true, native: true, enabled: null, note: NOTE, kernelSchedule: FUTURES_SCHEDULE, schedule: { id: 'native', cron: `${FUTURES_SCHEDULE.cron} (${FUTURES_SCHEDULE.timezone})`, nextRunAt: null, config } } };
    }
    if (action === 'run') return await runNativeStudy(ctx, sub, { newId: deps.newId || (() => crypto.randomUUID()), now });
    if (action === 'tick') {
      // The nightly schedule: at most one run per New York day, and only for a saved study.
      const runs = await store.listRuns(ctx.pool, sub);
      if (!(await store.loadStudy(ctx.pool, sub))) return { status: 200, body: { ok: true, skipped: 'no_study' } };
      if (runs.some((r) => r.createdAt && nyDay(r.createdAt) === nyDay(now()))) return { status: 200, body: { ok: true, skipped: 'already_ran_today' } };
      return await runNativeStudy(ctx, sub, { newId: deps.newId || (() => crypto.randomUUID()), now });
    }
    if (action === 'predictions') {
      await predictions.gradePending(ctx, sub, schwabFuturesSource(ctx, () => now().getTime()), now());
      return { status: 200, body: { predictions: await store.listPredictions(ctx.pool, sub) } };
    }
    if (action === 'prediction') {
      const row = await store.loadPrediction(ctx.pool, sub, String(body && body.predictionId));
      return row ? { status: 200, body: { snapshot: row.snapshot, prediction: { ...row, snapshot: undefined } } } : { status: 404, body: { error: 'owned_prediction_evidence_not_found' } };
    }
    if (action === 'probe') return { status: 200, body: await probe(ctx, now().getTime()) };
    if (action === 'capture') return { status: 200, body: { native: true, enabled: false, note: CAPTURE_NOTE, schedule: null } };
    if (action === 'capture-write') return { status: 409, body: { error: 'futures_capture_not_needed', message: CAPTURE_NOTE } };
    if (action === 'review') return await reviewNativeRun(ctx, sub, body && body.runId, deps);
    if (action === 'delete') return { status: 200, body: { ok: true, deleted: await store.deleteStudy(ctx.pool, sub) } };
    return { status: 409, body: { error: 'futures_schedule_in_kernel', message: 'Pause and resume switch your own futures-research schedule in the kernel; the Futures panel does it for you.' } };
  } catch (err) {
    if (err && err.status) return { status: err.status, body: { error: err.code, message: err.message } };
    throw err;
  }
}

module.exports = { nativeFutures, nativeFuturesHost, FUTURES_SCHEDULE };
