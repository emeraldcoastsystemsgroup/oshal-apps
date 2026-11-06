/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pin the exit-code contract of scripts/store-ci-local.mjs. The first cut of that runner printed "Never treat SKIPPED as green" and then exited 0 anyway, so on any layout where the TypeScript compiler could not be resolved - which is every fresh clone - the little-monsters SECURITY suite, kalshi and career-hunter were all skipped and the run still reported success. A hook and a human both read `$?`, not the prose, so the skip has to reach the exit code. These two cases hold that: a prerequisite-missing run is non-zero, and --allow-skips is the deliberate opt-out that returns zero while still NAMING what did not run. Driven over a disposable fixture store through STORE_CI_LOCAL_ROOT rather than the real 45-check tree, so the guard stays fast and cannot be perturbed by the repository's own state.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Pin the two guards that keep a hung suite from holding a push: a step whose workflow names a service address fails in seconds, before its suite starts, when the variable is unset or nothing answers there (and --allow-skips does not accept it); and a suite that never exits fails at the deadline with no process of it left running. Two pushes on 2026-11-03 waited 15,214 s and 8,377 s on exactly that shape.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Pin which skips block: a LEGACY step or a suite's own LEGACY cases pass the push and stay printed, and a skipped case with any other reason still blocks it.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Preserve a middle-of-suite failed assertion and complete private failure evidence while retaining the original nonzero verdict.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';
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
 * @param {Record<string,string>} extra Variables this case sets; the service variables are otherwise absent.
 * @returns {{status:number,output:string}} Exit status and combined output.
 */
