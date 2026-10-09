/**
 * Venture Plan - one disposable PostgreSQL for the schema-bootstrap concurrency suite.
 *
 * Owns exactly one uniquely named, labelled, port-isolated postgres:16-alpine container that runs
 * from tmpfs and is reachable on 127.0.0.1 only. It is never pulled (--pull=never): an image that
 * is not already on the machine is a refusal, not a download. No installed connection string,
 * network alias, mount or credential enters it, and cleanup verifies the label before removing
 * the container, so it can only ever remove its own.
 *
 * The application role is a plain LOGIN role (no superuser, no BYPASSRLS) that OWNS the public
 * schema, so the package's runtime bootstrap creates and owns every table, function, trigger and
 * policy exactly as the api does on an installed database.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: container lifecycle, a fresh public schema per round owned by the application role, and a catalog read-back of what the bootstrap left behind.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';

const IMAGE = 'postgres:16-alpine';
const LABEL = 'oshal.venture-schema-fixture';
const NAME_SHAPE = /^oshal-venture-schema-test-[a-f0-9]{16}$/;
const ADMIN_PASSWORD = 'isolated-fixture-only';
/** @description The plain login role the package bootstraps as; it owns the public schema. */
export const APP_ROLE = 'venture_fixture_app';
const APP_PASSWORD = 'isolated-app-only';

/** @description Run one docker CLI command and return its trimmed stdout. @param {string[]} args @returns {string} */
function docker(args) {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * @description Remove the fixture container after proving it is the one this run labelled.
 * @param {string} name Container name minted by startPostgres.
 * @param {string} token The label value only this run knows.
 * @returns {void}
 */
function removeContainer(name, token) {
  assert.match(name, NAME_SHAPE);
  let inspected;
  try { inspected = JSON.parse(docker(['inspect', name]))[0]; } catch (error) {
    if (/No such (object|container)/i.test(String(error.stderr))) return;
    throw error;
  }
  assert.equal(inspected.Config.Labels[LABEL], token, 'refusing to remove a container this run did not start');
  docker(['rm', '--force', '--volumes', name]);
  assert.equal(docker(['container', 'ls', '--all', '--filter', `name=^/${name}$`, '--format', '{{.ID}}']), '');
}

/** @description Wait until the server answers. @param {import('pg').Pool} pool @returns {Promise<void>} */
async function ready(pool) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { await pool.query('SELECT 1'); return; } catch { await pause(200); }
  }
  throw new Error('Disposable PostgreSQL did not become ready within 30 seconds');
}

/**
 * @description Start the container and create the application role.
 * @param {(cleanup: () => Promise<void>) => void} registerCleanup Receives the teardown; it runs even when a case fails.
 * @param {typeof import('pg').Pool} Pool The pg Pool class from the framework checkout.
 * @returns {Promise<{ admin: import('pg').Pool, appConfig: object, evidence: object }>} The superuser pool
 *   (fixture setup and read-back only) and the connection settings for the application role.
 */
export async function startPostgres(registerCleanup, Pool) {
  const token = randomUUID();
  const name = `oshal-venture-schema-test-${token.replaceAll('-', '').slice(0, 16)}`;
  const image = docker(['image', 'inspect', IMAGE, '--format', '{{.Id}}']);
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  let admin;
  const evidence = { container: name, image, cleanupVerified: false };
  registerCleanup(async () => {
    try { await admin?.end(); } finally { removeContainer(name, token); }
    evidence.cleanupVerified = true;
  });
  docker(['run', '--detach', '--pull=never', '--name', name, '--label', `${LABEL}=${token}`,
    '--memory', '512m', '--cpus', '2', '--tmpfs', '/var/lib/postgresql/data:rw,size=256m',
    '--publish', '127.0.0.1::5432', '--env', `POSTGRES_PASSWORD=${ADMIN_PASSWORD}`, image]);
  const address = docker(['port', name, '5432/tcp']).split(/\r?\n/)[0];
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const common = { host: '127.0.0.1', port: Number(address.split(':')[1]), database: 'postgres',
    connectionTimeoutMillis: 5000 };
  admin = new Pool({ ...common, user: 'postgres', password: ADMIN_PASSWORD, max: 2 });
  await ready(admin);
  await admin.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
  return { admin, appConfig: { ...common, user: APP_ROLE, password: APP_PASSWORD }, evidence };
}

/**
 * @description Give the next round a brand-new public schema owned by the application role, so every
 *   round starts from nothing and nothing a previous round created can hide a race.
 * @param {import('pg').Pool} admin The superuser pool.
 * @returns {Promise<void>}
 */
export async function freshSchema(admin) {
  await admin.query(`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public AUTHORIZATION ${APP_ROLE}`);
}

/**
 * @description Read back, as the superuser, what the bootstrap left in the public schema.
 * @param {import('pg').Pool} admin The superuser pool.
 * @returns {Promise<{ tables: string[], forcedRls: string[], policies: string[], functions: string[], triggers: string[] }>}
 */
export async function inspectSchema(admin) {
  const names = async (sql) => (await admin.query(sql)).rows.map((row) => row.name).sort();
  return {
    tables: await names(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'venture\\_%'`),
    forcedRls: await names(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity`),
    policies: await names(`SELECT polname AS name FROM pg_policy`),
    functions: await names(`SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'`),
    triggers: await names(`SELECT tgname AS name FROM pg_trigger WHERE NOT tgisinternal`),
  };
}

/**
 * @description Name every relation a PostgreSQL lock message cites by OID ("relation 17334 of database 5"),
 *   read before the next round drops the schema, so a failure says which table the two runs fought over.
 * @param {import('pg').Pool} admin The superuser pool.
 * @param {string|null} text An error detail, or null.
 * @returns {Promise<string|null>} The text with each OID followed by its relation name.
 */
export async function nameRelations(admin, text) {
  if (!text) return text;
  let named = text;
  for (const oid of new Set([...text.matchAll(/relation (\d+)/g)].map((match) => match[1]))) {
    const { rows } = await admin.query('SELECT relname FROM pg_class WHERE oid = $1::oid', [oid]);
    if (rows[0]) named = named.replaceAll(`relation ${oid} `, `relation ${oid} (${rows[0].relname}) `);
  }
  return named;
}
