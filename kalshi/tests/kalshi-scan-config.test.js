/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-30 04:45:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial guard for the always-on scan: config layering + per-scope authority + clamping, the manifest-is-the-config contract (every knob must be declared in oshal-app.yaml), snapshot freshness, the alert gate (floors, first-seen dedup, top-N, daily budget), and two structural checks that the scan can never crawl back onto the request path.
 * 2026-09-04 23:40:00 | roger.murphy@emeraldcoastsystemsgroup.com   | summarizeAlertRecord: settled-only counting, null rates until decided, P&L averaged over graded rows only; and a structural check that the compiled listAlerts/alertRecord really join kalshi_predictions on SCAN_STRATEGY (the outcome column is only as real as that join).
 * 2026-09-04 23:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | contrarianExtremeRow: the rule as pre-registered (inclusive .90/.10 threshold, flip priced at 1 - our bid from the spread, +.10 claim capped at .99, zero stake, no-bid/edge-of-book refusals, fee rounding matches the engine) and a structural check that the compiled scan really registers CONTRARIAN_EXTREME_STRATEGY rows right after its own.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install) over the
 * COMPILED pure module — the same bytes the running framework requires.
 *
 * Why these are the tests that matter: the bug this feature fixes was a 23-second scan on the
 * request path, and the ways it can regress are (a) the routes importing the scan again,
 * (b) a settings row silently disabling or hammering the cadence, and (c) an hourly loop
 * re-announcing the same hand until its owner stops reading alerts.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const cfg = require(path.join(PKG, 'routes', 'kalshi-scan-config.js'));

const {
  KALSHI_SCAN_DEFAULTS, SCOPE_OF, clampScanConfig, formatAlert, keysForScope,
  manifestConfigDefaults, resolveScanConfig, scanFreshness, scopedPatch, selectAlertHands,
  summarizeAlertRecord,
  CONTRARIAN_EXTREME_STRATEGY, CONTRARIAN_EXTREME_MIN_PROB, CONTRARIAN_CLAIMED_OVERPRICING,
  contrarianExtremeRow, quadraticFeePerContract,
} = cfg;

/** A hand as the evaluator emits it (edgeNet is DOLLARS; the alert floor is cents). */
function hand(over) {
  return Object.assign({
    ticker: 'KXTEST-26JUL30-A', eventTicker: 'KXTEST-26JUL30', title: 'A test market',
    side: 'yes', category: 'Economics', price: 0.55, trueProb: 0.62, edgeNet: 0.05,
    stakeFraction: 0.01, strength: 'strong', riskFlags: [], closeTime: null,
  }, over || {});
}

test('defaults are the operator-stated posture: hourly, jarvis on, outward off', () => {
  assert.equal(KALSHI_SCAN_DEFAULTS.scanIntervalMinutes, 60);
  assert.equal(KALSHI_SCAN_DEFAULTS.scanEnabled, true);
  assert.equal(KALSHI_SCAN_DEFAULTS.notifyJarvis, true);
  // Outward delivery must never default on — an hourly job may not start texting on its own.
  assert.equal(KALSHI_SCAN_DEFAULTS.notifyOutward, false);
});

test('config layers: manifest beats code, deployment beats manifest, user beats both (own keys)', () => {
  const resolved = resolveScanConfig([
    { patch: { scanIntervalMinutes: 30, alertTopN: 9 }, scope: 'any' },
    { patch: { scanIntervalMinutes: 15 }, scope: 'deployment' },
    { patch: { alertTopN: 2 }, scope: 'user' },
  ]);
  assert.equal(resolved.scanIntervalMinutes, 15);
  assert.equal(resolved.alertTopN, 2);
});

test('scope authority is enforced in both directions', () => {
  // A user row must not be able to change how often the DEPLOYMENT scans...
  const a = resolveScanConfig([{ patch: { scanIntervalMinutes: 5 }, scope: 'user' }]);
  assert.equal(a.scanIntervalMinutes, KALSHI_SCAN_DEFAULTS.scanIntervalMinutes);
  // ...and a deployment row must not mute one person's alert thresholds.
  const b = resolveScanConfig([{ patch: { alertMinEdgeCents: 40, notifyJarvis: false }, scope: 'deployment' }]);
  assert.equal(b.alertMinEdgeCents, KALSHI_SCAN_DEFAULTS.alertMinEdgeCents);
  assert.equal(b.notifyJarvis, true);
});

