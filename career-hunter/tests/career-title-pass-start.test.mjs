/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the live compiled run-now route: it acknowledges kernel-kept background scoring, pins the seven-day first-seen bound, and only advances the cursor after success.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Bound caller-selected manual batches and refuse invalid limits before launching an engine.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Publish native success cursors in the private owner generation without SQL calls from a bot continuation.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Exercise the nightly route's fixed cap and atomically published private receipt, then its durable no-op on the same corpus.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Guard the 1.47 candidate bound: ten inspections per allowed model call, pushed into the SQL.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Module from 'node:module';

const require = createRequire(import.meta.url);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const originalLoad = Module._load;
let launchOptions;
let launchArgs;
let nativeRoot;
const dispatch = {
  runCareerCliAsync: async (_pool, _userSub, args, env, options) => {
    launchArgs = { args, env };
    launchOptions = options;
    options.onRunStarted('b7f0a284-2d4c-4c10-9d49-2070ef335de9');
    return { started: true };
  },
  runCareerCliAwait: async () => { throw new Error('run-now must not await the scoring child'); },
};

Module._load = function loadTitleRoute(request, ...rest) {
  if (request === '@/shared/logger') {
    return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  }
  if (request === './career-user-store') return {
    callerSub: (req) => req?.userSub || null,
    userPaths: (subject) => ({ userDir: join(nativeRoot, subject), corpusDb: join(nativeRoot, 'corpus.db') }),
  };
  if (request === './career-engine-dispatch') return dispatch;
  return originalLoad.call(this, request, ...rest);
};
const titleRoutes = require('../routes/career-title-score.js');

after(() => { Module._load = originalLoad; });

test('matching area routes save only the authenticated owner preference and preserve titles', async () => {
  nativeRoot = mkdtempSync(join(tmpdir(), 'career-title-area-'));
  try {
    const handlers = new Map();
    let writes = 0;
    const pool = { query: async sql => {
      if (!sql.includes('SELECT')) writes++;
      return { rows: [{ title_terms: ['Adjunct', 'Developer'], title_terms_source: 'user' }] };
    } };
    const router = { get(path, cb) { handlers.set('GET '+path, cb); }, post(path, cb) { handlers.set('POST '+path, cb); } };
    titleRoutes.registerCareerTitleScoreRoutes(router, { pool });
    const response = () => ({ statusCode: 200, status(code) { this.statusCode=code; return this; }, json(body) { this.body=body; } });
    const post = handlers.get('POST /settings/title-profile');
    const r = response();
    await post({ userSub: 'owner', body: { scope: { near: 'Destin, FL', radiusMiles: 70, includeRemote: true } } }, r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.searchScope.radiusMiles, 70);
    assert.equal(writes, 0, 'saving area must not mutate the title profile');
    const state = response();
    await handlers.get('GET /title-profile/state')({ userSub: 'owner' }, state);
    assert.deepEqual(state.body.titleTerms, ['Adjunct', 'Developer']);
    assert.equal(state.body.searchScope.near, 'Destin, FL');
    const other = response();
    await handlers.get('GET /title-profile/state')({ userSub: 'other' }, other);
    assert.equal(other.body.searchScope, null);
    const invalid = response();
    await post({ userSub: 'owner', body: { scope: { near: 'Destin, FL', radiusMiles: 0, includeRemote: true } } }, invalid);
    assert.equal(invalid.statusCode, 400);
    const mixed = response();
    await post({ userSub: 'owner', body: { scope: {}, terms: [] } }, mixed);
    assert.equal(mixed.statusCode, 400);
    const unauthenticated = response();
    await post({ body: { scope: {} } }, unauthenticated);
    assert.equal(unauthenticated.statusCode, 401);
  } finally { rmSync(nativeRoot, { recursive: true, force: true }); }
});

