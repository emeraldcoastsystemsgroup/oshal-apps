/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: run the person's saved native Futures study once. Each root's continuous series is built from its dated contracts over the person's Schwab connection (futures/source.js), split into walk-forward windows and optimized by the platform's staged optimizer (futures/engine.js); the run is claimed, then settled completed, insufficient_sample (fewer out-of-sample trades than the study asks) or failed with the reason in words. Research only: nothing here places or arms an order.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Each market names the live contract its bars came from and says the series is that one contract's own trading (earlier dates as the deferred month), not a rolled front-month series.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Each market carries an evidenceFingerprint (contract, bar span, per-window optimizer result) the research review must cite exactly.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | The quality receipt uses the platform's shape (sampleStatus, lowTradeWindows, lag days, reference date) so the panel's quality card reads it; it had shown 'meets floor' with blank lags.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | With forward calls enabled, a run grades the person's due calls and freezes one call per root from this run's locked strategy (futures/predictions.js).
 *
 * @module futures/run
 */
'use strict';

const crypto = require('crypto');
const E = require('./engine');
const store = require('./store');
const { schwabFuturesSource, liveContract } = require('./source');
const predictions = require('./predictions');

/** The engine's base backtest for a root (the platform study's defaults). */
function baseConfig(root) {
  const meta = E.getFuturesRoot(root);
  return { instrument: { symbol: root, multiplier: meta.multiplier, tickSize: meta.tickSize }, entry: { generation: 'ensemble', riskPerTradePercent: 2 },
    stops: { useStrangleTrail: true }, costs: { slippageTicks: 1, commissionPerContract: 2.5 }, startingEquity: 100000 };
}

const lastBar = (bars) => bars.reduce((at, b) => (b.t > at ? b.t : at), '');

/**
 * @description One root's study: series, windows, optimizer, and the panel's market summary.
 * @param {object} config - Normalized settings.
 * @param {string} root - Futures root.
 * @param {object} src - The Schwab source.
 * @param {number} [at] - Clock (epoch ms) naming the live contract.
 * @returns {Promise<object>} The market summary.
 */
async function studyRoot(config, root, src, at = Date.now()) {
  const start = new Date(config.start), end = new Date(config.end);
  const chart = await E.buildContinuousSeries(src, root, config.timeframe, start, end, { adjust: config.adjust });
  const ltf = await E.buildContinuousSeries(src, root, config.ltfTimeframe, start, end, { adjust: config.adjust });
  if (!chart.bars.length || !ltf.bars.length) throw new Error(`${root}: Schwab returned no ${chart.bars.length ? config.ltfTimeframe : config.timeframe} bars for this window.`);
  const windows = E.walkForwardWindows(chart.bars, config.split);
  if (!windows.length) throw new Error(`${root}: the ${chart.bars.length} ${config.timeframe} bars Schwab returned (from ${chart.bars[0].t.slice(0, 10)}) do not cover one complete in-sample plus out-of-sample period; move Start later or shorten the split.`);
  const stages = E.DEFAULT_OPTIMIZER_STAGES.map((s) => ({ ...s, grid: config.stageGrids[s.name] || s.grid }));
  const report = E.runStagedOptimizer({ chart: chart.bars, ltf: ltf.bars, daily: config.ltfTimeframe === '1Day' ? ltf.bars : [] }, baseConfig(root), { split: config.split, stages });
  const low = report.windows.filter((w) => w.outOfSampleTrades < config.quality.minOosTradesPerWindow)
    .map((w) => ({ oosStart: w.window.oosStart, oosEnd: w.window.oosEnd, trades: w.outOfSampleTrades }));
  const lagDays = (asOf) => Math.max(0, Math.floor((Date.parse(config.end) - Date.parse(asOf)) / 86400000));
  const live = liveContract(root, at);
  // The review must cite this exact evidence: the contract, its bar span and the optimizer's per-window result.
  const evidenceFingerprint = crypto.createHash('sha256').update(JSON.stringify({ root, contract: live && live.symbol, from: chart.bars[0].t,
    asOf: lastBar(chart.bars), bars: chart.bars.length, windows: report.windows.map((w) => [w.window, w.outOfSampleTrades, w.outOfSampleNet]) })).digest('hex');
  return { evidenceFingerprint, root, contract: live ? live.symbol : null, series: 'single live dated contract (earlier dates are its deferred-month trading; no roll or adjustment)', bars: chart.bars.length, ltfBars: ltf.bars.length, ltfResampledFromMinute: false, chartFrom: chart.bars[0].t, chartAsOf: lastBar(chart.bars), ltfAsOf: lastBar(ltf.bars),
    seams: chart.seams.map((s) => s.method), latestCompleteOosEnd: report.windows.at(-1).window.oosEnd,
    outOfSampleTrades: report.outOfSampleTrades, outOfSampleNet: report.outOfSampleNet, worstOutOfSampleMaxDD: report.worstOutOfSampleMaxDD,
    // The platform's quality receipt shape, which the panel's quality card reads.
    quality: { windows: report.windows.length, thinWindows: low.length, lowTradeWindows: low, sampleStatus: low.length ? 'insufficient' : 'sufficient',
      minOosTradesPerWindow: config.quality.minOosTradesPerWindow, referenceDate: config.end.slice(0, 10), maxSourceLagDays: 7,
      chartLagDays: lagDays(lastBar(chart.bars)), ltfLagDays: lagDays(lastBar(ltf.bars)), admissible: low.length === 0 },
    computation: { status: 'computed', source: 'schwab' }, report };
}

