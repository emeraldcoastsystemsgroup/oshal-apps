/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Own one uniquely labelled, loopback-only disposable PostgreSQL (existing local postgres:16-alpine image, no pull, tmpfs data) inside the machine-wide fixture-slot ceiling, and apply Video's declared migrations twice AS the application role so that role owns every table - the installed condition under which only FORCEd row security filters anything.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | CREATE-EDIT-05c: apply migration 069 (export jobs) with the rest of the declared set and clear its table between cases.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync as readSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { requireCore, packageRoot } from './video-editor.fixture.mjs';
const { Pool } = requireCore('pg');

export const MIGRATIONS = ['migrations/066-video-series.sql', 'migrations/067-video-episode-scenes.sql', 'migrations/068-video-edit-projects.sql',
  'migrations/069-video-edit-exports.sql'];
export const EDITOR_TABLES = ['video_edit_projects', 'video_edit_revisions', 'video_edit_assets', 'video_edit_revision_assets', 'video_edit_exports'];
const SLOT_ROOT = join(tmpdir(), 'oshal-fixture-slots');

function docker(args) { return execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

/** Claim one slot of the SAME machine-wide ceiling core's fixtures use (OSHAL_FIXTURE_SLOTS, default 4). */
async function claimSlot(purpose) {
  mkdirSync(SLOT_ROOT, { recursive: true });
  const total = Number.isInteger(Number(process.env.OSHAL_FIXTURE_SLOTS)) && Number(process.env.OSHAL_FIXTURE_SLOTS) > 0 ? Number(process.env.OSHAL_FIXTURE_SLOTS) : 4;
  const deadline = Date.now() + 180000;
  for (;;) {
    for (let index = 0; index < total; index += 1) {
      const dir = join(SLOT_ROOT, `slot-${index}`);
      try { mkdirSync(dir); } catch {
        let pid = 0;
        try { pid = Number(readSync(join(dir, 'owner'), 'utf8').trim()); } catch { /* mid-claim */ }
        let alive = false;
        try { if (pid > 0) { process.kill(pid, 0); alive = true; } } catch (error) { alive = error.code === 'EPERM'; }
        if (!alive && pid > 0) rmSync(dir, { recursive: true, force: true });
        continue;
      }
      writeFileSync(join(dir, 'owner'), String(process.pid)); writeFileSync(join(dir, 'purpose'), purpose);
      return { release: () => rmSync(dir, { recursive: true, force: true }) };
    }
    if (Date.now() > deadline) throw new Error('No fixture slot freed within 180 s');
    await pause(500);
  }
}

/** Verify the exact label before removing the one container this fixture created. */
function removeContainer(name, token) {
  assert.match(name, /^oshal-video-editor-test-[a-f0-9]{16}$/);
  let inspected;
  try { inspected = JSON.parse(docker(['inspect', name]))[0]; }
  catch (error) { if (/No such (object|container)/i.test(String(error.stderr))) return; throw error; }
  assert.equal(inspected.Config.Labels['oshal.video-editor-fixture'], token);
  docker(['rm', '--force', '--volumes', name]);
  assert.equal(docker(['container', 'ls', '--all', '--filter', `name=^/${name}$`, '--format', '{{.ID}}']), '');
}

/** Apply each declared migration twice as the application role, on one dedicated client (SET ROLE is connection state). */
async function applyMigrations(admin) {
  const client = await admin.connect();
  try {
    await client.query('SET ROLE video_fixture_app');
    for (const file of MIGRATIONS) {
      const sql = await readFile(resolve(packageRoot, file), 'utf8');
      await client.query(sql); await client.query(sql);
    }
    const owners = await client.query("SELECT count(*)::int AS other FROM pg_tables WHERE schemaname='public' AND tableowner <> 'video_fixture_app'");
    assert.equal(owners.rows[0].other, 0, 'the fixture leaves every table owned by the application role');
  } finally {
    try { await client.query('RESET ROLE'); } finally { client.release(); }
  }
}

async function ready(pool) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { try { await pool.query('SELECT 1'); return; } catch { await pause(200); } }
  throw new Error('Disposable PostgreSQL did not become ready within 20 seconds');
}

/**
 * @description Start the disposable database. No installed connection string, network alias, mount or credential is used.
 * @param {(fn: Function) => void} registerCleanup Test cleanup hook. @param {{poolMax?: number}} options Application pool size.
 * @returns {Promise<{admin: object, pool: object, evidence: object, makePool: Function}>} Superuser pool (fixture setup only),
 *   the app-role pool, and a factory for further app-role pools (closed with the fixture).
 */
export async function startPostgres(registerCleanup, options = {}) {
  const slot = await claimSlot('video-editor-postgres');
  const token = randomUUID(), name = `oshal-video-editor-test-${token.replaceAll('-', '').slice(0, 16)}`;
  let admin, pool;
  const extra = [], evidence = { container: name, cleanupVerified: false };
  registerCleanup(async () => {
    try { for (const other of extra) await other.end(); await pool?.end(); await admin?.end(); } finally { try { removeContainer(name, token); } finally { slot.release(); } }
    evidence.cleanupVerified = true;
    console.log(JSON.stringify({ fixture: 'video-editor-postgres', ...evidence }));
  });
  const image = docker(['image', 'inspect', 'postgres:16-alpine', '--format', '{{.Id}}']);
  assert.match(image, /^sha256:[a-f0-9]{64}$/); evidence.image = image;
  docker(['run', '--detach', '--pull=never', '--name', name, '--label', `oshal.video-editor-fixture=${token}`,
    '--memory', '384m', '--cpus', '1', '--tmpfs', '/var/lib/postgresql/data:rw,size=256m',
    '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_PASSWORD=isolated-fixture-only', image]);
  const address = docker(['port', name, '5432/tcp']).split(/\r?\n/)[0];
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const common = { host: '127.0.0.1', port: Number(address.split(':')[1]), database: 'postgres', connectionTimeoutMillis: 2000, query_timeout: 10000, max: 6 };
  admin = new Pool({ ...common, user: 'postgres', password: 'isolated-fixture-only' });
  await ready(admin);
  await admin.query("CREATE ROLE video_fixture_app LOGIN PASSWORD 'isolated-app-only' NOSUPERUSER NOBYPASSRLS");
  await admin.query('GRANT USAGE,CREATE ON SCHEMA public TO video_fixture_app');
  await applyMigrations(admin);
  const makePool = max => { const created = new Pool({ ...common, max, user: 'video_fixture_app', password: 'isolated-app-only' }); extra.push(created); return created; };
  pool = new Pool({ ...common, max: options.poolMax ?? common.max, user: 'video_fixture_app', password: 'isolated-app-only' });
  return { admin, pool, evidence, makePool };
}

/** @description Empty the editor tables between cases (superuser; bypasses the forced policy by design of the fixture only). */
export async function resetPostgres(admin) {
  await admin.query(`TRUNCATE ${EDITOR_TABLES.join(',')}`);
}