test('run-now returns 202 and advances its cursor only after successful background scoring', async () => {
  const mounted = new Map();
  const router = {
    get(path) { mounted.set(`GET ${path}`, true); },
    post(path, handler) { mounted.set(`POST ${path}`, handler); },
  };
  let cursorWrites = 0;
  const ctx = { pool: { query: async (sql) => {
    if (sql.includes('SELECT title_terms')) {
      return { rows: [{ title_terms: ['Program Manager'], title_terms_source: 'user', remote_only: true }] };
    }
    if (sql.includes('last_title_pass_at')) cursorWrites += 1;
    return { rows: [] };
  } } };
  titleRoutes.registerCareerTitleScoreRoutes(router, ctx);
  const handler = mounted.get('POST /title-pass/run-now');
  assert.equal(typeof handler, 'function');
  const response = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  await handler({ userSub: 'owner-1', body: {} }, response);

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.body, { started: true, runId: 'b7f0a284-2d4c-4c10-9d49-2070ef335de9' });
  assert.deepEqual(launchArgs.args, ['score-titles']);
  assert.equal(launchArgs.env.CH_FRESH_DAYS, '7');
  assert.equal(launchArgs.env.CH_REMOTE_ONLY, '1');
  assert.equal(launchArgs.env.CH_LIMIT, '150');
  assert.equal(launchOptions.captureStdout, true, 'background scoring captures only its bounded count summary');
  assert.equal(cursorWrites, 0, 'the start acknowledgement is not a successful score');

  await launchOptions.onComplete({
    ok: false, code: 1, timedOut: false,
    stdout: '{"result":"failed","errorType":"CareerWorkerUnavailable"}\n',
  }, new AbortController().signal);
  assert.equal(cursorWrites, 0, 'a failed background run remains eligible for retry');
  await launchOptions.onComplete({
    ok: true, code: 0, timedOut: false,
    stdout: '25/25  (25 scored)\n{"result":"complete","scored":25,"skipped":0,"terms":1}\n',
  }, new AbortController().signal);
  assert.equal(cursorWrites, 1, 'a successful run advances the daily cursor once');
});

test('the settings UI and Python launcher use the same fresh-posting contract', () => {
  const source = readFileSync(join(packageRoot, 'src-routes', 'career-title-score.ts'), 'utf8');
  const compiled = readFileSync(join(packageRoot, 'routes', 'career-title-score.js'), 'utf8');
  const launcher = readFileSync(join(packageRoot, 'bin', 'oshal-jobhunter.js'), 'utf8');
  const html = readFileSync(join(packageRoot, 'tools', 'career-settings.html'), 'utf8');
  for (const route of [source, compiled]) {
    assert.match(route, /CH_FRESH_DAYS: '7'/);
    assert.match(route, /CH_REMOTE_ONLY/);
    assert.match(route, /runCareerCliAsync/);
    assert.match(route, /onComplete/);
  }
  assert.match(launcher, /fresh_days=fresh_days/);
  assert.match(launcher, /remote_only=remote_only/);
  assert.match(launcher, /"result":"complete"/);
  assert.match(launcher, /"result":"failed","errorType":type\(error\).__name__/);
  assert.match(html, /r\.started/);
  assert.match(html, /jobs posted in the last 7 days/);
});

test('manual callers may request a small batch but cannot remove or exceed the cap', async () => {
  let handler;
  const router = { get() {}, post(path, callback) { if (path === '/title-pass/run-now') handler = callback; } };
  const ctx = { pool: { query: async () => ({ rows: [{ title_terms: ['Developer'], title_terms_source: 'user' }] }) } };
  titleRoutes.registerCareerTitleScoreRoutes(router, ctx);
  const call = async limit => {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await handler({ userSub: 'owner-1', body: { limit } }, response);
    return response;
  };
  assert.equal((await call(5)).statusCode, 202);
  assert.equal(launchArgs.env.CH_LIMIT, '5');
  for (const limit of [0, -1, 1.5, 151, '5', true, null]) {
    launchArgs = null;
    assert.equal((await call(limit)).statusCode, 400);
    assert.equal(launchArgs, null, 'invalid limits cannot launch scoring');
  }
});

test('a native nightly route fixes its cap, publishes both cursors, then returns a durable no-op', async () => {
  const priorEgress = process.env.OSHAL_EGRESS, priorMount = process.env.OSHAL_CAREER_OWNER_MOUNT;
  nativeRoot = mkdtempSync(join(tmpdir(), 'career-nightly-route-'));
  mkdirSync(join(nativeRoot, 'nightly-owner'));
  writeFileSync(join(nativeRoot, 'corpus.db'), 'published fixture');
  process.env.OSHAL_EGRESS = 'kernel'; process.env.OSHAL_CAREER_OWNER_MOUNT = '1';
  try {
    let handler;
    const router = { get() {}, post(path, cb) { if (path === '/title-pass/run-now') handler = cb; } };
    const pool = { query: async sql => {
      assert.match(sql, /SELECT title_terms/);
      return { rows: [{ title_terms: ['Developer', 'Adjunct'], title_terms_source: 'user', remote_only: false }] };
    } };
    titleRoutes.registerCareerTitleScoreRoutes(router, { pool });
    const response = () => ({ statusCode: 200, status(code) { this.statusCode=code; return this; }, json(body) { this.body=body; } });
    const request = { userSub: 'nightly-owner', body: { nightly: true, limit: 9999, userSub: 'other-owner' } };
    const started = response(); await handler(request, started);
    assert.equal(started.statusCode, 202);
    assert.equal(launchArgs.env.CH_LIMIT, '50');
    assert.equal(launchArgs.env.CH_NIGHTLY_MATCH, '1');
    await launchOptions.onComplete({ ok: true, code: 0, stdout: '{"result":"complete","keywordMatched":42,"scored":3,"skipped":0,"terms":2}' });
    const owner = join(nativeRoot, 'nightly-owner');
    assert.equal(JSON.parse(readFileSync(join(owner, 'nightly-match-success.json'))).scored, 3);
    assert.ok(existsSync(join(owner, 'title-pass-success.json')));
    launchArgs = null;
    const noop = response(); await handler(request, noop);
    assert.equal(noop.statusCode, 200);
    assert.equal(noop.body.reason, 'up-to-date');
    assert.equal(launchArgs, null);
    assert.equal(existsSync(join(nativeRoot, 'other-owner')), false);
    const unauthorized = response(); await handler({ body: { nightly: true } }, unauthorized);
    assert.equal(unauthorized.statusCode, 401);
  } finally {
    if (priorEgress === undefined) delete process.env.OSHAL_EGRESS; else process.env.OSHAL_EGRESS = priorEgress;
    if (priorMount === undefined) delete process.env.OSHAL_CAREER_OWNER_MOUNT; else process.env.OSHAL_CAREER_OWNER_MOUNT = priorMount;
    rmSync(nativeRoot, { recursive: true, force: true });
  }
});

