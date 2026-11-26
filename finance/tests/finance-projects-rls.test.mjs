/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Finance 1.8.5 enforcing-role PostgreSQL 16 FORCE RLS proof: applies migration 007-finance-projects.sql as a NOSUPERUSER NOBYPASSRLS table-owning role on a disposable PostgreSQL instance, proves FORCE ROW LEVEL SECURITY blocks absent-GUC reads even for the table owner, proves Owner A and Owner B cannot read/update/delete each other's rows across oshal_finance_projects, oshal_finance_project_lines, and oshal_finance_project_actuals, and verifies full route execution end-to-end on PG 16.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE_PORTS = new Set([55432, 55433, 55434]);
const TABLES = [
  'oshal_finance_projects',
  'oshal_finance_project_lines',
  'oshal_finance_project_actuals',
];
const OWNER_A = 'finance-projects-owner-a';
const OWNER_B = 'finance-projects-owner-b';
const ROLE = 'finance_projects_app';
const ROLE_PASS = 'isolated-finance-projects-only';

/** Resolve pg from STORE_CI_TOOLCHAIN or scripts/toolchain beside this package. */
function loadPg() {
  const roots = [
    process.env.STORE_CI_TOOLCHAIN && join(process.env.STORE_CI_TOOLCHAIN, 'node_modules'),
    process.env.STORE_CI_TOOLCHAIN,
    resolve(pkgDir, '..', 'scripts', 'toolchain', 'node_modules'),
    resolve(pkgDir, '..', '..', 'scripts', 'toolchain', 'node_modules'),
  ].filter(Boolean);
  for (const root of roots) {
    const candidate = join(root, 'pg');
    if (existsSync(candidate)) return require(candidate);
  }
  throw new Error(`BLOCKED: pg not found (npm ci --prefix scripts/toolchain). Tried ${roots.join(', ')}`);
}

const { Pool } = loadPg();
const { mountFinanceProjectsRoutes } = require(join(pkgDir, 'routes', 'finance-projects.js'));
const docker = (args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function waitReady(pool) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { await pool.query('SELECT 1'); return; } catch { await pause(150); }
  }
  throw new Error('Disposable PostgreSQL did not become ready within 20 seconds');
}

function removeContainer(name, token) {
  assert.match(name, /^oshal-finance-projects-rls-[a-f0-9]{16}$/);
  let inspected;
  try { inspected = JSON.parse(docker(['inspect', name]))[0]; } catch (err) {
    if (/No such (object|container)/i.test(String(err.stderr))) return;
    throw err;
  }
  assert.equal(inspected.Config.Labels['oshal.finance-projects-rls'], token);
  docker(['rm', '--force', '--volumes', name]);
}

