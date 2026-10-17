/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The native Futures study (FUT-01 slice 1): Save keeps one study per person, Run once builds each root's series from dated contracts over the person's Schwab connection (paged trading.bars reads, never the bare stock ticker), optimizes walk-forward windows and settles the run in the ledger; a second concurrent run, a non-Schwab source, an impossible window and another person's study refuse in words; through the shipped autopilot routes the panel's GET/POST/run/DELETE reach the native study.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Every window reads the live dated contract (ESZ26 on 2026-10-16) and the market names it: Schwab does not serve expired contracts.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The nightly tick (futures-research schedule): no study skips, a saved study runs once per New York day, and the manifest's schedule targets POST /futures/tick as the person.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | The research review: exact evidence citation, bounded grid proposals re-checked by the settings envelope, failed answers settle failed and can be retried, a completed review is not repeated, and another person cannot review the run.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The default reviewer reads the native bot turn's {response} shape (no success flag).
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Forward research calls (frozen from the locked strategy over the live contract, owner-scoped, graded later by directional ticks), the grading rules, the native Schwab check, and capture/catch-up/import answering not needed.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Through a router double with the native bridge's mount rules (array mounted at '/', prefix use(), no baseUrl), GET/POST /futures, predictions, the Schwab check, capture and archive all reach the native study; 1.33.34 answered 500 on all of them.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
Module._load = function load(request, ...rest) {
  if (request === '@/app/routes/inline-bot-execution') return { executeBotOrInline: async (...args) => global.__futuresBot(...args) };
  if (request === '@/shared/logger') { const l = { info() {}, warn() {}, error() {}, debug() {}, child() { return l; } }; return { createChildLogger: () => l }; }
  return original.call(this, request, ...rest);
};
const { nativeFutures } = require('../routes/futures/native');

const NOW = Date.UTC(2026, 9, 16, 16, 0);
const ALICE = 'futures-alice', BOB = 'futures-bob';

