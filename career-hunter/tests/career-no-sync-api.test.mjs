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

const require = createRequire(import.meta.url);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = mkdtempSync(join(tmpdir(), 'career-runner-'));
const fixtureCli = join(fixtureDir, 'fixture-cli.cjs');
const savedCli = process.env.JOBHUNTER_CLI;
const savedStore = process.env.JOBHUNTER_STORE_ROOT;
const savedSensitiveEnv = Object.fromEntries([
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'FIRECRAWL_API_KEY', 'SESSION_SECRET',
].map((key) => [key, process.env[key]]));
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
  })), 50);
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
  if (request === '@/shared/logger') {
    return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  }
  if (request === '@/app/routes/connector-token-crypto') {
    return { decryptToken: (...args) => decryptBehavior(...args) };
  }
  if (request === '@/app/routes/caller-sub') return { callerSub: (req) => req?.userSub || null };
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
  });
});

test('mounted dispatch brokers only the caller credentials and never spawns on decrypt failure', async () => {
  const pool = {
    query: async (query, params) => {
      const values = typeof query === 'string' ? params : query.values;
      assert.deepEqual(values, ['broker-user']);
      return { rows: [
        { provider: 'anthropic', access_token: 'anth-cipher' },
        { provider: 'anthropic', access_token: 'older-anth-cipher' },
        { provider: 'firecrawl', access_token: 'fire-cipher' },
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
  assert.deepEqual(started, { started: true });
  assert.equal(childEnv.OSHAL_CRED_ANTHROPIC, 'plain:anth-cipher');
  assert.equal(childEnv.OSHAL_CRED_FIRECRAWL, 'plain:fire-cipher');
  assert.equal(childEnv.CAREER_HUNTER_BROKER_COMPLETE, '1');
  assert.equal(childEnv.CH_TEST, 'present');
  assert.equal(childEnv.ANTHROPIC_API_KEY, undefined);
  assert.equal(childEnv.OPENAI_API_KEY, undefined);
  assert.equal(childEnv.FIRECRAWL_API_KEY, undefined);
  assert.equal(childEnv.SESSION_SECRET, undefined);
  child.exitCode = 0;
  child.emit('close', 0);

  let spawned = false;
  const failed = await dispatch.runCareerCliAsync({
    query: async () => ({ rows: [{ provider: 'anthropic', access_token: 'bad-ciphertext' }] }),
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
      { query: async () => ({ rows: [{ provider: 'anthropic', access_token: 'cipher' }] }) },
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
