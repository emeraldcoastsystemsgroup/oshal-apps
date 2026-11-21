/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Enforcing-role PostgreSQL 16 RLS proof for
 *     marketing-engine 0.6.0 P1 audience store: applies migrations 001-003 as a NOSUPERUSER
 *     NOBYPASSRLS table-owning role on a disposable PostgreSQL instance, proves another owner
 *     reads zero rows from every audience table (contacts, consents, lists, list_members,
 *     suppressions), proves FORCE RLS blocks table-owner bypass, proves consent export returns
 *     exact sign-up evidence JSON, and proves contact deletion exports evidence first and
 *     leaves zero rows behind.
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
const AUDIENCE_TABLES = [
  'oshal_marketing_contacts',
  'oshal_marketing_consents',
  'oshal_marketing_lists',
  'oshal_marketing_list_members',
  'oshal_marketing_suppressions',
];
const MIGRATIONS = [
  'migrations/001-marketing-core.sql',
  'migrations/002-marketing-metrics.sql',
  'migrations/003-marketing-audience.sql',
];
const OWNER_A = 'marketing-audience-owner-a';
const OWNER_B = 'marketing-audience-owner-b';
const ROLE = 'marketing_audience_app';
const ROLE_PASS = 'isolated-audience-app-only';

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
const docker = (args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Wait until PostgreSQL accepts connections. */
async function waitReady(pool) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { await pool.query('SELECT 1'); return; } catch { await pause(150); }
  }
  throw new Error('Disposable PostgreSQL did not become ready within 20 seconds');
}

/** Verify container ownership label before removing our throwaway container. */
function removeContainer(name, token) {
  assert.match(name, /^oshal-marketing-audience-rls-[a-f0-9]{16}$/);
  let inspected;
  try { inspected = JSON.parse(docker(['inspect', name]))[0]; } catch (err) {
    if (/No such (object|container)/i.test(String(err.stderr))) return;
    throw err;
  }
  assert.equal(inspected.Config.Labels['oshal.marketing-audience-rls'], token);
  docker(['rm', '--force', '--volumes', name]);
}

/** Start a disposable PG container or isolate a fresh DB inside an explicit disposable URL. */
async function startDisposablePg() {
  const envUrl = process.env.OSHAL_TEST_POSTGRES || process.env.DATABASE_URL || '';
  if (envUrl) {
    const parsed = new URL(envUrl);
    const port = Number(parsed.port || 5432);
    assert.ok(!LIVE_PORTS.has(port), `refusing to run RLS tests against live PostgreSQL port ${port}`);
    const dbName = `mkt_aud_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const roleName = `mkt_aud_role_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
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
        await rootAdmin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [dbName]);
        await rootAdmin.query(`DROP DATABASE IF EXISTS ${dbName}`);
        await rootAdmin.query(`DROP ROLE IF EXISTS ${roleName}`);
        await rootAdmin.end();
      },
    };
  }
  const token = randomUUID();
  const name = `oshal-marketing-audience-rls-${token.replaceAll('-', '').slice(0, 16)}`;
  const image = docker(['image', 'inspect', 'postgres:16-alpine', '--format', '{{.Id}}']);
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  docker([
    'run', '--detach', '--pull=never', '--name', name,
    '--label', `oshal.marketing-audience-rls=${token}`,
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

/** Run work on one enforcing-role client stamped with the given platform identity. */
async function asIdentity(pool, identity, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (identity) {
      await client.query(
        "SELECT set_config('oshal.current_sub', $1, true), set_config('oshal.is_operator', $2, true)",
        [identity.sub ?? '', identity.operator ? 'on' : 'off'],
      );
    }
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* best-effort */ }
    throw err;
  } finally {
    client.release();
  }
}

