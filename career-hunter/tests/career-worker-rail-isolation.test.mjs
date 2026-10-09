/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Two-user isolation and cost attribution on the Career worker rail. The COMPILED runner module registers one engine run per user and builds each child's environment; its spawn is replaced by an in-memory EventEmitter child (launchCapturing), so no engine process runs and the environment checked is the one the runner hands to spawn. It carries only that run's runner-minted rail token, run id and brokered Firecrawl key (never the other user's, never a model key or a smuggled rail entry), and posting with the URL/secret/token the runner minted reaches the Career bot as exactly one executeBotOrInline call per completion whose userSub and taskId belong to that run's owner. Neither user can redeem the other's token, and a settled run's token is revoked. Scoped doubles: the runner's spawn, the user-store leaf and the logger here, plus the harness doubles on the rail side (mirrored kernel authz decoder and service mount guard over node:http, a recording Router, BotNodeClient.hasEndpoint, the endpoint resolver, the heartbeat registry, and executeBotOrInline as a recorder). Real companions, still open: a real spawned bin/oshal-jobhunter.js child per user, the kernel mount with BotNodeClient and the Redis heartbeat, and settleBotNodeCostTask plus the live two-user receipt (package BACKLOG, 1.24.0).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The signed rail (1.25.1): each child's environment carries its own per-run grant (CAREER_RAIL_GRANT) and never the fleet service secret or the retired bearer token, even when a caller smuggles them; a run launched without a verified owner issuer gets no rail entries at all; each user's completions are signed with their own grant, user B signing with A's grant is refused by the verifier, and the harness now mirrors the kernel's signed-callback rail rather than the service mount guard. The real kernel boundary is crossed by tests/career-rail-kernel-boundary.core.test.js.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { FIXTURE_ISSUER, encodeSubject, loadRailHarness, postCompletion } from './helpers/worker-rail-harness.mjs';

const require = createRequire(import.meta.url);
const SECRET = 'isolation-fixture-service-secret';
const fixtureRoot = mkdtempSync(join(tmpdir(), 'career-rail-isolation-'));
const savedEnv = Object.fromEntries(['SWARM_SERVICE_SECRET', 'PORT', 'JOBHUNTER_STORE_ROOT', 'JOBHUNTER_CLI']
  .map((key) => [key, process.env[key]]));
process.env.SWARM_SERVICE_SECRET = SECRET;
process.env.JOBHUNTER_STORE_ROOT = join(fixtureRoot, 'store');
process.env.JOBHUNTER_CLI = join(fixtureRoot, 'never-spawned.js');

const harness = loadRailHarness();
const { state, runs } = harness;

/** Load the compiled runner with only its logger and user-store leaf replaced. */
function loadRunner() {
  const originalLoad = Module._load;
  Module._load = function loadRunnerStubs(request, ...rest) {
    if (request === '@/shared/logger') {
      return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
    }
    if (request === './career-user-store') {
      return { careerTenant: () => 'default', userPaths: (user) => ({ userDir: join(fixtureRoot, 'store', 'default', user) }) };
    }
    return originalLoad.call(this, request, ...rest);
  };
  try { return require('../routes/career-engine-runner.js'); }
  finally { Module._load = originalLoad; }
}

const runner = loadRunner();
let server;

before(async () => {
  server = await harness.startServer();
  process.env.PORT = String(server.port);
});
after(async () => {
  await server?.close();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
});

/** A child whose lifecycle the test drives; it records the environment it was spawned with. */
function launchCapturing(userSub, extra, launch = {}) {
  const child = new EventEmitter();
  Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), pid: 40_000, exitCode: null, kill: () => true });
  let env;
  // `tailor` is a model-bearing verb that owns only the user's store; a corpus writer such as
  // `score` would also take the shared cross-user corpus slot and serialize the two users.
  const started = runner.runCliAsync(userSub, ['tailor'], extra, {
    slot: 'isolation', timeoutMs: 60_000, ownerIssuer: FIXTURE_ISSUER, ...launch,
    spawnProcess: (_command, _args, options) => { env = options.env; process.nextTick(() => child.emit('spawn')); return child; },
  });
  return { child, started, env: () => env };
}

/** Finish a captured child the way a real exit does. */
function exit(child, code) {
  child.exitCode = code;
  child.emit('close', code);
}

