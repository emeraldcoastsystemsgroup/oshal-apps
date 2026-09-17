#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the trading package's Vitest specs from a gate, with the live-database refusal in force. This is the package that places real orders with the operator's money and it had 17 spec files that NO gate executed: `grep -rn "trading" .github/workflows/` returned nothing and scripts/security/framework-coupled.vitest.config.mjs includes only lora/tests and vids/tests, so two guards that landed on 2026-09-16 would never have run on a push. The specs need a framework checkout (their @/ alias, plus express/js-yaml/acorn), which the bare-checkout package jobs do not have, so the run is wrapped here rather than typed into the workflow: one command both gates call, that fails closed on the three ways this kind of step lies - a DSN that can reach the operator's LIVE trading database, a run that reports green having executed nothing, and a missing framework checkout silently turning the whole thing into a skip.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The live stack's published Postgres ports, word-bounded so 155433 and 554330 are not hits. The
 * local deployment publishes 127.0.0.1 on this pair — the first is oshal-local-db, the operator's
 * REAL trading database, where a bare spec run once created and dropped schema and wrote order
 * rows. This is the only place in this repository the forbidden literal is written down.
 */
const LIVE_PORTS = /(^|[^0-9])5543[34]([^0-9]|$)/;
/** The same two servers named rather than addressed, but only where the name is a database TARGET. */
const LIVE_DB_HOST = /(@|\/\/|host\s*[:=]\s*.?)oshal-local-(db|tsdb)([^A-Za-z0-9-]|$)/;
/** The silent-default shape wearing a container name: `process.env.X || 'oshal-local-db'`. */
const LIVE_DB_FALLBACK = /process\.env\.[A-Za-z_][A-Za-z0-9_]*\s*(\|\||\?\?)\s*.?oshal-local-(db|tsdb)([^A-Za-z0-9-]|$)/;
/** Hosts that mean "this machine", where the published live-stack ports are reachable. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', 'host.docker.internal']);
/** Environment variables that can point a pg client somewhere without any code saying so. */
const PG_ENV = ['DATABASE_URL', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSERVICE', 'PGURL'];
/**
 * What the child gets instead. Not merely "unset": an unset DATABASE_URL is how a fallback goes
 * unnoticed, so the child is pointed at a port nothing can ever listen on. Anything that tries to
 * connect fails loudly, naming this, rather than finding the deployment.
 */
const REFUSING_DSN = 'postgres://refused:refused@127.0.0.1:1/oshal_spec_must_not_reach_a_live_database';

/**
 * @description Every file in a spec directory, recursively.
 * @param {string} directory Directory to walk.
 * @returns {string[]} Absolute file paths, sorted.
 */
function filesUnder(directory) {
  const out = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * @description Refuse a spec tree that names the operator's live databases as a connection target.
 *   A spec creates and destroys rows, so the address may not appear in one at all — this is the
 *   store-side half of core's scripts/ci/check-spec-database-default.sh, which judges core's own
 *   tests/ and src/ trees and has never looked at this repository.
 * @param {string} specDir Directory holding the package's specs.
 * @returns {{files:number,hits:string[]}} How many files were read, and every violating line.
 * @throws When the directory is absent or holds no files — a gate that looked at nothing must say
 *   so rather than report clean.
 */
export function refuseLiveDatabaseLiterals(specDir) {
  if (!existsSync(specDir) || !statSync(specDir).isDirectory()) {
    throw new Error(`live-database refusal: UNCHECKED — no spec directory at ${specDir}`);
  }
  const files = filesUnder(specDir);
  if (files.length === 0) throw new Error(`live-database refusal: UNCHECKED — ${specDir} holds no files`);
  const hits = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const rule = LIVE_PORTS.test(line) ? 'published live-stack Postgres port'
        : LIVE_DB_HOST.test(line) ? 'the live database named as a connection host'
          : LIVE_DB_FALLBACK.test(line) ? 'an environment fallback to the live database container' : '';
      if (rule) hits.push(`${file.slice(ROOT.length + 1)}:${index + 1}: ${rule}\n    ${line.trim().slice(0, 160)}`);
    });
  }
  return { files: files.length, hits };
}

/**
 * @description Refuse to start when the caller's own environment already points a pg client at the
 *   live stack. Unsetting it silently would hide the mistake; this names the variable and stops.
 * @param {Record<string,string|undefined>} env The environment to judge.
 * @returns {string[]} One message per variable that reaches the live stack; empty when clean.
 */
