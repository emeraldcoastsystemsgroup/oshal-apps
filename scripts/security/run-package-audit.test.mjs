/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Backlog #33: the reproducible package-audit runner over a real Git store. It extracts the exact commit, removes its run directory, writes canonical evidence plus the record and binding that the validator then verifies in enforce mode, folds a failed golden path into authz, captures a crashing control as a failure, refuses a catalog version it did not audit, and --verify catches a changed evidence byte or a changed outcome. The golden-path, rls and TAP pieces run real node:test children. Framework-free on purpose: YAML is parsed as JSON here, so this suite runs where no core checkout exists.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Refuse missing or duplicate experience surface reports and incomplete desktop, phone and second-theme coverage.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKAGE_AUDIT_EVIDENCE_NAMES, UNAUDITED_SOURCE_SHA, auditEvidencePath, validatePackageAuditCatalog } from './validate-package-audits.mjs';
import { check, goldenPathControl, parseTapOutcomes, relativize, rlsControl, surfaceCoverageProblems } from './package-audit-controls.mjs';
import { auditRecord, parseRunnerArgs, runPackageAudit, verifyAudit, writeAudit } from './run-package-audit.mjs';
import { resetSnapshotAttestations } from './snapshot-audit-reset.mjs';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

test('surface evidence must cover every declared entry and every standard variant exactly once', () => {
  const report = { path: '/api/sample/app', variants: ['desktop-daylight', 'desktop-ocean', 'mobile-ocean'] };
  assert.deepEqual(surfaceCoverageProblems([report.path], [report]), []);
  assert.match(surfaceCoverageProblems([report.path], []).join('\n'), /exactly one/);
  assert.match(surfaceCoverageProblems([report.path], [report, report]).join('\n'), /exactly one/);
  assert.match(surfaceCoverageProblems([report.path], [{ ...report, variants: ['desktop-ocean'] }]).join('\n'), /incomplete/);
  assert.match(surfaceCoverageProblems([report.path], [report, { ...report, path: '/unexpected' }]).join('\n'), /undeclared/);
  assert.match(surfaceCoverageProblems([report.path, '/second'], [report]).join('\n'), /second.*exactly one/);
});

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

