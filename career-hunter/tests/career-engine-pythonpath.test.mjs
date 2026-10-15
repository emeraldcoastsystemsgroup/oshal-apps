/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard that the native kernel's Python package runtime reaches the engine. The kernel's package sandbox names its pinned, read-only runtime on PYTHONPATH (/python-runtime); the COMPILED runner must pass it to the wrapper and the REAL bin/oshal-jobhunter.js must put it after the engine directory, not replace it. A stand-in engine (JOBHUNTER_PYTHON) records the PYTHONPATH it was started with. Scoped doubles: the kernel logger and the user-store path leaf.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binPath = path.join(packageRoot, 'bin', 'oshal-jobhunter.js');
const engineDir = path.join(packageRoot, 'engine');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'career-pythonpath-'));
const standIn = path.join(fixtureRoot, 'engine-stand-in.sh');
const posixOnly = process.platform === 'win32' ? 'the stand-in engine is a POSIX shell script; store-ci runs this suite on ubuntu' : false;
const recorded = path.join(fixtureRoot, 'pythonpath.txt');
after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

fs.writeFileSync(standIn, '#!/bin/sh\nprintf "%s" "$PYTHONPATH" > "$CH_PYTHONPATH_OUT"\n', { mode: 0o755 });

/** Run the real wrapper for a read verb with exactly this environment plus the stand-in engine. */
function launch(extra) {
  fs.rmSync(recorded, { force: true });
  const result = spawnSync(process.execPath, [binPath, 'stories', 'list'], {
    env: {
      PATH: process.env.PATH, HOME: fixtureRoot,
      OSHAL_USER_SUB: 'pythonpath-owner', JOBHUNTER_STORE_ROOT: path.join(fixtureRoot, 'store'),
      JOBHUNTER_PYTHON: standIn, CH_PYTHONPATH_OUT: recorded, CAREER_HUNTER_BROKER_COMPLETE: '1', ...extra,
    },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return fs.readFileSync(recorded, 'utf8').trim();
}

test('the wrapper keeps the sandbox runtime after the engine directory', { skip: posixOnly }, () => {
  assert.equal(launch({ PYTHONPATH: '/python-runtime' }), [engineDir, '/python-runtime'].join(path.delimiter));
});

test('without an inherited runtime the engine directory alone is the path', { skip: posixOnly }, () => {
  assert.equal(launch({}), engineDir);
});

test('the compiled runner hands an inherited PYTHONPATH to the wrapper', () => {
  const originalLoad = Module._load;
  Module._load = function loadRunnerDependency(request, parent, isMain) {
    if (request === '@/shared/logger') {
      return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
    }
    if (request === './career-user-store') {
      return {
        careerTenant: () => 'default',
        userPaths: (userSub) => ({ userDir: path.join(fixtureRoot, 'store', 'default', userSub) }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const saved = process.env.PYTHONPATH;
  try {
    const runner = require('../routes/career-engine-runner.js');
    process.env.PYTHONPATH = '/python-runtime';
    assert.equal(runner.buildCareerEngineProcessEnv('pythonpath-owner').PYTHONPATH, '/python-runtime');
  } finally {
    Module._load = originalLoad;
    if (saved === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = saved;
  }
});