/** The two tables, in memory, answering exactly the statements futures/store.js issues. */
function pool() {
  const studies = new Map(), runs = [], reviews = new Map(), preds = [];
  return { studies, runs, reviews, preds, async query(sql, p) {
    if (/^INSERT INTO oshal_trading_futures_native_predictions/.test(sql)) { preds.push({ prediction_id: p[0], user_sub: p[1], run_id: p[2], root: p[3], contract: p[4], status: p[5], reason: p[6], issued_at: p[7], checked_at: p[7], snapshot: p[8], outcome: null }); return { rows: [], rowCount: 1 }; }
    if (/FROM oshal_trading_futures_native_predictions WHERE user_sub = \$1 AND status = 'pending'/.test(sql)) return { rows: preds.filter((r) => r.user_sub === p[0] && r.status === 'pending') };
    if (/FROM oshal_trading_futures_native_predictions WHERE user_sub = \$1 AND prediction_id/.test(sql)) return { rows: preds.filter((r) => r.user_sub === p[0] && r.prediction_id === p[1]) };
    if (/FROM oshal_trading_futures_native_predictions WHERE user_sub = \$1 ORDER BY/.test(sql)) return { rows: preds.filter((r) => r.user_sub === p[0]).map(({ snapshot, ...r }) => r).reverse() };
    if (/^UPDATE oshal_trading_futures_native_predictions SET status/.test(sql)) { const r = preds.find((x) => x.user_sub === p[0] && x.prediction_id === p[1] && x.status === 'pending'); if (r) Object.assign(r, { status: p[2], reason: p[3], outcome: p[4], checked_at: p[5] }); return { rows: [], rowCount: r ? 1 : 0 }; }
    if (/^UPDATE oshal_trading_futures_native_predictions SET checked_at/.test(sql)) return { rows: [], rowCount: 1 };
    if (/^SELECT run_id, status, config, markets, error, created_at, finished_at FROM oshal_trading_futures_native_runs WHERE user_sub = \$1 AND run_id/.test(sql)) return { rows: runs.filter((r) => r.user_sub === p[0] && r.run_id === p[1]) };
    if (/FROM oshal_trading_futures_native_reviews WHERE user_sub = \$1 AND run_id/.test(sql)) { const r = reviews.get(p[1]); return { rows: r && r.user_sub === p[0] ? [r] : [] }; }
    if (/FROM oshal_trading_futures_native_reviews WHERE user_sub = \$1/.test(sql)) return { rows: [...reviews.values()].filter((r) => r.user_sub === p[0]) };
    if (/^INSERT INTO oshal_trading_futures_native_reviews/.test(sql)) { if (reviews.has(p[0])) throw new Error('duplicate key'); reviews.set(p[0], { run_id: p[0], user_sub: p[1], status: 'reviewing', attempt_id: p[2], requested_at: p[3] }); return { rows: [], rowCount: 1 }; }
    if (/^UPDATE oshal_trading_futures_native_reviews SET status = 'reviewing'/.test(sql)) { const r = reviews.get(p[1]); if (!r || r.user_sub !== p[0] || r.attempt_id !== p[4]) return { rows: [], rowCount: 0 }; Object.assign(r, { status: 'reviewing', attempt_id: p[2], requested_at: p[3], completed_at: null, result: null, error: null }); return { rows: [], rowCount: 1 }; }
    if (/^UPDATE oshal_trading_futures_native_reviews SET status = \$4/.test(sql)) { const r = reviews.get(p[1]); if (!r || r.user_sub !== p[0] || r.attempt_id !== p[2] || r.status !== 'reviewing') return { rows: [], rowCount: 0 }; Object.assign(r, { status: p[3], completed_at: p[4], result: p[5], error: p[6] }); return { rows: [], rowCount: 1 }; }
    if (/^SELECT config, updated_at FROM oshal_trading_futures_native_studies/.test(sql)) { const r = studies.get(p[0]); return { rows: r ? [r] : [] }; }
    if (/^INSERT INTO oshal_trading_futures_native_studies/.test(sql)) { studies.set(p[0], { config: p[1], updated_at: p[2] }); return { rows: [], rowCount: 1 }; }
    if (/^DELETE FROM oshal_trading_futures_native_studies/.test(sql)) { const had = studies.delete(p[0]); return { rows: [], rowCount: had ? 1 : 0 }; }
    if (/status = 'running' ORDER BY/.test(sql)) return { rows: runs.filter((r) => r.user_sub === p[0] && r.status === 'running').map((r) => ({ run_id: r.run_id, created_at: r.created_at })) };
    if (/^INSERT INTO oshal_trading_futures_native_runs/.test(sql)) { runs.push({ run_id: p[0], user_sub: p[1], status: 'running', config: p[2], created_at: p[3] }); return { rows: [], rowCount: 1 }; }
    if (/^UPDATE oshal_trading_futures_native_runs/.test(sql)) { const r = runs.find((x) => x.user_sub === p[0] && x.run_id === p[1] && x.status === 'running'); if (r) Object.assign(r, { status: p[2], markets: p[3], error: p[4], finished_at: p[5] }); return { rows: [], rowCount: r ? 1 : 0 }; }
    if (/^SELECT run_id, status, config, markets/.test(sql)) return { rows: runs.filter((r) => r.user_sub === p[0]).slice().reverse() };
    throw new Error('unexpected SQL ' + sql.slice(0, 60));
  } };
}

/** Schwab's 30-minute bars as hours, true UTC seconds, 09:30-16:00 New York (EDT here), a deterministic trending walk. */
function schwab(asked) {
  return async (name, input) => {
    if (name === 'trading.quotes') return { quotes: [{ symbol: input.symbols[0], price: 6700, tradeAt: '2026-10-16T15:59:00Z' }] };
    assert.equal(name, 'trading.bars');
    asked.push(input);
    assert.match(input.symbol, /^\/[A-Z]{1,3}[FGHJKMNQUVXZ]\d{2}$/, 'a dated contract, never the stock ticker');
    const end = input.end, span = input.timeframe === '1Hour' ? 45 * 86400000 : 400 * 86400000, bars = [];
    let seed = input.symbol.length * 97 + 13; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let day = Math.floor((end - span) / 86400000); day * 86400000 < end; day += 1) {
      const w = new Date(day * 86400000).getUTCDay(); if (w === 0 || w === 6) continue;
      let p = 6000 + 400 * Math.sin(day / 9) + day % 7;
      const hours = input.timeframe === '1Hour' ? [13, 14, 15, 16, 17, 18, 19] : [4];
      for (const h of hours) { const o = p, c = p * (1 + (rnd() - 0.47) * 0.006); p = c;
        bars.push({ t: (day * 86400000 + h * 3600000 + 30 * 60000) / 1000, o, h: Math.max(o, c) + 2, l: Math.min(o, c) - 2, c, v: 1000 + Math.round(rnd() * 500) }); }
    }
    return { symbol: input.symbol, timeframe: input.timeframe, bars, source: 'schwab' };
  };
}

