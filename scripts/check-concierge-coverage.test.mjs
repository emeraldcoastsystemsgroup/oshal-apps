/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-23 00:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Mutation-proof the whole-tree concierge contract: comments and blank values are not declarations, static, dynamic and ADR-141 group surfaces each fail without a rail, and each supported rail shape passes without an allowlist.
 * 2026-09-23 01:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Pin YAML parser parity: implicit non-string scalars never count on any concierge rail, quoted equivalents remain strings, and valid anchor/alias/merge/anchored-key shapes plus nested duplicate keys are refused rather than invisibly misgraded.
 * 2026-09-23 02:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Pin the shared surface matrix: only group toolbars count, empty dynamic declarations stay headless, and non-empty dynamic declarations require coverage.
 * 2026-09-23 03:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Exercise exact scalar/indicator boundaries, complex and YAML-escaped keys, nested flow-bot lookalikes, and unsupported root shapes so valid YAML cannot evade or falsely trip the zero-dependency projection.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  conciergeCoverage, main, parseConciergeProjection,
} from './check-concierge-coverage.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Build a disposable store whose package set is discovered from manifests, not a catalog list. */
function createFixture(t, manifests) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oshal-concierge-coverage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [directory, manifest] of Object.entries(manifests)) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
    fs.writeFileSync(path.join(root, directory, 'oshal-app.yaml'), manifest);
  }
  return root;
}

const manifest = (body) => `name: example\nversion: 1.0.0\n${body.trim()}\n`;

test('comments and blank chatBot values do not count as a concierge', () => {
  const source = manifest(`
# chatBot: pretend-comment
chatBot: # general-bot is not a value
ui:
  static:
    - toolName: home
      iframeUrl: /api/example
`);
  const projection = parseConciergeProjection(source);
  assert.deepEqual(projection.surfaces, ['ui.static']);
  assert.equal(projection.concierge, '');
});

test('a static cockpit surface without a concierge is release-blocking', (t) => {
  const root = createFixture(t, { example: manifest(`
ui:
  static:
    - { toolName: home, iframeUrl: /api/example }
`) });
  const { problems } = conciergeCoverage(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /ui\.static/);
});

test('a dynamic cockpit surface without a concierge is release-blocking', (t) => {
  const root = createFixture(t, { example: manifest(`
ui:
  dynamic:
    source: example_rows
    toolNameTemplate: example-{id}
`) });
  const { problems } = conciergeCoverage(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /ui\.dynamic/);
});

test('an ADR-141 group toolbar without a concierge is release-blocking', (t) => {
  const root = createFixture(t, { example: manifest(`
kind: group
toolbar:
  - { app: member, surface: member-home }
`) });
  const { problems } = conciergeCoverage(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /toolbar/);
});

test('a non-group toolbar is not a cockpit surface', () => {
  const projection = parseConciergeProjection(manifest(`
kind: app
toolbar:
  - { app: member, surface: member-home }
`));
  assert.deepEqual(projection.surfaces, []);
  assert.deepEqual(projection.problems, []);
});

test('an undecodable group kind cannot hide toolbar coverage', () => {
  const projection = parseConciergeProjection(manifest(`
kind: "\\x67roup"
toolbar:
  - { app: member, surface: member-home }
`));
  assert.deepEqual(projection.surfaces, []);
  assert.match(projection.problems.join('\n'), /top-level kind must use a directly decodable string scalar/);
});

test('empty dynamic declarations stay headless while non-empty dynamic is surfaced', () => {
  for (const body of ['ui:\n  dynamic:', 'ui:\n  dynamic: {}']) {
    const projection = parseConciergeProjection(manifest(body));
    assert.deepEqual(projection.surfaces, [], body);
    assert.deepEqual(projection.problems, [], body);
  }
  const populated = parseConciergeProjection(manifest('ui:\n  dynamic: { source: records }'));
  assert.deepEqual(populated.surfaces, ['ui.dynamic']);
});