function runRunner(root, args = [], extra = {}) {
  // NODE_TEST_CONTEXT must go: a `node --test` child that inherits it reports into THIS test run
  // and exits 0 regardless, which would make both assertions below pass vacuously.
  const {
    OSHAL_ROOT: _r, OSHAL_CORE_DIR: _c, NODE_TEST_CONTEXT: _n, STORE_CI_TOOLCHAIN: _t,
    OSHAL_TEST_POSTGRES: _p, OSHAL_TEST_SEARCH: _s, STORE_CI_CHECK_DEADLINE_SECONDS: _d, STORE_CI_FAILURE_LOG_DIR: _e, ...env
  } = process.env;
  const result = spawnSync(process.execPath, [RUNNER, ...args], {
    env: { ...env, ...extra, STORE_CI_LOCAL_ROOT: root },
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

/** A real hook repository must survive a child's independent git init/add/commit. */
test('hook Git locations never escape into a disposable repository test', () => {
  const root = buildFixture();
  const victim = mkdtempSync(join(tmpdir(), 'store-ci-hook-owner-'));
  const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  try {
    git(victim, ['init', '-q']);
    git(victim, ['config', 'user.name', 'oshal tests']);
    git(victim, ['config', 'user.email', 'maintainer@emeraldcoastsystemsgroup.com']);
    writeFileSync(join(victim, 'owned.txt'), 'original hook repository');
    git(victim, ['add', 'owned.txt']);
    git(victim, ['commit', '-q', '-m', 'original fixture owner']);
    const head = git(victim, ['rev-parse', 'HEAD']);
    writeFileSync(join(root, '.github/workflows/store-ci.yml'), WORKFLOW.split('  needs-compiler:')[0]);
    writeFileSync(join(root, 'pkg/tests/a.test.js'), [
      "const test=require('node:test'),assert=require('node:assert/strict');",
      "const cp=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');",
      "test('actual independent Git commit',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'store-ci-child-git-'));",
      "try{for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR'])assert.equal(process.env[key],undefined);",
      "const git=(args)=>cp.execFileSync('git',args,{cwd:dir,stdio:'pipe'});git(['init','-q']);",
      "git(['config','user.name','oshal tests']);git(['config','user.email','maintainer@emeraldcoastsystemsgroup.com']);",
      "fs.writeFileSync(path.join(dir,'child.txt'),'independent child');git(['add','child.txt']);git(['commit','-q','-m','independent fixture']);",
      "assert.match(git(['rev-parse','HEAD']).toString(),/^[a-f0-9]{40}/);}",
      "finally{fs.rmSync(dir,{recursive:true,force:true});}});",
    ].join('\n'));
    const result = spawnSync(process.execPath, [RUNNER], {
      encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: '', STORE_CI_LOCAL_ROOT: root,
        GIT_DIR: join(victim, '.git'), GIT_WORK_TREE: victim, GIT_INDEX_FILE: join(victim, '.git/index'),
        GIT_COMMON_DIR: join(victim, '.git') },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(git(victim, ['rev-parse', 'HEAD']), head);
    assert.equal(git(victim, ['status', '--porcelain']), '');
    assert.equal(readFileSync(join(victim, 'owned.txt'), 'utf8'), 'original hook repository');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(victim, { recursive: true, force: true });
  }
});

/**
 * @description Give a fixture store (or any directory) a node_modules that carries a TypeScript the
 *   runner can find. Only the package.json is probed, so nothing is installed.
 * @param {string} dir The directory that will own node_modules.
 */
function plantCompiler(dir) {
  mkdirSync(join(dir, 'node_modules', 'typescript'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'typescript', 'package.json'), '{"name":"typescript","version":"0.0.0"}');
}

/** A suite that fails if the old platform checkout reached it through the environment. */
const ENV_PROBE = [
  "const test=require('node:test'),assert=require('node:assert/strict');",
  "test('no legacy checkout reaches the suite',()=>{",
  "  for(const key of ['OSHAL_FRAMEWORK','NODE_PATH','OSHAL_CORE_ROOT'])assert.equal(process.env[key],undefined,key);",
  "  if(process.env.OSHAL_ROOT)assert.match(process.env.OSHAL_ROOT,/scripts[\\/]toolchain$/);",
  "});",
].join('\n');

test('the fixture store\'s own scripts/toolchain satisfies the compiler job', () => {
  const root = buildFixture();
  try {
    plantCompiler(join(root, 'scripts', 'toolchain'));
    writeFileSync(join(root, 'pkg', 'tests', 'a.test.js'), ENV_PROBE);
    const { status, output } = runRunner(root);
    assert.match(output, /PASS\s+needs-compiler/, 'the toolchain must satisfy the compiler capability');
    assert.doesNotMatch(output, /SKIPPED/);
    assert.equal(status, 0, output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an inherited OSHAL_ROOT, OSHAL_FRAMEWORK or NODE_PATH is never used to resolve a checkout', () => {
  const root = buildFixture();
  const decoy = mkdtempSync(join(tmpdir(), 'store-ci-legacy-checkout-'));
  try {
    plantCompiler(decoy);
    writeFileSync(join(root, 'pkg', 'tests', 'a.test.js'), ENV_PROBE);
    const { NODE_TEST_CONTEXT: _n, STORE_CI_TOOLCHAIN: _t, ...env } = process.env;
    const result = spawnSync(process.execPath, [RUNNER], {
      env: { ...env, STORE_CI_LOCAL_ROOT: root, OSHAL_ROOT: decoy, OSHAL_FRAMEWORK: decoy, OSHAL_CORE_DIR: decoy,
        NODE_PATH: join(decoy, 'node_modules') },
      encoding: 'utf8',
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.match(output, /SKIPPED\s+needs-compiler/, 'a compiler in an inherited checkout must not satisfy the job');
    assert.match(output, /ignoring inherited OSHAL_ROOT, OSHAL_FRAMEWORK, OSHAL_CORE_DIR, NODE_PATH/);
    assert.match(output, /PASS\s+plain/, 'the probe suite saw no legacy variable');
    assert.notEqual(result.status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(decoy, { recursive: true, force: true });
  }
});

test('a step that needs the framework checkout is SKIPPED with a LEGACY reason', () => {
  const root = buildFixture();
  try {
    plantCompiler(join(root, 'scripts', 'toolchain'));
    writeFileSync(join(root, '.github', 'workflows', 'store-ci.yml'), WORKFLOW.split('  needs-compiler:')[0] + [
      '  framework-coupled:',
      '    name: a package whose suites read the framework source',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - name: Provide the framework checkout',
      '        run: npm ci --legacy-peer-deps --no-audit --no-fund --prefix framework',
      '      - name: Run framework-coupled suites',
      '        working-directory: pkg',
      '        env:',
      '          OSHAL_FRAMEWORK: framework',
      '        run: node --test "tests/*.test.js"',
      '',
    ].join('\n'));
    const { status, output } = runRunner(root, ['--allow-skips']);
    assert.match(output, /SKIPPED\s+framework-coupled/);
    assert.match(output, /LEGACY: needs the old TypeScript platform checkout \(oshal\/src\)/);
    assert.equal(status, 0, output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A workflow whose one suite reports its own skipped case, with this reason. */
function skippingCase(root, reason) {
  writeFileSync(join(root, 'pkg', 'tests', 'a.test.js'), SUITE
    + `test('a case this box cannot run', { skip: ${JSON.stringify(reason)} }, () => {});\n`);
  writeFileSync(join(root, '.github', 'workflows', 'store-ci.yml'), WORKFLOW.split('  needs-compiler:')[0]);
}

test('a LEGACY step does not block a push, and the run still says it did not run', () => {
  const root = buildFixture();
  try {
    plantCompiler(join(root, 'scripts', 'toolchain'));
    writeFileSync(join(root, '.github', 'workflows', 'store-ci.yml'), WORKFLOW.split('  needs-compiler:')[0] + [
      '  framework-coupled:',
      '    name: a package whose suites read the framework source',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - name: Run framework-coupled suites',
      '        working-directory: pkg',
      '        env:',
      '          OSHAL_FRAMEWORK: framework',
      '        run: node --test "tests/*.test.js"',
      '',
    ].join('\n'));
    const { status, output } = runRunner(root);
    assert.equal(status, 0, output);
    assert.match(output, /SKIPPED\s+framework-coupled/, 'it is still reported');
    assert.match(output, /did not fully run/, 'the verdict still says so');
    assert.doesNotMatch(output, /INCOMPLETE/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a suite's own LEGACY or engine cases do not block a push", () => {
  for (const reason of ['LEGACY: needs the old checkout', 'EMBODIED_ENGINE_ADDR not set - the live suite needs an engine']) {
    const root = buildFixture();
    try {
      skippingCase(root, reason);
      const { status, output } = runRunner(root);
      assert.equal(status, 0, output);
      assert.match(output, /PARTIAL/, 'it is still reported');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('a skipped case with any other reason still blocks a push', () => {
  const root = buildFixture();
  try {
    skippingCase(root, 'CAREER_TEST_POSTGRES_ADMIN_URL not set');
    const { status, output } = runRunner(root);
    assert.notEqual(status, 0, output);
    assert.match(output, /INCOMPLETE/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A package step that names its disposable services the way the Operations step does. */
const SERVICE_JOB = [
  '  needs-service:',
  '    name: a package whose suites need disposable services',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - name: Run service suites',
  '        working-directory: svc',
  '        env:',
  '          OSHAL_TEST_POSTGRES: postgresql://postgres:operations-contract-ci@127.0.0.1:35689/postgres',
  '          OSHAL_TEST_SEARCH: http://127.0.0.1:35690',
  '        run: node --test "tests/*.test.js"',
  '',
].join('\n');

/** Records that it ran, so a case can prove the suite never started. */
const MARKER_SUITE = "const test=require('node:test'),fs=require('node:fs'),path=require('node:path');"
  + "test('the service suite ran',()=>{fs.writeFileSync(path.join(__dirname,'..','ran'),'yes');});";

/** Finishes its only test and then never exits: the leaked-handle shape. */
const HANGING_SUITE = "const test=require('node:test'),fs=require('node:fs'),path=require('node:path');"
  + "test('leaves a handle open',()=>{fs.writeFileSync(path.join(__dirname,'..','pid'),String(process.pid));setInterval(()=>{},1000);});";

/** @description Build a fixture store whose second job names two service addresses. */
function buildServiceFixture() {
  const root = buildFixture();
  writeFileSync(join(root, '.github', 'workflows', 'store-ci.yml'), WORKFLOW.split('  needs-compiler:')[0] + SERVICE_JOB);
  mkdirSync(join(root, 'svc', 'tests'), { recursive: true });
  writeFileSync(join(root, 'svc', 'tests', 'a.test.js'), MARKER_SUITE);
  return root;
}

/**
 * @description Listen on a loopback port, or find one nothing listens on.
 * @param {boolean} keep Keep the listener open (an answering service) or close it (a dead address).
 * @returns {Promise<{port:number,close:Function}>} The port and a closer.
 */
async function loopbackPort(keep) {
  const server = createServer((socket) => socket.end());
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  const close = () => new Promise((done) => server.close(done));
  if (!keep) await close();
  return { port, close };
}

test('a step whose service variable is unset fails in seconds and never starts its suite', () => {
  const root = buildServiceFixture();
  try {
    const started = Date.now();
    const { status, output } = runRunner(root, ['--allow-skips']);
    assert.match(output, /FAIL\s+needs-service/, output);
    assert.match(output, /OSHAL_TEST_POSTGRES is unset\. store-ci gives this step OSHAL_TEST_POSTGRES=postgresql:\/\/postgres:operations-contract-ci@127\.0\.0\.1:35689\/postgres/);
    assert.equal(existsSync(join(root, 'svc', 'ran')), false, 'the suite must not start without its service');
    assert.notEqual(status, 0, 'a missing service is a failure, which --allow-skips does not accept');
    assert.ok(Date.now() - started < 30000, 'the refusal must come in seconds, not at a deadline');
    assert.match(output, /PASS\s+plain/, 'the job with no service still ran');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a service address nothing answers at fails before the suite starts', async () => {
  const root = buildServiceFixture();
  const live = await loopbackPort(true);
  const dead = await loopbackPort(false);
  try {
    const { status, output } = runRunner(root, [], {
      OSHAL_TEST_POSTGRES: `host=127.0.0.1 port=${live.port} user=fixture dbname=kernel`,
      OSHAL_TEST_SEARCH: `http://127.0.0.1:${dead.port}`,
    });
    assert.match(output, new RegExp(`nothing answers at 127\\.0\\.0\\.1:${dead.port}, the disposable service OSHAL_TEST_SEARCH names`), output);
    assert.equal(existsSync(join(root, 'svc', 'ran')), false, 'the suite must not start against a dead address');
    assert.notEqual(status, 0);
  } finally {
    await live.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('services that answer, in URL or keyword form, let the suite run', async () => {
  const root = buildServiceFixture();
  const live = await loopbackPort(true);
  try {
    const { status, output } = runRunner(root, [], {
      OSHAL_TEST_POSTGRES: `host=127.0.0.1 port=${live.port} user=fixture dbname=kernel`,
      OSHAL_TEST_SEARCH: `http://127.0.0.1:${live.port}`,
    });
    assert.match(output, /PASS\s+needs-service/, output);
    assert.equal(readFileSync(join(root, 'svc', 'ran'), 'utf8'), 'yes', 'the suite really ran');
    assert.equal(status, 0, output);
  } finally {
    await live.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a suite that never exits fails at the deadline and leaves no process behind', async () => {
  const root = buildFixture();
  try {
    writeFileSync(join(root, '.github', 'workflows', 'store-ci.yml'), WORKFLOW.split('  needs-compiler:')[0]);
    writeFileSync(join(root, 'pkg', 'tests', 'a.test.js'), HANGING_SUITE);
    const started = Date.now();
    const { status, output } = runRunner(root, [], { STORE_CI_CHECK_DEADLINE_SECONDS: '3' });
    assert.ok(Date.now() - started < 60000, 'the deadline, not the suite, must end the check');
    assert.match(output, /FAIL\s+plain/, output);
    assert.match(output, /no verdict after 3s: stopped with every process it started/);
    assert.notEqual(status, 0);
    const pid = Number(readFileSync(join(root, 'pkg', 'pid'), 'utf8'));
    let alive = true;
    for (let attempt = 0; attempt < 50 && alive; attempt += 1) {
      try { process.kill(pid, 0); await pause(100); } catch (error) { assert.equal(error.code, 'ESRCH'); alive = false; }
    }
    assert.equal(alive, false, `the hung test process ${pid} outlived the gate`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A failed assertion surrounded by enough successes to disappear from head/tail reporting. */
function buildMiddleFailureFixture() {
  const root = buildFixture();
  writeFileSync(join(root, '.github', 'workflows', 'store-ci.yml'), WORKFLOW.split('  needs-compiler:')[0]);
  const suite = ["import test from 'node:test';", "import assert from 'node:assert/strict';"];
  for (let index = 0; index < 40; index += 1) suite.push(`test('before-${index}', () => {});`);
  suite.push("test('the actual middle failure', () => { assert.fail('middle assertion cause'); });");
  for (let index = 0; index < 40; index += 1) suite.push(`test('after-${index}', () => {});`);
  writeFileSync(join(root, 'pkg', 'tests', 'a.test.js'), suite.join('\n'));
  return root;
}

test('a failed assertion in the middle of a long suite is visible and still refuses the gate', () => {
  const root = buildMiddleFailureFixture();
  try {
    const { status, output } = runRunner(root);
    assert.notEqual(status, 0, output);
    assert.match(output, /not ok 41 - the actual middle failure/);
    assert.match(output, /middle assertion cause/);
    assert.match(output, /80 passed|# pass 80/);
    assert.match(output, /store-ci-local FAILED/);
    assert.ok(output.split('\n').length < 160, 'the console excerpt stays bounded');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('opt-in failure evidence preserves the full output in a new private directory', () => {
  const root = buildMiddleFailureFixture();
  const evidence = join(root, 'failure-evidence');
  try {
    const { status, output } = runRunner(root, [], { STORE_CI_FAILURE_LOG_DIR: evidence });
    assert.notEqual(status, 0, output);
    assert.match(output, /Full failed-check output:/);
    const file = join(evidence, 'check-001.log');
    const raw = readFileSync(file, 'utf8');
    assert.match(raw, /ok 1 - before-0/);
    assert.match(raw, /not ok 41 - the actual middle failure/);
    assert.match(raw, /middle assertion cause/);
    assert.match(raw, /ok 81 - after-39/);
    assert.match(raw, /# tests 81/);
    if (process.platform !== 'win32') {
      assert.equal(statSync(evidence).mode & 0o777, 0o700);
      assert.equal(statSync(file).mode & 0o777, 0o600);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an existing failure-evidence directory is refused without overwriting its records', () => {
  const root = buildMiddleFailureFixture();
  const evidence = join(root, 'failure-evidence');
  mkdirSync(evidence);
  writeFileSync(join(evidence, 'check-001.log'), 'retained original evidence');
  try {
    const { status, output } = runRunner(root, [], { STORE_CI_FAILURE_LOG_DIR: evidence });
    assert.notEqual(status, 0, output);
    assert.match(output, /EEXIST/);
    assert.equal(readFileSync(join(evidence, 'check-001.log'), 'utf8'), 'retained original evidence');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