async function startDisposablePg() {
  const envUrl = process.env.OSHAL_TEST_POSTGRES || process.env.DATABASE_URL || '';
  if (envUrl) {
    const parsed = new URL(envUrl);
    const port = Number(parsed.port || 5432);
    assert.ok(!LIVE_PORTS.has(port), `refusing to run RLS tests against live PostgreSQL port ${port}`);
    const dbName = `fin_proj_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const roleName = `fin_proj_role_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
    const rootAdmin = new Pool({ connectionString: envUrl, max: 2 });
    await waitReady(rootAdmin);
    await rootAdmin.query(`CREATE ROLE ${roleName} LOGIN PASSWORD '${ROLE_PASS}' NOSUPERUSER NOBYPASSRLS`);
    await rootAdmin.query(`CREATE DATABASE ${dbName} OWNER ${roleName}`);
    const dbUrl = new URL(envUrl);
    dbUrl.pathname = `/${dbName}`;
    const admin = new Pool({ connectionString: dbUrl.toString(), max: 2 });
    const appUrl = new URL(dbUrl.toString());
    appUrl.username = roleName;
    appUrl.password = ROLE_PASS;
    const appPool = new Pool({ connectionString: appUrl.toString(), max: 4 });
    return {
      admin, appPool, role: roleName,
      cleanup: async () => {
        await appPool.end();
        await admin.end();
        await rootAdmin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [dbName]);
        await rootAdmin.query(`DROP DATABASE IF EXISTS ${dbName}`);
        await rootAdmin.query(`DROP ROLE IF EXISTS ${roleName}`);
        await rootAdmin.end();
      },
    };
  }
  const token = randomUUID();
  const name = `oshal-finance-projects-rls-${token.replaceAll('-', '').slice(0, 16)}`;
  const image = docker(['image', 'inspect', 'postgres:16-alpine', '--format', '{{.Id}}']);
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  docker([
    'run', '--detach', '--pull=never', '--name', name,
    '--label', `oshal.finance-projects-rls=${token}`,
    '--memory', '512m', '--cpus', '1',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=256m',
    '--publish', '127.0.0.1::5432',
    '--env', 'POSTGRES_PASSWORD=isolated-fixture-only', image,
  ]);
  const address = docker(['port', name, '5432/tcp']).split(/\r?\n/)[0];
  const port = Number(address.split(':')[1]);
  assert.ok(!LIVE_PORTS.has(port));
  const common = { host: '127.0.0.1', port, database: 'postgres', connectionTimeoutMillis: 3000, max: 4 };
  const admin = new Pool({ ...common, user: 'postgres', password: 'isolated-fixture-only' });
  let appPool;
  try {
    await waitReady(admin);
    await admin.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PASS}' NOSUPERUSER NOBYPASSRLS`);
    await admin.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${ROLE}`);
    appPool = new Pool({ ...common, user: ROLE, password: ROLE_PASS });
  } catch (err) {
    await appPool?.end().catch(() => {});
    await admin.end().catch(() => {});
    removeContainer(name, token);
    throw err;
  }
  return {
    admin, appPool, role: ROLE,
    cleanup: async () => {
      try { await appPool?.end(); await admin?.end(); } finally { removeContainer(name, token); }
    },
  };
}

/** Run queries on appPool inside a transaction with oshal.current_sub set (or unset when null). */
async function withOwner(appPool, sub, fn) {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    if (sub !== null) {
      await client.query("SELECT set_config('oshal.current_sub', $1, true)", [sub]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

let pgEnv;
before(async () => {
  pgEnv = await startDisposablePg();
  const sql = readFileSync(join(pkgDir, 'migrations', '007-finance-projects.sql'), 'utf8');
  await pgEnv.appPool.query(sql);
});

after(async () => {
  if (pgEnv) await pgEnv.cleanup();
});

test('all three project tables have ENABLE + FORCE RLS and enforcing role is NOSUPERUSER NOBYPASSRLS', async () => {
  const roleInfo = (await pgEnv.appPool.query(
    'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
  )).rows[0];
  assert.equal(roleInfo.rolsuper, false);
  assert.equal(roleInfo.rolbypassrls, false);

  const rels = (await pgEnv.appPool.query(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relname = ANY($1::text[])
      ORDER BY c.relname`,
    [TABLES],
  )).rows;
  assert.equal(rels.length, 3);
  for (const r of rels) {
    assert.equal(r.relrowsecurity, true, `${r.relname} must ENABLE RLS`);
    assert.equal(r.relforcerowsecurity, true, `${r.relname} must FORCE RLS`);
  }
});

