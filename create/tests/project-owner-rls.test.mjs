/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the exact-owner policy actually filters the role that OWNS these tables, which is the installed condition: the api owns every public table and is the role that reads them, and PostgreSQL exempts a table owner from its own row security unless the table is FORCEd. Measured live 2026-09-21, the four create_project* tables carried a correct policy and returned the row anyway - as the owner, with no identity stamped and again with a wrong one. Every case here runs as the owner in a disposable database, and the last one performs the defect live: NO FORCE, the wrong identity sees the row again, FORCE, and it is gone. A test that only exercises a non-owner role cannot tell the two states apart.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Prove the PLATFORM identity arm, which is what keeps forcing these tables from silently breaking a person's data export and deletion. Core's /api/me export and delete discover every owner_sub-keyed public table from information_schema and run SELECT * FROM "<table>" WHERE "owner_sub"=$1 / DELETE FROM "<table>" WHERE "owner_sub"=$1 (discovered-exporters.ts:176,182) on a connection stamped only with oshal.current_sub / oshal.current_issuer. The cases below reproduce that stamp exactly - session-scoped, with is_operator, then RESET, as guc-pool.ts does - and assert the export reads and the delete removes on all five owned tables, that the package's own create.* path still works on its own, that a second person gets nothing through either stamp, and that an unstamped connection and the empty system stamp get nothing. The policy assertion also refuses an operator arm, because the fix for this blocker must never become a bypass.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startPostgres, resetPostgres } from './project-postgres.fixture.mjs';

const TABLES = ['create_projects', 'create_project_revisions', 'create_project_assets',
  'create_project_revision_assets', 'create_brand_kits'];
const OWNER = { issuer: 'https://fixture.invalid/issuer', sub: 'fixture-owner-sub' };
const STRANGER = { issuer: 'https://fixture.invalid/issuer', sub: 'fixture-stranger-sub' };

let db, cleanup;
after(async () => { await cleanup?.(); });
before(async () => { db = await startPostgres(callback => { cleanup = callback; }); });
beforeEach(async () => { await resetPostgres(db.admin); });

/** Run work on one connection stamped with the given create.* identity, or with none at all. */
async function asOwnerRole(identity, work) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (identity) {
      await client.query("SELECT set_config('create.owner_issuer',$1,true),set_config('create.owner_sub',$2,true)",
        [identity.issuer, identity.sub]);
    }
    return await work(client);
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}

/** Seed one project owned by OWNER, committed, so every case below reads the same real row. */
async function seedProject() {
  const id = randomUUID();
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('create.owner_issuer',$1,true),set_config('create.owner_sub',$2,true)",
      [OWNER.issuer, OWNER.sub]);
    await client.query('INSERT INTO create_projects (project_id,owner_issuer,owner_sub,title) VALUES ($3,$1,$2,$4)',
      [OWNER.issuer, OWNER.sub, id, 'Synthetic project']);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
  return id;
}

