#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Add the APP-02 package-audit profile, catalog binding validator, staged install decision, and zero-dependency CI CLI.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Evidence contract (backlog #33): a passed or failed record names exactly seven evidence items (the six controls plus goldenPath) whose canonical bytes live at audits/evidence/<app>/<sourceSha>/<name>.json and are re-hashed here; their content must agree with the record; and a passed record is stale (re-audit required) when the package tree at HEAD differs from the tree at sourceSha. A digest used to be a claim nobody recomputed, and a source change after an audit left the record looking current. Profile version stays 1: the record shape is unchanged, only what a record must prove.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
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
/** The seven evidence documents an attestation carries: one per control plus the golden path. */
export const PACKAGE_AUDIT_EVIDENCE_NAMES = Object.freeze([...PACKAGE_AUDIT_CONTROLS, 'goldenPath']);
const RECORD_FIELDS = Object.freeze([
  'profileVersion', 'app', 'version', 'sourceSha', 'status', 'auditedAt', 'controls', 'evidence',
]);
const EVIDENCE_DOCUMENT_FIELDS = Object.freeze([
  'profileVersion', 'app', 'version', 'sourceSha', 'sourcePath', 'packageTree', 'control', 'result', 'checks',
]);
const EVIDENCE_RESULTS = new Set(['passed', 'failed']);
const MAX_EVIDENCE_BYTES = 1024 * 1024;
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SOURCE_PATH_PART = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @description Serialize a value as canonical audit JSON: object keys sorted at every depth,
 * two-space indentation, LF line endings and one trailing newline. Evidence carries no timestamps
 * or durations, so re-running a control over the same source reproduces these exact bytes.
 * @param {unknown} value - JSON-compatible value.
 * @returns {string} The canonical text.
 */
export function canonicalAuditJson(value) {
  const sortDeep = (item) => {
    if (Array.isArray(item)) return item.map(sortDeep);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, sortDeep(item[key])]));
  };
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}

/**
 * @description SHA-256 of evidence text after folding CRLF to LF. Canonical JSON never contains a
 * carriage return, so the fold only undoes a Windows checkout's line-ending conversion.
 * @param {string} text - Evidence file text.
 * @returns {string} Lowercase hex digest.
 */
