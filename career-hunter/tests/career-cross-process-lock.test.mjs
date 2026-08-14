/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Guard canonical cross-process user/corpus exclusion, bounded stale recovery, token-validated child adoption, wrapper wiring, and completion-before-release ordering.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Exercise truthful bounded ingest failure and ordered partial guide-action outcomes in the actual CLI Python mappings.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Prove an adopted child heartbeat preserves exclusivity after its parent heartbeat stops.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Prove configured minimum lease timing crosses the parent-child adoption boundary unchanged.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Preserve whitespace-bearing OIDC subjects exactly at the CLI identity boundary.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Prove an adopted absolute deadline survives parent loss and terminates a hung engine leg.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Prove the surviving wrapper commits successful resume lifecycle state after its API parent is gone.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | Require an actual profile changelog before the CLI reports augmentation success.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | Force-remove an owned generation and prove heartbeat loss invokes the writer's fencing callback.
 * 10 | maintainer@emeraldcoastsystemsgroup.com  | Prove the shared engine ceiling applies across independent processes.
 * 11 | maintainer@emeraldcoastsystemsgroup.com  | Prove token transition markers serialize release and stale recovery for one generation.
 * 12 | maintainer@emeraldcoastsystemsgroup.com  | Prove direct CLI callers share the configured clamped global capacity ceiling.
 * 13 | maintainer@emeraldcoastsystemsgroup.com  | Exercise ordered guide status execution and fail-stopped dependent rows in the actual Python mapping.
 * 14 | maintainer@emeraldcoastsystemsgroup.com  | Prove refresh sends exact identities through canonical base64url trusted-service transport.
 * 15 | maintainer@emeraldcoastsystemsgroup.com  | Prove adopted wrappers skip duplicate brokerage and bound fallback database work by the inherited deadline.
 * 16 | maintainer@emeraldcoastsystemsgroup.com  | Prove silent profile mutations remain successful and artifact batches retain every result while failing the process on any item failure.
 * 17 | maintainer@emeraldcoastsystemsgroup.com  | Prove upload-body capacity has independent clamp semantics and excludes other users across processes without consuming engine slots.
 * 18 | maintainer@emeraldcoastsystemsgroup.com  | Prove owner TTLs defeat short-contender reaping and abandoned transition markers recover without weakening live transitions.
 * 19 | maintainer@emeraldcoastsystemsgroup.com  | Prove a hung asynchronous completion observer is aborted and cannot retain its engine lease indefinitely.
 * 20 | maintainer@emeraldcoastsystemsgroup.com  | Observe a fresh adopted heartbeat after the parent TTL instead of assuming a sub-100ms Windows timer schedule.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockModulePath = path.join(packageRoot, 'lib', 'career-run-lock.js');
const runnerSourcePath = path.join(packageRoot, 'src-routes', 'career-engine-runner.ts');
const binPath = path.join(packageRoot, 'bin', 'oshal-jobhunter.js');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'career-cross-lock-'));
const storeRoot = path.join(fixtureRoot, 'store');
const locks = require(lockModulePath);
const savedStoreRoot = process.env.JOBHUNTER_STORE_ROOT;

process.env.JOBHUNTER_STORE_ROOT = storeRoot;

