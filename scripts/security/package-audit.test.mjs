/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Add mutation-resistant APP-02 profile, binding, staged-policy, and real 47-record catalog coverage.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Ledger to the real 53-app catalog (was 48): every record still truthfully pending, none verified, and enforce mode still refuses all 53.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Ledger to the real 54-app catalog: the Create launcher lands with a truthfully pending record like every other package.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Ledger to the real 55-app catalog: Scan to Print lands with a truthfully pending record like every other package.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Ledger to the real 56-app catalog: CAD Studio lands with a truthfully pending record like every other package.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Retain both published Embodied and CAD Studio entries in the complete pending-audit ledger.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Ledger to the real 60-app catalog: Circuit Lab, Drone Relay and Animatronics each landed a truthfully pending record without bumping this count, so the suite has been red since 7380e96; every other assertion was already true of the 60 records.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Stop hand-typing the catalog size (backlog #33). The count asserted 61 against a 65-app catalog, so this suite was red again for the same reason entry 7 fixed: the expected record count is now read from marketplace.json, and the real-store cases assert what must hold for ANY size - one record per app, every non-passed record unverified, every passed record verified and allowed in enforce mode, every other record denied there. Adds the evidence contract's mutation family over a real Git store: a changed evidence byte, a missing evidence name, a missing evidence file, a source change after the audit, a version bump without re-audit, evidence that disagrees with the record, non-canonical evidence, evidence describing another tree and a checkout without the audited commit each go red.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PACKAGE_AUDIT_CONTROLS,
  PACKAGE_AUDIT_EVIDENCE_NAMES,
  UNAUDITED_SOURCE_SHA,
  assessPackageAuditForInstall,
  auditEvidenceDigest,
  auditEvidencePath,
  canonicalAuditJson,
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

function evidenceNames() {
  return PACKAGE_AUDIT_EVIDENCE_NAMES.map((name) => ({ name, sha256: EVIDENCE_SHA }));
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
    evidence: evidenceNames(),
    ...overrides,
  };
}

