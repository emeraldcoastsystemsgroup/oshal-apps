/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Own one uniquely labeled, port-isolated disposable PostgreSQL container using only an existing local image.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Allow a two-connection synthetic runtime pool to reproduce actual authorization nesting without changing installed configuration.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Apply the brand kit migration (twice, for idempotency) and clear its table between cases.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { requireCore, packageRoot } from './project-api.fixture.mjs';
const { Pool } = requireCore('pg');

function docker(args) { return execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

/** Verify exact ownership before removing the one fixture container and its temporary storage. */
function removeContainer(name, token) {
  assert.match(name, /^oshal-create-project-test-[a-f0-9]{16}$/);
  let inspected;
  try { inspected = JSON.parse(docker(['inspect', name]))[0]; }
  catch (error) { if (/No such (object|container)/i.test(String(error.stderr))) return; throw error; }
  assert.equal(inspected.Config.Labels['oshal.create-project-fixture'], token);
  docker(['rm', '--force', '--volumes', name]);
  assert.equal(docker(['container', 'ls', '--all', '--filter', `name=^/${name}$`, '--format', '{{.ID}}']), '');
}

async function ready(pool) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { await pool.query('SELECT 1'); return; } catch { await pause(150); }
  }
  throw new Error('Disposable PostgreSQL did not become ready within 15 seconds');
}

/** No installed connection strings, network aliases, mounts or credentials enter this fixture. */
export async function startPostgres(registerCleanup, options = {}) {
  const token = randomUUID(), name = `oshal-create-project-test-${token.replaceAll('-', '').slice(0, 16)}`;
  const image = docker(['image', 'inspect', 'postgres:16-alpine', '--format', '{{.Id}}']);
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  let admin, pool;
  const evidence = { container: name, image, cleanupVerified: false };
  registerCleanup(async () => {
    try { await pool?.end(); await admin?.end(); } finally { removeContainer(name, token); }
    evidence.cleanupVerified = true;
    console.log(JSON.stringify({ fixture: 'create-project-postgres', ...evidence }));
  });
  docker(['run', '--detach', '--pull=never', '--name', name, '--label', `oshal.create-project-fixture=${token}`,
    '--memory', '512m', '--cpus', '1', '--tmpfs', '/var/lib/postgresql/data:rw,size=256m',
    '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_PASSWORD=isolated-fixture-only', image]);
  const address = docker(['port', name, '5432/tcp']);
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const common = { host: '127.0.0.1', port: Number(address.split(':')[1]), database: 'postgres', connectionTimeoutMillis: 1000, query_timeout: 10000, max: 6 };
  admin = new Pool({ ...common, user: 'postgres', password: 'isolated-fixture-only' });
  await ready(admin);
  const migration = await readFile(resolve(packageRoot, 'migrations/001-create-projects.sql'), 'utf8');
  await admin.query(migration); await admin.query(migration);
  const brandMigration = await readFile(resolve(packageRoot, 'migrations/002-create-brand-kits.sql'), 'utf8');
  await admin.query(brandMigration); await admin.query(brandMigration);
  await admin.query("CREATE ROLE create_fixture_app LOGIN PASSWORD 'isolated-app-only' NOSUPERUSER NOBYPASSRLS");
  await admin.query('GRANT USAGE ON SCHEMA public TO create_fixture_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO create_fixture_app');
  pool = new Pool({ ...common, max: options.poolMax ?? common.max, user: 'create_fixture_app', password: 'isolated-app-only' });
  return { admin, pool, evidence };
}

export async function resetPostgres(admin) {
  await admin.query('TRUNCATE create_brand_kits,create_project_revision_assets,create_project_revisions,create_projects,create_project_assets');
}
