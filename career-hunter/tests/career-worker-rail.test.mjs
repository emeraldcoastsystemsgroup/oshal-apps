/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the Career worker rail over a real loopback HTTP listener against the COMPILED route: anonymous and browser callers are refused at the mount and in the route, a run token redeems only for its exact owner while the run is running, an admitted completion reaches the Career bot exactly once as a direct non-agentic call owned by the run's subject, a missing node, missing/stale/offline heartbeat or transport failure answers 503 career-worker-unavailable and fails the run visibly, the package semaphore bounds concurrent completions, the per-call deadline answers 504, an owner's cancellation aborts a waiting call and revokes the token, and the body is bounded by the rail's own ceiling rather than the kernel's 100 KB JSON default.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Guard the queue/deadline split: eight concurrent calls at concurrency 2 with a bot faster than the deadline all answer 200 even though the last pair queued longer than the deadline; the wait for a slot has its own ceiling (504 career-worker-queue-timeout, never dispatched); a queued call whose run is cancelled answers 409 without reaching the bot; and the engine's client timeout covers the queue ceiling plus the deadline. Name the scoped stand-ins accurately: the harness mirrors the kernel authz decoder and service mount guard, and doubles the Express Router, BotNodeClient.hasEndpoint, the endpoint resolver, the heartbeat registry and executeBotOrInline.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The signed rail (1.25.1): every admitted call is signed with the runner-minted per-run grant, and the refusals are the ones the kernel's signed-package-callbacks rail answers before package code — unsigned, the retired 1.24.0 service-secret-plus-subject-plus-token contract, a browser cookie, a tampered body, a replayed request, a foreign owner, a wrong method, a settled or cancelled run, a run without a recorded owner issuer, an owner the directory no longer holds and an owner without the bound permission all fail with no bot call; the route alone refuses a request the verifier never admitted and one whose kernel identity is not the run owner. The body's content type and ceiling are now verifier refusals (the signature covers the bytes), so they answer as the kernel does; JSON and document validation still answer 400 from the handler.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Preserve signed-rail version/catalog checks for the composite-bearing authorization block.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE_ISSUER, encodeSubject, loadRailHarness, postCompletion } from './helpers/worker-rail-harness.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'rail-fixture-service-secret';
const savedEnv = Object.fromEntries([
  'SWARM_SERVICE_SECRET', 'CAREER_WORKER_RAIL_CONCURRENCY', 'CAREER_WORKER_RAIL_DEADLINE_MS',
  'CAREER_WORKER_RAIL_MAX_BODY_BYTES', 'CAREER_WORKER_RAIL_HEARTBEAT_STALE_MS', 'CAREER_WORKER_RAIL_QUEUE_WAIT_MS',
].map((key) => [key, process.env[key]]));
process.env.SWARM_SERVICE_SECRET = SECRET;

const harness = loadRailHarness();
const { state, runs } = harness;
let server;

before(async () => { server = await harness.startServer(); });
after(async () => {
  await server?.close();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

/** Reset the fixture bot to a healthy, answering node. */
function healthyWorker() {
  state.calls.length = 0;
  state.hasEndpoint = true;
  state.registration = () => ({ status: 'online', heartbeatAt: new Date().toISOString() });
  state.behavior = async (request) => ({ success: true, response: `answer for ${request.userSub}`, model: 'm', provider: 'p' });
}

/** Register one engine run the way the runner does, with the owner's verified issuer recorded. */
function newRun(owner, verb = 'score') {
  return runs.registerEngineRun(owner, verb, { ownerIssuer: FIXTURE_ISSUER });
}

/** Sign as the engine child holding this run's grant. */
function auth(run, owner = 'user-a') {
  return { grant: run.token, owner };
}

/** A promise that the test resolves by hand, for in-flight bot calls. */
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/** Settle within a bound, so a regression fails the test and its cleanup still runs. */
function within(promise, ms, label) {
  let timer;
  const bound = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms); });
  return Promise.race([promise, bound]).finally(() => clearTimeout(timer));
}

