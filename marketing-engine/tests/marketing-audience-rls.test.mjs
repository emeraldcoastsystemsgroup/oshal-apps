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
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 0.6.1: add enforcing-role PG 16 end-to-end
 *     CSV import proof (`POST /audience/contacts/import-csv`) verifying missing-source refusal
 *     writes zero rows, suppressed addresses stay suppressed, pending-by-default and documented
 *     prior consent evidence appear verbatim in consent-export, and Owner B's import is
 *     strictly isolated from Owner A's suppressions, contacts, consents, and lists.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | 0.6.2: apply migration 004-marketing-compliance.sql
 *     and prove enforcing-role PG 16 exact-owner FORCE RLS on oshal_marketing_compliance_settings
 *     plus end-to-end compliance-gated email draft approval.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | 0.6.3: apply migration 005-marketing-double-optin.sql
 *     and prove enforcing-role PG 16 exact-owner FORCE RLS on oshal_marketing_signup_forms and
 *     oshal_marketing_optin_tokens plus end-to-end honeypot, submit (pending), confirm (confirmed),
 *     replay refusal (409), and cross-owner isolation.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | 0.6.5: apply migration 006-marketing-broadcasts.sql
 *     and prove enforcing-role PG 16 exact-owner FORCE RLS on oshal_marketing_messages and
 *     oshal_marketing_deliveries plus end-to-end dry-run gate audit, one-click unsubscribe
 *     suppression + next-run skip, and cross-owner isolation.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | 0.6.6: apply migration 007-marketing-sequences.sql
 *     and prove enforcing-role PG 16 exact-owner FORCE RLS on oshal_marketing_sequences,
 *     oshal_marketing_sequence_steps, and oshal_marketing_enrollments plus strict standing
 *     authorization, step re-checks after suppression, welcome auto-enroll, one-click disarm,
 *     and cross-owner isolation.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | 0.6.7: apply migration 008-marketing-launch-plans.sql
 *     and prove enforcing-role PG 16 exact-owner FORCE RLS on oshal_marketing_launch_plans,
 *     cross-owner 404 isolation, unified calendar deduplication, and strictly grounded
 *     recorded-numbers-only campaign retro generation.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | 0.6.8: apply migration 009-marketing-finance-link.sql
 *     alongside finance/migrations/007-finance-projects.sql on disposable PG 16 and prove
 *     enforcing-role FORCE RLS isolation for finance_project_id & channel_allocations,
 *     reallocation proposal generation, atomic channel_allocation commit across campaign +
 *     oshal_finance_project_lines + oshal_marketing_budget_ledger, and real PG ROLLBACK on error.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | 0.6.9: apply migration 010-marketing-attribution.sql
 *     on disposable PG 16 and prove enforcing-role exact-owner FORCE RLS on
 *     oshal_marketing_conversions (no operator bypass), UTM sign-up first-touch conversion
 *     inheritance on purchase, delivery engagement events with auto-suppression, NO DATA on quiet
 *     campaigns, and cross-owner 404/0-row isolation.
 * 10 | maintainer@emeraldcoastsystemsgroup.com  | 0.6.10: apply migration 011-marketing-sms-consent.sql
 *     on disposable PG 16 and prove enforcing-role exact-owner FORCE RLS on
 *     oshal_marketing_sms_queue (no operator bypass), TCPA/CTIA opt-in persistence, unconsented
 *     403 refusal, clock-controlled quiet-hours hold, STOP suppression + held-queue cancellation,
 *     and cross-owner 404/0-row isolation.
 * 11 | maintainer@emeraldcoastsystemsgroup.com  | Derive sequence tick nowIso timestamps from
 *     Date.now() in the 007-marketing-sequences RLS test (instead of hardcoded 2026-11-26/27 dates
 *     that drifted behind enrollment next_run_at = now()) and assert both before-due (0 due) and
 *     after-due progression for Step 1 and Step 2.
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
  'migrations/004-marketing-compliance.sql',
  'migrations/005-marketing-double-optin.sql',
  'migrations/006-marketing-broadcasts.sql',
  'migrations/007-marketing-sequences.sql',
  'migrations/008-marketing-launch-plans.sql',
  'migrations/009-marketing-finance-link.sql',
  'migrations/010-marketing-attribution.sql',
  'migrations/011-marketing-sms-consent.sql',
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

test('CSV import enforces consent attestation, suppression immunity, documented prior consent, and cross-owner FORCE RLS isolation', async () => {
  const csvListRes = await invokeHandler(audience.createList, db.appPool, OWNER_A, {
    body: { name: 'CSV Launch List', description: 'Imported contacts' },
  });
  assert.equal(csvListRes.statusCode, 201);
  const csvListId = csvListRes.body.list.list_id;

  const suppBlocked = await invokeHandler(audience.createSuppression, db.appPool, OWNER_A, {
    body: { email: 'blocked@example.com', channel: 'email', reason: 'unsubscribe', source: 'one_click' },
  });
  assert.equal(suppBlocked.statusCode, 201);
  const blockedHash = suppBlocked.body.suppression.address_hash;

  // Missing consent source refuses 400 and writes ZERO rows.
  const refused = await invokeHandler(audience.importContactsCsv, db.appPool, OWNER_A, {
    body: { csv: 'email,consent_source\nfirst@example.com,Booth\nsecond@example.com,' },
  });
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.body.error, 'consent_source_required');
  assert.deepEqual(refused.body.missingConsentSourceRows, [3]);
  assert.equal((await db.admin.query("SELECT 1 FROM oshal_marketing_contacts WHERE email IN ('first@example.com','second@example.com')")).rows.length, 0);

  // Owner A imports suppressed (padded uppercase), plain, unproven confirmed, documented confirmed, and invalid email.
  const csvPayload = [
    'email,display_name,tags,consent_source,consent_status,consent_recorded_at,consent_evidence,utm_source,utm_campaign',
    '"  BLOCKED@Example.COM ",Blocked User,vip,,confirmed,2026-11-18T10:00:00Z,"Prior card",event,launch',
    'plain@example.com,Plain User,"beta;early",,pending,,,,',
    'unproven@example.com,Unproven User,beta,,confirmed,,,"",',
    'proven@example.com,Proven User,founder,Double opt-in archive,confirmed,2026-11-19T15:45:00Z,"Verified double opt-in form",site,fall-2026',
    'bad-address,Invalid Row,,,,,,,',
  ].join('\r\n');

  const impA = await invokeHandler(audience.importContactsCsv, db.appPool, OWNER_A, {
    body: {
      csv: csvPayload,
      consentSource: 'Owner A event signup sheet',
      attestation: 'Collected at launch booth with visible opt-in notice.',
      listIds: [csvListId],
    },
  });
  assert.equal(impA.statusCode, 200);
  assert.equal(impA.body.totalRows, 5);
  assert.equal(impA.body.imported, 3);
  assert.equal(impA.body.updated, 0);
  assert.equal(impA.body.pending, 2);
  assert.equal(impA.body.confirmedWithPriorConsent, 1);
  assert.equal(impA.body.downgradedToPending, 1);
  assert.equal(impA.body.skippedSuppressed, 1);
  assert.equal(impA.body.invalidRows, 1);

  // blocked@example.com stays suppressed under Owner A with zero contact or consent rows added.
  assert.equal((await db.admin.query('SELECT 1 FROM oshal_marketing_contacts WHERE owner_sub = $1 AND email_hash = $2', [OWNER_A, blockedHash])).rows.length, 0);
  const suppCheck = await db.admin.query('SELECT reason, source FROM oshal_marketing_suppressions WHERE owner_sub = $1 AND address_hash = $2', [OWNER_A, blockedHash]);
  assert.deepEqual(suppCheck.rows, [{ reason: 'unsubscribe', source: 'one_click' }]);

  // Verify consent evidence via GET /audience/contacts/:id/consent-export for plain, unproven, and proven.
  const byEmail = new Map(impA.body.contacts.map((c) => [c.email, c]));
  const plainExp = await invokeHandler(audience.exportContactConsent, db.appPool, OWNER_A, { params: { id: byEmail.get('plain@example.com').contact_id } });
  assert.equal(plainExp.statusCode, 200);
  assert.equal(plainExp.body.consentExport.consents[0].status, 'pending');
  assert.equal(plainExp.body.consentExport.consents[0].evidence.consentSource, 'Owner A event signup sheet');
  assert.equal(plainExp.body.consentExport.consents[0].evidence.priorConsentDocumented, false);

  const unprovenExp = await invokeHandler(audience.exportContactConsent, db.appPool, OWNER_A, { params: { id: byEmail.get('unproven@example.com').contact_id } });
  assert.equal(unprovenExp.statusCode, 200);
  assert.equal(unprovenExp.body.consentExport.consents[0].status, 'pending');
  assert.equal(unprovenExp.body.consentExport.consents[0].evidence.priorConsentDocumented, false);
  assert.equal(unprovenExp.body.consentExport.consents[0].evidence.requestedStatus, 'confirmed');
  assert.equal(unprovenExp.body.consentExport.consents[0].evidence.consentSource, 'Owner A event signup sheet');

  const provenExp = await invokeHandler(audience.exportContactConsent, db.appPool, OWNER_A, { params: { id: byEmail.get('proven@example.com').contact_id } });
  assert.equal(provenExp.statusCode, 200);
  assert.equal(provenExp.body.consentExport.consents[0].status, 'confirmed');
  assert.equal(provenExp.body.consentExport.consents[0].evidence.consentSource, 'Double opt-in archive');
  assert.equal(provenExp.body.consentExport.consents[0].evidence.priorConsentDocumented, true);
  assert.equal(provenExp.body.consentExport.consents[0].evidence.formText, 'Verified double opt-in form');
  assert.equal(provenExp.body.consentExport.consents[0].evidence.recordedAt, '2026-11-19T15:45:00.000Z');
  assert.deepEqual(provenExp.body.consentExport.consents[0].evidence.utm, { source: 'site', campaign: 'fall-2026' });

  // Owner B cannot attach to Owner A's list (FORCE RLS isolation).
  const crossList = await invokeHandler(audience.importContactsCsv, db.appPool, OWNER_B, {
    body: { csv: 'email\nblocked@example.com', consentSource: 'Owner B webinar', listIds: [csvListId] },
  });
  assert.equal(crossList.statusCode, 404);
  assert.equal(crossList.body.error, 'list_not_found');

  // Owner B imports blocked@example.com under Owner B's own scope; Owner A's suppression stays isolated and intact.
  const impB = await invokeHandler(audience.importContactsCsv, db.appPool, OWNER_B, {
    body: { csv: 'email,display_name\nblocked@example.com,Owner B Contact', consentSource: 'Owner B webinar' },
  });
  assert.equal(impB.statusCode, 200);
  assert.equal(impB.body.imported, 1);
  assert.equal(impB.body.pending, 1);
  assert.equal(impB.body.skippedSuppressed, 0);

  const listB = await invokeHandler(audience.listContacts, db.appPool, OWNER_B, {});
  assert.equal(listB.body.contacts.length, 1);
  assert.equal(listB.body.contacts[0].email, 'blocked@example.com');
  const suppB = await invokeHandler(audience.listSuppressions, db.appPool, OWNER_B, {});
  assert.equal(suppB.body.suppressions.length, 0);

  // Owner A still has blocked@example.com suppressed and invisible in Owner A's contacts.
  const suppAAfter = await invokeHandler(audience.listSuppressions, db.appPool, OWNER_A, {});
  assert.ok(suppAAfter.body.suppressions.some((s) => s.address_hash === blockedHash));
  assert.equal((await db.admin.query('SELECT 1 FROM oshal_marketing_contacts WHERE owner_sub = $1 AND email_hash = $2', [OWNER_A, blockedHash])).rows.length, 0);
});

