/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Mutation-resistant contract for SEC-06 triggers, immutable actions, blocking gates, route parsing, and CodeQL exception expiry.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Require immutable action references in every store workflow, not only the dedicated security gate.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Lock source parity to one canonical rebuild invocation and reject the former per-package compiler loop.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Add fail-closed manifest, package-test discovery, CodeQL-ledger, and example-secret mutation contracts.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Prove the live owner-RLS runner is explicit opt-in, asserts both tenants/operator, and cleans temporary objects on failure.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Require a separate migration-100-only legacy upgrade fixture with backfill, constraint, FORCE-RLS, isolation, idempotence, and cleanup coverage.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Require the compiled Vids mobile Chromium proof and validate its fail-closed surface selection and static extraction.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Require LoRA/Vids live owner-RLS execution in the disposable PostgreSQL security job instead of leaving the proof manual-only.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Require APP-02 package-audit validation in explicit compatible rollout mode and its enforce-policy mutation family.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Keep CORE-05 requiresAi readiness routes in the fail-closed store route parser and reject non-boolean declarations.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Lock all non-Pumpkin packages to the service-only, read-only CORE-05 readiness source/compiled pair and non-placeholder response assertion.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { evaluateFindings, findingsFromSarif } from './check-codeql-sarif.mjs';
import { parseManifestRoutes } from './check-store-security.mjs';
import { assertStoreCiTestInventory, discoverStoreCiTests } from './check-store-test-discovery.mjs';
import {
  legacyOwnerUpgradeProofSql,
  ownerIsolationProofSql,
  parseLiveProofOptions,
  runLiveOwnerRlsProof,
} from './run-live-owner-rls-proof.mjs';
import { extractVidsSurface, parseMobileProofOptions } from './run-vids-mobile-browser.mjs';

const workflow = readFileSync('.github/workflows/security.yml', 'utf8');
const gitleaksConfig = readFileSync('.gitleaks.toml', 'utf8');
const liveProofRunner = readFileSync('scripts/security/run-live-owner-rls-proof.mjs', 'utf8');

/**
 * Collect action references across every workflow. A manual package job is still a software-supply
 * chain boundary, so mutable tags are forbidden outside the dedicated security workflow too.
 */
function allWorkflowActions() {
  return readdirSync('.github/workflows')
    .filter((file) => /\.ya?ml$/.test(file))
    .flatMap((workflowName) => {
      const source = readFileSync(join('.github/workflows', workflowName), 'utf8');
      return [...source.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)]
        .map((match) => ({ workflowName, action: match[1] }));
    });
}

test('security workflow covers PR, exact main, weekly, and manual execution', () => {
  assert.match(workflow, /^  pull_request:\s*$/m);
  assert.match(workflow, /^  push:\s*\n    branches: \[main\]$/m);
  assert.match(workflow, /^  schedule:\s*\n    - cron: "29 08 \* \* 2"$/m);
  assert.match(workflow, /^  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /pull_request_target:/);
});

test('every workflow pins actions and the security gate contains no advisory bypass', () => {
  const actions = allWorkflowActions();
  assert.ok(actions.length > 20, 'expected every workflow action to use an immutable commit');
  for (const { workflowName, action } of actions) {
    assert.match(action, /^[^@]+@[0-9a-f]{40}$/, `${workflowName} uses a mutable action reference`);
  }
  assert.doesNotMatch(workflow, /\|\|\s*true|continue-on-error\s*:\s*true/i);
  for (const required of [
    'security-extended',
    'check-codeql-sarif.mjs',
    'check-store-security.mjs',
    'check-store-test-discovery.mjs',
    'run-store-security-tests.mjs',
    'validate-package-audits.mjs',
    'run-framework-coupled-tests.mjs',
    'run-vids-mobile-browser.mjs',
    'pip_audit',
    '--log-opts="--all"',
    '--no-git',
    'format: cyclonedx',
    'SEC-06 required store security gate',
  ]) assert.ok(workflow.includes(required), `missing security gate: ${required}`);
});

test('package audits are structurally blocking while enforcement remains an explicit rollout', () => {
  const step = /- name: Validate package audit records and staged catalog bindings[\s\S]+?run: node scripts\/security\/validate-package-audits\.mjs/.exec(workflow)?.[0];
  assert.ok(step, 'package audit validation step is missing');
  assert.match(step, /OSHAL_PACKAGE_AUDIT_MODE: compatible/);
  assert.doesNotMatch(step, /continue-on-error|\|\|\s*true/);
  const runner = readFileSync('scripts/security/run-store-security-tests.mjs', 'utf8');
  assert.match(runner, /package-audit\.test\.mjs/);
});