test('each engine child carries only its own rail grant, run id and brokered key, and never the fleet secret', async () => {
  const smuggled = {
    ANTHROPIC_API_KEY: 'smuggled-anthropic', OPENAI_API_KEY: 'smuggled-openai', OSHAL_CRED_ANTHROPIC: 'smuggled',
    CAREER_RAIL_TOKEN: 'smuggled-token', CAREER_RAIL_SERVICE_SECRET: SECRET, CAREER_RAIL_GRANT: 'smuggled-grant',
    CAREER_RAIL_URL: 'http://192.168.50.10:5000/steal', CODEX_HOME: '/home/user/.codex',
  };
  const a = launchCapturing('user-a', { OSHAL_CRED_FIRECRAWL: 'firecrawl-a', ...smuggled });
  const b = launchCapturing('user-b', { OSHAL_CRED_FIRECRAWL: 'firecrawl-b' });
  assert.equal((await a.started).started, true);
  assert.equal((await b.started).started, true);
  const envA = a.env();
  const envB = b.env();
  assert.equal(envA.OSHAL_USER_SUB, 'user-a');
  assert.equal(envA.FIRECRAWL_API_KEY, 'firecrawl-a');
  assert.equal(envB.FIRECRAWL_API_KEY, 'firecrawl-b');
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OSHAL_CRED_ANTHROPIC']) {
    assert.equal(envA[key], undefined, `${key} never reaches the engine`);
  }
  assert.notEqual(envA.CAREER_RAIL_GRANT, 'smuggled-grant', 'the runner, not the caller, mints the grant');
  assert.equal(envA.CAREER_RAIL_URL, `http://127.0.0.1:${server.port}/api/career-hunter/engine/complete`);
  assert.equal(envA.CAREER_RAIL_SERVICE_SECRET, undefined, 'the fleet service secret is not forwarded, smuggled or otherwise');
  assert.equal(envA.CAREER_RAIL_TOKEN, undefined, 'the retired bearer token name is stripped');
  assert.ok(!Object.values(envA).includes(SECRET), 'the fleet secret reaches the child under no name');
  assert.ok(envA.CAREER_RAIL_GRANT.startsWith(`${envA.CAREER_RAIL_RUN_ID}.`), 'the grant names its own run');
  assert.match(envA.CODEX_HOME, /[\\/]user-a[\\/]\.brokered-auth-only[\\/]codex$/);
  assert.notEqual(envA.CAREER_RAIL_GRANT, envB.CAREER_RAIL_GRANT);
  assert.notEqual(envA.CAREER_RAIL_RUN_ID, envB.CAREER_RAIL_RUN_ID);
  assert.ok(!Object.values(envA).includes('firecrawl-b') && !Object.values(envA).includes(envB.CAREER_RAIL_GRANT),
    "user A's child holds nothing of user B's");
  assert.ok(runs.redeemRunToken(envA.CAREER_RAIL_GRANT, 'user-a'));
  assert.equal(runs.redeemRunToken(envA.CAREER_RAIL_GRANT, 'user-b'), null, "B cannot redeem A's grant");
  assert.equal(runs.redeemRunToken(envB.CAREER_RAIL_GRANT, 'user-a'), null, "A cannot redeem B's grant");
  exit(a.child, 0);
  exit(b.child, 1);
  assert.equal(runs.redeemRunToken(envA.CAREER_RAIL_GRANT, 'user-a'), null, 'a settled run grant is revoked');
  assert.deepEqual([runs.engineRunSnapshot(envA.CAREER_RAIL_RUN_ID).state, runs.engineRunSnapshot(envB.CAREER_RAIL_RUN_ID).state],
    ['succeeded', 'failed']);
});

test('a run launched without a verified owner issuer is registered but gets no rail entries', async () => {
  const c = launchCapturing('user-c', { OSHAL_CRED_FIRECRAWL: 'firecrawl-c' }, { ownerIssuer: null });
  assert.equal((await c.started).started, true);
  const env = c.env();
  for (const key of ['CAREER_RAIL_URL', 'CAREER_RAIL_GRANT', 'CAREER_RAIL_RUN_ID', 'CAREER_RAIL_TIMEOUT_S']) {
    assert.equal(env[key], undefined, `${key}: nothing the kernel could never admit is minted`);
  }
  assert.equal(env.FIRECRAWL_API_KEY, 'firecrawl-c', 'deterministic work still runs');
  assert.equal(runs.listEngineRuns('user-c').length, 1, 'the run is still listed and cancellable');
  exit(c.child, 0);
});

test('concurrent completions from two users are attributed to their own run owners', async () => {
  state.calls.length = 0;
  state.behavior = async (request) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { success: true, response: `for ${request.userSub}` };
  };
  const a = launchCapturing('user-a', {});
  const b = launchCapturing('user-b', {});
  await Promise.all([a.started, b.started]);
  const post = (env, subject) => postCompletion(env.CAREER_RAIL_URL, {
    grant: env.CAREER_RAIL_GRANT, owner: subject,
    body: { system: 'SYS', prompt: `prompt of ${subject}` },
  });
  const [answerA, answerB, crossed] = await Promise.all([
    post(a.env(), 'user-a'), post(b.env(), 'user-b'), post(a.env(), 'user-b'),
  ]);
  assert.deepEqual([answerA.status, answerA.body.text], [200, 'for user-a']);
  assert.deepEqual([answerB.status, answerB.body.text], [200, 'for user-b']);
  assert.equal(crossed.status, 401, "user B signing with A's grant is refused before the bot");
  assert.equal(state.calls.length, 2, 'exactly one accounted call per admitted completion');
  const byOwner = Object.fromEntries(state.calls.map(({ request }) => [request.userSub, request]));
  assert.equal(byOwner['user-a'].taskId, `career-engine-${a.env().CAREER_RAIL_RUN_ID}`);
  assert.equal(byOwner['user-b'].taskId, `career-engine-${b.env().CAREER_RAIL_RUN_ID}`);
  assert.match(byOwner['user-a'].text, /prompt of user-a/);
  assert.doesNotMatch(byOwner['user-a'].text, /user-b/);
  exit(a.child, 0);
  exit(b.child, 0);
});

test("a user's run list and cancellation never expose or reach another user's run", async () => {
  const a = launchCapturing('user-a', {});
  await a.started;
  const runId = a.env().CAREER_RAIL_RUN_ID;
  assert.ok(runs.listEngineRuns('user-a').some((run) => run.runId === runId));
  assert.ok(!runs.listEngineRuns('user-b').some((run) => run.runId === runId));
  assert.equal(runs.cancelEngineRun('user-b', runId).status, 'not-found');
  assert.equal(runs.engineRunSnapshot(runId).state, 'running');
  exit(a.child, 0);
  assert.equal(encodeSubject('user-a'), 'dXNlci1h', 'fixture subject encoding matches the kernel canonical form');
});
