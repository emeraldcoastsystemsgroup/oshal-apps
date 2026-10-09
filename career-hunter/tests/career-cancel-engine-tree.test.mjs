/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard that stopping a Career run stops its engine, not only the wrapper (1.27.1). The COMPILED runner launches the REAL bin/oshal-jobhunter.js for the manual `score` verb, and the wrapper starts a stand-in engine (JOBHUNTER_PYTHON) that records its own pid and its child's, holds the inherited stdout pipe and never exits by itself. An owner cancel must leave the stand-in and its child exited within 5 s and the run `cancelled`; the runner deadline and the lease-loss fence must do the same while the wrapper is frozen (SIGSTOP), so only the runner's group kill can act. A wrapper that outlives the runner and leads its own group fences its engine itself and still exits through its cleanup (124); one that does not lead a group keeps the engine in a group of its own. Every check reads /proc/<pid>/stat, never kill(pid, 0): a killed orphan stays a zombie where node is PID 1. Linux only (process groups and procfs); store-ci runs it on ubuntu. Scoped doubles: the kernel logger and the user-store path leaf; the runner, the run registry, the lease library, the wrapper and the process tree are real.
 */
import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binPath = path.join(packageRoot, 'bin', 'oshal-jobhunter.js');
const skip = process.platform === 'linux'
  ? false : 'process groups and /proc are Linux-only; store-ci runs this suite on ubuntu';
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'career-cancel-tree-'));
const storeRoot = path.join(fixtureRoot, 'store');
const standInPath = path.join(fixtureRoot, 'engine-stand-in.sh');
const TENANT = 'default';
const ISSUER = 'https://issuer.oshal.example.com';
const SCORE_ARGS = ['score', '--min-keyword', '40'];
const STOP_WINDOW_MS = 5_000;
const seenPids = new Set();
const openLaunches = [];
const savedEnv = Object.fromEntries(['JOBHUNTER_STORE_ROOT', 'JOBHUNTER_PYTHON', 'CAREER_HUNTER_LOCK_TTL_MS']
  .map((key) => [key, process.env[key]]));

process.env.JOBHUNTER_STORE_ROOT = storeRoot;
process.env.JOBHUNTER_PYTHON = standInPath;
delete process.env.CAREER_HUNTER_LOCK_TTL_MS;
fs.writeFileSync(standInPath, [
  '#!/bin/sh',
  '# Career engine stand-in: one child, both pids recorded, the inherited stdout held, no exit of its own.',
  'sleep 600 &',
  'echo "$$ $!" > "$CH_STANDIN_PIDS.tmp"',
  'mv "$CH_STANDIN_PIDS.tmp" "$CH_STANDIN_PIDS"',
  'echo "career engine stand-in running"',
  'wait',
  '',
].join('\n'), { mode: 0o755 });
fs.chmodSync(standInPath, 0o755);

/** Load the compiled runner with only the kernel logger and the user-store path leaf doubled. */
function loadCompiledRunner() {
  const originalLoad = Module._load;
  Module._load = function loadRunnerDependency(request, parent, isMain) {
    if (request === '@/shared/logger') {
      return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
    }
    if (request === './career-user-store') {
      return {
        careerTenant: () => TENANT,
        userPaths: (userSub) => ({ userDir: path.join(storeRoot, TENANT, userSub) }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../routes/career-engine-runner.js');
  } finally {
    Module._load = originalLoad;
  }
}

const runner = loadCompiledRunner();
const engineRuns = require('../lib/career-engine-runs.js');
const locks = require('../lib/career-run-lock.js');

/** SIGKILL one process this suite started, unless it has already exited. */
function killIfRunning(pid) {
  if (!Number.isInteger(pid) || hasExited(pid)) return;
  try { process.kill(pid, 'SIGKILL'); } catch { /* exited between the read and the signal */ }
}

// A failed case must not leave its run holding the shared corpus-write slot for the next case.
afterEach(async () => {
  for (const launch of openLaunches.splice(0)) {
    Object.values(launch.fixture.pids || {}).forEach(killIfRunning);
    let timer;
    await Promise.race([launch.result, new Promise((resolve) => { timer = setTimeout(resolve, STOP_WINDOW_MS); })]);
    clearTimeout(timer);
  }
});

after(() => {
  seenPids.forEach(killIfRunning);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

/** Read the state, parent and group of one process from procfs, or null once it is gone. */
function procState(pid) {
  let stat;
  try { stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
    throw error;
  }
  const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
  return { state: fields[0], ppid: Number(fields[1]), pgrp: Number(fields[2]) };
}

/** Exited means procfs no longer lists the pid, or lists a zombie that only awaits reaping. */
function hasExited(pid) {
  const state = procState(pid);
  return state === null || state.state === 'Z' || state.state === 'X';
}

/** Describe the stand-in pair for a failure message. */
function describe(pids) {
  return ['engine', 'child'].map((name) => {
    const state = procState(pids[name]);
    return `${name} ${pids[name]}: ${state ? `state ${state.state}, group ${state.pgrp}` : 'gone'}`;
  }).join('; ') + ` (wrapper ${pids.wrapper})`;
}

/** Poll a condition without making one scheduler tick the assertion. */
async function waitFor(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!predicate()) assert.fail(typeof message === 'function' ? message() : message);
}

/** Resolve a promise or fail once its bound passes. */
function within(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), Math.max(0, timeoutMs)); }),
  ]).finally(() => clearTimeout(timer));
}

