/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pin the exit-code contract of scripts/store-ci-local.mjs. The first cut of that runner printed "Never treat SKIPPED as green" and then exited 0 anyway, so on any layout where the TypeScript compiler could not be resolved - which is every fresh clone - the little-monsters SECURITY suite, kalshi and career-hunter were all skipped and the run still reported success. A hook and a human both read `$?`, not the prose, so the skip has to reach the exit code. These two cases hold that: a prerequisite-missing run is non-zero, and --allow-skips is the deliberate opt-out that returns zero while still NAMING what did not run. Driven over a disposable fixture store through STORE_CI_LOCAL_ROOT rather than the real 45-check tree, so the guard stays fast and cannot be perturbed by the repository's own state.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const RUNNER = resolve(dirname(fileURLToPath(import.meta.url)), 'store-ci-local.mjs');

/**
 * @description The fixture workflow: one package job that passes, one that needs a compiler the
 *   fixture cannot supply. Mirrors the real little-monsters shape - a `npm install ... typescript@`
 *   provision step plus a package step declaring OSHAL_ROOT - because that is the shape whose
 *   absence produced the false green.
 */
const WORKFLOW = [
  'name: store-ci',
  'on:',
  '  workflow_dispatch:',
  '',
  'jobs:',
  '  plain:',
  '    name: a package that needs nothing',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - uses: actions/setup-node@v4',
  '        with:',
  "          node-version: '22'",
  '      - name: Run plain suites',
  '        working-directory: pkg',
  '        run: node --test "tests/*.test.js"',
  '',
  '  needs-compiler:',
  '    name: a package that needs a TypeScript compiler',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - name: Provide a TypeScript compiler',
  '        run: npm install --no-save --prefix "$RUNNER_TEMP/tsroot" typescript@5.9.3',
  '      - name: Run compiler-dependent suites',
  '        working-directory: pkg',
  '        env:',
  '          OSHAL_ROOT: ${{ runner.temp }}/tsroot',
  '        run: node --test "tests/*.test.js"',
  '',
].join('\n');

const SUITE = [
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "test('the fixture package proves something', () => { assert.equal(1, 1); });",
  '',
].join('\n');

/** @description Build a disposable store whose compiler capability cannot resolve. */
function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'store-ci-local-'));
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(root, 'pkg', 'tests'), { recursive: true });
  writeFileSync(join(root, '.github', 'workflows', 'store-ci.yml'), WORKFLOW);
  writeFileSync(join(root, 'pkg', 'tests', 'a.test.js'), SUITE);
  return root;
}

/**
 * @description Run the real runner over the fixture with every compiler hint stripped.
 * @param {string} root The fixture store root.
 * @param {string[]} args Extra argv for the runner.
 * @returns {{status:number,output:string}} Exit status and combined output.
 */
function runRunner(root, args = []) {
  // NODE_TEST_CONTEXT must go: a `node --test` child that inherits it reports into THIS test run
  // and exits 0 regardless, which would make both assertions below pass vacuously.
  const {
    OSHAL_ROOT: _r, OSHAL_CORE_DIR: _c, NODE_TEST_CONTEXT: _n, ...env
  } = process.env;
  const result = spawnSync(process.execPath, [RUNNER, ...args], {
    env: { ...env, STORE_CI_LOCAL_ROOT: root },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

test('a check that could not run makes the whole run non-zero', () => {
  const root = buildFixture();
  try {
    const { status, output } = runRunner(root);
    assert.match(output, /SKIPPED/, 'the unrunnable check must be reported as SKIPPED');
    assert.match(output, /no TypeScript compiler found/, 'the skip must carry its reason');
    assert.match(output, /INCOMPLETE/, 'the verdict must say the run was incomplete');
    assert.notEqual(status, 0, 'a skipped check must not exit 0 - the exit code is what a hook reads');
    // Proves the fixture is not vacuous: the runnable job really did run and pass.
    assert.match(output, /PASS\s+plain/, 'the job with no prerequisite must still have run');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--allow-skips returns zero but still names what did not run', () => {
  const root = buildFixture();
  try {
    const { status, output } = runRunner(root, ['--allow-skips']);
    assert.equal(status, 0, '--allow-skips is the deliberate opt-out and must succeed');
    assert.match(output, /SKIPPED/, 'the opt-out must not hide the skip');
    assert.match(output, /no TypeScript compiler found/, 'the reason must survive the opt-out');
    assert.match(output, /did NOT run; nothing here proves them/, 'the verdict must stay honest');
    assert.doesNotMatch(output, /INCOMPLETE/, 'an accepted skip is not reported as incomplete');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
