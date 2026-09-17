#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pin the three ways scripts/run-trading-specs.mjs could lie. The step it replaces is the one that runs the specs for the package that places real orders with the operator's money, so "it printed something and exited 0" is not evidence. Every case here drives the REAL script as a child process over a disposable fixture package with a REAL Vitest: a spec set that resolves to nothing exits NON-ZERO (this repository has shipped a vacuous pass twice), a spec file carrying the live database's address is refused before Vitest starts, an environment already pointing at the live stack is refused the same way, and a genuinely passing fixture still returns zero so the gate is not merely stuck on red. A missing framework checkout FAILS here rather than skipping - a guard that cannot run is not a guard.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { refuseLiveDatabaseEnvironment, refuseLiveDatabaseLiterals, specEnvironment } from './run-trading-specs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, 'run-trading-specs.mjs');
const FRAMEWORK = process.env.OSHAL_FRAMEWORK || process.env.OSHAL_CORE_DIR || process.env.OSHAL_ROOT || '';
const roots = [];

/**
 * @description Build a disposable package the runner can be pointed at: its own Vitest config and
 *   whatever spec files the case needs. Nothing here touches the real store tree.
 * @param {Record<string,string>} files Spec file name to contents; an empty map means no spec files.
 * @returns {string} The package root.
 */
function fixturePackage(files) {
  const root = mkdtempSync(join(tmpdir(), 'oshal-gate-fixture-'));
  roots.push(root);
  mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'vitest.config.mjs'),
    "export default { test: { include: ['tests/**/*.spec.ts'], environment: 'node', globals: true } };\n");
  // Always at least one file, so the literal scan never reports UNCHECKED for a reason the case
  // did not intend — the zero-test cases are about what VITEST found, not about an empty directory.
  writeFileSync(join(root, 'tests', 'README.md'), 'disposable fixture\n');
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, 'tests', name), body);
  return root;
}

/**
 * @description Run the real gate script against a fixture package, exactly as a workflow step does.
 * @param {string} packageRoot The fixture package.
 * @param {Record<string,string>} extraEnv Environment additions for this case.
 * @returns {{status:number|null,output:string}} Exit status and combined output.
 */
