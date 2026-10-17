/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: forward research calls for the native Futures study (FUT-01 slice 4), ported from the platform's locked-strategy-bias-v1. After a run with computed evidence, each root's last window's locked strategy is replayed over the live contract's latest closed bars (Schwab); the last completed bar's bias is frozen with its reference bar as a pending call (or an abstention), and a call is graded later against the first completed same-contract bar in its target window: directional ticks from the reference close, never trade P&L. Missing, stale or revised evidence is withheld or unavailable, never invented. Research only; nothing here places an order.
 *
 * @module futures/predictions
 */
'use strict';

const crypto = require('crypto');
const E = require('./engine');
const store = require('./store');
const { liveContract } = require('./source');

const HOUR = 3600000;
const MODEL = 'locked-strategy-bias-v1';

/**
 * @description Freeze one root's forward call from a run's locked strategy.
 * @param {object} config - The run's settings (predictions enabled).
 * @param {object} market - The run's market (report windows, evidenceFingerprint).
 * @param {object} src - The Schwab source.
 * @param {number} at - True UTC issuance (epoch ms).
 * @returns {Promise<object>} {root, contract, status, reason, snapshot}.
 */
async function draftCall(config, market, src, at) {
  const p = config.predictions;
  const live = liveContract(market.root, at);
  const contract = live ? live.symbol : market.contract;
  try {
    const last = market.report && market.report.windows && market.report.windows.at(-1);
    if (!last || !last.finalConfig) throw new Error('No locked strategy in this run');
    const chart = await src.closedBars(contract, config.timeframe, at, p.historyBars);
    const ltf = await src.closedBars(contract, config.ltfTimeframe, at, Math.min(p.historyBars, 512));
    for (const [name, bars] of [['chart', chart], ['higher timeframe', ltf]]) {
      if (bars.length < 64) throw new Error(`Fewer than 64 completed ${name} bars from Schwab`);
      if (at - bars.at(-1).closedMs > p.maxSourceAgeHours * HOUR) throw new Error(`The latest completed ${name} bar is older than ${p.maxSourceAgeHours} hours`);
    }
    const strategy = JSON.parse(JSON.stringify(last.finalConfig));
    const daily = strategy.regimeGate && strategy.regimeGate.enabled ? (config.ltfTimeframe === '1Day' ? ltf : await src.closedBars(contract, '1Day', at, 512)) : [];
    let reading;
    E.runFuturesBacktest(chart, ltf, strategy, daily, (o) => { reading = o; });
    if (!reading || reading.barIndex !== chart.length - 1 || (reading.decision && reading.decision.skippedBar)) throw new Error('The locked strategy has no warmed completed-bar observation');
    const ref = chart.at(-1);
    const snapshot = { model: MODEL, root: market.root, contract, studyFingerprint: market.evidenceFingerprint, strategy,
      chart: chart.map(({ t, ms, o, h, l, c, v }) => ({ t, ms, o, h, l, c, v })), ltf: ltf.map(({ t, ms, o, h, l, c, v }) => ({ t, ms, o, h, l, c, v })),
      reference: { t: ref.t, ms: ref.ms, closedMs: ref.closedMs, c: ref.c }, observation: { bias: reading.bias, barIndex: reading.barIndex, regimeAllowed: reading.regimeAllowed },
      horizonHours: p.horizonHours, gradingToleranceHours: p.gradingToleranceHours, tickSize: E.getFuturesRoot(market.root).tickSize, timeframe: config.timeframe };
    return { root: market.root, contract, snapshot, status: reading.bias ? 'pending' : 'abstained',
      reason: reading.bias ? null : 'The locked replay has no directional bias; excluded from accuracy scoring' };
  } catch (err) {
    return { root: market.root, contract, snapshot: null, status: 'withheld', reason: String((err && err.message) || err).slice(0, 300) };
  }
}

/**
 * @description Issue one forward call per root for a run with computed evidence (when the study enables them).
 * @param {object} ctx - Route context.
 * @param {string} sub - Owner.
 * @param {{runId: string, config: object, markets: object[]}} run - The settled run.
 * @param {object} src - The Schwab source.
 * @param {Date} at - Issuance clock.
 * @returns {Promise<object[]>} The issued receipts.
 */
async function issueCalls(ctx, sub, run, src, at) {
  if (!run.config.predictions || !run.config.predictions.enabled || !run.markets || !run.markets.length) return [];
  const issued = [];
  for (const market of run.markets) {
    const draft = await draftCall(run.config, market, src, at.getTime());
    const receipt = { predictionId: crypto.randomUUID(), runId: run.runId, ...draft };
    await store.insertPrediction(ctx.pool, sub, receipt, at);
    issued.push({ predictionId: receipt.predictionId, root: receipt.root, contract: receipt.contract, status: receipt.status, reason: receipt.reason });
  }
  return issued;
}

/**
 * @description Grade one frozen call against the first completed same-contract bar in its target window.
 * @param {object} snapshot - Frozen inputs.
 * @param {string} issuedAt - Durable issuance (ISO).
 * @param {object[]} bars - The contract's closed bars (with ms, closedMs).
 * @param {number} now - True UTC now.
 * @returns {object} {status: pending|unavailable|graded, reason, ...}.
 */
function gradeCall(snapshot, issuedAt, bars, now) {
  const target = Date.parse(issuedAt) + snapshot.horizonHours * HOUR, limit = target + snapshot.gradingToleranceHours * HOUR;
  if (now < target) return { status: 'pending', reason: null };
  if (!snapshot.observation.bias || snapshot.reference.closedMs > Date.parse(issuedAt)) return { status: 'unavailable', reason: 'Invalid frozen call: no direction or a reference after issuance' };
  const ref = bars.find((b) => b.ms === snapshot.reference.ms);
  if (ref && ref.c !== snapshot.reference.c) return { status: 'unavailable', reason: 'The frozen reference bar was revised by the source; outcome is not scored' };
  const bar = bars.find((b) => b.closedMs >= target && b.closedMs <= limit);
  if (!bar) return now > limit ? { status: 'unavailable', reason: 'No completed same-contract bar in the target tolerance window' } : { status: 'pending', reason: null };
  const priceChange = bar.c - snapshot.reference.c;
  const signedTicks = (priceChange / snapshot.tickSize) * (snapshot.observation.bias === 'long' ? 1 : -1);
  return { status: 'graded', reason: null, bar: { t: bar.t, ms: bar.ms, closedMs: bar.closedMs, c: bar.c }, priceChange, signedTicks, correct: signedTicks === 0 ? null : signedTicks > 0 };
}

/**
 * @description Grade the person's pending calls whose target has passed.
 * @param {object} ctx - Route context.
 * @param {string} sub - Owner.
 * @param {object} src - The Schwab source.
 * @param {Date} at - Clock.
 * @returns {Promise<number>} How many were checked.
 */
async function gradePending(ctx, sub, src, at) {
  const now = at.getTime();
  const due = (await store.pendingPredictions(ctx.pool, sub)).filter((p) => p.snapshot && now >= Date.parse(p.issuedAt) + p.snapshot.horizonHours * HOUR);
  for (const p of due) {
    let outcome;
    try {
      const bars = await src.closedBars(p.snapshot.contract, p.snapshot.timeframe || '1Hour', now, 4096);
      outcome = gradeCall(p.snapshot, p.issuedAt, bars, now);
    } catch (err) {
      outcome = { status: 'pending', reason: null };
    }
    await store.settlePrediction(ctx.pool, sub, p.predictionId, outcome, at);
  }
  return due.length;
}

module.exports = { issueCalls, gradePending, gradeCall, draftCall, MODEL };