function host() {
  const asked = [], db = pool();
  let n = 0;
  return { asked, db, ctx: { pool: db, intent: schwab(asked) }, deps: { newId: () => `run-${(n += 1)}`, now: () => new Date(NOW) } };
}

test('Save keeps one study per person and refuses sources and windows the native study cannot run', async () => {
  const t = host();
  const saved = await nativeFutures(t.ctx, 'save', ALICE, { roots: ['ES'], source: 'schwab', start: '2026-03-01T00:00:00Z' }, t.deps);
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  assert.deepEqual([saved.body.schedule.config.timeframe, saved.body.schedule.config.ltfTimeframe, saved.body.schedule.config.source], ['1Hour', '1Day', 'schwab']);
  for (const [input, code] of [
    [{ source: 'kibot-file' }, 'futures_source_unavailable_native'],
    [{ timeframe: '1Day' }, 'futures_config_invalid'],
    [{ roots: ['ZZ'] }, 'futures_config_invalid'],
    [{ start: '2026-10-01T00:00:00Z' }, 'futures_config_invalid'],
  ]) {
    const r = await nativeFutures(t.ctx, 'save', ALICE, input, t.deps);
    assert.equal(r.body.error, code, JSON.stringify(input)); assert.ok(r.body.message.length > 20);
  }
  const bob = await nativeFutures(t.ctx, 'get', BOB, undefined, t.deps);
  assert.equal(bob.body.schedule, null, "Bob does not see Alice's study");
  const alice = await nativeFutures(t.ctx, 'get', ALICE, undefined, t.deps);
  assert.deepEqual([alice.body.native, alice.body.schedule.config.roots], [true, ['ES']]);
});

test('Run once builds the series from dated contracts over Schwab, optimizes and settles the run', async () => {
  const t = host();
  await nativeFutures(t.ctx, 'save', ALICE, { roots: ['ES'], start: '2026-03-01T00:00:00Z', split: { inSampleMonths: 3, oosMonths: 1, stepMonths: 1 }, quality: { minOosTradesPerWindow: 0 } }, t.deps);
  const run = await nativeFutures(t.ctx, 'run', ALICE, undefined, t.deps);
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.result.status, 'completed', JSON.stringify(run.body));
  assert.ok(t.asked.some((a) => a.timeframe === '1Hour' && Number.isInteger(a.end)), 'intraday history is paged with an end');
  assert.deepEqual([...new Set(t.asked.map((a) => a.symbol))], ['/ESZ26'], 'every window reads the live contract (expired contracts are not served)');
  const after = await nativeFutures(t.ctx, 'get', ALICE, undefined, t.deps);
  const [r] = after.body.runs;
  assert.deepEqual([r.runId, r.status, r.markets.length, r.markets[0].root], ['run-1', 'completed', 1, 'ES']);
  const m = r.markets[0];
  assert.ok(m.bars > 500 && m.ltfBars > 100 && m.quality.windows >= 1, JSON.stringify({ bars: m.bars, ltf: m.ltfBars, q: m.quality }));
  assert.match(m.chartAsOf, /^2026-10-1\dT/); assert.equal(m.computation.source, 'schwab');
  assert.equal(m.contract, 'ESZ26'); assert.match(m.series, /single live dated contract/);
  assert.ok(Number.isFinite(m.outOfSampleNet) && Number.isFinite(m.outOfSampleTrades));
});

