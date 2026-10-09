/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the engine child's completions cross the kernel's ADR-149 enforce boundary (1.25.1). Core tests/unit/career-rail-enforce-posture.spec.ts proved the 1.24.0 rail's caller - the fleet secret, an asserted subject and a bearer run token - is refused 401 authorization_identity_required before any package code, so the package could not score on an enforce box. This suite activates the real package through the kernel's manifest reader (which admits the callbackVerifier only because the catalog is declared), enforce-mode runtime and route mounter (career-rail-kernel-harness.cjs): a grant minted by the compiled dispatch and runner under the kernel's real request identity is admitted when signed as the engine child signs, the handler runs as that owner and dispatches exactly one accounted call, and the production Python engine's own signer is admitted the same way; the exact 1.24.0 contract, an unsigned request, a browser session, a foreign owner, a tampered body, a replay, a wrong method, a settled run, a run without a verified issuer, an owner without the member role, a revoked role and a deactivated owner are all refused with no handler call and no database query.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Hold the bare route-binding guard (tests/career-catalog-route-bindings.test.mjs) to the kernel: over the same enumeration of every literal route under every registered mount, the kernel's own resolveOperationPermissions must bind each request to exactly one permission set and the guard's mirrored rule must return the same set. The guard exists because GET /companies-admin shipped unbound in the first 1.25.1 catalog; this case is what keeps its mirror from drifting off the matcher it copies.
 */

'use strict';

const { after, afterEach, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CAREER_AGENT_ID, PKG, RAIL_MOUNT, interpreter, launchRun, runChild, settleOpenRuns, startKernelHarness } = require('./helpers/career-rail-kernel-harness.cjs');
const signer = require('./helpers/career-rail-signer.cjs');
const routeBindings = require('./helpers/career-route-bindings.cjs');

let h;
const COMPLETE = `${RAIL_MOUNT}/complete`;
const payload = { system: 'You score jobs.', prompt: 'Score this posting.', maxTokens: 700, jsonMode: true };

before(async () => {
  h = await startKernelHarness();
  await h.changeRole('owner_a');
}, { timeout: 180000 });

after(async () => { if (h) await h.stop(); });

beforeEach(() => { h.recorded.calls.length = 0; h.recorded.databaseQueries = 0; });
afterEach(() => settleOpenRuns(h));

const send = (request) => signer.send(request);
const signed = (run, owner, overrides) => signer.signedCompletion(h.base, run.env.CAREER_RAIL_GRANT, owner, payload, overrides);
const bare = (headers, body = JSON.stringify(payload), method = 'POST') => fetch(`${h.base}${COMPLETE}`, { method,
  headers: { 'content-type': signer.RAIL_CONTENT_TYPE, ...headers }, body: method === 'GET' ? undefined : body });

test('the package activates through the kernel in enforce mode: catalog declared, verifier admitted, POST /complete bound to career.execute', () => {
  const rail = h.manifest.routes.find((route) => route.mountPath === RAIL_MOUNT);
  assert.deepEqual({ auth: rail.auth, verifier: rail.callbackVerifier }, { auth: 'public', verifier: 'createCareerRailCallbackVerifier' });
  assert.ok(h.manifest.uses.includes('signed-package-callbacks') && h.manifest.uses.includes('application-authorization'));
  assert.equal(h.runtime.protectedApp('career-hunter'), true, 'a catalog-bearing package is protected in every mode');
  const catalog = h.policy.getApp('career-hunter').catalog;
  assert.deepEqual(catalog.bindings.http.find((binding) => binding.id === 'engine-complete'),
    { id: 'engine-complete', method: 'POST', path: '/complete', allOf: ['career.execute'] });
  assert.deepEqual(Object.keys(catalog.roles).sort(), ['admin', 'member']);
  assert.ok(catalog.roles.member.grants.some((grant) => grant.permission === 'career.execute'));
  assert.equal(catalog.bindings.bots[0].id, CAREER_AGENT_ID);
});

