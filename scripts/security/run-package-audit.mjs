#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Backlog #33: the reproducible package-audit runner. It extracts one exact committed SHA with `git archive` (no worktree, the checkout is never touched), runs the seven controls from package-audit-controls.mjs against that tree, and turns each into a canonical evidence document with no timestamps or durations. `--write` publishes the evidence under audits/evidence/<app>/<sha>/, the record and the catalog binding together; `--verify` re-runs every control over the recorded SHA and fails unless each document is byte-identical and still hashes to the recorded digest. The audit record's maintainer workflow used to say only "preserve the actual outputs".
 *
 * Usage:
 *   node scripts/security/run-package-audit.mjs <app> --sha <40-hex> [--framework <core checkout>] [--write] [--json]
 *   node scripts/security/run-package-audit.mjs <app> --verify [--framework <core checkout>] [--json]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PACKAGE_AUDIT_CONTROLS,
  PACKAGE_AUDIT_EVIDENCE_NAMES,
  auditEvidenceDigest,
  auditEvidencePath,
  canonicalAuditJson,
} from './validate-package-audits.mjs';
import { PACKAGE_AUDIT_CONTROL_RUNNERS, removeRunDirectory } from './package-audit-controls.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHA1 = /^[0-9a-f]{40}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** @description Run Git in the store checkout and return trimmed stdout, throwing on failure. */
function git(root, args, options = {}) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: options.encoding ?? 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${String(result.stderr).trim().split('\n')[0]}`);
  return options.encoding === 'buffer' ? result.stdout : String(result.stdout).trim();
}

/**
 * @description Extract the whole store at one commit into a fresh directory via `git archive`.
 * @param {string} root - Store checkout that contains the commit.
 * @param {string} sha - Exact 40-character commit.
 * @param {string} destination - Empty directory to extract into.
 * @returns {void}
 */
export function extractCommit(root, sha, destination) {
  const archive = git(root, ['archive', '--format=tar', sha], { encoding: 'buffer' });
  mkdirSync(destination, { recursive: true });
  const tar = spawnSync('tar', ['-xf', '-'], { cwd: destination, input: archive, maxBuffer: 64 * 1024 * 1024 });
  if (tar.status !== 0) throw new Error(`tar could not extract ${sha}: ${String(tar.stderr).trim()}`);
}

/** @description Resolve a framework (core) checkout the controls need for validate/install/surfaces. */
export function resolveFramework(explicit, env = process.env) {
  const candidates = [explicit, env.OSHAL_CORE_DIR, env.OSHAL_FRAMEWORK_ROOT, env.OSHAL_CORE_ROOT, resolve(ROOT, '..', 'oshal')].filter(Boolean);
  const found = candidates.map((candidate) => resolve(candidate))
    .find((candidate) => existsSync(join(candidate, 'scripts', 'oshal-app.js')) && existsSync(join(candidate, 'node_modules', 'js-yaml')));
  if (!found) throw new Error('no framework checkout with scripts/oshal-app.js and node_modules; pass --framework <core checkout>');
  return found;
}

/**
 * @description Turn one control's checks into its canonical evidence document.
 * @param {object} ctx - Run context (app, sha, dir, packageTree, entry).
 * @param {string} name - Evidence name.
 * @param {object[]} checks - Named checks the control produced.
 * @returns {object} The evidence document.
 */
export function evidenceDocument(ctx, name, checks) {
  return {
    profileVersion: 1, app: ctx.app, version: ctx.entry.version, sourceSha: ctx.sha, sourcePath: ctx.dir,
    packageTree: ctx.packageTree, control: name,
    result: checks.length && checks.every((item) => item.result === 'passed') ? 'passed' : 'failed',
    checks,
  };
}

/**
 * @description Assemble the profile-v1 record from the seven evidence documents. The goldenPath
 * document has no control of its own; runPackageAudit already folds a failed golden path into the
 * authz document, so every control status here is exactly what its evidence says.
 * @param {object} ctx - Run context.
 * @param {Map<string,{document:object,text:string}>} evidence - Evidence by name.
 * @param {string} auditedAt - Strict UTC timestamp of this audit.
 * @returns {object} The audit record.
 */
export function auditRecord(ctx, evidence, auditedAt) {
  const controls = Object.fromEntries(PACKAGE_AUDIT_CONTROLS.map((name) => [name, evidence.get(name).document.result]));
  const passed = PACKAGE_AUDIT_CONTROLS.every((name) => controls[name] === 'passed')
    && evidence.get('goldenPath').document.result === 'passed';
  return {
    profileVersion: 1, app: ctx.app, version: ctx.entry.version, sourceSha: ctx.sha, status: passed ? 'passed' : 'failed', auditedAt,
    controls, evidence: PACKAGE_AUDIT_EVIDENCE_NAMES.map((name) => ({ name, sha256: auditEvidenceDigest(evidence.get(name).text) })),
  };
}

/** @description Build the run context for one package at one commit. */
function runContext(options, tmp) {
  const tree = join(tmp, 'source');
  extractCommit(options.root, options.sha, tree);
  const catalog = JSON.parse(readFileSync(join(tree, 'marketplace.json'), 'utf8'));
  const entries = catalog.apps.filter((app) => app?.name === options.app);
  if (entries.length !== 1) throw new Error(`marketplace.json at ${options.sha} must list exactly one ${options.app}`);
  const entry = entries[0];
  const dir = entry.source?.path;
  if (typeof dir !== 'string' || !dir.split('/').every((part) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(part))) {
    throw new Error(`${options.app}: catalog source.path must be a confined package directory`);
  }
  const parseYaml = options.parseYaml ?? ((text) => createRequire(join(options.framework, 'package.json'))('js-yaml').load(text));
  return {
    app: options.app, sha: options.sha, root: options.root, tree, tmp, entry, dir, pkgDir: join(tree, ...dir.split('/')),
    framework: options.framework, packageTree: git(options.root, ['rev-parse', `${options.sha}:${dir}`]),
    parseYaml, memo: {},
  };
}

/**
 * @description Run every control for one package at one commit and return canonical evidence.
 * The extracted tree lives in a private temporary directory that is always removed.
 * @param {{root:string, app:string, sha:string, framework:string, runners?:object}} options - Run inputs.
 * @returns {Promise<{ctx:object, evidence:Map<string,{document:object,text:string}>}>} Evidence by name.
 */
export async function runPackageAudit(options) {
  if (!SLUG.test(options.app)) throw new Error(`invalid package name: ${options.app}`);
  if (!SHA1.test(options.sha)) throw new Error('--sha must be a full 40-character commit');
  git(options.root, ['cat-file', '-e', `${options.sha}^{commit}`]);
  const runners = options.runners ?? PACKAGE_AUDIT_CONTROL_RUNNERS;
  const tmp = mkdtempSync(join(tmpdir(), 'oshal-package-audit-'));
  try {
    const ctx = runContext(options, tmp);
    const documents = new Map();
    for (const name of PACKAGE_AUDIT_EVIDENCE_NAMES) {
      let checks;
      try { checks = await runners[name](ctx); } catch (error) { checks = [{ name: 'control-error', result: 'failed', problems: [String(error.message).split('\n')[0]] }]; }
      documents.set(name, evidenceDocument(ctx, name, checks));
    }
    const golden = documents.get('goldenPath');
    const authz = documents.get('authz');
    if (golden.result !== 'passed' && authz.result === 'passed') {
      authz.checks = [...authz.checks, { name: 'golden-path', result: 'failed', problems: ['the goldenPath evidence failed'] }];
      authz.result = 'failed';
    }
    const evidence = new Map([...documents].map(([name, document]) => [name, { document, text: canonicalAuditJson(document) }]));
    const summary = { app: ctx.app, sha: ctx.sha, entry: ctx.entry, dir: ctx.dir, packageTree: ctx.packageTree };
    return { ctx: summary, evidence };
  } finally {
    removeRunDirectory(tmp);
  }
}

/** @description Publish evidence, record and catalog binding together; drops this app's older evidence. */
export function writeAudit(root, result, auditedAt = new Date().toISOString()) {
  const { ctx, evidence } = result;
  const catalogPath = join(root, 'marketplace.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const entry = catalog.apps.find((app) => app?.name === ctx.app);
  if (!entry) throw new Error(`${ctx.app} is not in the working-tree marketplace.json`);
  if (entry.version !== ctx.entry.version) throw new Error(`${ctx.app}: catalog version ${entry.version} is not the audited version ${ctx.entry.version}; audit the commit that carries it`);
  const appEvidence = join(root, 'audits', 'evidence', ctx.app);
  if (existsSync(appEvidence)) {
    for (const old of readdirSync(appEvidence)) if (old !== ctx.sha) rmSync(join(appEvidence, old), { recursive: true, force: true });
  }
  for (const [name, { text }] of evidence) {
    const full = join(root, ...auditEvidencePath(ctx.app, ctx.sha, name).split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  const record = auditRecord(ctx, evidence, auditedAt);
  writeFileSync(join(root, 'audits', `${ctx.app}.json`), `${JSON.stringify(record, null, 2)}\n`);
  entry.audit = { record: `audits/${ctx.app}.json`, sourceSha: ctx.sha };
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  return record;
}

/**
 * @description Compare a fresh run with the committed evidence and record, byte for byte.
 * @param {string} root - Store checkout root.
 * @param {object} record - The committed audit record.
 * @param {Map<string,{text:string}>} evidence - Freshly produced evidence.
 * @returns {string[]} Every mismatch; empty when the audit reproduces exactly.
 */
export function verifyAudit(root, record, evidence) {
  const problems = [];
  for (const name of PACKAGE_AUDIT_EVIDENCE_NAMES) {
    const recorded = (record.evidence ?? []).find((item) => item.name === name);
    const fresh = evidence.get(name)?.text;
    const full = join(root, ...auditEvidencePath(record.app, record.sourceSha, name).split('/'));
    const committed = existsSync(full) ? readFileSync(full, 'utf8').replace(/\r\n/g, '\n') : null;
    if (!recorded) problems.push(`${name}: the record names no such evidence`);
    else if (auditEvidenceDigest(fresh) !== recorded.sha256) problems.push(`${name}: the re-run does not hash to the recorded sha256`);
    if (committed === null) problems.push(`${name}: committed evidence file is missing`);
    else if (committed !== fresh) problems.push(`${name}: the re-run differs from the committed evidence bytes`);
  }
  return problems;
}

/** @description Parse the runner's command line. */
export function parseRunnerArgs(argv) {
  const options = { app: '', sha: '', framework: '', write: false, verify: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--sha' || arg === '--framework') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = value;
    } else if (arg === '--write') options.write = true;
    else if (arg === '--verify') options.verify = true;
    else if (arg === '--json') options.json = true;
    else if (!arg.startsWith('--') && !options.app) options.app = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.app) throw new Error('Usage: run-package-audit.mjs <app> (--sha <40-hex> [--write] | --verify) [--framework <core>] [--json]');
  if (options.write && options.verify) throw new Error('--write and --verify are exclusive');
  if (!options.verify && !options.sha) throw new Error('--sha is required unless --verify reads it from the record');
  return options;
}

/** @description Print a run summary without the evidence bodies. */
function report(options, result, extra) {
  const controls = Object.fromEntries([...result.evidence].map(([name, { document }]) => [name, document.result]));
  const summary = { app: result.ctx.app, sourceSha: result.ctx.sha, packageTree: result.ctx.packageTree, controls, ...extra };
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`Package audit ${summary.app}@${summary.sourceSha.slice(0, 12)}: ${Object.entries(controls).map(([name, value]) => `${name}=${value}`).join(' ')}`);
    for (const [name, { document }] of result.evidence) {
      for (const item of document.checks) for (const problem of item.problems ?? []) console.log(`  ${name}/${item.name}: ${problem}`);
    }
  }
}

/** @description CLI entry: audit, publish, or reproduce one package audit. */
export async function main(argv = process.argv.slice(2)) {
  const options = parseRunnerArgs(argv);
  const framework = resolveFramework(options.framework);
  let record = null;
  if (options.verify) {
    record = JSON.parse(readFileSync(join(ROOT, 'audits', `${options.app}.json`), 'utf8'));
    if (options.sha && options.sha !== record.sourceSha) throw new Error(`--sha ${options.sha} is not the recorded sourceSha ${record.sourceSha}`);
    options.sha = record.sourceSha;
  }
  const result = await runPackageAudit({ root: ROOT, app: options.app, sha: options.sha, framework });
  if (options.verify) {
    const problems = verifyAudit(ROOT, record, result.evidence);
    report(options, result, { verify: problems.length ? 'failed' : 'reproduced', problems });
    if (problems.length) process.exitCode = 1;
    return;
  }
  const written = options.write ? writeAudit(ROOT, result) : null;
  report(options, result, { status: written?.status ?? 'not-written' });
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