/** Wait until a predicate holds, bounded so a regression fails instead of hanging. */
async function waitFor(predicate, label) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('unsigned, service-secret, browser and wrong-method callers are refused by the rail before any bot call', async () => {
  healthyWorker();
  const run = newRun('user-a');
  const refused = async (label, input) => {
    const answer = await postCompletion(server.url, input);
    assert.deepEqual([answer.status, answer.body], [401, { error: 'callback_signature_invalid' }], label);
  };
  await refused('no signature at all', {});
  await refused('the retired 1.24.0 contract: fleet secret + asserted subject + bearer token', {
    headers: { 'x-service-secret': SECRET, 'x-oshal-user-sub-b64': encodeSubject('user-a'), 'x-career-run-token': run.token },
  });
  await refused('a browser session', { headers: { cookie: 'appSession=browser' } });
  await refused('a signature over another body', { ...auth(run), headers: { 'x-career-rail-signature': 'a'.repeat(64) } });
  await refused('a stale timestamp', { ...auth(run), timestamp: Math.floor(Date.now() / 1000) - 3600 });
  await refused('a malformed nonce', { ...auth(run), nonce: 'short' });
  const wrongMethod = await postCompletion(server.url, { ...auth(run), method: 'GET' });
  assert.deepEqual([wrongMethod.status, wrongMethod.body], [405, { error: 'callback_post_required' }]);

  const unguarded = await harness.startServer({ mountGuard: false });
  try {
    const routeOnly = await postCompletion(unguarded.url, auth(run));
    assert.deepEqual([routeOnly.status, routeOnly.body.error], [401, 'rail-grant-required'],
      'the route refuses on its own if a mount ever reached it without the verifier');
  } finally { await unguarded.close(); }
  assert.equal(state.calls.length, 0);
  assert.equal(runs.engineRunSnapshot(run.runId).railCalls, 0, 'nothing was counted against the run');
  runs.settleEngineRun(run.runId, { code: 0 });
});

test('a grant verifies only for its exact owner, only once per request, and only while the run is running', async () => {
  healthyWorker();
  const run = newRun('user-a');
  const other = await postCompletion(server.url, auth(run, 'user-b'));
  assert.deepEqual([other.status, other.body.error], [401, 'callback_signature_invalid'], "user B cannot present user A's grant");
  const caseChanged = await postCompletion(server.url, auth(run, 'User-A'));
  assert.equal(caseChanged.status, 401, 'the owner match is exact and case-sensitive');
  const forged = await postCompletion(server.url, { grant: `${run.runId}.${'x'.repeat(43)}`, owner: 'user-a' });
  assert.equal(forged.status, 401, 'a grant with the right run id and the wrong secret is refused');
  const unknown = await postCompletion(server.url, { grant: `${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}.${'x'.repeat(43)}`, owner: 'user-a' });
  assert.equal(unknown.status, 401);

  const nonce = 'replay-nonce-fixture-0001';
  const first = await postCompletion(server.url, { ...auth(run), nonce });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const replay = await postCompletion(server.url, { ...auth(run), nonce });
  assert.deepEqual([replay.status, replay.body.error], [401, 'callback_signature_invalid'], 'the identical request replayed is refused');
  assert.equal(state.calls.length, 1, 'the replay never reached the bot');

  const noIssuer = runs.registerEngineRun('user-a', 'score');
  const issuerless = await postCompletion(server.url, auth(noIssuer));
  assert.equal(issuerless.status, 401, 'a run registered without a verified owner issuer can never be admitted');
  runs.settleEngineRun(noIssuer.runId, { code: 0 });

  runs.settleEngineRun(run.runId, { code: 0 });
  const revoked = await postCompletion(server.url, auth(run));
  assert.equal(revoked.status, 401, 'a settled run grant is revoked');
  assert.equal(state.calls.length, 1);
});