test('bad values clamp instead of stopping the scan', () => {
  assert.equal(clampScanConfig({ scanIntervalMinutes: 0 }).scanIntervalMinutes, 5);
  assert.equal(clampScanConfig({ scanIntervalMinutes: 99999 }).scanIntervalMinutes, 1440);
  assert.equal(clampScanConfig({ scanIntervalMinutes: 'soon' }).scanIntervalMinutes, 60);
  assert.equal(clampScanConfig({ alertMinStrength: 'legendary' }).alertMinStrength, 'playable');
  assert.equal(clampScanConfig({ scanEnabled: 'false' }).scanEnabled, false);
  assert.equal(clampScanConfig({ notifyOutward: 'yes' }).notifyOutward, true);
});

test('scopedPatch stores only the keys that scope owns, clamped', () => {
  const stored = scopedPatch({ scanIntervalMinutes: 2, alertTopN: 3 }, 'deployment');
  assert.deepEqual(Object.keys(stored), ['scanIntervalMinutes']);
  assert.equal(stored.scanIntervalMinutes, 5); // clamped up from 2
  assert.deepEqual(Object.keys(scopedPatch({ notifyJarvis: false, scanEnabled: false }, 'user')), ['notifyJarvis']);
});

test('every scan knob is DECLARED IN THE MANIFEST (the yaml is the config, not decoration)', () => {
  // Deliberately a text scan, not a YAML parse: this suite must stay dependency-free. It proves
  // the contract the operator asked for — a new knob that only exists in code fails here.
  const yaml = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  const schemaBlock = yaml.slice(yaml.indexOf('\nsettings:'));
  assert.ok(schemaBlock.includes('schema:'), 'manifest must declare settings.schema');
  for (const key of Object.keys(SCOPE_OF)) {
    const start = schemaBlock.indexOf(`\n    ${key}:`);
    assert.ok(start >= 0, `manifest is missing settings.schema.${key}`);
    // Bound the entry to THIS key's own indented block — up to the next 4-space key (or the end of
    // the block). Slicing a fixed number of characters instead let a key inherit the NEXT key's
    // `scope:` line, so deleting a scope declaration passed this test (caught by mutation, 04:55).
    const rest = schemaBlock.slice(start + 1);
    const nextKey = rest.slice(1).search(/\n {4}\S/);
    const entry = nextKey >= 0 ? rest.slice(0, nextKey + 1) : rest;
    assert.ok(/\n\s{6}default:/.test(entry), `settings.schema.${key} needs a default`);
    assert.ok(new RegExp(`\\n\\s{6}scope: ${SCOPE_OF[key]}\\b`).test(entry),
      `settings.schema.${key} must declare scope: ${SCOPE_OF[key]}`);
  }
});

test('manifestConfigDefaults reads defaults and tolerates a mangled entry', () => {
  const patch = manifestConfigDefaults({
    settings: { schema: { scanIntervalMinutes: { default: 120 }, alertTopN: { label: 'no default here' } } },
  });
  assert.deepEqual(patch, { scanIntervalMinutes: 120 });
  assert.deepEqual(manifestConfigDefaults(null), {});
  assert.deepEqual(manifestConfigDefaults({ settings: {} }), {});
});

test('freshness: no snapshot is stale, and nextRunAt follows the cadence', () => {
  const conf = clampScanConfig({ scanIntervalMinutes: 60, staleAfterMinutes: 180 });
  const none = scanFreshness(null, conf, 1_000_000);
  assert.equal(none.stale, true);
  assert.equal(none.ageSeconds, null);
  const at = new Date('2026-07-30T04:00:00.000Z');
  const fresh = scanFreshness(at.toISOString(), conf, at.getTime() + 10 * 60_000);
  assert.equal(fresh.ageSeconds, 600);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.nextRunAt, '2026-07-30T05:00:00.000Z');
  assert.equal(scanFreshness(at.toISOString(), conf, at.getTime() + 200 * 60_000).stale, true);
});

