/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise durable nightly idempotency, failure/retry, owner isolation and the real launcher matching-before-scoring contract without model calls.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verify distinct owner-only matching and mailbox activations, update-review wording and failed-control recovery.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const root = mkdtempSync(join(tmpdir(), 'career-nightly-'));
const corpusDb = join(root, 'corpus.db');
writeFileSync(corpusDb, 'fixture corpus');
const initialPublish = new Date('2026-10-25T23:30:00Z');
utimesSync(corpusDb, initialPublish, initialPublish);
const original = Module._load;
const priorEgress = process.env.OSHAL_EGRESS, priorMount = process.env.OSHAL_CAREER_OWNER_MOUNT;
process.env.OSHAL_EGRESS = 'kernel'; process.env.OSHAL_CAREER_OWNER_MOUNT = '1';
let launched = [], options, admission = { started: true };
Module._load = function(request, ...rest) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {} }) };
  if (request === './career-user-store') return { userPaths: sub => ({ userDir: join(root, sub), corpusDb }) };
  if (request === './career-engine-dispatch') return { runCareerCliAsync: async (pool, sub, args, env, opts) => {
    launched.push({ pool, sub, args, env }); options = opts;
    if (admission.started) opts.onRunStarted('nightly-fixture-run');
    return admission;
  } };
  return original.call(this, request, ...rest);
};
const nightly = require('../routes/career-nightly-match.js');
const profile = { titleTerms: ['Developer', 'Adjunct'], remoteOnly: false };
after(() => {
  Module._load = original;
  if (priorEgress === undefined) delete process.env.OSHAL_EGRESS; else process.env.OSHAL_EGRESS = priorEgress;
  if (priorMount === undefined) delete process.env.OSHAL_CAREER_OWNER_MOUNT; else process.env.OSHAL_CAREER_OWNER_MOUNT = priorMount;
  rmSync(root, { recursive: true, force: true });
});

test('a kept owner run matches before scoring, publishes success only on valid completion, and survives reload', async () => {
  const dir = join(root, 'owner'); mkdirSync(dir);
  let cursor = 0;
  const start = () => nightly.startNightlyMatching({}, 'owner', profile, async () => { cursor++; });
  assert.deepEqual(await start(), { started: true, runId: 'nightly-fixture-run' });
  assert.equal(launched[0].sub, 'owner');
  assert.deepEqual(launched[0].args, ['score-titles']);
  assert.equal(launched[0].env.CH_NIGHTLY_MATCH, '1');
  assert.equal(launched[0].env.CH_LIMIT, '50');
  assert.equal(launched[0].env.CH_FRESH_DAYS, '7');
  assert.equal(launched[0].env.CH_REMOTE_ONLY, '0');
  assert.equal(options.slot, 'score');
  assert.equal(options.captureStdout, true);
  assert.equal(options.timeoutMs, 30 * 60_000);
  assert.equal(nightly.readNightlyMatchReceipt(dir), null);
  await options.onComplete({ ok: false, stdout: '{"result":"failed","errorType":"RuntimeError"}' });
  assert.equal(cursor, 0);
  assert.equal(nightly.readNightlyMatchReceipt(dir), null);
  await options.onComplete({ ok: true, stdout: '{"result":"complete","keywordMatched":123,"scored":50,"skipped":0,"terms":2}' });
  assert.equal(cursor, 1);
  const receipt = nightly.readNightlyMatchReceipt(dir);
  assert.equal(receipt.keywordMatched, 123);
  assert.equal(receipt.scored, 50);
  assert.equal(statSync(join(dir, nightly.NIGHTLY_MATCH_FILE)).mode & 0o777, 0o600);
  assert.equal(nightly.readNightlyMatchReceipt(join(root, 'other-owner')), null);
  const count = launched.length;
  assert.deepEqual(await start(), { started: false, reason: 'up-to-date' });
  assert.equal(launched.length, count);
  delete require.cache[require.resolve('../routes/career-nightly-match.js')];
  const fresh = require('../routes/career-nightly-match.js');
  assert.equal(fresh.nightlyMatchDecision(dir, corpusDb).reason, 'up-to-date');
  writeFileSync(corpusDb, 'newly published fixture corpus');
  utimesSync(corpusDb, new Date(initialPublish.getTime()+60000), new Date(initialPublish.getTime()+60000));
  assert.equal(fresh.nightlyMatchDecision(dir, corpusDb).reason, 'daily-cooldown');
  utimesSync(corpusDb, new Date(initialPublish.getTime()+86400_000), new Date(initialPublish.getTime()+86400_000));
  assert.equal(fresh.nightlyMatchDecision(dir, corpusDb).reason, null, 'the next evening publication is due even after midday catch-up');
});