test('the reading role is the table owner, and every table is enabled AND forced', async () => {
  const who = await db.pool.query('SELECT current_user AS role');
  assert.equal(who.rows[0].role, 'create_fixture_app');
  const state = await db.pool.query(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[]) ORDER BY 1`,
    [TABLES]);
  assert.deepEqual(state.rows.map(row => row.relname).sort(), [...TABLES].sort());
  for (const row of state.rows) {
    assert.equal(row.owner, 'create_fixture_app', `${row.relname} is not owned by the reading role`);
    assert.equal(row.relrowsecurity, true, `${row.relname} does not have row security enabled`);
    assert.equal(row.relforcerowsecurity, true,
      `${row.relname} is ENABLEd but not FORCEd, so its policy never runs for the role that owns it`);
  }
});

test('as the owner, a row is invisible with no identity stamped and with the wrong one', async () => {
  const id = await seedProject();
  assert.equal((await asOwnerRole(null, c => c.query('SELECT project_id FROM create_projects'))).rows.length, 0);
  assert.equal((await asOwnerRole(STRANGER, c => c.query('SELECT project_id FROM create_projects'))).rows.length, 0);
  assert.equal((await asOwnerRole({ issuer: 'https://other.invalid/issuer', sub: OWNER.sub },
    c => c.query('SELECT project_id FROM create_projects'))).rows.length, 0);
  const mine = await asOwnerRole(OWNER, c => c.query('SELECT project_id FROM create_projects'));
  assert.deepEqual(mine.rows.map(row => row.project_id), [id]);
});

test('as the owner, an UPDATE and a DELETE aimed at another owner\'s row change nothing', async () => {
  const id = await seedProject();
  const updated = await asOwnerRole(STRANGER, c => c.query('UPDATE create_projects SET title=$1', ['Taken']));
  assert.equal(updated.rowCount, 0);
  const deleted = await asOwnerRole(STRANGER, c => c.query('DELETE FROM create_projects'));
  assert.equal(deleted.rowCount, 0);
  const still = await asOwnerRole(OWNER, c => c.query('SELECT title FROM create_projects WHERE project_id=$1', [id]));
  assert.deepEqual(still.rows.map(row => row.title), ['Synthetic project']);
});

test('as the owner, writing a row for somebody else is refused by WITH CHECK, not silently dropped', async () => {
  await assert.rejects(
    asOwnerRole(OWNER, c => c.query('INSERT INTO create_projects (project_id,owner_issuer,owner_sub,title) VALUES ($3,$1,$2,$4)',
      [STRANGER.issuer, STRANGER.sub, randomUUID(), 'Somebody else'])),
    /row-level security policy/i);
});

test('FORCE is the thing doing the work: NO FORCE hands the row straight back to the wrong identity', async () => {
  const id = await seedProject();
  const owner = await db.pool.connect();
  try {
    await owner.query('ALTER TABLE create_projects NO FORCE ROW LEVEL SECURITY');
    const exempt = await asOwnerRole(STRANGER, c => c.query('SELECT project_id FROM create_projects'));
    assert.deepEqual(exempt.rows.map(row => row.project_id), [id],
      'without FORCE the owner is exempt and the policy never filters — this is the live defect');
    await owner.query('ALTER TABLE create_projects FORCE ROW LEVEL SECURITY');
    const walled = await asOwnerRole(STRANGER, c => c.query('SELECT project_id FROM create_projects'));
    assert.equal(walled.rows.length, 0);
  } finally {
    await owner.query('ALTER TABLE create_projects FORCE ROW LEVEL SECURITY');
    owner.release();
  }
});

// ---------------------------------------------------------------------------------------------
// The platform identity arm. Forcing these tables makes the policy run for the role that owns
// them, and that role is also how CORE reaches them: /api/me export and delete discover every
// owner_sub-keyed public table from information_schema and query it with the two literal
// statements below (discovered-exporters.ts:176,182), on a connection the GUC pool stamps with
// oshal.current_sub / oshal.current_issuer and never with create.owner_*. With only the package
// arm that export returns zero rows and that delete removes nothing, both reporting success.
// ---------------------------------------------------------------------------------------------

/** The five tables this package owns. Every one carries owner_sub, so every one is discovered. */
const OWNED = ['create_projects', 'create_project_revisions', 'create_project_assets',
  'create_project_revision_assets', 'create_brand_kits'];

/** Children before parents, which is the order discovered-exporters.ts derives from the FK graph. */
const DELETE_ORDER = ['create_project_revision_assets', 'create_brand_kits',
  'create_project_revisions', 'create_projects', 'create_project_assets'];

/** The exporter's own statements, character for character (discovered-exporters.ts:176 and :182). */
const exportSql = table => `SELECT * FROM "${table}" WHERE "owner_sub"=$1`;
const deleteSql = table => `DELETE FROM "${table}" WHERE "owner_sub"=$1`;

/** Every owned table mapped to the same expected count, for a whole-inventory assertion. */
const everyTable = count => Object.fromEntries(OWNED.map(table => [table, count]));

/**
 * Stamp a connection the way the platform GUC pool does and nothing else: oshal.current_sub,
 * oshal.current_issuer and oshal.is_operator, set SESSION-wide (set_config third argument false),
 * then RESET on release - guc-pool.ts:152-156 and its RESET_SQL at :79. create.owner_* is never
 * set here, which is the whole point: this is the identity core arrives with.
 */
async function asPlatformIdentity(identity, work) {
  const client = await db.pool.connect();
  try {
    if (identity) {
      await client.query(
        "SELECT set_config('oshal.current_sub',$1,false),set_config('oshal.current_issuer',$2,false),set_config('oshal.is_operator',$3,false)",
        [identity.sub, identity.issuer, identity.operator ? 'on' : 'off']);
    }
    return await work(client);
  } finally {
    try { await client.query('RESET oshal.current_sub; RESET oshal.current_issuer; RESET oshal.is_operator'); }
    finally { client.release(); }
  }
}

/** Count what one stamped connection can read from every owned table, by the exporter's statement. */
async function exportCounts(client, subject) {
  const counts = {};
  for (const table of OWNED) counts[table] = (await client.query(exportSql(table), [subject])).rows.length;
  return counts;
}

/**
 * The same count with NO predicate of its own, so the policy is the only thing filtering. The
 * exporter's statement carries `WHERE owner_sub=$1`, which would hide a policy that had been
 * widened - a wrong-subject probe returns nothing either way. This one cannot.
 */
async function visibleCounts(client) {
  const counts = {};
  for (const table of OWNED) counts[table] = (await client.query(`SELECT 1 FROM "${table}"`)).rows.length;
  return counts;
}

/** One committed row in every table this package owns, written through the package's own stamp. */
async function seedEveryTable(owner) {
  const projectId = randomUUID(), assetId = randomUUID();
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('create.owner_issuer',$1,true),set_config('create.owner_sub',$2,true)",
      [owner.issuer, owner.sub]);
    await client.query(`INSERT INTO create_project_assets
      (asset_id,owner_issuer,owner_sub,width,height,byte_length,sha256) VALUES ($1,$2,$3,16,16,1024,$4)`,
      [assetId, owner.issuer, owner.sub, 'a'.repeat(64)]);
    await client.query('INSERT INTO create_projects (project_id,owner_issuer,owner_sub,title) VALUES ($1,$2,$3,$4)',
      [projectId, owner.issuer, owner.sub, 'Synthetic project']);
    await client.query(`INSERT INTO create_project_revisions
      (project_id,owner_issuer,owner_sub,revision,title,document) VALUES ($1,$2,$3,1,$4,'{}'::jsonb)`,
      [projectId, owner.issuer, owner.sub, 'Synthetic project']);
    await client.query(`INSERT INTO create_project_revision_assets
      (project_id,revision,owner_issuer,owner_sub,asset_id) VALUES ($1,1,$2,$3,$4)`,
      [projectId, owner.issuer, owner.sub, assetId]);
    await client.query(`INSERT INTO create_brand_kits
      (owner_issuer,owner_sub,kit,logo_asset_id) VALUES ($1,$2,'{}'::jsonb,$3)`,
      [owner.issuer, owner.sub, assetId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
  return { projectId, assetId };
}

test('the exact-owner policy carries BOTH identity arms on every owned table, and no operator arm', async () => {
  const policies = await db.pool.query(
    `SELECT tablename, qual, with_check FROM pg_policies
      WHERE schemaname='public' AND tablename = ANY($1::text[]) AND policyname = tablename || '_exact_owner'
      ORDER BY tablename`, [OWNED]);
  assert.deepEqual(policies.rows.map(row => row.tablename), [...OWNED].sort());
  for (const row of policies.rows) {
    for (const [side, expression] of [['USING', row.qual], ['WITH CHECK', row.with_check]]) {
      assert.ok(expression, `${row.tablename} has no ${side} expression`);
      assert.match(expression, /create\.owner_sub/, `${row.tablename} ${side} lost the package identity arm`);
      assert.match(expression, /oshal\.current_sub/, `${row.tablename} ${side} lost the platform identity arm`);
      assert.doesNotMatch(expression, /is_operator/,
        `${row.tablename} ${side} grew an operator bypass, which this policy must never carry`);
    }
  }
});

test('the /api/me path: the platform stamp alone EXPORTS every owned table and DELETES it', async () => {
  await seedEveryTable(OWNER);
  const exported = await asPlatformIdentity(OWNER, client => exportCounts(client, OWNER.sub));
  for (const table of OWNED) {
    assert.equal(exported[table], 1,
      `${table}: the export reads zero rows with only the platform identity stamped, so a person's data export silently omits it`);
  }

  const removed = await asPlatformIdentity(OWNER, async client => {
    await client.query('BEGIN');
    const counts = {};
    for (const table of DELETE_ORDER) counts[table] = (await client.query(deleteSql(table), [OWNER.sub])).rowCount;
    await client.query('COMMIT');
    return counts;
  });
  for (const table of OWNED) {
    assert.equal(removed[table], 1, `${table}: "delete all my data" removed nothing and reported success`);
  }

  // Read it back through the package's own identity: the rows are actually gone, not merely hidden.
  assert.deepEqual(await asOwnerRole(OWNER, visibleCounts), everyTable(0));
});