after(() => {
  if (savedStoreRoot === undefined) delete process.env.JOBHUNTER_STORE_ROOT;
  else process.env.JOBHUNTER_STORE_ROOT = savedStoreRoot;
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

const lockChildProgram = String.raw`
const locks=require(process.argv[1]);
const [root,tenant,user,verb,proof,ttl,release,capacity,capacityGroup,slot]=process.argv.slice(2);
const resources=locks.buildRunResources(user,verb,slot||undefined);
const result=proof==='-' ? locks.tryAcquireRunLocks(root,tenant,resources,{ttlMs:Number(ttl),heartbeatMs:25,capacitySlots:Number(capacity)||undefined,capacityGroup:capacityGroup||undefined})
  : locks.adoptRunLocks(root,tenant,resources,proof);
process.stdout.write(result.status);
if(result.status==='ok' && release==='1') locks.releaseRunLocks(result.lease);
`;

/** Spawn a bounded Node child and capture its terminal diagnostics. */
function runNode(args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 8_000);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

/** Wait for a filesystem/timer condition without making one scheduler tick the assertion. */
async function waitUntil(predicate, message, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

/** Ask an independent process to acquire or adopt one canonical command resource set. */
async function runLockChild(user, verb, options = {}) {
  const result = await runNode([
    '-e', lockChildProgram, lockModulePath, storeRoot, 'default', user, verb,
    options.proof || '-', String(options.ttlMs || 60_000), options.release ? '1' : '0',
    String(options.capacitySlots || 0), options.capacityGroup || 'engine', options.slot || '',
  ]);
  assert.equal(result.code, 0, result.err);
  return result.out;
}

/**
 * Resolve a TypeScript compiler without assuming one operator's disk layout.
 * OSHAL_ROOT first (CI sets it), then a sibling core checkout, then ordinary
 * node resolution. The previous hardcoded C:/Projects/oshal path made this
 * guard pass on exactly one machine and fail everywhere else.
 */
function findTypeScript() {
  const roots = [process.env.OSHAL_ROOT, path.resolve(packageRoot, '..', '..', 'oshal')].filter(Boolean);
  for (const root of roots) {
    const candidate = path.join(root, 'node_modules', 'typescript');
    if (fs.existsSync(path.join(candidate, 'package.json'))) return require(candidate);
  }
  try {
    return require('typescript');
  } catch {
    assert.fail('no TypeScript compiler found — set OSHAL_ROOT to a checkout that has one');
  }
}

/** Load the TypeScript source directly so this guard does not depend on a generated build. */
function loadSourceRunner() {
  const typescript = findTypeScript();
  const source = fs.readFileSync(runnerSourcePath, 'utf8');
  const compiled = typescript.transpileModule(source, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true },
  }).outputText;
  const originalLoad = Module._load;
  Module._load = function loadRunnerDependency(request, parent, isMain) {
    if (request === '@/shared/logger') {
      return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
    }
    if (request === './career-user-store') {
      return { careerTenant: () => 'default', userPaths: (user) => ({
        userDir: path.join(storeRoot, 'default', user),
      }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const runnerModule = new Module(runnerSourcePath);
    runnerModule.filename = runnerSourcePath;
    runnerModule.paths = Module._nodeModulePaths(path.dirname(runnerSourcePath));
    runnerModule._compile(compiled, runnerSourcePath);
    return runnerModule.exports;
  } finally {
    Module._load = originalLoad;
  }
}

/** Minimal controllable child process for background lifecycle ordering. */
function fakeChild(pid) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = pid;
  child.exitCode = null;
  child.kill = () => true;
  return child;
}

/** Load private CLI verb mappings in-memory without widening the package's production exports. */
function loadEngineRuns() {
  const cliModule = new Module(binPath);
  cliModule.filename = binPath;
  cliModule.paths = Module._nodeModulePaths(path.dirname(binPath));
  const source = `${fs.readFileSync(binPath, 'utf8')}\nmodule.exports.__engineRuns=engineRuns;`;
  cliModule._compile(source, binPath);
  return cliModule.exports.__engineRuns;
}

/** Load the private CLI identity resolver without widening the production module exports. */
function loadCliIdentityResolver() {
  const cliModule = new Module(binPath);
  cliModule.filename = binPath;
  cliModule.paths = Module._nodeModulePaths(path.dirname(binPath));
  const source = `${fs.readFileSync(binPath, 'utf8')}\nmodule.exports.__resolveUserSub=resolveUserSub;`;
  cliModule._compile(source, binPath);
  return cliModule.exports.__resolveUserSub;
}

/** Load the private direct-CLI lease boundary without widening production exports. */
function loadCliLeaseBoundary() {
  const cliModule = new Module(binPath);
  cliModule.filename = binPath;
  cliModule.paths = Module._nodeModulePaths(path.dirname(binPath));
  const source = `${fs.readFileSync(binPath, 'utf8')}\nmodule.exports.__lease={acquireCliLease,directCapacitySlots};`;
  cliModule._compile(source, binPath);
  return cliModule.exports.__lease;
}

/** Load the private refresh identity boundary without widening production exports. */
function loadCliRefreshBoundary() {
  const cliModule = new Module(binPath);
  cliModule.filename = binPath;
  cliModule.paths = Module._nodeModulePaths(path.dirname(binPath));
  const source = `${fs.readFileSync(binPath, 'utf8')}\nmodule.exports.__refresh={runRefresh,trustedUserSubHeader};`;
  cliModule._compile(source, binPath);
  return cliModule.exports.__refresh;
}

/** Load the private durable resume finalizer without widening the wrapper's public API. */
function loadCliResumeFinalizer() {
  const cliModule = new Module(binPath);
  cliModule.filename = binPath;
  cliModule.paths = Module._nodeModulePaths(path.dirname(binPath));
  const source = `${fs.readFileSync(binPath, 'utf8')}\nmodule.exports.__persist=persistResumeTerminalState;`;
  cliModule._compile(source, binPath);
  return cliModule.exports.__persist;
}

/** Load the private engine deadline boundary with a controllable process spawner. */
function loadCliDeadlineRunner(spawnStub) {
  const originalLoad = Module._load;
  Module._load = function loadDeadlineDependency(request, parent, isMain) {
    if (request === 'child_process') return { spawn: spawnStub };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const cliModule = new Module(binPath);
    cliModule.filename = binPath;
    cliModule.paths = Module._nodeModulePaths(path.dirname(binPath));
    const source = `${fs.readFileSync(binPath, 'utf8')}\nmodule.exports.__runEngineCommand=runEngineCommand;`;
    cliModule._compile(source, binPath);
    return cliModule.exports.__runEngineCommand;
  } finally {
    Module._load = originalLoad;
  }
}

/** Load the private wrapper environment builder without widening production exports. */
function loadCliEnvironmentBoundary() {
  const cliModule = new Module(binPath);
  cliModule.filename = binPath;
  cliModule.paths = Module._nodeModulePaths(path.dirname(binPath));
  const source = `${fs.readFileSync(binPath, 'utf8')}\nmodule.exports.__buildEngineEnv=buildEngineEnv;`;
  cliModule._compile(source, binPath);
  return cliModule.exports.__buildEngineEnv;
}

/** Create a dependency-free fake Python engine that records only success or failure. */
function preparePythonFixture() {
  const root = path.join(fixtureRoot, 'python-fixture');
  const jobhunter = path.join(root, 'jobhunter');
  fs.mkdirSync(jobhunter, { recursive: true });
  fs.writeFileSync(path.join(jobhunter, '__init__.py'), '', 'utf8');
  fs.writeFileSync(path.join(jobhunter, 'profile.py'), [
    'def augment(value):',
    '    if value == "raise": raise RuntimeError("private detail")',
    '    changed = value != "noop"',
    '    return {"ok": True, "changed": changed, "changelog": ([] if value in ("noop", "silent") else ["saved"])}',
    'def absorb(value, kind):',
    '    if value == "raise": raise RuntimeError("private detail")',
    '    return ({"ok": False, "kind": kind, "error": "bad artifact"} if value == "bad" else {"ok": True, "changed": True, "kind": kind, "changelog": [value]})',
    'def build_from_resume(value):',
    '    return ({"ok": False, "error": "x" * 2000} if value == "bad" else {"ok": True, "roles": 2, "skills": 3})',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(jobhunter, 'generate.py'), [
    'def generate_for(posting_id, include_oshal=False):',
    '    return {"dir": "packet"} if posting_id > 0 else {}',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(jobhunter, 'db.py'), [
    'import json, os',
    'class Connection:',
    '    def __enter__(self): return self',
    '    def __exit__(self, *_args): return False',
    'def connect(): return Connection()',
    'def set_status(_conn, posting_id, status):',
    '    with open(os.environ["GUIDE_STATUS_LOG"], "a", encoding="utf-8") as handle:',
    '        handle.write(json.dumps([posting_id, status]) + "\\n")',
  ].join('\n'), 'utf8');
  return root;
}

/** Execute one extracted Python mapping with a controlled environment. */
function runPythonMapping(run, env) {
  return spawnSync('python', run, {
    env: { ...process.env, ...env }, encoding: 'utf8', timeout: 5_000,
  });
}

test('independent processes exclude the same canonical user while allowing another user', async () => {
  const user = '../Unsafe:User';
  const resources = locks.buildRunResources(user, 'query');
  assert.equal(resources.some((resource) => resource.includes(user)), false);
  const first = locks.tryAcquireRunLocks(storeRoot, 'default', resources);
  assert.equal(first.status, 'ok');
  try {
    assert.equal(await runLockChild(user, 'query', { release: true }), 'inflight');
    assert.equal(await runLockChild('other-user', 'query', { release: true }), 'ok');
  } finally {
    if (first.status === 'ok') locks.releaseRunLocks(first.lease);
  }
});

test('direct CLI leases share the clamped configured capacity ceiling', () => {
  const saved = process.env.CAREER_HUNTER_MAX_RUNS;
  const boundary = loadCliLeaseBoundary();
  let first;
  try {
    delete process.env.CAREER_HUNTER_MAX_RUNS;
    assert.equal(boundary.directCapacitySlots(), 3);
    process.env.CAREER_HUNTER_MAX_RUNS = '0';
    assert.equal(boundary.directCapacitySlots(), 1);
    process.env.CAREER_HUNTER_MAX_RUNS = '999';
    assert.equal(boundary.directCapacitySlots(), 64);
    process.env.CAREER_HUNTER_MAX_RUNS = 'invalid';
    assert.equal(boundary.directCapacitySlots(), 3);
    process.env.CAREER_HUNTER_MAX_RUNS = '1';
    first = boundary.acquireCliLease('direct-capacity-a', 'default', 'query');
    assert.ok(first);
    assert.equal(boundary.acquireCliLease('direct-capacity-b', 'default', 'query'), null);
  } finally {
    if (first) locks.releaseRunLocks(first);
    if (saved === undefined) delete process.env.CAREER_HUNTER_MAX_RUNS;
    else process.env.CAREER_HUNTER_MAX_RUNS = saved;
  }
});

test('runner upload-body capacity defaults and clamps independently from engine runs', () => {
  const savedUploads = process.env.CAREER_HUNTER_MAX_UPLOAD_BODIES;
  const savedRuns = process.env.CAREER_HUNTER_MAX_RUNS;
  const cases = [[undefined, 2], ['0', 1], ['999', 16], ['invalid', 2]];
  try {
    process.env.CAREER_HUNTER_MAX_RUNS = '1';
    for (const [configured, expected] of cases) {
      if (configured === undefined) delete process.env.CAREER_HUNTER_MAX_UPLOAD_BODIES;
      else process.env.CAREER_HUNTER_MAX_UPLOAD_BODIES = configured;
      const runner = loadSourceRunner();
      const held = Array.from({ length: expected }, (_, index) => (
        runner.tryAcquireUploadRun(`upload-clamp-${configured}-${index}`)
      ));
      assert.equal(held.every((lease) => lease.status === 'ok'), true);
      assert.equal(runner.tryAcquireUploadRun(`upload-clamp-${configured}-busy`).status, 'busy');
      held.forEach((lease) => runner.releaseRun(lease));
    }
  } finally {
    if (savedUploads === undefined) delete process.env.CAREER_HUNTER_MAX_UPLOAD_BODIES;
    else process.env.CAREER_HUNTER_MAX_UPLOAD_BODIES = savedUploads;
    if (savedRuns === undefined) delete process.env.CAREER_HUNTER_MAX_RUNS;
    else process.env.CAREER_HUNTER_MAX_RUNS = savedRuns;
  }
});

test('refresh uses canonical base64url transport for the exact opaque subject', async () => {
  const boundary = loadCliRefreshBoundary();
  const savedSecret = process.env.SWARM_SERVICE_SECRET;
  const savedFetch = globalThis.fetch;
  const savedLog = console.log;
  const calls = [];
  process.env.SWARM_SERVICE_SECRET = 'fixture-secret';
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return { ok: true, text: async () => '' };
  };
  console.log = () => {};
  try {
    const subject = '  exact/ü-subject  ';
    assert.equal(await boundary.runRefresh('refresh', subject), 0);
    const headers = calls[0][1].headers;
    assert.equal(headers['X-Oshal-User-Sub-B64'], Buffer.from(subject).toString('base64url'));
    assert.equal('X-Oshal-User-Sub' in headers, false);
    assert.throws(() => boundary.trustedUserSubHeader('bad\0subject'), /identity is invalid/);
    assert.throws(() => boundary.trustedUserSubHeader('x'.repeat(513)), /identity is invalid/);
    assert.throws(() => boundary.trustedUserSubHeader('\ud800'), /identity is invalid/);
  } finally {
    if (savedSecret === undefined) delete process.env.SWARM_SERVICE_SECRET;
    else process.env.SWARM_SERVICE_SECRET = savedSecret;
    globalThis.fetch = savedFetch;
    console.log = savedLog;
  }
});

test('shared-corpus writers exclude different users across independent processes', async () => {
  const first = locks.tryAcquireRunLocks(storeRoot, 'default', locks.buildRunResources('writer-a', 'pull'));
  assert.equal(first.status, 'ok');
  try {
    assert.equal(await runLockChild('writer-b', 'seturl', { release: true }), 'inflight');
    assert.equal(await runLockChild('writer-b', 'query', { release: true }), 'ok');
  } finally {
    if (first.status === 'ok') locks.releaseRunLocks(first.lease);
  }
});

test('shared capacity rejects an independent user after every engine slot is occupied', async () => {
  const first = locks.tryAcquireRunLocks(
    storeRoot, 'default', locks.buildRunResources('capacity-owner', 'query'),
    { capacitySlots: 1 },
  );
  assert.equal(first.status, 'ok');
  try {
    assert.equal(await runLockChild('capacity-peer', 'query', {
      capacitySlots: 1, release: true,
    }), 'busy');
  } finally {
    if (first.status === 'ok') locks.releaseRunLocks(first.lease);
  }
  assert.equal(await runLockChild('capacity-peer', 'query', {
    capacitySlots: 1, release: true,
  }), 'ok');
});

test('upload-body capacity excludes another process but remains independent of engine slots', async () => {
  const engine = locks.tryAcquireRunLocks(
    storeRoot, 'default', locks.buildRunResources('engine-owner', 'query'),
    { capacitySlots: 1, capacityGroup: 'engine' },
  );
  const upload = locks.tryAcquireRunLocks(
    storeRoot, 'default', locks.buildRunResources('upload-owner', '', 'upload-body'),
    { capacitySlots: 1, capacityGroup: 'upload-body' },
  );
  assert.equal(engine.status, 'ok');
  assert.equal(upload.status, 'ok');
  try {
    assert.equal(await runLockChild('upload-peer', '', {
      capacitySlots: 1, capacityGroup: 'upload-body', slot: 'upload-body', release: true,
    }), 'busy');
    if (engine.status === 'ok') locks.releaseRunLocks(engine.lease);
    assert.equal(await runLockChild('engine-peer', 'query', {
      capacitySlots: 1, capacityGroup: 'engine', release: true,
    }), 'ok');
  } finally {
    if (engine.status === 'ok') locks.releaseRunLocks(engine.lease);
    if (upload.status === 'ok') locks.releaseRunLocks(upload.lease);
  }
  assert.equal(await runLockChild('upload-peer', '', {
    capacitySlots: 1, capacityGroup: 'upload-body', slot: 'upload-body', release: true,
  }), 'ok');
});

test('a crashed owner becomes reclaimable after its bounded heartbeat lease expires', async () => {
  assert.equal(await runLockChild('stale-user', 'query', { ttlMs: 100 }), 'ok');
  await new Promise((resolve) => setTimeout(resolve, 220));
  const recovered = locks.tryAcquireRunLocks(
    storeRoot, 'default', locks.buildRunResources('stale-user', 'query'), { ttlMs: 100, heartbeatMs: 25 },
  );
  assert.equal(recovered.status, 'ok');
  if (recovered.status === 'ok') locks.releaseRunLocks(recovered.lease);
});

test('a short-TTL contender cannot reap a crashed owner before the owner-selected TTL', async () => {
  const user = 'owner-selected-ttl';
  assert.equal(await runLockChild(user, 'query', { ttlMs: 500 }), 'ok');
  await new Promise((resolve) => setTimeout(resolve, 140));
  const early = locks.tryAcquireRunLocks(
    storeRoot, 'default', locks.buildRunResources(user, 'query'),
    { ttlMs: 50, heartbeatMs: 20 },
  );
  assert.equal(early.status, 'inflight');
  await new Promise((resolve) => setTimeout(resolve, 420));
  const recovered = locks.tryAcquireRunLocks(
    storeRoot, 'default', locks.buildRunResources(user, 'query'),
    { ttlMs: 50, heartbeatMs: 20 },
  );
  assert.equal(recovered.status, 'ok');
  if (recovered.status === 'ok') locks.releaseRunLocks(recovered.lease);
});

test('a missing heartbeat generation self-fences its still-running owner', async () => {
  let resolveLost;
  const lost = new Promise((resolve) => { resolveLost = resolve; });
  const resources = locks.buildRunResources('fenced-user', 'query');
  const result = locks.tryAcquireRunLocks(storeRoot, 'default', resources, {
    ttlMs: 100, heartbeatMs: 25, onLost: resolveLost,
  });
  assert.equal(result.status, 'ok');
  fs.rmSync(result.lease.entries[0].directory, { recursive: true, force: true });
  const error = await Promise.race([
    lost,
    new Promise((_, reject) => setTimeout(() => reject(new Error('lease loss was not observed')), 500)),
  ]);
  assert.equal(error.code, 'CAREER_LEASE_LOST');
  assert.equal(result.lease.lost, true);
  locks.releaseRunLocks(result.lease);
});

test('a live transition blocks competitors but its crash-abandoned marker is recoverable', async () => {
  const resources = locks.buildRunResources('transition-owner', 'query');
  const result = locks.tryAcquireRunLocks(storeRoot, 'default', resources, {
    ttlMs: 100, heartbeatMs: 25,
  });
  assert.equal(result.status, 'ok');
  clearInterval(result.lease.timer);
  result.lease.timer = undefined;
  const entry = result.lease.entries[0];
  const marker = path.join(entry.directory, `.lease-transition-${result.lease.token}`);
  fs.writeFileSync(marker, 'fixture-transition', { flag: 'wx' });
  locks.releaseRunLocks(result.lease);
  assert.equal(fs.existsSync(entry.directory), true);
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(locks.tryAcquireRunLocks(storeRoot, 'default', resources, {
    ttlMs: 100, heartbeatMs: 25,
  }).status, 'inflight');
  fs.utimesSync(marker, new Date(0), new Date(0));
  const recovered = locks.tryAcquireRunLocks(storeRoot, 'default', resources, {
    ttlMs: 100, heartbeatMs: 25,
  });
  assert.equal(recovered.status, 'ok');
  if (recovered.status === 'ok') locks.releaseRunLocks(recovered.lease);
});

test('only an exact parent token/resource proof can bypass child reacquisition', async () => {
  const resources = locks.buildRunResources('adopt-user', 'score');
  const parent = locks.tryAcquireRunLocks(storeRoot, 'default', resources);
  assert.equal(parent.status, 'ok');
  try {
    const proof = locks.serializeRunLockAdoption(parent.lease);
    assert.equal(await runLockChild('adopt-user', 'score', { proof }), 'ok');
    assert.equal(await runLockChild('different-user', 'score', { proof }), 'invalid');
    const env = { ...process.env, JOBHUNTER_STORE_ROOT: storeRoot, OSHAL_TENANT: 'default',
      OSHAL_USER_SUB: 'adopt-user', JOBHUNTER_PYTHON: process.execPath,
      OSHAL_CRED_ANTHROPIC: 'fixture', OSHAL_CRED_FIRECRAWL: 'fixture',
      [locks.RUN_LOCK_ADOPTION_ENV]: proof };
    const wrapper = await runNode([binPath, 'score'], env);
    assert.doesNotMatch(wrapper.err, /lease adoption was rejected|already running/i);
  } finally {
    if (parent.status === 'ok') locks.releaseRunLocks(parent.lease);
  }
});

test('an adopted child keeps its lease exclusive after the parent heartbeat stops', async () => {
  const options = { ttlMs: 100, heartbeatMs: 25 };
  const resources = locks.buildRunResources('orphan-parent-user', 'query');
  const parent = locks.tryAcquireRunLocks(storeRoot, 'default', resources, options);
  assert.equal(parent.status, 'ok');
  const proof = locks.serializeRunLockAdoption(parent.lease);
  const adopted = locks.adoptRunLocks(storeRoot, 'default', resources, proof, options);
  assert.equal(adopted.status, 'ok');
  clearInterval(parent.lease.timer);
  parent.lease.timer = undefined;
  const parentStoppedAt = Date.now();
  const ownerPath = path.join(parent.lease.entries[0].directory, 'owner.json');
  const parentHeartbeatMtime = fs.statSync(ownerPath).mtimeMs;
  await waitUntil(
    () => {
      const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
      const heartbeatMtime = fs.statSync(ownerPath).mtimeMs;
      return owner.token === adopted.lease.token
        && heartbeatMtime > parentHeartbeatMtime
        && Date.now() - parentStoppedAt > options.ttlMs
        && Date.now() - heartbeatMtime <= options.heartbeatMs * 2;
    },
    'adopted child did not publish a fresh heartbeat after the parent lease would have expired',
  );
  assert.equal(locks.tryAcquireRunLocks(storeRoot, 'default', resources, options).status, 'inflight');
  locks.releaseRunLocks(adopted.lease);
  await new Promise((resolve) => setTimeout(resolve, 220));
  const recovered = locks.tryAcquireRunLocks(storeRoot, 'default', resources, options);
  assert.equal(recovered.status, 'ok');
  if (recovered.status === 'ok') locks.releaseRunLocks(recovered.lease);
  locks.releaseRunLocks(parent.lease);
});

test('configured minimum timing is preserved by an adopted child without inherited config', () => {
  const savedTtl = process.env.CAREER_HUNTER_LOCK_TTL_MS;
  process.env.CAREER_HUNTER_LOCK_TTL_MS = '1';
  const resources = locks.buildRunResources('configured-ttl-user', 'query');
  const parent = locks.tryAcquireRunLocks(storeRoot, 'default', resources);
  assert.equal(parent.status, 'ok');
  try {
    const deadlineAt = Date.now() + 5_000;
    const proof = locks.serializeRunLockAdoption(parent.lease, deadlineAt);
    delete process.env.CAREER_HUNTER_LOCK_TTL_MS;
    const adopted = locks.adoptRunLocks(storeRoot, 'default', resources, proof);
    assert.equal(adopted.status, 'ok');
    assert.deepEqual(
      { ttlMs: adopted.lease.ttlMs, heartbeatMs: adopted.lease.heartbeatMs },
      { ttlMs: 10_000, heartbeatMs: Math.floor(10_000 / 3) },
    );
    assert.equal(adopted.lease.deadlineAt, deadlineAt);
    locks.releaseRunLocks(adopted.lease);
  } finally {
    if (parent.status === 'ok') locks.releaseRunLocks(parent.lease);
    if (savedTtl === undefined) delete process.env.CAREER_HUNTER_LOCK_TTL_MS;
    else process.env.CAREER_HUNTER_LOCK_TTL_MS = savedTtl;
  }
});

test('a surviving wrapper terminates a hung engine leg at the adopted deadline', async () => {
  const child = new EventEmitter();
  child.pid = 91_001;
  child.exitCode = null;
  let killCalls = 0;
  child.kill = () => {
    killCalls += 1;
    process.nextTick(() => { child.exitCode = 137; child.emit('close', 137); });
    return true;
  };
  const spawnStub = (command) => {
    if (command !== 'taskkill.exe') return child;
    const killer = new EventEmitter();
    process.nextTick(() => killer.emit('close', 1));
    return killer;
  };
  const runEngineCommand = loadCliDeadlineRunner(spawnStub);
  const originalKill = process.kill;
  process.kill = () => { throw new Error('fixture process group'); };
  try {
    const result = await runEngineCommand(['fixture'], {}, Date.now() + 30);
    assert.equal(result, 124);
    assert.equal(killCalls, 1);
  } finally {
    process.kill = originalKill;
  }
});

test('an adopted wrapper trusts the controller broker sentinel and never re-queries Postgres', async () => {
  const keys = ['CAREER_HUNTER_BROKER_COMPLETE', 'OSHAL_CRED_ANTHROPIC', 'OSHAL_CRED_FIRECRAWL'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.CAREER_HUNTER_BROKER_COMPLETE = '1';
  process.env.OSHAL_CRED_ANTHROPIC = 'controller-anthropic';
  delete process.env.OSHAL_CRED_FIRECRAWL;
  const buildEngineEnv = loadCliEnvironmentBoundary();
  const originalLoad = Module._load;
  let pgLoaded = false;
  Module._load = function rejectDuplicateBroker(request, ...rest) {
    if (request === 'pg') { pgLoaded = true; throw new Error('Postgres must not load'); }
    return originalLoad.call(this, request, ...rest);
  };
  try {
    const env = await buildEngineEnv('adopted-user', 'default', 'score', {
      userDir: path.join(fixtureRoot, 'adopted-user'), corpusDb: 'corpus', userDb: 'user', careerDb: 'career',
    }, Date.now() + 1_000);
    assert.equal(env.ANTHROPIC_API_KEY, 'controller-anthropic');
    assert.equal(env.FIRECRAWL_API_KEY, undefined);
    assert.equal(env.CAREER_HUNTER_BROKER_COMPLETE, undefined);
    assert.equal(pgLoaded, false);
  } finally {
    Module._load = originalLoad;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('an adopted wrapper bounds a hung legacy credential fallback by the parent deadline', async () => {
  const keys = ['CAREER_HUNTER_BROKER_COMPLETE', 'OSHAL_CRED_ANTHROPIC', 'OSHAL_CRED_FIRECRAWL'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => { delete process.env[key]; });
  const buildEngineEnv = loadCliEnvironmentBoundary();
  const originalLoad = Module._load;
  Module._load = function loadHungPg(request, ...rest) {
    if (request === 'pg') {
      return { Pool: class { query() { return new Promise(() => {}); } end() { return Promise.resolve(); } } };
    }
    return originalLoad.call(this, request, ...rest);
  };
  try {
    const started = Date.now();
    await assert.rejects(buildEngineEnv('fallback-user', 'default', 'score', {
      userDir: path.join(fixtureRoot, 'fallback-user'), corpusDb: 'corpus', userDb: 'user', careerDb: 'career',
    }, Date.now() + 40), (error) => error?.exitCode === 124);
    assert.ok(Date.now() - started < 500, 'wrapper exceeded inherited brokerage budget');
  } finally {
    Module._load = originalLoad;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('a surviving wrapper records successful ingest completion after API parent loss', () => {
  const userDir = path.join(fixtureRoot, 'orphaned-resume-user');
  const operationId = '11111111-1111-4111-8111-111111111111';
  const pending = { state: 'pending', operationId, startedAt: Date.now() };
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, '.resume-ingest.json'), JSON.stringify(pending));
  fs.writeFileSync(path.join(userDir, '.indexing'), JSON.stringify(pending));
  const persist = loadCliResumeFinalizer();
  assert.equal(persist({ userDir }, operationId, 0), true);
  const terminal = JSON.parse(fs.readFileSync(path.join(userDir, '.resume-ingest.json'), 'utf8'));
  assert.equal(terminal.state, 'succeeded');
  assert.equal(terminal.operationId, operationId);
  assert.equal(fs.existsSync(path.join(userDir, '.indexing')), false);
});

test('CLI identity resolution preserves the controller subject byte-for-byte', () => {
  const saved = process.env.OSHAL_USER_SUB;
  process.env.OSHAL_USER_SUB = '  whitespace-subject  ';
  try {
    const resolveUserSub = loadCliIdentityResolver();
    assert.equal(resolveUserSub(), '  whitespace-subject  ');
    const segment = require('../lib/user-store-path.js').userStoreSegment(resolveUserSub());
    assert.equal(require('../lib/user-store-path.js').userSubFromStoreSegment(segment), resolveUserSub());
  } finally {
    if (saved === undefined) delete process.env.OSHAL_USER_SUB;
    else process.env.OSHAL_USER_SUB = saved;
  }
});

test('background completion settles before its automatic lease is released', async () => {
  const runner = loadSourceRunner();
  const child = fakeChild(41_001);
  let finishObserver;
  let observerResult;
  let observerStarted;
  const startedSignal = new Promise((resolve) => { observerStarted = resolve; });
  const observerGate = new Promise((resolve) => { finishObserver = resolve; });
  const start = runner.runCliAsync('callback-user', ['ingest'], {}, {
    slot: 'user-store', timeoutMs: 5_000, spawnProcess: () => child,
    onComplete: async (result) => { observerResult = result; observerStarted(); await observerGate; },
  });
  child.emit('spawn');
  assert.deepEqual(await start, { started: true });
  child.exitCode = 0;
  child.emit('close', 0);
  await startedSignal;
  assert.deepEqual(observerResult, { ok: true, code: 0, timedOut: false });
  assert.equal(runner.tryAcquireRun('callback-user', 'user-store').status, 'inflight');
  finishObserver();
  await new Promise((resolve) => setImmediate(resolve));
  const next = runner.tryAcquireRun('callback-user', 'user-store');
  assert.equal(next.status, 'ok');
  runner.releaseRun(next);
});

test('a hung background completion observer is aborted before its lease is released', async () => {
  const runner = loadSourceRunner();
  const child = fakeChild(41_002);
  let observerSignal;
  const start = runner.runCliAsync('hung-callback-user', ['ingest'], {}, {
    slot: 'user-store', timeoutMs: 5_000, completionTimeoutMs: 50,
    spawnProcess: () => child,
    onComplete: async (_result, signal) => {
      observerSignal = signal;
      await new Promise(() => {});
    },
  });
  child.emit('spawn');
  assert.deepEqual(await start, { started: true });
  child.exitCode = 0;
  child.emit('close', 0);
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(observerSignal?.aborted, true);
  const next = runner.tryAcquireRun('hung-callback-user', 'user-store');
  assert.equal(next.status, 'ok');
  runner.releaseRun(next);
});

test('CLI mappings return bounded ingest failures and ordered guide partial outcomes', () => {
  const engineRuns = loadEngineRuns();
  const pythonPath = preparePythonFixture();
  const ingest = runPythonMapping(engineRuns('ingest', [])[0], {
    PYTHONPATH: pythonPath, CH_RESUME: 'bad',
  });
  assert.equal(ingest.status, 1, ingest.stderr);
  const ingestResult = JSON.parse(ingest.stdout.trim());
  assert.deepEqual({ ok: ingestResult.ok, errorLength: ingestResult.error.length }, {
    ok: false, errorLength: 1000,
  });
  const actions = [
    { op: 'augment_profile', facts: 'good' },
    { op: 'augment_profile', facts: 'raise' },
    { op: 'generate', guidance: 'good', oshal: true },
    { op: 'unknown' },
  ];
  const guide = runPythonMapping(engineRuns('guide-actions', [])[0], {
    PYTHONPATH: pythonPath, CH_JOB: '42', CH_GUIDE_ACTIONS: JSON.stringify(actions),
  });
  assert.equal(guide.status, 0, guide.stderr);
  assert.equal(guide.stderr, '');
  assert.deepEqual(JSON.parse(guide.stdout.trim().replace('GUIDE_ACTIONS_RESULT=', '')), [
    { op: 'augment_profile', ok: true, changed: true }, { op: 'augment_profile', ok: false },
    { op: 'generate', ok: false, skipped: true },
    { op: 'invalid', ok: false, skipped: true },
  ]);
});

test('CLI absorb batch reports every item and exits nonzero when one item fails', () => {
  const engineRuns = loadEngineRuns();
  const pythonPath = preparePythonFixture();
  const items = [
    { path: 'good', kind: 'email' },
    { path: 'bad', kind: 'work-sample' },
    { path: 'raise', kind: 'other' },
  ];
  const failed = runPythonMapping(engineRuns('absorb-batch', [])[0], {
    PYTHONPATH: pythonPath, CH_ARTIFACTS: JSON.stringify(items),
  });
  assert.equal(failed.status, 1, failed.stderr);
  const rows = JSON.parse(failed.stdout.trim());
  assert.equal(rows.length, items.length);
  assert.deepEqual(rows.map((row) => row.ok), [true, false, false]);
  assert.match(rows[2].error, /^artifact absorb raised /);

  const passed = runPythonMapping(engineRuns('absorb-batch', [])[0], {
    PYTHONPATH: pythonPath,
    CH_ARTIFACTS: JSON.stringify([{ path: 'good', kind: 'email' }]),
  });
  assert.equal(passed.status, 0, passed.stderr);
  assert.deepEqual(JSON.parse(passed.stdout.trim()).map((row) => row.ok), [true]);
});

test('CLI guide mapping executes status in sequence and parameterizes through db.set_status', () => {
  const engineRuns = loadEngineRuns();
  const pythonPath = preparePythonFixture();
  const statusLog = path.join(fixtureRoot, 'guide-status.jsonl');
  const actions = [
    { op: 'set_status', status: 'deferred' },
    { op: 'generate', guidance: 'good', oshal: false },
  ];
  const guide = runPythonMapping(engineRuns('guide-actions', [])[0], {
    PYTHONPATH: pythonPath, CH_JOB: '42', CH_GUIDE_ACTIONS: JSON.stringify(actions),
    GUIDE_STATUS_LOG: statusLog,
  });
  assert.equal(guide.status, 0, guide.stderr);
  assert.deepEqual(JSON.parse(guide.stdout.trim().replace('GUIDE_ACTIONS_RESULT=', '')), [
    { op: 'set_status', ok: true, status: 'deferred' },
    { op: 'generate', ok: true },
  ]);
  assert.deepEqual(JSON.parse(fs.readFileSync(statusLog, 'utf8').trim()), [42, 'deferred']);
});

test('CLI guide mapping distinguishes a silent persisted mutation from a no-op', () => {
  const engineRuns = loadEngineRuns();
  const pythonPath = preparePythonFixture();
  const guide = runPythonMapping(engineRuns('guide-actions', [])[0], {
    PYTHONPATH: pythonPath,
    CH_JOB: '42',
    CH_GUIDE_ACTIONS: JSON.stringify([
      { op: 'augment_profile', facts: 'silent' },
      { op: 'augment_profile', facts: 'noop' },
    ]),
  });
  assert.equal(guide.status, 0, guide.stderr);
  assert.deepEqual(JSON.parse(guide.stdout.trim().replace('GUIDE_ACTIONS_RESULT=', '')), [
    { op: 'augment_profile', ok: true, changed: true },
    { op: 'augment_profile', ok: false, changed: false },
  ]);
});

test('source and wrapper keep cross-process, timeout, guide, and async-child wiring explicit', () => {
  const runner = fs.readFileSync(runnerSourcePath, 'utf8');
  const wrapper = fs.readFileSync(binPath, 'utf8');
  for (const boundary of ['tryAcquireRunLocks', 'serializeRunLockAdoption', 'tryAcquireCliRun', 'timedOut']) {
    assert.match(runner, new RegExp(boundary));
  }
  assert.match(wrapper, /GUIDE_ACTIONS_RESULT=/);
  assert.match(wrapper, /adoptRunLocks/);
  assert.match(wrapper, /onLost[\s\S]*terminateEngineTree/);
  assert.doesNotMatch(wrapper, /\bspawnSync\b/);
});