test('native success and its cursor share an owner publication without SQL from the kept bot run', async () => {
  const priorEgress = process.env.OSHAL_EGRESS, priorMount = process.env.OSHAL_CAREER_OWNER_MOUNT;
  nativeRoot = mkdtempSync(join(tmpdir(), 'career-title-cursor-'));
  const owner = join(nativeRoot, 'native-owner'); mkdirSync(owner);
  const cursorFile = join(owner, 'title-pass-success.json');
  process.env.OSHAL_EGRESS = 'kernel'; process.env.OSHAL_CAREER_OWNER_MOUNT = '1';
  const oldCursor = '2026-09-27T16:58:48.307Z';
  const ctx = { pool: { query: async sql => {
    assert.match(sql, /SELECT title_terms/, 'a kept native bot run cannot write SQL');
    return { rows: [{ title_terms: ['Developer'], title_terms_source: 'user', last_title_pass_at: oldCursor }] };
  } } };
  try {
    await titleRoutes.startTitlePassForUser(ctx, 'native-owner', { limit: 1 });
    await launchOptions.onComplete({ ok: false, code: 1, timedOut: false,
      stdout: '{"result":"failed","errorType":"CareerWorkerUnavailable"}\n' });
    assert.equal(existsSync(cursorFile), false);
    await launchOptions.onComplete({ ok: true, code: 0, timedOut: false,
      stdout: '{"result":"complete","scored":1,"skipped":0,"terms":1}\n' });
    const cursor = JSON.parse(readFileSync(cursorFile, 'utf8'));
    assert.equal(cursor.version, 1);
    assert.equal((await titleRoutes.readTitleProfile(ctx.pool, 'native-owner')).lastTitlePassAt, cursor.lastTitlePassAt);
    assert.equal((await titleRoutes.getOrSeedTitleProfile(ctx.pool, 'native-owner')).lastTitlePassAt, cursor.lastTitlePassAt);
    assert.equal((await titleRoutes.readTitleProfile(ctx.pool, 'another-owner')).lastTitlePassAt, oldCursor);
    writeFileSync(cursorFile, '{"version":1,"lastTitlePassAt":"invalid"}');
    assert.equal((await titleRoutes.readTitleProfile(ctx.pool, 'native-owner')).lastTitlePassAt, oldCursor);
  } finally {
    for (const [key, value] of [['OSHAL_EGRESS', priorEgress], ['OSHAL_CAREER_OWNER_MOUNT', priorMount]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(nativeRoot, { recursive: true, force: true }); nativeRoot = undefined;
  }
});

test('title scorer caps candidates in SQL and filters on posted date with a first-seen fallback', () => {
  const scorer = readFileSync(join(packageRoot, 'engine', 'jobhunter', 'score.py'), 'utf8');
  assert.match(scorer, /fresh_days=None/);
  assert.match(scorer, /posted_date >= date\('now'/);
  assert.match(scorer, /posted_date IS NULL AND first_seen_at >= datetime\('now'/);
  assert.match(scorer, /where = "active = 1 AND target_role = 1"/);
  assert.match(scorer, /inspection_limit = budget \* 10 if budget else None/);
  assert.match(scorer, /if inspection_limit:\n\s+sql \+= f" LIMIT \{inspection_limit \+ 1\} OFFSET \{offset\}"/);
});
