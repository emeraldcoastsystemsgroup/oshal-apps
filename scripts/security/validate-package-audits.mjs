#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Add the APP-02 package-audit profile, catalog binding validator, staged install decision, and zero-dependency CI CLI.
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_AUDIT_PROFILE_VERSION = 1;
export const PACKAGE_AUDIT_MODE_COMPATIBLE = 'compatible';
export const PACKAGE_AUDIT_MODE_ENFORCE = 'enforce';
export const UNAUDITED_SOURCE_SHA = '0000000000000000000000000000000000000000';

const RECORD_STATUSES = new Set(['pending', 'passed', 'failed']);
const CONTROL_STATUSES = new Set(['pending', 'passed', 'failed']);
export const PACKAGE_AUDIT_CONTROLS = Object.freeze([
  'manifest',
  'authz',
  'rls',
  'dependencies',
  'installLifecycle',
  'surface',
]);
const RECORD_FIELDS = Object.freeze([
  'profileVersion', 'app', 'version', 'sourceSha', 'status', 'auditedAt', 'controls', 'evidence',
]);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @description Resolve the staged installer posture; unknown values fail closed. */
export function resolvePackageAuditMode(value = process.env.OSHAL_PACKAGE_AUDIT_MODE) {
  const normalized = String(value ?? '').trim().toLowerCase() || PACKAGE_AUDIT_MODE_COMPATIBLE;
  if (normalized !== PACKAGE_AUDIT_MODE_COMPATIBLE && normalized !== PACKAGE_AUDIT_MODE_ENFORCE) {
    throw new Error('OSHAL_PACKAGE_AUDIT_MODE must be compatible or enforce');
  }
  return normalized;
}

/** @description Return whether a value is a strict UTC ISO-8601 audit timestamp. */
function isAuditTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