test('the package\'s own create.* path still works with no platform identity stamped at all', async () => {
  const { projectId } = await seedEveryTable(OWNER);
  const mine = await asOwnerRole(OWNER, async client => ({
    projects: (await client.query('SELECT project_id FROM create_projects')).rows.map(row => row.project_id),
    revisions: (await client.query('SELECT revision FROM create_project_revisions')).rows.length,
    assets: (await client.query('SELECT asset_id FROM create_project_assets')).rows.length,
    revisionAssets: (await client.query('SELECT asset_id FROM create_project_revision_assets')).rows.length,
    brandKits: (await client.query('SELECT revision FROM create_brand_kits')).rows.length,
  }));
  assert.deepEqual(mine, { projects: [projectId], revisions: 1, assets: 1, revisionAssets: 1, brandKits: 1 });
});

test('a different person reads and deletes nothing through EITHER stamp', async () => {
  await seedEveryTable(OWNER);
  const viaPlatform = await asPlatformIdentity(STRANGER, client => exportCounts(client, OWNER.sub));
  assert.deepEqual(viaPlatform, everyTable(0), 'the platform arm must not widen the policy to another person');
  assert.deepEqual(await asPlatformIdentity(STRANGER, visibleCounts), everyTable(0));
  assert.deepEqual(await asOwnerRole(STRANGER, visibleCounts), everyTable(0));

  const theirDeletes = await asPlatformIdentity(STRANGER, async client => {
    await client.query('BEGIN');
    const counts = {};
    for (const table of DELETE_ORDER) counts[table] = (await client.query(deleteSql(table), [OWNER.sub])).rowCount;
    await client.query('ROLLBACK');
    return counts;
  });
  assert.deepEqual(theirDeletes, everyTable(0));

  // Right subject, wrong issuer, through the platform arm: still nothing.
  const wrongIssuer = await asPlatformIdentity({ issuer: 'https://other.invalid/issuer', sub: OWNER.sub },
    client => client.query(exportSql('create_projects'), [OWNER.sub]));
  assert.equal(wrongIssuer.rows.length, 0);
});

