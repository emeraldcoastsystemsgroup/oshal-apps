/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The project store's SQL against a REAL disposable PostgreSQL 16: the migration applies twice; it is applied and queried by a non-superuser, non-BYPASSRLS role that OWNS the tables (as the api does), so only FORCEd row security filters anything; another person's rows are invisible and unwritable, an unstamped session sees nothing, a spoofed owner is refused by WITH CHECK; a revision commit advances only from the revision the writer started from — a stale writer and the loser of a real concurrent race get null and leave no revision row; pruning, the preview record and the cascading delete behave.
 *
 * Needs docker with the local postgres:16-alpine image and a framework checkout (for `pg`):
 *   OSHAL_CORE_DIR=<oshal checkout> node --test tests/store.pg.test.js
 * Registered in tests/test-lab.yaml with those prerequisites; not part of the bare store-CI wildcard.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const CORE = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!CORE) throw new Error('Set OSHAL_CORE_ROOT or OSHAL_CORE_DIR to a framework checkout (this suite loads `pg` from it)');
const { Pool } = Module.createRequire(path.join(CORE, 'package.json'))('pg');
const PKG = path.resolve(__dirname, '..');
const store = require(path.join(PKG, 'routes', 'project-store.js'));
const MIGRATION = fs.readFileSync(path.join(PKG, 'migrations', '001-scene-studio.sql'), 'utf8');