test("the kernel's owner refresh and permission check gate every admitted grant, and the route requires the owner as its identity", async () => {
  healthyWorker();
  const run = newRun('user-a');
  const inactive = await harness.startServer({ directory: () => ({ isActive: false }) });
  try {
    const answer = await postCompletion(inactive.url, auth(run));
    assert.deepEqual([answer.status, answer.body], [403, { error: 'callback_owner_unavailable' }]);
  } finally { await inactive.close(); }
  const unpermitted = await harness.startServer({ permitted: () => false });
  try {
    const answer = await postCompletion(unpermitted.url, auth(run));
    assert.equal(answer.status, 403, 'an owner without career.execute is refused by the kernel');
  } finally { await unpermitted.close(); }
  const admittedElsewhere = await harness.startServer({ mountGuard: false, identity: { sub: 'user-b', principalIssuer: FIXTURE_ISSUER, isOperator: false } });
  try {
    const answer = await postCompletion(admittedElsewhere.url, auth(run));
    assert.deepEqual([answer.status, answer.body.error], [401, 'rail-grant-required'], 'no verifier ran, so no run is admitted whatever the identity says');
  } finally { await admittedElsewhere.close(); }
  assert.equal(state.calls.length, 0);
  runs.settleEngineRun(run.runId, { code: 0 });
});

test('an admitted completion runs once on the Career bot, direct and non-agentic, as the run owner', async () => {
  healthyWorker();
  const run = newRun('user-a');
  const answer = await postCompletion(server.url, {
    ...auth(run),
    body: { system: 'You score jobs.', prompt: 'Score this posting.', maxTokens: 700, jsonMode: true },
  });
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body, { ok: true, text: 'answer for user-a', model: 'm', provider: 'p' });
  assert.equal(state.calls.length, 1, 'exactly one accounted bot call per completion');
  const [{ agentId, request }] = state.calls;
  assert.equal(agentId, 'cb000000-0000-0000-0000-000000000001');
  assert.equal(request.userSub, 'user-a', 'cost is attributed to the run owner');
  assert.equal(request.taskId, `career-engine-${run.runId}`);
  assert.equal(request.direct, true);
  assert.equal(request.agenticMode, false);
  assert.equal(request.text, 'You score jobs.\n\nScore this posting.\n\nRespond with ONLY a single JSON object, no prose, no code fence.');
  assert.equal(runs.engineRunSnapshot(run.runId).railCalls, 1);
  assert.deepEqual(runs.settleEngineRun(run.runId, { code: 0 }).state, 'succeeded');
});

test('no dedicated node, a missing, offline or stale heartbeat, or a heartbeat read failure answers 503 and fails the run', async () => {
  const cases = [
    ['no-dedicated-node', () => { state.hasEndpoint = false; }],
    ['heartbeat-missing', () => { state.registration = () => null; }],
    ['heartbeat-missing', () => { state.registration = () => ({ status: 'offline', heartbeatAt: new Date().toISOString() }); }],
    ['heartbeat-stale', () => { state.registration = () => ({ status: 'online', heartbeatAt: new Date(Date.now() - 10 * 60_000).toISOString() }); }],
    ['heartbeat-read-failed', () => { state.registration = () => { throw new Error('redis down'); }; }],
  ];
  for (const [detail, arrange] of cases) {
    healthyWorker();
    arrange();
    const run = newRun('user-a');
    const response = await postCompletion(server.url, auth(run));
    assert.deepEqual(response.body, { ok: false, error: 'career-worker-unavailable', detail }, detail);
    assert.equal(response.status, 503);
    assert.equal(state.calls.length, 0, `${detail}: the bot must not be reached`);
    const terminal = runs.settleEngineRun(run.runId, { code: 1 });
    assert.deepEqual([terminal.state, terminal.reason], ['failed', 'career-worker-unavailable'], detail);
  }
});

