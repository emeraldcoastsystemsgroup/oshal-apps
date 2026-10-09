/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard mounted routes against synchronous child processes and exercise delayed, bounded, nonzero, and rejected runner outcomes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Cover API aliases, automatic single-flight leases, split UTF-8 output, and finite process-tree termination.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Guard opaque preclaims, shared resources, controller-secret stripping, and transactional route wiring.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Follow decomposed route families and prove the retired classic board cannot restore a raw persistent child.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Prove automatic async and awaited duplicates are rejected before credential database access.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Keep the isolated runner fixture independent of the optional native SQLite package loaded by the user-store leaf.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Supply the kernel caller-identity boundary required when the user-store leaf is loaded in isolation.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Prove one admission deadline bounds hung credential queries and decryption before spawn and releases automatic leases.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Follow the kernel-owned Profile Studio dispatch boundary after capability binding and asset staging moved behind one awaited input object.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Career worker rail: invert the demo-operator carve case into the guard that every subject, the DEMO_MODE operator included, gets the empty login sandbox, no model key and no smuggled verdict or rail entry, while each real child receives its own runner-minted loopback rail entries; dispatch now brokers only Firecrawl, ignores any Anthropic row the query could return, and still fails closed on a Firecrawl decrypt failure.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import Module from 'node:module';
import { deploymentModeStub } from './helpers/deployment-mode-stub.mjs';
import { requestIdentity } from './helpers/request-identity-stub.mjs';

const require = createRequire(import.meta.url);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = mkdtempSync(join(tmpdir(), 'career-runner-'));
const fixtureCli = join(fixtureDir, 'fixture-cli.cjs');
const savedCli = process.env.JOBHUNTER_CLI;
const savedStore = process.env.JOBHUNTER_STORE_ROOT;
const savedSensitiveEnv = Object.fromEntries([
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'FIRECRAWL_API_KEY', 'SESSION_SECRET',
  'DEMO_MODE', 'OSHAL_OPERATOR_SUBS', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR',
].map((key) => [key, process.env[key]]));
// The brokered-only wall is the default posture under test; the demo carve opts in per test.
delete process.env.DEMO_MODE;
delete process.env.OSHAL_OPERATOR_SUBS;
delete process.env.CODEX_HOME;
delete process.env.CLAUDE_CONFIG_DIR;
const originalLoad = Module._load;
let decryptBehavior = async (_pool, _userSub, blob) => {
  if (blob === 'bad-ciphertext') throw new Error('fixture decrypt failed');
  return `plain:${blob}`;
};

process.env.ANTHROPIC_API_KEY = 'global-anthropic-must-not-leak';
process.env.OPENAI_API_KEY = 'global-openai-must-not-leak';
process.env.FIRECRAWL_API_KEY = 'global-firecrawl-must-not-leak';
process.env.SESSION_SECRET = 'kernel-secret-must-not-leak';

