/**
 * Payroll schema-lock guard — runs against the COMPILED routes/payroll-schema.js
 * (the bytes the framework mounts) with the kernel's schema bootstrap stubbed at
 * the require layer so the options it receives can be asserted as a CALL.
 *
 * Why it exists: every guarded payroll request calls ensurePayrollSchema, so on a
 * fresh database the company view's parallel first reads ran the same
 * CREATE TABLE IF NOT EXISTS at once. Postgres does not make that race-safe (the
 * loser raises 23505 on pg_type_typname_nsp_index), and the acceptance sandbox
 * logged exactly that twice. The fix is a package-owned advisory-lock key passed
 * as lockKey; this suite fails if the key is dropped, changed, or moved into the
 * kernel's own SCHEMA_LOCK_KEYS block.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial - ensurePayrollSchema hands the kernel bootstrap the stable package key PAYROLL_SCHEMA_LOCK_KEY (47120123), outside the kernel's 4711xxxx block, together with the unchanged statements and requirements.
 * -----------------------------------------------------------------------------
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('node:module');

/** Every options object the stubbed kernel bootstrap was called with. */
const bootstrapCalls = [];
const STUBS = {
  '@/shared/services/database': {
    buildOwnerRlsPolicyStatements: (table, column) => [`-- owner rls ${table}.${column}`],
    runRuntimeSchemaBootstrap: async (options) => { bootstrapCalls.push(options); return 'applied'; },
  },
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return origLoad.call(this, request, ...rest);
};
const schema = require('../routes/payroll-schema.js');
Module._load = origLoad;

/** The kernel's reserved advisory-lock block (SCHEMA_LOCK_KEYS: 47110001 work items ... 47110009 trading). */
const KERNEL_BLOCK = { min: 47110000, max: 47119999 };

async function bootstrapOptions() {
  bootstrapCalls.length = 0;
  const pool = { query: async () => { throw new Error('the stubbed bootstrap must not reach the pool'); } };
  await schema.ensurePayrollSchema(pool);
  assert.equal(bootstrapCalls.length, 1, 'one kernel bootstrap per ensurePayrollSchema call');
  assert.equal(bootstrapCalls[0].pool, pool, 'the caller pool is handed through');
  return bootstrapCalls[0];
}

test('ensurePayrollSchema passes the package-owned advisory lock key to the kernel bootstrap', async () => {
  const options = await bootstrapOptions();
  assert.ok('lockKey' in options, 'lockKey is passed; without it concurrent first requests race on CREATE TABLE');
  assert.equal(options.lockKey, schema.PAYROLL_SCHEMA_LOCK_KEY, 'the exported key is the one used');
});

test('the key is stable across releases and outside the kernel block', () => {
  const key = schema.PAYROLL_SCHEMA_LOCK_KEY;
  // Pinned on purpose: two installs of different payroll versions on one database must serialise on the SAME key.
  assert.equal(key, 47120123);
  assert.ok(Number.isSafeInteger(key) && key > 0 && key <= 0x7fffffff, 'a positive 32-bit integer pg_advisory_xact_lock accepts');
  assert.ok(key < KERNEL_BLOCK.min || key > KERNEL_BLOCK.max, 'never inside the kernel SCHEMA_LOCK_KEYS block');
});

test('the lock changes nothing else the bootstrap receives', async () => {
  const options = await bootstrapOptions();
  assert.equal(options.moduleName, 'payroll schema');
  const ddl = options.statements.join('\n');
  for (const table of ['payroll_company', 'payroll_employees', 'payroll_runs', 'payroll_run_lines', 'payroll_payments', 'payroll_audit', 'payroll_ach_events', 'payroll_filings']) {
    assert.match(ddl, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`), table + ' is still created');
    assert.ok(options.statements.includes(`-- owner rls ${table}.user_sub`), table + ' still gets owner RLS at the chokepoint');
  }
  assert.deepEqual(options.requirements.map((r) => r.table).sort(), [
    'payroll_ach_events', 'payroll_audit', 'payroll_bank_accounts', 'payroll_company', 'payroll_deduction_elections',
    'payroll_employees', 'payroll_filings', 'payroll_line_deductions', 'payroll_line_earnings', 'payroll_payments',
    'payroll_run_lines', 'payroll_runs',
  ]);
});
