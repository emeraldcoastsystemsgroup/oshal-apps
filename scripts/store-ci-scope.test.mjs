/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pin the scoped mode of scripts/store-ci-local.mjs. A change to one package used to wait for every package's suites (about 140 checks), and one unrelated browser timeout under load failed the push. Scoped mode runs the publish wall, the structural rules and the suites of the packages a change touches or reaches; these cases hold the rules that keep it from ever running less than it should: what always runs, what a change selects, when the whole suite runs instead, that a scoped pass never reads as a full pass, and that a rerun after a failure is bound to the same tree and still runs the publish wall. Driven through the real runner over a disposable git store, plus the placement of this repository's own workflow.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALWAYS_JOBS, PUBLISH_WALL, catalogChanges, placePaths, selectPackages,
} from './store-ci-scope.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = resolve(HERE, 'store-ci-local.mjs');
// Set by the mutation case for the copy of this file it runs against a changed mapper.
const MUTANT = process.env.STORE_CI_SCOPE_MUTANT === '1';

const PASSING = "const test=require('node:test');test('the fixture suite passes',()=>{});\n";
const PASSING_ESM = "import test from 'node:test';\ntest('the fixture check passes', () => {});\n";

/** A whole-tree check: red when any manifest carries the line `broken: true`. */
const CATALOG_CHECK = [
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import fs from 'node:fs';",
  "test('no manifest is broken', () => {",
  "  for (const dir of fs.readdirSync('.')) {",
  "    const manifest = `${dir}/oshal-app.yaml`;",
  "    if (fs.existsSync(manifest)) assert.doesNotMatch(fs.readFileSync(manifest, 'utf8'), /broken: true/, manifest);",
  '  }',
  '});',
  '',
].join('\n');

/** Fails while the file FIXTURE_BUSY names exists: a suite that is red on a busy machine and green alone. */
const BUSY_SUITE = "const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');"
  + "test('passes when the machine is quiet',()=>{assert.equal(fs.existsSync(process.env.FIXTURE_BUSY||'/nonexistent'),false,'busy');});\n";

/** Reads a sibling package's file by path, with no declared dependency. */
const READING_SUITE = "const test=require('node:test'),fs=require('node:fs'),path=require('node:path');"
  + "test('reads alpha',()=>{fs.readFileSync(path.join(__dirname, '..', '..', 'alpha', 'oshal-app.yaml'),'utf8');});\n";

const step = (name, run, workingDirectory, env) => [
  `      - name: ${name}`,
  ...(workingDirectory ? [`        working-directory: ${workingDirectory}`] : []),
  ...(env ? ['        env:', ...Object.entries(env).map(([key, value]) => `          ${key}: ${value}`)] : []),
  `        run: ${run}`,
];
const job = (id, steps, needs) => [
  `  ${id}:`, `    name: the ${id} job`, '    runs-on: ubuntu-latest',
  ...(needs ? ['    needs: [test-discovery, catalog-parity]'] : []),
  '    steps:', '      - uses: actions/checkout@v4', ...steps.flat(), '',
];
const suites = (pkg) => step(`Run ${pkg} suites`, 'node --test "tests/*.test.js"', pkg);

/** @description The fixture workflow: four always jobs, one mixed always job, and eight package jobs. */
function workflow(extra = []) {
  return [
    'name: store-ci', 'on:', '  workflow_dispatch:', '', 'jobs:',
    ...job('test-discovery', [['      - uses: actions/setup-node@v4', '        with:', "          node-version: '22'"],
      step('Discovery', 'node --test scripts/discovery.test.mjs')]),
    ...job('catalog-parity', [step('Catalog', 'node --test scripts/catalog.test.mjs')]),
    ...job('attribution', [step('Wall', 'node --test scripts/wall.test.mjs')]),
    ...job('public-snapshot', [step('Snapshot', 'node --test scripts/snapshot.test.mjs')]),
    ...job('store-bots', [
      step('Bot contracts', 'node --test scripts/bots.test.mjs'),
      step('Ported packages declare something runnable', 'node --test omega/tests/a.test.js'),
      step('Run omega suites inside the bots job', 'node --test "tests/*.test.js"', 'omega'),
    ]),
    ...job('alpha', [step('Whole-tree separation', 'node scripts/check-store-separation.mjs .'), suites('alpha')], true),
    ...job('alpha-source', [step('Run alpha source suites', 'node --test alpha/source/office.test.js')]),
    ...job('beta', [suites('beta')], true),
    ...job('gamma', [suites('gamma')], true),
    ...job('delta', [suites('delta')], true),
    ...job('epsilon', [suites('epsilon')], true),
    ...job('reader', [suites('reader')], true),
    ...job('omega', [suites('omega')], true),
    ...extra,
  ].join('\n');
}

