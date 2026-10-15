/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pin the exit-code contract of scripts/store-ci-local.mjs. The first cut of that runner printed "Never treat SKIPPED as green" and then exited 0 anyway, so on any layout where the TypeScript compiler could not be resolved - which is every fresh clone - the little-monsters SECURITY suite, kalshi and career-hunter were all skipped and the run still reported success. A hook and a human both read `$?`, not the prose, so the skip has to reach the exit code. These two cases hold that: a prerequisite-missing run is non-zero, and --allow-skips is the deliberate opt-out that returns zero while still NAMING what did not run. Driven over a disposable fixture store through STORE_CI_LOCAL_ROOT rather than the real 45-check tree, so the guard stays fast and cannot be perturbed by the repository's own state.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    OSHAL_ROOT: _r, OSHAL_CORE_DIR: _c, NODE_TEST_CONTEXT: _n, STORE_CI_TOOLCHAIN: _t, ...env
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
