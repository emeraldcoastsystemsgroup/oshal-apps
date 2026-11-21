/**
 * Guards for BACKLOG Item A: walk-forward wire signal benchmark and retirement of unused World ingest.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Initial — verify zero-lookahead walk-forward benchmark, honest negative result against Control, and zero-cost retirement of refreshWorld wire ingest.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const DATA_PATH = path.join(__dirname, 'walk-forward-wire-signal-data.json');
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

function loadRefreshWithCountingStubs() {
  const calls = { worldSvc: 0, ingestFeeds: 0 };
  const stubs = {
    '@/shared/logger': { createChildLogger: () => quiet },
    '@/features/world-data': {
      createWorldIntelligenceService: () => { calls.worldSvc += 1; return {}; },
      ingestFeeds: async () => { calls.ingestFeeds += 1; return { perSource: [{ fetched: 5, newItems: 2 }] }; },
    },
  };
  const resolved = require.resolve('../routes/sports-refresh.js');
  delete require.cache[resolved];
  const orig = Module._load;
  Module._load = function stubbed(request, ...rest) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return orig.call(this, request, ...rest);
  };
  try {
    return { refresh: require('../routes/sports-refresh.js'), calls };
  } finally {
    Module._load = orig;
  }
}

test('pre-kickoff window strictly excludes same-day and post-game World buckets (zero lookahead)', async () => {
  const { indexDailyBuckets, preKickoffWindow } = await import('./walk-forward-wire-signal.mjs');
  const map = indexDailyBuckets([
    ['2026-10-08', 10, 0.10],
    ['2026-10-10', 10, 0.20],
    ['2026-10-11', 50, -0.99], // game day — MUST be excluded
    ['2026-10-12', 50, 0.99],  // day after — MUST be excluded
  ]);
  const w = preKickoffWindow(map, '2026-10-11T20:05:00.000Z', 7, 1);
  assert.equal(w.count, 20, 'only strictly prior UTC days enter the window');
  assert.equal(Math.round(w.mean * 1000) / 1000, 0.15);
  assert.throws(() => preKickoffWindow(map, '2026-10-11T20:05:00.000Z', 7, 0), /same-day leakage/);
});

test('walk-forward benchmark records honest negative result against Control', async () => {
  const { evaluateWireSignalWalkForward } = await import('./walk-forward-wire-signal.mjs');
  const out = evaluateWireSignalWalkForward(DATA_PATH);
  assert.equal(out.archiveAudit.completedSeasons2025.totalGames, 1942);
  assert.equal(out.archiveAudit.completedSeasons2025.gamesWithWorldItems, 0);
  const combined = Object.fromEntries(out.results.combined2026.map((r) => [r.id, r]));
  const nfl = Object.fromEntries(out.results.nfl2026.map((r) => [r.id, r]));
  assert.equal(combined.control.n, 20);
  assert.ok(combined['sent-delta-5'].brier >= combined.control.brier, 'de-biased sentiment delta does not beat Control Brier');
  assert.ok(combined['sent-delta-5'].mae >= combined.control.mae, 'de-biased sentiment delta does not beat Control MAE');
  assert.ok(combined['inj-burst'].brier > combined.control.brier, 'injury-wire burst worsens Control Brier');
  assert.ok(combined['inj-burst'].mae > combined.control.mae, 'injury-wire burst worsens Control MAE');
  assert.ok(nfl['raw-sent-5'].mae > nfl.control.mae, 'uncentered raw sentiment worsens NFL MAE');
  for (const row of out.results.combined2026) {
    assert.ok(row.pairedT > -1.5, `${row.id} shows no statistically meaningful Brier gain over Control (t=${row.pairedT})`);
  }
});

test('refreshWorld is retired: zero World service calls, zero ingestFeeds calls, zero SQL writes', async () => {
  const { refresh, calls } = loadRefreshWithCountingStubs();
  assert.equal(refresh.WORLD_WIRE_INGEST_RETIRED, true);
  const queries = [];
  const pool = { query: async (sql) => { queries.push(String(sql)); return { rows: [], rowCount: 0 }; } };
  const result = await refresh.refreshWorld(pool, 'person-1');
  assert.deepEqual(result, { subjects: 0, newItems: 0 });
  assert.equal(calls.worldSvc, 0, 'retired refreshWorld must not construct World Intelligence service');
  assert.equal(calls.ingestFeeds, 0, 'retired refreshWorld must not trigger feed ingest or classification');
  assert.deepEqual(queries, [], 'retired refreshWorld must not read or write sports_world_pulls');
  const compiled = fs.readFileSync(path.join(__dirname, '..', 'routes', 'sports-refresh.js'), 'utf8');
  assert.equal(compiled.includes('@/features/world-data'), false, 'compiled sports-refresh no longer imports world-data');
});