test('a receipt from an older match runs once more on the same corpus, then waits for the next publication', () => {
  const dir = join(root, 'older-match'); mkdirSync(dir);
  const file = join(dir, nightly.NIGHTLY_MATCH_FILE);
  const stat = statSync(corpusDb);
  const receipt = { version: 1, corpusVersion: `${Math.trunc(stat.mtimeMs)}:${stat.size}`, completedAt: new Date(Date.now() - 60_000).toISOString(), limit: 50, keywordMatched: 1, scored: 1, skipped: 0 };
  writeFileSync(file, JSON.stringify(receipt));
  assert.equal(nightly.nightlyMatchDecision(dir, corpusDb).reason, null, 'no contract: the match that wrote it reached fewer jobs');
  writeFileSync(file, JSON.stringify({ ...receipt, matchContract: nightly.NIGHTLY_MATCH_CONTRACT - 1 }));
  assert.equal(nightly.nightlyMatchDecision(dir, corpusDb).reason, null);
  writeFileSync(file, JSON.stringify({ ...receipt, matchContract: nightly.NIGHTLY_MATCH_CONTRACT }));
  assert.equal(nightly.nightlyMatchDecision(dir, corpusDb).reason, 'up-to-date');
});

test('malformed receipts and symlinks fail closed; missing titles and busy admission cannot consume success', async () => {
  const dir = join(root, 'invalid'); mkdirSync(dir);
  const file = join(dir, nightly.NIGHTLY_MATCH_FILE);
  writeFileSync(file, '{}');
  assert.throws(() => nightly.nightlyMatchDecision(dir, corpusDb));
  rmSync(file); symlinkSync(join(root, 'missing'), file);
  assert.throws(() => nightly.readNightlyMatchReceipt(dir)); rmSync(file);
  assert.deepEqual(await nightly.startNightlyMatching({}, 'invalid', { ...profile, titleTerms: [] }, async () => {}),
    { started: false, reason: 'no-title-profile' });
  admission = { started: false, limitReason: 'inflight' };
  assert.deepEqual(await nightly.startNightlyMatching({}, 'invalid', profile, async () => {}),
    { started: false, reason: 'score-in-flight' });
  assert.equal(existsSync(file), false);
  admission = { started: true };
  delete process.env.OSHAL_CAREER_OWNER_MOUNT;
  assert.equal((await nightly.startNightlyMatching({}, 'invalid', profile, async () => {})).reason, 'native-scheduler-required');
  process.env.OSHAL_CAREER_OWNER_MOUNT = '1';
});

test('a success receipt requires a valid bounded matching and scoring verdict', () => {
  for (const record of [ {}, { result: 'failed' }, { result: 'complete', scored: 51, skipped: 0, terms: 1, keywordMatched: 5 },
    { result: 'complete', scored: -1, skipped: 0, terms: 1, keywordMatched: 5 },
    { result: 'complete', scored: 1, skipped: 0, terms: 0, keywordMatched: 5 },
    { result: 'complete', scored: 1, skipped: 0, terms: 1 } ]) {
    assert.equal(nightly.nightlyMatchVerdict(JSON.stringify(record)), null);
  }
  assert.deepEqual(nightly.nightlyMatchVerdict('progress\n'+JSON.stringify({ result: 'complete', keywordMatched: 8, scored: 0, skipped: 0, terms: 2 })),
    { keywordMatched: 8, scored: 0, skipped: 0 });
});