test('alert gate: strength floor, edge floor, ordering and top-N', () => {
  const conf = clampScanConfig({ alertMinStrength: 'strong', alertMinEdgeCents: 3, alertTopN: 2 });
  const hands = [
    hand({ ticker: 'WEAK', strength: 'playable', edgeNet: 0.09 }),   // below the strength floor
    hand({ ticker: 'THIN', strength: 'strong', edgeNet: 0.029 }),    // 2.9¢ — below the edge floor
    hand({ ticker: 'GOOD', strength: 'strong', edgeNet: 0.04 }),
    hand({ ticker: 'BEST', strength: 'monster', edgeNet: 0.08 }),
    hand({ ticker: 'ALSO', strength: 'strong', edgeNet: 0.05 }),
  ];
  const out = selectAlertHands(hands, conf, [], 0);
  assert.equal(out.suppressed, null);
  assert.deepEqual(out.hands.map((h) => h.ticker), ['BEST', 'ALSO']); // biggest edge first, capped at 2
});

test('alert gate: a hand is announced ONCE (first-seen dedup by ticker)', () => {
  const conf = clampScanConfig({});
  const hands = [hand({ ticker: 'SEEN' }), hand({ ticker: 'NEW' })];
  const out = selectAlertHands(hands, conf, ['SEEN'], 0);
  assert.deepEqual(out.hands.map((h) => h.ticker), ['NEW']);
  // Nothing new at all → an explicit reason, never an empty "sent" claim.
  assert.equal(selectAlertHands(hands, conf, ['SEEN', 'NEW'], 0).suppressed, 'no-new-hands');
});

test('alert gate: the daily budget and the notify switches suppress before selection', () => {
  const conf = clampScanConfig({ alertMaxPerDay: 2 });
  assert.equal(selectAlertHands([hand({})], conf, [], 2).suppressed, 'daily-budget');
  const off = clampScanConfig({ notifyJarvis: false, notifyOutward: false });
  assert.equal(selectAlertHands([hand({})], off, [], 0).suppressed, 'notify-off');
  // alertMaxPerDay: 0 is a real "mute" value, not a fall-through to the default.
  assert.equal(selectAlertHands([hand({})], clampScanConfig({ alertMaxPerDay: 0 }), [], 0).suppressed, 'daily-budget');
});

test('alert gate FAILS CLOSED when the ledger or the budget cannot be read', () => {
  // The regression this pins: v1 returned a SENTINEL STRING inside the dedup set and called itself
  // "fail closed". No real ticker matches a sentinel, so one DB blip would have re-announced every
  // hand the user had ever been told about. Unknown dedup state must mean NO alert, not every alert.
  const conf = clampScanConfig({});
  const hands = [hand({ ticker: 'A' }), hand({ ticker: 'B' })];
  assert.deepEqual(selectAlertHands(hands, conf, null, 0), { hands: [], suppressed: 'ledger-unavailable' });
  assert.deepEqual(selectAlertHands(hands, conf, undefined, 0), { hands: [], suppressed: 'ledger-unavailable' });
  assert.deepEqual(selectAlertHands(hands, conf, [], null), { hands: [], suppressed: 'budget-unavailable' });
  // A sentinel-style set must NOT be mistaken for "everything is new" either.
  assert.equal(selectAlertHands(hands, conf, ['A', 'B'], 0).hands.length, 0);
});

test('alert copy states the unproven posture and never reads as an instruction to bet', () => {
  const msg = formatAlert([hand({ ticker: 'KXA-1', title: 'Some market' })], { evaluable: 6, mayStake: false });
  assert.match(msg.subject, /Kalshi/);
  assert.match(msg.body, /CANDIDATES/);
  assert.match(msg.body, /stake stays 0%/);
  assert.match(msg.body, /Nothing has been ordered/);
  assert.match(msg.body, /KXA-1/);
  assert.ok(msg.shortText.length <= 160, `sms line too long: ${msg.shortText.length}`);
});

test('the scan can never crawl back onto the request path (structural)', () => {
  const routes = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-routes.js'), 'utf8');
  for (const banned of ['listMarketsFiltered', 'rankHands', 'getSeriesMeta']) {
    assert.ok(!routes.includes(banned),
      `kalshi-routes must not touch ${banned} — the feed walk belongs to the background poller`);
  }
  assert.ok(routes.includes('readSnapshot'), 'GET /scan must serve the stored snapshot');
  assert.ok(routes.includes('startKalshiScanCron'), 'the poller must start from the app route factory');
});

test('the poller really notifies Jarvis and honours the audience gate (structural)', () => {
  const cron = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-scan-cron.js'), 'utf8');
  assert.ok(cron.includes('saveTaskPending') && cron.includes('finishTask'),
    'new hands must land in the user jarvis_tasks feed');
  assert.ok(cron.includes('alertAudience'), 'alerts must be limited to users who actually have Kalshi set up');
  const engine = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-scan-engine.js'), 'utf8');
  assert.ok(engine.includes("provider = 'kalshi'"), 'the audience is derived from real Kalshi connections');
});