test('a thin sample is labelled, a running run blocks a second, and a failed read settles in words', async () => {
  const t = host();
  await nativeFutures(t.ctx, 'save', ALICE, { roots: ['ES'], start: '2026-03-01T00:00:00Z', quality: { minOosTradesPerWindow: 1000 } }, t.deps);
  assert.equal((await nativeFutures(t.ctx, 'run', ALICE, undefined, t.deps)).body.result.status, 'insufficient_sample');
  t.db.runs.push({ run_id: 'stuck', user_sub: ALICE, status: 'running', config: '{}', created_at: new Date(NOW) });
  const busy = await nativeFutures(t.ctx, 'run', ALICE, undefined, t.deps);
  assert.deepEqual([busy.status, busy.body.error], [409, 'futures_run_in_progress']);
  t.db.runs.pop();
  t.ctx.intent = async () => { throw new Error('refused: Schwab market data is not connected'); };
  const failed = await nativeFutures(t.ctx, 'run', ALICE, undefined, t.deps);
  assert.deepEqual([failed.body.ok, failed.body.result.status], [false, 'failed']);
  assert.match(failed.body.result.error, /Schwab/);
  assert.equal((await nativeFutures(t.ctx, 'run', BOB, undefined, t.deps)).body.error, 'futures_research_not_configured');
  assert.equal((await nativeFutures(t.ctx, 'pause', ALICE, undefined, t.deps)).status, 409);
  assert.equal((await nativeFutures(t.ctx, 'delete', ALICE, undefined, t.deps)).body.deleted, 1);
  assert.equal(await nativeFutures({ pool: t.db }, 'get', ALICE), null, 'a host without the kernel intent keeps its path');
});

test('through the shipped autopilot routes, the Futures panel reaches the native study', async () => {
  const { standIns, loadShipped } = require('./support/native-landing-host');
  const t = host();
  const routes = new Map();
  const router = { get: (p, fn) => routes.set('GET ' + p, fn), post: (p, fn) => routes.set('POST ' + p, fn), delete: (p, fn) => routes.set('DELETE ' + p, fn),
    patch() {}, use() {} };
  const modules = standIns({});
  modules.express = { Router: () => router };
  loadShipped(modules, (load) => { load('trading-autopilot-routes.js').createTradingAutopilotRoutes(t.ctx); });
  const call = async (key, body) => {
    const out = { code: 200, body: null };
    const res = { status(c) { out.code = c; return res; }, json(b) { out.body = b; return res; }, setHeader() {} };
    await routes.get(key)({ oshalCallerSub: ALICE, userSub: ALICE, oidc: { user: { sub: ALICE } }, query: {}, params: {}, headers: {}, body }, res);
    return out;
  };
  const first = await call('GET /futures'); assert.equal(first.body.native, true, JSON.stringify(first));
  const saved = await call('POST /futures', { roots: ['CL'], start: '2026-03-01T00:00:00Z' });
  assert.equal(saved.code, 201, JSON.stringify(saved.body));
  assert.equal((await call('GET /futures')).body.schedule.config.roots[0], 'CL');
  assert.equal((await call('DELETE /futures')).body.deleted, 1);
});

