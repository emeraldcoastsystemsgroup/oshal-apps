/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the manual framework-coupled gate discovers every package's core suite, refuses a vacuous pass, and fails on a red suite. Two layers: the aggregation logic through the spawn seam, and a REAL node --test run over throwaway fixture packages, because a gate proven only against a doubled spawn would stay green if it stopped actually running the suites.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The gate pins OSHAL_CORE_ROOT to the same checkout as OSHAL_CORE_DIR, and a stale OSHAL_CORE_ROOT in the caller's environment does not leak through to the suites.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Discovery covers the .core.spec.mjs browser specs; a real failing ESM spec turns the gate red, and a plain .spec.mjs or a .core.spec.js is not picked up.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Cover the Test Lab registration check through its lab seam: an admitted case passes; an unknown prerequisite name fails naming the case; withheld-by-name prerequisites keep a case pending without failing; an unknown name cannot hide behind a withheld one; any other pending reason fails; cases that register no core suite, and smoke cases, are not judged. The real-boundary run is the gate itself against the framework checkout.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkLabRegistrations, discoverCoreSuites, runCoreSuites } from './run-framework-coupled-tests.mjs';

/** Build a throwaway store with the given `{ path: contents }` files. */
function fixtureStore(files) {
  const root = mkdtempSync(join(tmpdir(), 'fc-store-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

const PASSING = "const t=require('node:test');const a=require('node:assert');t('ok',()=>a.equal(1,1));\n";
const FAILING = "const t=require('node:test');const a=require('node:assert');t('red',()=>a.equal(1,2));\n";

test('discovers only <package>/tests/*.core.test.js and *.core.spec.mjs, sorted, skipping node_modules and dot-directories', () => {
  const root = fixtureStore({
    'beta/tests/routes.core.test.js': PASSING,
    'alpha/tests/identity.core.test.js': PASSING,
    'alpha/tests/engine-thing.test.js': PASSING, // bare-checkout suite: not framework-coupled
    'alpha/tests/surface.core.spec.mjs': PASSING, // browser spec: node:test driving Playwright
    'alpha/tests/surface.spec.mjs': PASSING, // not framework-coupled
    'alpha/tests/notes.core.spec.js': PASSING, // wrong extension for a browser spec
    'node_modules/pkg/tests/x.core.test.js': PASSING,
    '.hidden/tests/y.core.test.js': PASSING,
  });
  try {
    assert.deepEqual(discoverCoreSuites(root), ['alpha/tests/identity.core.test.js', 'alpha/tests/surface.core.spec.mjs', 'beta/tests/routes.core.test.js']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('discovering nothing is a refusal, never a green run', () => {
  const root = fixtureStore({ 'alpha/tests/engine-thing.test.js': PASSING });
  try {
    assert.throws(() => runCoreSuites({ storeRoot: root, frameworkRoot: root, run: () => ({ status: 0 }) }),
      /refusing a vacuous pass/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runs every suite from its own package with OSHAL_CORE_DIR, and names every red one', () => {
  const root = fixtureStore({
    'alpha/tests/a.core.test.js': PASSING,
    'beta/tests/b.core.test.js': PASSING,
    'gamma/tests/c.core.test.js': PASSING,
  });
  const calls = [];
  const run = (_node, args, options) => {
    calls.push({ args, cwd: options.cwd, core: options.env.OSHAL_CORE_DIR, root: options.env.OSHAL_CORE_ROOT });
    return { status: options.cwd.endsWith('beta') || options.cwd.endsWith('gamma') ? 1 : 0 };
  };
  try {
    assert.throws(() => runCoreSuites({ storeRoot: root, frameworkRoot: '/framework', run }),
      (err) => /2 of 3/.test(err.message) && /beta\/tests\/b\.core\.test\.js/.test(err.message)
        && /gamma\/tests\/c\.core\.test\.js/.test(err.message));
    assert.equal(calls.length, 3, 'a red suite must not stop the run — every suite is reported');
    assert.ok(calls.every((c) => c.args[0] === '--test' && c.core.replace(/\\/g, '/').endsWith('/framework')));
    assert.ok(calls.every((c) => c.root === c.core), 'OSHAL_CORE_ROOT must name the same checkout as OSHAL_CORE_DIR');
    assert.ok(calls.some((c) => c.cwd.endsWith('alpha') && c.args[1] === 'tests/a.core.test.js'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a stale OSHAL_CORE_ROOT in the caller environment never outranks the checkout the gate names', () => {
  const root = fixtureStore({ 'alpha/tests/a.core.test.js': PASSING });
  const saved = process.env.OSHAL_CORE_ROOT;
  process.env.OSHAL_CORE_ROOT = '/somewhere/stale';
  let seen;
  try {
    runCoreSuites({ storeRoot: root, frameworkRoot: '/framework', run: (_n, _a, options) => { seen = options.env.OSHAL_CORE_ROOT; return { status: 0 }; } });
    assert.equal(seen.replace(/\\/g, '/').replace(/^[A-Za-z]:/, ''), '/framework');
  } finally {
    if (saved === undefined) delete process.env.OSHAL_CORE_ROOT; else process.env.OSHAL_CORE_ROOT = saved;
    rmSync(root, { recursive: true, force: true });
  }
});

test('a spawn error counts as a failure, not a pass', () => {
  const root = fixtureStore({ 'alpha/tests/a.core.test.js': PASSING });
  try {
    assert.throws(() => runCoreSuites({ storeRoot: root, frameworkRoot: root, run: () => ({ error: new Error('ENOENT'), status: null }) }),
      /1 of 1/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('REAL node --test: a green fixture package passes and returns the count', () => {
  const root = fixtureStore({ 'alpha/tests/a.core.test.js': PASSING, 'beta/tests/b.core.test.js': PASSING });
  try {
    assert.equal(runCoreSuites({ storeRoot: root, frameworkRoot: root }), 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('REAL node --test: a failing .core.spec.mjs browser spec turns the gate red too', () => {
  const failingEsm = "import test from 'node:test'; import assert from 'node:assert/strict'; test('red', () => assert.equal(1, 2));\n";
  const root = fixtureStore({ 'alpha/tests/a.core.test.js': PASSING, 'beta/tests/surface.core.spec.mjs': failingEsm });
  try {
    assert.throws(() => runCoreSuites({ storeRoot: root, frameworkRoot: root }),
      (err) => /1 of 2/.test(err.message) && /beta\/tests\/surface\.core\.spec\.mjs/.test(err.message));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('REAL node --test: one genuinely failing assertion turns the whole gate red', () => {
  const root = fixtureStore({ 'alpha/tests/a.core.test.js': PASSING, 'beta/tests/b.core.test.js': FAILING });
  try {
    assert.throws(() => runCoreSuites({ storeRoot: root, frameworkRoot: root }),
      (err) => /1 of 2/.test(err.message) && /beta\/tests\/b\.core\.test\.js/.test(err.message));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** A lab double: cases per package directory name, and a pending rule keyed by case id. */
function labDouble(casesByPackage, pendingById = {}) {
  return {
    loadCases: (dir) => casesByPackage[dir.replace(/\\/g, '/').split('/').pop()] ?? [],
    pending: (testCase) => pendingById[testCase.id],
  };
}
const nodeCase = (id, files) => ({ id, runner: { kind: 'node-test', scope: 'package', files } });

test('a framework-coupled case the runner can admit passes the registration check', () => {
  const lab = labDouble({ alpha: [nodeCase('routes-http', ['tests/routes.core.test.js'])] });
  assert.equal(checkLabRegistrations({ storeRoot: '/store', suites: ['alpha/tests/routes.core.test.js'], lab }), 1);
});

test('a framework-coupled case held pending on an unknown prerequisite name fails, naming the case and the reason', () => {
  const lab = labDouble({ alpha: [nodeCase('routes-http', ['tests/routes.core.test.js'])] },
    { 'routes-http': 'Additional prerequisites require verification: framework-checkout:oshal-core-dir.' });
  assert.throws(() => checkLabRegistrations({ storeRoot: '/store', suites: ['alpha/tests/routes.core.test.js'], lab }),
    (err) => /\(1\)/.test(err.message) && /alpha:routes-http - Additional prerequisites require verification: framework-checkout:oshal-core-dir\./.test(err.message));
});

test('prerequisites the sealed Lab withholds by name keep a case pending without failing the gate', () => {
  const lab = labDouble({
    alpha: [nodeCase('browser', ['tests/surface.core.spec.mjs']), nodeCase('live', ['tests/engine.core.test.js'])],
  }, {
    browser: 'Additional prerequisites require verification: harness:core-test-fixtures.',
    live: 'Additional prerequisites require verification: engine-container:oshal-embodied-engine.',
  });
  assert.equal(checkLabRegistrations({ storeRoot: '/store', suites: ['alpha/tests/surface.core.spec.mjs', 'alpha/tests/engine.core.test.js'], lab }), 2);
});

test('an unknown name cannot hide behind a withheld one in the same case', () => {
  const lab = labDouble({ alpha: [nodeCase('browser', ['tests/surface.core.spec.mjs'])] },
    { browser: 'Additional prerequisites require verification: harness:core-test-fixtures, framework-checkout:oshal-core.' });
  assert.throws(() => checkLabRegistrations({ storeRoot: '/store', suites: ['alpha/tests/surface.core.spec.mjs'], lab }), /alpha:browser/);
});

test('any other pending reason on a framework-coupled case fails; cases that register no core suite are not judged', () => {
  const lab = labDouble({
    alpha: [
      { id: 'page', runner: { kind: 'playwright', scope: 'package', files: ['tests/surface.core.spec.mjs'] } },
      nodeCase('engine-only', ['tests/engine-math.test.js']),
      { id: 'readiness', runner: { kind: 'smoke', smoke: 'package-readiness' } },
    ],
  }, { page: 'The playwright runner is unavailable.', 'engine-only': 'Additional prerequisites require verification: anything:else.' });
  assert.throws(() => checkLabRegistrations({ storeRoot: '/store', suites: ['alpha/tests/surface.core.spec.mjs'], lab }),
    (err) => /\(1\)/.test(err.message) && /alpha:page - The playwright runner is unavailable\./.test(err.message) && !/engine-only/.test(err.message));
});