/**
 * @description Run the person's saved study once and settle its ledger row.
 * @param {{pool: object, intent: Function}} ctx - Route context.
 * @param {string} sub - Owner.
 * @param {{newId: () => string, now?: () => Date}} deps - Id and clock.
 * @returns {Promise<{status: number, body: object}>} The route answer.
 */
async function runNativeStudy(ctx, sub, deps) {
  const now = deps.now || (() => new Date());
  const study = await store.loadStudy(ctx.pool, sub);
  if (!study || !study.config) return { status: 404, body: { error: 'futures_research_not_configured', message: 'Save the Futures study first.' } };
  const busy = await store.runningRun(ctx.pool, sub);
  if (busy) return { status: 409, body: { error: 'futures_run_in_progress', message: `A Futures run started ${busy.createdAt} is still running.` } };
  const runId = deps.newId();
  await store.claimRun(ctx.pool, sub, runId, study.config, now());
  const src = schwabFuturesSource(ctx, () => now().getTime());
  let outcome;
  try {
    const markets = [];
    for (const root of study.config.roots) markets.push(await studyRoot(study.config, root, src, now().getTime()));
    outcome = { status: markets.every((m) => m.quality.admissible) ? 'completed' : 'insufficient_sample', markets };
  } catch (err) {
    outcome = { status: 'failed', error: String((err && err.message) || err).slice(0, 600) };
  }
  await store.settleRun(ctx.pool, sub, runId, outcome, now());
  // Forward research calls (when the study enables them): grade the person's due calls, then freeze this run's.
  let predictionCycle = null;
  if (study.config.predictions && study.config.predictions.enabled) {
    try {
      const checked = await predictions.gradePending(ctx, sub, src, now());
      const issued = outcome.markets ? await predictions.issueCalls(ctx, sub, { runId, config: study.config, markets: outcome.markets }, src, now()) : [];
      predictionCycle = { status: 'completed', inserted: issued.length, checked, issued };
    } catch (err) {
      predictionCycle = { status: 'failed', inserted: 0, checked: 0, error: String((err && err.message) || err).slice(0, 300) };
    }
  }
  return { status: 200, body: { ok: outcome.status !== 'failed', result: { taskId: runId, status: outcome.status, error: outcome.error || null, schwabReads: src.reads(), predictionCycle } } };
}

module.exports = { runNativeStudy, studyRoot, baseConfig };