test('a transport failure answers 503 and the run ends failed, never running', async () => {
  healthyWorker();
  state.behavior = async () => { throw new Error('connect ECONNREFUSED career-bot:5000'); };
  const run = newRun('user-a');
  const response = await postCompletion(server.url, auth(run));
  assert.deepEqual([response.status, response.body.error], [503, 'career-worker-unavailable']);
  assert.equal(runs.engineRunSnapshot(run.runId).state, 'running', 'still running until the engine exits');
  const terminal = runs.settleEngineRun(run.runId, { code: 1 });
  assert.deepEqual([terminal.state, terminal.reason], ['failed', 'career-worker-unavailable']);
});

test('budget, brain and bot-side failures keep their own codes', async () => {
  for (const [error, status, code] of [
    [Object.assign(new Error('cap'), { code: 'budget_cap_exceeded', statusCode: 402 }), 402, 'budget-cap-exceeded'],
    [Object.assign(new Error('no brain'), { code: 'NO_HOSTED_BRAIN' }), 424, 'no-configured-brain'],
  ]) {
    healthyWorker();
    state.behavior = async () => { throw error; };
    const run = newRun('user-a');
    const response = await postCompletion(server.url, auth(run));
    assert.deepEqual([response.status, response.body.error], [status, code]);
    assert.equal(runs.settleEngineRun(run.runId, { code: 1 }).reason, code);
  }
  healthyWorker();
  state.behavior = async () => ({ success: false, response: '', error: 'provider refused' });
  const run = newRun('user-a');
  const response = await postCompletion(server.url, auth(run));
  assert.deepEqual([response.status, response.body.error], [502, 'career-worker-error']);
  runs.settleEngineRun(run.runId, { code: 1 });
});

test('the package semaphore bounds concurrent Career bot completions', async () => {
  process.env.CAREER_WORKER_RAIL_CONCURRENCY = '2';
  const bounded = await harness.startServer();
  try {
    healthyWorker();
    const gate = deferred();
    let inFlight = 0;
    let peak = 0;
    state.behavior = async (request) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await gate.promise;
      inFlight -= 1;
      return { success: true, response: request.taskId };
    };
    const run = newRun('user-a');
    const pending = Array.from({ length: 5 }, () => postCompletion(bounded.url, auth(run)));
    await waitFor(() => state.calls.length === 2, 'two admitted calls');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(state.calls.length, 2, 'the third call waits for a slot');
    gate.resolve();
    const answers = await Promise.all(pending);
    assert.deepEqual(answers.map((answer) => answer.status), [200, 200, 200, 200, 200]);
    assert.equal(peak, 2);
    assert.equal(state.calls.length, 5);
    runs.settleEngineRun(run.runId, { code: 0 });
  } finally {
    delete process.env.CAREER_WORKER_RAIL_CONCURRENCY;
    await bounded.close();
  }
});

test('the per-call deadline answers 504 and records a worker timeout on the run', { timeout: 20_000 }, async () => {
  process.env.CAREER_WORKER_RAIL_DEADLINE_MS = '1000';
  const deadlined = await harness.startServer();
  try {
    healthyWorker();
    const hung = deferred();
    state.behavior = () => hung.promise;
    const run = newRun('user-a');
    const startedAt = Date.now();
    const response = await postCompletion(deadlined.url, auth(run));
    assert.deepEqual([response.status, response.body.error], [504, 'career-worker-timeout']);
    assert.ok(Date.now() - startedAt < 5_000, 'the deadline bounded the call');
    assert.equal(state.calls[0].clientTimeoutMs, 1000, 'the node client carries the same deadline');
    hung.resolve({ success: true, response: 'late' });
    assert.equal(runs.settleEngineRun(run.runId, { code: 1 }).reason, 'career-worker-timeout');
  } finally {
    delete process.env.CAREER_WORKER_RAIL_DEADLINE_MS;
    await deadlined.close();
  }
});