test('a failed pass can name the engine error type, and only that', () => {
  assert.equal(nightly.nightlyMatchFailure('progress\n'+JSON.stringify({ result: 'failed', errorType: 'ValueError' })), 'ValueError');
  assert.equal(nightly.nightlyMatchFailure(JSON.stringify({ result: 'complete', scored: 1, skipped: 0, terms: 1, keywordMatched: 5 })), undefined);
  assert.equal(nightly.nightlyMatchFailure('{not json'), undefined);
  assert.equal(nightly.nightlyMatchFailure(undefined), undefined);
});

test('publication cycles follow Chicago evening boundaries across daylight saving changes', () => {
  const cycle = iso => nightly.nightlyPublicationCycle(Date.parse(iso));
  assert.equal(cycle('2026-10-26T23:59:00Z'), '2026-10-26');
  assert.equal(cycle('2026-10-26T22:59:00Z'), '2026-10-25');
  assert.equal(cycle('2026-10-26T23:00:00Z'), '2026-10-26');
  assert.equal(cycle('2026-11-02T23:59:00Z'), '2026-11-01');
  assert.equal(cycle('2026-11-03T00:00:00Z'), '2026-11-02');
});

test('the real launcher runs matching before scoring and cannot emit success after matching fails', () => {
  const launcher = readFileSync(new URL('../bin/oshal-jobhunter.js', import.meta.url), 'utf8');
  const start = launcher.indexOf('function corpusRuns('), end = launcher.indexOf('\n/**', start);
  const runs = vm.runInNewContext(launcher.slice(start, end)+'; corpusRuns("score-titles", [])');
  const code = runs[0][1];
  const fixture = join(root, 'python'); const module = join(fixture, 'jobhunter'); mkdirSync(module, { recursive: true });
  writeFileSync(join(module, '__init__.py'), '');
  writeFileSync(join(module, 'db.py'), 'def init_db(): pass\n');
  writeFileSync(join(module, 'match.py'), 'import os\ndef rescore_recent(days):\n assert days==14\n if os.environ.get("FIXTURE_FAIL"): raise RuntimeError("fixture failure")\n print("matched-before-score",flush=True)\n return 8\n');
  writeFileSync(join(module, 'score.py'), 'def score_batch(**kw):\n assert kw["limit"]==50 and kw["fresh_days"]==7 and kw["recent_first"] is True\n assert kw["title_any"]==["Developer","Adjunct"]\n print("scored-after-match",flush=True)\n return 2,0\n');
  const env = { ...process.env, PYTHONPATH: fixture, CH_NIGHTLY_MATCH: '1', CH_TITLES: 'Developer\nAdjunct', CH_LIMIT: '50', CH_FRESH_DAYS: '7' };
  const run = extra => spawnSync('python3', ['-c', code], { encoding: 'utf8', env: { ...env, ...extra } });
  const ok = run({}); assert.equal(ok.status, 0, ok.stderr);
  assert.ok(ok.stdout.indexOf('matched-before-score') < ok.stdout.indexOf('scored-after-match'));
  assert.equal(nightly.nightlyMatchVerdict(ok.stdout).keywordMatched, 8);
  const failed = run({ FIXTURE_FAIL: '1' }); assert.equal(failed.status, 1);
  assert.equal(nightly.nightlyMatchVerdict(failed.stdout), null);
  assert.doesNotMatch(failed.stdout, /scored-after-match/);
  const unbounded = run({ CH_LIMIT: '0' }); assert.equal(unbounded.status, 1);
  assert.doesNotMatch(unbounded.stdout, /matched-before-score/);
});

test('the manifest offers an owner schedule on the authorized scoring route without starting drafts', () => {
  const manifest = readFileSync(new URL('../oshal-app.yaml', import.meta.url), 'utf8');
  const block = manifest.slice(manifest.indexOf('schedules:\n'), manifest.indexOf('\nsurface:'));
  assert.match(block, /id: career-nightly-matches/);
  assert.match(block, /cron: "\*\/30 \* \* \* \*"/);
  assert.match(block, /runsAs: user/);
  assert.match(block, /timezone: America\/Chicago/);
  assert.match(block, /route: \/api\/career-hunter\/title-pass\/run-now/);
  assert.match(block, /body: \{ nightly: true \}/);
  assert.doesNotMatch(block, /enqueue|autoSubmit|draft/);
});