test('a flow-style ui surface cannot evade coverage', (t) => {
  const root = createFixture(t, {
    example: manifest('ui: { static: [{ toolName: home, iframeUrl: /api/example }] }'),
  });
  const { problems } = conciergeCoverage(root);
  assert.ok(problems.length >= 1);
  assert.match(problems.join('\n'), /top-level ui uses an unsupported nonempty inline/);
});

test('unsupported root flow and indentation shapes fail closed', () => {
  const flow = parseConciergeProjection(
    '{ name: example, version: 1.0.0, ui: { static: [{ toolName: home }] } }\n',
  );
  assert.match(flow.problems.join('\n'), /flow-style document root is unsupported/);

  const indented = parseConciergeProjection(`
  name: example
  version: 1.0.0
  ui:
    static: [{ toolName: home }]
`);
  assert.match(indented.problems.join('\n'), /indented document root is unsupported/);

  for (const marked of [
    '---\n{ name: example, version: 1.0.0, ui: { static: [{ toolName: home }] } }\n',
    '---\n  name: example\n  version: 1.0.0\n  ui:\n    static: [{ toolName: home }]\n',
  ]) {
    const projection = parseConciergeProjection(marked);
    assert.match(projection.problems.join('\n'), /YAML document markers and directives are unsupported/);
  }
});

test('unsupported inline and alias forms fail closed instead of being guessed', () => {
  for (const body of [
    'ui: *shared-ui',
    'workflow: { workerBot: worker }',
    'bots: *shared-bots',
  ]) {
    const projection = parseConciergeProjection(manifest(body));
    assert.ok(projection.problems.length >= 1, body);
    assert.match(projection.problems.join('\n'), /unsupported nonempty inline, anchored, or alias form/);
  }
});

test('indicator characters inside valid plain scalars are not YAML indirection', () => {
  for (const description of ['Research & Development', 'foo *bar', 'wow !important']) {
    const projection = parseConciergeProjection(manifest(`
description: ${description}
chatBot: general-bot
ui:
  static: [{ toolName: home }]
`));
    assert.deepEqual(projection.problems, [], description);
    assert.equal(projection.concierge, 'general-bot', description);
  }
});

test('an alias nested under ui cannot hide a surface', () => {
  const projection = parseConciergeProjection(manifest(`
ui:
  static: *shared-surfaces
`));
  assert.equal(projection.surfaces.length, 0);
  assert.match(projection.problems.join('\n'), /ui\.static uses an unsupported alias/);
});

test('quoted relevant keys are parsed structurally', () => {
  const projection = parseConciergeProjection(manifest(`
"ui":
  'static':
    - { toolName: home }
`));
  assert.deepEqual(projection.surfaces, ['ui.static']);
  assert.equal(projection.concierge, '');
});

test('duplicate relevant keys and top-level merge aliases fail closed', () => {
  const duplicate = parseConciergeProjection(manifest(`
ui: {}
ui:
  static: [{ toolName: hidden-by-first-key }]
`));
  assert.match(duplicate.problems[0], /repeats top-level ui/);

  const merged = parseConciergeProjection(manifest(`
defaults: &defaults
  chatBot: hidden
<<: *defaults
`));
  assert.match(merged.problems.join('\n'), /YAML anchors, aliases, merge keys, and tags are unsupported/);
});

test('anchored relevant keys and nested merge aliases fail closed', () => {
  const anchoredKey = parseConciergeProjection(manifest(`
&uiKey ui:
  static: [{ toolName: hidden-surface }]
`));
  assert.match(
    anchoredKey.problems.join('\n'),
    /YAML anchors, aliases, merge keys, and tags are unsupported/,
  );

  const anchoredNestedKey = parseConciergeProjection(manifest(`
ui:
  &staticKey static:
    - { toolName: hidden-surface }
`));
  assert.match(
    anchoredNestedKey.problems.join('\n'),
    /YAML anchors, aliases, merge keys, and tags are unsupported/,
  );

  const aliasedKey = parseConciergeProjection(manifest(`
uiName: &uiKey ui
? *uiKey
:
  static: [{ toolName: hidden-surface }]
`));
  assert.match(
    aliasedKey.problems.join('\n'),
    /YAML anchors, aliases, merge keys, and tags are unsupported/,
  );

  const nestedMerge = parseConciergeProjection(manifest(`
surface: &surface
  static: [{ toolName: inherited-surface }]
ui:
  <<: *surface
`));
  assert.match(nestedMerge.problems.join('\n'), /YAML anchors, aliases, merge keys, and tags are unsupported/);
});

