/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the research review of a native Futures run (FUT-01 slice 3), ported from the platform's review contract. The futures-research-analyst receives only the run's finite study facts (no paths, credentials or source errors) on the accounted bot rail, must answer one strict JSON object citing every market's exact evidence fingerprint, may propose only bounded stage-grid changes (re-checked by the native study's own settings envelope), and never grades, predicts or orders. A failed or invalid answer settles failed without touching the run's evidence.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The reviewer's answer is the bot turn's response text: the native bridge returns {response} with no success flag, so the first live review on the owner's account settled failed ("did not complete") although the model had answered.
 *
 * @module futures/review
 */
'use strict';

const crypto = require('crypto');
const store = require('./store');
const { normalizeNativeFuturesConfig } = require('./config');

/** The package's research-only reviewer (oshal-app.yaml bots: futures-research-analyst). */
const REVIEWER = '90a8023d-7f86-485a-b215-f427d92ce032';
const MAX_TEXT = 4000;
const RULES = [
  'Review the supplied Futures study as research only. No tools, fetching, orders or strategy promotion.',
  'Negative or empty evidence is not success. The markets section contains historical backtests, NOT forward predictions or live performance.',
  'Each market is one live dated contract read from the owner\'s Schwab connection; earlier dates are its deferred-month trading, not a rolled front-month series. Say what that limits.',
  'Repeated use of OOS results to choose a grid is exploratory tuning; it needs a new untouched holdout before promotion.',
  'Report every configured sample-gate failure (quality.thinWindows). Meeting a trade-count floor is not statistical confidence. Proposals cannot change these thresholds.',
  'Context contains at most the last eight windows per market; totalWindows states the full count. Do not invent missing facts.',
  'Return ONLY JSON: {"summary":"...","limitations":["..."],"evidence":[{"root":"...","fingerprint":"exact supplied fingerprint"}],"forwardAssessment":null,"nextStudy":null OR {"rationale":"...","stageGrids":{...}}}. Cite every root exactly once. There is no forward evidence yet, so forwardAssessment is null.',
  'nextStudy may change stageGrids only. Include only axes to replace; omitted stages keep the current grid.',
  'Allowed axes: Entry.entry.ensembleEntryThresholdPct integer 1..100; StopLoss.stops.initialStopAtrMultiple number >0..10; Trail.stops.stopBufferMode ticks|atr-percent; Targets.targets.useTargets boolean; EmergencyExit.stops.useStrangleTrail boolean; Sizing.entry.riskPerTradePercent number >0..5.',
  'At most 8 values per axis and 512 estimated backtests total. No forecast, direction, target price or order fields.',
];

/**
 * @description The bounded review request for one run: rules plus finite study facts.
 * @param {object} run - The person's settled run.
 * @returns {string} Prompt text.
 */
function reviewPrompt(run) {
  const { roots, timeframe, ltfTimeframe, source, adjust, start, end, split, stageGrids, quality } = run.config;
  const markets = run.markets.map((m) => ({ root: m.root, contract: m.contract, series: m.series, evidenceFingerprint: m.evidenceFingerprint,
    bars: m.bars, chartFrom: m.chartFrom, chartAsOf: m.chartAsOf, latestCompleteOosEnd: m.latestCompleteOosEnd,
    outOfSampleTrades: m.outOfSampleTrades, outOfSampleNet: m.outOfSampleNet, worstOutOfSampleMaxDD: m.worstOutOfSampleMaxDD, quality: m.quality,
    totalWindows: m.report.windows.length,
    recentWindows: m.report.windows.slice(-8).map((w) => ({ window: w.window, outOfSampleTrades: w.outOfSampleTrades, outOfSampleNet: w.outOfSampleNet,
      outOfSampleMaxDD: w.outOfSampleMaxDD, stages: w.stages.map(({ name, candidateCount, winnerPatch, inSampleTrades, inSampleNet }) => ({ name, candidateCount, winnerPatch, inSampleTrades, inSampleNet })) })) }));
  return RULES.concat(JSON.stringify({ study: { roots, timeframe, ltfTimeframe, source, adjust, start, end, split, stageGrids, quality }, markets })).join('\n');
}

const fail = (message) => { throw new Error(message); };
const textOk = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_TEXT;

/**
 * @description Refuse invented evidence, unknown fields and out-of-envelope proposals.
 * @param {string} response - Untrusted bot output.
 * @param {object} run - The reviewed run.
 * @param {number} now - Clock (the settings envelope).
 * @returns {object} The validated review.
 */