test('the nightly tick runs a saved study at most once per New York day, and the manifest schedule targets it', async () => {
  const t = host();
  assert.equal((await nativeFutures(t.ctx, 'tick', ALICE, undefined, t.deps)).body.skipped, 'no_study');
  await nativeFutures(t.ctx, 'save', ALICE, { roots: ['ES'], start: '2026-03-01T00:00:00Z', quality: { minOosTradesPerWindow: 0 } }, t.deps);
  const first = await nativeFutures(t.ctx, 'tick', ALICE, undefined, t.deps);
  assert.equal(first.body.result.status, 'completed', JSON.stringify(first.body));
  assert.equal((await nativeFutures(t.ctx, 'tick', ALICE, undefined, t.deps)).body.skipped, 'already_ran_today');
  const status = await nativeFutures(t.ctx, 'get', ALICE, undefined, t.deps);
  assert.deepEqual([status.body.kernelSchedule.app, status.body.kernelSchedule.name], ['intelligent-trades', 'futures-research']);
  const yaml = require('fs').readFileSync(require('path').join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  const block = yaml.split('\n  - id: futures-research\n')[1].split('\n  - id: ')[0].split('\n\n')[0];
  assert.match(block, /route: \/api\/trading\/autopilot\/futures\/tick/);
  assert.match(block, /runsAs: user/);
  assert.ok(block.includes(`cron: "${status.body.kernelSchedule.cron}"`), 'the page names the schedule the manifest declares');
  const pause = await nativeFutures(t.ctx, 'pause', ALICE, undefined, t.deps);
  assert.deepEqual([pause.status, pause.body.error], [409, 'futures_schedule_in_kernel']);
});

test('a research review cites the run\'s exact evidence, may propose only bounded grids, and refuses invented evidence', async () => {
  const t = host();
  await nativeFutures(t.ctx, 'save', ALICE, { roots: ['ES'], start: '2026-03-01T00:00:00Z', quality: { minOosTradesPerWindow: 0 } }, t.deps);
  const runId = (await nativeFutures(t.ctx, 'run', ALICE, undefined, t.deps)).body.result.taskId;
  const run = (await nativeFutures(t.ctx, 'get', ALICE, undefined, t.deps)).body.runs[0];
  const fp = run.markets[0].evidenceFingerprint;
  assert.match(fp, /^[a-f0-9]{64}$/);
  const prompts = [];
  const answer = (evidence, extra = {}) => async (_ctx, prompt) => { prompts.push(prompt); return JSON.stringify({ summary: 'ES produced few out-of-sample trades.', limitations: ['One live contract, months of history.'], evidence, forwardAssessment: null, nextStudy: null, ...extra }); };
  const bad = await nativeFutures(t.ctx, 'review', ALICE, { runId }, { ...t.deps, reviewer: answer([{ root: 'ES', fingerprint: 'f'.repeat(64) }]) });
  assert.deepEqual([bad.body.ok, bad.body.review.status], [false, 'failed']);
  assert.match(bad.body.review.error, /evidence does not match/);
  const tooBig = await nativeFutures(t.ctx, 'review', ALICE, { runId }, { ...t.deps, reviewer: answer([{ root: 'ES', fingerprint: fp }], { nextStudy: { rationale: 'widen', stageGrids: { Entry: { 'entry.ensembleEntryThresholdPct': Array.from({ length: 13 }, (_, i) => i + 1) } } } }) });
  assert.equal(tooBig.body.review.status, 'failed', 'a proposal outside the settings envelope is refused');
  const good = await nativeFutures(t.ctx, 'review', ALICE, { runId }, { ...t.deps, reviewer: answer([{ root: 'ES', fingerprint: fp }], { nextStudy: { rationale: 'try a lower entry threshold', stageGrids: { Entry: { 'entry.ensembleEntryThresholdPct': [20, 30] } } } }) });
  assert.deepEqual([good.body.ok, good.body.review.status], [true, 'completed'], JSON.stringify(good.body));
  assert.deepEqual(good.body.review.result.nextStudy.stageGrids.Entry, { 'entry.ensembleEntryThresholdPct': [20, 30] });
  assert.ok(prompts[0].includes(fp) && !/schwab-capture|dataDir|token/i.test(prompts[0].split('\n').pop()), 'only finite study facts');
  const again = await nativeFutures(t.ctx, 'review', ALICE, { runId }, { ...t.deps, reviewer: async () => { throw new Error('must not be asked twice'); } });
  assert.equal(again.body.review.status, 'completed', 'a completed review is returned, not repeated');
  const listed = (await nativeFutures(t.ctx, 'get', ALICE, undefined, t.deps)).body.runs[0];
  assert.equal(listed.review.result.summary, 'ES produced few out-of-sample trades.');
  assert.equal((await nativeFutures(t.ctx, 'review', BOB, { runId }, t.deps)).body.error, 'futures_run_not_found', "Bob cannot review Alice's run");
});

test('the default reviewer reads the native bot turn\'s response, which carries no success flag', async () => {
  const { defaultReviewer, REVIEWER } = require('../routes/futures/review');
  const asked = [];
  global.__futuresBot = async (ctx, client, agentId, opts) => { asked.push([agentId, opts.agentId]); return { response: '{"summary":"ok"}' }; };
  assert.equal(await defaultReviewer({}, 'prompt'), '{"summary":"ok"}');
  assert.deepEqual(asked, [[REVIEWER, REVIEWER]]);
  global.__futuresBot = async () => ({ response: '  ' });
  await assert.rejects(defaultReviewer({}, 'prompt'), /no answer/);
  delete global.__futuresBot;
});

test('forward calls are frozen from a run\'s locked strategy over the live contract and graded against a later same-contract bar', async () => {
  const t = host();
  await nativeFutures(t.ctx, 'save', ALICE, { roots: ['ES'], start: '2026-03-01T00:00:00Z', quality: { minOosTradesPerWindow: 0 },
    predictions: { enabled: true, horizonHours: 1, gradingToleranceHours: 3, maxSourceAgeHours: 72, historyBars: 512 } }, t.deps);
  const run = await nativeFutures(t.ctx, 'run', ALICE, undefined, t.deps);
  const cycle = run.body.result.predictionCycle;
  assert.deepEqual([cycle.status, cycle.inserted], ['completed', 1], JSON.stringify(cycle));
  const [issued] = t.db.preds;
  assert.ok(['pending', 'abstained'].includes(issued.status), issued.status + ' ' + issued.reason);
  const snap = JSON.parse(issued.snapshot);
  assert.deepEqual([snap.model, snap.contract, snap.horizonHours], ['locked-strategy-bias-v1', 'ESZ26', 1]);
  assert.ok(snap.reference.closedMs <= NOW && snap.chart.length >= 64, 'frozen from completed bars only');
  const detail = await nativeFutures(t.ctx, 'prediction', ALICE, { predictionId: issued.prediction_id }, t.deps);
  assert.equal(detail.body.snapshot.contract, 'ESZ26');
  assert.equal((await nativeFutures(t.ctx, 'prediction', BOB, { predictionId: issued.prediction_id }, t.deps)).status, 404, "Bob cannot read Alice's call");
  if (issued.status === 'pending') {
    const later = { ...t.deps, now: () => new Date(NOW + 2 * 3600000) };
    const listed = await nativeFutures(t.ctx, 'predictions', ALICE, undefined, later);
    assert.ok(['graded', 'unavailable'].includes(listed.body.predictions[0].status), JSON.stringify(listed.body.predictions[0]));
  }
});

test('grading is directional ticks from the frozen close: matched, missed, flat, revised and out-of-window cases', async () => {
  const { gradeCall } = require('../routes/futures/predictions');
  const issuedAt = new Date(NOW).toISOString(), H = 3600000;
  const snap = (bias) => ({ observation: { bias }, reference: { ms: NOW - 2 * H, closedMs: NOW - H, c: 100 }, horizonHours: 1, gradingToleranceHours: 2, tickSize: 0.25 });
  const bars = (c) => [{ ms: NOW - 2 * H, closedMs: NOW - H, c: 100 }, { ms: NOW + 0.5 * H, closedMs: NOW + 1.5 * H, c, t: 'x' }];
  assert.deepEqual([gradeCall(snap('long'), issuedAt, bars(101), NOW + 2 * H).status, gradeCall(snap('long'), issuedAt, bars(101), NOW + 2 * H).correct], ['graded', true]);
  const short = gradeCall(snap('short'), issuedAt, bars(101), NOW + 2 * H);
  assert.deepEqual([short.correct, short.signedTicks], [false, -4]);
  assert.equal(gradeCall(snap('long'), issuedAt, bars(100), NOW + 2 * H).correct, null, 'a flat outcome is not a win');
  assert.equal(gradeCall(snap('long'), issuedAt, bars(101), NOW + 0.5 * H).status, 'pending', 'before the target');
  const revised = [{ ms: NOW - 2 * H, closedMs: NOW - H, c: 99 }, bars(101)[1]];
  assert.match(gradeCall(snap('long'), issuedAt, revised, NOW + 2 * H).reason, /revised/);
  assert.equal(gradeCall(snap('long'), issuedAt, [bars(101)[0]], NOW + 4 * H).status, 'unavailable', 'no bar in the tolerance window');
});

test('the Schwab check reads the live contracts, and capture, catch-up and archive import say they are not needed', async () => {
  const t = host();
  const probe = await nativeFutures(t.ctx, 'probe', ALICE, undefined, t.deps);
  assert.deepEqual(probe.body.roots.map((r) => [r.root, r.datedContract, r.quote.state, r.minute.state, r.forwardBarCandidate]),
    [['ES', 'ESZ26', 'available', 'available', true], ['CL', 'CLZ26', 'available', 'available', true]]);
  assert.ok(probe.body.roots[0].minute.bars > 100 && probe.body.roots[0].daily.bars > 100);
  const capture = await nativeFutures(t.ctx, 'capture', ALICE, undefined, t.deps);
  assert.deepEqual([capture.body.native, capture.body.enabled], [true, false]);
  const write = await nativeFutures(t.ctx, 'capture-write', ALICE, undefined, t.deps);
  assert.deepEqual([write.status, write.body.error], [409, 'futures_capture_not_needed']);
  assert.match(write.body.message, /reads your Schwab connection directly/);
});

test('through a router with the native bridge\'s mount rules, every Futures route still reaches the native study', async () => {
  // The native express shim mounts an array (or a bare function) at '/', matches use() by prefix, rewrites req.url,
  // and has no req.baseUrl - an array mount ran for every Futures path and answered 500 (1.33.34).
  const { standIns, loadShipped } = require('./support/native-landing-host');
  const t = host();
  const makeRouter = () => {
    const stack = [];
    const add = (method) => (p, ...h) => { stack.push({ method, path: p, handlers: h.flat(), use: false }); };
    return { stack, get: add('GET'), post: add('POST'), delete: add('DELETE'), patch: add('PATCH'),
      use: (p, ...h) => { if (typeof p === 'function' || Array.isArray(p)) { h.unshift(p); p = '/'; } stack.push({ method: 'ALL', path: p, handlers: h.flat().filter((f) => typeof f === 'function'), use: true }); } };
  };
  const modules = standIns({});
  modules.express = { Router: makeRouter };
  let main; loadShipped(modules, (load) => { main = load('trading-autopilot-routes.js').createTradingAutopilotRoutes(t.ctx); });
  const stack = main.stack;
  const matches = (layer, url) => layer.use ? (layer.path === '/' || url === layer.path || url.startsWith(layer.path + '/'))
    : layer.path.split('/').filter(Boolean).length === url.split('/').filter(Boolean).length
      && layer.path.split('/').filter(Boolean).every((part, i) => part.startsWith(':') || part === url.split('/').filter(Boolean)[i]);
  const call = async (method, url, body) => {
    const out = { code: 200, body: null, done: false };
    const res = { status(c) { out.code = c; return res; }, json(b) { out.body = b; out.done = true; return res; }, setHeader() {} };
    const req = { method, url, oshalCallerSub: ALICE, userSub: ALICE, oidc: { user: { sub: ALICE } }, query: {}, params: {}, headers: {}, body };
    for (const layer of stack) {
      if (out.done || !(layer.method === 'ALL' || layer.method === method) || !matches(layer, url)) continue;
      for (const h of layer.handlers) { let next = false; await h(req, res, () => { next = true; }); if (!next || out.done) break; }
      if (!layer.use && !out.done) break;
    }
    return out;
  };
  const get = await call('GET', '/futures');
  assert.equal(get.body && get.body.native, true, JSON.stringify(get));
  assert.equal((await call('POST', '/futures', { roots: ['ES'], start: '2026-03-01T00:00:00Z' })).code, 201);
  assert.ok(Array.isArray((await call('GET', '/futures/predictions')).body.predictions));
  assert.equal((await call('GET', '/futures/sources/schwab/probe')).body.roots[0].datedContract, 'ESZ26');
  assert.equal((await call('GET', '/futures/sources/schwab/capture')).body.native, true);
  assert.equal((await call('POST', '/futures/archive/imports')).body.error, 'futures_capture_not_needed');
  assert.ok(stack.every((l) => !Array.isArray(l.path)), 'no array mounts');
});