writeFileSync(fixtureCli, `
const mode = process.argv[2];
if (mode === 'delay') {
  setTimeout(() => process.stdout.write(JSON.stringify({
    sub: process.env.OSHAL_USER_SUB,
    tenant: process.env.OSHAL_TENANT,
    store: process.env.JOBHUNTER_STORE_ROOT,
    extra: process.env.CH_TEST,
    globalAnthropic: process.env.ANTHROPIC_API_KEY,
    globalOpenai: process.env.OPENAI_API_KEY,
    globalFirecrawl: process.env.FIRECRAWL_API_KEY,
    kernelSecret: process.env.SESSION_SECRET,
    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
    codexHome: process.env.CODEX_HOME,
    home: process.env.HOME || process.env.USERPROFILE,
    portalLogins: process.env.OSHAL_PORTAL_LOGINS,
  })), 50);
} else if (mode === 'rail') {
  process.stdout.write(JSON.stringify({
    railUrl: process.env.CAREER_RAIL_URL,
    railGrant: process.env.CAREER_RAIL_GRANT,
    railRunId: process.env.CAREER_RAIL_RUN_ID,
    railToken: process.env.CAREER_RAIL_TOKEN,
    railSecret: process.env.CAREER_RAIL_SERVICE_SECRET,
    fleetSecret: process.env.SWARM_SERVICE_SECRET,
    anthropic: process.env.ANTHROPIC_API_KEY,
    credAnthropic: process.env.OSHAL_CRED_ANTHROPIC,
    portalLogins: process.env.OSHAL_PORTAL_LOGINS,
    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
    codexHome: process.env.CODEX_HOME,
  }));
} else if (mode === 'noisy') {
  process.stdout.write('x'.repeat(200001) + 'OUT-TAIL');
  process.stderr.write('y'.repeat(4001) + 'ERR-TAIL');
  process.exitCode = 7;
} else if (mode === 'hang') {
  const { spawn } = require('node:child_process');
  const heartbeat = process.env.CH_HEARTBEAT;
  const child = spawn(process.execPath, ['-e',
    "const fs=require('node:fs');const p=process.env.CH_HEARTBEAT;setInterval(()=>fs.appendFileSync(p,'.'),50)"
  ], { env: { ...process.env, CH_HEARTBEAT: heartbeat }, stdio: 'ignore' });
  process.stdout.write(String(child.pid));
  setInterval(() => {}, 1000);
}
`, 'utf8');

Module._load = function loadWithLoggerStub(request, ...rest) {
  if (request === '@/shared/deployment-mode') return deploymentModeStub();
  if (request === '@/shared/logger') {
    return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  }
  if (request === '@/app/routes/connector-token-crypto') {
    return { decryptToken: (...args) => decryptBehavior(...args) };
  }
  if (request === '@/app/routes/caller-sub') return { callerSub: (req) => req?.userSub || null };
  if (request === '@/shared/services/database/request-identity') return requestIdentity;
  // No trusted-service identity in these isolation runs — the OIDC-only path stays exercised.
  if (request === '@/shared/middleware/authz') return { getTrustedServiceUserSub: () => null };
  if (request === 'better-sqlite3') return class FixtureDatabase {};
  return originalLoad.call(this, request, ...rest);
};
process.env.JOBHUNTER_CLI = fixtureCli;
process.env.JOBHUNTER_STORE_ROOT = join(fixtureDir, 'store');
const runner = require('../routes/career-engine-runner.js');
const dispatch = require('../routes/career-engine-dispatch.js');