test('complex and unsupported escaped mapping keys fail closed', () => {
  const complex = parseConciergeProjection(manifest(`
? ui
:
  static: [{ toolName: hidden-surface }]
`));
  assert.match(complex.problems.join('\n'), /explicit complex mapping keys are unsupported/);

  const escaped = parseConciergeProjection(manifest(`
"\\x75i":
  static: [{ toolName: hidden-surface }]
`));
  assert.match(escaped.problems.join('\n'), /quoted mapping key uses YAML-only escapes/);
});

test('duplicate nested ui and concierge keys fail closed', () => {
  for (const body of [
    'ui:\n  static: []\n  static: [{ toolName: hidden }]',
    'ui:\n  dynamic: {}\n  dynamic: { source: hidden_rows }',
    'workflow:\n  workerBot: first\n  workerBot: second',
    'bots:\n  - name: first\n    name: second',
  ]) {
    const projection = parseConciergeProjection(manifest(body));
    assert.match(projection.problems.join('\n'), /repeats (?:ui\.(?:static|dynamic)|workflow\.workerBot|bots\[0\]\.name)/, body);
  }
});

test('flow merge aliases cannot hide a ui.static surface', () => {
  const projection = parseConciergeProjection(manifest(`
surface: &surface
  static: [{ toolName: inherited-surface }]
ui: { <<: *surface }
`));
  assert.match(projection.problems.join('\n'), /YAML anchors, aliases, merge keys, and tags are unsupported/);
  assert.match(projection.problems.join('\n'), /top-level ui uses an unsupported nonempty inline/);
});

test('aliased concierge scalar names do not count', () => {
  const projection = parseConciergeProjection(manifest(`
chatBot: *shared-bot
ui:
  static: [{ toolName: home }]
`));
  assert.equal(projection.concierge, '');
  assert.match(projection.problems.join('\n'), /chatBot uses an unsupported alias/);
});

test('unquoted YAML non-string scalars never count as chatBot names', () => {
  for (const scalar of [
    'true', 'FALSE', 'null', '~', '42', '-1.5', '0x2a', '0o52', '0b1010',
    '.inf', '.NaN', '1e3', '2026-09-23', '2026-09-23T12:30:00Z',
  ]) {
    const projection = parseConciergeProjection(manifest(`
chatBot: ${scalar}
ui:
  static: [{ toolName: home }]
`));
    assert.equal(projection.concierge, '', scalar);
    assert.match(projection.problems.join('\n'), /chatBot resolves to a non-string YAML scalar/, scalar);
  }
});

test('non-string workerBot and first bot names never count', () => {
  const worker = parseConciergeProjection(manifest(`
workflow:
  workerBot: false
ui:
  static: [{ toolName: home }]
`));
  assert.equal(worker.concierge, '');
  assert.match(worker.problems.join('\n'), /workflow\.workerBot resolves to a non-string YAML scalar/);

  const bot = parseConciergeProjection(manifest(`
bots:
  - name: 2026-09-23
ui:
  static: [{ toolName: home }]
`));
  assert.equal(bot.concierge, '');
  assert.match(bot.problems.join('\n'), /bots\[0\]\.name resolves to a non-string YAML scalar/);
});