const DEPENDENCIES = {
  beta: '  required:\n    apps: [alpha]\n',
  gamma: '  required:\n    apps: [beta]\n',
  quiet: '  required:\n    apps: [alpha]\n',
  delta: '  optional:\n    apps: [alpha]\n',
  epsilon: '  optional:\n    apps: [delta]\n',
};
const PACKAGES = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'reader', 'omega', 'quiet', 'sigma'];
// One package whose catalog name is not its folder, as intelligent-trades is for trading.
const CATALOG_NAME = { omega: 'intelligent-omega' };

/** @description Write a file under the fixture, creating its folders. */
function put(root, file, text) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/**
 * @description Build a disposable git store: committed, with origin/main at that commit.
 * @param {import('node:test').TestContext} t The case, so the store is removed with it.
 * @param {{extraJobs?:string[], originMain?:boolean}} options Extra workflow jobs; whether origin/main exists.
 * @returns {string} The store root.
 */
function buildStore(t, { extraJobs = [], originMain = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'store-ci-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, '.github/workflows/store-ci.yml', workflow(extraJobs));
  for (const name of ['discovery', 'wall', 'snapshot', 'bots']) put(root, `scripts/${name}.test.mjs`, PASSING_ESM);
  put(root, 'scripts/catalog.test.mjs', CATALOG_CHECK);
  put(root, 'scripts/check-store-separation.mjs', 'process.exit(0);\n');
  put(root, 'README.md', '# fixture store\n');
  const apps = [];
  for (const pkg of PACKAGES) {
    const declared = DEPENDENCIES[pkg] ? `dependencies:\n${DEPENDENCIES[pkg]}` : '';
    put(root, `${pkg}/oshal-app.yaml`, `name: ${CATALOG_NAME[pkg] ?? pkg}\nversion: 1.0.0\n${declared}`);
    put(root, `${pkg}/tests/a.test.js`, pkg === 'reader' ? READING_SUITE : pkg === 'delta' ? BUSY_SUITE : PASSING);
    put(root, `audits/${CATALOG_NAME[pkg] ?? pkg}.json`, '{"version":"1.0.0"}\n');
    apps.push({ name: CATALOG_NAME[pkg] ?? pkg, version: '1.0.0', source: { source: 'git-subdir', path: pkg } });
  }
  put(root, 'alpha/source/office.test.js', PASSING);
  put(root, 'marketplace.json', `${JSON.stringify({ version: 1, name: 'fixture', apps }, null, 2)}\n`);
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'oshal tests']);
  git(root, ['config', 'user.email', 'maintainer@emeraldcoastsystemsgroup.com']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'the fixture store']);
  if (originMain) git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  return root;
}

/**
 * @description Run the real runner over the fixture store.
 * @param {string} root The store root.
 * @param {string[]} args Extra argv.
 * @param {Record<string,string>} extra Variables this case sets.
 * @returns {{status:number,output:string,checks:string[],last:string,result:object|null}} What happened.
 */
