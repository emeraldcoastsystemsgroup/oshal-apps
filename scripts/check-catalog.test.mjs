/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-06 00:10:00 | maintainer@emeraldcoastsystemsgroup.com   | Mutation-proof the catalog gate against version/source drift, missing and phantom entries, duplicate ids, and the retired schema URL using isolated temporary stores; prove every package job waits for both store contract gates.
 * 2026-09-16 00:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Require the catalog-parity job to run the dependency-mirror mutation suite too, so the guard that keeps marketplace.json's dependency block generated cannot be dropped from CI without this suite going red.
 * 2026-09-16 12:00:00 | maintainer@emeraldcoastsystemsgroup.com   | The fixture carries the audit binding a real entry has, plus mutation cases for a drifted and a missing record — the exact shape that let calendar 1.1.0 ship against a 1.0.0 stamp and made every install of it fail closed while this gate stayed green.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogProblems, CURRENT_SCHEMA } from './check-catalog.mjs';

const AUDIT_SHA = 'a'.repeat(40);

const SOURCE = {
  type: 'git-subdir',
  url: 'https://github.com/emeraldcoastsystemsgroup/oshal-apps',
  path: 'example',
  ref: 'main',
};

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oshal-catalog-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'example'));
  fs.writeFileSync(path.join(root, 'example', 'oshal-app.yaml'), [
    'name: example',
    'suite: ai-engineering # reviewed shelf',
    'displayName: Example App',
    'version: 1.2.3',
    'source:',
    '  type: git-subdir',
    '  url: https://github.com/emeraldcoastsystemsgroup/oshal-apps',
    '  path: example',
    '  ref: main',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'README.md'), '# Fixture store\n');
  // A real catalog entry carries an audit binding, and the installer refuses a package whose
  // record does not describe the catalog's version — so the fixture carries one too.
  fs.mkdirSync(path.join(root, 'audits'));
  fs.writeFileSync(path.join(root, 'audits', 'example.json'), `${JSON.stringify({
    profileVersion: 1, app: 'example', version: '1.2.3', sourceSha: AUDIT_SHA,
    status: 'pending', auditedAt: null, evidence: [],
  }, null, 2)}
`);
  const marketplace = {
    $schema: CURRENT_SCHEMA,
    apps: [{
      name: 'example',
      suite: 'ai-engineering',
      displayName: 'Example App',
      version: '1.2.3',
      source: { ...SOURCE },
      audit: { record: 'audits/example.json', sourceSha: AUDIT_SHA },
    }],
  };
  const writeMarketplace = () => fs.writeFileSync(
    path.join(root, 'marketplace.json'),
    `${JSON.stringify(marketplace, null, 2)}\n`,
  );
  writeMarketplace();
  return { root, marketplace, writeMarketplace };
}

const checkFixture = (root) => catalogProblems(root, { checkGeneratedReadme: false });

test('a complete one-package catalog satisfies every mirrored field', (t) => {
  const { root } = createFixture(t);
  assert.deepEqual(checkFixture(root), []);
});

test('version and source path drift are both release-blocking', (t) => {
  const { root, marketplace, writeMarketplace } = createFixture(t);
  marketplace.apps[0].version = '9.9.9';
  marketplace.apps[0].source.path = 'wrong-folder';
  writeMarketplace();
  const problems = checkFixture(root).join('\n');
  assert.match(problems, /catalog version="9\.9\.9", manifest version="1\.2\.3"/);
  assert.match(problems, /catalog source\.path="wrong-folder", manifest source\.path="example"/);
});

test('missing, phantom, and duplicate catalog identities fail closed', (t) => {
  const { root, marketplace, writeMarketplace } = createFixture(t);
  marketplace.apps = [
    { ...marketplace.apps[0], name: 'phantom', source: { ...SOURCE, path: 'phantom' } },
    { ...marketplace.apps[0], name: 'phantom', source: { ...SOURCE, path: 'phantom' } },
  ];
  writeMarketplace();
  const problems = checkFixture(root).join('\n');
  assert.match(problems, /repeats app name\(s\): phantom/);
  assert.match(problems, /example \(example\) has no marketplace\.json entry/);
  assert.match(problems, /lists "phantom" without a package manifest/);
});

test('the retired marketplace schema URL is rejected explicitly', (t) => {
  const { root, marketplace, writeMarketplace } = createFixture(t);
  marketplace.$schema = CURRENT_SCHEMA.replace('/oshal/', '/open-shal/');
  writeMarketplace();
  const problems = checkFixture(root).join('\n');
  assert.match(problems, /marketplace\.json \$schema must be/);
  assert.match(problems, /references the retired open-shal archive/);
});

test('every package job waits for non-empty discovery and catalog parity', () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const workflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'store-ci.yml'), 'utf8');
  const lines = workflow.split(/\r?\n/);
  const packageJobs = [
    'little-monsters', 'game-show', 'dnd', 'video', 'kalshi', 'bake-off', 'world',
    'switchboard', 'presentations', 'spaces', 'payroll', 'career-hunter', 'rides',
    'pumpkin', 'venture-plan',
  ];
  const jobBlock = (job) => {
    const start = lines.findIndex((line) => line === `  ${job}:`);
    assert.notEqual(start, -1, `store-ci lost the ${job} job`);
    let end = start + 1;
    while (end < lines.length && !/^  [a-z0-9-]+:\s*$/.test(lines[end])) end += 1;
    return lines.slice(start, end).join('\n');
  };
  assert.match(jobBlock('test-discovery'), /node scripts\/security\/check-store-test-discovery\.mjs/);
  assert.match(jobBlock('catalog-parity'), /node scripts\/check-catalog\.mjs/);
  assert.match(jobBlock('catalog-parity'), /node --test scripts\/check-catalog\.test\.mjs/);
  assert.match(jobBlock('catalog-parity'), /node --test scripts\/gen-catalog-dependencies\.test\.mjs/);
  for (const job of packageJobs) {
    assert.match(
      jobBlock(job),
      /^    needs: \[test-discovery, catalog-parity\]$/m,
      `${job} can start before the store contract gates`,
    );
  }
});

test('an audit record whose version drifts from the catalog fails the gate', (t) => {
  const { root } = createFixture(t);
  const recordPath = path.join(root, 'audits', 'example.json');
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  record.version = '1.0.0';                    // the package shipped 1.2.3; the stamp never moved
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}
`);
  const problems = checkFixture(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /version="1\.0\.0", catalog version="1\.2\.3"/);
});

test('a missing audit record fails the gate', (t) => {
  const { root } = createFixture(t);
  fs.rmSync(path.join(root, 'audits', 'example.json'));
  assert.deepEqual(checkFixture(root), ['example: audits/example.json is missing']);
});