test('calls queued behind the semaphore get their full deadline once they hold a slot', { timeout: 20_000 }, async () => {
  // score_batch's default: 8 worker threads against the 2-slot rail. With a 400 ms bot and a
  // 1000 ms deadline the last pair is granted ~1200 ms after it arrived; the deadline must not
  // have been spent waiting, and nothing is dispatched only to be abandoned.
  process.env.CAREER_WORKER_RAIL_CONCURRENCY = '2';
  process.env.CAREER_WORKER_RAIL_DEADLINE_MS = '1000';
  const queued = await harness.startServer();
  try {
    healthyWorker();
    let inFlight = 0;
    let peak = 0;
    state.behavior = async (request) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 400));
      inFlight -= 1;
      return { success: true, response: request.taskId };
    };
    const run = newRun('user-a');
    const startedAt = Date.now();
    const answers = await within(Promise.all(Array.from({ length: 8 },
      () => postCompletion(queued.url, auth(run)))), 10_000, 'eight answers');
    const elapsed = Date.now() - startedAt;
    assert.deepEqual(answers.map((answer) => answer.status), Array(8).fill(200),
      JSON.stringify(answers.map((answer) => answer.body)));
    assert.ok(elapsed > 1000, `the last calls queued longer than the deadline (${elapsed} ms)`);
    assert.equal(peak, 2, 'the semaphore still bounds the bot');
    assert.equal(state.calls.length, 8, 'every call reached the bot exactly once');
    assert.deepEqual([runs.engineRunSnapshot(run.runId).railCalls, runs.settleEngineRun(run.runId, { code: 0 }).state],
      [8, 'succeeded']);
  } finally {
    delete process.env.CAREER_WORKER_RAIL_CONCURRENCY;
    delete process.env.CAREER_WORKER_RAIL_DEADLINE_MS;
    await queued.close();
  }
});

test('the wait for a slot has its own ceiling, and a queued call whose run is cancelled never reaches the bot', { timeout: 20_000 }, async () => {
  process.env.CAREER_WORKER_RAIL_CONCURRENCY = '1';
  process.env.CAREER_WORKER_RAIL_QUEUE_WAIT_MS = '1000';
  const saturated = await harness.startServer();
  const hung = deferred();
  try {
    healthyWorker();
    state.behavior = () => hung.promise;
    const holder = newRun('user-a');
    const holding = postCompletion(saturated.url, auth(holder));
    await waitFor(() => state.calls.length === 1, 'the call holding the only slot');

    const starved = newRun('user-a');
    const startedAt = Date.now();
    const timedOut = await within(
      postCompletion(saturated.url, auth(starved)), 5_000, 'the queue ceiling');
    assert.deepEqual([timedOut.status, timedOut.body.error], [504, 'career-worker-queue-timeout']);
    assert.ok(Date.now() - startedAt < 5_000, 'the queue ceiling bounded the wait');
    assert.equal(state.calls.length, 1, 'a call that never got a slot is never dispatched');
    const starvedTerminal = runs.settleEngineRun(starved.runId, { code: 1 });
    assert.deepEqual([starvedTerminal.state, starvedTerminal.reason], ['failed', 'career-worker-queue-timeout']);

    const cancelled = newRun('user-a');
    const waiting = postCompletion(saturated.url, auth(cancelled));
    await waitFor(() => runs.engineRunSnapshot(cancelled.runId).railCalls === 1, 'the queued call');
    assert.equal(runs.cancelEngineRun('user-a', cancelled.runId).status, 'cancelled');
    const refusedWait = await within(waiting, 5_000, 'the cancelled queued call');
    assert.deepEqual([refusedWait.status, refusedWait.body.error], [409, 'run-cancelled']);
    assert.equal(state.calls.length, 1, "a cancelled run's queued call is never dispatched");

    hung.resolve({ success: true, response: 'held' });
    const held = await within(holding, 5_000, 'the held call');
    assert.deepEqual([held.status, held.body.text], [200, 'held']);
    runs.settleEngineRun(holder.runId, { code: 0 });
    runs.settleEngineRun(cancelled.runId, { code: 137 });
  } finally {
    hung.resolve({ success: true, response: 'released' });
    delete process.env.CAREER_WORKER_RAIL_CONCURRENCY;
    delete process.env.CAREER_WORKER_RAIL_QUEUE_WAIT_MS;
    await saturated.close();
  }
});