function runGate(root, args = [], extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')
    && !key.startsWith('STORE_CI_') && !key.startsWith('OSHAL_') && key !== 'NODE_TEST_CONTEXT'));
  const resultFile = join(root, '..', `${root.split('/').pop()}-result.json`);
  rmSync(resultFile, { force: true });
  const run = spawnSync(process.execPath, [RUNNER, ...args], {
    env: { ...env, STORE_CI_RESULT_FILE: resultFile, ...extra, STORE_CI_LOCAL_ROOT: root },
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const lines = output.split(/\r?\n/);
  const checks = lines.map((line) => /^(?:PASS|FAIL|PARTIAL|SKIPPED|BLOCKED)\s+(\S+ · .*?)(?: \([0-9.]+s\))?\s*$/.exec(line)?.[1]).filter(Boolean);
  const result = existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, 'utf8')) : null;
  rmSync(resultFile, { force: true });
  return { status: run.status, output, checks, last: lines.filter((line) => line.trim()).pop() ?? '', result, resultFile };
}

const WALL = ['attribution · Wall', 'public-snapshot · Snapshot'];
const ALWAYS = [
  'test-discovery · Discovery', 'catalog-parity · Catalog', ...WALL,
  'store-bots · Bot contracts', 'store-bots · Ported packages declare something runnable',
  'alpha · Whole-tree separation',
];
const OMEGA = ['store-bots · omega/Run omega suites inside the bots job', 'omega · omega/Run omega suites'];
const ALL = [
  ...ALWAYS, ...OMEGA, 'alpha · alpha/Run alpha suites', 'alpha-source · Run alpha source suites',
  'beta · beta/Run beta suites', 'gamma · gamma/Run gamma suites', 'delta · delta/Run delta suites',
  'epsilon · epsilon/Run epsilon suites', 'reader · reader/Run reader suites',
];
const sorted = (list) => [...list].sort();