function pendingRecord(overrides = {}) {
  return passedRecord({
    sourceSha: UNAUDITED_SOURCE_SHA, status: 'pending', auditedAt: null, controls: controls('pending'), evidence: [], ...overrides,
  });
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

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commit(root, message) {
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.name=oshal tests', '-c', 'user.email=maintainer@emeraldcoastsystemsgroup.com', 'commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function writeJson(root, relativePath, value) {
  const full = join(root, ...relativePath.split('/'));
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`);
}

function writeCatalog(root, catalogEntry, record) {
  writeJson(root, 'marketplace.json', { version: 1, apps: [catalogEntry] });
  writeJson(root, 'audits/sample-app.json', record);
}

function evidenceDocument(name, sourceSha, packageTree, result = 'passed', version = '1.2.3') {
  return {
    profileVersion: 1, app: 'sample-app', version, sourceSha, sourcePath: 'sample-app', packageTree,
    control: name, result, checks: [{ name: `${name}-check`, result, problems: [] }],
  };
}

/** Write canonical evidence for every name and return the record items that bind it. */
function writeEvidence(root, sourceSha, packageTree, overrides = {}) {
  return PACKAGE_AUDIT_EVIDENCE_NAMES.map((name) => {
    const text = canonicalAuditJson(overrides[name] ?? evidenceDocument(name, sourceSha, packageTree));
    const full = join(root, ...auditEvidencePath('sample-app', sourceSha, name).split('/'));
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
    return { name, sha256: auditEvidenceDigest(text) };
  });
}

/** A real Git store: package committed as the audited SHA, then its attestation published after it. */
function auditedStore() {
  const root = mkdtempSync(join(tmpdir(), 'oshal-package-audit-git-'));
  git(root, ['init', '-q', '-b', 'main']);
  mkdirSync(join(root, 'sample-app'));
  writeFileSync(join(root, 'sample-app', 'oshal-app.yaml'), 'name: sample-app\nversion: 1.2.3\n');
  writeCatalog(root, entry({ audit: { record: 'audits/sample-app.json', sourceSha: UNAUDITED_SOURCE_SHA } }), pendingRecord());
  const auditedSha = commit(root, 'package candidate');
  const packageTree = git(root, ['rev-parse', `${auditedSha}:sample-app`]);
  const evidence = writeEvidence(root, auditedSha, packageTree);
  const record = passedRecord({ sourceSha: auditedSha, evidence });
  writeCatalog(root, entry({ audit: { record: 'audits/sample-app.json', sourceSha: auditedSha } }), record);
  commit(root, 'publish the attestation');
  return { root, auditedSha, packageTree, record };
}

function errorsOf(root, mode = 'enforce') {
  return validatePackageAuditCatalog(root, mode).errors.join('\n');
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
  assert.match(packageAuditRecordProblems(passedRecord({ evidence: [] })).join('\n'), /evidence is missing manifest/);
  assert.match(packageAuditRecordProblems(passedRecord({ controls: controls('pending') })).join('\n'), /requires controls\.manifest=passed/);
  assert.match(packageAuditRecordProblems(passedRecord({ sourceSha: UNAUDITED_SOURCE_SHA })).join('\n'), /bind a real sourceSha/);
  assert.match(packageAuditRecordProblems(passedRecord({ auditedAt: 'yesterday' })).join('\n'), /strict UTC timestamp/);
  assert.match(packageAuditRecordProblems(passedRecord({ unexpectedApproval: true })).join('\n'), /unsupported field/);
});

test('an attestation names exactly the seven evidence documents, including goldenPath', () => {
  assert.deepEqual([...PACKAGE_AUDIT_EVIDENCE_NAMES], [...PACKAGE_AUDIT_CONTROLS, 'goldenPath']);
  const withoutGolden = evidenceNames().filter((item) => item.name !== 'goldenPath');
  assert.match(packageAuditRecordProblems(passedRecord({ evidence: withoutGolden })).join('\n'), /evidence is missing goldenPath/);
  const extra = [...evidenceNames(), { name: 'security-tests.tap', sha256: EVIDENCE_SHA }];
  assert.match(packageAuditRecordProblems(passedRecord({ evidence: extra })).join('\n'), /unsupported item\(s\) security-tests\.tap/);
  const failed = passedRecord({ status: 'failed', controls: { ...controls(), rls: 'failed' }, evidence: withoutGolden });
  assert.match(packageAuditRecordProblems(failed).join('\n'), /failed audit evidence is missing goldenPath/);
});

test('pending means no attestation: null time, the explicit unaudited SHA sentinel and no evidence', () => {
  const pending = pendingRecord();
  assert.deepEqual(packageAuditRecordProblems(pending), []);
  assert.match(packageAuditRecordProblems({ ...pending, sourceSha: SOURCE_SHA }).join('\n'), /unaudited sentinel/);
  assert.match(packageAuditRecordProblems({ ...pending, auditedAt: '2026-08-06T05:00:00.000Z' }).join('\n'), /must be null/);
  assert.match(packageAuditRecordProblems({ ...pending, evidence: evidenceNames() }).join('\n'), /pending audit evidence must be empty/);
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
  const pendingEntry = entry({ audit: { record: 'audits/sample-app.json', sourceSha: UNAUDITED_SOURCE_SHA } });
  const denied = assessPackageAuditForInstall(pendingEntry, pendingRecord(), 'enforce');
  assert.equal(denied.allowed, false);
  assert.equal(denied.sourceSha, null);
  assert.match(denied.reasons.join('\n'), /pending, not passed/);
  const withEvidenceProblem = assessPackageAuditForInstall(entry(), passedRecord(), 'enforce', ['evidence x bytes do not match']);
  assert.equal(withEvidenceProblem.allowed, false);
  assert.equal(withEvidenceProblem.sourceSha, null);
});

test('catalog validation mutation-tests missing, noncanonical, and mismatched records', () => {
  const root = mkdtempSync(join(tmpdir(), 'oshal-package-audit-'));
  try {
    const pendingEntry = entry({ audit: { record: 'audits/sample-app.json', sourceSha: UNAUDITED_SOURCE_SHA } });
    writeCatalog(root, pendingEntry, pendingRecord());
    assert.deepEqual(validatePackageAuditCatalog(root, 'compatible').errors, []);

    writeFileSync(join(root, 'audits', 'sample-app.json'), JSON.stringify(pendingRecord()));
    assert.match(validatePackageAuditCatalog(root, 'compatible').errors.join('\n'), /not canonical/);

    writeCatalog(root, entry({ audit: { record: 'audits/sample-app.json', sourceSha: 'b'.repeat(40) } }), pendingRecord());
    assert.match(validatePackageAuditCatalog(root, 'compatible').errors.join('\n'), /does not match/);

    writeFileSync(join(root, 'marketplace.json'), `${JSON.stringify({ apps: [entry({ audit: { record: '../escape.json', sourceSha: SOURCE_SHA } })] })}\n`);
    assert.match(validatePackageAuditCatalog(root, 'compatible').errors.join('\n'), /must equal audits\/sample-app\.json|escapes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an evidenced, current attestation in a real Git store verifies in enforce mode', () => {
  const { root, auditedSha } = auditedStore();
  try {
    const report = validatePackageAuditCatalog(root, 'enforce');
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.records.map(({ decision }) => [decision.verified, decision.sourceSha]), [[true, auditedSha]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('evidence mutations each go red: changed byte, missing name, missing file, disagreement, non-canonical bytes', () => {
  const { root, auditedSha, packageTree, record } = auditedStore();
  const golden = join(root, ...auditEvidencePath('sample-app', auditedSha, 'goldenPath').split('/'));
  const original = readFileSync(golden, 'utf8');
  const restore = () => { writeFileSync(golden, original); writeJson(root, 'audits/sample-app.json', record); };
  try {
    writeFileSync(golden, original.replace('goldenPath-check', 'goldenPath-chock'));
    assert.match(errorsOf(root), /evidence goldenPath bytes do not match the recorded sha256; re-audit required/);
    restore();

    writeJson(root, 'audits/sample-app.json', { ...record, evidence: record.evidence.filter((item) => item.name !== 'goldenPath') });
    assert.match(errorsOf(root, 'compatible'), /passed audit evidence is missing goldenPath/);
    restore();

    unlinkSync(golden);
    assert.match(errorsOf(root, 'compatible'), /evidence goldenPath: audits\/evidence\/sample-app\/[0-9a-f]{40}\/goldenPath\.json is missing/);
    restore();

    const failing = writeEvidence(root, auditedSha, packageTree, { authz: evidenceDocument('authz', auditedSha, packageTree, 'failed') });
    writeJson(root, 'audits/sample-app.json', { ...record, evidence: failing });
    assert.match(errorsOf(root, 'compatible'), /controls\.authz=passed disagrees with evidence authz \(failed\)/);
    writeEvidence(root, auditedSha, packageTree);
    restore();

    const loose = `${JSON.stringify(JSON.parse(original))}\n`;
    writeFileSync(golden, loose);
    writeJson(root, 'audits/sample-app.json', { ...record, evidence: record.evidence.map((item) => (item.name === 'goldenPath' ? { ...item, sha256: auditEvidenceDigest(loose) } : item)) });
    assert.match(errorsOf(root, 'compatible'), /evidence goldenPath is not canonical audit JSON/);
    restore();
    assert.deepEqual(validatePackageAuditCatalog(root, 'enforce').errors, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a source change after the audit makes the passed record stale in every mode', () => {
  const { root } = auditedStore();
  try {
    writeFileSync(join(root, 'sample-app', 'route.js'), 'module.exports = () => {};\n');
    commit(root, 'change the package after its audit');
    assert.match(errorsOf(root, 'compatible'), /package source sample-app changed since the audit .*re-audit required/);
    const report = validatePackageAuditCatalog(root, 'enforce');
    assert.equal(report.records[0].decision.allowed, false);
    assert.equal(report.records[0].decision.sourceSha, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a version bump without a re-audit fails even when catalog and record are bumped together', () => {
  const { root, record } = auditedStore();
  try {
    writeFileSync(join(root, 'sample-app', 'oshal-app.yaml'), 'name: sample-app\nversion: 1.2.4\n');
    writeCatalog(root, entry({ version: '1.2.4', audit: { record: 'audits/sample-app.json', sourceSha: record.sourceSha } }), { ...record, version: '1.2.4' });
    commit(root, 'bump the version without auditing it');
    const errors = errorsOf(root, 'compatible');
    assert.match(errors, /changed since the audit/);
    assert.match(errors, /evidence manifest version does not match the audit record/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('evidence describing another tree, and a checkout without the audited commit, are refused', () => {
  const { root, auditedSha, packageTree, record } = auditedStore();
  try {
    const forged = writeEvidence(root, auditedSha, 'f'.repeat(40));
    writeJson(root, 'audits/sample-app.json', { ...record, evidence: forged });
    assert.match(errorsOf(root, 'compatible'), /evidence does not describe the audited source tree/);
    writeEvidence(root, auditedSha, packageTree);
    writeJson(root, 'audits/sample-app.json', record);
    assert.deepEqual(validatePackageAuditCatalog(root, 'enforce').errors, []);
    rmSync(join(root, '.git'), { recursive: true, force: true });
    assert.match(errorsOf(root, 'compatible'), /is not the top level of a Git checkout containing it; audit currency cannot be verified/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the real store has one canonical record per catalog app, and only evidenced current passes verify', () => {
  const catalog = JSON.parse(readFileSync('marketplace.json', 'utf8'));
  const appCount = catalog.apps.length;
  const report = validatePackageAuditCatalog(process.cwd(), 'compatible');
  assert.deepEqual(report.errors, []);
  assert.equal(report.records.length, appCount);
  const passed = report.records.filter(({ record }) => record.status === 'passed');
  assert.ok(passed.every(({ decision }) => decision.verified), 'every published pass re-hashes and is current');
  assert.equal(report.records.filter(({ decision }) => decision.verified).length, passed.length);
  assert.equal(report.warnings.length, appCount - passed.length);
});

test('the real store in enforce mode denies every record that is not an evidenced current pass', () => {
  const catalog = JSON.parse(readFileSync('marketplace.json', 'utf8'));
  const report = validatePackageAuditCatalog(process.cwd(), 'enforce');
  assert.equal(report.records.length, catalog.apps.length);
  for (const { record, decision } of report.records) {
    assert.equal(decision.allowed, record.status === 'passed', `${record.app} enforce decision`);
  }
  const unverified = report.records.filter(({ decision }) => !decision.verified).length;
  assert.ok(report.errors.length >= unverified);
});
