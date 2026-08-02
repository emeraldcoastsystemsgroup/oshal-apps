/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial guard for the bake-off recommendation: spec validation/clamping, cost-known tracking, rank-with-reasons, and the five fail-closed blocks (no results, mixed judge modes, no qualifying lane, a field of one, a failed-but-cheap lane). These are the tests that matter because the only way this app can hurt someone is by confidently recommending a lane the evidence does not support.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install) over the
 * COMPILED pure module — the same bytes the running framework requires at mount.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const S = require(path.join(PKG, 'routes', 'bake-off-scoring.js'));

const {
  BAKE_OFF_DEFAULTS, BAKE_OFF_LIMITS, JUDGE_MODE_LEXICAL, JUDGE_MODE_LLM,
  buildReport, judgeModeConsensus, laneKey, normalizeRubric, projectSaving,
  rankLanes, recommendLane, summarizeResult, validateJobSpec,
} = S;

/** A lane result row as the engine persists it. `cost` is DOLLARS per run. */
function row(over) {
  return Object.assign({
    laneBot: 'lane-bot', laneAgentId: 'a-1', laneHarness: 'claude-code', laneProvider: 'claude-code',
    observedModel: 'test-model', ok: true, costUsd: 0.02, totalTokens: 1200, durationMs: 4000,
    judgeScore: 85, judgeMode: JUDGE_MODE_LLM, error: null,
  }, over || {});
}

/** Two-plus lanes, all LLM-graded, all clearing a 70 bar — the shape a real run should have. */
function healthyLanes() {
  return [
    row({ laneBot: 'alpha', laneAgentId: 'a', costUsd: 0.10, judgeScore: 92 }),
    row({ laneBot: 'bravo', laneAgentId: 'b', laneHarness: 'codex-cli', laneProvider: 'openai-codex', costUsd: 0.02, judgeScore: 81 }),
    row({ laneBot: 'charlie', laneAgentId: 'c', laneHarness: 'gemini-cli', laneProvider: 'gemini', costUsd: 0.05, judgeScore: 88 }),
  ].map(summarizeResult);
}

// ── Defaults and spec validation ─────────────────────────────────────────────

test('defaults are the stated posture: a 70 bar, 100 runs/month, at most 8 lanes', () => {
  assert.equal(BAKE_OFF_DEFAULTS.qualityBar, 70);
  assert.equal(BAKE_OFF_DEFAULTS.monthlyVolume, 100);
  assert.equal(BAKE_OFF_DEFAULTS.maxLanes, 8);
  assert.ok(BAKE_OFF_DEFAULTS.rubric.length >= 3, 'the default rubric must separate lanes on more than one axis');
});

test('a prompt too short to differentiate lanes is refused, not silently raced', () => {
  const r = validateJobSpec({ name: 'j', prompt: 'summarize' });
  assert.equal(r.ok, false);
  assert.match(r.error, /at least 20 characters/);
});

test('name is required', () => {
  assert.equal(validateJobSpec({ prompt: 'x'.repeat(40) }).ok, false);
});

test('an empty rubric is an error, never a silent fallback to the default', () => {
  // A caller who sent [] meant something; replacing it would grade against criteria they never chose.
  const r = validateJobSpec({ name: 'j', prompt: 'x'.repeat(40), rubric: [] });
  assert.equal(r.ok, false);
  assert.match(r.error, /rubric/);
  // Omitting the key entirely IS the way to take the default.
  const d = validateJobSpec({ name: 'j', prompt: 'x'.repeat(40) });
  assert.equal(d.ok, true);
  assert.deepEqual(d.spec.rubric, [...BAKE_OFF_DEFAULTS.rubric]);
});

test('normalizeRubric trims, drops blanks, caps, and rejects a non-array', () => {
  assert.deepEqual(normalizeRubric(['  a  ', '', '   ', 'b']), ['a', 'b']);
  assert.equal(normalizeRubric('accuracy'), null);
  assert.equal(normalizeRubric([]), null);
  assert.equal(normalizeRubric(Array.from({ length: 40 }, (_, i) => `c${i}`)).length, BAKE_OFF_LIMITS.rubricMax);
});