/** A store with one package whose golden path is a real node:test file. */
function fixtureStore({ failingTest = false, version = '1.0.0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oshal-runner-store-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'core.autocrlf', 'false']);
  mkdirSync(join(root, 'sample-app', 'tests'), { recursive: true });
  writeFileSync(join(root, 'sample-app', 'oshal-app.yaml'), `name: sample-app\nversion: ${version}\n`);
  writeFileSync(join(root, 'sample-app', 'tests', 'golden.test.js'), [
    "const test = require('node:test');", "const assert = require('node:assert');",
    `test('the golden path answers', () => assert.equal(1 + 1, ${failingTest ? 3 : 2}));`, '',
  ].join('\n'));
  writeJson(root, 'sample-app/tests/test-lab.yaml', { version: 1, cases: [
    { id: 'golden', runner: { kind: 'node-test', scope: 'package', files: ['tests/golden.test.js'] }, prerequisites: ['runner:node-test'] },
    { id: 'live-only', runner: { kind: 'smoke', smoke: 'ready' }, prerequisites: [] },
  ] });
  writeJson(root, 'marketplace.json', { version: 1, apps: [{
    name: 'sample-app', version, source: { type: 'git-subdir', url: 'https://example.test/store', path: 'sample-app', ref: 'main' },
    audit: { record: 'audits/sample-app.json', sourceSha: UNAUDITED_SOURCE_SHA },
  }] });
  writeJson(root, 'audits/sample-app.json', {
    profileVersion: 1, app: 'sample-app', version, sourceSha: UNAUDITED_SOURCE_SHA, status: 'pending', auditedAt: null,
    controls: { manifest: 'pending', authz: 'pending', rls: 'pending', dependencies: 'pending', installLifecycle: 'pending', surface: 'pending' },
    evidence: [],
  });
  return { root, sha: commit(root, 'package candidate') };
}

/** Controls that pass, except where a test overrides one; goldenPath is the real control. */
function runners(overrides = {}, seen = []) {
  const pass = (label) => async (ctx) => { seen.push(ctx.tmp); return [check(label, [])]; };
  return {
    manifest: pass('manifest-check'), authz: pass('authz-check'), rls: pass('rls-check'), dependencies: pass('dependencies-check'),
    installLifecycle: pass('lifecycle-check'), surface: pass('surface-check'), goldenPath: goldenPathControl, ...overrides,
  };
}

function audit(root, sha, overrides, seen) {
  return runPackageAudit({ root, app: 'sample-app', sha, framework: root, parseYaml: JSON.parse, runners: runners(overrides, seen) });
}

test('TAP outcomes keep names and results, never timings', () => {
  const tap = [
    'TAP version 13', '# Subtest: outer', '    # Subtest: inner', '    ok 1 - inner', '      ---', '      duration_ms: 1.2', '      ...',
    'ok 1 - outer', '# Subtest: broken', 'not ok 2 - broken', 'ok 3 - later # SKIP not today',
  ].join('\n');
  assert.deepEqual(parseTapOutcomes(tap), [
    { name: 'outer > inner', result: 'passed' }, { name: 'outer', result: 'passed' },
    { name: 'broken', result: 'failed' }, { name: 'later', result: 'skipped' },
  ]);
  assert.deepEqual(check('x', ['b', 'a', 'b']), { name: 'x', result: 'failed', problems: ['a', 'b'] });
  assert.equal(relativize('/tmp/run/x and \\tmp\\run\\y', { tmp: '/tmp/run' }), '<run>/x and <run>\\y');
});

test('the runner audits an exact commit, removes its run directory, and publishes what the validator verifies', async () => {
  const { root, sha } = fixtureStore();
  try {
    const seen = [];
    const result = await audit(root, sha, {}, seen);
    assert.ok(seen.length > 0 && seen.every((dir) => !existsSync(dir)), 'run directory removed');
    assert.deepEqual([...result.evidence.keys()], [...PACKAGE_AUDIT_EVIDENCE_NAMES]);
    const golden = result.evidence.get('goldenPath').document;
    assert.equal(golden.packageTree, git(root, ['rev-parse', `${sha}:sample-app`]));
    assert.deepEqual(golden.checks.find((item) => item.name === 'case:golden').tests, [{ name: 'the golden path answers', result: 'passed' }]);
    assert.deepEqual(golden.checks.find((item) => item.name === 'offline-cases').notRun, ['live-only']);
    const record = writeAudit(root, result, '2026-09-28T00:00:00.000Z');
    assert.equal(record.status, 'passed');
    commit(root, 'publish the attestation');
    const report = validatePackageAuditCatalog(root, 'enforce');
    assert.deepEqual(report.errors, []);
    assert.equal(report.records[0].decision.sourceSha, sha);

    const again = await audit(root, sha);
    assert.deepEqual(verifyAudit(root, record, again.evidence), [], 'a re-run reproduces every byte');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--verify fails on a changed evidence byte and on a changed control outcome', async () => {
  const { root, sha } = fixtureStore();
  try {
    const record = writeAudit(root, await audit(root, sha), '2026-09-28T00:00:00.000Z');
    const fresh = await audit(root, sha);
    const surface = join(root, ...auditEvidencePath('sample-app', sha, 'surface').split('/'));
    writeFileSync(surface, readFileSync(surface, 'utf8').replace('surface-check', 'surface-chock'));
    assert.match(verifyAudit(root, record, fresh.evidence).join('\n'), /surface: the re-run differs from the committed evidence bytes/);
    writeFileSync(surface, fresh.evidence.get('surface').text);
    const changed = await audit(root, sha, { rls: async () => [check('rls-check', ['a new finding'])] });
    assert.match(verifyAudit(root, record, changed.evidence).join('\n'), /rls: the re-run does not hash to the recorded sha256/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a failed golden path fails authz, a crashing control fails, and the record says failed', async () => {
  const { root, sha } = fixtureStore({ failingTest: true });
  try {
    const result = await audit(root, sha, { dependencies: async () => { throw new Error('checker crashed'); } });
    assert.equal(result.evidence.get('goldenPath').document.result, 'failed');
    assert.equal(result.evidence.get('authz').document.result, 'failed');
    assert.match(JSON.stringify(result.evidence.get('dependencies').document.checks), /control-error.*checker crashed/);
    const record = auditRecord(result.ctx, result.evidence, '2026-09-28T00:00:00.000Z');
    assert.equal(record.status, 'failed');
    assert.equal(record.controls.authz, 'failed');
    assert.equal(record.controls.dependencies, 'failed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the runner refuses unknown commits, bad arguments, and a catalog version it did not audit', async () => {
  const { root, sha } = fixtureStore();
  try {
    await assert.rejects(audit(root, 'f'.repeat(40)), /git cat-file failed/);
    await assert.rejects(audit(root, 'HEAD'), /full 40-character commit/);
    assert.throws(() => parseRunnerArgs(['sample-app']), /--sha is required/);
    assert.throws(() => parseRunnerArgs(['sample-app', '--sha', sha, '--write', '--verify']), /exclusive/);
    assert.deepEqual(parseRunnerArgs(['sample-app', '--verify']).verify, true);
    const result = await audit(root, sha);
    const catalog = JSON.parse(readFileSync(join(root, 'marketplace.json'), 'utf8'));
    catalog.apps[0].version = '1.0.1';
    writeJson(root, 'marketplace.json', catalog);
    assert.throws(() => writeAudit(root, result), /catalog version 1\.0\.1 is not the audited version 1\.0\.0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the public snapshot publishes a trunk-bound attestation as a truthful pending record', async () => {
  const { root, sha } = fixtureStore();
  const snapshot = mkdtempSync(join(tmpdir(), 'oshal-runner-snapshot-'));
  try {
    writeAudit(root, await audit(root, sha), '2026-09-28T00:00:00.000Z');
    commit(root, 'publish the attestation');
    execFileSync('git', ['-C', root, 'archive', '--format=tar', '-o', join(snapshot, 'cut.tar'), 'HEAD']);
    execFileSync('tar', ['-xf', 'cut.tar'], { cwd: snapshot });
    rmSync(join(snapshot, 'cut.tar'));
    assert.match(validatePackageAuditCatalog(snapshot, 'compatible').errors.join('\n'), /audit currency cannot be verified/);
    assert.deepEqual(resetSnapshotAttestations(snapshot), ['sample-app']);
    const record = JSON.parse(readFileSync(join(snapshot, 'audits', 'sample-app.json'), 'utf8'));
    assert.deepEqual([record.status, record.sourceSha, record.evidence], ['pending', UNAUDITED_SOURCE_SHA, []]);
    assert.equal(JSON.parse(readFileSync(join(snapshot, 'marketplace.json'), 'utf8')).apps[0].audit.sourceSha, UNAUDITED_SOURCE_SHA);
    assert.equal(existsSync(join(snapshot, 'audits', 'evidence')), false);
    assert.deepEqual(validatePackageAuditCatalog(snapshot, 'compatible').errors, []);
    assert.deepEqual(resetSnapshotAttestations(snapshot), [], 'idempotent');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(snapshot, { recursive: true, force: true });
  }
});

test('rls fails closed on migrations it cannot replay, and the golden path needs an offline case', async () => {
  const { root, sha } = fixtureStore();
  try {
    mkdirSync(join(root, 'sample-app', 'migrations'));
    writeFileSync(join(root, 'sample-app', 'migrations', '001-init.sql'), 'CREATE TABLE sample (id int);\n');
    writeJson(root, 'sample-app/tests/test-lab.yaml', { version: 1, cases: [{ id: 'live-only', runner: { kind: 'smoke' } }] });
    const next = commit(root, 'add a migration and drop the offline case');
    const result = await audit(root, next, { rls: rlsControl });
    assert.match(JSON.stringify(result.evidence.get('rls').document.checks), /1 migration\(s\) need the disposable PostgreSQL replay/);
    assert.match(JSON.stringify(result.evidence.get('goldenPath').document.checks), /declares no offline node-test case/);
    assert.notEqual(next, sha);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
