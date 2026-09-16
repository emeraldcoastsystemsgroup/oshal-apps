/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Mutation-prove the engine-container gate: every one of the load-bearing properties goes red on its own when removed from an otherwise clean fixture, a comment naming oshal.tier is not mistaken for the label, and the doc's precedent table has to agree with what the tree actually ships. The last test runs the gate against THIS repository's real packages and real BUILDING-EXTENSIONS.md, so the fixtures cannot pass while the shipped engines diverge.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineContainerProblems, enginePackages, DOC_HEADING } from './check-engine-container-pattern.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const COMPOSE = [
  '# My App engine -- its OWN compose project.',
  'name: oshal-my-app-engine',
  'services:',
  '  my-app-engine:',
  '    image: oshal-my-app-engine:local',
  '    container_name: oshal-my-app-engine',
  '    read_only: true',
  '    labels:',
  '      oshal.app: my-app',
  '    networks:',
  '      oshal:',
  '        aliases:',
  '          - my-app-engine',
  'networks:',
  '  oshal:',
  '    external: true',
  '    name: ${OSHAL_NETWORK:-oshal-local_oshal}',
  '',
].join('\n');

const INSTALL = [
  '#!/bin/sh',
  'set -eu',
  'unset COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_ROOT',
  'PROJECT=oshal-my-app-engine',
  'CONTAINER=oshal-my-app-engine',
  'docker build -t oshal-my-app-engine:local -f "$ENGINE_DIR/container/Dockerfile" "$ENGINE_DIR"',
  'OSHAL_NETWORK="$NETWORK" docker compose -p "$PROJECT" -f "$ENGINE_DIR/container/compose.yaml" up -d --no-build',
  'got=$(docker inspect "$CONTAINER" --format \'{{index .Config.Labels "com.docker.compose.project"}}\')',
  '[ "$got" = "$PROJECT" ] || die "landed in \'$got\', not \'$PROJECT\'"',
  '',
].join('\n');

const ROUTE = [
  'const INSTALL_HINT = `docker exec ${host} sh /app/workspace-shared/deployed-apps/my-app/engine/install-engine.sh`;',
  'function status() { return { buildHash: helloHash, expectedBuildHash, installHint: INSTALL_HINT }; }',
  '',
].join('\n');

const DOC = [
  '# Building an OSHAL extension',
  '',
  '## 7. ' + DOC_HEADING,
  '',
  '| package | engine | why a container | alias the route dials |',
  '|---|---|---|---|',
  '| `my-app` | something native | no musl wheel | `my-app-engine:7411` |',
  '',
  '## 8. The CLI',
  '',
].join('\n');

function write(root, relative, text) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oshal-engine-pattern-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'my-app/engine/container/compose.yaml', COMPOSE);
  write(root, 'my-app/engine/container/Dockerfile', 'FROM python:3.11-slim-bookworm\n');
  write(root, 'my-app/engine/install-engine.sh', INSTALL);
  write(root, 'my-app/routes/my-app-routes.js', ROUTE);
  write(root, 'BUILDING-EXTENSIONS.md', DOC);
  return root;
}

/** Assert the fixture is red, and that at least one problem names the thing that was broken. */
function assertRed(root, needle) {
  const problems = engineContainerProblems(root);
  assert.ok(problems.length > 0, 'expected the gate to fail, it passed');
  assert.ok(
    problems.some((problem) => problem.includes(needle)),
    `no problem mentioned ${JSON.stringify(needle)}; got ${JSON.stringify(problems)}`,
  );
}

test('a package that follows the pattern raises nothing', (t) => {
  const root = createFixture(t);
  assert.deepEqual(engineContainerProblems(root), []);
  assert.deepEqual(enginePackages(root), ['my-app']);
});

test('a directory with no engine container is not checked at all', (t) => {
  const root = createFixture(t);
  write(root, 'plain-app/routes/plain.js', 'module.exports = {};\n');
  assert.deepEqual(engineContainerProblems(root), []);
});

test('an inherited core compose project name is release-blocking', (t) => {
  const root = createFixture(t);
  write(root, 'my-app/engine/container/compose.yaml', COMPOSE.replace('name: oshal-my-app-engine', 'name: oshal-local'));
  assertRed(root, 'must be "oshal-my-app-engine"');
});

test('labelling the engine oshal.tier is release-blocking', (t) => {
  const root = createFixture(t);
  write(root, 'my-app/engine/container/compose.yaml', COMPOSE.replace('      oshal.app: my-app', '      oshal.app: my-app\n      oshal.tier: worker'));
  assertRed(root, 'oshal.tier');
});

test('a comment explaining why there is no oshal.tier label is not the label', (t) => {
  const root = createFixture(t);
  write(root, 'my-app/engine/container/compose.yaml', COMPOSE.replace(
    'services:',
    '# Deliberately NO oshal.tier: label -- Prometheus discovers scrape targets by it.\nservices:',
  ));
  assert.deepEqual(engineContainerProblems(root), []);
});