/** Load compiled marketing-compliance or marketing-campaigns handlers with minimal non-DB stubs. */
function loadRouteSubmodule(fileName) {
  const full = join(pkgDir, 'routes', fileName);
  const src = readFileSync(full, 'utf8');
  const mod = { exports: {} };
  const stubs = {
    '@/shared/logger': { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) },
    '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
    '@/shared/security/explicit-write-confirmation': { hasExplicitWriteConfirmation: (b) => b?.confirm === true, confirmationRequiredPayload: () => ({ error: 'confirmation_required' }) },
    '@/app/connectors/runtime': { loadConnectorSpec: () => null, resolveConnectorActionCreds: async () => null, runConnectorAction: async () => ({ status: 500, body: { ok: false } }) },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/routes/connector-tenancy': { resolveConnectionRow: async () => null },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ success: false }) },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
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

test('oshal_marketing_compliance_settings enforces exact-owner FORCE RLS and gates email approval end-to-end', async () => {
  const tbl = await db.appPool.query(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'oshal_marketing_compliance_settings'`,
  );
  assert.equal(tbl.rows.length, 1);
  assert.equal(tbl.rows[0].owner, db.role);
  assert.equal(tbl.rows[0].relrowsecurity, true);
  assert.equal(tbl.rows[0].relforcerowsecurity, true);

  const pol = await db.appPool.query(
    `SELECT qual, with_check FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'oshal_marketing_compliance_settings'`,
  );
  assert.equal(pol.rows.length, 1);
  assert.match(pol.rows[0].qual, /oshal\.current_sub/);
  assert.doesNotMatch(pol.rows[0].qual, /is_operator/);
  assert.doesNotMatch(pol.rows[0].with_check, /is_operator/);

  const compliance = loadRouteSubmodule('marketing-compliance.js');
  const campaigns = loadRouteSubmodule('marketing-campaigns.js');

  const campRes = await invokeHandler(campaigns.createCampaign, db.appPool, OWNER_A, {
    body: { product: 'Open Swarm', name: 'Compliance RLS Campaign', channels: ['email'] },
  });
  assert.equal(campRes.statusCode, 201);

  const draftRes = await invokeHandler(campaigns.createDraft, db.appPool, OWNER_A, {
    body: {
      campaignId: campRes.body.campaign.campaign_id,
      channel: 'email',
      templateId: 'launch',
      subject: 'Compliance Launch',
      body: 'Ready to launch safely.',
    },
  });
  assert.equal(draftRes.statusCode, 201);
  assert.equal(draftRes.body.canApprove, false);
  const itemId = draftRes.body.item.item_id;

  // Refused 422 before compliance settings exist.
  const blocked = await invokeHandler(compliance.approveContent, db.appPool, OWNER_A, { params: { id: itemId } });
  assert.equal(blocked.statusCode, 422);
  assert.equal(blocked.body.error, 'compliance_incomplete');

  // Owner A saves compliance settings.
  const putA = await invokeHandler(compliance.putCompliance, db.appPool, OWNER_A, {
    body: {
      senderName: 'Owner A Team',
      senderEmail: 'owner-a@example.com',
      postalAddress: '500 Coast Blvd, Suite 10, Pensacola, FL 32502',
      unsubscribeBaseUrl: 'https://example.com/unsub-a',
      smsQuietStartHour: 21,
      smsQuietEndHour: 8,
      smsDefaultTimezone: 'America/Chicago',
    },
  });
  assert.equal(putA.statusCode, 200);
  assert.equal(putA.body.readiness.readyForEmailSend, true);

  // Owner B, unstamped connection, and operator stamp read ZERO rows from compliance settings.
  for (const probe of [{ sub: OWNER_B }, null, { sub: '', operator: true }]) {
    await asIdentity(db.appPool, probe, async (client) => {
      const r = await client.query('SELECT * FROM oshal_marketing_compliance_settings');
      assert.equal(r.rows.length, 0, `compliance_settings must return 0 rows for ${JSON.stringify(probe)}`);
    });
  }
  await assert.rejects(
    asIdentity(db.appPool, { sub: OWNER_B }, (client) => client.query(
      "INSERT INTO oshal_marketing_compliance_settings (owner_sub, sender_name) VALUES ($1, 'Spoof')",
      [OWNER_A],
    )),
    /row-level security policy/i,
  );
  const getB = await invokeHandler(compliance.getCompliance, db.appPool, OWNER_B, {});
  assert.equal(getB.body.readiness.readyForEmailSend, false);

  // Owner A can now approve the email draft and both HTML and text carry the postal address + unsubscribe URL.
  const approved = await invokeHandler(compliance.approveContent, db.appPool, OWNER_A, { params: { id: itemId } });
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.body.item.status, 'approved');
  assert.ok(approved.body.item.html_body.includes('500 Coast Blvd, Suite 10, Pensacola, FL 32502'));
  assert.ok(approved.body.item.text_body.includes('https://example.com/unsub-a'));
});

test('005-marketing-double-optin enforces exact-owner FORCE RLS and end-to-end pending -> confirmed single-use lifecycle', async () => {
  const OPTIN_TABLES = ['oshal_marketing_signup_forms', 'oshal_marketing_optin_tokens'];
  const tbls = await db.appPool.query(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) ORDER BY 1`,
    [OPTIN_TABLES],
  );
  assert.deepEqual(tbls.rows.map((r) => r.relname), [...OPTIN_TABLES].sort());
  for (const row of tbls.rows) {
    assert.equal(row.owner, db.role);
    assert.equal(row.relrowsecurity, true);
    assert.equal(row.relforcerowsecurity, true);
  }
  const pols = await db.appPool.query(
    `SELECT tablename, qual, with_check FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY($1::text[]) ORDER BY tablename`,
    [OPTIN_TABLES],
  );
  assert.deepEqual(pols.rows.map((r) => r.tablename), [...OPTIN_TABLES].sort());
  for (const p of pols.rows) {
    assert.match(p.qual, /oshal\.current_sub/);
    assert.doesNotMatch(p.qual, /is_operator/);
    assert.doesNotMatch(p.with_check, /is_operator/);
  }

  const optin = loadRouteSubmodule('marketing-optin.js');
  const created = await invokeHandler(optin.createSignupForm, db.appPool, OWNER_A, {
    body: {
      name: 'RLS Double Opt-In Form',
      slug: 'rls-optin',
      consentText: 'I opt in to Open Swarm updates.',
      rateLimitPerIpPerHour: 20,
      rateLimitPerFormPerHour: 100,
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal('signing_secret' in created.body.form, false);

  // Submit with preview link for Owner A -> creates pending consent & hashed token row.
  const subA = await invokeHandler(optin.submitSignupForm, db.appPool, OWNER_A, {
    params: { slug: 'rls-optin' },
    body: {
      email: 'optin-rls@example.com',
      displayName: 'Opt-In RLS',
      utm_source: 'pg-test',
      utm_campaign: 'rls-check',
      returnPreviewLink: true,
    },
  });
  assert.equal(subA.statusCode, 200);
  assert.ok(subA.body.preview?.token);

  // Owner B, unstamped, and operator read ZERO rows from both double opt-in tables.
  for (const probe of [{ sub: OWNER_B }, null, { sub: '', operator: true }]) {
    await asIdentity(db.appPool, probe, async (client) => {
      for (const table of OPTIN_TABLES) {
        const r = await client.query(`SELECT * FROM ${table}`);
        assert.equal(r.rows.length, 0, `${table} must return 0 rows for ${JSON.stringify(probe)}`);
      }
    });
  }
  await assert.rejects(
    asIdentity(db.appPool, { sub: OWNER_B }, (client) => client.query(
      "INSERT INTO oshal_marketing_signup_forms (owner_sub, slug, name, consent_text, signing_secret) VALUES ($1, 'spoof', 'Spoof', 'x', $2)",
      [OWNER_A, 'f'.repeat(64)],
    )),
    /row-level security policy/i,
  );

  // Owner B cannot confirm Owner A's token or read Owner A's snippet.
  assert.equal((await invokeHandler(optin.getSignupFormSnippet, db.appPool, OWNER_B, { params: { slug: 'rls-optin' } })).statusCode, 404);
  assert.equal((await invokeHandler(optin.confirmOptIn, db.appPool, OWNER_B, { body: { token: subA.body.preview.token } })).statusCode, 400);

  // Owner A confirms -> flips pending -> confirmed; replay refused 409.
  const confA = await invokeHandler(optin.confirmOptIn, db.appPool, OWNER_A, { body: { token: subA.body.preview.token } });
  assert.equal(confA.statusCode, 200);
  assert.equal(confA.body.status, 'confirmed');
  const replayA = await invokeHandler(optin.confirmOptIn, db.appPool, OWNER_A, { body: { token: subA.body.preview.token } });
  assert.equal(replayA.statusCode, 409);
  assert.equal(replayA.body.error, 'token_already_used');

  // Verify consent export shows confirmed status + UTM + confirmedAt.
  const exp = await invokeHandler(audience.exportContactConsent, db.appPool, OWNER_A, { params: { id: confA.body.contactId } });
  assert.equal(exp.statusCode, 200);
  assert.equal(exp.body.consentExport.consents[0].status, 'confirmed');
  assert.equal(exp.body.consentExport.consents[0].evidence.utm.utm_source, 'pg-test');
  assert.ok(exp.body.consentExport.consents[0].evidence.confirmedAt);
});

test('006-marketing-broadcasts enforces exact-owner FORCE RLS, full gate dry-run ledger, and one-click unsubscribe suppression', async () => {
  const BC_TABLES = ['oshal_marketing_messages', 'oshal_marketing_deliveries'];
  const tbls = await db.appPool.query(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) ORDER BY 1`,
    [BC_TABLES],
  );
  assert.deepEqual(tbls.rows.map((r) => r.relname), [...BC_TABLES].sort());
  for (const row of tbls.rows) {
    assert.equal(row.owner, db.role);
    assert.equal(row.relrowsecurity, true);
    assert.equal(row.relforcerowsecurity, true);
  }
  const pols = await db.appPool.query(
    `SELECT tablename, qual, with_check FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY($1::text[]) ORDER BY tablename`,
    [BC_TABLES],
  );
  assert.deepEqual(pols.rows.map((r) => r.tablename), [...BC_TABLES].sort());
  for (const p of pols.rows) {
    assert.match(p.qual, /oshal\.current_sub/);
    assert.doesNotMatch(p.qual, /is_operator/);
    assert.doesNotMatch(p.with_check, /is_operator/);
  }

  const broadcast = loadRouteSubmodule('marketing-broadcast.js');
  const publishMod = loadRouteSubmodule('marketing-publish.js');

  // Arm Owner A email channel (cap 5).
  const armRes = await invokeHandler(publishMod.putChannel, db.appPool, OWNER_A, {
    params: { channel: 'email' },
    body: { enabled: true, dailyCap: 5 },
  });
  assert.equal(armRes.statusCode, 200);

  // Create list with 1 confirmed, 1 pending, and 1 suppressed contact.
  const listRes = await invokeHandler(audience.createList, db.appPool, OWNER_A, {
    body: { name: 'Broadcast RLS List', slug: 'broadcast-rls-list' },
  });
  assert.equal(listRes.statusCode, 201);
  const listId = listRes.body.list.list_id;

  const cConfirmed = await invokeHandler(audience.upsertContact, db.appPool, OWNER_A, {
    body: {
      email: 'bc-confirmed@example.com', displayName: 'Confirmed Reader', listIds: [listId],
      consent: { channel: 'email', purpose: 'marketing', status: 'confirmed', evidence: SIGNUP_EVIDENCE },
    },
  });
  const cPending = await invokeHandler(audience.upsertContact, db.appPool, OWNER_A, {
    body: {
      email: 'bc-pending@example.com', displayName: 'Pending Reader', listIds: [listId],
      consent: { channel: 'email', purpose: 'marketing', status: 'pending', evidence: SIGNUP_EVIDENCE },
    },
  });
  const cSuppContact = await invokeHandler(audience.upsertContact, db.appPool, OWNER_A, {
    body: {
      email: 'bc-suppressed@example.com', displayName: 'Suppressed Reader', listIds: [listId],
      consent: { channel: 'email', purpose: 'marketing', status: 'confirmed', evidence: SIGNUP_EVIDENCE },
    },
  });
  assert.equal(cConfirmed.statusCode, 201);
  assert.equal(cPending.statusCode, 201);
  assert.equal(cSuppContact.statusCode, 201);
  await invokeHandler(audience.createSuppression, db.appPool, OWNER_A, {
    body: { email: 'bc-suppressed@example.com', channel: 'email', reason: 'unsubscribe' },
  });

  // Create broadcast draft (omits signing_secret).
  const created = await invokeHandler(broadcast.createBroadcast, db.appPool, OWNER_A, {
    body: {
      listId, templateId: 'announcement', subject: 'RLS Broadcast Subject',
      headline: 'RLS Broadcast', body: 'Delivery gate verification.',
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal('signing_secret' in created.body.broadcast, false);
  const messageId = created.body.broadcast.message_id;

  // Dry-run gates -> 1 dry_run, 1 skipped_unconfirmed, 1 skipped_suppressed.
  const dry1 = await invokeHandler(broadcast.sendBroadcast, db.appPool, OWNER_A, {
    params: { id: messageId },
    body: { dryRun: true, includeUnsubscribePreviewTokens: true },
  });
  assert.equal(dry1.statusCode, 200);
  assert.equal(dry1.body.stats.dryRun, 1);
  assert.equal(dry1.body.stats.skippedUnconfirmed, 1);
  assert.equal(dry1.body.stats.skippedSuppressed, 1);
  assert.equal(dry1.body.deliveries.length, 3);
  const unsubToken = dry1.body.previewTokens[0].unsubscribeToken;

  // Owner B, unstamped, and operator read ZERO rows from both broadcast tables.
  for (const probe of [{ sub: OWNER_B }, null, { sub: '', operator: true }]) {
    await asIdentity(db.appPool, probe, async (client) => {
      for (const table of BC_TABLES) {
        const r = await client.query(`SELECT * FROM ${table}`);
        assert.equal(r.rows.length, 0, `${table} must return 0 rows for ${JSON.stringify(probe)}`);
      }
    });
  }
  await assert.rejects(
    asIdentity(db.appPool, { sub: OWNER_B }, (client) => client.query(
      "INSERT INTO oshal_marketing_messages (owner_sub, list_id, template_id, subject, body, signing_secret) VALUES ($1,$2,'announcement','Spoof','x',$3)",
      [OWNER_A, listId, 'f'.repeat(64)],
    )),
    /row-level security policy/i,
  );
  assert.equal((await invokeHandler(broadcast.getBroadcast, db.appPool, OWNER_B, { params: { id: messageId } })).statusCode, 404);
  assert.equal((await invokeHandler(broadcast.unsubscribeOneClick, db.appPool, OWNER_B, { body: { token: unsubToken } })).statusCode, 400);

  // Live send without confirm: true -> 428.
  const unconfirmedLive = await invokeHandler(broadcast.sendBroadcast, db.appPool, OWNER_A, { params: { id: messageId }, body: {} });
  assert.equal(unconfirmedLive.statusCode, 428);

  // One-click unsubscribe suppresses confirmed contact immediately -> next dry-run skips it!
  const unsub = await invokeHandler(broadcast.unsubscribeOneClick, db.appPool, OWNER_A, { body: { token: unsubToken } });
  assert.equal(unsub.statusCode, 200);
  assert.equal(unsub.body.suppressed, true);
  assert.equal(unsub.body.revokedConsents, 1);

  const dry2 = await invokeHandler(broadcast.sendBroadcast, db.appPool, OWNER_A, {
    params: { id: messageId },
    body: { dryRun: true },
  });
  assert.equal(dry2.statusCode, 200);
  assert.equal(dry2.body.stats.dryRun, 0);
  assert.equal(dry2.body.stats.skippedUnconfirmed, 1);
  assert.equal(dry2.body.stats.skippedSuppressed, 2);
});

test('007-marketing-sequences enforces exact-owner FORCE RLS, strict standing auth, step suppression stop, welcome auto-enroll, and one-click disarm', async () => {
  const SEQ_TABLES = [
    'oshal_marketing_sequences',
    'oshal_marketing_sequence_steps',
    'oshal_marketing_enrollments',
  ];
  const tbls = await db.appPool.query(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) ORDER BY 1`,
    [SEQ_TABLES],
  );
  assert.deepEqual(tbls.rows.map((r) => r.relname), [...SEQ_TABLES].sort());
  for (const row of tbls.rows) {
    assert.equal(row.owner, db.role);
    assert.equal(row.relrowsecurity, true);
    assert.equal(row.relforcerowsecurity, true);
  }
  const pols = await db.appPool.query(
    `SELECT tablename, qual, with_check FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY($1::text[]) ORDER BY tablename`,
    [SEQ_TABLES],
  );
  assert.deepEqual(pols.rows.map((r) => r.tablename), [...SEQ_TABLES].sort());
  for (const p of pols.rows) {
    assert.match(p.qual, /oshal\.current_sub/);
    assert.doesNotMatch(p.qual, /is_operator/);
    assert.doesNotMatch(p.with_check, /is_operator/);
  }

  const sequences = loadRouteSubmodule('marketing-sequences.js');
  const optin = loadRouteSubmodule('marketing-optin.js');

  const created = await invokeHandler(sequences.createSequence, db.appPool, OWNER_A, {
    body: {
      name: 'RLS Welcome Sequence',
      slug: 'rls-welcome',
      triggerFormSlug: 'rls-welcome-form',
      standingAuthorization: true,
      dailyCap: 5,
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.sequence.standing_authorization, false);
  assert.equal(created.body.sequence.armed, false);
  assert.equal('signing_secret' in created.body.sequence, false);
  const seqId = created.body.sequence.sequence_id;

  assert.equal((await invokeHandler(sequences.addSequenceStep, db.appPool, OWNER_A, {
    params: { id: seqId },
    body: { stepOrder: 1, delayHours: 0, templateId: 'announcement', subject: 'RLS Step 1', body: 'Step 1 body.' },
  })).statusCode, 201);
  assert.equal((await invokeHandler(sequences.addSequenceStep, db.appPool, OWNER_A, {
    params: { id: seqId },
    body: { stepOrder: 2, delayHours: 12, templateId: 'newsletter', subject: 'RLS Step 2', body: 'Step 2 body.' },
  })).statusCode, 201);

  // Garbage value -> 400; arm without confirm -> 428; arm with confirm -> 200 armed.
  assert.equal((await invokeHandler(sequences.updateSequenceAuthorization, db.appPool, OWNER_A, {
    params: { id: seqId }, body: { standingAuthorization: 'true', confirm: true, dailyCap: 5 },
  })).statusCode, 400);
  assert.equal((await invokeHandler(sequences.updateSequenceAuthorization, db.appPool, OWNER_A, {
    params: { id: seqId }, body: { standingAuthorization: true, dailyCap: 5 },
  })).statusCode, 428);
  const armed = await invokeHandler(sequences.updateSequenceAuthorization, db.appPool, OWNER_A, {
    params: { id: seqId }, body: { standingAuthorization: true, confirm: true, dailyCap: 5 },
  });
  assert.equal(armed.statusCode, 200);
  assert.equal(armed.body.sequence.armed, true);

  // Enroll 2 confirmed contacts, plus verify welcome auto-enroll via double opt-in confirm!
  const c1 = await invokeHandler(audience.upsertContact, db.appPool, OWNER_A, {
    body: { email: 'seq-rls-1@example.com', consent: { channel: 'email', purpose: 'marketing', status: 'confirmed', evidence: SIGNUP_EVIDENCE } },
  });
  const c2 = await invokeHandler(audience.upsertContact, db.appPool, OWNER_A, {
    body: { email: 'seq-rls-2@example.com', consent: { channel: 'email', purpose: 'marketing', status: 'confirmed', evidence: SIGNUP_EVIDENCE } },
  });
  assert.equal((await invokeHandler(sequences.enrollSequenceContact, db.appPool, OWNER_A, { params: { id: seqId }, body: { contactId: c1.body.contact.contact_id } })).statusCode, 201);
  assert.equal((await invokeHandler(sequences.enrollSequenceContact, db.appPool, OWNER_A, { params: { id: seqId }, body: { contactId: c2.body.contact.contact_id } })).statusCode, 201);

  // Owner B, unstamped, and operator read ZERO rows from all 3 sequence tables.
  for (const probe of [{ sub: OWNER_B }, null, { sub: '', operator: true }]) {
    await asIdentity(db.appPool, probe, async (client) => {
      for (const table of SEQ_TABLES) {
        const r = await client.query(`SELECT * FROM ${table}`);
        assert.equal(r.rows.length, 0, `${table} must return 0 rows for ${JSON.stringify(probe)}`);
      }
    });
  }
  await assert.rejects(
    asIdentity(db.appPool, { sub: OWNER_B }, (client) => client.query(
      "INSERT INTO oshal_marketing_sequences (owner_sub, slug, name, signing_secret) VALUES ($1,'spoof','Spoof',$2)",
      [OWNER_A, 'f'.repeat(64)],
    )),
    /row-level security policy/i,
  );
  assert.equal((await invokeHandler(sequences.getSequence, db.appPool, OWNER_B, { params: { id: seqId } })).statusCode, 404);
  assert.equal((await invokeHandler(sequences.disarmSequence, db.appPool, OWNER_B, { params: { id: seqId } })).statusCode, 404);

  // Enrollments created with next_run_at = now() are not due before their time, and are due once it passes.
  const tickBaseMs = Date.now();
  const t0 = await invokeHandler(sequences.tickSequence, db.appPool, OWNER_A, {
    params: { id: seqId }, body: { dryRun: true, nowIso: new Date(tickBaseMs - 60_000).toISOString() },
  });
  assert.equal(t0.statusCode, 200);
  assert.equal(t0.body.stats.dryRun, 0);

  // Step 1 dry-run tick advances both c1 and c2 to step 1!
  const step1Ms = tickBaseMs + 60_000;
  const t1 = await invokeHandler(sequences.tickSequence, db.appPool, OWNER_A, {
    params: { id: seqId }, body: { dryRun: true, nowIso: new Date(step1Ms).toISOString() },
  });
  assert.equal(t1.statusCode, 200);
  assert.equal(t1.body.stats.dryRun, 2);

  // Suppress c2 between Step 1 and Step 2 -> Step 2 is not due before its 12h delay, then completes c1 and stops c2 (stopped_unsubscribed)!
  await invokeHandler(audience.createSuppression, db.appPool, OWNER_A, {
    body: { email: 'seq-rls-2@example.com', channel: 'email', reason: 'unsubscribe' },
  });
  const t2Early = await invokeHandler(sequences.tickSequence, db.appPool, OWNER_A, {
    params: { id: seqId }, body: { dryRun: true, nowIso: new Date(step1Ms + 6 * 3600_000).toISOString() },
  });
  assert.equal(t2Early.statusCode, 200);
  assert.equal(t2Early.body.stats.dryRun, 0);
  const t2 = await invokeHandler(sequences.tickSequence, db.appPool, OWNER_A, {
    params: { id: seqId }, body: { dryRun: true, nowIso: new Date(step1Ms + 13 * 3600_000).toISOString() },
  });
  assert.equal(t2.statusCode, 200);
  assert.equal(t2.body.stats.dryRun, 1);
  assert.equal(t2.body.stats.completed, 1);
  assert.equal(t2.body.stats.stoppedUnsubscribed, 1);

  // Welcome sign-up form double opt-in confirm auto-enrolls confirmed contact into seqId!
  assert.equal((await invokeHandler(optin.createSignupForm, db.appPool, OWNER_A, {
    body: { name: 'RLS Welcome Form', slug: 'rls-welcome-form', consentText: 'Opt me in.' },
  })).statusCode, 201);
  const subW = await invokeHandler(optin.submitSignupForm, db.appPool, OWNER_A, {
    params: { slug: 'rls-welcome-form' }, body: { email: 'welcome-rls@example.com', returnPreviewLink: true },
  });
  const confW = await invokeHandler(optin.confirmOptIn, db.appPool, OWNER_A, { body: { token: subW.body.preview.token } });
  assert.equal(confW.statusCode, 200);
  assert.deepEqual(confW.body.enrolledSequenceIds, [seqId]);

  // One-click disarm -> subsequent live tick refused 403 sequence_disarmed.
  const dis = await invokeHandler(sequences.disarmSequence, db.appPool, OWNER_A, { params: { id: seqId } });
  assert.equal(dis.statusCode, 200);
  assert.equal(dis.body.sequence.armed, false);
  const postDisarm = await invokeHandler(sequences.tickSequence, db.appPool, OWNER_A, { params: { id: seqId }, body: {} });
  assert.equal(postDisarm.statusCode, 403);
  assert.equal(postDisarm.body.error, 'sequence_disarmed');
});

test('008-marketing-launch-plans enforces exact-owner FORCE RLS, unified calendar, and grounded recorded-numbers retro', async () => {
  const LP_TABLES = ['oshal_marketing_launch_plans'];
  const tbls = await db.appPool.query(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) ORDER BY 1`,
    [LP_TABLES],
  );
  assert.deepEqual(tbls.rows.map((r) => r.relname), LP_TABLES);
  assert.equal(tbls.rows[0].owner, db.role);
  assert.equal(tbls.rows[0].relrowsecurity, true);
  assert.equal(tbls.rows[0].relforcerowsecurity, true);

  const pols = await db.appPool.query(
    `SELECT tablename, qual, with_check FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY($1::text[]) ORDER BY tablename`,
    [LP_TABLES],
  );
  assert.equal(pols.rows.length, 1);
  assert.match(pols.rows[0].qual, /oshal\.current_sub/);
  assert.doesNotMatch(pols.rows[0].qual, /is_operator/);
  assert.doesNotMatch(pols.rows[0].with_check, /is_operator/);

  const col = await db.appPool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'oshal_marketing_content' AND column_name = 'scheduled_for'`,
  );
  assert.equal(col.rows.length, 1, 'oshal_marketing_content.scheduled_for exists');

  const campaigns = loadRouteSubmodule('marketing-campaigns.js');
  const launch = loadRouteSubmodule('marketing-launch.js');

  // Create Owner A campaign and launch plan with 2 dated milestones + default starter checklist.
  const camp = await invokeHandler(campaigns.createCampaign, db.appPool, OWNER_A, {
    body: { product: 'Open Swarm', name: 'RLS Launch Plan Campaign', motion: 'adoption', channels: ['linkedin', 'email'] },
  });
  assert.equal(camp.statusCode, 201);
  const campaignId = camp.body.campaign.campaign_id;
  const slug = camp.body.campaign.slug;

  const created = await invokeHandler(launch.createLaunchPlan, db.appPool, OWNER_A, {
    body: {
      campaignId,
      title: 'RLS Q4 Public Launch',
      launchDate: '2026-12-10',
      milestones: [
        { id: 'ms-t7', title: 'Landing page and UTM freeze', dueDate: '2026-12-03', ownerRole: 'human', status: 'done' },
        { id: 'ms-day0', title: 'Show HN and launch email', dueDate: '2026-12-10', ownerRole: 'launch-coordinator', status: 'pending' },
      ],
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.plan.checklist.length, 5, 'default launch-coordinator checklist seeded');
  const planId = created.body.plan.plan_id;

  // Owner B, unstamped, and operator read ZERO rows from oshal_marketing_launch_plans.
  for (const probe of [{ sub: OWNER_B }, null, { sub: '', operator: true }]) {
    await asIdentity(db.appPool, probe, async (client) => {
      const r = await client.query('SELECT * FROM oshal_marketing_launch_plans');
      assert.equal(r.rows.length, 0, `launch plans must return 0 rows for ${JSON.stringify(probe)}`);
    });
  }
  await assert.rejects(
    asIdentity(db.appPool, { sub: OWNER_B }, (client) => client.query(
      "INSERT INTO oshal_marketing_launch_plans (owner_sub, campaign_id, title, launch_date) VALUES ($1,$2,'Spoof','2026-12-10'::date)",
      [OWNER_A, campaignId],
    )),
    /row-level security policy/i,
  );
  assert.equal((await invokeHandler(launch.getLaunchPlan, db.appPool, OWNER_B, { params: { id: planId } })).statusCode, 404);
  assert.equal((await invokeHandler(launch.patchLaunchPlan, db.appPool, OWNER_B, { params: { id: planId }, body: { status: 'ready' } })).statusCode, 404);
  assert.equal((await invokeHandler(launch.generateLaunchRetro, db.appPool, OWNER_B, { params: { id: planId } })).statusCode, 404);

  // Add scheduled content + one recorded metric row for gsc (leaving posthog and github unrecorded -> NO DATA).
  await asIdentity(db.appPool, { sub: OWNER_A }, async (client) => {
    await client.query(
      `INSERT INTO oshal_marketing_content (user_sub, campaign_id, channel, title, body, status, scheduled_for)
       VALUES ($1,$2,'linkedin','Launch thread','Body text','approved','2026-12-09T14:00:00Z'::timestamptz)`,
      [OWNER_A, campaignId],
    );
    await client.query(
      `INSERT INTO oshal_marketing_events (user_sub, ts, source, campaign_slug, medium, event, value, meta)
       VALUES ($1,'2026-12-10T12:00:00Z'::timestamptz,'gsc',$2,'organic','clicks',42,'{}'::jsonb)`,
      [OWNER_A, slug],
    );
    await client.query(
      `INSERT INTO oshal_marketing_run_ledger (user_sub, channel, action, outcome, detail)
       VALUES ($1,'linkedin','publish','published',$2::jsonb)`,
      [OWNER_A, JSON.stringify({ campaignId })],
    );
  });

  // Unified calendar returns milestones + scheduled content chronologically without duplicates and degrades cleanly when Switchboard table is absent.
  const cal = await invokeHandler(launch.getUnifiedCalendar, db.appPool, OWNER_A, { query: { from: '2026-12-01', to: '2026-12-31' } });
  assert.equal(cal.statusCode, 200);
  assert.equal(cal.body.switchboardAvailable, false);
  assert.equal(cal.body.counts.launch_milestone, 2);
  assert.equal(cal.body.counts.engine_content, 1);
  assert.equal(new Set(cal.body.items.map((i) => i.id)).size, cal.body.items.length);

  // Grounded retro cites ONLY exact recorded figures (gsc = 42, posthog = NO DATA, github = NO DATA, published = 1, milestones 1/2).
  const retroRes = await invokeHandler(launch.generateLaunchRetro, db.appPool, OWNER_A, { params: { id: planId } });
  assert.equal(retroRes.statusCode, 200);
  assert.equal(retroRes.body.plan.status, 'retro_complete');
  assert.equal(retroRes.body.retro.milestonesCompleted, 1);
  assert.equal(retroRes.body.retro.milestonesTotal, 2);
  assert.equal(retroRes.body.retro.publishOutcomes.published, 1);
  assert.equal(retroRes.body.retro.metricsBySource.gsc, 42);
  assert.equal(retroRes.body.retro.metricsBySource.posthog, 'NO DATA');
  assert.equal(retroRes.body.retro.metricsBySource.github, 'NO DATA');
  assert.match(retroRes.body.retro.markdown, /\*\*gsc\*\*: 42/);
  assert.match(retroRes.body.retro.markdown, /\*\*posthog\*\*: NO DATA/);
  assert.match(retroRes.body.retro.markdown, /\*\*github\*\*: NO DATA/);
});

test('009-marketing-finance-link enforces PG 16 FORCE RLS, campaign-finance link, atomic channel_allocation commit, and atomic rollback on error', async () => {
  const cols = await db.appPool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'oshal_marketing_campaigns'
        AND column_name IN ('finance_project_id', 'channel_allocations')
      ORDER BY 1`,
  );
  assert.deepEqual(cols.rows.map((r) => r.column_name), ['channel_allocations', 'finance_project_id']);

  // Apply finance/migrations/007-finance-projects.sql in the same disposable PG 16 DB to prove real cross-table atomic tx + FORCE RLS!
  const finSqlPath = resolve(pkgDir, '..', 'finance', 'migrations', '007-finance-projects.sql');
  const finSql = readFileSync(finSqlPath, 'utf8');
  await db.appPool.query(finSql);
  await db.appPool.query(finSql);

  const campaigns = loadRouteSubmodule('marketing-campaigns.js');
  const budget = loadRouteSubmodule('marketing-budget.js');
  const measure = loadRouteSubmodule('marketing-measure.js');

  const camp = await invokeHandler(campaigns.createCampaign, db.appPool, OWNER_A, {
    body: { product: 'Open Swarm', name: 'RLS Finance Link Campaign', motion: 'revenue', channels: ['email', 'linkedin'] },
  });
  assert.equal(camp.statusCode, 201);
  const campId = camp.body.campaign.campaign_id;

  // Seed Owner A campaign allocations + matching Finance project, lines, and actuals under FORCE RLS.
  let finProjId;
  await asIdentity(db.appPool, { sub: OWNER_A }, async (client) => {
    await client.query(
      `UPDATE oshal_marketing_campaigns
          SET status = 'active', budget_monthly_usd = 1000, channel_allocations = $1::jsonb
        WHERE campaign_id = $2`,
      [JSON.stringify({ email: 40000, linkedin: 60000 }), campId],
    );
    const p = (await client.query(
      `INSERT INTO oshal_finance_projects (owner_sub, slug, name, currency, status, budget_cents, external_ref)
       VALUES ($1,'rls-fin-link','RLS Finance Link Campaign','USD','active',100000,$2) RETURNING project_id`,
      [OWNER_A, `marketing:campaign:${campId}`],
    )).rows[0];
    finProjId = p.project_id;
    const lEmail = (await client.query(
      `INSERT INTO oshal_finance_project_lines (owner_sub, project_id, name, channel, budget_cents, committed_cents)
       VALUES ($1,$2,'Email budget','email',40000,0) RETURNING line_id`,
      [OWNER_A, finProjId],
    )).rows[0].line_id;
    const lLi = (await client.query(
      `INSERT INTO oshal_finance_project_lines (owner_sub, project_id, name, channel, budget_cents, committed_cents)
       VALUES ($1,$2,'LinkedIn budget','linkedin',60000,0) RETURNING line_id`,
      [OWNER_A, finProjId],
    )).rows[0].line_id;
    await client.query(
      `INSERT INTO oshal_finance_project_actuals (owner_sub, project_id, line_id, source, amount_cents, occurred_on)
       VALUES ($1,$2,$3,'email',15000,'2026-11-20'::date), ($1,$2,$4,'ads',45000,'2026-11-21'::date)`,
      [OWNER_A, finProjId, lEmail, lLi],
    );
    await client.query(
      `INSERT INTO oshal_marketing_events (user_sub, ts, source, campaign_slug, medium, event, value, meta)
       VALUES ($1,'2026-11-22T12:00:00Z'::timestamptz,'posthog',$2,'email','conversion',30,'{}'::jsonb),
              ($1,'2026-11-22T12:00:00Z'::timestamptz,'posthog',$2,'linkedin','conversion',2,'{}'::jsonb)`,
      [OWNER_A, camp.body.campaign.slug],
    );
  });

  // Owner B gets 404 on link & summary; Owner A links & reads live summary.
  assert.equal((await invokeHandler(budget.linkCampaignFinanceProject, db.appPool, OWNER_B, { params: { id: campId }, body: { financeProjectId: finProjId } })).statusCode, 404);
  assert.equal((await invokeHandler(budget.getCampaignBudgetSummary, db.appPool, OWNER_B, { params: { id: campId } })).statusCode, 404);

  const linked = await invokeHandler(budget.linkCampaignFinanceProject, db.appPool, OWNER_A, {
    params: { id: campId }, body: { financeProjectId: finProjId },
  });
  assert.equal(linked.statusCode, 200);
  const sum = await invokeHandler(budget.getCampaignBudgetSummary, db.appPool, OWNER_A, { params: { id: campId } });
  assert.equal(sum.statusCode, 200);
  assert.equal(sum.body.linkedSummary.totalBudgetCents, 100000);
  assert.equal(sum.body.linkedSummary.totalActualCents, 60000);
  assert.equal(sum.body.linkedSummary.totalVarianceCents, 40000);

  // Generate reallocation proposal from real Finance actuals + marketing conversions.
  const propRes = await invokeHandler(budget.generateCampaignReallocationProposals, db.appPool, OWNER_A, {
    params: { id: campId }, body: {},
  });
  assert.equal(propRes.statusCode, 201);
  const entryId = propRes.body.proposals[0].entry_id;

  // Real PG 16 atomic rollback proof: inject a hook failure mid-transaction and prove BOTH ledgers stay untouched!
  const rollbackRes = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } };
  await assert.rejects(
    measure.decideBudgetProposal(
      {
        pool: makeStampedPool(db.appPool, OWNER_A),
        applyFinanceAllocationLines: async () => { throw new Error('forced_tx_failure'); },
      },
      OWNER_A,
      { params: { id: entryId }, body: { decision: 'approve', confirm: true } },
      rollbackRes,
    ),
    /forced_tx_failure/,
  );
  await asIdentity(db.appPool, { sub: OWNER_A }, async (client) => {
    const pRow = (await client.query('SELECT status FROM oshal_marketing_budget_ledger WHERE entry_id = $1', [entryId])).rows[0];
    const cRow = (await client.query('SELECT channel_allocations FROM oshal_marketing_campaigns WHERE campaign_id = $1', [campId])).rows[0];
    assert.equal(pRow.status, 'proposed', 'PG ROLLBACK keeps budget ledger proposed');
    assert.deepEqual(cRow.channel_allocations, { email: 40000, linkedin: 60000 }, 'PG ROLLBACK keeps campaign allocations unchanged');
  });

  // Real PG 16 atomic commit proof: approving updates campaign, oshal_finance_project_lines, and budget ledger in one tx!
  const committed = await invokeHandler(measure.decideBudgetProposal, db.appPool, OWNER_A, {
    params: { id: entryId }, body: { decision: 'approve', confirm: true },
  });
  assert.equal(committed.statusCode, 200);
  assert.equal(committed.body.proposal.status, 'applied');
  assert.equal(committed.body.financeSynced, true);
  assert.deepEqual(committed.body.allocations, { email: 52000, linkedin: 48000 });

  await asIdentity(db.appPool, { sub: OWNER_A }, async (client) => {
    const lines = (await client.query('SELECT channel, budget_cents FROM oshal_finance_project_lines WHERE project_id = $1 ORDER BY channel', [finProjId])).rows;
    assert.deepEqual(lines.map((r) => [r.channel, Number(r.budget_cents)]), [['email', 52000], ['linkedin', 48000]]);
  });
});

test('0.6.9 P5 attribution: enforcing-role PG 16 exact-owner FORCE RLS on oshal_marketing_conversions, first-touch sign-up -> purchase inheritance, delivery engagement & NO DATA', { timeout: 60000 }, async () => {
  const campaigns = loadRouteSubmodule('marketing-campaigns.js');
  const optin = loadRouteSubmodule('marketing-optin.js');
  const broadcast = loadRouteSubmodule('marketing-broadcast.js');
  const attribution = loadRouteSubmodule('marketing-attribution.js');

  // Verify ENABLE + FORCE ROW LEVEL SECURITY on oshal_marketing_conversions.
  const rlsMeta = (await db.admin.query(
    `SELECT relrowsecurity, relforcerowsecurity
       FROM pg_class
      WHERE relname = 'oshal_marketing_conversions' AND relnamespace = 'public'::regnamespace`,
  )).rows[0];
  assert.equal(rlsMeta.relrowsecurity, true, 'oshal_marketing_conversions ENABLE RLS');
  assert.equal(rlsMeta.relforcerowsecurity, true, 'oshal_marketing_conversions FORCE RLS');

  // Owner A creates two campaigns: launch-alpha and quiet-beta.
  const alphaRes = await invokeHandler(campaigns.createCampaign, db.appPool, OWNER_A, {
    body: { product: 'Open Swarm', name: 'Launch Alpha', slug: 'launch-alpha', motion: 'revenue', channels: ['email'] },
  });
  const betaRes = await invokeHandler(campaigns.createCampaign, db.appPool, OWNER_A, {
    body: { product: 'Open Swarm', name: 'Quiet Beta', slug: 'quiet-beta', motion: 'adoption', channels: [] },
  });
  assert.equal(alphaRes.statusCode, 201);
  assert.equal(betaRes.statusCode, 201);
  const alphaId = alphaRes.body.campaign.campaign_id;

  // Create sign-up form and submit a contact with UTM params -> automatic first-touch signup conversion.
  const formRes = await invokeHandler(optin.createSignupForm, db.appPool, OWNER_A, {
    body: { slug: 'p5-rls-waitlist', name: 'P5 RLS Waitlist', consentText: 'Yes, send updates.' },
  });
  assert.equal(formRes.statusCode, 201);
  const submitRes = await invokeHandler(optin.submitSignupForm, db.appPool, OWNER_A, {
    params: { slug: 'p5-rls-waitlist' },
    body: {
      email: 'p5-rls-buyer@example.com',
      displayName: 'P5 Buyer',
      utm_campaign: 'launch-alpha',
      utm_medium: 'email',
      utm_source: 'newsletter',
      returnPreviewLink: true,
    },
  });
  assert.equal(submitRes.statusCode, 200);
  const contactId = submitRes.body.preview.contactId;

  // Confirm opt-in -> must NOT create a duplicate signup conversion row.
  const confRes = await invokeHandler(optin.confirmOptIn, db.appPool, OWNER_A, {
    body: { token: submitRes.body.preview.token },
  });
  assert.equal(confRes.statusCode, 200);

  // Record a purchase conversion for contactId WITHOUT explicit campaignSlug -> inherits launch-alpha!
  const purchRes = await invokeHandler(attribution.recordConversion, db.appPool, OWNER_A, {
    body: { kind: 'purchase', contactId, amountCents: 4900, referenceId: 'rls-ord-49' },
  });
  assert.equal(purchRes.statusCode, 201);
  assert.equal(purchRes.body.firstTouchApplied, true);
  assert.equal(purchRes.body.conversion.campaign_slug, 'launch-alpha');
  assert.equal(purchRes.body.conversion.medium, 'email');
  assert.equal(Number(purchRes.body.conversion.amount_cents), 4900);

  // Seed attributed event + one sent delivery under launch-alpha, then fire clicked + bounced events.
  let deliveryId;
  await asIdentity(db.appPool, { sub: OWNER_A }, async (client) => {
    await client.query(
      `INSERT INTO oshal_marketing_events (user_sub, ts, source, campaign_slug, medium, event, value, meta)
       VALUES ($1, now(), 'gsc', 'launch-alpha', 'organic', 'clicks', 33, '{}'::jsonb)`,
      [OWNER_A],
    );
    const listId = (await client.query(
      `INSERT INTO oshal_marketing_lists (owner_sub, slug, name)
       VALUES ($1, 'p5-rls-list', 'P5 RLS List') RETURNING list_id`,
      [OWNER_A],
    )).rows[0].list_id;
    const msgId = (await client.query(
      `INSERT INTO oshal_marketing_messages
         (owner_sub, campaign_id, list_id, template_id, subject, body, status, signing_secret)
       VALUES ($1, $2, $3, 'launch', 'Launch Alpha', 'Now live', 'sent', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
       RETURNING message_id`,
      [OWNER_A, alphaId, listId],
    )).rows[0].message_id;
    deliveryId = (await client.query(
      `INSERT INTO oshal_marketing_deliveries
         (owner_sub, message_id, contact_id, email_hash, status, gate_reason)
       VALUES ($1, $2, $3, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'sent', 'sent')
       RETURNING delivery_id`,
      [OWNER_A, msgId, contactId],
    )).rows[0].delivery_id;
  });

  // Owner B cannot read conversions (even with operator=on!), cannot record on Owner A's contact, cannot post delivery event!
  await asIdentity(db.appPool, { sub: OWNER_B, operator: true }, async (client) => {
    const leaked = (await client.query('SELECT * FROM oshal_marketing_conversions')).rows;
    assert.equal(leaked.length, 0, 'exact-owner FORCE RLS blocks Owner B and operator bypass on conversions');
  });
  await asIdentity(db.appPool, null, async (client) => {
    const leakedUnset = (await client.query('SELECT * FROM oshal_marketing_conversions')).rows;
    assert.equal(leakedUnset.length, 0, 'unset oshal.current_sub sees zero conversions');
  });
  assert.equal((await invokeHandler(attribution.recordConversion, db.appPool, OWNER_B, { body: { kind: 'purchase', contactId, amountCents: 100 } })).statusCode, 404);
  assert.equal((await invokeHandler(attribution.recordDeliveryEvent, db.appPool, OWNER_B, { params: { deliveryId }, body: { event: 'clicked' } })).statusCode, 404);

  // Owner A records clicked + bounced delivery events -> bounce auto-creates suppression!
  const clickRes = await invokeHandler(attribution.recordDeliveryEvent, db.appPool, OWNER_A, {
    params: { deliveryId }, body: { event: 'clicked' },
  });
  assert.equal(clickRes.statusCode, 200);
  assert.equal(clickRes.body.suppressed, false);

  const bounceRes = await invokeHandler(attribution.recordDeliveryEvent, db.appPool, OWNER_A, {
    params: { deliveryId }, body: { event: 'bounced', reason: '550_unknown_user' },
  });
  assert.equal(bounceRes.statusCode, 200);
  assert.equal(bounceRes.body.suppressed, true);

  // Verify Owner A funnel counts and Owner B funnel isolation.
  const funnelA = await invokeHandler(attribution.getAttributionFunnel, db.appPool, OWNER_A, { query: {} });
  assert.equal(funnelA.statusCode, 200);
  const alpha = funnelA.body.campaigns.find((c) => c.campaignSlug === 'launch-alpha');
  const beta = funnelA.body.campaigns.find((c) => c.campaignSlug === 'quiet-beta');
  assert.equal(alpha.traffic.visits, 33);
  assert.equal(alpha.conversions.signups, 1);
  assert.equal(alpha.conversions.purchases, 1);
  assert.equal(alpha.conversions.revenueCents, 4900);
  assert.equal(alpha.engagement.status, 'ok');
  assert.equal(alpha.engagement.delivered, 1);
  assert.equal(alpha.engagement.clicked, 1);
  assert.equal(alpha.engagement.bounced, 1);
  assert.equal(beta.engagement.status, 'NO DATA');

  const funnelB = await invokeHandler(attribution.getAttributionFunnel, db.appPool, OWNER_B, { query: {} });
  assert.equal(funnelB.statusCode, 200);
  assert.equal(funnelB.body.campaigns.length, 0);
  assert.equal(funnelB.body.totals.revenueCents, 0);
  assert.ok(broadcast);
});

test('0.6.10 P4 SMS consent & quiet hours: enforcing-role PG 16 exact-owner FORCE RLS on oshal_marketing_sms_queue, unconsented 403 refusal, quiet-hours hold, STOP suppression & cross-owner isolation', { timeout: 60000 }, async () => {
  const sms = loadRouteSubmodule('marketing-sms.js');

  const rlsMeta = (await db.admin.query(
    `SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner
       FROM pg_class
      WHERE relname = 'oshal_marketing_sms_queue' AND relnamespace = 'public'::regnamespace`,
  )).rows[0];
  assert.equal(rlsMeta.owner, db.role, 'oshal_marketing_sms_queue owned by enforcing role');
  assert.equal(rlsMeta.relrowsecurity, true, 'oshal_marketing_sms_queue ENABLE RLS');
  assert.equal(rlsMeta.relforcerowsecurity, true, 'oshal_marketing_sms_queue FORCE RLS');

  const pol = (await db.appPool.query(
    `SELECT qual, with_check FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'oshal_marketing_sms_queue'`,
  )).rows;
  assert.equal(pol.length, 1);
  assert.match(pol[0].qual, /oshal\.current_sub/);
  assert.doesNotMatch(pol[0].qual, /is_operator/);
  assert.doesNotMatch(pol[0].with_check, /is_operator/);

  // Unconsented contact is REFUSED 403 sms_consent_required and writes a refused_consent audit row.
  const bareContact = await invokeHandler(audience.upsertContact, db.appPool, OWNER_A, {
    body: { email: 'sms-unconsented@example.com', displayName: 'No SMS Consent' },
  });
  assert.equal(bareContact.statusCode, 201);
  const bareId = bareContact.body.contact.contact_id;
  const refused = await invokeHandler(sms.scheduleSmsMessage, db.appPool, OWNER_A, {
    body: { contactId: bareId, body: 'Should never send', nowIso: '2026-11-26T18:00:00Z' },
  });
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.body.error, 'sms_consent_required');

  // Record complete TCPA/CTIA SMS opt-in with NANP 415 area code (inferred America/Los_Angeles).
  const optIn = await invokeHandler(sms.recordSmsOptIn, db.appPool, OWNER_A, {
    body: {
      email: 'sms-rls@example.com',
      displayName: 'SMS RLS Contact',
      phoneE164: '+14155550199',
      programName: 'Open Swarm Alerts',
      disclosureText: 'I agree to receive recurring Open Swarm SMS alerts. Consent not required to buy.',
      frequency: 'Up to 4 msgs/month',
      helpText: 'Reply HELP for support',
      stopText: 'Reply STOP to cancel',
      feeDisclosure: 'Msg & data rates may apply',
      recordedAt: '2026-11-25T18:00:00Z',
    },
  });
  assert.equal(optIn.statusCode, 201);
  assert.equal(optIn.body.timezone, 'America/Los_Angeles');
  assert.equal(optIn.body.timezoneInferred, true);
  assert.match(optIn.body.confirmationText, /Open Swarm Alerts/);
  assert.match(optIn.body.confirmationText, /HELP/);
  assert.match(optIn.body.confirmationText, /STOP/);
  const smsContactId = optIn.body.contact.contact_id;

  // 10:00 p.m. Pacific (2026-11-26T06:00:00Z) -> HELD until next 08:00 Pacific (2026-11-26T16:00:00.000Z).
  const held = await invokeHandler(sms.scheduleSmsMessage, db.appPool, OWNER_A, {
    body: { contactId: smsContactId, body: 'Late-night launch text', nowIso: '2026-11-26T06:00:00Z' },
  });
  assert.equal(held.statusCode, 202);
  assert.equal(held.body.status, 'held_quiet_hours');
  assert.equal(held.body.releaseAt, '2026-11-26T16:00:00.000Z');
  assert.equal(held.body.recipientTimezone, 'America/Los_Angeles');
  assert.equal(held.body.timezoneInferred, true);

  // 10:00 a.m. Pacific (2026-11-26T18:00:00Z) -> READY (200).
  const ready = await invokeHandler(sms.scheduleSmsMessage, db.appPool, OWNER_A, {
    body: { contactId: smsContactId, body: 'Daytime launch text', nowIso: '2026-11-26T18:00:00Z' },
  });
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.body.status, 'ready');

  // Exact-owner FORCE RLS: Owner B, operator=on, and unstamped connections read ZERO rows from oshal_marketing_sms_queue!
  for (const probe of [{ sub: OWNER_B }, { sub: OWNER_B, operator: true }, { sub: '', operator: true }, null]) {
    await asIdentity(db.appPool, probe, async (client) => {
      const leaked = (await client.query('SELECT * FROM oshal_marketing_sms_queue')).rows;
      assert.equal(leaked.length, 0, `oshal_marketing_sms_queue must return 0 rows for ${JSON.stringify(probe)}`);
    });
  }
  await assert.rejects(
    asIdentity(db.appPool, { sub: OWNER_B }, (client) => client.query(
      `INSERT INTO oshal_marketing_sms_queue
         (owner_sub, contact_id, phone_hash, body, recipient_timezone, status, scheduled_for)
       VALUES ($1,$2,'0000000000000000000000000000000000000000000000000000000000000000','spoof','America/New_York','ready',now())`,
      [OWNER_A, smsContactId],
    )),
    /row-level security policy/i,
  );
  assert.equal((await invokeHandler(sms.listSmsQueue, db.appPool, OWNER_B, {})).body.items.length, 0);
  assert.equal((await invokeHandler(sms.scheduleSmsMessage, db.appPool, OWNER_B, { body: { contactId: smsContactId, body: 'Hijack' } })).statusCode, 404);
  assert.equal((await invokeHandler(sms.processSmsKeyword, db.appPool, OWNER_B, { body: { contactId: smsContactId, body: 'STOP' } })).statusCode, 404);

  // STOP suppresses phone hash, revokes SMS consent, cancels held queue item, and blocks subsequent sends (403).
  const stopRes = await invokeHandler(sms.processSmsKeyword, db.appPool, OWNER_A, {
    body: { contactId: smsContactId, body: '  stop  ' },
  });
  assert.equal(stopRes.statusCode, 200);
  assert.equal(stopRes.body.action, 'stop');
  assert.equal(stopRes.body.suppressed, true);
  assert.equal(stopRes.body.revokedConsents, 1);
  assert.equal(stopRes.body.cancelledQueueItems, 1);

  const afterStop = await invokeHandler(sms.scheduleSmsMessage, db.appPool, OWNER_A, {
    body: { contactId: smsContactId, body: 'After STOP', nowIso: '2026-11-26T18:00:00Z' },
  });
  assert.equal(afterStop.statusCode, 403);
  assert.equal(afterStop.body.error, 'sms_suppressed');

  // Re-opting in a suppressed phone is refused 409!
  const reOpt = await invokeHandler(sms.recordSmsOptIn, db.appPool, OWNER_A, {
    body: {
      email: 'sms-rls@example.com', phoneE164: '+14155550199',
      programName: 'Open Swarm Alerts', disclosureText: 'Re-opt attempt',
      frequency: 'Up to 4 msgs/month', helpText: 'Reply HELP', stopText: 'Reply STOP',
      feeDisclosure: 'Msg & data rates may apply', recordedAt: '2026-11-26T19:00:00Z',
    },
  });
  assert.equal(reOpt.statusCode, 409);
  assert.equal(reOpt.body.error, 'sms_suppressed');
});
