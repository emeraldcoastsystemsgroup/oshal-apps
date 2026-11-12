/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.55.0: starting the shared pull by hand has one rule. POST /run/refresh refused on the native kernel (the installation refreshes the shared job sources) and required a Career administrator elsewhere, while POST /run/pull started the engine's pull for anyone holding career.execute. The compiled routes are driven over loopback HTTP with the real administrator rule (CAREER_HUNTER_ADMIN_SUBS), the real caller resolution and the real settings read; only the engine dispatch is a recorder, so "starts nothing" is counted and not assumed. On the native kernel pull answers refresh's own 409 body and starts nothing, for an administrator too; elsewhere a person who is not an administrator gets refresh's own 403 and nothing starts; an administrator still starts the pull; score and match start for any signed-in person, as before; and the TypeScript source carries the same rule as the built route.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Review of 1.55.0, item 8: /run/Pull is answered 400 (not a verb) and /run/pull/ is refused, on and off the native kernel, and neither starts the engine.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouter, loadCompiledModules, startServer } from './helpers/career-route-harness.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const saved = { egress: process.env.OSHAL_EGRESS, admins: process.env.CAREER_HUNTER_ADMIN_SUBS };
// The compiled administrator rule reads its allow-list once, when it loads.
process.env.CAREER_HUNTER_ADMIN_SUBS = 'administrator-a';
const RUN = '33333333-3333-4333-8333-333333333333';
const REFUSED_ON_NATIVE = { ok: false, manualRefreshAvailable: false, refreshMode: 'installation-managed',
  error: 'The installation refreshes the shared job sources. This screen cannot start a separate shared-corpus writer.' };

/** Every engine start a route asked for. Nothing else in these routes can start the engine. */
let started = [];
const dispatch = {
  runCareerCliAwait: async (_pool, userSub, args, _env, options) => { started.push({ userSub, args: [...args], slot: options?.slot }); options?.onRunStarted?.(RUN); return { ok: true, out: 'done' }; },
  runCareerCliAsync: async (_pool, userSub, args) => { started.push({ userSub, args: [...args], detached: true }); return { started: true }; },
};
const { modules } = loadCompiledModules({ run: 'routes/career-run-routes.js' }, { './career-engine-dispatch': dispatch });

let server, baseUrl;
before(async () => {
  const router = createRouter();
  // The settings read answers "no remote-only preference"; no other query belongs to these requests.
  modules.run.registerCareerRunRoutes(router, { pool: { query: async (sql) => { assert.match(sql, /SELECT remote_only FROM career_score_settings/); return { rows: [] }; } } });
  ({ server, baseUrl } = await startServer(router, (headers) => headers['x-test-sub']));
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const [name, value] of [['OSHAL_EGRESS', saved.egress], ['CAREER_HUNTER_ADMIN_SUBS', saved.admins]]) if (value === undefined) delete process.env[name]; else process.env[name] = value;
});
beforeEach(() => { started = []; delete process.env.OSHAL_EGRESS; });