const docker = (args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const NAME = `oshal-scene-studio-pg-${randomUUID().slice(0, 8)}`;
let admin, app;

/** A pool whose every query runs with `oshal.current_sub` stamped, the way core's GUC-stamped pool does. */
function as(sub) {
  return {
    async query(sql, params) {
      const client = await app.connect();
      try {
        await client.query("SELECT set_config('oshal.current_sub', $1, false), set_config('oshal.is_operator', 'off', false)", [sub]);
        return await client.query(sql, params);
      } finally { client.release(); }
    },
  };
}

test.before(async () => {
  assert.match(docker(['image', 'inspect', 'postgres:16-alpine', '--format', '{{.Id}}']), /^sha256:/);
  docker(['run', '--detach', '--rm', '--pull=never', '--name', NAME, '--memory', '512m', '--cpus', '1',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=256m', '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_PASSWORD=disposable-scene-test', 'postgres:16-alpine']);
  const port = Number(docker(['port', NAME, '5432/tcp']).split(':')[1]);
  const common = { host: '127.0.0.1', port, database: 'postgres', connectionTimeoutMillis: 1000 };
  admin = new Pool({ ...common, user: 'postgres', password: 'disposable-scene-test', max: 2 });
  for (let i = 0; ; i += 1) {
    try { await admin.query('SELECT 1'); break; } catch (e) { if (i > 100) throw e; await new Promise((r) => setTimeout(r, 150)); }
  }
  await admin.query("CREATE ROLE scene_app LOGIN PASSWORD 'disposable-app' NOSUPERUSER NOBYPASSRLS");
  await admin.query('GRANT USAGE, CREATE ON SCHEMA public TO scene_app');
  app = new Pool({ ...common, user: 'scene_app', password: 'disposable-app', max: 6 });
  await app.query(MIGRATION);
  await app.query(MIGRATION);
});
test.after(async () => {
  try { await app?.end(); await admin?.end(); } finally { execFileSync('docker', ['rm', '-f', NAME], { stdio: 'ignore' }); }
});

const rev = (n) => ({ action: 'write-file', detail: { path: 'a.gd', n }, fileCount: 1, totalBytes: 10, blob: `${n}-aaaaaaaaaaaa.json.gz`, engineBuild: null });

test('the tables are owned by the app role and row security is forced on both', async () => {
  const { rows } = await admin.query("SELECT relname, relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname IN ('scene_project', 'scene_revision') ORDER BY relname");
  assert.deepEqual(rows, [
    { relname: 'scene_project', relrowsecurity: true, relforcerowsecurity: true, owner: 'scene_app' },
    { relname: 'scene_revision', relrowsecurity: true, relforcerowsecurity: true, owner: 'scene_app' },
  ]);
});

test("another person's projects are invisible and unwritable; an unstamped session sees nothing; a spoofed owner is refused", async () => {
  const mine = await store.insertProject(as('alice'), 'alice', { title: 'Island', kind: 'godot', template: '3d' });
  assert.equal(mine.revision, 0);
  assert.equal((await store.listProjects(as('alice'), 'alice')).length, 1);
  assert.equal((await as('bob').query('SELECT count(*)::int AS n FROM scene_project')).rows[0].n, 0, 'no owner filter in the SQL: RLS alone hides it');
  assert.equal((await as('').query('SELECT count(*)::int AS n FROM scene_project')).rows[0].n, 0);
  assert.equal((await as('bob').query("UPDATE scene_project SET title = 'pwned'")).rowCount, 0);
  assert.equal(await store.getProject(as('bob'), 'alice', mine.project_id), null, 'even naming alice as the owner, bob reads nothing');
  await assert.rejects(as('bob').query("INSERT INTO scene_project (owner_sub, title, kind) VALUES ('alice', 'spoof', 'godot')"), /row-level security/);
});

test('a revision commit advances only from the revision the writer started from', async () => {
  const p = await store.insertProject(as('alice'), 'alice', { title: 'Boat', kind: 'blender', template: 'default' });
  const one = await store.commitRevision(as('alice'), 'alice', p.project_id, 0, rev(1));
  assert.equal(one.revision, 1);
  assert.equal(one.file_count, 1);
  assert.equal(await store.commitRevision(as('alice'), 'alice', p.project_id, 0, rev(99)), null, 'a stale writer');
  assert.equal(await store.commitRevision(as('bob'), 'bob', p.project_id, 1, rev(2)), null, 'another person');
  const rows = await store.listRevisions(as('alice'), 'alice', p.project_id);
  assert.deepEqual(rows.map((r) => [r.revision, r.blob]), [[1, '1-aaaaaaaaaaaa.json.gz']]);
  assert.deepEqual((await store.getRevision(as('alice'), 'alice', p.project_id, 1)).detail, { path: 'a.gd', n: 1 });
});

test('of two writers racing from the same revision, exactly one commits', async () => {
  const p = await store.insertProject(as('alice'), 'alice', { title: 'Race', kind: 'godot', template: 'empty' });
  const results = await Promise.all([1, 2, 3, 4].map((n) => store.commitRevision(as('alice'), 'alice', p.project_id, 0, rev(n))));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await store.listRevisions(as('alice'), 'alice', p.project_id)).length, 1);
});

test('pruning, the project records and the cascading delete', async () => {
  const p = await store.insertProject(as('alice'), 'alice', { title: 'Prune', kind: 'godot', template: '3d' });
  for (let n = 0; n < 6; n += 1) await store.commitRevision(as('alice'), 'alice', p.project_id, n, rev(n + 1));
  const dropped = await store.pruneRevisions(as('alice'), 'alice', p.project_id, 4);
  assert.deepEqual(dropped.map((d) => d.revision).sort(), [1, 2, 3]);
  assert.deepEqual((await store.listRevisions(as('alice'), 'alice', p.project_id)).map((r) => r.revision), [6, 5, 4]);
  const withPreview = await store.setProjectRecord(as('alice'), 'alice', p.project_id, 'preview', { revision: 6, info: { polygons: 2 } });
  assert.deepEqual(withPreview.preview, { revision: 6, info: { polygons: 2 } });
  assert.equal(await store.setProjectRecord(as('bob'), 'bob', p.project_id, 'last_run', { x: 1 }), null);
  assert.equal(await store.renameProject(as('alice'), 'alice', p.project_id, 'Renamed').then((r) => r.title), 'Renamed');
  assert.equal(await store.deleteProject(as('bob'), 'bob', p.project_id), false);
  assert.equal(await store.deleteProject(as('alice'), 'alice', p.project_id), true);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM scene_revision WHERE project_id = $1', [p.project_id])).rows[0].n, 0, 'revisions cascade');
});