test('keysForScope partitions every knob exactly once', () => {
  const all = keysForScope('deployment').concat(keysForScope('user')).sort();
  assert.deepEqual(all, Object.keys(SCOPE_OF).sort());
});

test('the poller cannot run for a toggled-off app, and cannot double-scan a deployment', () => {
  const cron = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-scan-cron.js'), 'utf8');
  const engine = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-scan-engine.js'), 'utf8');
  // Routes unmount on deactivate; a setInterval does not. Without this check a switched-off app
  // kept scanning AND alerting — the ADR-085 P0 runaway, and the opposite of "only if you have
  // the application".
  // Assert on the CALL, not the substring: renaming the helper to `appIsActiveRenamedAway` kept a
  // naive includes('appIsActive') green (caught by mutation, 05:55). These match the compiled
  // call form `(0, mod.appIsActive)(ctx.pool)` and break the moment the call goes away.
  assert.match(cron, /\.appIsActive\)\s*\(/, 'the tick must CALL appIsActive, not merely mention it');
  assert.match(cron, /paused/, 'an inactive app must park the poller, not just skip silently');
  assert.ok(engine.includes('swarm_applications'), 'active-ness comes from the loader table, not a local flag');
  // Per-process single-flight cannot see another process. The lease is what makes the
  // "no double-scan" claim true rather than aspirational.
  assert.match(cron, /\.withScanLease\)\s*\(/, 'a cycle must RUN under the deployment-wide lease');
  assert.ok(engine.includes('pg_try_advisory_lock') && engine.includes('pg_advisory_unlock'),
    'the lease must be a real advisory lock, taken and released');
  assert.ok(cron.includes('globalThis'), 'the started flag must survive a require-cache bust');
});

test('a failed cycle backs off, and manual runs are throttled', () => {
  const cron = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-scan-cron.js'), 'utf8');
  assert.ok(/nextAttemptAfter/.test(cron), 'a dead upstream must not mean a 60-page attempt every minute');
  assert.ok(/BACKOFF_MAX_MS|BACKOFF_BASE_MS/.test(cron), 'the backoff must be bounded');
  const routes = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-routes.js'), 'utf8');
  assert.ok(routes.includes('manualRunAllowed') && routes.includes('429'),
    'POST /scan/run is open to any signed-in user — it must be rate-limited, and say so with 429');
  assert.ok(routes.includes('Retry-After'), 'a 429 must tell the caller when to come back');
});

test('the daily budget counts ANNOUNCEMENTS, not hands', () => {
  const engine = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-scan-engine.js'), 'utf8');
  // One announcement writes one ledger row per hand (up to alertTopN), so counting rows made
  // `alertMaxPerDay: 6` behave like "6 hands/day" ≈ one announcement.
  assert.ok(/count\(DISTINCT/i.test(engine), 'alertsSentToday must count distinct batches');
  assert.ok(engine.includes('batch_id'), 'alerts must carry the batch id the budget counts');
  const cron = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-scan-cron.js'), 'utf8');
  assert.ok(cron.includes('randomUUID'), 'each announcement needs its own batch id');
});

test('the dedup read is bounded and the ledger is pruned', () => {
  const engine = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-scan-engine.js'), 'utf8');
  assert.ok(/DEDUP_WINDOW_DAYS/.test(engine), 'the dedup read must be windowed, not "every row ever"');
  assert.ok(engine.includes('pruneAlertLedger'), 'the ledger needs a retention path');
});

test('a settings read failure never silently re-enables a scan an operator switched off', () => {
  const engine = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-scan-engine.js'), 'utf8');
  // scanEnabled DEFAULTS TO TRUE, so falling back to defaults on a read error would restart a
  // scan the operator had explicitly turned off.
  assert.ok(engine.includes('lastGoodSettings'), 'a failed settings read must reuse the last known row');
});

test('every element the surface script reaches for actually exists in the HTML', () => {
  // The dnd lane lost a whole feature to exactly this: a script referenced ids the served document
  // never had, and nothing failed loudly. This suite has no DOM, so it checks the contract
  // statically — every $('id') and getElementById('id') must match an id="..." in the markup.
  const html = fs.readFileSync(path.join(PKG, 'tools', 'kalshi.html'), 'utf8');
  const declared = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const referenced = new Set([
    ...[...html.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]),
    ...[...html.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]),
  ]);
  const missing = [...referenced].filter((id) => !declared.has(id));
  assert.deepEqual(missing, [], `surface script references ids that do not exist: ${missing.join(', ')}`);
  // And the panels the new tabs switch to must exist, or the tab is a dead button.
  for (const panel of ['scan', 'account', 'scorecard', 'trends', 'alerts', 'settings']) {
    assert.ok(html.includes(`data-panel="${panel}"`), `missing tab panel: ${panel}`);
    assert.ok(html.includes(`data-tab="${panel}"`), `missing tab button: ${panel}`);
  }
});