test('source parity uses one canonical compiler pass instead of a package loop', () => {
  const parityJob = /  source-compiled-parity:[\s\S]+?\n  dependency-audit:/.exec(workflow)?.[0];
  assert.ok(parityJob, 'source-compiled-parity job is missing');
  assert.equal((parityJob.match(/rebuild-store-routes\.mjs/g) ?? []).length, 1);
  assert.match(parityJob, /--store store --framework framework/);
  assert.doesNotMatch(parityJob, /oshal-app\.js\s+build|for\s+manifest|for\s+package/);
  assert.match(parityJob, /playwright install --with-deps chromium/);
  assert.match(parityJob, /run-vids-mobile-browser\.mjs[\s\S]+--surface generated/);
});

test('mobile proof selects reviewed surfaces and rejects dynamic or incomplete HTML', () => {
  assert.deepEqual(parseMobileProofOptions([
    '--store', 'store', '--framework', 'framework',
  ]), { surface: 'generated', store: 'store', framework: 'framework' });
  assert.equal(parseMobileProofOptions([
    '--store', 'store', '--framework', 'framework', '--surface', 'source',
  ]).surface, 'source');
  assert.throws(() => parseMobileProofOptions([
    '--store', 'store', '--framework', 'framework', '--surface', '../arbitrary',
  ]), /generated\|source/);
  assert.equal(extractVidsSurface('const SURFACE_HTML = `<!doctype html><html></html>`;'), '<!doctype html><html></html>');
  assert.throws(() => extractVidsSurface('const SURFACE_HTML = `<html></html>`;'), /complete HTML/);
  assert.throws(() => extractVidsSurface('const SURFACE_HTML = `<!doctype html>${unsafe}</html>`;'), /static literal/);
});

test('every package command in store-ci resolves to a non-empty test set', () => {
  const discoveries = discoverStoreCiTests(process.cwd());
  assert.ok(discoveries.length > 0);
  assert.deepEqual(discoveries.filter((entry) => entry.count === 0), []);
  assert.doesNotThrow(() => assertStoreCiTestInventory(process.cwd(), discoveries));
  assert.throws(() => assertStoreCiTestInventory(process.cwd(), discoveries.slice(1)), /stale=/);
  assert.throws(() => assertStoreCiTestInventory(process.cwd(), [
    ...discoveries,
    { packageDir: 'unexpected', command: 'npm test', count: 1 },
  ]), /added=/);
});

test('secret scanning does not exempt test or example paths', () => {
  assert.doesNotMatch(gitleaksConfig, /\(\^\|\/\)tests\?\/\.\*/);
  assert.doesNotMatch(gitleaksConfig, /\.\*\\\.test\\\.\(cjs\|mjs\|js\|ts\)/);
  assert.doesNotMatch(gitleaksConfig, /\.\*\\\.env\\\.example\$/);
  assert.doesNotMatch(gitleaksConfig, /\.\*\\\.example\$/);
  assert.match(gitleaksConfig, /Tests and example files remain scanned/);
});

test('route parser inventories block and inline auth without an empty default', () => {
  const block = parseManifestRoutes(`routes:\n  - module: routes/a.js\n    factory: createA\n    mountPath: /api/a\n    auth: service-or-oidc\n`, 'block.yaml');
  assert.deepEqual(block, [{ module: 'routes/a.js', factory: 'createA', mountPath: '/api/a', auth: 'service-or-oidc' }]);
  const inline = parseManifestRoutes('routes:\n  - { module: routes/b.js, factory: createB, mountPath: /api/b, requiresAuth: true }\n', 'inline.yaml');
  assert.equal(inline[0].auth, 'oidc');
  assert.throws(() => parseManifestRoutes('routes:\n  - module: routes/c.js\n    factory: createC\n    mountPath: /api/c\n', 'missing.yaml'), /missing auth/);
});

test('route parser accepts only boolean requiresAi declarations', () => {
  const routes = parseManifestRoutes([
    'routes:',
    '  - module: routes/package-smoke.js',
    '    factory: createPackageSmokeRoutes',
    '    mountPath: /api/sample/_smoke',
    '    auth: service',
    '    requiresAi: false',
  ].join('\n'), 'smoke.yaml');
  assert.equal(routes[0].auth, 'service');
  assert.throws(() => parseManifestRoutes([
    'routes:',
    '  - module: routes/package-smoke.js',
    '    factory: createPackageSmokeRoutes',
    '    mountPath: /api/sample/_smoke',
    '    auth: service',
    '    requiresAi: no',
  ].join('\n'), 'smoke.yaml'), /requiresAi must be true or false/);
});