test('flow bot mappings and nested name lookalikes cannot become the concierge', () => {
  for (const bots of [
    'bots:\n  - { metadata: { name: fake } }',
    'bots:\n  - { note: "name: fake" }',
    'bots:\n  - metadata:\n      name: fake',
  ]) {
    const projection = parseConciergeProjection(manifest(`${bots}\nui:\n  static: [{ toolName: home }]`));
    assert.equal(projection.concierge, '', bots);
    if (bots.includes('{')) {
      assert.match(projection.problems.join('\n'), /bots\[0\] uses an unsupported flow mapping/, bots);
    }
  }
});

test('plain scalar spellings retained as strings by js-yaml remain valid names', () => {
  for (const scalar of [
    '+.5', '-.5', '2026-09-23T12:30:00nope', 'TrUe', 'NuLl', '0X2a', '.nAn',
  ]) {
    const projection = parseConciergeProjection(manifest(`
chatBot: ${scalar}
ui:
  static: [{ toolName: home }]
`));
    assert.equal(projection.concierge, scalar, scalar);
    assert.doesNotMatch(projection.problems.join('\n'), /non-string YAML scalar/, scalar);
  }
});

test('quoted scalar spellings remain valid string concierge names', () => {
  for (const scalar of ['"true"', "'42'", '"2026-09-23"']) {
    const projection = parseConciergeProjection(manifest(`
chatBot: ${scalar}
ui:
  static: [{ toolName: home }]
`));
    assert.notEqual(projection.concierge, '', scalar);
    assert.doesNotMatch(projection.problems.join('\n'), /non-string YAML scalar/, scalar);
  }
});

test('top-level chatBot is a valid concierge rail', () => {
  const projection = parseConciergeProjection(manifest(`
chatBot: general-bot
ui:
  static: [{ toolName: home }]
`));
  assert.equal(projection.concierge, 'general-bot');
  assert.equal(projection.rail, 'chatBot');
});

test('workflow.workerBot is a valid concierge rail', () => {
  const projection = parseConciergeProjection(manifest(`
workflow:
  workerBot: domain-worker
ui:
  dynamic: { source: records }
`));
  assert.equal(projection.concierge, 'domain-worker');
  assert.equal(projection.rail, 'workflow.workerBot');
});

test('the first bots item is a valid concierge rail', () => {
  const projection = parseConciergeProjection(manifest(`
bots:
  - agentId: 00000000-0000-0000-0000-000000000001
    name: packaged-concierge
  - name: not-the-default
ui:
  static:
    - { toolName: home }
`));
  assert.equal(projection.concierge, 'packaged-concierge');
  assert.equal(projection.rail, 'bots[0].name');
});

test('a headless package needs no concierge and commented surfaces do not create one', (t) => {
  const root = createFixture(t, { example: manifest(`
# ui:
#   static: [{ toolName: imaginary }]
routes:
  - module: routes/example.js
`) });
  assert.deepEqual(conciergeCoverage(root).problems, []);
});

test('the gate discovers every manifest directory instead of grading an allowlist', (t) => {
  const root = createFixture(t, {
    first: manifest('chatBot: one\nui:\n  static: [{ toolName: one }]'),
    second: manifest('ui:\n  static: [{ toolName: two }]'),
  });
  const result = conciergeCoverage(root);
  assert.equal(result.packageCount, 2);
  assert.equal(result.surfaceCount, 2);
  assert.equal(result.coveredCount, 1);
  assert.match(result.problems[0], /^second\/oshal-app\.yaml:/);
});

test('the real store has no uncovered cockpit surface', () => {
  const result = conciergeCoverage(REPOSITORY_ROOT);
  assert.deepEqual(result.problems, []);
  assert.ok(result.packageCount >= 61, `expected whole store discovery, got ${result.packageCount}`);
  assert.ok(result.surfaceCount >= 61, `expected every current package surface, got ${result.surfaceCount}`);
  assert.equal(result.coveredCount, result.surfaceCount);
});

test('the CLI exits non-zero for an uncovered surface', (t) => {
  const root = createFixture(t, { example: manifest('ui:\n  static: [{ toolName: home }]') });
  assert.equal(main([], root), 1);
});
