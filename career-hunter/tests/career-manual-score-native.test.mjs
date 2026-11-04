/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The Job Board's Find & score button, read from the page, reaches the bounded pass in the background with matching first; the real launcher runs matching before scoring within those bounds; an installation's CAREER_BUILD_LIMIT keeps its own run.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Exercise actual saved-title reads, bounded native title dispatch, strict terminal receipts and real pre-inference candidate selection.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove native manual score acknowledgement, cross-request owner status, count-only receipts, truthful cancellation and Settings progress without models or real engine children.
 */
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const receipt = require('../lib/career-manual-score.js');
const registry = require('../lib/career-engine-runs.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-manual-score-'));
const savedMode = process.env.OSHAL_EGRESS;
process.env.OSHAL_EGRESS = 'kernel';
const RUN_A = '11111111-1111-4111-8111-111111111111';
const RUN_B = '22222222-2222-4222-8222-222222222222';
let invocation, startResult, status, statusFailure, gate, remoteOnly, cancelResult, cancelled, titleTerms, profileFailure;
const scoreOutput = (scored, skipped = 0, terms = 2) => JSON.stringify({result:'complete',scored,skipped,terms,keywordMatched:0});

const originalLoad = Module._load;
Module._load = function loadNativeScoreLeaves(request, ...rest) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  if (request === '@/shared/middleware/authz') return { getTrustedServiceUserSub: () => null };
  if (request === './career-company-routes') return { isCareerAdmin: () => false };
  if (request === './career-match-prefs') return { readRemoteOnly: async (_pool, userSub) => { assert.equal(userSub, 'owner-a'); return remoteOnly; } };
  if (request === './career-user-store') return {
    callerSub: req => req.userSub, userPaths: sub => ({ userDir: path.join(root, sub) }),
    listStoreUsers: () => [], openUserDb: () => null,
  };
  if (request === './career-engine-dispatch') return {
    runCareerCliAwait: () => { throw new Error('Native manual scoring must not await the engine'); },
    runCareerCliAsync: async (_pool, userSub, args, env, options) => {
      invocation = { userSub, args, env, options };
      options?.onRunStarted?.(RUN_A);
      if (gate) await gate;
      return startResult;
    },
  };
  if (request === './career-engine-runner') return {
    nativeEngineRunStatus: async () => { if (statusFailure) throw new Error('fixture status outage'); return status; },
    cancelNativeEngineRun: async runId => { cancelled.push(runId); return cancelResult; },
  };
  return originalLoad.call(this, request, ...rest);
};
const routes = require('../routes/career-run-routes.js');
after(() => {
  Module._load = originalLoad;
  if (savedMode === undefined) delete process.env.OSHAL_EGRESS; else process.env.OSHAL_EGRESS = savedMode;
  fs.rmSync(root, { recursive: true, force: true });
});
beforeEach(() => {
  for (const sub of ['owner-a', 'owner-b']) fs.rmSync(path.join(root, sub), { recursive: true, force: true });
  invocation = undefined; startResult = { started: true }; gate = null; remoteOnly = true;
  status = { runs: [{ runId: RUN_A }], canCancel: false }; statusFailure = false;
  cancelResult = 'unavailable'; cancelled = [];
  titleTerms = ['Adjunct Business Instructor','Desktop Support']; profileFailure = false;
});

