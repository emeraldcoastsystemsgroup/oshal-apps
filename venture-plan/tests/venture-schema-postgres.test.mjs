/**
 * Venture Plan - the two schema bootstraps one api boot starts, against a disposable PostgreSQL.
 *
 * WHAT THIS PROVES. The kernel's route mounter calls createVentureRoutes and
 * createVentureRebaselineRoutes in one synchronous loop, and each starts the package's whole schema
 * bootstrap (ensureVentureSchema). Up to 1.5.0 the two ran side by side with nothing between them.
 * Each SCHEMA_SQL block is one implicit transaction: both runs take a SHARE lock on
 * venture_fx_assumptions (CREATE INDEX IF NOT EXISTS), one then rewrites the pg_proc row of
 * venture_validate_fx_owner (CREATE OR REPLACE FUNCTION) and asks for ACCESS EXCLUSIVE on the table
 * (DROP TRIGGER), while the other waits for that pg_proc row. That cycle is the boot line
 * "venture rebaseline schema bootstrap failed ... deadlock detected (40P01) ... while updating tuple
 * in relation pg_proc". The rebaseline router keeps the failed promise, so every later scheduled
 * tick of that process fails the same way until the package's routes are mounted again.
 *
 * HOW. Every round starts from a brand-new public schema. "installed" rounds first run one serial
 * bootstrap (the boot before), which is the condition of every api boot after the first install;
 * "fresh" rounds are the first install itself. Then one boot: both compiled routers built back to
 * back on the api's pool shape, the suite waits until the pool is idle, and drives the package's
 * scheduled tick handler, which awaits the rebaseline router's bootstrap. A round passes only when
 * no error was logged, the tick runs, and the catalog holds every table, forced RLS policy,
 * function and trigger the schema declares.
 *
 * Needs Docker with the postgres:16-alpine image already present (never pulled) and a framework
 * checkout with node_modules (OSHAL_CORE_ROOT / OSHAL_CORE_DIR / OSHAL_FRAMEWORK_ROOT, default the
 * sibling ../../oshal). Without either it FAILS; it never skips. VENTURE_SCHEMA_RACE_ROUNDS sets the
 * rounds per mode (default 20).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: the boot pair on installed and fresh schemas, round by round, with the tick and a catalog read-back as the verdict.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { APP_ROLE, freshSchema, inspectSchema, nameRelations, startPostgres } from './venture-schema-postgres.fixture.mjs';

process.env.LOG_LEVEL = 'silent';
delete process.env.OSHAL_SCHEMA_BOOTSTRAP;
const require = createRequire(import.meta.url);
const boot = require('./helpers/venture-schema-boot.cjs');
const ROUNDS = Number.parseInt(process.env.VENTURE_SCHEMA_RACE_ROUNDS ?? '20', 10);
const TABLES = 13;
const FUNCTIONS = ['venture_reject_fx_mutation', 'venture_validate_fx_owner', 'venture_validate_quote_fx_binding',
  'venture_validate_rebaseline_policy_owner', 'venture_validate_run_cost_transition', 'venture_validate_run_owner'];
const TRIGGERS = ['venture_fx_assumptions_immutable', 'venture_fx_assumptions_validate_owner',
  'venture_quotes_validate_fx', 'venture_rebaseline_policy_validate_owner', 'venture_runs_validate_cost_transition',
  'venture_runs_validate_owner'];

let fixture;
let api;
const cleanups = [];

before(async () => {
  assert.ok(Number.isInteger(ROUNDS) && ROUNDS > 0, 'VENTURE_SCHEMA_RACE_ROUNDS must be a positive integer');
  const framework = boot.loadFramework();
  fixture = await startPostgres((cleanup) => cleanups.push(cleanup), framework.Pool);
  api = boot.apiPool(framework, fixture.appConfig);
}, { timeout: 120000 });

after(async () => {
  await api?.raw.end();
  for (const cleanup of cleanups.reverse()) await cleanup();
  console.log(JSON.stringify({ fixture: 'venture-schema-postgres', ...fixture?.evidence }));
});

/** @description The failures one boot produced: error log lines, then the tick's own outcome. */
async function bootOnce(mode) {
  await freshSchema(fixture.admin);
  const ctx = { pool: api.pool, appPackageDir: boot.PKG };
  if (mode === 'installed') {
    boot.forgetPackageModules();
    await require('../routes/venture-schema.js').ensureVentureSchema(api.pool);
  }
  boot.logs.length = 0;
  const { rebaseline } = boot.bootPackage(ctx);
  await boot.waitForIdle(api.busy);
  const failures = boot.logs.filter((line) => line.level === 'error' || line.level === 'fatal')
    .map((line) => ({ where: line.module, msg: line.msg, code: line.err?.code ?? null,
      detail: line.err?.detail ?? line.err?.message ?? null, context: line.err?.where ?? null }));
  try {
    const { summary } = await rebaseline.runScheduledRebaselineTick(ctx, {
      scheduleId: 'venture-plan-rebaseline-policy-tick', scheduledAtIso: new Date().toISOString(), body: {} });
    if (summary !== 'evaluated=0; started=0; errors=0') failures.push({ where: 'tick', msg: summary, code: null });
  } catch (error) {
    failures.push({ where: 'tick', msg: String(error?.message ?? error), code: error?.code ?? null,
      detail: error?.detail ?? null, context: error?.where ?? null });
  }
  for (const failure of failures) failure.detail = await nameRelations(fixture.admin, failure.detail);
  return failures;
}

/** @description Assert the catalog holds every object the package's schema declares. */
async function assertSchemaComplete() {
  const found = await inspectSchema(fixture.admin);
  assert.equal(found.tables.length, TABLES, `tables: ${found.tables.join(', ')}`);
  assert.deepEqual(found.forcedRls, found.tables, 'every venture table enables and forces row security');
  assert.deepEqual(found.policies, found.tables.map((table) => `${table}_owner_or_operator`).sort());
  assert.deepEqual(found.functions, FUNCTIONS);
  assert.deepEqual(found.triggers, TRIGGERS);
}

/** @description Run every round of one mode and fail with the per-round evidence. */
async function runRounds(mode) {
  const failed = [];
  for (let round = 1; round <= ROUNDS; round += 1) {
    const failures = await bootOnce(mode);
    await assertSchemaComplete();
    if (failures.length) failed.push({ round, failures });
  }
  const codes = {};
  for (const { failures } of failed) for (const { code } of failures) codes[code] = (codes[code] ?? 0) + 1;
  console.log(JSON.stringify({ suite: 'venture-schema-postgres', mode, rounds: ROUNDS, failedRounds: failed.length, codes }));
  assert.deepEqual(failed, [], `${failed.length} of ${ROUNDS} ${mode} boots failed: ${JSON.stringify(failed.slice(0, 3))}`);
}

test('the application role owns what it bootstraps: no superuser, no BYPASSRLS', async () => {
  const { rows } = await fixture.admin.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1', [APP_ROLE]);
  assert.deepEqual(rows, [{ rolsuper: false, rolbypassrls: false }]);
});

test('every boot on an installed schema: both bootstraps finish, nothing is logged as failed, the tick runs', async () => {
  await runRounds('installed');
}, { timeout: 240000 });

test('every first-install boot: both bootstraps finish, nothing is logged as failed, the tick runs', async () => {
  await runRounds('fresh');
}, { timeout: 240000 });