test('every non-Pumpkin package owns the reviewed service-only readiness smoke', () => {
  const packageDirs = readdirSync('.', { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(entry.name, 'oshal-app.yaml')))
    .map((entry) => entry.name)
    .sort();
  assert.equal(packageDirs.length, 47, 'the smoke audit must cover the complete store manifest set');

  const excluded = new Set(['pumpkin']);
  const normalizedModule = (file) => `${readFileSync(file, 'utf8').replaceAll('\r\n', '\n').trimEnd()}\n`;
  const canonicalSource = normalizedModule('brand-graphics/src-routes/package-smoke.ts');
  const canonicalCompiled = normalizedModule('brand-graphics/routes/package-smoke.js');
  let covered = 0;
  for (const packageDir of packageDirs) {
    const manifest = readFileSync(join(packageDir, 'oshal-app.yaml'), 'utf8');
    const packageName = /^name:\s*([a-z0-9][a-z0-9-]{0,63})\s*$/m.exec(manifest)?.[1];
    assert.ok(packageName, `${packageDir} must declare a simple package name`);
    const sourcePath = join(packageDir, 'src-routes', 'package-smoke.ts');
    const compiledPath = join(packageDir, 'routes', 'package-smoke.js');
    if (excluded.has(packageDir)) {
      assert.equal(existsSync(sourcePath), false, `${packageDir} is explicitly excluded from source edits`);
      assert.equal(existsSync(compiledPath), false, `${packageDir} is explicitly excluded from compiled edits`);
      continue;
    }

    const mountPath = `/api/${packageName}/_smoke`;
    const escapedMount = mountPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(manifest, new RegExp([
      '  - module: routes/package-smoke\\.js',
      '    factory: createPackageSmokeRoutes',
      `    mountPath: ${escapedMount}`,
      '    auth: service',
      '    requiresContext: true',
      '    requiresAi: false',
    ].join('\\r?\\n')), `${packageDir} readiness route must remain service-only and non-AI`);
    assert.match(manifest, new RegExp([
      'smoke:',
      '  - name: package-readiness',
      '    method: GET',
      `    path: ${escapedMount}`,
      '    auth: service',
      '    expect:',
      '      status: 200',
      '      jsonPointer: /package',
      '      rejectValues: \\[noop, stub, empty\\]',
      '    requiresAi: false',
    ].join('\\r?\\n')), `${packageDir} readiness expectation must reject placeholder identities`);
    assert.equal(normalizedModule(sourcePath), canonicalSource, `${packageDir} smoke source drifted`);
    assert.equal(normalizedModule(compiledPath), canonicalCompiled, `${packageDir} compiled smoke drifted`);
    covered += 1;
  }
  assert.equal(covered, 46, 'exactly Pumpkin is excluded from the 47-package rollout');

  const inventory = JSON.parse(readFileSync('scripts/security/store-route-inventory.json', 'utf8')).routes;
  const smokeRoutes = inventory.filter((entry) => entry.includes('|routes/package-smoke.js|'));
  assert.equal(smokeRoutes.length, 46);
  assert.ok(smokeRoutes.every((entry) => entry.endsWith('|service|no-sql-write')));
});

test('route parser follows valid YAML field order, alternate indentation, and comment-separated entries', () => {
  const routes = parseManifestRoutes([
    'name: mutation-fixture',
    'routes:',
    '    - factory: createFirst',
    '      auth: operator',
    '      mountPath: /api/first',
    '      module: routes/first.js',
    '',
    '# A comment at column zero does not end the YAML sequence.',
    '    - auth: public',
    '      module: routes/second.js',
    '      factory: createSecond',
    '      mountPath: /api/second',
    'migrations: []',
    '',
  ].join('\n'), 'mutated.yaml');
  assert.deepEqual(routes, [
    { module: 'routes/first.js', factory: 'createFirst', mountPath: '/api/first', auth: 'operator' },
    { module: 'routes/second.js', factory: 'createSecond', mountPath: '/api/second', auth: 'public' },
  ]);
});