test('FORCE RLS enforces strict exact-owner read/write/delete isolation and blocks absent GUC on all 3 tables', async () => {
  // Owner A inserts project, line, and actual
  const created = await withOwner(pgEnv.appPool, OWNER_A, async (c) => {
    const p = (await c.query(
      `INSERT INTO oshal_finance_projects (owner_sub, slug, name, budget_cents)
       VALUES ($1, 'alpha-rls', 'Alpha RLS Project', 100000) RETURNING project_id`,
      [OWNER_A],
    )).rows[0];
    const l = (await c.query(
      `INSERT INTO oshal_finance_project_lines (owner_sub, project_id, name, channel, budget_cents, committed_cents)
       VALUES ($1, $2, 'Email Line', 'email', 40000, 10000) RETURNING line_id`,
      [OWNER_A, p.project_id],
    )).rows[0];
    const a = (await c.query(
      `INSERT INTO oshal_finance_project_actuals (owner_sub, project_id, line_id, source, amount_cents, occurred_on, note)
       VALUES ($1, $2, $3, 'email', 7500, '2026-11-20', 'Send batch') RETURNING actual_id`,
      [OWNER_A, p.project_id, l.line_id],
    )).rows[0];
    return { projectId: p.project_id, lineId: l.line_id, actualId: a.actual_id };
  });

  // Absent GUC sees 0 rows on all 3 tables even as table owner
  await withOwner(pgEnv.appPool, null, async (c) => {
    for (const table of TABLES) {
      const count = Number((await c.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n);
      assert.equal(count, 0, `${table} must return 0 rows without oshal.current_sub`);
    }
  });

  // Owner B sees 0 rows, cannot update/delete Owner A rows, and cannot insert with Owner A's owner_sub
  await withOwner(pgEnv.appPool, OWNER_B, async (c) => {
    for (const table of TABLES) {
      const count = Number((await c.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n);
      assert.equal(count, 0, `Owner B must see 0 rows in ${table}`);
    }
    const updP = await c.query("UPDATE oshal_finance_projects SET name = 'Hijacked' WHERE project_id = $1", [created.projectId]);
    assert.equal(updP.rowCount, 0);
    const updL = await c.query('UPDATE oshal_finance_project_lines SET budget_cents = 1 WHERE line_id = $1', [created.lineId]);
    assert.equal(updL.rowCount, 0);
    const delA = await c.query('DELETE FROM oshal_finance_project_actuals WHERE actual_id = $1', [created.actualId]);
    assert.equal(delA.rowCount, 0);
    const delP = await c.query('DELETE FROM oshal_finance_projects WHERE project_id = $1', [created.projectId]);
    assert.equal(delP.rowCount, 0);

    await assert.rejects(
      c.query(`INSERT INTO oshal_finance_projects (owner_sub, slug, name, budget_cents) VALUES ($1, 'spoof', 'Spoof', 100)`, [OWNER_A]),
      /row-level security policy/i,
    );
  });

  // Owner A still sees all 3 rows intact
  await withOwner(pgEnv.appPool, OWNER_A, async (c) => {
    const p = (await c.query('SELECT name FROM oshal_finance_projects WHERE project_id = $1', [created.projectId])).rows[0];
    assert.equal(p?.name, 'Alpha RLS Project');
    const a = (await c.query('SELECT amount_cents FROM oshal_finance_project_actuals WHERE actual_id = $1', [created.actualId])).rows[0];
    assert.equal(String(a?.amount_cents), '7500');
  });
});

test('finance-projects HTTP routes execute end-to-end against enforcing-role PG 16 with strict isolation', async () => {
  const handlers = {};
  const record = (verb) => (route, handler) => { handlers[`${verb} ${route}`] = handler; };
  const router = { get: record('GET'), post: record('POST'), patch: record('PATCH'), delete: record('DELETE') };

  async function callAs(sub, key, { body = {}, params = {} } = {}) {
    return withOwner(pgEnv.appPool, sub, async (client) => {
      const localHandlers = {};
      const localRec = (v) => (r, h) => { localHandlers[`${v} ${r}`] = h; };
      mountFinanceProjectsRoutes({ get: localRec('GET'), post: localRec('POST'), patch: localRec('PATCH'), delete: localRec('DELETE') }, client);
      const res = {
        statusCode: 200,
        body: undefined,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
      };
      await localHandlers[key]({ oidc: { user: { sub } }, body, params }, res);
      return res;
    });
  }

  // Silence unused router lint while checking mount works
  mountFinanceProjectsRoutes(router, pgEnv.appPool);

  const created = await callAs(OWNER_A, 'POST /projects', {
    body: {
      name: 'PG16 E2E Budget',
      budgetCents: 100000,
      lines: [
        { name: 'Email', channel: 'email', budgetCents: 40000, committedCents: 5000 },
        { name: 'Social', channel: 'linkedin', budgetCents: 60000, committedCents: 10000 },
      ],
    },
  });
  assert.equal(created.statusCode, 201);
  const projectId = created.body.project.projectId;
  const emailLineId = created.body.lines[0].lineId;

  const act = await callAs(OWNER_A, 'POST /projects/:id/actuals', {
    params: { id: projectId },
    body: { lineId: emailLineId, source: 'email', amountCents: 7500, occurredOn: '2026-11-24', note: 'Live PG test' },
  });
  assert.equal(act.statusCode, 201);
  assert.equal(act.body.summary.totalBudgetCents, 100000);
  assert.equal(act.body.summary.totalActualCents, 7500);
  assert.equal(act.body.summary.totalVarianceCents, 92500);

  const ownerBSum = await callAs(OWNER_B, 'GET /projects/:id/summary', { params: { id: projectId } });
  assert.equal(ownerBSum.statusCode, 404);

  const delAct = await callAs(OWNER_A, 'DELETE /projects/:id/actuals/:actualId', {
    params: { id: projectId, actualId: act.body.actual.actualId },
  });
  assert.equal(delAct.statusCode, 200);
  assert.equal(delAct.body.summary.totalActualCents, 0);
  assert.equal(delAct.body.summary.totalVarianceCents, 100000);
});