/* ── The win/loss record (operator, 2026-09-04: "where is the win loss record") ─────────── */
test('the alert record counts only settled rows; open markets are open, not losses', () => {
  const rec = summarizeAlertRecord([
    { settled: true, won: true, pnl_per_contract: '0.40' },
    { settled: true, won: false, pnl_per_contract: -0.05 },
    { settled: true, won: false, pnl_per_contract: '-0.10' },
    { settled: false, won: null, pnl_per_contract: null },
    { settled: null },
    {},
  ]);
  assert.equal(rec.alerted, 6);
  assert.equal(rec.settled, 3);
  assert.equal(rec.wins, 1);
  assert.equal(rec.losses, 2);
  assert.equal(rec.open, 3);
  assert.ok(Math.abs(rec.hitRate - 1 / 3) < 1e-12);
  assert.ok(Math.abs(rec.pnlPerContract - (0.40 - 0.05 - 0.10) / 3) < 1e-12);
  assert.ok(Math.abs(rec.pnlTotal - 0.25) < 1e-12);
});

test('a record with nothing decided reports null rates, never a 0% that reads as "always wrong"', () => {
  const empty = summarizeAlertRecord([]);
  assert.deepEqual(empty, { alerted: 0, settled: 0, wins: 0, losses: 0, open: 0, hitRate: null, pnlPerContract: null, pnlTotal: null });
  const open = summarizeAlertRecord([{ settled: false }, { settled: false }]);
  assert.equal(open.open, 2);
  assert.equal(open.hitRate, null);
  assert.equal(open.pnlPerContract, null);
});

test('a settled row without a grade is settled but neither a win nor a loss, and P&L averages graded rows only', () => {
  const rec = summarizeAlertRecord([
    { settled: true, won: null, pnl_per_contract: null },
    { settled: true, won: true, pnl_per_contract: 0.5 },
  ]);
  assert.equal(rec.settled, 2);
  assert.equal(rec.wins, 1);
  assert.equal(rec.losses, 0);
  assert.equal(rec.hitRate, 1);
  assert.equal(rec.pnlPerContract, 0.5);
});

test('the compiled alert reads really join the ledger to the graded predictions on the scan strategy', () => {
  const engine = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-scan-engine.js'), 'utf8');
  const listStart = engine.indexOf('async function listAlerts(');
  const recordStart = engine.indexOf('async function alertRecord(');
  assert.ok(listStart >= 0 && recordStart > listStart, 'listAlerts then alertRecord must both be compiled');
  const list = engine.slice(listStart, recordStart);
  const record = engine.slice(recordStart, recordStart + 1200);
  for (const fn of [list, record]) {
    assert.match(fn, /LEFT JOIN kalshi_predictions p ON p\.ticker = a\.ticker AND p\.strategy = \$\d/);
    assert.match(fn, /CASE WHEN p\.settled THEN \(\(p\.side = 'yes'\) = p\.settled_yes\) END AS won/);
    assert.match(fn, /SCAN_STRATEGY/);
  }
  assert.match(record, /summarizeAlertRecord\)\(rows\)/);
});

