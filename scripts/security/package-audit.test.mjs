/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Add mutation-resistant APP-02 profile, binding, staged-policy, and real 47-record catalog coverage.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PACKAGE_AUDIT_CONTROLS,
  UNAUDITED_SOURCE_SHA,
  assessPackageAuditForInstall,
  packageAuditBindingProblems,
  packageAuditRecordProblems,
  parsePackageAuditArgs,
  resolvePackageAuditMode,
  validatePackageAuditCatalog,
} from './validate-package-audits.mjs';

const SOURCE_SHA = '1234567890abcdef1234567890abcdef12345678';
const EVIDENCE_SHA = 'a'.repeat(64);

function controls(status = 'passed') {
  return Object.fromEntries(PACKAGE_AUDIT_CONTROLS.map((name) => [name, status]));
}

function passedRecord(overrides = {}) {
  return {
    profileVersion: 1,
    app: 'sample-app',
    version: '1.2.3',
    sourceSha: SOURCE_SHA,
    status: 'passed',
    auditedAt: '2026-08-06T05:00:00.000Z',
    controls: controls(),
    evidence: [{ name: 'package-security-tests.tap', sha256: EVIDENCE_SHA }],
    ...overrides,
  };
}

function entry(overrides = {}) {
  return {
    name: 'sample-app',
    version: '1.2.3',
    source: { type: 'git-subdir', url: 'https://example.test/store', path: 'sample-app', ref: 'main' },
    audit: { record: 'audits/sample-app.json', sourceSha: SOURCE_SHA },
    ...overrides,
  };
}

function writeFixture(root, catalogEntry = entry(), record = passedRecord(), canonical = true) {
  mkdirSync(join(root, 'audits'), { recursive: true });
  writeFileSync(join(root, 'marketplace.json'), `${JSON.stringify({ version: 1, apps: [catalogEntry] }, null, 2)}\n`);
  const serialized = canonical ? `${JSON.stringify(record, null, 2)}\n` : JSON.stringify(record);
  writeFileSync(join(root, 'audits', 'sample-app.json'), serialized);
}

test('mode defaults compatible and rejects unknown rollout values', () => {
  assert.equal(resolvePackageAuditMode(''), 'compatible');
  assert.equal(resolvePackageAuditMode('ENFORCE'), 'enforce');
  assert.throws(() => resolvePackageAuditMode('warn'), /compatible or enforce/);
  assert.deepEqual(parsePackageAuditArgs(['--root', '.', '--mode', 'compatible', '--json']).mode, 'compatible');
  assert.throws(() => parsePackageAuditArgs(['--root']), /requires a path/);
  assert.throws(() => parsePackageAuditArgs(['--mode']), /requires compatible or enforce/);
  assert.throws(() => parsePackageAuditArgs(['--surprise']), /unknown argument/);
});

test('profile v1 accepts an evidenced pass and rejects status laundering mutations', () => {
  assert.deepEqual(packageAuditRecordProblems(passedRecord()), []);
  assert.match(packageAuditRecordProblems(passedRecord({ evidence: [] })).join('\n'), /requires at least one/);
  assert.match(packageAuditRecordProblems(passedRecord({ controls: controls('pending') })).join('\n'), /requires controls\.manifest=passed/);
  assert.match(packageAuditRecordProblems(passedRecord({ sourceSha: UNAUDITED_SOURCE_SHA })).join('\n'), /bind a real sourceSha/);
  assert.match(packageAuditRecordProblems(passedRecord({ auditedAt: 'yesterday' })).join('\n'), /strict UTC timestamp/);
  assert.match(packageAuditRecordProblems(passedRecord({ unexpectedApproval: true })).join('\n'), /unsupported field/);
});

test('pending means no attestation: null time and the explicit unaudited SHA sentinel', () => {
  const pending = passedRecord({
    sourceSha: UNAUDITED_SOURCE_SHA,
    status: 'pending',
    auditedAt: null,
    controls: controls('pending'),
    evidence: [],
  });
  assert.deepEqual(packageAuditRecordProblems(pending), []);
  assert.match(packageAuditRecordProblems({ ...pending, sourceSha: SOURCE_SHA }).join('\n'), /unaudited sentinel/);
  assert.match(packageAuditRecordProblems({ ...pending, auditedAt: '2026-08-06T05:00:00.000Z' }).join('\n'), /must be null/);
});