export function refuseLiveDatabaseEnvironment(env) {
  const problems = [];
  for (const name of PG_ENV) {
    const value = env[name];
    if (!value) continue;
    if (name === 'PGPORT' && LIVE_PORTS.test(value)) problems.push(`${name}=${value} is a published live-stack Postgres port`);
    if (name === 'PGHOST' && LIVE_DB_HOST.test(`//${value}`)) problems.push(`${name}=${value} is a live database container`);
    if (!/^[a-z]+:\/\//i.test(value)) continue;
    let url;
    try { url = new URL(value); } catch { continue; }
    if (LOOPBACK.has(url.hostname) && LIVE_PORTS.test(url.port)) problems.push(`${name} points at 127.0.0.1:${url.port}, the LIVE stack's Postgres`);
    else if (LIVE_DB_HOST.test(`//${url.hostname}`)) problems.push(`${name} points at the ${url.hostname} container`);
  }
  return problems;
}

/**
 * @description The environment the specs run in: the caller's, minus every way a pg client could
 *   find a database on its own, plus a DSN that can never connect to anything.
 * @param {Record<string,string|undefined>} env The caller's environment.
 * @param {string} framework Absolute path to the framework checkout.
 * @returns {Record<string,string>} The child environment.
 */
export function specEnvironment(env, framework) {
  const child = { ...env };
  for (const name of PG_ENV) delete child[name];
  // A node:test child that inherits this reports to its parent over a side channel and exits 0 even
  // when cases fail; every verdict below is read from an exit code.
  delete child.NODE_TEST_CONTEXT;
  child.DATABASE_URL = REFUSING_DSN;
  child.OSHAL_FRAMEWORK = framework;
  return child;
}

/**
 * @description Read Vitest's JSON summary and refuse anything that is not a real, non-empty verdict.
 * @param {string} file Path the JSON reporter was told to write.
 * @param {number|null} status The runner's exit status.
 * @returns {{ok:boolean,detail:string}} The graded outcome.
 */
export function gradeRun(file, status) {
  if (!existsSync(file)) {
    return { ok: false, detail: `no JSON summary was written (exit ${status}) — the run produced no verdict` };
  }
  let report;
  try { report = JSON.parse(readFileSync(file, 'utf8')); } catch (error) {
    return { ok: false, detail: `the JSON summary is unreadable: ${error.message}` };
  }
  const total = Number(report.numTotalTests ?? 0);
  const failed = Number(report.numFailedTests ?? 0);
  const passed = Number(report.numPassedTests ?? 0);
  // ZERO is the vacuous pass this repository has already shipped twice: an include pattern that
  // matches nothing, a renamed directory, a config that resolved somewhere else. It is a failure.
  if (total === 0) return { ok: false, detail: 'ZERO tests ran — a spec set that matches nothing is not a green gate' };
  if (failed > 0 || status !== 0) return { ok: false, detail: `${failed} failing of ${total} (exit ${status})` };
  return { ok: true, detail: `${passed} passed of ${total}` };
}

/**
 * @description Resolve the framework checkout whose Vitest runs the specs.
 * @param {Record<string,string|undefined>} env The caller's environment.
 * @returns {string} Absolute path to the checkout.
 * @throws When it is unset or carries no Vitest — a missing prerequisite must be a failure here,
 *   never a skip that reads as green.
 */
export function resolveFramework(env) {
  const raw = env.OSHAL_FRAMEWORK || env.OSHAL_CORE_DIR || env.OSHAL_ROOT;
  if (!raw) {
    throw new Error('OSHAL_FRAMEWORK is not set. These specs resolve @/ and express/js-yaml/acorn from '
      + 'a framework checkout; without one they cannot run, and a run that cannot happen is not a pass.');
  }
  const framework = resolve(raw);
  if (!existsSync(join(framework, 'node_modules', 'vitest', 'vitest.mjs'))) {
    throw new Error(`OSHAL_FRAMEWORK=${framework} has no node_modules/vitest — run its install first.`);
  }
  return framework;
}

/** @description Run one package's Vitest specs under the live-database refusal, and grade the run. */
export function runPackageSpecs({ packageDir = 'trading', env = process.env, log = console.log } = {}) {
  const pkg = resolve(ROOT, packageDir);
  const config = join(pkg, 'vitest.config.mjs');
  if (!existsSync(config)) throw new Error(`${packageDir}: no vitest.config.mjs — nothing here says what to run`);

  const scan = refuseLiveDatabaseLiterals(join(pkg, 'tests'));
  if (scan.hits.length) {
    throw new Error(`A ${packageDir} spec names the operator's LIVE database (${scan.hits.length} line(s)).\n  `
      + `${scan.hits.join('\n  ')}\n  Point it at a DISPOSABLE PostgreSQL on any other port instead.`);
  }
  const inherited = refuseLiveDatabaseEnvironment(env);
  if (inherited.length) {
    throw new Error(`Refusing to run: the environment already points at the live stack.\n  ${inherited.join('\n  ')}\n`
      + '  These specs would inherit it. Unset it, or point it at a disposable PostgreSQL.');
  }
  log(`live-database refusal: ${scan.files} spec file(s) read, no live target; the run is pinned to a DSN that cannot connect`);

  const framework = resolveFramework(env);
  const out = mkdtempSync(join(tmpdir(), 'oshal-spec-'));
  const summary = join(out, 'summary.json');
  try {
    const result = spawnSync(process.execPath, [
      join(framework, 'node_modules', 'vitest', 'vitest.mjs'), 'run',
      '--config', config, '--reporter=default', '--reporter=json', `--outputFile.json=${summary}`,
    ], { cwd: pkg, stdio: 'inherit', env: specEnvironment(env, framework) });
    if (result.error) throw result.error;
    const graded = gradeRun(summary, result.status);
    log(`${packageDir} specs: ${graded.detail}`);
    if (!graded.ok) throw new Error(`${packageDir} specs FAILED — ${graded.detail}`);
    return graded;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf('--package');
  try {
    runPackageSpecs({ packageDir: flag >= 0 ? process.argv[flag + 1] : 'trading' });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