test('the compiled dispatch mints a grant for the verified owner and issuer, and a completion signed with it is admitted and served as that owner', async () => {
  const run = await launchRun(h, 'owner_a');
  assert.ok(run.env.CAREER_RAIL_GRANT.startsWith(`${run.runId}.`), 'the grant names the run the runner registered');
  assert.equal(run.env.CAREER_RAIL_URL, `${h.base}${COMPLETE}`, 'the rail URL is the controller listener itself');
  assert.equal(run.env.CAREER_RAIL_SERVICE_SECRET, undefined, 'the fleet secret is not in the child environment');
  assert.ok(!Object.values(run.env).includes(process.env.SWARM_SERVICE_SECRET));
  const answer = await send(signed(run, 'crk_a'));
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.deepEqual(answer.body, { ok: true, text: 'scored for crk_a', model: 'fixture-model', provider: 'fixture' });
  assert.equal(h.recorded.calls.length, 1, 'exactly one accounted bot call');
  const [{ agentId, request }] = h.recorded.calls;
  assert.equal(agentId, CAREER_AGENT_ID);
  assert.deepEqual({ userSub: request.userSub, taskId: request.taskId, direct: request.direct, agenticMode: request.agenticMode },
    { userSub: 'crk_a', taskId: `career-engine-${run.runId}`, direct: true, agenticMode: false });
  assert.equal(h.recorded.databaseQueries, 0, 'no database was consulted anywhere on the path');
  run.exit(0);
});

test('the exact 1.24.0 caller - fleet secret, asserted subject, bearer run token - is refused by the kernel before package code, as is every unsigned shape', async () => {
  const run = await launchRun(h, 'owner_a');
  const legacy = await bare({ 'x-service-secret': process.env.SWARM_SERVICE_SECRET, 'x-oshal-user-sub-b64': signer.encodeOwner('crk_a'),
    'x-career-run-token': run.env.CAREER_RAIL_GRANT });
  assert.deepEqual([legacy.status, await legacy.json()], [401, { error: 'callback_signature_invalid' }]);
  const unsigned = await bare({});
  assert.equal(unsigned.status, 401);
  const browser = await bare({ 'x-fixture-user': 'owner_a', cookie: 'appSession=browser' });
  assert.equal(browser.status, 401, 'a signed-in browser session is not the engine child');
  const wrongMethod = await bare({}, undefined, 'GET');
  assert.deepEqual([wrongMethod.status, await wrongMethod.json()], [405, { error: 'callback_post_required' }]);
  assert.deepEqual([h.recorded.calls.length, h.recorded.databaseQueries], [0, 0]);
  run.exit(0);
});

test('a foreign owner, a tampered body, a replay and a settled run are refused with no handler call', async () => {
  const run = await launchRun(h, 'owner_a');
  await h.changeRole('owner_b');
  try {
    const foreign = await send(signed(run, 'crk_b'));
    assert.equal(foreign.status, 401, "owner B, who holds the role, cannot present owner A's grant");
    const prepared = signed(run, 'crk_a');
    const tampered = await fetch(prepared.url, { ...prepared.init, body: Buffer.from(JSON.stringify({ ...payload, prompt: 'Score a different posting.' })) });
    assert.equal(tampered.status, 401);
    const first = await send(prepared);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const replay = await send(prepared);
    assert.deepEqual([replay.status, replay.body], [401, { error: 'callback_signature_invalid' }], 'the identical request replayed is refused');
    assert.equal(h.recorded.calls.length, 1);
    run.exit(0);
    const settled = await send(signed(run, 'crk_a'));
    assert.equal(settled.status, 401, "a settled run's grant is revoked");
    assert.equal(h.recorded.calls.length, 1);
  } finally { await h.changeRole('owner_b', 'revoke'); }
});

test("the owner's current role, account and recorded issuer gate every admitted grant", async () => {
  const noIssuer = await launchRun(h, 'owner_a', { issuer: null });
  assert.equal(noIssuer.env.CAREER_RAIL_GRANT, undefined, 'a launch with no verified issuer mints nothing');
  noIssuer.exit(0);

  const unprivileged = await launchRun(h, 'owner_b');
  const noRole = await send(signed(unprivileged, 'crk_b'));
  assert.equal(noRole.status, 403, 'a valid grant of an owner without the member role is refused by the catalog');
  unprivileged.exit(0);

  const run = await launchRun(h, 'owner_a');
  await h.changeRole('owner_a', 'revoke');
  try {
    assert.equal((await send(signed(run, 'crk_a'))).status, 403, 'revoking the role refuses the running engine at its next call');
  } finally { await h.changeRole('owner_a'); }
  h.directory.people.owner_a.isActive = false;
  try {
    const inactive = await send(signed(run, 'crk_a'));
    assert.deepEqual([inactive.status, inactive.body], [403, { error: 'callback_owner_unavailable' }]);
  } finally { h.directory.people.owner_a.isActive = true; }
  assert.equal(h.recorded.calls.length, 0);
  assert.equal((await send(signed(run, 'crk_a'))).status, 200);
  run.exit(0);
});

