/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-16 00:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Mutation-proof the catalog dependency mirror: a tier the catalog flattens, an optional app it drops, a connector allow-list it invents where the manifest declares none, and an unreadable block that must be reported rather than mirrored as "no dependencies". The real-repository case is the one that matters most - the drift this closes was invisible for the whole tiered migration precisely because no check ever read the 61 manifests against the catalog.
 * 2026-09-16 12:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Pin the flat compatibility keys the mirror must keep emitting. Mirroring the tiers alone dropped `dependencies.apps`/`dependencies.tools`/`dependencies.connectors` from all 61 entries, which is what every consumer written before the tiers reads - the product-site generator builds each package page from `connectors` and `apps`, and a package suite asserts an empty `apps` array rather than an absent key. The consumer-read case reads a generated entry exactly the way that generator does, and the repository case asserts the flat keys ARE the contract reductions (required apps, required tools, both-tier connector allow-list) and that the store still yields a non-empty set of each.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogProblems, CURRENT_SCHEMA } from './check-catalog.mjs';
import { generateCatalogDependencies, main as generatorMain } from './gen-catalog-dependencies.mjs';
import { readManifestDependencies } from './manifest-dependencies.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const AUDIT_SHA = 'a'.repeat(40);

const SOURCE = {
  type: 'git-subdir',
  url: 'https://github.com/emeraldcoastsystemsgroup/oshal-apps',
  path: 'example',
  ref: 'main',
};

const TIERED_MANIFEST = [
  'name: example',
  'suite: ai-engineering # reviewed shelf',
  'displayName: Example App',
  'version: 1.2.3',
  'uses: [app-dependencies]',
  'dependencies:',
  '  required:',
  '    # the runtime this package reads from',
  '    apps: [vids]',
  '    tools: []',
  '    connectors: [tmdb]',
  '  optional:',
  '    apps:',
  '      - portrait-studio',
  '      - lora',
  '    tools: []',
  '    connectors: []',
  'source:',
  '  type: git-subdir',
  '  url: https://github.com/emeraldcoastsystemsgroup/oshal-apps',
  '  path: example',
  '  ref: main',
  '',
].join('\n');

const TIERED_MIRROR = {
  // The flat compatibility half: required apps, required tools, and the both-tier connector
  // allow-list - the same three reductions @/shared/app-dependencies exposes over a manifest.
  apps: ['vids'],
  tools: [],
  connectors: ['tmdb'],
  required: { apps: ['vids'], tools: [], connectors: ['tmdb'] },
  optional: { apps: ['portrait-studio', 'lora'], tools: [], connectors: [] },
};

/**
 * @description Build a one-package store in a temporary directory so a mutation can be proved
 * release-blocking without touching the repository.
 * @param {object} t The node:test context, used to remove the fixture afterwards.
 * @param {{ manifest?: string, dependencies?: object|null }} options Manifest text, and the catalog
 *  entry's dependency block (null writes an entry carrying no `dependencies` key at all).
 * @returns {{ root: string, marketplace: object, writeMarketplace: () => void }} The fixture.
 */
function createFixture(t, { manifest = TIERED_MANIFEST, dependencies = TIERED_MIRROR } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oshal-catalog-deps-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'example'));
  fs.writeFileSync(path.join(root, 'example', 'oshal-app.yaml'), manifest);
  fs.writeFileSync(path.join(root, 'README.md'), '# Fixture store\n');
  // A real catalog entry carries an audit binding, and the gate refuses a package whose record
  // does not describe the catalog's version — the shape that made calendar uninstallable.
  fs.mkdirSync(path.join(root, 'audits'));
  fs.writeFileSync(path.join(root, 'audits', 'example.json'), `${JSON.stringify({
    profileVersion: 1, app: 'example', version: '1.2.3', sourceSha: AUDIT_SHA,
    status: 'pending', auditedAt: null, evidence: [],
  }, null, 2)}\n`);
  const entry = {
    name: 'example',
    suite: 'ai-engineering',
    displayName: 'Example App',
    version: '1.2.3',
    source: { ...SOURCE },
    audit: { record: 'audits/example.json', sourceSha: AUDIT_SHA },
  };
  // Cloned: a test that mutates its fixture's block must not edit the shared expectation.
  if (dependencies !== null) entry.dependencies = structuredClone(dependencies);
  const marketplace = { $schema: CURRENT_SCHEMA, apps: [entry] };
  const writeMarketplace = () => fs.writeFileSync(
    path.join(root, 'marketplace.json'),
    `${JSON.stringify(marketplace, null, 2)}\n`,
  );
  writeMarketplace();
  return { root, marketplace, writeMarketplace };
}

const checkFixture = (root) => catalogProblems(root, { checkGeneratedReadme: false });