function parseReview(response, run, now) {
  if (Buffer.byteLength(String(response), 'utf8') > 64000) fail('review exceeds 64 KB');
  const r = JSON.parse(String(response).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  if (!r || typeof r !== 'object' || Array.isArray(r)) fail('review is not an object');
  const keys = Object.keys(r).filter((k) => !['summary', 'limitations', 'evidence', 'forwardAssessment', 'nextStudy'].includes(k));
  if (keys.length) fail('review carries unknown fields');
  if (!textOk(r.summary)) fail('review summary missing');
  if (!Array.isArray(r.limitations) || !r.limitations.length || r.limitations.length > 12 || !r.limitations.every(textOk)) fail('review limitations invalid');
  if (!Array.isArray(r.evidence)) fail('review evidence missing');
  const cited = r.evidence.map((e) => `${e && e.root}:${e && e.fingerprint}`).sort();
  const expected = run.markets.map((m) => `${m.root}:${m.evidenceFingerprint}`).sort();
  if (JSON.stringify(cited) !== JSON.stringify(expected)) fail('review evidence does not match this run');
  if (r.forwardAssessment != null) fail('there is no forward evidence to assess');
  if (r.nextStudy != null) {
    const n = r.nextStudy;
    if (!textOk(n.rationale) || !n.stageGrids || typeof n.stageGrids !== 'object' || !Object.keys(n.stageGrids).length) fail('next study must propose a grid change');
    const merged = normalizeNativeFuturesConfig({ ...run.config, stageGrids: { ...run.config.stageGrids, ...n.stageGrids } }, now);
    if (JSON.stringify(merged.stageGrids) === JSON.stringify(run.config.stageGrids)) fail('next study has no grid change');
    r.nextStudy = { rationale: n.rationale, stageGrids: merged.stageGrids };
  }
  return { summary: r.summary, limitations: r.limitations, evidence: r.evidence, forwardAssessment: null, nextStudy: r.nextStudy || null };
}

/** The accounted bot rail on the native kernel. */
async function defaultReviewer(ctx, prompt) {
  const { executeBotOrInline } = require('@/app/routes/inline-bot-execution');
  const answer = await executeBotOrInline(ctx, null, REVIEWER, { text: prompt, agentId: REVIEWER });
  // The native bridge answers {response} (or {reply}) with no success flag; an empty answer is the failure.
  const text = answer && (answer.response || answer.reply);
  if (!text || !String(text).trim()) throw new Error('the reviewer returned no answer');
  return String(text);
}

/**
 * @description Review one of the person's settled runs once (retry after a failure or an hour-old interruption).
 * @param {object} ctx - Route context.
 * @param {string} sub - Owner.
 * @param {string} runId - Run.
 * @param {{now?: () => Date, reviewer?: Function}} [deps] - Clock and reviewer seam.
 * @returns {Promise<{status: number, body: object}>} The route answer.
 */
async function reviewNativeRun(ctx, sub, runId, deps = {}) {
  const now = deps.now || (() => new Date());
  const run = await store.loadRun(ctx.pool, sub, String(runId));
  if (!run) return { status: 404, body: { error: 'futures_run_not_found', message: 'No such Futures run.' } };
  if (!['completed', 'insufficient_sample'].includes(run.status) || !run.markets.length) {
    return { status: 409, body: { error: 'futures_run_has_no_completed_evidence', message: 'Only a run with computed evidence can be reviewed.' } };
  }
  const prior = await store.loadReview(ctx.pool, sub, run.runId);
  if (prior && prior.status === 'completed') return { status: 200, body: { ok: true, review: prior } };
  const attemptId = crypto.randomUUID();
  if (!(await store.claimReview(ctx.pool, sub, run.runId, attemptId, now()))) {
    return { status: 409, body: { error: 'futures_review_already_active', message: 'A review of this run is already in progress; retry after an hour if it was interrupted.' } };
  }
  let outcome;
  try {
    const answer = await (deps.reviewer || defaultReviewer)(ctx, reviewPrompt(run));
    outcome = { status: 'completed', result: parseReview(answer, run, now().getTime()) };
  } catch (err) {
    outcome = { status: 'failed', error: 'Review unavailable or invalid (' + String((err && err.message) || err).slice(0, 160) + '). Check the assistant connection, then retry.' };
  }
  if (!(await store.settleReview(ctx.pool, sub, run.runId, attemptId, outcome, now()))) {
    return { status: 409, body: { error: 'futures_review_superseded', message: 'A newer review attempt replaced this one.' } };
  }
  return { status: 200, body: { ok: outcome.status === 'completed', review: await store.loadReview(ctx.pool, sub, run.runId) } };
}

module.exports = { reviewNativeRun, reviewPrompt, parseReview, defaultReviewer, REVIEWER };