test('the engine client waits for the queue ceiling plus the deadline, so the rail answers first', () => {
  process.env.CAREER_WORKER_RAIL_QUEUE_WAIT_MS = '600000';
  process.env.CAREER_WORKER_RAIL_DEADLINE_MS = '300000';
  try {
    const env = runs.railChildEnv('run-id', 'token', { port: '5000' });
    assert.equal(env.CAREER_RAIL_TIMEOUT_S, String(600 + 300 + 30));
    assert.deepEqual(Object.keys(env).sort(), ['CAREER_RAIL_GRANT', 'CAREER_RAIL_RUN_ID', 'CAREER_RAIL_TIMEOUT_S', 'CAREER_RAIL_URL'],
      'the child contract is exactly four entries; the fleet service secret is not one of them');
    assert.ok(!Object.values(runs.railChildEnv('run-id', 'token', { port: '5000', serviceSecret: SECRET })).includes(SECRET),
      'a caller cannot smuggle the fleet secret in through the minting options');
  } finally {
    delete process.env.CAREER_WORKER_RAIL_QUEUE_WAIT_MS;
    delete process.env.CAREER_WORKER_RAIL_DEADLINE_MS;
  }
});

test("an owner's cancellation aborts a waiting call with 409, revokes the token and fences the tree", async () => {
  healthyWorker();
  const hung = deferred();
  state.behavior = () => hung.promise;
  const run = newRun('user-a');
  let terminated = 0;
  runs.attachRunTerminator(run.runId, () => { terminated += 1; });
  const pending = postCompletion(server.url, auth(run));
  await waitFor(() => state.calls.length === 1, 'the in-flight call');
  assert.equal(runs.cancelEngineRun('user-b', run.runId).status, 'not-found', "another user cannot cancel A's run");
  assert.equal(terminated, 0);
  assert.equal(runs.cancelEngineRun('user-a', run.runId).status, 'cancelled');
  const response = await pending;
  assert.deepEqual([response.status, response.body.error], [409, 'run-cancelled']);
  assert.equal(terminated, 1, 'the process tree is terminated exactly once');
  const later = await postCompletion(server.url, auth(run));
  assert.equal(later.status, 401, 'a cancelled run grant is refused');
  hung.resolve({ success: true, response: 'late' });
  const terminal = runs.settleEngineRun(run.runId, { code: 137 });
  assert.deepEqual([terminal.state, terminal.reason], ['cancelled', 'cancelled-by-owner']);
  assert.equal(runs.cancelEngineRun('user-a', run.runId).status, 'already-terminal');
});