test('binding rejects name, version, record path, and SHA substitutions', () => {
  assert.deepEqual(packageAuditBindingProblems(entry(), passedRecord()), []);
  assert.match(packageAuditBindingProblems(entry({ version: '9.9.9' }), passedRecord()).join('\n'), /version/);
  assert.match(packageAuditBindingProblems(entry({ audit: { record: 'audits/other.json', sourceSha: SOURCE_SHA } }), passedRecord()).join('\n'), /record/);
  assert.match(packageAuditBindingProblems(entry({ audit: { record: 'audits/sample-app.json', sourceSha: 'b'.repeat(40) } }), passedRecord()).join('\n'), /sourceSha/);
  assert.match(packageAuditBindingProblems(entry(), passedRecord({ app: 'other-app' })).join('\n'), /app/);
});

test('compatible mode preserves rollout but never returns an unsafe SHA pin', () => {
  const failed = passedRecord({ status: 'failed', controls: { ...controls(), authz: 'failed' } });
  const compatible = assessPackageAuditForInstall(entry(), failed, 'compatible');
  assert.equal(compatible.allowed, true);
  assert.equal(compatible.verified, false);
  assert.equal(compatible.sourceSha, null);
  assert.match(compatible.reasons.join('\n'), /not passed/);
});

test('a catalog/record SHA substitution warns in compatible mode and blocks enforce mode', () => {
  const mismatchedEntry = entry({
    audit: { record: 'audits/sample-app.json', sourceSha: 'b'.repeat(40) },
  });
  const compatible = assessPackageAuditForInstall(mismatchedEntry, passedRecord(), 'compatible');
  assert.equal(compatible.allowed, true);
  assert.equal(compatible.sourceSha, null);
  assert.match(compatible.reasons.join('\n'), /sourceSha does not match/);
  const enforced = assessPackageAuditForInstall(mismatchedEntry, passedRecord(), 'enforce');
  assert.equal(enforced.allowed, false);
  assert.equal(enforced.sourceSha, null);
});

test('enforce mode fails closed and a verified pass returns only the audited SHA', () => {
  const good = assessPackageAuditForInstall(entry(), passedRecord(), 'enforce');
  assert.deepEqual(good, { mode: 'enforce', allowed: true, verified: true, sourceSha: SOURCE_SHA, reasons: [] });
  const pendingRecord = passedRecord({
    sourceSha: UNAUDITED_SOURCE_SHA,
    status: 'pending',
    auditedAt: null,
    controls: controls('pending'),
    evidence: [],
  });
  const pendingEntry = entry({ audit: { record: 'audits/sample-app.json', sourceSha: UNAUDITED_SOURCE_SHA } });
  const denied = assessPackageAuditForInstall(pendingEntry, pendingRecord, 'enforce');
  assert.equal(denied.allowed, false);
  assert.equal(denied.sourceSha, null);
  assert.match(denied.reasons.join('\n'), /pending, not passed/);
});

test('catalog validation mutation-tests missing, noncanonical, and mismatched records', () => {
  const root = mkdtempSync(join(tmpdir(), 'oshal-package-audit-'));
  try {
    writeFixture(root);
    assert.deepEqual(validatePackageAuditCatalog(root, 'enforce').errors, []);

    writeFixture(root, entry(), passedRecord(), false);
    assert.match(validatePackageAuditCatalog(root, 'enforce').errors.join('\n'), /not canonical/);

    writeFixture(root, entry({ audit: { record: 'audits/sample-app.json', sourceSha: 'b'.repeat(40) } }));
    assert.match(validatePackageAuditCatalog(root, 'compatible').errors.join('\n'), /does not match/);

    writeFileSync(join(root, 'marketplace.json'), `${JSON.stringify({ apps: [entry({ audit: { record: '../escape.json', sourceSha: SOURCE_SHA } })] })}\n`);
    assert.match(validatePackageAuditCatalog(root, 'compatible').errors.join('\n'), /must equal audits\/sample-app\.json|escapes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the real store has one canonical truthfully pending record per catalog app', () => {
  const report = validatePackageAuditCatalog(process.cwd(), 'compatible');
  assert.deepEqual(report.errors, []);
  assert.equal(report.records.length, 47);
  assert.equal(report.records.filter(({ record }) => record.status === 'pending').length, 47);
  assert.equal(report.records.filter(({ decision }) => decision.verified).length, 0);
  assert.equal(report.warnings.length, 47);
});

test('the real pending store cannot accidentally claim enforce readiness', () => {
  const report = validatePackageAuditCatalog(process.cwd(), 'enforce');
  assert.equal(report.records.length, 47);
  assert.ok(report.errors.length >= 47);
  assert.ok(report.records.every(({ decision }) => decision.allowed === false));
});