/** One owner, pid file and engine environment per case. */
function runFixture(name) {
  const pidFile = path.join(fixtureRoot, `${name}.pids`);
  return {
    owner: `cancel-tree-${name}`,
    pidFile,
    env: { CAREER_HUNTER_BROKER_COMPLETE: '1', CH_STANDIN_PIDS: pidFile },
  };
}

/** Wait for the stand-in to record its pid and its child's; the wrapper is the stand-in's parent. */
async function standInPids(fixture) {
  await waitFor(() => fs.existsSync(fixture.pidFile), 15_000, 'the stand-in engine never started');
  const [engine, child] = fs.readFileSync(fixture.pidFile, 'utf8').trim().split(/\s+/).map(Number);
  const wrapper = procState(engine)?.ppid;
  assert.notEqual(wrapper, process.pid, 'the stand-in is never this test process child');
  for (const pid of [engine, child, wrapper]) if (Number.isInteger(pid) && pid > 1) seenPids.add(pid);
  const pids = { engine, child, wrapper };
  fixture.pids = pids;
  assert.ok(!hasExited(engine) && !hasExited(child), `the stand-in pair is running: ${describe(pids)}`);
  return pids;
}

/** Start the manual score verb through the compiled runner and capture its run id. */
function launchScore(fixture, options = {}) {
  const launch = { fixture, runId: undefined, launchedAt: Date.now() };
  openLaunches.push(launch);
  launch.result = runner.runCliAwait(fixture.owner, SCORE_ARGS, fixture.env, {
    slot: 'user-store', ownerIssuer: ISSUER, ...options,
    onRunStarted: (runId) => { launch.runId = runId; },
  });
  return launch;
}

/** The owner-visible terminal state of one run. */
function terminal(runId) {
  const run = engineRuns.engineRunSnapshot(runId);
  return run && { state: run.state, reason: run.reason };
}

/** Spawn the wrapper directly under an adoption proof, as a runner whose process died left it. */
function spawnAdoptedWrapper(fixture, proof, detached) {
  const child = spawn(process.execPath, [binPath, ...SCORE_ARGS], {
    env: {
      PATH: process.env.PATH,
      OSHAL_USER_SUB: fixture.owner,
      OSHAL_TENANT: TENANT,
      JOBHUNTER_STORE_ROOT: storeRoot,
      JOBHUNTER_PYTHON: standInPath,
      CAREER_HUNTER_BROKER_COMPLETE: '1',
      CH_STANDIN_PIDS: fixture.pidFile,
      [locks.RUN_LOCK_ADOPTION_ENV]: proof,
    },
    stdio: 'ignore',
    detached,
  });
  seenPids.add(child.pid);
  child.exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  return child;
}

/** Hold the lease the way the runner does and run one adopted wrapper to its deadline. */
async function runAdoptedToDeadline(name, detached) {
  const fixture = runFixture(name);
  const acquired = locks.tryAcquireRunLocks(storeRoot, TENANT, locks.buildRunResources(fixture.owner, 'score'));
  assert.equal(acquired.status, 'ok');
  try {
    const deadlineAt = Date.now() + 3_000;
    const wrapper = spawnAdoptedWrapper(
      fixture, locks.serializeRunLockAdoption(acquired.lease, deadlineAt), detached,
    );
    const pids = await standInPids(fixture);
    assert.equal(pids.wrapper, wrapper.pid, 'the stand-in is the wrapper child');
    const group = procState(pids.engine).pgrp;
    const exit = await within(wrapper.exited, deadlineAt + STOP_WINDOW_MS - Date.now(), 'the wrapper never exited');
    await waitFor(() => hasExited(pids.engine) && hasExited(pids.child), deadlineAt + STOP_WINDOW_MS - Date.now(),
      () => `the wrapper deadline left the engine running: ${describe(pids)}`);
    return { wrapper, pids, group, exit };
  } finally {
    locks.releaseRunLocks(acquired.lease);
  }
}

