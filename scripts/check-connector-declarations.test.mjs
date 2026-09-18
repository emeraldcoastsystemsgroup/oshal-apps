/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-17 00:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Mutation-proof the connector-declaration gate. The regression that matters is a DISAPPEARANCE: a package that declared an allow-list stops declaring one, and every user of that app is silently handed the entire provider catalog again. No catalog check can see it - marketplace.json's dependency block is generated FROM the manifests, so the key leaves the mirror with the manifest and `gen-catalog-dependencies.mjs --check` stays green - which is why the removal case here drives the real gate over a fixture store rather than asserting on the catalog. The empty-list case is the other half: `connectors: []` is a DECLARATION (offer none) and must never be graded as absent, or the fix for the exposure would trip the gate that protects it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  connectorDeclarationProblems, main, UNDECLARED_BY_DECISION,
} from './check-connector-declarations.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DECLARING_MANIFEST = [
  'name: example',
  'displayName: Example App',
  'version: 1.2.3',
  'dependencies:',
  '  required:',
  '    apps: []',
  '    tools: []',
  '    connectors: []',
  '  optional:',
  '    apps: []',
  '    tools: []',
  '    connectors: [tmdb]',
  '',
].join('\n');

/**
 * @description Build a one-package store in a temporary directory so a mutation can be proved
 * release-blocking without touching the repository.
 * @param {object} t The node:test context, used to remove the fixture afterwards.
 * @param {{ manifest?: string, writeManifest?: boolean }} options Manifest text, and whether to
 *  write it at all (false leaves a catalog entry pointing at nothing).
 * @returns {string} The fixture store root.
 */
function createFixture(t, { manifest = DECLARING_MANIFEST, writeManifest = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oshal-connector-decl-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'example'));
  if (writeManifest) fs.writeFileSync(path.join(root, 'example', 'oshal-app.yaml'), manifest);
  fs.writeFileSync(path.join(root, 'marketplace.json'), `${JSON.stringify({
    apps: [{
      name: 'example',
      version: '1.2.3',
      source: {
        type: 'git-subdir',
        url: 'https://github.com/emeraldcoastsystemsgroup/oshal-apps',
        path: 'example',
        ref: 'main',
      },
    }],
  }, null, 2)}\n`);
  return root;
}

/** Drop one line from a manifest, the way an edit that "tidies" a block would. */
const withoutLine = (manifest, needle) => manifest
  .split('\n').filter((line) => !line.includes(needle)).join('\n');

test('a package declaring an allow-list in either tier has nothing to report', (t) => {
  assert.deepEqual(connectorDeclarationProblems(createFixture(t)), []);
});

test('an empty allow-list is a DECLARATION, not an absence', (t) => {
  const manifest = DECLARING_MANIFEST.replace('connectors: [tmdb]', 'connectors: []');
  assert.deepEqual(connectorDeclarationProblems(createFixture(t, { manifest })), []);
});

test('an allow-list declared only in the optional tier is enough', (t) => {
  const manifest = withoutLine(DECLARING_MANIFEST, '    connectors: []');
  assert.match(manifest, /connectors: \[tmdb\]/);
  assert.deepEqual(connectorDeclarationProblems(createFixture(t, { manifest })), []);
});

test('THE REGRESSION: a package that stops declaring one is release-blocking', (t) => {
  const manifest = withoutLine(DECLARING_MANIFEST, 'connectors:');
  assert.doesNotMatch(manifest, /connectors/);
  const problems = connectorDeclarationProblems(createFixture(t, { manifest }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^example: example\/oshal-app\.yaml declares no connector allow-list/);
  assert.match(problems[0], /ABSENT IS NOT EMPTY/);
});

test('a manifest with no dependencies block at all is release-blocking', (t) => {
  const manifest = 'name: example\nversion: 1.2.3\n';
  assert.match(connectorDeclarationProblems(createFixture(t, { manifest }))[0], /declares no connector allow-list/);
});

test('a dependencies block nobody can parse is reported, never graded as declared', (t) => {
  const manifest = DECLARING_MANIFEST.replace('    connectors: [tmdb]', '    connectors: not-a-list');
  const problems = connectorDeclarationProblems(createFixture(t, { manifest }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /neither a flow list nor a block sequence/);
});

test('a catalog entry whose manifest is missing is reported, not skipped', (t) => {
  const problems = connectorDeclarationProblems(createFixture(t, { writeManifest: false }));
  assert.deepEqual(problems, ['example: example/oshal-app.yaml does not exist']);
});

test('the reviewed exemption suppresses the named package and only that one', (t) => {
  const manifest = withoutLine(DECLARING_MANIFEST, 'connectors:');
  const root = createFixture(t, { manifest });
  assert.deepEqual(connectorDeclarationProblems(root, { exempt: { example: 'reviewed' } }), []);
  assert.equal(connectorDeclarationProblems(root, { exempt: { other: 'reviewed' } }).length, 1);
});

test('the shipped exemption list is empty, so no package is excused today', () => {
  assert.deepEqual(Object.keys(UNDECLARED_BY_DECISION), []);
});

test('the real store passes, over a package set that is not empty', () => {
  assert.deepEqual(connectorDeclarationProblems(REPOSITORY_ROOT), []);
  const { apps } = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, 'marketplace.json'), 'utf8'));
  assert.ok(apps.length >= 60, `expected the whole store, graded ${apps.length}`);
  assert.equal(main([], REPOSITORY_ROOT), 0);
});

test('the CLI exits non-zero when a package declares none', (t) => {
  const manifest = withoutLine(DECLARING_MANIFEST, 'connectors:');
  assert.equal(main([], createFixture(t, { manifest })), 1);
});