test('the production Python engine signs a completion the kernel admits, and is refused once its run is settled', { timeout: 120000 }, async () => {
  const python = interpreter([process.env.CAREER_TEST_PYTHON, 'python', 'python3'].filter(Boolean),
    ['-c', 'import sys; print(sys.version_info[0])'], (out) => out.trim().startsWith('3'), 'Python 3');
  const run = await launchRun(h, 'owner_a');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'career-kernel-engine-'));
  for (const dir of ['home', 'codex', 'claude', 'data']) fs.mkdirSync(path.join(home, dir), { recursive: true });
  const env = {
    PATH: path.dirname(python.includes(path.sep) ? python : process.env.PATH?.split(path.delimiter).map((dir) => path.join(dir, python + (process.platform === 'win32' ? '.exe' : ''))).find((candidate) => fs.existsSync(candidate)) ?? python),
    SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR,
    HOME: path.join(home, 'home'), USERPROFILE: path.join(home, 'home'),
    CODEX_HOME: path.join(home, 'codex'), CLAUDE_CONFIG_DIR: path.join(home, 'claude'),
    PYTHONPATH: path.join(PKG, 'engine'), PYTHONIOENCODING: 'utf-8',
    JOBHUNTER_MULTIUSER: '1', OSHAL_USER_SUB: 'crk_a', JOBHUNTER_DATA: path.join(home, 'data'),
    CAREER_RAIL_URL: run.env.CAREER_RAIL_URL, CAREER_RAIL_GRANT: run.env.CAREER_RAIL_GRANT,
    CAREER_RAIL_RUN_ID: run.env.CAREER_RAIL_RUN_ID, CAREER_RAIL_TIMEOUT_S: '30',
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const program = 'import json\nfrom jobhunter import enrich\nprint(json.dumps({"text": enrich.complete("SYS", "PROMPT")}))';
  try {
    const result = await runChild(python, ['-c', program], env);
    assert.equal(result.status, 0, `exit ${result.status}\n${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { text: 'scored for crk_a' });
    assert.equal(h.recorded.calls.length, 1);
    assert.equal(h.recorded.calls[0].request.userSub, 'crk_a');
    run.exit(0);
    const refused = await runChild(python, ['-c', program], env);
    assert.notEqual(refused.status, 0, 'a settled run cannot complete anything');
    assert.match(refused.stderr, /career worker unavailable: callback_signature_invalid/);
    assert.equal(h.recorded.calls.length, 1);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('every literal route in src-routes binds to exactly one permission set under the kernel\'s own matcher, and the bare guard\'s mirror agrees', () => {
  // The registration the kernel authorizes against: its validated catalog (getApp) and the mounts
  // it registers from the manifest its own reader parsed (application-authorization-runtime.ts).
  const mountPaths = h.manifest.routes.map((route) => route.mountPath);
  const app = { ...h.policy.getApp('career-hunter'), mountPaths };
  assert.deepEqual(routeBindings.manifestMounts().map((entry) => entry.mountPath), mountPaths, 'the guard reads the mounts the kernel registered, in order');
  const kernelCatalog = app.catalog.bindings.http;
  assert.equal(routeBindings.catalogHttpBindings().length, kernelCatalog.length, 'the bare reader reads every http binding the kernel parsed');
  const rows = routeBindings.resolvedRoutes(app.mountPaths, kernelCatalog);
  assert.ok(rows.length >= 90, `every literal route is tried (${rows.length} requests)`);
  const disagreements = [];
  for (const row of rows) {
    const kernel = h.core.authorization.resolveOperationPermissions(app, { app: 'career-hunter', kind: 'http', method: row.method, path: row.relative });
    const mirror = row.matches.length === 1 ? row.matches[0].allOf : null;
    if (!Array.isArray(kernel) || kernel.length === 0 || JSON.stringify(kernel) !== JSON.stringify(mirror)) {
      disagreements.push(`${row.method} ${row.request} -> kernel ${JSON.stringify(kernel)} mirror ${JSON.stringify(mirror)}`);
    }
  }
  assert.deepEqual(disagreements, [], 'an unbound route is denied authorization_operation_unbound; a mirror that differs would hide one');
  assert.deepEqual(h.core.authorization.resolveOperationPermissions(app, { app: 'career-hunter', kind: 'http', method: 'GET', path: '/companies-admin' }),
    ['career.administer'], 'the Companies page the ribbon opens is bound like its data');
  const deeper = `/board/${Array.from({ length: routeBindings.WILDCARD_DEPTHS + 1 }, (_v, i) => `legacy${i}`).join('/')}`;
  assert.equal(h.core.authorization.resolveOperationPermissions(app, { app: 'career-hunter', kind: 'http', method: 'GET', path: deeper }), null,
    'one depth past the bound classic-board depths is unbound, as the catalog comment says');
});
