/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pin the two wrappers around the scoped gate. The scheduled full run (scripts/store-full-run.sh) is what keeps a scoped push honest, so it must test origin/main and never a working tree, run every job, rerun only failed package jobs once, write a dated receipt and exit non-zero when the suite is red, and wait for the coordination lock. The pre-push hook must say on its own last line which mode ran, so a scoped pass never reads as a full one. Driven over a disposable git store holding copies of the real scripts.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const COPIED = [
  'scripts/store-ci-local.mjs', 'scripts/store-ci-local.sh', 'scripts/store-ci-scope.mjs', 'scripts/store-ci-report.mjs',
  'scripts/manifest-dependencies.mjs', 'scripts/store-full-run.sh', 'scripts/store-gate-services.sh', '.githooks/pre-push',
];
const PASSING = "const test=require('node:test');test('the fixture suite passes',()=>{});\n";
const FAILING = "const test=require('node:test'),assert=require('node:assert/strict');test('the fixture suite is red',()=>{assert.fail('red');});\n";
const PASSING_ESM = "import test from 'node:test';\ntest('the fixture check passes', () => {});\n";
const FAILING_ESM = "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('the structural rule is red', () => { assert.fail('red'); });\n";

const step = (name, run, workingDirectory) => [
  `      - name: ${name}`, ...(workingDirectory ? [`        working-directory: ${workingDirectory}`] : []), `        run: ${run}`,
];
const job = (id, steps, needs) => [
  `  ${id}:`, `    name: the ${id} job`, '    runs-on: ubuntu-latest',
  ...(needs ? ['    needs: [test-discovery, catalog-parity]'] : []),
  '    steps:', '      - uses: actions/checkout@v4', ...steps.flat(), '',
];
const WORKFLOW = [
  'name: store-ci', 'on:', '  workflow_dispatch:', '', 'jobs:',
  ...job('test-discovery', [['      - uses: actions/setup-node@v4', '        with:', "          node-version: '22'"],
    step('Discovery', 'node --test scripts/discovery.test.mjs')]),
  ...job('catalog-parity', [step('Catalog', 'node --test scripts/catalog.test.mjs')]),
  ...job('attribution', [step('Wall', 'node --test scripts/wall.test.mjs')]),
  ...job('public-snapshot', [step('Snapshot', 'node --test scripts/snapshot.test.mjs')]),
  ...job('alpha', [step('Run alpha suites', 'node --test "tests/*.test.js"', 'alpha')], true),
  ...job('beta', [step('Run beta suites', 'node --test "tests/*.test.js"', 'beta')], true),
].join('\n');

/** @description Write a file under the fixture, creating its folders. */
function put(root, file, text) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')
  && !key.startsWith('STORE_CI_') && !key.startsWith('STORE_FULL_RUN_') && !key.startsWith('OSHAL_') && key !== 'NODE_TEST_CONTEXT'));

/**
 * @description A disposable store with copies of the real gate scripts, committed, origin/main at that commit.
 * @param {import('node:test').TestContext} t The case, so the store is removed with it.
 * @returns {{root:string,scratch:string}} The store root and a scratch folder beside it.
 */