test('economics are clamped, not rejected — a fat-fingered bar still yields a bake-off', () => {
  const r = validateJobSpec({ name: 'j', prompt: 'x'.repeat(40), qualityBar: 900, monthlyVolume: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.spec.qualityBar, 100);
  assert.equal(r.spec.monthlyVolume, 1);
  const neg = validateJobSpec({ name: 'j', prompt: 'x'.repeat(40), qualityBar: -5 });
  assert.equal(neg.spec.qualityBar, 0);
});

test('lane subset is capped at maxLanes so an old job cannot start racing twenty lanes', () => {
  const ids = Array.from({ length: 30 }, (_, i) => `agent-${i}`);
  const r = validateJobSpec({ name: 'j', prompt: 'x'.repeat(40), laneAgentIds: ids });
  assert.equal(r.spec.laneAgentIds.length, BAKE_OFF_DEFAULTS.maxLanes);
});

// ── Cost is known or it is not ───────────────────────────────────────────────

test('a $0 cost reading is UNKNOWN cost, never free cost', () => {
  const zero = summarizeResult(row({ costUsd: 0 }));
  assert.equal(zero.costKnown, false, 'zero must not be treated as a bargain — capture failed');
  const nul = summarizeResult(row({ costUsd: null }));
  assert.equal(nul.costKnown, false);
  const neg = summarizeResult(row({ costUsd: -3 }));
  assert.equal(neg.costKnown, false);
  assert.equal(neg.costUsd, 0, 'a negative cost is floored, not propagated');
  assert.equal(summarizeResult(row({ costUsd: 0.02 })).costKnown, true);
});

test('a failed lane has no known cost even if it reported one', () => {
  assert.equal(summarizeResult(row({ ok: false, costUsd: 0.5 })).costKnown, false);
});

test('sub-cent per-run costs survive rounding', () => {
  // Cents-rounding would floor a $0.0004 lane to $0 and make it look like capture failed.
  const s = summarizeResult(row({ costUsd: 0.0004 }));
  assert.equal(s.costUsd, 0.0004);
  assert.equal(s.costKnown, true);
});

test('laneKey identifies a lane by bot x harness / provider, not by model', () => {
  assert.equal(laneKey(row({ laneBot: 'alpha' })), 'alpha·claude-code/claude-code');
  // The observed model must not leak into identity — it changes under you between runs.
  assert.equal(laneKey(row({ laneBot: 'alpha', observedModel: 'something-else' })), 'alpha·claude-code/claude-code');
});

// ── Ranking and rejection reasons ────────────────────────────────────────────

test('rejection reasons are single and specific', () => {
  const lanes = [
    row({ laneBot: 'broke', laneAgentId: '1', ok: false, error: 'boom' }),
    row({ laneBot: 'weak', laneAgentId: '2', judgeScore: 40 }),
    row({ laneBot: 'freeish', laneAgentId: '3', costUsd: 0 }),
    row({ laneBot: 'good', laneAgentId: '4', costUsd: 0.03 }),
  ].map(summarizeResult);
  const { qualifying, rejected } = rankLanes(lanes, 70);
  assert.deepEqual(qualifying.map((l) => l.bot), ['good']);
  assert.deepEqual(
    rejected.map((r) => [r.bot, r.reason]),
    [['broke', 'lane-failed'], ['weak', 'below-quality-bar'], ['freeish', 'cost-unknown']],
  );
});

test('a broken lane is reported as broken even when it would also have missed the bar', () => {
  const [only] = rankLanes([summarizeResult(row({ ok: false, judgeScore: 0 }))], 70).rejected;
  assert.equal(only.reason, 'lane-failed');
});

test('qualifying lanes are ordered cheapest-first, ties broken by higher score', () => {
  const lanes = [
    row({ laneBot: 'a', laneAgentId: '1', costUsd: 0.05, judgeScore: 80 }),
    row({ laneBot: 'b', laneAgentId: '2', costUsd: 0.01, judgeScore: 75 }),
    row({ laneBot: 'c', laneAgentId: '3', costUsd: 0.05, judgeScore: 95 }),
  ].map(summarizeResult);
  assert.deepEqual(rankLanes(lanes, 70).qualifying.map((l) => l.bot), ['b', 'c', 'a']);
});

// ── Judge-mode consensus ─────────────────────────────────────────────────────

test('judge-mode consensus ignores failed lanes when deciding whether a run is mixed', () => {
  const lanes = [
    row({ laneAgentId: '1', judgeMode: JUDGE_MODE_LLM }),
    row({ laneAgentId: '2', ok: false, judgeMode: null }),
  ].map(summarizeResult);
  assert.equal(judgeModeConsensus(lanes), JUDGE_MODE_LLM, 'a lane that never ran cannot make a run "mixed"');
  assert.equal(judgeModeConsensus([]), 'none');
});

// ── The five blocks ──────────────────────────────────────────────────────────

test('BLOCK: mixed grading instruments produce no recommendation at all', () => {
  const lanes = [
    row({ laneBot: 'judged', laneAgentId: '1', costUsd: 0.10, judgeScore: 90, judgeMode: JUDGE_MODE_LLM }),
    row({ laneBot: 'proxied', laneAgentId: '2', costUsd: 0.01, judgeScore: 95, judgeMode: JUDGE_MODE_LEXICAL }),
  ].map(summarizeResult);
  const rec = recommendLane(lanes, { qualityBar: 70, monthlyVolume: 100 });
  assert.equal(rec.blocked, 'mixed-judge-modes');
  assert.equal(rec.winner, null, 'the cheap high-scoring lane must NOT win — its score came from another instrument');
  assert.equal(rec.monthlySavingUsd, null);
  assert.match(rec.caveats[0], /not comparable/i);
});

test('BLOCK: no lane clearing the bar means no winner, not the least-bad lane', () => {
  const lanes = [
    row({ laneBot: 'a', laneAgentId: '1', judgeScore: 55 }),
    row({ laneBot: 'b', laneAgentId: '2', judgeScore: 69, costUsd: 0.001 }),
  ].map(summarizeResult);
  const rec = recommendLane(lanes, { qualityBar: 70, monthlyVolume: 100 });
  assert.equal(rec.blocked, 'no-qualifying-lane');
  assert.equal(rec.winner, null);
  assert.match(rec.caveats[0], /do not pick the least-bad lane/i);
});

test('BLOCK: one qualifying lane is not a comparison', () => {
  const lanes = [
    row({ laneBot: 'only', laneAgentId: '1', judgeScore: 90 }),
    row({ laneBot: 'weak', laneAgentId: '2', judgeScore: 30 }),
  ].map(summarizeResult);
  const rec = recommendLane(lanes, { qualityBar: 70, monthlyVolume: 100 });
  assert.equal(rec.blocked, 'insufficient-lanes');
  assert.equal(rec.winner, null);
  assert.equal(rec.baseline.bot, 'only', 'the lone lane is still reported, just not recommended');
});

test('BLOCK: nothing ran', () => {
  const rec = recommendLane([], { qualityBar: 70, monthlyVolume: 100 });
  assert.equal(rec.blocked, 'no-results');
  assert.equal(rec.judgeMode, 'none');
});

test('a cheap FAILED lane can never become the winner', () => {
  const lanes = [
    row({ laneBot: 'cheapfail', laneAgentId: '1', ok: false, costUsd: 0.0001, judgeScore: 99, error: 'timeout' }),
    row({ laneBot: 'good-a', laneAgentId: '2', costUsd: 0.08, judgeScore: 90 }),
    row({ laneBot: 'good-b', laneAgentId: '3', costUsd: 0.04, judgeScore: 80 }),
  ].map(summarizeResult);
  const rec = recommendLane(lanes, { qualityBar: 70, monthlyVolume: 100 });
  assert.equal(rec.blocked, null);
  assert.equal(rec.winner.bot, 'good-b');
  assert.ok(rec.caveats.some((c) => /lane\(s\) failed/.test(c)), 'the failure must be surfaced, not dropped');
});

test('a $0-cost lane is excluded from the savings math and named in the caveats', () => {
  const lanes = [
    row({ laneBot: 'nocost', laneAgentId: '1', costUsd: 0, judgeScore: 95 }),
    row({ laneBot: 'a', laneAgentId: '2', costUsd: 0.10, judgeScore: 92 }),
    row({ laneBot: 'b', laneAgentId: '3', costUsd: 0.02, judgeScore: 80 }),
  ].map(summarizeResult);
  const rec = recommendLane(lanes, { qualityBar: 70, monthlyVolume: 100 });
  assert.equal(rec.winner.bot, 'b');
  assert.ok(rec.caveats.some((c) => /cost capture failed/.test(c)));
});

// ── The happy path and the money ─────────────────────────────────────────────

test('the winner is the cheapest qualifying lane, measured against the highest-scoring one', () => {
  const rec = recommendLane(healthyLanes(), { qualityBar: 70, monthlyVolume: 1000 });
  assert.equal(rec.blocked, null);
  assert.equal(rec.winner.bot, 'bravo', 'cheapest that clears the bar');
  assert.equal(rec.baseline.bot, 'alpha', 'the lane you would use if you only cared about quality');
  assert.equal(rec.perRunSavingUsd, 0.08);
  assert.equal(rec.monthlySavingUsd, 80);
  assert.equal(rec.judgeMode, JUDGE_MODE_LLM);
});

test('every recommendation carries the sample-size caveat', () => {
  const rec = recommendLane(healthyLanes(), { qualityBar: 70, monthlyVolume: 100 });
  assert.ok(rec.caveats.some((c) => /probe, not a benchmark/i.test(c)));
});

test('a lexical-fallback-only run reports, but is labelled a smoke test', () => {
  const lanes = healthyLanes().map((l) => ({ ...l, judgeMode: JUDGE_MODE_LEXICAL }));
  const rec = recommendLane(lanes, { qualityBar: 70, monthlyVolume: 100 });
  assert.equal(rec.blocked, null);
  assert.equal(rec.judgeMode, JUDGE_MODE_LEXICAL);
  assert.ok(rec.caveats.some((c) => /smoke test/i.test(c)));
});

test('when the best lane is already the cheapest, the saving is zero and it says so', () => {
  const lanes = [
    row({ laneBot: 'best-and-cheapest', laneAgentId: '1', costUsd: 0.01, judgeScore: 95 }),
    row({ laneBot: 'pricier', laneAgentId: '2', costUsd: 0.09, judgeScore: 80 }),
  ].map(summarizeResult);
  const rec = recommendLane(lanes, { qualityBar: 70, monthlyVolume: 500 });
  assert.equal(rec.winner.bot, 'best-and-cheapest');
  assert.equal(rec.baseline.bot, 'best-and-cheapest');
  assert.equal(rec.monthlySavingUsd, 0);
  assert.ok(rec.caveats.some((c) => /nothing to switch/i.test(c)));
});

test('savings are floored at zero and scale by volume', () => {
  assert.deepEqual(projectSaving(0.10, 0.02, 100), { perRunSavingUsd: 0.08, monthlySavingUsd: 8 });
  assert.deepEqual(projectSaving(0.02, 0.10, 100), { perRunSavingUsd: 0, monthlySavingUsd: 0 });
  assert.equal(projectSaving(1, 0, 1000000).monthlySavingUsd, 1000000);
});

test('buildReport assembles the same verdict the surface and the bot both read', () => {
  const rows = [
    row({ laneBot: 'alpha', laneAgentId: 'a', costUsd: 0.10, judgeScore: 92 }),
    row({ laneBot: 'bravo', laneAgentId: 'b', costUsd: 0.02, judgeScore: 81 }),
  ];
  const report = buildReport(rows, { qualityBar: 70, monthlyVolume: 100 });
  assert.equal(report.lanes.length, 2);
  assert.equal(report.qualifying.length, 2);
  assert.equal(report.rejected.length, 0);
  assert.equal(report.recommendation.winner.bot, 'bravo');
  // One assembly point: the table's cheapest qualifying lane IS the recommendation's winner.
  assert.equal(report.qualifying[0].laneKey, report.recommendation.winner.laneKey);
});

test('buildReport survives an empty or absent row set', () => {
  assert.equal(buildReport([], { qualityBar: 70, monthlyVolume: 100 }).recommendation.blocked, 'no-results');
  assert.equal(buildReport(undefined, { qualityBar: 70, monthlyVolume: 100 }).lanes.length, 0);
});