test('route parser fails closed on empty, malformed, partial, or ambiguously indented manifests', () => {
  assert.throws(() => parseManifestRoutes('', 'empty.yaml'), /manifest is empty/);
  assert.throws(() => parseManifestRoutes('# comments only\n', 'empty.yaml'), /manifest is empty/);
  assert.throws(() => parseManifestRoutes('not a mapping\n', 'broken.yaml'), /top-level mapping/);
  assert.throws(() => parseManifestRoutes('name: broken\nroutes: [unterminated\n', 'broken.yaml'), /routes must be/);
  assert.throws(() => parseManifestRoutes('name: broken\nroutes:\nnext: true\n', 'broken.yaml'), /non-empty block sequence/);
  assert.throws(() => parseManifestRoutes('name: broken\nroutes:\n  - module routes/a.js\n', 'broken.yaml'), /begin with a field mapping/);
  assert.throws(() => parseManifestRoutes('name: broken\nroutes:\n  - module: routes/a.js\n    factory: createA\n    mountPath: /api/a\n', 'broken.yaml'), /missing auth/);
  assert.throws(() => parseManifestRoutes('name: broken\nroutes:\n  - module: routes/a.js\n    factory: createA\n    auth: oidc\n', 'broken.yaml'), /missing mountPath/);
  assert.throws(() => parseManifestRoutes([
    'name: broken',
    'routes:',
    '  - module: routes/a.js',
    '    factory: createA',
    '    mountPath: /api/a',
    '    auth: oidc',
    '    - module: routes/b.js',
    '      factory: createB',
    '      mountPath: /api/b',
    '      auth: oidc',
  ].join('\n'), 'broken.yaml'), /inconsistent indentation/);
});