function buildStore(t) {
  const scratch = mkdtempSync(join(tmpdir(), 'store-gate-wrappers-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const root = join(scratch, 'store');
  for (const file of COPIED) cpSync(join(REPO, file), join(root, file));
  put(root, '.github/workflows/store-ci.yml', WORKFLOW);
  for (const name of ['discovery', 'catalog', 'wall', 'snapshot']) put(root, `scripts/${name}.test.mjs`, PASSING_ESM);
  const apps = [];
  for (const pkg of ['alpha', 'beta']) {
    put(root, `${pkg}/oshal-app.yaml`, `name: ${pkg}\nversion: 1.0.0\n`);
    put(root, `${pkg}/tests/a.test.js`, PASSING);
    apps.push({ name: pkg, version: '1.0.0', source: { source: 'git-subdir', path: pkg } });
  }
  put(root, 'marketplace.json', `${JSON.stringify({ version: 1, name: 'fixture', apps }, null, 2)}\n`);
  git(scratch, ['init', '-q', '-b', 'main', root]);
  git(root, ['config', 'user.name', 'oshal tests']);
  git(root, ['config', 'user.email', 'maintainer@emeraldcoastsystemsgroup.com']);
  commit(root, 'the fixture store');
  git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  return { root, scratch };
}
const commit = (root, message) => { git(root, ['add', '-A']); git(root, ['commit', '-q', '-m', message]); };

/**
 * @description Run the store's copy of the scheduled full run with no fetch, services or install.
 * @param {{root:string,scratch:string}} store The fixture.
 * @param {Record<string,string>} extra Variables this case sets.
 * @returns {{status:number,output:string,receipts:string,files:string[]}} What happened and what it left.
 */
function fullRun({ root, scratch }, extra = {}) {
  const receipts = join(scratch, 'receipts');
  const run = spawnSync('bash', [join(root, 'scripts/store-full-run.sh')], {
    env: { ...cleanEnv(), STORE_FULL_RUN_RECEIPTS: receipts, STORE_FULL_RUN_LOCK: join(scratch, 'heavy.lock'),
      STORE_FULL_RUN_FETCH: '0', STORE_FULL_RUN_SERVICES: '0', STORE_FULL_RUN_INSTALL: '0', ...extra },
    encoding: 'utf8', cwd: scratch, maxBuffer: 64 * 1024 * 1024,
  });
  const files = existsSync(receipts) ? readdirSync(receipts).sort() : [];
  return { status: run.status, output: `${run.stdout}${run.stderr}`, receipts, files };
}
const receiptOf = (run) => {
  const name = run.files.find((file) => /^\d{8}T\d{6}Z-[0-9a-f]{8}[.]json$/.test(file));
  assert.ok(name, `a dated receipt, in ${run.files.join(', ')}\n${run.output}`);
  return { name, receipt: JSON.parse(readFileSync(join(run.receipts, name), 'utf8')), log: readFileSync(join(run.receipts, name.replace(/json$/, 'log')), 'utf8') };
};

test('the full run tests origin/main in a clean checkout, runs every job and writes a dated receipt', (t) => {
  const store = buildStore(t);
  const main = git(store.root, ['rev-parse', 'HEAD']);
  // Neither an uncommitted edit nor a commit that is not on origin/main may reach the run.
  put(store.root, 'beta/tests/a.test.js', FAILING);
  put(store.root, 'alpha/tests/b.test.js', FAILING);
  const run = fullRun(store);
  assert.equal(run.status, 0, run.output);
  const { name, receipt, log } = receiptOf(run);
  assert.ok(name.endsWith(`-${main.slice(0, 8)}.json`));
  assert.equal(receipt.kind, 'store-full-run');
  assert.equal(receipt.commit, main);
  assert.equal(receipt.mode, 'full');
  assert.equal(receipt.verdict, 'passed');
  assert.equal(receipt.exit, 0);
  assert.equal(receipt.checks.run, receipt.checks.total);
  assert.deepEqual(receipt.jobs.left, []);
  assert.match(log, /^store-ci-local PASSED\.$/m);
  assert.doesNotMatch(log, /SCOPED/);
  assert.deepEqual(JSON.parse(readFileSync(join(run.receipts, 'latest.json'), 'utf8')), receipt);
  assert.equal(run.files.filter((file) => file.startsWith('work-')).length, 0, 'the checkout is removed afterwards');
});

test('a red suite on origin/main fails the full run, after one rerun of the failed job only', (t) => {
  const store = buildStore(t);
  put(store.root, 'beta/tests/a.test.js', FAILING);
  commit(store.root, 'beta goes red');
  git(store.root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const run = fullRun(store);
  assert.equal(run.status, 1, run.output);
  const { receipt, log } = receiptOf(run);
  assert.equal(receipt.verdict, 'failed');
  assert.equal(receipt.exit, 1);
  assert.deepEqual(receipt.failed.map((failure) => failure.job), ['beta']);
  assert.deepEqual(receipt.retryOf, ['beta']);
  assert.deepEqual(receipt.firstRunFailed.map((failure) => failure.job), ['beta']);
  assert.ok(receipt.failed[0].tests.some((name) => /the fixture suite is red/.test(name)), JSON.stringify(receipt.failed));
  assert.match(log, /=== rerun of the failed jobs ===/);
  assert.match(log, /retry: rerunning the 1 job\(s\) that failed/);
  assert.equal(receipt.checks.run, 6, 'the plan is the whole suite');
  assert.equal(receipt.checks.ran, 3, 'the rerun runs beta and the publish wall, not alpha or the structural rules again');
});

test('a red structural rule fails the full run and is not retried', (t) => {
  const store = buildStore(t);
  put(store.root, 'scripts/catalog.test.mjs', FAILING_ESM);
  commit(store.root, 'the catalog rule goes red');
  git(store.root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const run = fullRun(store);
  assert.equal(run.status, 1, run.output);
  const { receipt, log } = receiptOf(run);
  assert.equal(receipt.verdict, 'failed');
  assert.ok(receipt.failed.some((failure) => failure.job === 'catalog-parity'));
  assert.doesNotMatch(log, /=== rerun/);
});

test('the full run waits for the coordination lock, and gives up past its wait with exit 75 and no receipt', async (t) => {
  const store = buildStore(t);
  const lock = join(store.scratch, 'heavy.lock');
  const holder = spawn('flock', [lock, 'sleep', '20'], { stdio: 'ignore' });
  t.after(() => holder.kill('SIGKILL'));
  await new Promise((done) => setTimeout(done, 400));
  const run = fullRun(store, { STORE_FULL_RUN_LOCK_WAIT: '1' });
  assert.equal(run.status, 75, run.output);
  assert.match(run.output, /stayed busy/);
  assert.equal(run.files.filter((file) => file.endsWith('.json')).length, 0);
});

/**
 * @description Run the store's copy of the pre-push hook with no push lines on stdin.
 * @param {string} root The store root.
 * @param {Record<string,string>} extra Variables this case sets.
 * @returns {{status:number,output:string,last:string}} What happened.
 */
function prePush(root, extra = {}) {
  const run = spawnSync('bash', [join(root, '.githooks/pre-push')], {
    env: { ...cleanEnv(), OSHAL_ATTRIBUTION_SCAN_TREE: '0', ...extra }, cwd: root, input: '', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${run.stdout}${run.stderr}`;
  return { status: run.status, output, last: output.split(/\r?\n/).filter((line) => line.trim()).pop() ?? '' };
}

test('the hook names the mode on its last line: scoped for a package change, full when asked', (t) => {
  const { root } = buildStore(t);
  put(root, 'alpha/tests/a.test.js', `${PASSING}// changed\n`);
  commit(root, 'alpha only');
  const scoped = prePush(root);
  assert.equal(scoped.status, 0, scoped.output);
  assert.match(scoped.last, /store CI gate passed \(scoped: 5 of 6 jobs, 5 of 6 checks; 1 jobs left to the scheduled full run\)/);
  assert.match(scoped.output, /store-ci-local SCOPED PASSED/);
  assert.doesNotMatch(scoped.output, /^store-ci-local PASSED/m);
  const full = prePush(root, { OSHAL_STORE_CI_FULL: '1' });
  assert.equal(full.status, 0, full.output);
  assert.match(full.last, /store CI gate passed \(full suite: 6 of 6 checks\)/);
  assert.match(full.output, /^store-ci-local PASSED\.$/m);
});

test('the hook fails a scoped push on a red structural rule, and the emergency valve skips only the store CI gate', (t) => {
  const { root } = buildStore(t);
  put(root, 'scripts/wall.test.mjs', FAILING_ESM);
  put(root, 'alpha/tests/a.test.js', `${PASSING}// changed\n`);
  commit(root, 'alpha, and a red wall');
  // scripts/ changed, so this one is full; the next commit puts scripts/ back on main and stays scoped.
  git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  put(root, 'alpha/tests/a.test.js', `${PASSING}// changed again\n`);
  commit(root, 'alpha again');
  const red = prePush(root);
  assert.equal(red.status, 1, red.output);
  assert.match(red.output, /STORE CI GATE FAILED \(scoped: /);
  assert.match(red.output, /store-ci-local SCOPED FAILED/);
  const valve = prePush(root, { OSHAL_STORE_CI_LOCAL: '0' });
  assert.equal(valve.status, 0, valve.output);
  assert.match(valve.output, /attribution gate: the commits this push publishes/);
  assert.match(valve.output, /SKIPPED by OSHAL_STORE_CI_LOCAL=0/);
});