export function auditEvidenceDigest(text) {
  return createHash('sha256').update(String(text).replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/**
 * @description Repository-relative location of one evidence document.
 * @param {string} app - Package slug.
 * @param {string} sourceSha - Audited 40-character commit.
 * @param {string} name - One of PACKAGE_AUDIT_EVIDENCE_NAMES.
 * @returns {string} POSIX path under audits/evidence/.
 */
export function auditEvidencePath(app, sourceSha, name) {
  return `audits/evidence/${app}/${sourceSha}/${name}.json`;
}

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
 * @description An attestation (passed or failed) names exactly the seven evidence documents; a
 * pending record attests nothing and so carries no evidence at all.
 */
function evidenceSetProblems(record) {
  if (!Array.isArray(record.evidence)) return [];
  const names = record.evidence.map((item) => item?.name);
  if (record.status === 'pending') return names.length ? ['pending audit evidence must be empty'] : [];
  if (record.status !== 'passed' && record.status !== 'failed') return [];
  const missing = PACKAGE_AUDIT_EVIDENCE_NAMES.filter((name) => !names.includes(name));
  const extra = names.filter((name) => !PACKAGE_AUDIT_EVIDENCE_NAMES.includes(name));
  const problems = [];
  if (missing.length) problems.push(`${record.status} audit evidence is missing ${missing.join(', ')}`);
  if (extra.length) problems.push(`${record.status} audit evidence names unsupported item(s) ${extra.join(', ')}`);
  return problems;
}

/** @description Validate the exact six-control map and all control values. */
function controlProblems(record) {
  const problems = exactKeyProblems(record.controls, PACKAGE_AUDIT_CONTROLS, 'controls');
  if (!record.controls || typeof record.controls !== 'object' || Array.isArray(record.controls)) return problems;
  for (const control of PACKAGE_AUDIT_CONTROLS) {
    if (!CONTROL_STATUSES.has(record.controls[control])) {
      problems.push(`controls.${control} must be pending, passed, or failed`);
    }
  }
  return problems;
}

/** @description Validate timestamp, sentinel, and status/control coherence. */
function statusProblems(record) {
  const problems = [];
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
  }
  if (record.status === 'failed'
      && !PACKAGE_AUDIT_CONTROLS.some((control) => record.controls?.[control] === 'failed')) {
    problems.push('failed audit requires at least one failed control');
  }
  return problems;
}

/**
 * @description Validate the immutable profile-v1 record independently of installer policy.
 * Pending records use the all-zero SHA sentinel because no source has been audited yet; a passed
 * or failed attestation must bind a real 40-character Git object id and name the seven evidence
 * documents.
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
  problems.push(...controlProblems(record));
  if (!Array.isArray(record.evidence)) {
    problems.push('evidence must be an array');
  } else {
    record.evidence.forEach((item, index) => problems.push(...evidenceProblems(item, index)));
    const names = record.evidence.map((item) => item?.name).filter((name) => typeof name === 'string');
    if (new Set(names).size !== names.length) problems.push('evidence names must be unique');
  }
  problems.push(...evidenceSetProblems(record), ...statusProblems(record));
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
 * @param {unknown} entry - Marketplace entry.
 * @param {unknown} record - Parsed audit record.
 * @param {unknown} modeValue - Requested rollout mode.
 * @param {string[]} extraProblems - Evidence and source-currency problems found on disk/in Git.
 * @returns {{mode:string,allowed:boolean,verified:boolean,sourceSha:string|null,reasons:string[]}}
 */
export function assessPackageAuditForInstall(entry, record, modeValue, extraProblems = []) {
  const mode = resolvePackageAuditMode(modeValue);
  const reasons = [
    ...packageAuditRecordProblems(record),
    ...packageAuditBindingProblems(entry, record),
    ...extraProblems,
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

/** @description Return the problem with a real, non-symlinked directory at root/<parts...>. */
function realDirectoryProblem(root, parts) {
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    if (!existsSync(current)) return `${relative(root, current).split(sep).join('/')} is missing`;
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return `${relative(root, current).split(sep).join('/')} must be a regular directory`;
    }
  }
  return null;
}

/** @description Read one evidence document's bytes from its fixed, confined location. */
function readEvidenceText(root, record, name) {
  const location = auditEvidencePath(record.app, record.sourceSha, name);
  const directoryProblem = realDirectoryProblem(root, ['audits', 'evidence', record.app, record.sourceSha]);
  if (directoryProblem) return { problem: `evidence ${name}: ${directoryProblem}` };
  const full = join(root, ...location.split('/'));
  if (!existsSync(full)) return { problem: `evidence ${name}: ${location} is missing` };
  const stat = lstatSync(full);
  if (!stat.isFile() || stat.isSymbolicLink()) return { problem: `evidence ${name}: ${location} must be a regular file` };
  if (stat.size > MAX_EVIDENCE_BYTES) return { problem: `evidence ${name}: ${location} exceeds ${MAX_EVIDENCE_BYTES} bytes` };
  return { text: readFileSync(full, 'utf8') };
}

/** @description Check one parsed evidence document against its record and catalog entry. */
function evidenceDocumentProblems(document, name, record, entry) {
  const label = `evidence ${name}`;
  const problems = exactKeyProblems(document, EVIDENCE_DOCUMENT_FIELDS, label);
  if (!document || typeof document !== 'object' || Array.isArray(document)) return problems;
  if (document.profileVersion !== PACKAGE_AUDIT_PROFILE_VERSION) problems.push(`${label} profileVersion must equal ${PACKAGE_AUDIT_PROFILE_VERSION}`);
  for (const key of ['app', 'version', 'sourceSha']) {
    if (document[key] !== record[key]) problems.push(`${label} ${key} does not match the audit record`);
  }
  if (document.sourcePath !== entry?.source?.path) problems.push(`${label} sourcePath does not match catalog source.path`);
  if (typeof document.packageTree !== 'string' || !SHA1.test(document.packageTree)) problems.push(`${label} packageTree must be a Git tree id`);
  if (document.control !== name) problems.push(`${label} control must equal ${name}`);
  if (!EVIDENCE_RESULTS.has(document.result)) problems.push(`${label} result must be passed or failed`);
  const checks = Array.isArray(document.checks) ? document.checks : [];
  if (!checks.length || checks.some((check) => typeof check?.name !== 'string' || !EVIDENCE_RESULTS.has(check?.result))) {
    problems.push(`${label} checks must be a non-empty list of named passed/failed checks`);
  } else {
    const expected = checks.every((check) => check.result === 'passed') ? 'passed' : 'failed';
    if (document.result !== expected) problems.push(`${label} result ${document.result} disagrees with its checks (${expected})`);
  }
  return problems;
}

/** @description The record's control statuses must be exactly what the evidence documents say. */
function controlAgreementProblems(record, documents) {
  const problems = [];
  for (const control of PACKAGE_AUDIT_CONTROLS) {
    const result = documents.get(control)?.result;
    if (result && record.controls?.[control] !== result) {
      problems.push(`controls.${control}=${record.controls?.[control]} disagrees with evidence ${control} (${result})`);
    }
  }
  const golden = documents.get('goldenPath')?.result;
  if (golden && golden !== 'passed' && record.controls?.authz === 'passed') {
    problems.push('controls.authz=passed requires a passed goldenPath evidence document');
  }
  return problems;
}

/**
 * @description Re-hash and read every evidence document an attestation names. The bytes must hash
 * to the recorded digest, be canonical audit JSON, describe this app/version/sourceSha/control,
 * and agree with the record's control statuses. Pending records attest nothing and are skipped.
 * @param {string} root - Store checkout root.
 * @param {object} entry - Marketplace entry.
 * @param {object} record - Parsed audit record.
 * @returns {{problems:string[], documents:Map<string,object>}} Problems and the parsed documents.
 */
export function packageAuditEvidenceProblems(root, entry, record) {
  const documents = new Map();
  if (!record || (record.status !== 'passed' && record.status !== 'failed') || !Array.isArray(record.evidence)) {
    return { problems: [], documents };
  }
  if (!SLUG.test(String(record.app)) || !SHA1.test(String(record.sourceSha))) {
    return { problems: ['evidence cannot be located without a valid app and sourceSha'], documents };
  }
  const problems = [];
  for (const item of record.evidence) {
    if (!PACKAGE_AUDIT_EVIDENCE_NAMES.includes(item?.name)) continue;
    const { text, problem } = readEvidenceText(resolve(root), record, item.name);
    if (problem) { problems.push(problem); continue; }
    if (auditEvidenceDigest(text) !== item.sha256) {
      problems.push(`evidence ${item.name} bytes do not match the recorded sha256; re-audit required`);
      continue;
    }
    let document;
    try { document = JSON.parse(text); } catch (error) { problems.push(`evidence ${item.name} is not JSON: ${error.message}`); continue; }
    if (text.replace(/\r\n/g, '\n') !== canonicalAuditJson(document)) problems.push(`evidence ${item.name} is not canonical audit JSON`);
    problems.push(...evidenceDocumentProblems(document, item.name, record, entry));
    documents.set(item.name, document);
  }
  problems.push(...controlAgreementProblems(record, documents));
  return { problems: [...new Set(problems)], documents };
}

/** @description Run one read-only Git query in the store checkout. */
function gitOutput(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * @description True only when root is itself the top level of a Git checkout. Without this, Git
 * would walk up from a plain directory into whatever repository encloses it and answer for that one.
 */
function isCheckoutTopLevel(root) {
  try {
    const normalize = (value) => {
      const real = realpathSync.native(resolve(value));
      return process.platform === 'win32' ? real.toLowerCase() : real;
    };
    return normalize(gitOutput(root, ['rev-parse', '--show-toplevel'])) === normalize(root);
  } catch {
    return false;
  }
}

/**
 * @description A passed record is current only while the package tree at HEAD is the tree that was
 * audited. Any source change after the audit (including a manifest version bump) makes the record
 * stale, and the evidence must describe exactly the audited tree.
 * @param {string} root - Store checkout root (a Git checkout containing sourceSha).
 * @param {object} entry - Marketplace entry.
 * @param {object} record - Parsed audit record.
 * @param {Map<string,object>} documents - Parsed evidence documents.
 * @returns {string[]} Staleness problems; empty for a current record or a non-passed one.
 */
export function packageAuditSourceProblems(root, entry, record, documents = new Map()) {
  if (record?.status !== 'passed' || !SHA1.test(String(record.sourceSha))) return [];
  const sourcePath = entry?.source?.path;
  if (typeof sourcePath !== 'string' || !sourcePath.split('/').every((part) => SOURCE_PATH_PART.test(part))) {
    return ['catalog source.path must be a confined package directory to verify audit currency'];
  }
  const unverifiable = `audited source ${record.sourceSha} (${sourcePath}): the store root is not the top level of a Git checkout containing it; audit currency cannot be verified`;
  if (!isCheckoutTopLevel(root)) return [unverifiable];
  let auditedTree;
  let headTree;
  try {
    gitOutput(root, ['cat-file', '-e', `${record.sourceSha}^{commit}`]);
    auditedTree = gitOutput(root, ['rev-parse', `${record.sourceSha}:${sourcePath}`]);
  } catch {
    return [unverifiable];
  }
  try {
    headTree = gitOutput(root, ['rev-parse', `HEAD:${sourcePath}`]);
  } catch {
    return [`HEAD has no ${sourcePath} tree; re-audit required`];
  }
  const problems = [];
  if (headTree !== auditedTree) {
    problems.push(`package source ${sourcePath} changed since the audit (HEAD tree ${headTree}, audited tree ${auditedTree}); re-audit required`);
  }
  const described = new Set([...documents.values()].map((document) => document?.packageTree));
  if (described.size && (described.size !== 1 || !described.has(auditedTree))) {
    problems.push('evidence does not describe the audited source tree; re-audit required');
  }
  return problems;
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

/** @description Load one catalog entry's record and every structural, evidence and currency problem. */
function assessCatalogEntry(root, entry, mode) {
  const resolved = resolveRecordPath(root, entry);
  if (resolved.problem) return { fatal: resolved.problem };
  let record;
  const problems = [];
  try {
    const source = readFileSync(resolved.path, 'utf8');
    record = JSON.parse(source);
    if (source !== `${JSON.stringify(record, null, 2)}\n`) problems.push('audit record is not canonical two-space JSON');
  } catch (error) {
    return { fatal: `cannot parse audit record: ${error.message}` };
  }
  problems.push(...packageAuditRecordProblems(record), ...packageAuditBindingProblems(entry, record));
  const evidence = packageAuditEvidenceProblems(root, entry, record);
  const currency = packageAuditSourceProblems(root, entry, record, evidence.documents);
  problems.push(...evidence.problems, ...currency);
  const decision = assessPackageAuditForInstall(entry, record, mode, [...evidence.problems, ...currency]);
  return { record, decision, problems: [...new Set(problems)] };
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
    const assessed = assessCatalogEntry(resolve(root), entry, mode);
    if (assessed.fatal) {
      errors.push(`${label}: ${assessed.fatal}`);
      continue;
    }
    const { record, decision } = assessed;
    assessed.problems.forEach((problem) => errors.push(`${label}: ${problem}`));
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