function handlers() {
  const found = new Map();
  routes.registerCareerRunRoutes({ get: (p, h) => found.set('GET ' + p, h), post: (p, h) => found.set('POST ' + p, h) }, { pool: {
    query: async (sql, params) => {
      assert.match(sql,/SELECT title_terms/);
      assert.deepEqual(params,['owner-a']);
      if (profileFailure) throw new Error('fixture settings unavailable');
      return {rows:[{title_terms:[...titleTerms],title_terms_source:'user',remote_only:remoteOnly}]};
    },
  } });
  return found;
}
function response() {
  return { statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
async function call(method, request = {}) {
  const res = response();
  await handlers().get(method)({ userSub: 'owner-a', params: {}, ...request }, res);
  return res;
}

test('native Score now acknowledges only an accepted kept start and preserves bounded owner selectors', async () => {
  let release;
  gate = new Promise(resolve => { release = resolve; });
  const res = response();
  const pending = handlers().get('POST /run/:verb')({ userSub: 'owner-a', params: { verb: 'score' }, body: { userSub: 'owner-b' } }, res);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(res.body, undefined);
  release(); await pending;
  assert.deepEqual(res.body, { ok: true, started: true, state: 'running', runId: RUN_A, limit: 50, freshDays: 7 });
  assert.equal(res.statusCode, 202);
  assert.equal(invocation.userSub, 'owner-a');
  assert.deepEqual(invocation.args, ['score-titles']);
  assert.deepEqual(invocation.env, {CH_TITLES:'Adjunct Business Instructor\nDesktop Support',CH_LIMIT:'50',CH_FRESH_DAYS:'7',CH_REMOTE_ONLY:'1'});
  assert.equal(invocation.options.slot, 'score');
  assert.equal(invocation.options.timeoutMs, 1800000);
  assert.equal(invocation.options.captureStdout, true);
});

/** The route the Job Board's button posts to, read from the page rather than restated here. */
function boardVerb() {
  const board = fs.readFileSync(new URL('../tools/career-board.html', import.meta.url), 'utf8');
  const start = board.indexOf('async function buildBoard(){');
  const urls = [...board.slice(start, board.indexOf('// The onboarding gate', start)).matchAll(/fetch\('\/api\/career-hunter\/run\/(\w+)'/g)].map(match => match[1]);
  assert.equal(urls.length, 1, 'the button starts one run and never awaits a match in the page');
  return urls[0];
}

test('the Job Board button starts the bounded pass in the background with matching first and keeps a receipt', async () => {
  const res = await call('POST /run/:verb', { params: { verb: boardVerb() }, body: { limit: 5000 } });
  assert.equal(res.statusCode, 202);
  assert.deepEqual(res.body, { ok: true, started: true, state: 'running', runId: RUN_A, limit: 50, freshDays: 7 });
  assert.deepEqual(invocation.args, ['score-titles']);
  assert.deepEqual(invocation.env, { CH_TITLES: 'Adjunct Business Instructor\nDesktop Support', CH_LIMIT: '50', CH_FRESH_DAYS: '7', CH_REMOTE_ONLY: '1', CH_BOARD_MATCH: '1' });
  assert.equal(invocation.options.slot, 'score');
  assert.equal(invocation.options.timeoutMs, 1800000);
  await invocation.options.onComplete({ ok: false, stdout: JSON.stringify({ result: 'complete', scored: 2, skipped: 0, terms: 2, keywordMatched: 9 }) });
  assert.equal(receipt.read(path.join(root, 'owner-a')), null);
  await invocation.options.onComplete({ ok: true, stdout: JSON.stringify({ result: 'complete', scored: 2, skipped: 1, terms: 2, keywordMatched: 9 }) });
  const kept = receipt.read(path.join(root, 'owner-a'));
  assert.deepEqual([kept.runId, kept.scored, kept.skipped, kept.limit], [RUN_A, 2, 1, 50]);
});

test('the Job Board button refuses without usable saved titles and names what to do', async () => {
  titleTerms = [];
  const empty = await call('POST /run/:verb', { params: { verb: boardVerb() } });
  assert.equal(empty.statusCode, 409);
  assert.equal(empty.body.reason, 'no-title-profile');
  assert.match(empty.body.error, /Save target job titles/);
  assert.equal(invocation, undefined);
  titleTerms = ['Adjunct']; profileFailure = true;
  assert.equal((await call('POST /run/:verb', { params: { verb: boardVerb() } })).statusCode, 503);
  assert.equal(invocation, undefined);
});

test('a plain manual pass still refuses a terminal line that claims matching', () => {
  const line = JSON.stringify({ result: 'complete', scored: 1, skipped: 0, terms: 2, keywordMatched: 4 });
  assert.equal(receipt.verdict(line, 2, 2), null);
  assert.deepEqual(receipt.verdict(line, 2, 2, true), { scored: 1, skipped: 0 });
  for (const keywordMatched of [undefined, -1, 1.5, '4']) {
    assert.equal(receipt.verdict(JSON.stringify({ result: 'complete', scored: 1, skipped: 0, terms: 2, keywordMatched }), 2, 2, true), null);
  }
});

test('an installation that set CAREER_BUILD_LIMIT keeps its own run on the native kernel; nonsense is no bound', async () => {
  const saved = process.env.CAREER_BUILD_LIMIT;
  try {
    process.env.CAREER_BUILD_LIMIT = '25';
    const demo = await call('POST /run/:verb', { params: { verb: boardVerb() } });
    assert.equal(demo.statusCode, 202);
    assert.deepEqual(invocation.args, ['build-board', '--min-keyword', '40', '--limit', '25', '--workers', '2', '--remote-only']);
    process.env.CAREER_BUILD_LIMIT = 'nonsense';
    await call('POST /run/:verb', { params: { verb: boardVerb() } });
    assert.deepEqual(invocation.args, ['score-titles']);
  } finally {
    if (saved === undefined) delete process.env.CAREER_BUILD_LIMIT; else process.env.CAREER_BUILD_LIMIT = saved;
  }
});

test('the real launcher matches over 45 days before a bounded title pass and never reports success after a failed match', () => {
  const launcher = fs.readFileSync(new URL('../bin/oshal-jobhunter.js', import.meta.url), 'utf8');
  const start = launcher.indexOf('function corpusRuns('), end = launcher.indexOf('\n/**', start);
  const code = vm.runInNewContext(launcher.slice(start, end) + '; corpusRuns("score-titles",[])')[0][1];
  const fixture = path.join(root, 'launcher-fixture', 'jobhunter');
  fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(path.join(fixture, '__init__.py'), '');
  fs.writeFileSync(path.join(fixture, 'db.py'), 'def init_db(): pass\n');
  fs.writeFileSync(path.join(fixture, 'match.py'), 'import os\ndef rescore_recent(days):\n assert days==45\n if os.environ.get("FIXTURE_FAIL"): raise RuntimeError("fixture failure")\n print("matched-first",flush=True)\n return 8\n');
  fs.writeFileSync(path.join(fixture, 'score.py'), 'def score_batch(**kw):\n assert kw["limit"]==50 and kw["fresh_days"]==7 and kw["title_any"]==["Adjunct","Support"]\n print("scored-second",flush=True)\n return 2,0\n');
  const run = extra => spawnSync(process.env.CAREER_TEST_PYTHON || 'python3', ['-c', code], { encoding: 'utf8', timeout: 20000,
    env: { ...process.env, PYTHONPATH: path.dirname(fixture), CH_BOARD_MATCH: '1', CH_TITLES: 'Adjunct\nSupport', CH_LIMIT: '50', CH_FRESH_DAYS: '7', ...extra } });
  const ok = run({});
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(ok.stdout.indexOf('matched-first') < ok.stdout.indexOf('scored-second'));
  assert.deepEqual(receipt.verdict(ok.stdout, 50, 2, true), { scored: 2, skipped: 0 });
  const failed = run({ FIXTURE_FAIL: '1' });
  assert.equal(failed.status, 1);
  assert.doesNotMatch(failed.stdout, /scored-second/);
  assert.equal(receipt.verdict(failed.stdout, 50, 2, true), null);
  for (const CH_LIMIT of ['0', '51']) {
    const unbounded = run({ CH_LIMIT });
    assert.equal(unbounded.status, 1, CH_LIMIT);
    assert.doesNotMatch(unbounded.stdout, /matched-first/);
  }
});

test('native limits are strict integers from 1 to 50 and receipts retain the actual smaller bound', async () => {
  for (const limit of [0, 51, -1, 1.5, '1', true, null, [], {}, Number.NaN, Number.POSITIVE_INFINITY]) {
    const res = await call('POST /run/:verb', { params: { verb: 'score' }, body: { limit } });
    assert.equal(res.statusCode, 400, String(limit));
    assert.equal(invocation, undefined);
  }
  const accepted = await call('POST /run/:verb', { params: { verb: 'score' }, body: { limit: 1 } });
  assert.equal(accepted.body.limit, 1);
  assert.equal(invocation.env.CH_LIMIT, '1');
  await invocation.options.onComplete({ ok: true, stdout: scoreOutput(2) });
  assert.equal(receipt.read(path.join(root, 'owner-a')), null);
  await invocation.options.onComplete({ ok: true, stdout: scoreOutput(1) });
  assert.equal(receipt.read(path.join(root, 'owner-a')).limit, 1);
});

test('empty, malformed and unavailable saved titles refuse before engine admission', async () => {
  titleTerms = [];
  const empty = await call('POST /run/:verb',{params:{verb:'score'}});
  assert.equal(empty.statusCode,409);
  assert.equal(empty.body.reason,'no-title-profile');
  assert.match(empty.body.error,/Save target job titles/);
  assert.equal(invocation,undefined);
  for (const invalid of [['Adjunct\nDeveloper'],['x'],['Adjunct','Adjunct'],Array(17).fill('Adjunct')]) {
    titleTerms = invalid;
    assert.equal((await call('POST /run/:verb',{params:{verb:'score'}})).statusCode,503);
    assert.equal(invocation,undefined);
  }
  titleTerms = ['Adjunct'];profileFailure = true;
  assert.equal((await call('POST /run/:verb',{params:{verb:'score'}})).statusCode,503);
  assert.equal(invocation,undefined);
});

test('saved non-tech titles reach the actual engine selector with unchanged area, freshness and model-call bounds', async () => {
  const launcher = fs.readFileSync(new URL('../bin/oshal-jobhunter.js',import.meta.url),'utf8');
  const start = launcher.indexOf('function corpusRuns('), end = launcher.indexOf('\n/**',start);
  const code = vm.runInNewContext(launcher.slice(start,end)+'; corpusRuns("score-titles",[])')[0][1];
  for (const remote of [false,true]) {
    remoteOnly = remote;
    const accepted = await call('POST /run/:verb',{params:{verb:'score'},body:{limit:2,titleTerms:['Software Developer'],userSub:'owner-b'}});
    assert.equal(accepted.statusCode,202);
    assert.equal(invocation.userSub,'owner-a');
    const run = spawnSync(process.env.CAREER_TEST_PYTHON || 'python3',
      [fileURLToPath(new URL('./career-manual-title-selector-contract.py',import.meta.url))],
      {encoding:'utf8',timeout:20000,env:{...process.env,...invocation.env,CAREER_TEST_SCORE_CODE:code}});
    assert.equal(run.status,0,run.stderr+run.stdout);
    const report = JSON.parse(run.stdout.trim());
    assert.deepEqual(report.selected,remote?[7]:[1,2]);
    assert.deepEqual(receipt.verdict(report.terminal,2,2),{scored:remote?1:2,skipped:0});
    await invocation.options.onComplete({ok:true,stdout:report.terminal});
    assert.equal(receipt.read(path.join(root,'owner-a')).limit,2);
    assert.equal(receipt.read(path.join(root,'owner-b')),null);
  }
});

test('legacy count parsing stays compatible while title receipts require the exact terminal selector contract', () => {
  assert.deepEqual(receipt.verdict('AI-scored 2 postings (0 skipped).',2),{scored:2,skipped:0});
  for (const replacement of [{result:'failed'}, {terms:0}, {terms:1}, {keywordMatched:1}, {scored:true}, {scored:3}, {skipped:-1}]) {
    const record = {...JSON.parse(scoreOutput(1)),...replacement};
    assert.equal(receipt.verdict(JSON.stringify(record),2,2),null);
  }
});

test('the score CLI passes candidate-facing freshness and preserves incremental first-seen callers', () => {
  const code = String.raw`
import contextlib,io,json
from jobhunter import cli,db,score
seen=[]
db.init_db=lambda:None
def batch(**kwargs):seen.append(kwargs);return 0,0
score.score_batch=batch
with contextlib.redirect_stdout(io.StringIO()):
 cli.main(['score','--limit','1','--fresh-days','7','--min-keyword','40','--remote-only'])
 cli.main(['score','--limit','1','--first-seen-days','3'])
assert seen[0]['fresh_days']==7 and seen[0]['first_seen_days'] is None and seen[0]['remote_only'] is True
assert seen[1]['fresh_days'] is None and seen[1]['first_seen_days']==3 and seen[1]['limit']==1
print(json.dumps({'checks':2}))
`;
  const engine = fileURLToPath(new URL('../engine', import.meta.url));
  const result = spawnSync(process.env.CAREER_TEST_PYTHON || 'python3', ['-c', code], {
    encoding: 'utf8', timeout: 20000, env: { ...process.env, JOBHUNTER_MULTIUSER: '1',
      JOBHUNTER_DATA: path.join(root, 'cli-fixture'), JOBHUNTER_CAREER_DB: path.join(root, 'cli-fixture', 'career_db.json'),
      PYTHONPATH: [engine, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { checks: 2 });
});

test('saved remote preference can be off and admission failures never expose arbitrary diagnostics', async () => {
  remoteOnly = false;
  startResult = { started: false, err: 'secret stdout/private/path', limitReason: 'inflight' };
  const res = await call('POST /run/:verb', { params: { verb: 'score' } });
  assert.equal(res.statusCode, 409);
  assert.equal(invocation.env.CH_REMOTE_ONLY,'0');
  assert.doesNotMatch(JSON.stringify(res.body), /secret|private/);
});

test('a successful completion publishes only validated owner-private counts', async () => {
  await call('POST /run/:verb', { params: { verb: 'score' } });
  await invocation.options.onComplete({ ok: true, code: 0, timedOut: false,
    stdout: 'Private profile material must stay private\n'+scoreOutput(2,1)+'\n' });
  const value = receipt.read(path.join(root, 'owner-a'));
  assert.deepEqual([value.runId, value.state, value.scored, value.skipped, value.limit], [RUN_A, 'succeeded', 2, 1, 50]);
  assert.equal(fs.statSync(path.join(root, 'owner-a', receipt.FILE)).mode & 0o777, 0o600);
  assert.equal(receipt.read(path.join(root, 'owner-b')), null);
  assert.doesNotMatch(JSON.stringify(value), /Private|stdout|stderr/);
  status.runs = [];
  const res = await call('GET /runs');
  assert.equal(res.body.runs[0].state, 'succeeded');
});

test('failed, incomplete and over-budget output never become a success receipt', async () => {
  await call('POST /run/:verb', { params: { verb: 'score' } });
  for (const completion of [
    { ok: false, stdout: scoreOutput(2) },
    { ok: true, stdout: 'Scoring started; private data' },
    { ok: true, stdout: scoreOutput(51) },
    { ok: true, stdout: scoreOutput(1)+'\nUnrelated output after the supposed verdict' },
    { ok: true, stdout: scoreOutput(1,0,1) },
    { ok: true, stdout: JSON.stringify({result:'failed',errorType:'FixtureFailure'}) },
    { ok: true, stdout: 'AI-scored 1 postings (0 skipped).' },
  ]) await invocation.options.onComplete(completion);
  assert.equal(receipt.read(path.join(root, 'owner-a')), null);
});

test('fresh requests use kernel status rather than an unrelated process-local registry', async () => {
  const local = registry.registerEngineRun('owner-a', 'score');
  const res = await call('GET /runs');
  assert.deepEqual(res.body, { source: 'native', runs: [{ runId: RUN_A, state: 'running', reason: null, canCancel: false }] });
  assert.ok(!res.body.runs.some(run => run.runId === local.runId));
  registry.settleEngineRun(local.runId, { code: 0 });
  status.runs = [];
  assert.deepEqual((await call('GET /runs')).body.runs, [], 'absence is not fabricated terminal success');
});

test('status outages remain unavailable rather than falsely reporting idle or finished', async () => {
  statusFailure = true;
  const res = await call('GET /runs');
  assert.deepEqual([res.statusCode, res.body], [503, { error: 'run-status-unavailable' }]);
});

test('native cancellation remains owner-scoped and unavailable until the kernel confirms it', async () => {
  const foreign = await call('POST /run/:runId/cancel', { params: { runId: RUN_B } });
  assert.equal(foreign.statusCode, 404);
  assert.deepEqual(cancelled, []);
  const unsupported = await call('POST /run/:runId/cancel', { params: { runId: RUN_A } });
  assert.deepEqual([unsupported.statusCode, unsupported.body.error], [503, 'native-cancellation-unavailable']);
  assert.equal(unsupported.body.cancelled, undefined);
  cancelResult = 'unconfirmed';
  assert.equal((await call('POST /run/:runId/cancel', { params: { runId: RUN_A } })).body.error, 'cancellation-not-confirmed');
  cancelResult = 'cancelled';
  const confirmed = await call('POST /run/:runId/cancel', { params: { runId: RUN_A } });
  assert.deepEqual([confirmed.statusCode, confirmed.body.cancelled], [202, true]);
});

test('native run projection distinguishes stopping, final publication and stopped receipts', async () => {
  status={runs:[{runId:RUN_A,state:'cancelling'}],canCancel:true,cancelled:[{runId:RUN_B,state:'cancelled',completedAt:'2026-10-28T00:00:00.000Z'}]};
  const state=(await call('GET /runs')).body.runs;
  assert.equal(state[0].state,'cancelling');assert.equal(state[0].canCancel,false);
  assert.equal(state[1].state,'cancelled');
  const repeated=await call('POST /_runtime/runs/:runId/cancel',{params:{runId:RUN_B}});
  assert.equal(repeated.body.cancelled,true);assert.deepEqual(cancelled,[],'stopped receipt reads do not reissue a stop');
  cancelResult='cancelling';
  const request=await call('POST /_runtime/runs/:runId/cancel',{params:{runId:RUN_A}});
  assert.equal(request.statusCode,202);assert.equal(request.body.cancellationRequested,true);assert.equal(request.body.cancelled,undefined);
  cancelResult='finishing';
  assert.equal((await call('POST /_runtime/runs/:runId/cancel',{params:{runId:RUN_A}})).statusCode,409);
});

test('receipt readers refuse oversized, symlinked and corrupt state', async () => {
  const directory = path.join(root, 'owner-a'); fs.mkdirSync(directory);
  const file = path.join(directory, receipt.FILE);
  for (const value of ['{}', 'x'.repeat(2049)]) {
    fs.writeFileSync(file, value);
    assert.throws(() => receipt.read(directory));
  }
  fs.rmSync(file); fs.symlinkSync(path.join(root, 'other-private-file'), file);
  assert.throws(() => receipt.read(directory));
});

test('success receipts require an explicit validated limit and a string run id', async () => {
  const directory = path.join(root, 'owner-a');
  await receipt.write(directory, RUN_A, { scored: 1, skipped: 0 }, 1);
  const file = path.join(directory, receipt.FILE);
  const good = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const replacement of [undefined, null, true, '1', 0, 51]) {
    fs.writeFileSync(file, JSON.stringify({ ...good, limit: replacement }));
    assert.throws(() => receipt.read(directory));
  }
  for (const replacement of [[RUN_A], {}, null, 1]) {
    fs.writeFileSync(file, JSON.stringify({ ...good, runId: replacement }));
    assert.throws(() => receipt.read(directory));
  }
  fs.writeFileSync(file, JSON.stringify(good));
  assert.equal(receipt.read(directory).limit, 1);
});

const html = fs.readFileSync(new URL('../tools/career-settings.html', import.meta.url), 'utf8');
function ui(post, replies, limitValue = '50') {
  const output = { textContent: '', innerHTML: '' }, button = { disabled: false }, notices = [], requests = [];
  const input = { value: limitValue };
  const code = html.slice(html.indexOf('/* score-run:start */'), html.indexOf('/* score-run:end */'));
  const api = new Function('fetch', '$', 'API', 'toast', 'jpost', 'setTimeout', code + '\nreturn {run,scoreRunState,requestScoreStop};')(
    async () => ({ ok: true, json: async () => replies.shift() }), selector => selector === '#runOut' ? output : selector === '#scoreLimit' ? input : button,
    '/api/career-hunter', message => notices.push(message), async (url, body) => { requests.push({ url, body }); return post; }, resolve => resolve());
  return { ...api, output, button, notices, requests };
}

test('Settings waits for count-only completion after acceptance', async () => {
  const page = ui({ ok: true, started: true, runId: RUN_A }, [
    { runs: [{ runId: RUN_A, state: 'running' }] },
    { runs: [{ runId: RUN_A, state: 'succeeded', scored: 2, skipped: 0, limit: 50 }] },
  ]);
  await page.run('score', 'Score');
  assert.deepEqual(page.notices, ['Score started', 'Score complete']);
  assert.match(page.output.textContent, /2 jobs updated/);
  assert.equal(page.button.disabled, false);
});

test('Settings never turns a missing run or missing run id into Done', async () => {
  const absent = ui({ ok: true, started: true, runId: RUN_A }, [{ runs: [] }, { runs: [] }, { runs: [] }]);
  await absent.run('score', 'Score');
  assert.match(absent.output.textContent, /completion could not be confirmed/);
  assert.deepEqual(absent.notices, ['Score started']);
  const noId = ui({ ok: true, started: true }, []);
  await noId.run('score', 'Score');
  assert.match(noId.output.textContent, /accepted; progress is unavailable/);
  assert.deepEqual(noId.notices, ['Score started']);
});

test('Settings sends a smaller chosen limit and describes posted-date freshness accurately', async () => {
  const page = ui({ ok: true, started: true, runId: RUN_A, limit: 1 }, [
    { runs: [{ runId: RUN_A, state: 'succeeded', scored: 1, skipped: 0, limit: 1 }] },
  ], '1');
  await page.run('score', 'Score');
  assert.deepEqual(page.requests[0].body, { limit: 1 });
  assert.match(page.output.textContent, /1 job updated/);
  assert.match(page.scoreRunState({ runs: [{ runId: RUN_A, state: 'running' }] }, RUN_A, 1).text, /up to 1 job posted within 7 days/);
});

test('Settings never reports cancellation from its request acknowledgement or another run', async () => {
  const page=ui({ok:true,runId:RUN_A,state:'cancelling',cancellationRequested:true},[]);
  await page.requestScoreStop(RUN_A,page.output,page.button);
  assert.match(page.output.textContent,/Waiting for scoring/);
  assert.doesNotMatch(page.output.textContent,/was cancelled/);
  assert.deepEqual(page.requests,[{url:'/api/career-hunter/_runtime/runs/'+RUN_A+'/cancel',body:{}}]);
  assert.equal(page.scoreRunState({runs:[{runId:RUN_A,state:'cancelling'}]},RUN_A).done,false);
  assert.equal(page.scoreRunState({runs:[{runId:RUN_A,state:'finishing'}]},RUN_A).done,false);
  assert.equal(page.scoreRunState({runs:[{runId:RUN_A,state:'cancelled'}]},RUN_A).done,true);
  const foreign=ui({ok:true,runId:RUN_B,state:'cancelled',cancelled:true},[]);
  await foreign.requestScoreStop(RUN_A,foreign.output,foreign.button);
  assert.match(foreign.output.textContent,/Could not confirm/);
  assert.deepEqual(page.notices,[],'only an observed terminal run may be called cancelled');
});