/** Build a GUC-stamped pool adapter matching the platform runtime for compiled routes. */
function makeStampedPool(pool, sub) {
  const query = async (sql, params) => asIdentity(pool, { sub }, (c) => c.query(sql, params));
  const connect = async () => {
    const client = await pool.connect();
    await client.query("SELECT set_config('oshal.current_sub', $1, false), set_config('oshal.is_operator', 'off', false)", [sub]);
    return {
      query: (sql, params) => client.query(sql, params),
      release: () => {
        client.query('RESET oshal.current_sub; RESET oshal.is_operator').catch(() => {}).finally(() => client.release());
      },
    };
  };
  return { query, connect };
}

/** Load compiled marketing-audience handlers with minimal non-DB stubs. */
function loadAudienceModule() {
  const full = join(pkgDir, 'routes', 'marketing-audience.js');
  const src = readFileSync(full, 'utf8');
  const mod = { exports: {} };
  const stubs = {
    '@/shared/logger': { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) },
    '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
    '@/app/connectors/runtime': { loadConnectorSpec: () => null },
  };
  const cache = new Map();
  const reqStub = (id) => {
    if (id in stubs) return stubs[id];
    if (id.startsWith('./')) {
      const target = join(dirname(full), id.endsWith('.js') ? id : `${id}.js`);
      if (!cache.has(target)) {
        const subMod = { exports: {} };
        const subSrc = readFileSync(target, 'utf8');
        new Function('require', 'module', 'exports', '__filename', '__dirname', subSrc)(
          reqStub, subMod, subMod.exports, target, dirname(target),
        );
        cache.set(target, subMod.exports);
      }
      return cache.get(target);
    }
    return require(id);
  };
  new Function('require', 'module', 'exports', '__filename', '__dirname', src)(
    reqStub, mod, mod.exports, full, dirname(full),
  );
  return mod.exports;
}