test('a catalog mirroring the manifest tiers exactly has nothing to report', (t) => {
  const { root } = createFixture(t);
  assert.deepEqual(checkFixture(root), []);
});

test('the pre-tier flat catalog shape is release-blocking drift', (t) => {
  const { root, marketplace, writeMarketplace } = createFixture(t);
  marketplace.apps[0].dependencies = { apps: ['vids'], tools: [], connectors: ['tmdb'] };
  writeMarketplace();
  const problems = checkFixture(root).join('\n');
  assert.match(problems, /example: catalog dependencies=\{"apps":\["vids"\],"tools":\[\],"connectors":\["tmdb"\]\}/);
  assert.match(problems, /manifest dependencies=\{"apps":\["vids"\].*"required":\{"apps":\["vids"\]/);
  assert.match(problems, /gen-catalog-dependencies\.mjs/);
});

test('an optional app the catalog drops is release-blocking drift', (t) => {
  const { root, marketplace, writeMarketplace } = createFixture(t);
  marketplace.apps[0].dependencies.optional.apps = ['portrait-studio'];
  writeMarketplace();
  assert.match(checkFixture(root).join('\n'), /catalog dependencies=.*"optional":\{"apps":\["portrait-studio"\]/);
});

test('a catalog entry carrying no dependency block at all is release-blocking drift', (t) => {
  const { root } = createFixture(t, { dependencies: null });
  assert.match(checkFixture(root).join('\n'), /catalog dependencies=null/);
});

test('an absent connectors key means unfiltered and is mirrored as absent, not as []', (t) => {
  const manifest = TIERED_MANIFEST
    .replace('    connectors: [tmdb]\n', '')
    .replace('    tools: []\n    connectors: []\n', '    tools: []\n');
  const mirror = {
    apps: ['vids'],
    tools: [],
    required: { apps: ['vids'], tools: [] },
    optional: { apps: ['portrait-studio', 'lora'], tools: [] },
  };
  assert.deepEqual(readManifestDependencies(manifest).dependencies, mirror);
  const { root, marketplace, writeMarketplace } = createFixture(t, { manifest, dependencies: mirror });
  assert.deepEqual(checkFixture(root), []);
  marketplace.apps[0].dependencies.required.connectors = [];
  writeMarketplace();
  assert.match(checkFixture(root).join('\n'),
    /catalog dependencies=.*"required":\{"apps":\["vids"\],"tools":\[\],"connectors":\[\]\}/);
});

test('an unreadable dependency block is reported, never mirrored as "no dependencies"', (t) => {
  const manifest = TIERED_MANIFEST.replace('    apps: [vids]', '    apps: vids');
  const { dependencies, problems } = readManifestDependencies(manifest, 'example/oshal-app.yaml');
  assert.equal(dependencies, null);
  assert.match(problems.join('\n'), /value for "apps" is neither a flow list nor a block sequence/);
  const { root } = createFixture(t, { manifest, dependencies: null });
  assert.match(checkFixture(root).join('\n'), /neither a flow list nor a block sequence/);
});

test('an unknown key inside the dependencies block fails closed', () => {
  const manifest = TIERED_MANIFEST.replace('    tools: []\n    connectors: [tmdb]', '    bots: []\n    connectors: [tmdb]');
  const { dependencies, problems } = readManifestDependencies(manifest, 'example/oshal-app.yaml');
  assert.equal(dependencies, null);
  assert.match(problems.join('\n'), /unknown dependency key "bots"/);
});

test('the generator rewrites a drifted catalog into the one the gate accepts', (t) => {
  const { root, marketplace, writeMarketplace } = createFixture(t);
  marketplace.apps[0].dependencies = { apps: ['vids'], tools: [], connectors: ['tmdb'] };
  writeMarketplace();
  assert.notDeepEqual(checkFixture(root), []);
  assert.equal(generatorMain(['--check'], root), 1);
  assert.equal(generatorMain([], root), 0);
  assert.deepEqual(checkFixture(root), []);
  assert.equal(generatorMain(['--check'], root), 0);
  const rewritten = JSON.parse(fs.readFileSync(path.join(root, 'marketplace.json'), 'utf8'));
  assert.deepEqual(rewritten.apps[0].dependencies, TIERED_MIRROR);
  assert.deepEqual(
    Object.keys(rewritten.apps[0]),
    ['name', 'suite', 'displayName', 'version', 'dependencies', 'source', 'audit'],
    'a generated dependency block lands before source, where the catalog already carries it, '
      + 'and the audit binding keeps its place after it — the real catalog\'s order',
  );
});

test('this store’s own catalog mirrors every manifest it ships', () => {
  const { problems, drifted, marketplace } = generateCatalogDependencies(REPOSITORY_ROOT);
  assert.deepEqual(problems, [], 'a manifest dependency block this store ships cannot be read');
  assert.deepEqual(drifted, [], 'run node scripts/gen-catalog-dependencies.mjs');
  assert.ok(marketplace.apps.length >= 61, `only ${marketplace.apps.length} catalog entries were compared`);
  const tiered = marketplace.apps.filter((app) => app.dependencies?.required || app.dependencies?.optional);
  assert.equal(tiered.length, marketplace.apps.length, 'every published package declares the tiered form');
});

test('a generated entry still answers the flat reads a catalog consumer makes', (t) => {
  const { root } = createFixture(t, { dependencies: null });
  assert.equal(generatorMain([], root), 0);
  const entry = JSON.parse(fs.readFileSync(path.join(root, 'marketplace.json'), 'utf8')).apps[0];
  // Read exactly the way the core product-site generator reads an entry
  // (scripts/lib/product-site/catalog.js: `const deps = entry.dependencies || {}`), because that is
  // the consumer a tier-only mirror silently empties.
  const deps = entry.dependencies || {};
  assert.deepEqual((deps.connectors || []).filter(Boolean), ['tmdb'], 'the page lost "Accounts to connect"');
  assert.deepEqual((deps.apps || []).filter(Boolean), ['vids'], 'the page lost its required-apps line');
  assert.deepEqual(deps.tools, [], 'a declared kind is [] in the mirror, never absent');
  // ...and the tiers the mirror exists to carry are still whole.
  assert.deepEqual(deps.required, TIERED_MIRROR.required);
  assert.deepEqual(deps.optional, TIERED_MIRROR.optional);
});

test('the flat keys are required apps and tools, and the both-tier connector allow-list', () => {
  // The optional tier gains a connector; its optional apps were always there.
  const manifest = TIERED_MANIFEST.replace('    connectors: []', '    connectors: [espn-fantasy]');
  const { dependencies, problems } = readManifestDependencies(manifest);
  assert.deepEqual(problems, []);
  assert.deepEqual(dependencies.apps, ['vids'],
    'an OPTIONAL app is not one install refuses to orphan, so it is not a flat app dependency');
  assert.deepEqual(dependencies.tools, []);
  assert.deepEqual(dependencies.connectors, ['tmdb', 'espn-fantasy'],
    'an optional connector is still an account the app offers, so the allow-list spans both tiers');
  assert.deepEqual(dependencies.optional.apps, ['portrait-studio', 'lora'],
    'the tiers keep the detail the flat view reduces away');
});

test('the legacy flat form mirrors as itself, because flat means all-required', () => {
  const manifest = TIERED_MANIFEST.replace(
    [
      'dependencies:',
      '  required:',
      '    # the runtime this package reads from',
      '    apps: [vids]',
      '    tools: []',
      '    connectors: [tmdb]',
      '  optional:',
      '    apps:',
      '      - portrait-studio',
      '      - lora',
      '    tools: []',
      '    connectors: []',
    ].join('\n'),
    ['dependencies:', '  apps: [vids]', '  tools: []', '  connectors: [tmdb]'].join('\n'),
  );
  const { dependencies, problems } = readManifestDependencies(manifest);
  assert.deepEqual(problems, []);
  assert.deepEqual(dependencies, { apps: ['vids'], tools: [], connectors: ['tmdb'] });
});

test('every catalog entry this store ships answers those flat reads too', () => {
  const { problems, marketplace } = generateCatalogDependencies(REPOSITORY_ROOT);
  assert.deepEqual(problems, []);
  const withConnectors = [];
  const withApps = [];
  for (const app of marketplace.apps) {
    const deps = app.dependencies ?? {};
    const required = deps.required ?? {};
    const optional = deps.optional ?? {};
    for (const kind of ['apps', 'tools']) {
      if (!required[kind] && !optional[kind]) continue;
      assert.deepEqual(deps[kind], required[kind] ?? [],
        `${app.name}: dependencies.${kind} must be the required tier`);
    }
    if (required.connectors || optional.connectors) {
      assert.deepEqual(deps.connectors, [...(required.connectors ?? []), ...(optional.connectors ?? [])],
        `${app.name}: dependencies.connectors must be the both-tier allow-list`);
    }
    if ((deps.connectors ?? []).length) withConnectors.push(app.name);
    if ((deps.apps ?? []).length) withApps.push(app.name);
  }
  // Floors, not fixtures: the mirror that dropped these keys scored 0 and 0. They only ever need
  // raising, and a package genuinely leaving the store is the one intentional edit.
  assert.ok(withConnectors.length >= 19, `only ${withConnectors.length} entries name a connector`);
  assert.ok(withApps.length >= 5, `only ${withApps.length} entries name a required app`);
});