test('an unstamped connection, and the SYSTEM identity core stamps for background work, see nothing', async () => {
  await seedEveryTable(OWNER);
  assert.deepEqual(await asPlatformIdentity(null, client => exportCounts(client, OWNER.sub)), everyTable(0));
  assert.deepEqual(await asPlatformIdentity(null, visibleCounts), everyTable(0));

  // runWithSystemIdentity stamps both settings EMPTY and is_operator='on' (guc-pool.ts:129-133).
  // That is also the value a RESET connection carries, and it is the case the `<> ''` guard in the
  // platform arm exists for: an operator stamp buys nothing on this policy. The unpredicated read
  // is what proves that - the exporter's own statement would return nothing for an empty subject
  // however wide the policy had become.
  const asSystem = await asPlatformIdentity({ sub: '', issuer: '', operator: true }, async client => {
    const setting = (await client.query("SELECT current_setting('oshal.current_sub', true) AS value")).rows[0].value;
    assert.equal(setting, '', 'the system stamp must leave the platform subject empty');
    return { predicated: await exportCounts(client, OWNER.sub), visible: await visibleCounts(client) };
  });
  assert.deepEqual(asSystem.predicated, everyTable(0));
  assert.deepEqual(asSystem.visible, everyTable(0),
    'the system/operator stamp must see nothing here: this policy carries no operator arm');
});