test('publishing a host port is release-blocking', (t) => {
  const root = createFixture(t);
  write(root, 'my-app/engine/container/compose.yaml', COMPOSE.replace('    read_only: true', '    read_only: true\n    ports:\n      - "7411:7411"'));
  assertRed(root, 'publishes a host port');
});

test('creating its own network instead of joining the stack is release-blocking', (t) => {
  const root = createFixture(t);
  write(root, 'my-app/engine/container/compose.yaml', COMPOSE.replace('    external: true\n', ''));
  assertRed(root, 'does not join an external network');
});

test('an engine container with no installer is release-blocking', (t) => {
  const root = createFixture(t);
  fs.rmSync(path.join(root, 'my-app/engine/install-engine.sh'));
  assertRed(root, 'install-engine.sh is missing');
});

test('an installer that does not unset the inherited COMPOSE_PROJECT_NAME is release-blocking', (t) => {
  const root = createFixture(t);
  write(root, 'my-app/engine/install-engine.sh', INSTALL.replace(/^unset .*$/m, 'unset COMPOSE_FILE'));
  assertRed(root, 'does not unset COMPOSE_PROJECT_NAME');
});

test('an installer whose PROJECT disagrees with its compose file is release-blocking', (t) => {
  const root = createFixture(t);
  write(root, 'my-app/engine/install-engine.sh', INSTALL.replace('PROJECT=oshal-my-app-engine', 'PROJECT=oshal-myapp-engine'));
  assertRed(root, 'does not pin PROJECT=oshal-my-app-engine');
});

test('an installer that does not pass -p "$PROJECT" is release-blocking', (t) => {
  const root = createFixture(t);
  write(root, 'my-app/engine/install-engine.sh', INSTALL.replace('docker compose -p "$PROJECT" ', 'docker compose '));
  assertRed(root, 'does not pass -p');
});

test('unsetting the variable without reading the project label back is release-blocking', (t) => {
  const root = createFixture(t);
  write(root, 'my-app/engine/install-engine.sh', INSTALL.split('\n').filter((line) => !line.includes('com.docker.compose.project')).join('\n'));
  assertRed(root, 'does not assert com.docker.compose.project after up');
});

test('a route layer that never names the install script is release-blocking', (t) => {
  const root = createFixture(t);
  write(root, 'my-app/routes/my-app-routes.js', ROUTE.replace('/app/workspace-shared/deployed-apps/my-app/engine/install-engine.sh', 'run the installer'));
  assertRed(root, 'no route module names install-engine.sh');
});

test('an engine whose reason never reaches the surface as an install hint is release-blocking', (t) => {
  const root = createFixture(t);
  write(root, 'my-app/routes/my-app-routes.js', ROUTE.replace(/installHint|INSTALL_HINT/g, 'setupText'));
  assertRed(root, 'no route module surfaces an installHint');
});

test('an engine with no build-hash comparison is release-blocking', (t) => {
  const root = createFixture(t);
  write(root, 'my-app/routes/my-app-routes.js', ROUTE.replace(/buildHash|expectedBuildHash/g, 'version'));
  assertRed(root, 'no route module compares a build hash');
});

test('deleting the documented pattern is release-blocking', (t) => {
  const root = createFixture(t);
  write(root, 'BUILDING-EXTENSIONS.md', DOC.replace('## 7. ' + DOC_HEADING, '## 7. Something else'));
  assertRed(root, `has no "${DOC_HEADING}" section`);
});

test('the section keeps its identity when the doc is renumbered or relevelled', (t) => {
  const root = createFixture(t);
  write(root, 'BUILDING-EXTENSIONS.md', DOC.replace('## 7. ' + DOC_HEADING, '### ' + DOC_HEADING).replace('## 8. The CLI', '### The CLI'));
  assert.deepEqual(engineContainerProblems(root), []);
});

test('a second package that hand-rolls an engine without documenting it is release-blocking', (t) => {
  const root = createFixture(t);
  write(root, 'other-app/engine/container/compose.yaml', COMPOSE.replace(/my-app/g, 'other-app'));
  write(root, 'other-app/engine/install-engine.sh', INSTALL.replace(/my-app/g, 'other-app'));
  write(root, 'other-app/routes/other-app-routes.js', ROUTE.replace(/my-app/g, 'other-app'));
  assertRed(root, 'other-app owns an engine container but the section');
});

test('a precedent table row for a package that ships no engine is release-blocking', (t) => {
  const root = createFixture(t);
  write(root, 'BUILDING-EXTENSIONS.md', DOC.replace(
    '| `my-app` |',
    '| `retired-app` | gone | gone | `retired-app-engine:7411` |\n| `my-app` |',
  ));
  assertRed(root, 'lists retired-app');
});

test('this repository\'s real engine packages and real documentation agree', () => {
  const packages = enginePackages(REPOSITORY_ROOT);
  assert.ok(packages.length >= 2, `expected shipped engine packages, found ${JSON.stringify(packages)}`);
  assert.deepEqual(engineContainerProblems(REPOSITORY_ROOT), []);
});
