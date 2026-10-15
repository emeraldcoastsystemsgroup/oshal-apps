/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the native kernel's background-run contract in the COMPILED runner: a background start asks the kernel to keep the request's sandbox for that run before acknowledging, reports the child's exit (0 only on success) exactly once even when the child ends before the kernel answers, and stops the child and fails the start when the kernel refuses; the status read names the caller's in-flight run. Scoped doubles: the kernel logger, the user-store path leaf, the kernel's `@/shared/package-runs` port and the child process.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'career-native-run-'));
const saved = process.env.JOBHUNTER_STORE_ROOT;
process.env.JOBHUNTER_STORE_ROOT = fixtureRoot;
after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  if (saved === undefined) delete process.env.JOBHUNTER_STORE_ROOT; else process.env.JOBHUNTER_STORE_ROOT = saved;
});

/** The kernel port double: records every call; keep answers as the test says. */
const kernel = { calls: [], keep: async () => ({}), runs: [] };
const port = {
  native: true,
  keepRunAlive: (runId, seconds) => { kernel.calls.push(['keep', runId, seconds]); return kernel.keep(runId); },
  runFinished: async (runId, code) => { kernel.calls.push(['finished', runId, code]); return { finished: true }; },
  status: async () => ({ runs: kernel.runs }),
};

const originalLoad = Module._load;
Module._load = function loadRunnerDependency(request, parent, isMain) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  if (request === '@/shared/package-runs') return port;
  if (request === './career-user-store') {
    return { careerTenant: () => 'default', userPaths: (sub) => ({ userDir: path.join(fixtureRoot, 'default', sub) }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const runner = require('../routes/career-engine-runner.js');
// The runner resolves the kernel port per start, as it does in the bridge: keep the double mounted.
after(() => { Module._load = originalLoad; });

/** A child that never was: no real pid, so no stop can reach a real process. */
function fakeChild() {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.pid = undefined;
  proc.exitCode = null;
  proc.killed = false;
  proc.kill = () => { proc.killed = true; return true; };
  setImmediate(() => proc.emit('spawn'));
  return proc;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('a background start is acknowledged only after the kernel keeps it, and its end is reported', async () => {
  kernel.calls = [];
  kernel.keep = async () => ({ runId: 'kept' });
  const child = fakeChild();
  const started = await runner.runCliAsync('owner-a', ['strengthen', 'scan'], {}, { spawnProcess: () => child });
  assert.deepEqual(started, { started: true });
  const [[kind, runId, seconds]] = kernel.calls;
  assert.equal(kind, 'keep');
  assert.ok(typeof runId === 'string' && runId.length > 0);
  assert.ok(seconds >= 1 && seconds <= 1800, `bounded keep: ${seconds}`);
  child.emit('close', 0);
  await tick();
  assert.deepEqual(kernel.calls.slice(1), [['finished', runId, 0]]);
});

test('a failed run reports a non-zero end so the kernel discards its writes', async () => {
  kernel.calls = [];
  kernel.keep = async () => ({});
  const child = fakeChild();
  await runner.runCliAsync('owner-b', ['strengthen', 'scan'], {}, { spawnProcess: () => child });
  child.emit('close', 2);
  await tick();
  assert.equal(kernel.calls.at(-1)[0], 'finished');
  assert.equal(kernel.calls.at(-1)[2], 1);
});

test('a child that ends before the kernel answers is still reported, once', async () => {
  kernel.calls = [];
  let release;
  kernel.keep = () => new Promise((resolve) => { release = resolve; });
  const child = fakeChild();
  const pending = runner.runCliAsync('owner-c', ['strengthen', 'scan'], {}, { spawnProcess: () => child });
  while (!release) await tick();
  child.emit('close', 0);
  await tick();
  assert.equal(kernel.calls.filter(([kind]) => kind === 'finished').length, 0, 'not reported before it is kept');
  release({});
  assert.deepEqual(await pending, { started: true });
  await tick();
  assert.equal(kernel.calls.filter(([kind]) => kind === 'finished').length, 1);
});

test('a run the kernel refuses to keep is stopped and the start fails', async () => {
  kernel.calls = [];
  kernel.keep = async () => { throw new Error('background runs need an isolated, owner-locked write request'); };
  const child = fakeChild();
  const started = await runner.runCliAsync('owner-d', ['strengthen', 'scan'], {}, { spawnProcess: () => child });
  assert.equal(started.started, false);
  assert.match(started.err, /background run refused/);
  child.emit('close', null);
  await tick();
  assert.equal(kernel.calls.filter(([kind]) => kind === 'finished').length, 0);
});

test('the status read names the caller\'s in-flight run', async () => {
  kernel.runs = [{ runId: 'run-in-flight' }];
  assert.equal(await runner.nativeRunInProgress(), 'run-in-flight');
  kernel.runs = [];
  assert.equal(await runner.nativeRunInProgress(), null);
});