test('store-ci discovery reads folded commands and rejects hidden or missing package tests', () => {
  const root = mkdtempSync(join(tmpdir(), 'store-ci-discovery-'));
  const write = (path, contents) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  };
  const workflowPath = join(root, '.github', 'workflows', 'store-ci.yml');
  try {
    write(join(root, 'sample', 'oshal-app.yaml'), 'name: sample\n');
    write(join(root, 'sample', 'tests', 'sample.test.js'), '');
    write(workflowPath, [
      'jobs:',
      '  sample:',
      '    steps:',
      '      - name: Folded test',
      '        working-directory: sample',
      '        run: >-',
      '          node --test',
      '          "tests/*.test.js"',
      '',
    ].join('\n'));
    assert.equal(discoverStoreCiTests(root)[0].count, 1);

    write(workflowPath, [
      'jobs:',
      '  sample:',
      '    steps:',
      '      - name: Missing root test',
      '        run: node --test sample/tests/missing.test.js',
      '',
    ].join('\n'));
    assert.throws(() => discoverStoreCiTests(root), /root test step Missing root test names missing file/);

    write(join(root, 'sample', 'package.json'), JSON.stringify({ scripts: { test: 'node tests/missing.test.js' } }));
    write(workflowPath, [
      'jobs:',
      '  sample:',
      '    steps:',
      '      - name: Missing npm path',
      '        working-directory: sample',
      '        run: npm test',
      '',
    ].join('\n'));
    assert.throws(() => discoverStoreCiTests(root), /npm test names missing file/);

    write(workflowPath, [
      'jobs:',
      '  sample:',
      '    steps:',
      '      - name: Hidden runner',
      '        working-directory: sample',
      '        run: node custom-test-runner.js',
      '',
    ].join('\n'));
    assert.throws(() => discoverStoreCiTests(root), /unrecognized package command/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CodeQL high severity blocks and lower severity needs an exact unexpired exception', () => {
  const sarif = { runs: [{
    tool: { driver: { rules: [{ id: 'js/high', properties: { 'security-severity': '8.0' } }] } },
    results: [{ ruleId: 'js/high', ruleIndex: 0, level: 'warning', locations: [{
      physicalLocation: { artifactLocation: { uri: 'routes/a.js' } },
    }] }],
  }] };
  const high = findingsFromSarif(sarif);
  const today = new Date('2026-08-06T12:00:00.000Z');
  assert.equal(evaluateFindings(high, { schemaVersion: 1, exceptions: [] }, today)[0].reason, 'high-or-critical');

  const low = { ruleId: 'js/low', path: 'routes/b.js', level: 'warning', securityScore: 3.5 };
  const exceptions = [{
    ruleId: 'js/low',
    path: 'routes/b.js',
    owner: 'maintainer@emeraldcoastsystemsgroup.com',
    reason: 'Reviewed compensating control',
    expires: '2026-10-01',
  }];
  const ledger = { schemaVersion: 1, exceptions };
  assert.deepEqual(evaluateFindings([low], ledger, today), []);
  assert.equal(evaluateFindings([{ ...low, path: 'routes/other.js' }], ledger, today).length, 1);
  assert.throws(() => evaluateFindings([], {
    schemaVersion: 1,
    exceptions: [{ ...exceptions[0], expires: '2026-08-05' }],
  }, today), /expired/);
  assert.throws(() => evaluateFindings([], {
    schemaVersion: 1,
    exceptions: [{ ...exceptions[0], owner: 'somebody@example.com' }],
  }, today), /owner must be maintainer@emeraldcoastsystemsgroup\.com/);
  assert.throws(() => evaluateFindings([], {
    schemaVersion: 1,
    exceptions: [{ ...exceptions[0], expires: '2027-09-01' }],
  }, today), /review horizon/);
});

test('live owner-RLS proof is opt-in, required in ephemeral CI, complete, and cleans up on failure', () => {
  assert.throws(() => parseLiveProofOptions([], {}), /--confirm-live-owner-rls-proof/);
  assert.throws(() => parseLiveProofOptions([
    '--confirm-live-owner-rls-proof', '--container', 'pg', '--database-url', 'postgres://localhost/postgres',
  ], {}), /exactly one/);
  assert.match(
    workflow,
    /run-live-owner-rls-proof\.mjs[\s\S]*?--confirm-live-owner-rls-proof[\s\S]*?--container "\$\{\{ job\.services\.dnd_postgres\.id \}\}"/,
  );
  assert.equal((liveProofRunner.match(/100-lora-owner-rls\.sql/g) ?? []).length, 4);
  assert.equal((liveProofRunner.match(/100-vids-owner-rls\.sql/g) ?? []).length, 4);
  const legacyLoader = /function legacyMigrationSql[\s\S]+?\n}/.exec(liveProofRunner)?.[0];
  assert.ok(legacyLoader, 'legacy migration loader is missing');
  assert.doesNotMatch(legacyLoader, /058-lora-studio|059-vids-platform/);
  assert.equal((legacyLoader.match(/100-lora-owner-rls\.sql/g) ?? []).length, 2);
  assert.equal((legacyLoader.match(/100-vids-owner-rls\.sql/g) ?? []).length, 2);

  const sql = ownerIsolationProofSql('sec06_test_role');
  assert.match(sql, /sec06-shared-subject/);
  assert.match(sql, /SET oshal\.current_sub = 'sec06-owner-a'/);
  assert.match(sql, /SET oshal\.current_sub = 'sec06-owner-b'/);
  assert.match(sql, /SET oshal\.is_operator = 'on'/);
  assert.match(sql, /owner A changed owner B vids job/);
  assert.match(sql, /owner B changed owner A character/);

  const legacySql = legacyOwnerUpgradeProofSql('sec06_test_role');
  assert.match(legacySql, /SET search_path = legacy, pg_catalog/);
  assert.match(legacySql, /system:legacy:lora/);
  assert.match(legacySql, /system:legacy:vids/);
  assert.match(legacySql, /attnotnull/);
  assert.match(legacySql, /oshal_lora_characters_subject_key/);
  assert.match(legacySql, /relrowsecurity AND relforcerowsecurity/);
  assert.match(legacySql, /legacy owner A changed owner B Vids job/);
  assert.match(legacySql, /legacy operator character visibility failed/);

  const labels = [];
  assert.throws(() => runLiveOwnerRlsProof({ confirmed: true, adminDatabase: 'postgres' }, {
    names: { database: 'sec06_test_database', role: 'sec06_test_role' },
    migrationSql: () => '',
    executeSql: (_database, _sql, label) => {
      labels.push(label);
      if (label === 'run owner isolation proof') throw new Error('synthetic proof failure');
    },
  }), /synthetic proof failure/);
  assert.deepEqual(labels.slice(-4), [
    'terminate temporary database sessions',
    'drop temporary database',
    'drop temporary role',
    'verify temporary object cleanup',
  ]);

  const successfulLabels = [];
  assert.doesNotThrow(() => runLiveOwnerRlsProof({ confirmed: true, adminDatabase: 'postgres' }, {
    names: { database: 'sec06_success_database', role: 'sec06_success_role' },
    migrationSql: () => '',
    legacyMigrationSql: () => '',
    executeSql: (_database, _sql, label) => successfulLabels.push(label),
  }));
  assert.deepEqual(successfulLabels.slice(2, 6), [
    'apply base and idempotent owner migrations',
    'run owner isolation proof',
    'apply legacy fixture and repeated owner upgrades',
    'run legacy owner upgrade proof',
  ]);
});