test('an owner cancel stops the engine and its child within 5 s and the run ends cancelled', { skip, timeout: 60_000 }, async () => {
  const fixture = runFixture('cancel');
  const launch = launchScore(fixture);
  const pids = await standInPids(fixture);
  assert.equal(engineRuns.cancelEngineRun('another-owner', launch.runId).status, 'not-found');
  assert.equal(engineRuns.cancelEngineRun(fixture.owner, launch.runId).status, 'cancelled');
  const cancelledAt = Date.now();
  await waitFor(() => hasExited(pids.engine) && hasExited(pids.child), STOP_WINDOW_MS,
    () => `5 s after the cancel the engine is still running: ${describe(pids)}`);
  const result = await within(launch.result, STOP_WINDOW_MS - (Date.now() - cancelledAt),
    'the run was not settled within 5 s of the cancel');
  assert.equal(result.ok, false);
  assert.deepEqual(terminal(launch.runId), { state: 'cancelled', reason: 'cancelled-by-owner' });
});

test('the runner deadline stops the engine and its child while the wrapper cannot act', { skip, timeout: 60_000 }, async () => {
  const fixture = runFixture('deadline');
  const launch = launchScore(fixture, { timeoutMs: 3_000 });
  const pids = await standInPids(fixture);
  // Frozen, the wrapper's own copy of the deadline cannot fire: only the runner's group kill remains.
  process.kill(pids.wrapper, 'SIGSTOP');
  const bound = launch.launchedAt + 3_000 + STOP_WINDOW_MS;
  await waitFor(() => hasExited(pids.engine) && hasExited(pids.child), bound - Date.now(),
    () => `the runner deadline left the engine running: ${describe(pids)}`);
  const result = await within(launch.result, bound - Date.now(), 'the run never settled after its deadline');
  assert.equal(result.timedOut, true);
  assert.deepEqual(terminal(launch.runId), { state: 'failed', reason: 'timeout' });
});

test('the lease-loss fence stops the engine and its child while the wrapper cannot act', { skip, timeout: 60_000 }, async () => {
  process.env.CAREER_HUNTER_LOCK_TTL_MS = '10000';
  try {
    const fixture = runFixture('lease-loss');
    const launch = launchScore(fixture);
    const pids = await standInPids(fixture);
    process.kill(pids.wrapper, 'SIGSTOP');
    const userResource = locks.buildRunResources(fixture.owner, 'score')
      .find((resource) => JSON.parse(resource)[0] === 'user');
    const digest = crypto.createHash('sha256').update(userResource).digest('hex');
    fs.rmSync(path.join(storeRoot, TENANT, '.career-run-locks', digest), { recursive: true, force: true });
    // A 10 s lease heartbeats every 3.33 s; the fence then has the same 5 s window as a cancel.
    const bound = Date.now() + 3_334 + STOP_WINDOW_MS;
    await waitFor(() => hasExited(pids.engine) && hasExited(pids.child), bound - Date.now(),
      () => `the lease-loss fence left the engine running: ${describe(pids)}`);
    const result = await within(launch.result, bound - Date.now(), 'the run never settled after its lease was lost');
    assert.equal(result.ok, false);
    assert.equal(terminal(launch.runId).state, 'failed');
  } finally {
    delete process.env.CAREER_HUNTER_LOCK_TTL_MS;
  }
});

test('an adopted wrapper that leads its group and outlives the runner fences its engine and exits through cleanup', { skip, timeout: 60_000 }, async () => {
  const { wrapper, group, exit } = await runAdoptedToDeadline('orphan', true);
  assert.equal(group, wrapper.pid, 'under the adopted lease the engine joins the wrapper process group');
  assert.deepEqual(exit, { code: 124, signal: null }, 'the wrapper spared itself and exited through its cleanup');
});

test('an adopted wrapper that does not lead a group keeps the engine in a group of its own', { skip, timeout: 60_000 }, async () => {
  const { pids, group, exit } = await runAdoptedToDeadline('shared-parent-group', false);
  assert.equal(group, pids.engine, 'the engine never joins a group the wrapper shares with its parent');
  assert.deepEqual(exit, { code: 124, signal: null });
});
