#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Fail SEC-06 on high/critical CodeQL results and require exact, named, expiring exceptions for lower-severity findings.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Validate the complete exception ledger, canonical owner, unique finding keys, real dates, and a one-year maximum review horizon even when no finding uses an entry.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIGH_SECURITY_SCORE = 7;
const EXCEPTION_OWNER = 'maintainer@emeraldcoastsystemsgroup.com';
const MAX_EXCEPTION_DAYS = 366;

/** @description Recursively discover SARIF evidence without accepting an empty analyzer output. */
export function sarifFiles(root) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const name of readdirSync(root)) {
    const candidate = join(root, name);
    if (statSync(candidate).isDirectory()) out.push(...sarifFiles(candidate));
    else if (/\.sarif(?:\.json)?$/i.test(name)) out.push(candidate);
  }
  return out.sort();
}

/** @description Resolve the CodeQL rule metadata referenced by one SARIF result. */
function ruleFor(run, result) {
  const rules = run?.tool?.driver?.rules ?? [];
  if (Number.isInteger(result.ruleIndex)) return rules[result.ruleIndex];
  return rules.find((rule) => rule.id === result.ruleId);
}

/** @description Flatten CodeQL SARIF runs into non-sensitive policy fields. */
export function findingsFromSarif(document) {
  const findings = [];
  for (const run of document.runs ?? []) {
    for (const result of run.results ?? []) {
      const rule = ruleFor(run, result);
      const rawScore = result.properties?.['security-severity'] ?? rule?.properties?.['security-severity'];
      findings.push({
        ruleId: result.ruleId ?? rule?.id ?? '<unknown-rule>',
        path: result.locations?.[0]?.physicalLocation?.artifactLocation?.uri ?? '<no-path>',
        level: result.level ?? 'warning',
        securityScore: Number.isFinite(Number(rawScore)) ? Number(rawScore) : null,
      });
    }
  }
  return findings;
}

/** @description Convert a clock value to its UTC calendar day for deterministic expiry checks. */
function utcDay(value) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

/**
 * @description Validate every exception whether or not a current finding consumes it. Stale or
 * malformed policy must fail the gate rather than wait for a matching scanner result to appear.
 */
export function validateExceptionLedger(document, today = new Date()) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('CodeQL exception ledger must be an object');
  }
  if (document.schemaVersion !== 1) throw new Error('CodeQL exception ledger schemaVersion must be 1');
  if (!Array.isArray(document.exceptions)) throw new Error('CodeQL exception ledger exceptions must be an array');
  if (!(today instanceof Date) || !Number.isFinite(today.getTime())) throw new Error('CodeQL policy clock is invalid');

  const todayDay = utcDay(today);
  const seen = new Set();
  for (const [index, exception] of document.exceptions.entries()) {
    const at = `CodeQL exception ledger exceptions[${index}]`;
    if (!exception || typeof exception !== 'object' || Array.isArray(exception)) throw new Error(`${at} must be an object`);
    for (const field of ['ruleId', 'path', 'owner', 'reason']) {
      if (typeof exception[field] !== 'string' || !exception[field].trim()) throw new Error(`${at}.${field} must be a non-empty string`);
    }
    if (exception.owner !== EXCEPTION_OWNER) throw new Error(`${at}.owner must be ${EXCEPTION_OWNER}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.expires ?? '')) throw new Error(`${at}.expires must be YYYY-MM-DD`);
    const expiryDay = Date.parse(`${exception.expires}T00:00:00.000Z`);
    if (!Number.isFinite(expiryDay) || new Date(expiryDay).toISOString().slice(0, 10) !== exception.expires) {
      throw new Error(`${at}.expires is not a real calendar date`);
    }
    if (expiryDay < todayDay) throw new Error(`${at} expired on ${exception.expires}`);
    if (expiryDay - todayDay > MAX_EXCEPTION_DAYS * 24 * 60 * 60 * 1000) {
      throw new Error(`${at}.expires exceeds the ${MAX_EXCEPTION_DAYS}-day review horizon`);
    }
    const key = `${exception.ruleId}\0${exception.path}`;
    if (seen.has(key)) throw new Error(`${at} duplicates ${exception.ruleId} at ${exception.path}`);
    seen.add(key);
  }
  return document.exceptions;
}

/** @description Apply the no-high-findings and expiring-lower-exception policy. */
export function evaluateFindings(findings, exceptionDocument, today = new Date()) {
  const exceptions = validateExceptionLedger(exceptionDocument, today);
  const blockers = [];
  for (const finding of findings) {
    const high = finding.level === 'error'
      || (finding.securityScore !== null && finding.securityScore >= HIGH_SECURITY_SCORE);
    const exception = exceptions.find((entry) => entry.ruleId === finding.ruleId && entry.path === finding.path);
    if (high) blockers.push({ ...finding, reason: 'high-or-critical' });
    else if (!exception) blockers.push({ ...finding, reason: 'missing-expiring-exception' });
  }
  return blockers;
}

/** @description Run the fail-closed SARIF gate without printing snippets or secret-like values. */
export function main(argv = process.argv.slice(2)) {
  const sarifRoot = resolve(argv[0] ?? 'codeql-results');
  const exceptionPath = resolve(argv[1] ?? 'scripts/security/codeql-exceptions.json');
  const files = sarifFiles(sarifRoot);
  if (files.length === 0) throw new Error(`CodeQL produced no SARIF files under ${sarifRoot}`);
  if (!existsSync(exceptionPath)) throw new Error(`CodeQL exception ledger is missing: ${exceptionPath}`);
  const findings = files.flatMap((file) => findingsFromSarif(JSON.parse(readFileSync(file, 'utf8'))));
  const ledger = JSON.parse(readFileSync(exceptionPath, 'utf8'));
  const blockers = evaluateFindings(findings, ledger);
  for (const finding of blockers) console.error(`${finding.reason}: ${finding.ruleId} at ${finding.path}`);
  if (blockers.length > 0) throw new Error(`${blockers.length} CodeQL finding(s) violate SEC-06`);
  console.log(`CodeQL policy passed: ${files.length} SARIF file(s), ${findings.length} finding(s)`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