after(() => {
  Module._load = originalLoad;
  if (savedCli === undefined) delete process.env.JOBHUNTER_CLI;
  else process.env.JOBHUNTER_CLI = savedCli;
  if (savedStore === undefined) delete process.env.JOBHUNTER_STORE_ROOT;
  else process.env.JOBHUNTER_STORE_ROOT = savedStore;
  for (const [key, value] of Object.entries(savedSensitiveEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(fixtureDir, { recursive: true, force: true });
});

/** Return every mounted route source/runtime module, excluding engine/bin and test fixtures. */
function mountedRouteFiles() {
  return ['src-routes', 'routes'].flatMap((dir) => readdirSync(join(packageRoot, dir))
    .filter((name) => /\.(ts|js)$/.test(name))
    .map((name) => join(packageRoot, dir, name)));
}

/** Detect direct, namespaced, and locally aliased synchronous process APIs. */
function blockingApiViolations(source) {
  const violations = [];
  if (/\b(?:spawnSync|execSync|execFileSync|runCli)\s*\(/.test(source)) violations.push('direct call');
  if (/\.\s*(?:spawnSync|execSync|execFileSync)\b/.test(source)) violations.push('member reference');
  const aliases = [];
  for (const pattern of [
    /\b(?:spawnSync|execSync|execFileSync)\s+as\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:spawnSync|execSync|execFileSync)\s*:\s*([A-Za-z_$][\w$]*)/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:spawnSync|execSync|execFileSync)\b/g,
  ]) {
    for (const match of source.matchAll(pattern)) aliases.push(match[1]);
  }
  for (const alias of aliases) {
    if (new RegExp(`\\b${alias}\\s*\\(`).test(source)) violations.push(`alias call: ${alias}`);
  }
  return violations;
}

/** Minimal ChildProcess-shaped fixture whose lifecycle the test controls. */
function fakeChild(pid) {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.pid = pid;
  proc.exitCode = null;
  proc.kill = () => true;
  return proc;
}

test('mounted Career routes contain no synchronous child-process call in source or runtime bytes', () => {
  const violations = [];
  for (const file of mountedRouteFiles()) {
    const source = readFileSync(file, 'utf8');
    if (blockingApiViolations(source).length) violations.push(file);
  }
  assert.deepEqual(violations, []);
  for (const tree of ['src-routes', 'routes']) {
    const extension = tree === 'src-routes' ? 'ts' : 'js';
    for (const moduleName of [
      'career-application-routes', 'career-company-routes', 'career-run-routes',
      'career-strengthen-routes', 'career-resume-studio-routes',
    ]) {
      const relative = `${tree}/${moduleName}.${extension}`;
      assert.match(readFileSync(join(packageRoot, relative), 'utf8'), /career-engine-(?:dispatch|runner)/,
        `${relative} bypasses the shared async runner`);
    }
  }
});

test('mounted commands cannot bypass brokerage, shared leases, or transactional upload wiring', () => {
  for (const tree of ['src-routes', 'routes']) {
    const extension = tree === 'src-routes' ? 'ts' : 'js';
    const surfaces = readFileSync(join(packageRoot, tree, `career-surface-routes.${extension}`), 'utf8');
    const cron = readFileSync(join(packageRoot, tree, `career-hunter-cron.${extension}`), 'utf8');
    const artifacts = readFileSync(join(packageRoot, tree, `career-artifacts.${extension}`), 'utf8');
    const upload = readFileSync(join(packageRoot, tree, `career-resume-upload.${extension}`), 'utf8');
    assert.doesNotMatch(surfaces, /child_process|resolveEngineCli|buildCareerEngineProcessEnv/);
    assert.match(surfaces, /board-native/);
    assert.match(surfaces, /redirect\)?\(308, ['"]\/api\/career-hunter\/board-native['"]\)/);
    assert.match(cron, /career-engine-dispatch/);
    assert.match(artifacts, /tryAcquireRun/);
    assert.match(artifacts, /writeFileAtomic/);
    assert.match(artifacts, /absorb-batch/);
    assert.match(artifacts, /randomUUID/);
    assert.match(artifacts, /rejectEngineStart/);
    for (const boundary of ['tryAcquireRun', 'snapshotFiles', 'writeFileAtomic', 'restoreFiles', 'rejectEngineStart']) {
      assert.match(upload, new RegExp(boundary));
    }
  }
  const wrapper = readFileSync(join(packageRoot, 'bin', 'oshal-jobhunter.js'), 'utf8');
  assert.match(wrapper, /case 'absorb-batch'/);
  assert.match(wrapper, /inheritedEngineEnv/);
  assert.doesNotMatch(wrapper, /const env = \{\s*\.\.\.process\.env/);
});

test('the source guard rejects direct, member, and aliased synchronous APIs', () => {
  for (const mutation of [
    `spawnSync('node')`,
    `execSync('node')`,
    `execFileSync('node')`,
    `runCli('user', [])`,
    `childProcess.spawnSync('node')`,
    `import { spawnSync as stop } from 'child_process'; stop('node')`,
    `const { execSync: stop } = require('child_process'); stop('node')`,
    `const stop = execFileSync; stop('node')`,
  ]) assert.ok(blockingApiViolations(mutation).length, `guard missed: ${mutation}`);
});

test('Profile Studio awaits the kernel-owned task dispatch before interpreting its result', () => {
  for (const relative of [
    'src-routes/career-profile-studio-routes.ts',
    'routes/career-profile-studio-routes.js',
  ]) {
    const source = readFileSync(join(packageRoot, relative), 'utf8');
    assert.match(source, /const r = await (?:[^;]*dispatchProfileUpdate\)\()?[\s\S]*?\{[\s\S]*?plan,[\s\S]*?store,[\s\S]*?assetRoot:/,
      `${relative} treats the asynchronous dispatch Promise as a completed result`);
  }
});

test('a delayed real child leaves the event loop responsive and receives the scoped environment', async () => {
  const resultPromise = runner.runCliAwait('user-42', ['delay'], { CH_TEST: 'present' });
  const first = await Promise.race([
    resultPromise.then(() => 'child'),
    new Promise((resolve) => setTimeout(() => resolve('timer'), 0)),
  ]);
  assert.equal(first, 'timer', 'the API event loop could not run a zero-delay timer while the child worked');
  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.out), {
    sub: 'user-42',
    tenant: 'default',
    store: join(fixtureDir, 'store'),
    extra: 'present',
    claudeConfigDir: join(fixtureDir, 'store', 'default', 'user-42', '.brokered-auth-only', 'claude'),
    codexHome: join(fixtureDir, 'store', 'default', 'user-42', '.brokered-auth-only', 'codex'),
    home: process.env.HOME || process.env.USERPROFILE,
  });
});

test('every subject, the demo-mode operator included, gets the login sandbox, no model key and its own rail entries', async () => {
  const walled = (sub) => ({
    claudeConfigDir: join(fixtureDir, 'store', 'default', sub, '.brokered-auth-only', 'claude'),
    codexHome: join(fixtureDir, 'store', 'default', sub, '.brokered-auth-only', 'codex'),
  });
  const smuggled = {
    [`OSHAL_PORTAL_LOGINS`]: '1', ANTHROPIC_API_KEY: 'smuggled', OSHAL_CRED_ANTHROPIC: 'smuggled',
    CAREER_RAIL_TOKEN: 'smuggled-token', CAREER_RAIL_SERVICE_SECRET: 'smuggled-secret', CAREER_RAIL_GRANT: 'smuggled-grant',
    CAREER_RAIL_URL: 'http://192.168.50.10:5000/steal',
    CODEX_HOME: '/home/user/.codex', CLAUDE_CONFIG_DIR: '/home/user/.claude',
  };
  const railEnvOf = async (sub, launch = { ownerIssuer: 'https://issuer.oshal.example.com' }) => {
    let runId;
    const result = await runner.runCliAwait(sub, ['rail'], smuggled, { ...launch, onRunStarted: (id) => { runId = id; } });
    assert.equal(result.ok, true, result.err);
    return { ...JSON.parse(result.out), observedRunId: runId };
  };
  process.env.DEMO_MODE = 'true';
  process.env.OSHAL_OPERATOR_SUBS = 'operator-42';
  process.env.SWARM_SERVICE_SECRET = 'fixture-service-secret';
  process.env.PORT = '5123';
  try {
    for (const sub of ['operator-42', 'guest-7']) {
      const env = await railEnvOf(sub);
      assert.deepEqual({ claudeConfigDir: env.claudeConfigDir, codexHome: env.codexHome }, walled(sub),
        `${sub}: the vendor-login sandbox is unconditional`);
      assert.equal(env.portalLogins, undefined, `${sub}: the retired verdict never reaches the launcher`);
      assert.equal(env.anthropic, undefined, `${sub}: no model key, controller or smuggled`);
      assert.equal(env.credAnthropic, undefined, `${sub}: no brokered model key`);
      assert.equal(env.railUrl, 'http://127.0.0.1:5123/api/career-hunter/engine/complete', `${sub}: loopback rail only`);
      assert.notEqual(env.railGrant, 'smuggled-grant', `${sub}: the runner mints the grant`);
      assert.ok(env.railGrant.startsWith(`${env.observedRunId}.`), `${sub}: the grant names the run`);
      assert.equal(env.railSecret, undefined, `${sub}: the fleet secret is never forwarded to the engine`);
      assert.equal(env.fleetSecret, undefined, `${sub}: nor under its own name`);
      assert.equal(env.railToken, undefined, `${sub}: the retired bearer token is stripped`);
      assert.equal(env.railRunId, env.observedRunId, `${sub}: the observer sees the same run id the child holds`);
    }
    const noIssuer = await railEnvOf('guest-7', {});
    assert.deepEqual([noIssuer.railUrl, noIssuer.railGrant, noIssuer.railRunId], [undefined, undefined, undefined],
      'a launch that established no verified issuer mints no rail entries');
    assert.ok(noIssuer.observedRunId, 'the run is still registered');
    const viaIdentity = await requestIdentity.runWithRequestIdentity(
      { sub: 'guest-7', principalIssuer: 'https://issuer.oshal.example.com', isOperator: false },
      async () => {
        let runId;
        const result = await dispatch.runCareerCliAwait({ query: async () => ({ rows: [] }) }, 'guest-7', ['rail'], {}, {
          onRunStarted: (id) => { runId = id; }, spawnProcess: undefined,
        });
        return { ...JSON.parse(result.out), observedRunId: runId };
      });
    assert.ok(viaIdentity.railGrant?.startsWith(`${viaIdentity.observedRunId}.`),
      "the dispatch reads the issuer from the kernel's request identity, so a route launch is minted a grant");
    assert.equal(typeof runner.operatorPortalFallback, 'undefined', 'the carve predicate is gone');
    assert.equal(runner.PORTAL_LOGINS_ENV, undefined);
  } finally {
    delete process.env.DEMO_MODE;
    delete process.env.OSHAL_OPERATOR_SUBS;
    delete process.env.SWARM_SERVICE_SECRET;
    delete process.env.PORT;
  }
});

test('mounted dispatch brokers only the caller credentials and never spawns on decrypt failure', async () => {
  const decrypted = [];
  const priorDecrypt = decryptBehavior;
  decryptBehavior = async (_pool, _userSub, blob) => { decrypted.push(blob); return `plain:${blob}`; };
  const pool = {
    query: async (query, params) => {
      const text = typeof query === 'string' ? query : query.text;
      const values = typeof query === 'string' ? params : query.values;
      assert.deepEqual(values, ['broker-user']);
      assert.match(text, /provider = 'firecrawl'/);
      assert.doesNotMatch(text, /anthropic/, 'the model credential is not even selected');
      // Even if the store returned an Anthropic row, dispatch must ignore it.
      return { rows: [
        { provider: 'anthropic', access_token: 'anth-cipher' },
        { provider: 'firecrawl', access_token: 'fire-cipher' },
        { provider: 'firecrawl', access_token: 'older-fire-cipher' },
      ] };
    },
  };
  let childEnv;
  const child = fakeChild(18_001);
  const started = await dispatch.runCareerCliAsync(
    pool, 'broker-user', ['broker'], { CH_TEST: 'present', OSHAL_CRED_ANTHROPIC: 'wrong' },
    { slot: 'broker', timeoutMs: 5000, spawnProcess: (_command, _args, options) => {
      childEnv = options.env;
      process.nextTick(() => child.emit('spawn'));
      return child;
    } },
  );
  decryptBehavior = priorDecrypt;
  assert.deepEqual(started, { started: true });
  assert.deepEqual(decrypted, ['fire-cipher'], 'only the newest Firecrawl row is decrypted');
  assert.equal(childEnv.OSHAL_CRED_ANTHROPIC, undefined, 'a caller-supplied model credential is stripped');
  assert.equal(childEnv.OSHAL_CRED_FIRECRAWL, 'plain:fire-cipher');
  assert.equal(childEnv.CAREER_HUNTER_BROKER_COMPLETE, '1');
  assert.equal(childEnv.CH_TEST, 'present');
  // The brokered Firecrawl key reaches the engine under the name it reads — and no model key does:
  // the controller's own keys (global-*-must-not-leak) are never in the child either.
  assert.equal(childEnv.ANTHROPIC_API_KEY, undefined);
  assert.equal(childEnv.FIRECRAWL_API_KEY, 'plain:fire-cipher');
  assert.equal(childEnv.OPENAI_API_KEY, undefined);
  assert.equal(childEnv.SESSION_SECRET, undefined);
  assert.equal(childEnv.CLAUDE_CONFIG_DIR, join(fixtureDir, 'store', 'default', 'broker-user', '.brokered-auth-only', 'claude'));
  child.exitCode = 0;
  child.emit('close', 0);

  let spawned = false;
  const failed = await dispatch.runCareerCliAsync({
    query: async () => ({ rows: [{ provider: 'firecrawl', access_token: 'bad-ciphertext' }] }),
  }, 'broker-user', ['broker-fail'], {}, { spawnProcess: () => { spawned = true; return fakeChild(18_002); } });
  assert.deepEqual(failed, { started: false, err: 'career engine credentials unavailable' });
  assert.equal(spawned, false);
});

test('async dispatch times out a hung credential query before spawn and releases admission', async () => {
  let spawned = false;
  const result = await dispatch.runCareerCliAsync(
    { query: () => new Promise(() => {}) },
    'hung-query-user', ['broker-query-timeout'], {}, {
      deadlineAt: Date.now() + 40,
      spawnProcess: () => { spawned = true; return fakeChild(18_100); },
    },
  );
  assert.deepEqual(result, {
    started: false, err: 'career engine credential brokerage timed out', timedOut: true,
  });
  assert.equal(spawned, false);
  const next = runner.tryAcquireRun('hung-query-user', 'user-store');
  assert.equal(next.status, 'ok');
  runner.releaseRun(next);
});

test('awaited dispatch times out hung decryption before spawn and releases admission', async () => {
  const priorDecrypt = decryptBehavior;
  decryptBehavior = () => new Promise(() => {});
  try {
    const result = await dispatch.runCareerCliAwait(
      { query: async () => ({ rows: [{ provider: 'firecrawl', access_token: 'cipher' }] }) },
      'hung-decrypt-user', ['broker-decrypt-timeout'], {}, { deadlineAt: Date.now() + 40 },
    );
    assert.deepEqual(result, {
      ok: false, out: '', err: 'career engine credential brokerage timed out', timedOut: true,
    });
    const next = runner.tryAcquireRun('hung-decrypt-user', 'user-store');
    assert.equal(next.status, 'ok');
    runner.releaseRun(next);
  } finally { decryptBehavior = priorDecrypt; }
});

test('dispatch shares one user-store lease regardless of caller-supplied verb slots', async () => {
  let brokerQueries = 0;
  const pool = { query: async () => { brokerQueries += 1; return { rows: [] }; } };
  const children = [];
  const spawnProcess = () => {
    const child = fakeChild(19_000 + children.length);
    children.push(child);
    process.nextTick(() => child.emit('spawn'));
    return child;
  };
  assert.deepEqual(await dispatch.runCareerCliAsync(
    pool, 'same-user', ['augment'], {}, { slot: 'caller-one', spawnProcess, timeoutMs: 5000 },
  ), { started: true });
  assert.deepEqual(await dispatch.runCareerCliAsync(
    pool, 'same-user', ['rerender'], {}, { slot: 'caller-two', spawnProcess, timeoutMs: 5000 },
  ), { started: false, err: 'career engine inflight', limitReason: 'inflight' });
  assert.deepEqual(await dispatch.runCareerCliAwait(
    pool, 'same-user', ['status'], {}, { slot: 'caller-three', timeoutMs: 5000 },
  ), { ok: false, out: '', err: 'career engine inflight', limitReason: 'inflight' });
  assert.equal(brokerQueries, 1, 'rejected duplicate work reached credential storage');
  children[0].exitCode = 0;
  children[0].emit('close', 0);
});

test('shared-corpus writers exclude each other across different users', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  const child = fakeChild(19_100);
  assert.deepEqual(await dispatch.runCareerCliAsync(
    pool, 'corpus-user-a', ['pull'], {}, {
      spawnProcess: () => { process.nextTick(() => child.emit('spawn')); return child; }, timeoutMs: 5000,
    },
  ), { started: true });
  assert.deepEqual(await dispatch.runCareerCliAsync(
    pool, 'corpus-user-b', ['seturl'], {}, { spawnProcess: () => fakeChild(19_101), timeoutMs: 5000 },
  ), { started: false, err: 'career engine inflight', limitReason: 'inflight' });
  child.exitCode = 0;
  child.emit('close', 0);
});

test('stdout/stderr remain tail-bounded and a non-zero exit is explicit', async () => {
  const result = await runner.runCliAwait('user-42', ['noisy']);
  assert.equal(result.ok, false);
  assert.equal(result.out.length, 200000);
  assert.equal(result.err.length, 4000);
  assert.ok(result.out.endsWith('OUT-TAIL'));
  assert.ok(result.err.endsWith('ERR-TAIL'));
});

test('the runner owns a single-flight lease for every asynchronous invocation', async () => {
  const children = [];
  const spawnProcess = () => {
    const proc = fakeChild(20_000 + children.length);
    children.push(proc);
    process.nextTick(() => proc.emit('spawn'));
    return proc;
  };
  assert.deepEqual(await runner.runCliAsync('lease-user', ['first'], {}, {
    slot: 'shared', spawnProcess, timeoutMs: 5000,
  }), { started: true });
  assert.deepEqual(await runner.runCliAsync('lease-user', ['second'], {}, {
    slot: 'shared', spawnProcess, timeoutMs: 5000,
  }), { started: false, err: 'career engine inflight', limitReason: 'inflight' });
  children[0].exitCode = 0;
  children[0].emit('close', 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await runner.runCliAsync('lease-user', ['third'], {}, {
    slot: 'shared', spawnProcess, timeoutMs: 5000,
  }), { started: true });
  children[1].exitCode = 0;
  children[1].emit('close', 0);
});

test('a preclaimed durable-state lease remains held until its caller releases it', async () => {
  const userSub = 'approval-user';
  const lease = runner.tryAcquireRun(userSub, 'draft');
  assert.equal(lease.status, 'ok');
  const child = fakeChild(25_001);
  const resultPromise = runner.runCliAwait(userSub, ['draft'], {}, {
    slot: 'draft', preclaimed: lease, timeoutMs: 5000, spawnProcess: () => child,
  });
  assert.equal((await runner.runCliAwait(userSub, ['draft'], {}, {
    slot: 'draft', preclaimed: lease,
  })).err, 'preclaimed career engine slot is not held', 'one token dispatched twice');
  child.exitCode = 0;
  child.emit('close', 0);
  assert.equal((await resultPromise).ok, true);
  assert.equal(runner.tryAcquireRun(userSub, 'draft').status, 'inflight');
  runner.releaseRun(lease);
  const nextLease = runner.tryAcquireRun(userSub, 'draft');
  assert.equal(nextLease.status, 'ok');
  runner.releaseRun(nextLease);
  const wrongLease = runner.tryAcquireRun(userSub, 'other');
  assert.equal((await runner.runCliAwait(userSub, ['draft'], {}, {
    slot: 'missing', preclaimed: wrongLease,
  })).err, 'preclaimed career engine slot is not held');
  runner.releaseRun(wrongLease);
});

test('an adopted preclaim transfers only after spawn and releases on child close', async () => {
  const userSub = 'upload-user';
  const lease = runner.tryAcquireRun(userSub, 'store');
  const child = fakeChild(26_001);
  const startedPromise = runner.runCliAsync(userSub, ['ingest'], {}, {
    slot: 'store', preclaimed: lease, adoptPreclaim: true, timeoutMs: 5000,
    spawnProcess: () => child,
  });
  child.emit('spawn');
  assert.deepEqual(await startedPromise, { started: true });
  assert.equal(runner.tryAcquireRun(userSub, 'store').status, 'inflight');
  child.exitCode = 0;
  child.emit('close', 0);
  const nextLease = runner.tryAcquireRun(userSub, 'store');
  assert.equal(nextLease.status, 'ok');
  runner.releaseRun(nextLease);
});

test('a failed adopted start leaves rollback ownership with the caller', async () => {
  const userSub = 'rollback-user';
  const lease = runner.tryAcquireRun(userSub, 'store');
  const child = fakeChild(27_001);
  const resultPromise = runner.runCliAsync(userSub, ['ingest'], {}, {
    slot: 'store', preclaimed: lease, adoptPreclaim: true, timeoutMs: 5000,
    spawnProcess: () => child,
  });
  child.emit('error', new Error('fixture rejected start'));
  assert.deepEqual(await resultPromise, { started: false, err: 'fixture rejected start' });
  assert.equal(runner.tryAcquireRun(userSub, 'store').status, 'inflight');
  runner.releaseRun(lease);
  const nextLease = runner.tryAcquireRun(userSub, 'store');
  assert.equal(nextLease.status, 'ok');
  runner.releaseRun(nextLease);
});

test('a stale opaque lease cannot release a newer claimant', () => {
  const first = runner.tryAcquireRun('aba-user', 'store');
  runner.releaseRun(first);
  const second = runner.tryAcquireRun('aba-user', 'store');
  runner.releaseRun(first);
  assert.equal(runner.tryAcquireRun('aba-user', 'store').status, 'inflight');
  runner.releaseRun(second);
});

test('UTF-8 split across stream chunks is reconstructed without replacement characters', async () => {
  let child;
  const resultPromise = runner.runCliAwait('utf-user', ['utf'], {}, {
    slot: 'utf', timeoutMs: 5000, spawnProcess: () => { child = fakeChild(30_001); return child; },
  });
  const bytes = Buffer.from('left-🙂-right', 'utf8');
  child.stdout.write(bytes.subarray(0, 7));
  child.stdout.write(bytes.subarray(7));
  child.stdout.end();
  child.exitCode = 0;
  child.emit('close', 0);
  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.equal(result.out, 'left-🙂-right');
});

test('a hung real child is terminated at the finite deadline', { timeout: 15_000 }, async () => {
  const startedAt = Date.now();
  const heartbeat = join(fixtureDir, 'descendant-heartbeat');
  const result = await runner.runCliAwait('timeout-user', ['hang'], { CH_HEARTBEAT: heartbeat }, { timeoutMs: 1000 });
  assert.equal(result.ok, false);
  assert.match(result.err, /timed out/);
  assert.ok(Date.now() - startedAt < 10_000, 'hung child exceeded the cleanup budget');
  await new Promise((resolve) => setTimeout(resolve, 250));
  const first = readFileSync(heartbeat, 'utf8').length;
  await new Promise((resolve) => setTimeout(resolve, 250));
  const second = readFileSync(heartbeat, 'utf8').length;
  const descendantPid = Number(result.out);
  try { assert.equal(second, first, 'engine descendant kept running after the root timed out'); }
  finally { if (Number.isFinite(descendantPid)) { try { process.kill(descendantPid, 'SIGKILL'); } catch { /* gone */ } } }
  const retryLease = runner.tryAcquireRun('timeout-user', 'hang');
  assert.equal(retryLease.status, 'ok', 'timeout did not release its automatic slot');
  runner.releaseRun(retryLease);
});

test('a child-process spawn error resolves as a bounded failure instead of crashing the API', async () => {
  const failingSpawn = () => {
    const proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    process.nextTick(() => proc.emit('error', new Error('fixture spawn failed')));
    return proc;
  };
  const result = await runner.runCliAwait('user-42', ['ignored'], {}, {
    spawnProcess: failingSpawn, timeoutMs: 1000,
  });
  assert.deepEqual(result, { ok: false, out: '', err: 'fixture spawn failed' });
  const retryLease = runner.tryAcquireRun('user-42', 'ignored');
  assert.equal(retryLease.status, 'ok', 'spawn error did not release its automatic slot');
  runner.releaseRun(retryLease);
});