/** Invoke an exported audience handler directly against a GUC-stamped pool. */
async function invokeHandler(handler, pool, sub, { params = {}, query = {}, body = {}, headers = {}, ip = '198.51.100.12' } = {}) {
  const req = { params, query, body, headers, ip, oidc: { user: { sub } } };
  const res = {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
  await handler({ pool: makeStampedPool(pool, sub) }, sub, req, res);
  return res;
}

let db;
let audience;

before(async () => {
  db = await startDisposablePg();
  const migrator = await db.appPool.connect();
  try {
    for (const rel of MIGRATIONS) {
      const sql = readFileSync(join(pkgDir, rel), 'utf8');
      await migrator.query(sql);
      await migrator.query(sql);
    }
  } finally {
    migrator.release();
  }
  audience = loadAudienceModule();
}, { timeout: 60000 });

after(async () => {
  await db?.cleanup();
});

test('all five audience tables are owned by the enforcing role with ENABLE + FORCE RLS and no operator bypass', async () => {
  const roleInfo = await db.admin.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1', [db.role]);
  assert.deepEqual(roleInfo.rows, [{ rolsuper: false, rolbypassrls: false }]);
  const tables = await db.appPool.query(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])
      ORDER BY 1`,
    [AUDIENCE_TABLES],
  );
  assert.deepEqual(tables.rows.map((r) => r.relname), [...AUDIENCE_TABLES].sort());
  for (const row of tables.rows) {
    assert.equal(row.owner, db.role, `${row.relname} owned by enforcing role`);
    assert.equal(row.relrowsecurity, true, `${row.relname} ENABLE RLS`);
    assert.equal(row.relforcerowsecurity, true, `${row.relname} FORCE RLS`);
  }
  const policies = await db.appPool.query(
    `SELECT tablename, qual, with_check FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY($1::text[]) ORDER BY tablename`,
    [AUDIENCE_TABLES],
  );
  assert.deepEqual(policies.rows.map((r) => r.tablename), [...AUDIENCE_TABLES].sort());
  for (const p of policies.rows) {
    assert.match(p.qual, /oshal\.current_sub/);
    assert.match(p.with_check, /oshal\.current_sub/);
    assert.doesNotMatch(p.qual, /is_operator/);
    assert.doesNotMatch(p.with_check, /is_operator/);
  }
});

const SIGNUP_EVIDENCE = {
  formText: 'Subscribe to Open Swarm release notes and launch updates.',
  recordedAt: '2026-11-20T14:00:00.000Z',
  ip: '203.0.113.77',
  userAgent: 'Mozilla/5.0 (Linux; Android 14)',
  utm: { source: 'website', medium: 'signup-form', campaign: 'p1-launch', content: 'hero' },
  tokenHash: 'f'.repeat(64),
};

let seededContactId;

test('another owner, unstamped connection, and operator stamp read zero rows from every audience table', async () => {
  const listRes = await invokeHandler(audience.createList, db.appPool, OWNER_A, {
    body: { name: 'Early Access', description: 'Confirmed subscribers' },
  });
  assert.equal(listRes.statusCode, 201);
  const contactRes = await invokeHandler(audience.upsertContact, db.appPool, OWNER_A, {
    body: {
      email: '  Alice.Subscriber@Example.COM ',
      displayName: 'Alice Subscriber',
      tags: ['Early-Access', 'Founder'],
      listIds: [listRes.body.list.list_id],
      consent: { channel: 'email', purpose: 'marketing', status: 'confirmed', evidence: SIGNUP_EVIDENCE },
    },
  });
  assert.equal(contactRes.statusCode, 201);
  seededContactId = contactRes.body.contact.contact_id;
  const suppRes = await invokeHandler(audience.createSuppression, db.appPool, OWNER_A, {
    body: { email: 'Bounced.User@Example.COM', channel: 'email', reason: 'hard_bounce', source: 'webhook' },
  });
  assert.equal(suppRes.statusCode, 201);

  for (const probe of [{ sub: OWNER_B }, null, { sub: '', operator: true }]) {
    await asIdentity(db.appPool, probe, async (client) => {
      for (const table of AUDIENCE_TABLES) {
        const res = await client.query(`SELECT * FROM ${table}`);
        assert.equal(res.rows.length, 0, `${table} must return 0 rows for ${JSON.stringify(probe)}`);
      }
    });
  }
});

test('enforcing-role RLS blocks cross-owner mutations, spoofed inserts, and relies on FORCE', async () => {
  await asIdentity(db.appPool, { sub: OWNER_B }, async (client) => {
    assert.equal((await client.query("UPDATE oshal_marketing_contacts SET display_name = 'Hijacked'")).rowCount, 0);
    assert.equal((await client.query('DELETE FROM oshal_marketing_contacts')).rowCount, 0);
    assert.equal((await client.query('DELETE FROM oshal_marketing_suppressions')).rowCount, 0);
  });
  await assert.rejects(
    asIdentity(db.appPool, { sub: OWNER_B }, (client) => client.query(
      "INSERT INTO oshal_marketing_contacts (owner_sub, email, email_hash) VALUES ($1, 'spoof@example.com', $2)",
      [OWNER_A, '0'.repeat(64)],
    )),
    /row-level security policy/i,
  );
  await db.appPool.query('ALTER TABLE oshal_marketing_contacts NO FORCE ROW LEVEL SECURITY');
  try {
    const leaked = await asIdentity(db.appPool, { sub: OWNER_B }, (c) => c.query('SELECT contact_id FROM oshal_marketing_contacts'));
    assert.equal(leaked.rows.length, 1, 'without FORCE, table owner bypasses RLS');
  } finally {
    await db.appPool.query('ALTER TABLE oshal_marketing_contacts FORCE ROW LEVEL SECURITY');
  }
  const sealed = await asIdentity(db.appPool, { sub: OWNER_B }, (c) => c.query('SELECT contact_id FROM oshal_marketing_contacts'));
  assert.equal(sealed.rows.length, 0);
});

test('segmentation, sign-up consent export, and export-first contact delete leave zero rows behind', async () => {
  const segA = await invokeHandler(audience.listContacts, db.appPool, OWNER_A, {
    query: { list: 'early-access', tag: 'founder', consentState: 'confirmed', suppressed: 'false' },
  });
  assert.equal(segA.statusCode, 200);
  assert.equal(segA.body.contacts.length, 1);
  assert.equal(segA.body.contacts[0].contact_id, seededContactId);
  assert.equal((await invokeHandler(audience.listContacts, db.appPool, OWNER_B, {})).body.contacts.length, 0);

  assert.equal((await invokeHandler(audience.exportContactConsent, db.appPool, OWNER_B, { params: { id: seededContactId } })).statusCode, 404);
  const expA = await invokeHandler(audience.exportContactConsent, db.appPool, OWNER_A, { params: { id: seededContactId } });
  assert.equal(expA.statusCode, 200);
  assert.deepEqual(expA.body.consentExport.consents[0].evidence, SIGNUP_EVIDENCE);
  assert.equal(expA.body.consentExport.lists[0].slug, 'early-access');

  assert.equal((await invokeHandler(audience.deleteContact, db.appPool, OWNER_B, { params: { id: seededContactId } })).statusCode, 404);
  const delA = await invokeHandler(audience.deleteContact, db.appPool, OWNER_A, { params: { id: seededContactId } });
  assert.equal(delA.statusCode, 200);
  assert.equal(delA.body.deleted, true);
  assert.deepEqual(delA.body.consentExport.consents[0].evidence, SIGNUP_EVIDENCE);

  assert.equal((await db.admin.query('SELECT 1 FROM oshal_marketing_contacts WHERE contact_id = $1', [seededContactId])).rows.length, 0);
  assert.equal((await db.admin.query('SELECT 1 FROM oshal_marketing_consents WHERE contact_id = $1', [seededContactId])).rows.length, 0);
  assert.equal((await db.admin.query('SELECT 1 FROM oshal_marketing_list_members WHERE contact_id = $1', [seededContactId])).rows.length, 0);
});

test('suppression revokes active consent, refuses re-confirm, and purgeSuppression removes all rows', async () => {
  const bobRes = await invokeHandler(audience.upsertContact, db.appPool, OWNER_A, {
    body: {
      email: 'bob@example.com',
      consent: { channel: 'email', purpose: 'marketing', status: 'confirmed', evidence: SIGNUP_EVIDENCE },
    },
  });
  const bobId = bobRes.body.contact.contact_id;
  const bobSupp = await invokeHandler(audience.createSuppression, db.appPool, OWNER_A, {
    body: { email: 'BOB@example.com', channel: 'email', reason: 'unsubscribe' },
  });
  assert.equal(bobSupp.statusCode, 201);
  assert.equal(bobSupp.body.revokedConsents, 1);

  const reconfirm = await invokeHandler(audience.upsertContact, db.appPool, OWNER_A, {
    body: { email: 'bob@example.com', consent: { channel: 'email', status: 'confirmed', evidence: SIGNUP_EVIDENCE } },
  });
  assert.equal(reconfirm.statusCode, 409);
  assert.equal(reconfirm.body.error, 'address_suppressed');

  const delBob = await invokeHandler(audience.deleteContact, db.appPool, OWNER_A, {
    params: { id: bobId },
    query: { purgeSuppression: 'true' },
  });
  assert.equal(delBob.statusCode, 200);
  assert.equal(delBob.body.consentExport.suppressions.length, 1);
  assert.equal((await db.admin.query('SELECT 1 FROM oshal_marketing_contacts WHERE contact_id = $1', [bobId])).rows.length, 0);
  assert.equal((await db.admin.query('SELECT 1 FROM oshal_marketing_consents WHERE contact_id = $1', [bobId])).rows.length, 0);
  assert.equal(
    (await db.admin.query('SELECT 1 FROM oshal_marketing_suppressions WHERE address_hash = $1', [bobRes.body.contact.email_hash])).rows.length,
    0,
  );
});