/** @description Report exact-key drift so profile changes require a new profileVersion. */
function exactKeyProblems(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${label} must be an object`];
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  const added = actual.filter((key) => !wanted.includes(key));
  const missing = wanted.filter((key) => !actual.includes(key));
  const problems = [];
  if (missing.length) problems.push(`${label} is missing ${missing.join(', ')}`);
  if (added.length) problems.push(`${label} has unsupported field(s) ${added.join(', ')}`);
  return problems;
}

/** @description Validate one evidence digest without trusting filenames or executable commands. */
function evidenceProblems(item, index) {
  const label = `evidence[${index}]`;
  const problems = exactKeyProblems(item, ['name', 'sha256'], label);
  if (!item || typeof item !== 'object' || Array.isArray(item)) return problems;
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 160) {
    problems.push(`${label}.name must be a non-empty string of at most 160 characters`);
  }
  if (typeof item.sha256 !== 'string' || !SHA256.test(item.sha256)) {
    problems.push(`${label}.sha256 must be a lowercase 64-character SHA-256 digest`);
  }
  return problems;
}

/**
 * @description Validate the immutable profile-v1 record independently of installer policy.
 * Pending records use the all-zero SHA sentinel because no source has been audited yet; a passed
 * or failed attestation must bind a real 40-character Git object id.
 */
export function packageAuditRecordProblems(record) {
  const problems = exactKeyProblems(record, RECORD_FIELDS, 'audit record');
  if (!record || typeof record !== 'object' || Array.isArray(record)) return problems;
  if (record.profileVersion !== PACKAGE_AUDIT_PROFILE_VERSION) {
    problems.push(`profileVersion must equal ${PACKAGE_AUDIT_PROFILE_VERSION}`);
  }
  if (typeof record.app !== 'string' || !SLUG.test(record.app)) problems.push('app must be a lowercase slug');
  if (typeof record.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(record.version)) {
    problems.push('version must be a semantic version');
  }
  if (typeof record.sourceSha !== 'string' || !SHA1.test(record.sourceSha)) {
    problems.push('sourceSha must be a lowercase 40-character Git SHA');
  }
  if (!RECORD_STATUSES.has(record.status)) problems.push('status must be pending, passed, or failed');

  problems.push(...exactKeyProblems(record.controls, PACKAGE_AUDIT_CONTROLS, 'controls'));
  if (record.controls && typeof record.controls === 'object' && !Array.isArray(record.controls)) {
    for (const control of PACKAGE_AUDIT_CONTROLS) {
      if (!CONTROL_STATUSES.has(record.controls[control])) {
        problems.push(`controls.${control} must be pending, passed, or failed`);
      }
    }
  }

  if (!Array.isArray(record.evidence)) {
    problems.push('evidence must be an array');
  } else {
    record.evidence.forEach((item, index) => problems.push(...evidenceProblems(item, index)));
    const names = record.evidence.map((item) => item?.name).filter((name) => typeof name === 'string');
    if (new Set(names).size !== names.length) problems.push('evidence names must be unique');
  }

  if (record.status === 'pending') {
    if (record.auditedAt !== null) problems.push('pending audit auditedAt must be null');
    if (record.sourceSha !== UNAUDITED_SOURCE_SHA) {
      problems.push(`pending audit sourceSha must use the unaudited sentinel ${UNAUDITED_SOURCE_SHA}`);
    }
  } else {
    if (!isAuditTimestamp(record.auditedAt)) problems.push(`${record.status} audit auditedAt must be a strict UTC timestamp`);
    if (record.sourceSha === UNAUDITED_SOURCE_SHA) problems.push(`${record.status} audit must bind a real sourceSha`);
  }
  if (record.status === 'passed') {
    for (const control of PACKAGE_AUDIT_CONTROLS) {
      if (record.controls?.[control] !== 'passed') problems.push(`passed audit requires controls.${control}=passed`);
    }
    if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
      problems.push('passed audit requires at least one content-addressed evidence item');
    }
  }
  if (record.status === 'failed'
      && !PACKAGE_AUDIT_CONTROLS.some((control) => record.controls?.[control] === 'failed')) {
    problems.push('failed audit requires at least one failed control');
  }
  return [...new Set(problems)];
}

/** @description Validate the marketplace pointer and its exact app/version/source binding. */
export function packageAuditBindingProblems(entry, record) {
  const problems = [];
  const expectedRecord = typeof entry?.name === 'string' ? `audits/${entry.name}.json` : null;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['catalog entry must be an object'];
  if (!entry.audit || typeof entry.audit !== 'object' || Array.isArray(entry.audit)) {
    return ['catalog audit must be an object with record and sourceSha'];
  }
  const auditKeys = Object.keys(entry.audit).sort();
  if (auditKeys.join(',') !== 'record,sourceSha') problems.push('catalog audit supports exactly record and sourceSha');
  if (entry.audit.record !== expectedRecord) problems.push(`catalog audit.record must equal ${expectedRecord}`);
  if (typeof entry.audit.sourceSha !== 'string' || !SHA1.test(entry.audit.sourceSha)) {
    problems.push('catalog audit.sourceSha must be a lowercase 40-character Git SHA');
  }
  if (!record || typeof record !== 'object') return [...problems, 'audit record is unavailable'];
  if (record.app !== entry.name) problems.push('audit app does not match catalog name');
  if (record.version !== entry.version) problems.push('audit version does not match catalog version');
  if (record.sourceSha !== entry.audit.sourceSha) problems.push('audit sourceSha does not match catalog audit.sourceSha');
  return problems;
}

/**
 * @description Make the install-time staged decision. Compatible mode never grants a source pin
 * from an unsafe record; enforce mode denies unless profile, binding, status, controls and evidence
 * all pass. The installer must use returned sourceSha instead of a mutable source.ref.
 */
export function assessPackageAuditForInstall(entry, record, modeValue) {
  const mode = resolvePackageAuditMode(modeValue);
  const reasons = [
    ...packageAuditRecordProblems(record),
    ...packageAuditBindingProblems(entry, record),
  ];
  if (record?.status !== 'passed') reasons.push(`audit status is ${record?.status ?? 'unavailable'}, not passed`);
  const uniqueReasons = [...new Set(reasons)];
  const verified = uniqueReasons.length === 0;
  return {
    mode,
    allowed: mode === PACKAGE_AUDIT_MODE_COMPATIBLE || verified,
    verified,
    sourceSha: verified ? record.sourceSha : null,
    reasons: uniqueReasons,
  };
}

/** @description Resolve only the canonical audits/<app>.json path without symlink indirection. */
function resolveRecordPath(root, entry) {
  const record = entry?.audit?.record;
  if (typeof record !== 'string') return { path: null, problem: 'catalog audit.record must be a string' };
  const full = resolve(root, record);
  const rel = relative(root, full);
  if (isAbsolute(record) || !rel || rel === '..' || rel.startsWith(`..${sep}`)) {
    return { path: null, problem: `catalog audit.record escapes the repository: ${record}` };
  }
  if (!existsSync(full)) return { path: null, problem: `audit record is missing: ${record}` };
  const stat = lstatSync(full);
  if (!stat.isFile() || stat.isSymbolicLink()) return { path: null, problem: `audit record must be a regular file: ${record}` };
  return { path: full, problem: null };
}

/** @description Load and validate every package audit while keeping rollout findings distinct. */
export function validatePackageAuditCatalog(root = ROOT, modeValue) {
  const mode = resolvePackageAuditMode(modeValue);
  const marketplacePath = join(resolve(root), 'marketplace.json');
  const errors = [];
  const warnings = [];
  const records = [];
  let marketplace;
  try {
    marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'));
  } catch (error) {
    return { mode, errors: [`cannot parse marketplace.json: ${error.message}`], warnings, records };
  }
  if (!Array.isArray(marketplace.apps) || marketplace.apps.length === 0) {
    return { mode, errors: ['marketplace.json apps must be a non-empty array'], warnings, records };
  }
  const names = marketplace.apps.map((entry) => entry?.name);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length) errors.push(`marketplace repeats app(s): ${[...new Set(duplicates)].join(', ')}`);

  for (const entry of marketplace.apps) {
    const label = typeof entry?.name === 'string' ? entry.name : '<unnamed>';
    const resolved = resolveRecordPath(resolve(root), entry);
    if (resolved.problem) {
      errors.push(`${label}: ${resolved.problem}`);
      continue;
    }
    let record;
    try {
      const source = readFileSync(resolved.path, 'utf8');
      record = JSON.parse(source);
      if (source !== `${JSON.stringify(record, null, 2)}\n`) errors.push(`${label}: audit record is not canonical two-space JSON`);
    } catch (error) {
      errors.push(`${label}: cannot parse audit record: ${error.message}`);
      continue;
    }
    const structural = [...packageAuditRecordProblems(record), ...packageAuditBindingProblems(entry, record)];
    structural.forEach((problem) => errors.push(`${label}: ${problem}`));
    const decision = assessPackageAuditForInstall(entry, record, mode);
    if (!decision.verified) {
      if (mode === PACKAGE_AUDIT_MODE_ENFORCE) {
        decision.reasons.forEach((reason) => errors.push(`${label}: install policy: ${reason}`));
      } else {
        warnings.push(`${label}: ${record.status ?? 'unavailable'}; compatible rollout does not grant an audited SHA pin`);
      }
    }
    records.push({ entry, record, decision });
  }
  return { mode, errors: [...new Set(errors)], warnings: [...new Set(warnings)], records };
}

/** @description Parse the small dependency-free CLI surface. */
export function parsePackageAuditArgs(argv) {
  const options = { root: ROOT, mode: undefined, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--root requires a path');
      options.root = resolve(value);
    } else if (arg === '--mode') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--mode requires compatible or enforce');
      options.mode = value;
    }
    else if (arg === '--json') options.json = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  options.mode = resolvePackageAuditMode(options.mode);
  return options;
}

/** @description Run the CI/store validation command without mutating audit attestations. */
export function main(argv = process.argv.slice(2)) {
  const options = parsePackageAuditArgs(argv);
  const report = validatePackageAuditCatalog(options.root, options.mode);
  if (options.json) {
    console.log(JSON.stringify({
      mode: report.mode,
      records: report.records.length,
      verified: report.records.filter((item) => item.decision.verified).length,
      warnings: report.warnings,
      errors: report.errors,
    }, null, 2));
  } else {
    if (report.warnings.length) {
      console.warn(`Package audit rollout: ${report.warnings.length} package(s) are not enforceable yet.`);
    }
    if (report.errors.length) {
      console.error(`Package audit validation failed with ${report.errors.length} problem(s):`);
      report.errors.forEach((problem) => console.error(`  - ${problem}`));
    } else {
      const verified = report.records.filter((item) => item.decision.verified).length;
      console.log(`Package audit validation passed: ${report.records.length} records, ${verified} enforceable, mode=${report.mode}`);
    }
  }
  if (report.errors.length) process.exitCode = 1;
  return report;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