test('a change to one package runs the always set plus that package\'s jobs and nothing else', (t) => {
  const root = buildStore(t);
  put(root, 'gamma/tools/page.js', '// a change to one package nothing depends on\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'gamma only']);
  const { status, output, checks, result } = runGate(root);
  assert.equal(status, 0, output);
  assert.deepEqual(sorted(checks), sorted([...ALWAYS, 'gamma · gamma/Run gamma suites']), output);
  assert.match(output, /scope: SCOPED/);
  assert.match(output, /changed packages: gamma\b/);
  assert.deepEqual(result.changedPackages, ['gamma']);
  assert.deepEqual(sorted(result.jobs.left), sorted(['alpha-source', 'beta', 'delta', 'epsilon', 'reader', 'omega']));
});

test('a change to a depended-on package runs its required dependants, through the whole required chain', (t) => {
  const root = buildStore(t);
  put(root, 'alpha/tools/page.js', '// alpha changes\n');
  const { status, output, checks, result } = runGate(root);
  assert.equal(status, 0, output);
  for (const expected of ['alpha · alpha/Run alpha suites', 'alpha-source · Run alpha source suites',
    'beta · beta/Run beta suites', 'gamma · gamma/Run gamma suites']) {
    assert.ok(checks.includes(expected), `${expected} must run\n${output}`);
  }
  assert.match(output, /beta \(requires alpha\)/);
  assert.match(output, /gamma \(requires beta\)/);
  // A dependant no store-ci step runs in or names is still named, with that fact.
  assert.match(output, /quiet \(requires alpha; no store-ci step runs in or names it\)/);
  assert.equal(result.selectedPackages.quiet, 'requires alpha');
});

test('an optional dependant runs one hop from the change, and no further', (t) => {
  const root = buildStore(t);
  put(root, 'alpha/tools/page.js', '// alpha changes\n');
  const { checks, output } = runGate(root);
  assert.ok(checks.includes('delta · delta/Run delta suites'), output);
  assert.match(output, /delta \(optionally uses alpha\)/);
  assert.equal(checks.includes('epsilon · epsilon/Run epsilon suites'), false, 'epsilon only optionally uses delta');
  assert.match(output, /left to the scheduled full run[^\n]*\n?[^\n]*epsilon/);
});

test('a package whose tests read the changed package by path runs too', (t) => {
  const root = buildStore(t);
  put(root, 'alpha/tools/page.js', '// alpha changes\n');
  const { checks, output } = runGate(root);
  assert.ok(checks.includes('reader · reader/Run reader suites'), output);
  assert.match(output, /reader \(its tests read alpha\)/);
  assert.deepEqual(sorted(checks), sorted(ALL.filter((check) => !OMEGA.includes(check) && !check.startsWith('epsilon'))));
});

test('a change under scripts/, .github/ or .githooks/ runs everything', (t) => {
  for (const file of ['scripts/helper.mjs', '.github/workflows/other.yml', '.githooks/pre-push']) {
    const root = buildStore(t);
    put(root, file, '# the gate itself changed\n');
    const { status, output, checks, last, result } = runGate(root);
    assert.match(output, new RegExp(`scope: FULL — ${file.replace(/[.]/g, '\\.')} changed`), output);
    assert.deepEqual(sorted(checks), sorted(ALL), output);
    assert.equal(result.mode, 'full');
    assert.doesNotMatch(output, /SCOPED/);
    assert.equal(last, 'store-ci-local PASSED.');
    assert.equal(status, 0, output);
  }
});

test('a change to a manifest only still runs every structural job', (t) => {
  const root = buildStore(t);
  put(root, 'omega/oshal-app.yaml', 'name: intelligent-omega\nversion: 1.0.1\n');
  const { status, output, checks } = runGate(root);
  for (const always of ALWAYS) assert.ok(checks.includes(always), `${always} must run for a manifest-only change\n${output}`);
  // Both of Omega's steps run: the one in its own job and the one inside the always job.
  assert.deepEqual(sorted(checks), sorted([...ALWAYS, ...OMEGA]), output);
  assert.equal(status, 0, output);
});

test('a scoped pass says scoped on its last line and never prints the full-pass line', (t) => {
  const skipping = (reason) => `${PASSING}require('node:test')('a case this box cannot run', { skip: ${JSON.stringify(reason)} }, () => {});\n`;
  const variants = [
    { suite: PASSING, args: [] },
    { suite: skipping('LEGACY: needs the old checkout'), args: [] },
    { suite: skipping('a prerequisite this box lacks'), args: ['--allow-skips'] },
  ];
  for (const { suite, args } of variants) {
    const root = buildStore(t);
    put(root, 'gamma/tools/page.js', '// gamma only\n');
    put(root, 'gamma/tests/a.test.js', suite);
    const { status, output, last, result } = runGate(root, args);
    assert.equal(status, 0, output);
    assert.doesNotMatch(output, /store-ci-local PASSED/, 'the full-pass line must never appear in a scoped run');
    assert.match(last, /^store-ci-local SCOPED PASSED — scoped, not the full suite: 7 of 13 jobs run \(8 of 16 checks\), 6 left to the scheduled full run; changed packages: gamma\.$/);
    assert.equal(result.mode, 'scoped');
    assert.equal(result.verdict, 'passed');
    assert.equal(result.summary, last);
  }
});

test('--full runs every job and keeps the full-pass line, whatever changed', (t) => {
  const root = buildStore(t);
  put(root, 'gamma/tools/page.js', '// gamma only\n');
  const { status, output, checks, last, result } = runGate(root, ['--full']);
  assert.match(output, /scope: FULL — asked for with --full/);
  assert.deepEqual(sorted(checks), sorted(ALL), output);
  assert.equal(result.mode, 'full');
  assert.doesNotMatch(output, /SCOPED/);
  assert.equal(last, 'store-ci-local PASSED.');
  assert.equal(status, 0, output);
});

test('a failing structural job fails a scoped run', (t) => {
  const root = buildStore(t);
  put(root, 'gamma/oshal-app.yaml', 'name: gamma\nversion: 1.0.0\nbroken: true\n');
  const { status, output, last, result } = runGate(root);
  assert.notEqual(status, 0, output);
  assert.match(output, /FAIL\s+catalog-parity · Catalog/);
  assert.match(output, /BLOCKED\s+gamma · gamma\/Run gamma suites/, 'the needs gate still holds in a scoped run');
  assert.match(last, /^store-ci-local SCOPED FAILED — do not push\./);
  assert.equal(result.verdict, 'failed');
  assert.equal(result.retryable, false, 'a structural failure is not something a second try changes');
  assert.deepEqual(result.failed.map((failure) => failure.job), ['catalog-parity']);
  assert.match(result.failed[0].tests.join('\n'), /no manifest is broken/);
});

test('a folder that is not a package, or a root file every package shares, falls back to the full suite', (t) => {
  for (const [file, reason] of [
    ['stray/notes.txt', /stray\/notes\.txt is in a folder that is not a package/],
    ['.gitignore', /\.gitignore is a root file every package shares/],
    ['audits/profile.schema.json', /audits\/profile\.schema\.json belongs to no catalog package/],
  ]) {
    const root = buildStore(t);
    put(root, file, 'something the mapper cannot place\n');
    const { output, checks, result } = runGate(root);
    assert.match(output, /scope: FULL — /);
    assert.match(output, reason);
    assert.deepEqual(sorted(checks), sorted(ALL), 'never less than everything');
    assert.equal(result.mode, 'full');
  }
});

test('a job the mapper cannot place falls back to the full suite', (t) => {
  const cases = [
    [job('mystery', [step('A new structural rule nobody listed', 'node --test scripts/wall.test.mjs')]), /job mystery is neither in the always set nor about a package/],
    [job('elsewhere', [step('Runs in a folder that is not a package', 'node --test "tests/*.test.js"', 'audits')]), /job elsewhere runs a step in audits, which is not a package folder/],
  ];
  for (const [extra, reason] of cases) {
    const root = buildStore(t, { extraJobs: extra });
    put(root, 'gamma/tools/page.js', '// gamma only\n');
    const { output, result } = runGate(root, ['--plan']);
    assert.match(output, /scope: FULL — /, output);
    assert.match(output, reason);
    assert.equal(result.mode, 'full');
    assert.equal(result.checks.run, result.checks.total);
  }
});

test('with no origin/main, or outside a git checkout, the whole suite runs', (t) => {
  const root = buildStore(t, { originMain: false });
  put(root, 'gamma/tools/page.js', '// gamma only\n');
  const first = runGate(root, ['--plan']);
  assert.match(first.output, /scope: FULL — no merge base with origin\/main/);
  rmSync(join(root, '.git'), { recursive: true, force: true });
  const second = runGate(root, ['--plan']);
  assert.match(second.output, /scope: FULL — this is not the top of a git checkout/);
  assert.equal(second.result.checks.run, second.result.checks.total);
});

test('a version bump is placed by its catalog entry, its audit record and the generated README', (t) => {
  const root = buildStore(t);
  const catalog = JSON.parse(readFileSync(join(root, 'marketplace.json'), 'utf8'));
  catalog.apps.find((entry) => entry.name === 'intelligent-omega').version = '1.0.1';
  put(root, 'marketplace.json', `${JSON.stringify(catalog, null, 2)}\n`);
  put(root, 'audits/intelligent-omega.json', '{"version":"1.0.1"}\n');
  put(root, 'README.md', '# fixture store\n\n| intelligent-omega | 1.0.1 |\n');
  const { output, result } = runGate(root, ['--plan']);
  assert.match(output, /scope: SCOPED/, output);
  assert.deepEqual(result.changedPackages, ['omega']);
  assert.deepEqual(result.jobs.run.filter((id) => !ALWAYS_JOBS.includes(id)), ['alpha', 'omega']);
});

test('the plan names the services the selected steps need, and none when no selected step needs one', (t) => {
  const sigma = job('sigma', [step('Run sigma suites', 'node --test "tests/*.test.js"', 'sigma',
    { OSHAL_TEST_POSTGRES: 'postgresql://postgres:fixture@127.0.0.1:35689/postgres' })], true);
  const declared = buildStore(t, { extraJobs: sigma });
  put(declared, 'sigma/tools/page.js', '// sigma changes\n');
  assert.deepEqual(runGate(declared, ['--plan']).result.services, ['OSHAL_TEST_POSTGRES'], 'a selected step declares it');
  const named = buildStore(t, { extraJobs: sigma });
  put(named, 'gamma/tests/b.test.js', `${PASSING}// refuses without process.env.OSHAL_TEST_SEARCH\n`);
  assert.deepEqual(runGate(named, ['--plan']).result.services, ['OSHAL_TEST_SEARCH'], 'a selected package\'s tests name it');
  const whole = runGate(named, ['--plan', '--full']).result.services;
  assert.deepEqual(whole, ['OSHAL_TEST_POSTGRES', 'OSHAL_TEST_SEARCH', 'CAREER_TEST_POSTGRES_ADMIN_URL'], 'a full run may need every one');
});

test('--plan prints what would run and what is left, and runs nothing', (t) => {
  const root = buildStore(t);
  put(root, 'gamma/tools/page.js', '// gamma only\n');
  const { status, output, checks, result } = runGate(root, ['--plan']);
  assert.equal(status, 0, output);
  assert.deepEqual(checks, []);
  assert.match(output, /always, the publish wall and the structural rules: test-discovery, catalog-parity, attribution, public-snapshot, store-bots/);
  assert.match(output, /left to the scheduled full run \(6 jobs, 8 checks\): alpha-source, beta, delta, epsilon, reader, omega; and in part: store-bots, alpha/);
  assert.equal(result.verdict, 'planned');
  assert.deepEqual(result.services, []);
  assert.doesNotMatch(output, /PASSED/);
});

/** @description A store where Delta's suite is red on the first run only, as a browser case is on a busy machine. */
function busyStore(t) {
  const root = buildStore(t);
  put(root, 'alpha/tools/page.js', '// alpha changes, so delta (optional) runs\n');
  const busy = join(root, '..', `${root.split('/').pop()}-busy`);
  writeFileSync(busy, 'busy');
  t.after(() => rmSync(busy, { force: true }));
  return { root, busy };
}

test('a rerun after a failed package suite runs the failed job and the publish wall, not everything', (t) => {
  const { root, busy } = busyStore(t);
  const first = runGate(root, [], { FIXTURE_BUSY: busy });
  assert.notEqual(first.status, 0, first.output);
  assert.deepEqual(first.result.failed.map((failure) => failure.job), ['delta']);
  assert.equal(first.result.retryable, true);
  const saved = join(root, '..', `${root.split('/').pop()}-first.json`);
  writeFileSync(saved, JSON.stringify(first.result));
  t.after(() => rmSync(saved, { force: true }));
  rmSync(busy);
  const second = runGate(root, ['--retry-from', saved], { FIXTURE_BUSY: busy });
  assert.equal(second.status, 0, second.output);
  assert.deepEqual(sorted(second.checks), sorted([...WALL, 'delta · delta/Run delta suites']));
  assert.match(second.output, /retry: rerunning the 1 job\(s\) that failed in the first run on this same tree \(delta\), and the publish wall/);
  assert.match(second.last, /^store-ci-local SCOPED PASSED on the rerun of 1 failed job\(s\) — scoped, not the full suite: /);
  assert.doesNotMatch(second.output, /store-ci-local PASSED/);
  assert.equal(second.result.retryOf.length, 1);
});

test('a rerun is refused when the tree is not the one the first run saw', (t) => {
  const { root, busy } = busyStore(t);
  const first = runGate(root, [], { FIXTURE_BUSY: busy });
  const saved = join(root, '..', `${root.split('/').pop()}-first.json`);
  writeFileSync(saved, JSON.stringify(first.result));
  t.after(() => rmSync(saved, { force: true }));
  rmSync(busy);
  put(root, 'alpha/tools/page.js', '// alpha changed again after the first run\n');
  const second = runGate(root, ['--retry-from', saved], { FIXTURE_BUSY: busy });
  assert.match(second.output, /retry: not used — the tree changed since the first run/);
  assert.ok(second.checks.includes('catalog-parity · Catalog'), 'the whole scoped plan runs instead');
  assert.equal(second.checks.length, first.checks.length);
});

test('a rerun is refused after a structural failure, and without a readable first result', (t) => {
  const root = buildStore(t);
  put(root, 'gamma/oshal-app.yaml', 'name: gamma\nversion: 1.0.0\nbroken: true\n');
  const first = runGate(root);
  const saved = join(root, '..', `${root.split('/').pop()}-first.json`);
  writeFileSync(saved, JSON.stringify(first.result));
  t.after(() => rmSync(saved, { force: true }));
  const second = runGate(root, ['--retry-from', saved]);
  assert.match(second.output, /retry: not used — the first run's failure is not one a second try changes/);
  assert.match(second.output, /FAIL\s+catalog-parity · Catalog/);
  const third = runGate(root, ['--retry-from', join(root, 'no-such-file.json')]);
  assert.match(third.output, /retry: not used — the first run's result could not be read/);
  assert.notEqual(third.status, 0);
});

test('the catalog is compared entry by entry, on what it says and not how it is written', () => {
  const entry = (name, version, path = name) => ({ name, version, description: 'A — B', source: { path } });
  const base = { version: 1, name: 'store', apps: [entry('alpha', '1.0.0'), entry('intelligent-omega', '1.0.0', 'omega')] };
  const packages = ['alpha', 'omega'];
  const text = (catalog) => JSON.stringify(catalog, null, 2);
  // The same catalog written with an escape is the same catalog.
  assert.deepEqual(catalogChanges(text(base), text(base).replaceAll('—', '\\u2014'), packages), { packages: [], full: '' });
  const bumped = structuredClone(base);
  bumped.apps[1].version = '1.0.1';
  assert.deepEqual(catalogChanges(text(base), text(bumped), packages), { packages: ['omega'], full: '' });
  const renamed = { ...base, name: 'another store' };
  assert.match(catalogChanges(text(base), text(renamed), packages).full, /marketplace\.json changed outside its apps entries/);
  const added = { ...base, apps: [...base.apps, entry('newcomer', '0.1.0')] };
  assert.match(catalogChanges(text(base), text(added), packages).full, /catalog entry newcomer points at newcomer, which is not a package folder/);
  assert.match(catalogChanges(text(base), '{ not json', packages).full, /marketplace\.json could not be read/);
  assert.match(catalogChanges(null, text(base), packages).full, /marketplace\.json could not be read/);
});

test('every changed path is placed, or the whole suite runs', () => {
  const context = { packages: ['alpha', 'omega'], catalogDirs: new Map([['alpha', 'alpha'], ['intelligent-omega', 'omega']]) };
  const place = (paths) => placePaths(paths, context);
  assert.deepEqual(place(['alpha/tools/a.js', 'alpha/tests/a.test.js']), { changed: ['alpha'], rootEntries: [], full: '' });
  assert.deepEqual(place(['audits/intelligent-omega.json', 'audits/evidence/alpha/abc/rls.json']), { changed: ['alpha', 'omega'], rootEntries: [], full: '' });
  assert.deepEqual(place(['README.md', 'COLLABORATE.md', 'marketplace.json']), { changed: [], rootEntries: ['COLLABORATE.md', 'README.md', 'marketplace.json'], full: '' });
  assert.match(place(['alpha/a.js', 'scripts/store-push.sh']).full, /scripts\/store-push\.sh changed, and scripts\/ is part of the gate itself/);
  assert.match(place(['.github/workflows/store-ci.yml']).full, /part of the gate itself/);
  assert.match(place(['.githooks/pre-push']).full, /part of the gate itself/);
  assert.match(place(['.gitleaks.toml']).full, /is a root file every package shares/);
  assert.match(place(['retired/tools/a.js']).full, /is in a folder that is not a package/);
  assert.match(place(['audits/README.md']).full, /belongs to no catalog package/);
  assert.match(place(['audits/unknown.json']).full, /belongs to no catalog package/);
});

test('dependants: required through the whole chain, optional and test readers one hop', () => {
  const edges = (pairs) => new Map(pairs.map(([key, values]) => [key, new Set(values)]));
  const graph = {
    required: edges([['alpha', ['beta']], ['beta', ['gamma']], ['delta', ['zeta']]]),
    optional: edges([['alpha', ['delta']], ['delta', ['epsilon']]]),
  };
  const reads = edges([['alpha', ['reader']], ['README.md', ['docs-reader']], ['reader', ['second-hand']]]);
  assert.deepEqual(Object.fromEntries(selectPackages(['alpha'], ['README.md'], graph, reads)), {
    alpha: 'changed', beta: 'requires alpha', gamma: 'requires beta', delta: 'optionally uses alpha',
    reader: 'its tests read alpha', 'docs-reader': 'its tests read README.md',
  });
  assert.deepEqual(Object.fromEntries(selectPackages([], [], graph, reads)), {});
});

test('the always set names the publish wall, and this repository\'s own workflow places every job', { skip: MUTANT }, () => {
  for (const wall of PUBLISH_WALL) assert.ok(ALWAYS_JOBS.includes(wall), `${wall} must always run`);
  assert.deepEqual(PUBLISH_WALL, ['attribution', 'public-snapshot']);
  const resultFile = join(mkdtempSync(join(tmpdir(), 'store-ci-scope-real-')), 'plan.json');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')
    && !key.startsWith('STORE_CI_') && key !== 'NODE_TEST_CONTEXT'));
  const run = spawnSync(process.execPath, [RUNNER, '--plan'], { env: { ...env, STORE_CI_RESULT_FILE: resultFile }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try {
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
    const { placement } = JSON.parse(readFileSync(resultFile, 'utf8'));
    assert.deepEqual(placement.unplaced, [], 'a job nobody placed makes every scoped run a full one');
    // Every id in the reviewed list is a job this workflow still declares, and nothing else always runs whole.
    assert.deepEqual(sorted(placement.always), sorted(ALWAYS_JOBS));
    assert.ok(Object.keys(placement.packages).length > 40, 'the package jobs are placed by the folders their steps run in');
    assert.deepEqual(placement.packages['career-hunter'], ['career-hunter']);
    assert.deepEqual(placement.packages.finance, ['finance', 'finance-experience']);
  } finally {
    rmSync(dirname(resultFile), { recursive: true, force: true });
  }
});

test('mutation: a job taken out of the always set turns the scoped cases red', { skip: MUTANT }, (t) => {
  const copy = mkdtempSync(join(tmpdir(), 'store-ci-scope-mutant-'));
  t.after(() => rmSync(copy, { recursive: true, force: true }));
  for (const removed of ['attribution', 'catalog-parity']) {
    const scripts = join(copy, removed, 'scripts');
    mkdirSync(scripts, { recursive: true });
    for (const file of ['store-ci-local.mjs', 'store-ci-scope.mjs', 'store-ci-report.mjs', 'store-ci-scope.test.mjs', 'manifest-dependencies.mjs']) {
      cpSync(join(HERE, file), join(scripts, file));
    }
    const mapper = readFileSync(join(scripts, 'store-ci-scope.mjs'), 'utf8');
    const mutated = mapper.replace(new RegExp(`\\n\\s*'${removed}',[^\\n]*`), '');
    assert.notEqual(mutated, mapper, `${removed} is listed in ALWAYS_JOBS on a line of its own`);
    writeFileSync(join(scripts, 'store-ci-scope.mjs'), mutated);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && key !== 'NODE_TEST_CONTEXT'));
    const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
      '--test-name-pattern=always set plus that package|scoped pass says scoped', join(scripts, 'store-ci-scope.test.mjs')],
    { env: { ...env, STORE_CI_SCOPE_MUTANT: '1' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const output = `${run.stdout}${run.stderr}`;
    assert.notEqual(run.status, 0, `removing ${removed} from the always set must fail a test\n${output}`);
    assert.match(output, /not ok \d+ - a change to one package runs the always set plus that package's jobs and nothing else/);
    // The mutant fails safe: with the job unplaced the mapper runs the whole suite, never less.
    assert.match(output, /scope: FULL — job \S+ is neither in the always set nor about a package/);
  }
});