/** @returns {Promise<{status: number, body: object}>} What the route answered `sub` for POST `path`. */
async function post(path, sub) {
  const response = await fetch(`${baseUrl}/api/career-hunter${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(sub ? { 'x-test-sub': sub } : {}) }, body: '{}' });
  return { status: response.status, body: await response.json() };
}

test('on the native kernel a manual pull is refused the way refresh is, and no engine starts, for an administrator too', async () => {
  process.env.OSHAL_EGRESS = 'kernel';
  for (const sub of ['administrator-a', 'seeker-b']) {
    const pull = await post('/run/pull', sub), refresh = await post('/run/refresh', sub);
    assert.deepEqual([pull.status, pull.body], [409, REFUSED_ON_NATIVE], `${sub}: the installation refreshes the shared job sources`);
    assert.deepEqual([pull.status, pull.body], [refresh.status, refresh.body], `${sub}: pull and refresh give one answer`);
  }
  assert.deepEqual(started, [], 'nothing was started');
});

test('off the native kernel a person who is not a Career administrator is refused, and no engine starts', async () => {
  const pull = await post('/run/pull', 'seeker-b'), refresh = await post('/run/refresh', 'seeker-b');
  assert.deepEqual([pull.status, pull.body], [403, { error: 'admin only' }]);
  assert.deepEqual([pull.status, pull.body], [refresh.status, refresh.body], 'pull and refresh give one answer');
  assert.deepEqual(started, [], 'nothing was started');
});

test('off the native kernel a Career administrator still starts the pull', async () => {
  const pull = await post('/run/pull', 'administrator-a');
  assert.deepEqual([pull.status, pull.body], [200, { ok: true, out: 'done', runId: RUN }]);
  assert.deepEqual(started, [{ userSub: 'administrator-a', args: ['pull'], slot: 'pull' }], 'one pull, as that administrator');
});

test('score and match are as they were: any signed-in person starts their own, off the native kernel', async () => {
  const score = await post('/run/score', 'seeker-b'), match = await post('/run/match', 'seeker-b');
  assert.deepEqual([score.status, score.body.ok, match.status, match.body.ok], [200, true, 200, true]);
  assert.deepEqual(started, [{ userSub: 'seeker-b', args: ['score', '--min-keyword', '40'], slot: 'score' }, { userSub: 'seeker-b', args: ['match'], slot: 'match' }]);
});

test('a caller who is not signed in, and a verb that is not one, are answered as before', async () => {
  for (const mode of [undefined, 'kernel']) {
    if (mode) process.env.OSHAL_EGRESS = mode; else delete process.env.OSHAL_EGRESS;
    assert.deepEqual(await post('/run/pull'), { status: 401, body: { error: 'unauthorized' } });
    assert.deepEqual(await post('/run/everything', 'administrator-a'), { status: 400, body: { error: 'verb' } });
  }
  assert.deepEqual(started, []);
});

test('a pull asked for in another spelling starts nothing: /run/Pull is not a verb, and /run/pull/ is refused', async () => {
  for (const mode of [undefined, 'kernel']) {
    if (mode) process.env.OSHAL_EGRESS = mode; else delete process.env.OSHAL_EGRESS;
    assert.deepEqual(await post('/run/Pull', 'administrator-a'), { status: 400, body: { error: 'verb' } }, `${mode || 'off the kernel'}: the verb list is exact`);
    // This harness matches paths exactly, so /run/pull/ never reaches the route here; where a router does pass it on, the
    // verb is still `pull` and the rule above answers. Either way the answer is a refusal and no engine starts.
    const slash = await post('/run/pull/', 'seeker-b');
    assert.ok(slash.status >= 400, `${mode || 'off the kernel'}: /run/pull/ is refused (${slash.status})`);
  }
  assert.deepEqual(started, [], 'nothing was started');
});

test('the TypeScript source and the built route carry the same rule, asked for in the same two places', () => {
  for (const [file, admin] of [['src-routes/career-run-routes.ts', /if \(!isCareerAdmin\(userSub\)\)/], ['routes/career-run-routes.js', /if \(!\(0, career_company_routes_1\.isCareerAdmin\)\(userSub\)\)/]]) {
    const source = readFileSync(join(packageRoot, file), 'utf8');
    const rule = source.slice(source.indexOf('function refuseSharedPull('), source.indexOf('function startRefresh('));
    assert.match(rule, /process\.env\.OSHAL_EGRESS === 'kernel'/, `${file}: the native kernel refuses`);
    assert.match(rule, /manualRefreshAvailable: false, refreshMode: 'installation-managed'/, `${file}: with the refresh's own answer`);
    assert.match(rule, admin, `${file}: elsewhere only an administrator`);
    assert.equal((source.match(/if \((?:verb === 'pull' && )?refuseSharedPull\(userSub, res\)\)/g) || []).length, 2, `${file}: refresh and pull both ask it`);
    assert.match(source, /if \(verb === 'pull' && refuseSharedPull\(userSub, res\)\)/, `${file}: only pull, not score or match`);
    assert.equal(source.split("refreshMode: 'installation-managed',").length - 1, 1, `${file}: the refusal is written once`);
  }
});