/* ── The pre-registered contrarian hypothesis (operator, 2026-09-04) ───────────────────────── */
test('an extreme favorite flips to the other side at 1 - our bid, claimed +.10, stake zero', () => {
  // We say 95% on YES at 93c with a 2c spread -> our bid 91c -> the NO ask is 9c.
  const row = contrarianExtremeRow(hand({ side: 'yes', price: 0.93, trueProb: 0.95, spread: 0.02, closeTime: '2026-09-06T00:00:00.000Z' }));
  assert.ok(row);
  assert.equal(row.strategy, CONTRARIAN_EXTREME_STRATEGY);
  assert.equal(row.side, 'no');
  assert.equal(row.marketProb, 0.09);
  assert.ok(Math.abs(row.predictedProb - 0.19) < 1e-12);
  assert.equal(row.stakeFraction, 0);
  assert.equal(row.seriesTicker, 'KXTEST');
  assert.equal(row.eventTicker, 'KXTEST-26JUL30');
  assert.equal(row.closeTime, '2026-09-06T00:00:00.000Z');
  // fee on a 9c contract: ceil(0.07*10*0.09*0.91*100)/100/10 = 0.006
  assert.ok(Math.abs(quadraticFeePerContract(0.09) - 0.006) < 1e-12);
  assert.ok(Math.abs(row.edgeNet - (0.19 - 0.09 - 0.006)) < 1e-12);
  assert.deepEqual(row.rationale, {
    flippedFrom: 'calibration', rule: 'trueProb >= 0.9 or <= 0.1', ourSide: 'yes', ourProb: 0.95,
    ourAsk: 0.93, ourBid: 0.91, spread: 0.02, claimedOverpricing: CONTRARIAN_CLAIMED_OVERPRICING,
  });
});

test('an extreme longshot flips to the favorite, and the claim is capped at .99', () => {
  // We say 5% on YES at 6c with a 3c spread -> our bid 3c -> the NO ask is 97c -> claim capped at 99%.
  const row = contrarianExtremeRow(hand({ side: 'yes', price: 0.06, trueProb: 0.05, spread: 0.03 }));
  assert.ok(row);
  assert.equal(row.side, 'no');
  assert.equal(row.marketProb, 0.97);
  assert.equal(row.predictedProb, 0.99);
  assert.ok(row.edgeNet > 0 && row.edgeNet < 0.02);
});

test('the threshold is inclusive at .90 / .10 and nothing in between registers', () => {
  assert.equal(CONTRARIAN_EXTREME_MIN_PROB, 0.9);
  assert.ok(contrarianExtremeRow(hand({ trueProb: 0.90, price: 0.85, spread: 0.02 })));
  assert.ok(contrarianExtremeRow(hand({ trueProb: 0.10, price: 0.12, spread: 0.02 })));
  assert.equal(contrarianExtremeRow(hand({ trueProb: 0.89, price: 0.85, spread: 0.02 })), null);
  assert.equal(contrarianExtremeRow(hand({ trueProb: 0.11, price: 0.12, spread: 0.02 })), null);
  assert.equal(contrarianExtremeRow(hand({ trueProb: 0.62, price: 0.55, spread: 0.02 })), null);
});

test('no bid means no flip price: spread 1 / missing spread / bid <= 0 / edge-of-book asks all refuse', () => {
  assert.equal(contrarianExtremeRow(hand({ trueProb: 0.95, price: 0.93, spread: 1 })), null);
  assert.equal(contrarianExtremeRow(hand({ trueProb: 0.95, price: 0.93 })), null);
  assert.equal(contrarianExtremeRow(hand({ trueProb: 0.95, price: 0.02, spread: 0.02 })), null);
  // our bid 0.005 -> flip ask 0.995 -> unusable
  assert.equal(contrarianExtremeRow(hand({ trueProb: 0.05, price: 0.01, spread: 0.005 })), null);
  assert.equal(contrarianExtremeRow(hand({ trueProb: NaN, price: 0.93, spread: 0.02 })), null);
});

test('a NO hand flips to YES', () => {
  const row = contrarianExtremeRow(hand({ side: 'no', price: 0.92, trueProb: 0.94, spread: 0.04 }));
  assert.equal(row.side, 'yes');
  assert.equal(row.marketProb, 0.12);
  assert.equal(row.rationale.ourSide, 'no');
});

test('the compiled scan registers the contrarian sibling right after its own predictions, immutably', () => {
  const engine = fs.readFileSync(path.join(PKG, 'routes', 'kalshi-scan-engine.js'), 'utf8');
  assert.match(engine, /await recordScanPredictions\(pool, hands\);\s*\r?\n\s*await recordContrarianPredictions\(pool, hands\);/);
  const start = engine.indexOf('async function recordContrarianPredictions(');
  assert.ok(start >= 0);
  const fn = engine.slice(start, start + 1400);
  assert.match(fn, /contrarianExtremeRow\)\(h\)/);
  assert.match(fn, /CONTRARIAN_EXTREME_STRATEGY/);
  assert.match(fn, /ON CONFLICT \(strategy, ticker\) DO NOTHING/);
  assert.match(fn, /row\.stakeFraction/);
});