function runGate(packageRoot, extraEnv = {}) {
  // NODE_TEST_CONTEXT must never reach the child: a node:test process that inherits it reports to
  // this parent over a side channel and exits 0 even when it failed, which would make every
  // exit-code assertion below vacuous.
  const { NODE_TEST_CONTEXT: _drop, ...clean } = process.env;
  const result = spawnSync(process.execPath, [RUNNER, '--package', packageRoot], {
    encoding: 'utf8', env: { ...clean, OSHAL_FRAMEWORK: FRAMEWORK, ...extraEnv },
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

describe('run-trading-specs — the ways this gate could report a pass it did not earn', () => {
  it('needs a framework checkout, and says so instead of skipping', () => {
    assert.ok(FRAMEWORK, 'OSHAL_FRAMEWORK/OSHAL_CORE_DIR/OSHAL_ROOT must name a checkout with node_modules/vitest. '
      + 'These cases drive a REAL Vitest; skipping them would leave the gate unproven.');
    const missing = runGate(fixturePackage({}), { OSHAL_FRAMEWORK: '', OSHAL_CORE_DIR: '', OSHAL_ROOT: '' });
    assert.notEqual(missing.status, 0, 'a run with no framework checkout must be non-zero');
    assert.match(missing.output, /OSHAL_FRAMEWORK is not set/);
  });

  it('a package whose spec set matches NOTHING exits non-zero', () => {
    const { status, output } = runGate(fixturePackage({}));
    assert.notEqual(status, 0, 'no spec files must never report success');
    assert.match(output, /ZERO tests ran|no JSON summary|FAILED/);
  });

  it('a spec file that declares NO cases exits non-zero', () => {
    // The sharper shape: Vitest finds the file, runs it, and reports zero tests. Exit status alone
    // does not catch this — the count does.
    const pkg = fixturePackage({ 'empty.spec.ts': "describe('nothing was asserted here', () => {});\n" });
    const { status, output } = runGate(pkg);
    assert.notEqual(status, 0, 'a suite with zero cases must never report success');
    assert.match(output, /ZERO tests ran/);
  });

  it('a genuinely passing package returns zero, so the gate is not simply stuck on red', () => {
    const pkg = fixturePackage({ 'ok.spec.ts': "it('runs', () => { expect(1 + 1).toBe(2); });\n" });
    const { status, output } = runGate(pkg);
    assert.equal(status, 0, `a passing fixture must exit 0:\n${output}`);
    assert.match(output, /1 passed of 1/);
  });

  it('a spec that names the live trading database is refused before Vitest starts', () => {
    const pkg = fixturePackage({
      'live.spec.ts': "const dsn = 'postgres://oshal:oshal@127.0.0.1:55433/oshal';\nit('x', () => { expect(dsn).toBeTruthy(); });\n",
    });
    const { status, output } = runGate(pkg);
    assert.notEqual(status, 0, 'a spec naming the live database must never run');
    assert.match(output, /names the operator's LIVE database/);
    assert.match(output, /published live-stack Postgres port/);
    assert.doesNotMatch(output, /Test Files/, 'Vitest must not have started');
  });

  it('the live database named as a host, or as an environment fallback, is refused too', () => {
    const host = refuseLiveDatabaseLiterals(join(fixturePackage({
      'host.spec.ts': "const dsn = 'postgres://oshal:oshal@oshal-local-db:5432/oshal';\n",
    }), 'tests'));
    assert.equal(host.hits.length, 1, JSON.stringify(host.hits));
    assert.match(host.hits[0], /named as a connection host/);
    const fallback = refuseLiveDatabaseLiterals(join(fixturePackage({
      'fallback.spec.ts': "const container = process.env.OSHAL_TEST_DB_CONTAINER || 'oshal-local-db';\n",
    }), 'tests'));
    assert.equal(fallback.hits.length, 1, JSON.stringify(fallback.hits));
    assert.match(fallback.hits[0], /environment fallback/);
  });

  it('an environment already pointing at the live stack is refused, by name', () => {
    const pkg = fixturePackage({ 'ok.spec.ts': "it('runs', () => { expect(true).toBe(true); });\n" });
    const { status, output } = runGate(pkg, { DATABASE_URL: 'postgres://oshal:oshal@127.0.0.1:55433/oshal' });
    assert.notEqual(status, 0, 'an inherited live DSN must stop the run');
    assert.match(output, /DATABASE_URL points at 127\.0\.0\.1:55433/);
    assert.doesNotMatch(output, /Test Files/, 'Vitest must not have started');
  });

  it('every pg environment variable is judged, and none of them reaches the child', () => {
    assert.deepEqual(refuseLiveDatabaseEnvironment({ PGPORT: '55434' }),
      ['PGPORT=55434 is a published live-stack Postgres port']);
    assert.deepEqual(refuseLiveDatabaseEnvironment({ PGHOST: 'oshal-local-db' }),
      ['PGHOST=oshal-local-db is a live database container']);
    assert.deepEqual(refuseLiveDatabaseEnvironment({ DATABASE_URL: 'postgres://u:p@127.0.0.1:55999/x' }), [],
      'a disposable database on another port is not refused');
    const child = specEnvironment(
      { PGHOST: 'somewhere', PGPORT: '5432', DATABASE_URL: 'postgres://u:p@somewhere:5432/x', NODE_TEST_CONTEXT: 'child-v8' },
      resolve(FRAMEWORK),
    );
    assert.equal(child.PGHOST, undefined);
    assert.equal(child.PGPORT, undefined);
    assert.equal(child.NODE_TEST_CONTEXT, undefined);
    assert.match(child.DATABASE_URL, /:1\/oshal_spec_must_not_reach_a_live_database$/);
  });

  it('the real trading spec tree is clean on these rules', () => {
    const scan = refuseLiveDatabaseLiterals(resolve(HERE, '..', 'trading', 'tests'));
    assert.ok(scan.files > 0, 'the trading spec tree must not be empty');
    assert.deepEqual(scan.hits, [], 'a trading spec names the live database');
  });
});
