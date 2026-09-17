/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-157 S3: mutation-proof the scheduled-service declaration gate. Each case removes or corrupts exactly one thing in a disposable one-package store and asserts the gate goes red for it — a dropped runsAs, an invented class, a requires naming a permission the catalog does not define, and a requires on a package with no catalog at all (which makes the KERNEL refuse the whole manifest, so the app would not install). The last two cases pin the real declarations in this repository, so deleting one from a shipped manifest turns this suite red rather than leaving the gate to be quietly removed from CI.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifestSchedules, serviceActivationProblems } from './check-service-activations.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The store's shipped service-route schedules and the class each package declares. */
const DECLARED = [
  ['calendar', 'calendar-meeting-briefs', 'system'],
  ['daily-trade-recap', 'daily-trade-recap-recorded-reports', 'system'],
  ['marketing-engine', 'daily-metrics-ingest', 'system'],
  ['marketing-engine', 'weekly-campaign-review', 'system'],
  ['venture-plan', 'rebaseline-policy-tick', 'system'],
];

const MANIFEST = [
  'name: example',
  'version: 1.0.0',
  'uses: [application-authorization]',
  'authorization:',
  '  version: 1',
  '  catalog: authorization.yaml',
  'routes:',
  '  - module: routes/ops.js',
  '    factory: createOpsRoutes',
  '    mountPath: /api/example-ops',
  '    auth: service',
  'schedules:',
  '  - id: nightly-sweep',
  '    cron: "0 3 * * *"',
  '    scope: framework',
  '    runsAs: system',
  '    requires: [metrics.write]',
  '    target: service-route',
  '    route: /api/example-ops/sweep',
  '    handler: runNightlySweep',
  '    body:',
  '      execute: true',
  '',
].join('\n');

const CATALOG = [
  'version: 1',
  'resources:',
  '  scorecard:',
  '    scopes: [own]',
  'permissions:',
  '  metrics.write: { resource: scorecard, effect: write, minimumTier: editor }',
  '',
].join('\n');

/** Build a disposable one-package store whose single schedule is fully, correctly declared. */
function createFixture(t, { manifest = MANIFEST, catalog = CATALOG } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oshal-service-activations-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'example'));
  fs.writeFileSync(path.join(root, 'example', 'oshal-app.yaml'), manifest);
  if (catalog !== null) fs.writeFileSync(path.join(root, 'example', 'authorization.yaml'), catalog);
  return root;
}

test('a fully declared service-route schedule passes', (t) => {
  assert.deepEqual(serviceActivationProblems(createFixture(t)), []);
});

test('a service-route schedule with no runsAs is refused', (t) => {
  const root = createFixture(t, { manifest: MANIFEST.replace('    runsAs: system\n', '') });
  assert.match(serviceActivationProblems(root).join('\n'), /schedule "nightly-sweep" is a service-route schedule with no runsAs/);
});

test('a principal class the kernel does not know is refused', (t) => {
  const root = createFixture(t, { manifest: MANIFEST.replace('runsAs: system', 'runsAs: operator') });
  assert.match(serviceActivationProblems(root).join('\n'), /declares runsAs="operator"; the loader accepts only system or user/);
});

test('a requires the package catalog does not define is refused', (t) => {
  const root = createFixture(t, { manifest: MANIFEST.replace('[metrics.write]', '[metrics.write, budget.move]') });
  const problems = serviceActivationProblems(root).join('\n');
  assert.match(problems, /authorization catalog does not define: budget\.move/);
  assert.match(problems, /Known: metrics\.write/);
});

test('a requires on a package that imports no catalog is refused as an install-breaking declaration', (t) => {
  const manifest = MANIFEST
    .replace('authorization:\n  version: 1\n  catalog: authorization.yaml\n', '')
    .replace('uses: [application-authorization]\n', '');
  const root = createFixture(t, { manifest, catalog: null });
  const problems = serviceActivationProblems(root).join('\n');
  assert.match(problems, /declares requires but this package imports no authorization catalog/);
  assert.match(problems, /refuses the WHOLE manifest/);
});

test('an empty or duplicated requires list is refused', (t) => {
  assert.match(
    serviceActivationProblems(createFixture(t, { manifest: MANIFEST.replace('[metrics.write]', '[]') })).join('\n'),
    /declares an empty requires/,
  );
  assert.match(
    serviceActivationProblems(createFixture(t, { manifest: MANIFEST.replace('[metrics.write]', '[metrics.write, metrics.write]') })).join('\n'),
    /names metrics\.write twice in requires/,
  );
});

test('an authorization catalog the manifest names but does not ship is a problem, never "no permissions"', (t) => {
  const root = createFixture(t, { catalog: null });
  assert.match(serviceActivationProblems(root).join('\n'), /authorization\.catalog names a missing file: authorization\.yaml/);
});

test('a block-scalar prompt and a nested body never look like a malformed schedule', (t) => {
  const manifest = [
    'name: example',
    'schedules:',
    '  - id: digest',
    '    cron: "0 13 * * *"',
    '    scope: per-user',
    '    targetAgent: b0000000-0000-0000-0000-000000000001',
    '    prompt: >-',
    '      Summarize what happened across my connected accounts,',
    '      including anything worth a reply.',
    '  - id: sweep',
    '    cron: "0 3 * * *"',
    '    target: service-route',
    '    runsAs: user',
    '    route: /api/example-ops/sweep',
    '    handler: runNightlySweep',
    '    body:',
    '      execute: true',
    '      nested:',
    '        deeper: true',
    '',
  ].join('\n');
  const { schedules, problems } = readManifestSchedules(manifest, 'example/oshal-app.yaml');
  assert.deepEqual(problems, []);
  assert.equal(schedules.length, 2);
  assert.equal(schedules[1].runsAs, 'user');
  assert.equal(schedules[1].target, 'service-route');
});

test('every service-route schedule this store ships is still declared', () => {
  assert.deepEqual(serviceActivationProblems(REPOSITORY_ROOT), []);
  const found = [];
  const directories = fs.readdirSync(REPOSITORY_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .filter((entry) => fs.existsSync(path.join(REPOSITORY_ROOT, entry.name, 'oshal-app.yaml')))
    .map((entry) => entry.name)
    .sort();
  for (const directory of directories) {
    const manifest = fs.readFileSync(path.join(REPOSITORY_ROOT, directory, 'oshal-app.yaml'), 'utf8');
    const { schedules, problems } = readManifestSchedules(manifest, `${directory}/oshal-app.yaml`);
    assert.deepEqual(problems, [], `${directory}/oshal-app.yaml schedules block is unreadable`);
    for (const schedule of (schedules ?? []).filter((entry) => entry.target === 'service-route')) {
      found.push([directory, schedule.id, schedule.runsAs]);
    }
  }
  assert.deepEqual(found, DECLARED);
});

test('the store CI job that runs this gate exists and blocks the package jobs', () => {
  const workflow = fs.readFileSync(path.join(REPOSITORY_ROOT, '.github', 'workflows', 'store-ci.yml'), 'utf8');
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line === '  service-activations:');
  assert.notEqual(start, -1, 'store-ci lost the service-activations job');
  let end = start + 1;
  while (end < lines.length && !/^  [a-z0-9-]+:\s*$/.test(lines[end])) end += 1;
  const block = lines.slice(start, end).join('\n');
  assert.match(block, /node scripts\/check-service-activations\.mjs/);
  assert.match(block, /node --test scripts\/check-service-activations\.test\.mjs/);
});
