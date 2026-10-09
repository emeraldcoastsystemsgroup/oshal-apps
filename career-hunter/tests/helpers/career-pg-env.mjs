/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Resolve the disposable-PostgreSQL admin URL and the loader's database drivers once for every Career cutover suite, run a Python contract with a scrubbed environment, and refuse to let CI skip what it was provisioned to run.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Document the four exported constants (packageRoot, engineRoot, adminUrl, loaderNodePath) with JSDoc, as the house rule requires for every exported member.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @description The career-hunter package root. Contracts run with it as the working directory and
 * resolve every script they drive (loader, reporter, projector) from it, never from the caller's
 * current directory.
 * @type {string}
 */
export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @description The engine directory, put on PYTHONPATH so a contract imports the package's own
 * `jobhunter` modules rather than any installed copy.
 * @type {string}
 */
export const engineRoot = join(packageRoot, 'engine');

/**
 * @description The ADMIN URL of a throwaway PostgreSQL server (CI's service container, or a local
 * container on a free port). Contracts only use it to create and drop a disposable NOBYPASSRLS
 * role and database; '' means none is configured, so local runs skip and CI fails.
 * @type {string}
 */
export const adminUrl = process.env.CAREER_TEST_POSTGRES_ADMIN_URL || '';

/**
 * @description Find a node_modules directory holding both drivers the loader requires. store-ci
 * installs them under CAREER_LOADER_NODE_PATH; a workstation may point OSHAL_ROOT at a kernel
 * checkout that already has them.
 * @returns {string} The directory to hand the loader as NODE_PATH, or '' when none has both.
 */
function resolveLoaderNodePath() {
  const candidates = [
    process.env.CAREER_LOADER_NODE_PATH,
    process.env.OSHAL_ROOT && join(process.env.OSHAL_ROOT, 'node_modules'),
  ].filter(Boolean);
  return candidates.find((dir) => existsSync(join(dir, 'pg', 'package.json'))
    && existsSync(join(dir, 'better-sqlite3', 'package.json'))) ?? '';
}

/**
 * @description The node_modules directory handed to the SQLite -> PostgreSQL loader as NODE_PATH
 * (it must hold both pg and better-sqlite3), resolved once per process by resolveLoaderNodePath();
 * '' when no candidate has both drivers.
 * @type {string}
 */
export const loaderNodePath = resolveLoaderNodePath();

/**
 * @description The node:test skip value for a suite that needs disposable PostgreSQL (and, when
 * `needsLoader`, the loader's drivers). A local run without them skips with a named reason; CI
 * never reaches this skip because {@link requireProvisionedInCi} fails first.
 * @param {boolean} needsLoader Whether the suite runs scripts/migrate-sqlite-to-postgres.js.
 * @returns {false|string} false to run, or the skip reason.
 */
export function postgresSkip(needsLoader = true) {
  if (!adminUrl) return 'CAREER_TEST_POSTGRES_ADMIN_URL is not available locally';
  if (needsLoader && !loaderNodePath) {
    return 'no node_modules with pg + better-sqlite3 (set CAREER_LOADER_NODE_PATH or OSHAL_ROOT)';
  }
  return false;
}

/**
 * @description CI provisions the database and the drivers; a CI run without them is a broken
 * gate, not a skip.
 * @returns {void}
 */
export function requireProvisionedInCi() {
  if (!process.env.CI) return;
  assert.ok(adminUrl, 'CAREER_TEST_POSTGRES_ADMIN_URL is required in CI');
  assert.ok(loaderNodePath, 'CAREER_LOADER_NODE_PATH (pg + better-sqlite3) is required in CI');
}

/** Variables no contract child may inherit: a stray DATABASE_URL must never reach a live store. */
const SCRUBBED = ['DATABASE_URL', 'CAREER_DATA_ROOT', 'JOBHUNTER_STORE', 'JOBHUNTER_MULTIUSER',
  'JOBHUNTER_DATA', 'JOBHUNTER_DB', 'JOBHUNTER_CORPUS_DB', 'JOBHUNTER_USER_DB', 'OSHAL_USER_SUB',
  'CAREER_REVERSE_SYNC_FAULT'];

/**
 * @description Run one Python contract and return the JSON its final marker line carries.
 * @param {string} script Package-relative contract path.
 * @param {string} marker The `NAME=` prefix of the result line.
 * @param {string[]} [extraArgs] Extra CLI arguments.
 * @param {number} [timeout] Milliseconds before the child is killed.
 * @returns {object} The parsed contract summary.
 */
export function runContract(script, marker, extraArgs = [], timeout = 300_000) {
  const env = { ...process.env, PYTHONPATH: engineRoot, PYTHONIOENCODING: 'utf-8' };
  for (const key of SCRUBBED) delete env[key];
  const result = spawnSync('python', [join(packageRoot, script), '--admin-url', adminUrl,
    '--node-path', loaderNodePath, ...extraArgs], { cwd: packageRoot, encoding: 'utf8', timeout, env });
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const line = result.stdout.split(/\r?\n/).findLast((entry) => entry.startsWith(marker));
  assert.ok(line, result.stdout);
  return JSON.parse(line.slice(marker.length));
}