test('settings activates only the declared owner job and surfaces failed platform requests', async () => {
  const html = readFileSync(new URL('../tools/career-settings.html', import.meta.url), 'utf8');
  const code = html.slice(html.indexOf('async function readCareerJob('), html.indexOf("$('#nightlyEnable').onclick"));
  const nodes = new Map(); const $ = id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); };
  const calls = []; let refuse = false, missing = false, postRefuse = false, nightlyState = 'not-activated';
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if(postRefuse&&options?.method==='POST'){
      nightlyState='suspended';
      return {ok:false,json:async()=>({message:'Review the changed schedule'})};
    }
    return { ok: !refuse, json: async () => refuse ? { message: 'Owner activation refused' } : url.endsWith('/agent/schedules')
      ? { schedules: [{ id: 'other-app', name: 'career-nightly-matches', app: 'other' }, ...(missing ? [] : [
        { id: 'owner-job', name: 'career-nightly-matches', app: 'career-hunter', status: nightlyState },
        { id: 'owner-mail', name: 'career-application-updates', app: 'career-hunter', status: 'suspended', reason: 'deny_tier' },
      ])] }
      : { status: 'activated' } };
  };
  const api = new Function('$','fetch','toast','refreshTitles',code+'\nreturn {readNightlyJob,refreshNightlyJob,changeNightlyJob,refreshMailJob,changeMailJob};')($,fetch,()=>{},async()=>{});
  await api.changeNightlyJob('activate');
  const post = calls.find(c => c.options?.method === 'POST');
  assert.equal(post.url, '/api/v1/agent/schedules/owner-job/activate');
  assert.deepEqual(JSON.parse(post.options.body), { class: 'person' });
  assert.equal(Object.hasOwn(JSON.parse(post.options.body), 'userSub'), false);
  calls.length = 0;
  await api.refreshMailJob();
  assert.match($('#mailJobState').textContent, /Paused for review/);
  assert.doesNotMatch($('#mailJobState').textContent, /deny_tier/);
  assert.equal($('#mailRun').disabled, true);
  assert.equal($('#mailEnable').disabled, false);
  await api.changeMailJob('activate');
  const mailPost = calls.find(c => c.options?.method === 'POST');
  assert.equal(mailPost.url, '/api/v1/agent/schedules/owner-mail/activate');
  assert.deepEqual(JSON.parse(mailPost.options.body), { class: 'person' });
  nightlyState='active';
  await api.refreshNightlyJob();
  assert.equal($('#nightlyEnable').disabled,true);
  postRefuse=true;
  await api.changeNightlyJob('trigger');
  assert.match($('#nightlyJobState').textContent,/Paused for review.*Review the changed schedule/);
  assert.equal($('#nightlyEnable').disabled,false,'a refused trigger exposes fresh activation immediately');
  assert.equal($('#nightlyRun').disabled,true);
  postRefuse=false;
  calls.length = 0; refuse = true;
  await api.changeNightlyJob('trigger');
  assert.match($('#nightlyJobState').textContent, /Owner activation refused/);
  assert.equal($('#nightlyEnable').disabled,true,'unknown authority never leaves stale controls active');
  assert.equal(calls.some(c => c.options?.method === 'POST'), false);
  await api.changeMailJob('trigger');
  assert.match($('#mailJobState').textContent, /Owner activation refused/);
  assert.equal(calls.some(c => c.options?.method === 'POST'), false);
  refuse = false; missing = true; calls.length = 0;
  await api.changeNightlyJob('activate');
  assert.match($('#nightlyJobState').textContent, /not registered/);
  assert.equal(calls.some(c => c.options?.method === 'POST'), false);
  await api.changeMailJob('activate');
  assert.match($('#mailJobState').textContent, /not registered/);
  assert.equal(calls.some(c => c.options?.method === 'POST'), false);
});