test('the body has its own content type and ceiling, independent of the kernel JSON default', async () => {
  healthyWorker();
  const run = newRun('user-a');
  const signed = auth(run);
  const wrongType = await postCompletion(server.url, { ...signed, contentType: 'application/json' });
  assert.deepEqual([wrongType.status, wrongType.body.error], [401, 'callback_signature_invalid'],
    'a body under another content type is never read, so nothing can be verified');
  const notJson = await postCompletion(server.url, { ...signed, raw: '{nope' });
  assert.deepEqual([notJson.status, notJson.body.error], [400, 'invalid-json']);
  const noPrompt = await postCompletion(server.url, { ...signed, body: { system: 'SYS', prompt: '   ' } });
  assert.deepEqual([noPrompt.status, noPrompt.body.error], [400, 'invalid-completion']);
  const generation = 'x'.repeat(300_000);
  const large = await postCompletion(server.url, { ...signed, body: { system: 'SYS', prompt: generation } });
  assert.equal(large.status, 200, 'a 300 KB generation prompt passes the rail ceiling (the kernel default is 100 KB)');
  assert.equal(state.calls.length, 1);
  runs.settleEngineRun(run.runId, { code: 0 });

  process.env.CAREER_WORKER_RAIL_MAX_BODY_BYTES = '65536';
  const small = await harness.startServer();
  try {
    const bounded = newRun('user-a');
    const tooLarge = await postCompletion(small.url, { ...auth(bounded), body: { prompt: 'y'.repeat(70_000) } });
    assert.deepEqual([tooLarge.status, tooLarge.body.error], [401, 'callback_signature_invalid'],
      'an oversize body is refused by the verifier, so it is never signed over or read');
    assert.equal(state.calls.length, 1, 'an oversize body never reaches the bot');
    runs.settleEngineRun(bounded.runId, { code: 0 });
  } finally {
    delete process.env.CAREER_WORKER_RAIL_MAX_BODY_BYTES;
    await small.close();
  }
});

test('the manifest mounts the compiled rail on the signed callback rail, and the rail sources carry no bearer or secret contract', () => {
  const manifest = readFileSync(join(packageRoot, 'oshal-app.yaml'), 'utf8');
  const block = manifest.match(/- module: routes\/career-worker-rail\.js\n((?:\s{4}.+\n)+)/);
  assert.ok(block, 'the rail route is declared');
  assert.match(block[1], /factory: createCareerWorkerRailRoutes/);
  assert.match(block[1], /mountPath: \/api\/career-hunter\/engine\n/);
  assert.match(block[1], /auth: public\n/);
  assert.match(block[1], /callbackVerifier: createCareerRailCallbackVerifier\n/);
  assert.match(manifest, /^  - signed-package-callbacks$/m, 'the kernel skill the verifier rides on is declared');
  assert.match(manifest, /^  - application-authorization$/m);
  const authorization = manifest.match(/^authorization:\n((?:[ \t]+[^\n]*\n|\n)+)/m)?.[1];
  assert.ok(authorization, 'the package authorization declaration is present');
  assert.match(authorization, /^  version: 1$/m);
  assert.match(authorization, /^  catalog: authorization\.yaml$/m);
  assert.match(authorization, /^  roleTemplates:$/m);
  assert.match(manifest, /^  - experience-roles$/m, 'composite roles use the declared kernel capability');
  for (const file of ['routes/career-worker-rail.js', 'src-routes/career-worker-rail.ts']) {
    const source = readFileSync(join(packageRoot, file), 'utf8');
    assert.match(source, /createCareerRailCallbackVerifier/, `${file} exports the manifest's verifier`);
    assert.match(source, /admittedRunOf/, `${file} reads the run the verifier admitted`);
    assert.match(source, /getRequestIdentity/, `${file} requires the kernel identity to be the run owner`);
    assert.match(source, /executeBotOrInline/, `${file} uses the accounted bot rail`);
    assert.match(source, /registerCareerAuthorization/, `${file} registers the catalog's resource adapter`);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /getTrustedServiceUserSub|redeemRunToken|x-career-run-token|x-service-secret|x-oshal-user-sub/i,
      `${file} has no code path for the retired service-secret contract`);
  }
  for (const file of ['routes/career-engine-runner.js', 'src-routes/career-engine-runner.ts', 'lib/career-engine-runs.js']) {
    const code = readFileSync(join(packageRoot, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /SWARM_SERVICE_SECRET|serviceSecret/, `${file} never reads or mints the fleet service secret for an engine child`);
  }
});
