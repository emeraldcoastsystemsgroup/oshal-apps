/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Settled nightly scoring: the engine half through the shipped launcher (career-nightly-settled-contract.py: the rule, the measured night, the order, the time budget and the off switch against 1.63.0's recorded night), and the route half: the settings and their bounds, the off switch's command inputs and receipt exactly 1.63.0's, the version-2 receipt, a night continued by the next half-hourly checks until its time is spent, and receipts that fail closed.
 */
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const root = mkdtempSync(join(tmpdir(), 'career-nightly-settled-'));
const corpusDb = join(root, 'corpus.db');
writeFileSync(corpusDb, 'fixture corpus');
const published = new Date('2026-11-14T07:10:00Z');
utimesSync(corpusDb, published, published);
const original = Module._load;
const saved = { egress: process.env.OSHAL_EGRESS, mount: process.env.OSHAL_CAREER_OWNER_MOUNT };
process.env.OSHAL_EGRESS = 'kernel'; process.env.OSHAL_CAREER_OWNER_MOUNT = '1';
const SETTINGS = ['CAREER_NIGHTLY_SETTLE', 'CAREER_NIGHTLY_LIMIT', 'CAREER_NIGHTLY_CONCURRENCY', 'CAREER_NIGHTLY_BAND', 'CAREER_NIGHTLY_BUDGET_MINUTES'];
let launched = [], options;
Module._load = function(request, ...rest) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {} }) };
  if (request === './career-user-store') return { userPaths: sub => ({ userDir: join(root, sub), corpusDb }) };
  if (request === './career-engine-dispatch') return { runCareerCliAsync: async (pool, sub, args, env, opts) => {
    launched.push({ sub, args, env }); options = opts; opts.onRunStarted('settled-fixture-run');
    return { started: true };
  } };
  return original.call(this, request, ...rest);
};
const nightly = require('../routes/career-nightly-match.js');
const settled = require('../routes/career-nightly-settled.js');
const profile = { titleTerms: ['Data Engineer', 'Engineer'], remoteOnly: false };
const OLD_ENV = { CH_TITLES: 'Data Engineer\nEngineer', CH_LIMIT: '50', CH_FRESH_DAYS: '7', CH_REMOTE_ONLY: '0', CH_NIGHTLY_MATCH: '1' };
after(() => {
  Module._load = original;
  for (const [key, value] of [['OSHAL_EGRESS', saved.egress], ['OSHAL_CAREER_OWNER_MOUNT', saved.mount]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  for (const key of SETTINGS) delete process.env[key];
  rmSync(root, { recursive: true, force: true });
});
beforeEach(() => { launched = []; for (const key of SETTINGS) delete process.env[key]; });

const line = (counts) => JSON.stringify({ result: 'complete', mode: 'settled', scored: 0, undecided: 0, unreadable: 0,
  failed: 0, notReached: 0, candidates: 0, calls: 0, seconds: 0, stoppedForTime: false, limit: 400, terms: 2,
  keywordMatched: 0, ...counts });
const owner = (name) => { const dir = join(root, name); mkdirSync(dir); return dir; };
const start = (name) => nightly.startNightlyMatching({}, name, profile, async () => {});

test('the engine half: rule, measured night, order, time budget and the off switch against 1.63.0', () => {
  const launcher = readFileSync(new URL('../bin/oshal-jobhunter.js', import.meta.url), 'utf8');
  const begin = launcher.indexOf('function corpusRuns('), end = launcher.indexOf('\n/**', begin);
  const code = vm.runInNewContext(launcher.slice(begin, end) + ';corpusRuns("score-titles",[])')[0][1];
  const out = spawnSync(process.env.CAREER_PYTHON || 'python3',
    [fileURLToPath(new URL('./career-nightly-settled-contract.py', import.meta.url))],
    { input: JSON.stringify({ code }), encoding: 'utf8', timeout: 300000 });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stderr, /Ran 13 tests/);
});

test('switched off, the nightly command inputs and the receipt are exactly 1.63.0\'s', async () => {
  const dir = owner('off');
  for (const value of [undefined, '0', 'true', 'yes', ' 2']) {
    if (value === undefined) delete process.env.CAREER_NIGHTLY_SETTLE; else process.env.CAREER_NIGHTLY_SETTLE = value;
    assert.equal(settled.nightlySettledSettings(), null, String(value));
  }
  delete process.env.CAREER_NIGHTLY_SETTLE;
  process.env.CAREER_NIGHTLY_LIMIT = '900';  // a setting without the switch changes nothing
  assert.deepEqual(await start('off'), { started: true, runId: 'settled-fixture-run' });
  assert.deepEqual(launched[0].env, OLD_ENV);
  assert.deepEqual(Object.keys(launched[0].env), Object.keys(OLD_ENV));
  assert.equal(options.timeoutMs, 30 * 60_000);
  await options.onComplete({ ok: true, stdout: '{"result":"complete","scored":12,"skipped":3,"terms":2,"keywordMatched":40}' });
  const receipt = JSON.parse(readFileSync(join(dir, nightly.NIGHTLY_MATCH_FILE), 'utf8'));
  assert.deepEqual(Object.keys(receipt), ['version', 'matchContract', 'corpusVersion', 'completedAt', 'limit', 'keywordMatched', 'scored', 'skipped']);
  assert.deepEqual({ ...receipt, completedAt: 'x' }, { version: 1, matchContract: 3, corpusVersion: receipt.corpusVersion,
    completedAt: 'x', limit: 50, keywordMatched: 40, scored: 12, skipped: 3 });
  assert.equal(statSync(join(dir, nightly.NIGHTLY_MATCH_FILE)).mode & 0o777, 0o600);
  assert.equal(nightly.nightlyMatchVerdict(line({ scored: 60 })), null, 'the 1.63.0 reader never accepts a settled line');
  assert.deepEqual(await start('off'), { started: false, reason: 'up-to-date' });
});

test('switched on, a night runs in kept runs of at most 20 minutes until its hour is spent', async () => {
  const dir = owner('on');
  process.env.CAREER_NIGHTLY_SETTLE = '1';
  assert.deepEqual(settled.nightlySettledSettings(), { limit: 400, concurrency: 3, band: 6, budgetSeconds: 3600 });
  await start('on');
  assert.deepEqual(launched[0].env, { ...OLD_ENV, CH_LIMIT: '400', CH_SETTLE: '1', CH_CONCURRENCY: '3', CH_BAND: '6', CH_BUDGET_SECONDS: '1200' });
  assert.equal(options.timeoutMs, 30 * 60_000, 'the kept run is still asked for 1800 s, the kernel limit');
  await options.onComplete({ ok: true, stdout: '   25/170  (20 scored)\n' + line({ scored: 150, undecided: 12, unreadable: 6, failed: 2,
    notReached: 900, calls: 520, seconds: 1190, stoppedForTime: true, keywordMatched: 3500 }) });
  let receipt = nightly.readNightlyMatchReceipt(dir);
  assert.deepEqual({ ...receipt, completedAt: 'x' }, { version: 2, matchContract: 3, mode: 'settled', corpusVersion: receipt.corpusVersion,
    completedAt: 'x', limit: 400, budgetSeconds: 3600, usedSeconds: 1190, runs: 1, keywordMatched: 3500, scored: 150,
    undecided: 12, unreadable: 6, failed: 2, notReached: 900, calls: 520, continues: true });
  assert.deepEqual(await start('on'), { started: true, runId: 'settled-fixture-run' }, 'the next check continues the night');
  assert.equal(launched[1].env.CH_LIMIT, '230', 'the night has 400 - 170 jobs left');
  assert.equal(launched[1].env.CH_BUDGET_SECONDS, '1200');
  await options.onComplete({ ok: true, stdout: line({ scored: 160, undecided: 10, notReached: 730, calls: 530, seconds: 1195, stoppedForTime: true }) });
  receipt = nightly.readNightlyMatchReceipt(dir);
  assert.deepEqual([receipt.runs, receipt.usedSeconds, receipt.scored, receipt.undecided, receipt.calls, receipt.continues],
    [2, 2385, 310, 22, 1050, true]);
  await start('on');
  assert.deepEqual([launched[2].env.CH_LIMIT, launched[2].env.CH_BUDGET_SECONDS], ['60', '1200']);
  await options.onComplete({ ok: true, stdout: line({ scored: 55, undecided: 5, notReached: 670, calls: 190, seconds: 700, stoppedForTime: false }) });
  receipt = nightly.readNightlyMatchReceipt(dir);
  assert.deepEqual([receipt.runs, receipt.scored, receipt.notReached, receipt.continues], [3, 365, 670, false],
    'the night\'s 400 jobs are reached: what is left waits for the next night');
  assert.deepEqual(await start('on'), { started: false, reason: 'up-to-date' });
});

test('a night stops continuing when less than two minutes of its time are left, and a new cycle starts afresh', async () => {
  const dir = owner('spent');
  process.env.CAREER_NIGHTLY_SETTLE = '1'; process.env.CAREER_NIGHTLY_BUDGET_MINUTES = '21';
  await start('spent');
  assert.equal(launched[0].env.CH_BUDGET_SECONDS, '1200');
  await options.onComplete({ ok: true, stdout: line({ scored: 9, notReached: 50, seconds: 1200, stoppedForTime: true }) });
  assert.equal(nightly.readNightlyMatchReceipt(dir).continues, false, '1260 - 1200 = 60 s left');
  assert.deepEqual(await start('spent'), { started: false, reason: 'up-to-date' });
  delete process.env.CAREER_NIGHTLY_BUDGET_MINUTES;
  writeFileSync(join(dir, nightly.NIGHTLY_MATCH_FILE), JSON.stringify({ ...nightly.readNightlyMatchReceipt(dir), continues: true }));
  const next = new Date(published.getTime() + 86400_000);
  utimesSync(corpusDb, next, next);
  try {
    assert.deepEqual(await start('spent'), { started: true, runId: 'settled-fixture-run' });
    assert.deepEqual([launched[1].env.CH_LIMIT, launched[1].env.CH_BUDGET_SECONDS], ['400', '1200'], 'the next night has all of its own');
    await options.onComplete({ ok: true, stdout: line({ scored: 3, seconds: 20 }) });
    assert.deepEqual([nightly.readNightlyMatchReceipt(dir).runs, nightly.readNightlyMatchReceipt(dir).scored], [1, 3]);
  } finally {
    utimesSync(corpusDb, published, published);
  }
});

test('a receipt of one mode read by the other is a finished night', async () => {
  const on = owner('on-then-off');
  process.env.CAREER_NIGHTLY_SETTLE = '1';
  await start('on-then-off');
  await options.onComplete({ ok: true, stdout: line({ scored: 9, notReached: 50, seconds: 1190, stoppedForTime: true }) });
  assert.equal(nightly.readNightlyMatchReceipt(on).continues, true);
  delete process.env.CAREER_NIGHTLY_SETTLE;
  assert.deepEqual(await start('on-then-off'), { started: false, reason: 'up-to-date' }, 'switched off: no continuation');
  owner('off-then-on');
  await start('off-then-on');
  await options.onComplete({ ok: true, stdout: '{"result":"complete","scored":50,"skipped":0,"terms":2,"keywordMatched":4}' });
  process.env.CAREER_NIGHTLY_SETTLE = '1';
  assert.deepEqual(await start('off-then-on'), { started: false, reason: 'up-to-date' }, 'switched on: from the next publication');
});

test('the settled count line and the version-2 receipt fail closed', () => {
  assert.equal(settled.settledVerdict(line({ scored: 300, undecided: 50, unreadable: 30, failed: 20 }), 400).scored, 300);
  for (const bad of [line({ scored: 401 }), line({ scored: 200, undecided: 201 }), line({ mode: undefined }), line({ terms: 0 }),
    line({ notReached: -1 }), line({ stoppedForTime: 'no' }), line({ seconds: 1.5 }), '{"result":"failed","errorType":"ValueError"}']) {
    assert.equal(settled.settledVerdict(bad, 400), null, bad);
  }
  const dir = owner('malformed');
  const stat = statSync(corpusDb);
  const good = { version: 2, matchContract: 3, mode: 'settled', corpusVersion: `${Math.trunc(stat.mtimeMs)}:${stat.size}`,
    completedAt: new Date(Date.now() - 60_000).toISOString(), limit: 400, budgetSeconds: 3600, usedSeconds: 100, runs: 1,
    keywordMatched: 1, scored: 1, undecided: 0, unreadable: 0, failed: 0, notReached: 0, calls: 3, continues: false };
  const file = join(dir, nightly.NIGHTLY_MATCH_FILE);
  writeFileSync(file, JSON.stringify(good));
  assert.equal(nightly.readNightlyMatchReceipt(dir).scored, 1);
  for (const change of [{ mode: 'other' }, { runs: 0 }, { continues: 1 }, { scored: 401 }, { limit: 2001 }, { calls: -1 }, { version: 3 }]) {
    writeFileSync(file, JSON.stringify({ ...good, ...change }));
    assert.throws(() => nightly.readNightlyMatchReceipt(dir), /unavailable/, JSON.stringify(change));
  }
});

test('settings are clamped to their bounds and anything unreadable keeps its default', () => {
  const on = (env) => settled.nightlySettledSettings({ CAREER_NIGHTLY_SETTLE: '1', ...env });
  assert.deepEqual(on({ CAREER_NIGHTLY_LIMIT: '9000', CAREER_NIGHTLY_CONCURRENCY: '8', CAREER_NIGHTLY_BAND: '40', CAREER_NIGHTLY_BUDGET_MINUTES: '600' }),
    { limit: 2000, concurrency: 3, band: 15, budgetSeconds: 240 * 60 });
  assert.deepEqual(on({ CAREER_NIGHTLY_LIMIT: '0', CAREER_NIGHTLY_CONCURRENCY: '0', CAREER_NIGHTLY_BAND: '0', CAREER_NIGHTLY_BUDGET_MINUTES: '1' }),
    { limit: 1, concurrency: 1, band: 0, budgetSeconds: 300 });
  assert.deepEqual(on({ CAREER_NIGHTLY_LIMIT: 'lots', CAREER_NIGHTLY_CONCURRENCY: '-2', CAREER_NIGHTLY_BAND: '6.5' }),
    { limit: 400, concurrency: 3, band: 6, budgetSeconds: 3600 });
  assert.deepEqual(settled.settledRunInputs({ limit: 400, concurrency: 2, band: 4, budgetSeconds: 600 }),
    { CH_SETTLE: '1', CH_LIMIT: '400', CH_CONCURRENCY: '2', CH_BAND: '4', CH_BUDGET_SECONDS: '600' });
});
