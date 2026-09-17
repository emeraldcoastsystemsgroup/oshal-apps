/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Hold this package's prerequisite declaration to what its code actually does: the tiers must read through the store's OWN catalog reader, every kernel skill the code imports must be declared in uses:, the tiered block must name its compatibility floor, the connector allow-list must stay declared-and-empty, and no source file may reach outside the package. A catalog --check cannot stand in for any of this - marketplace.json is GENERATED from this manifest, so a declaration that goes missing disappears from both sides at once and the mirror stays "current".
 * -----------------------------------------------------------------------------
 *
 * Dependency-free prerequisite contract for the Little Monsters store package.
 * It deliberately runs under the existing tests/*.test.cjs store-CI glob.
 *
 * @module lm-dependencies.test
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const STORE_ROOT = path.resolve(PACKAGE_ROOT, '..');
const MANIFEST_PATH = path.join(PACKAGE_ROOT, 'oshal-app.yaml');
const MANIFEST = fs.readFileSync(MANIFEST_PATH, 'utf8');

/** The reader marketplace.json is generated with — never a second, ad-hoc YAML parse. */
const readerPromise = import(pathToFileURL(path.join(STORE_ROOT, 'scripts', 'manifest-dependencies.mjs')).href);

/**
 * Kernel-skill modules, as the framework contracts them in
 * src/shared/kernel-skills/registry.ts. Only the skills reachable from a package of this shape are
 * listed; the point is the direction, not completeness — an import on the left obliges the skill id
 * on the right to appear in `uses:`, or the framework may prune the module out of the built image
 * and this app fails at MOUNT (the way it already lost google-calendar and notifications).
 */
const SKILL_BY_SPECIFIER = new Map([
  ['@/features/presentation-generation', 'deck-generation'],
  ['@/app/routes/storage-target', 'storage'],
  ['@/features/voice-providers', 'voice'],
  ['@/features/voice', 'voice'],
  ['@/features/rag', 'rag'],
  ['@/features/tool-registry', 'tool-registry'],
  ['@/features/llm-provider', 'tool-registry'],
  ['@/features/notifications', 'notifications'],
  ['@/features/scheduling', 'scheduling'],
  ['@/features/memory', 'memory'],
  ['@/features/graph', 'graph'],
  ['@/features/payments', 'payments'],
  ['@/features/spatial-mapping', 'spatial-mapping'],
  ['@/shared/package-tools', 'package-tools'],
  ['@/shared/application-authorization', 'application-authorization'],
  ['@/shared/app-dependencies', 'app-dependencies'],
]);

/**
 * Framework specifiers this package imports that NO kernel skill contracts. They are in the built
 * image today only because core's own entrypoints import them, not because anything promises them
 * to a package. Recorded rather than asserted away: a NEW entry here is a deliberate decision, and
 * an import that is neither here nor in SKILL_BY_SPECIFIER fails this suite.
 */
const UNCONTRACTED_FRAMEWORK_SPECIFIERS = new Set([
  '@/shared/logger',
  '@/shared/services/database',
  '@/app/composition/app-context',
  '@/app/routes/tool-routes',
  '@/app/routes/inline-bot-execution',
  '@/features/agent-management',
  '@/features/swarm-orchestration/services/prompt-containment',
  '@/entities/ticket/internal-ticket',
]);

/** Source trees whose imports decide what this package needs at runtime. */
const SOURCE_DIRECTORIES = ['src-routes', 'routes'];

/** @description Every file under the package's source trees, by extension. */
function sourceFiles() {
  const files = [];
  for (const directory of SOURCE_DIRECTORIES) {
    const full = path.join(PACKAGE_ROOT, directory);
    if (!fs.existsSync(full)) continue;
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      if (entry.isFile() && /\.(ts|js|cjs|mjs)$/.test(entry.name)) files.push(path.join(full, entry.name));
    }
  }
  return files;
}

/** @description Every module specifier one file imports or requires, static or lazy. */
function specifiersIn(text) {
  const found = [];
  for (const match of text.matchAll(/(?:from|require\()\s*['"]([^'"]+)['"]/g)) found.push(match[1]);
  for (const match of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(match[1]);
  return found;
}

/** @description The `uses:` block as a list of skill ids. */
function declaredSkills() {
  const lines = MANIFEST.split(/\r?\n/);
  const start = lines.findIndex((line) => /^uses:\s*$/.test(line));
  assert.ok(start >= 0, 'manifest declares a uses: block');
  const ids = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') continue;
    if (!/^\s/.test(line)) break;
    const match = /^\s+-\s+([a-z][a-z0-9-]*)/.exec(line);
    if (match) ids.push(match[1]);
  }
  return ids;
}

test('the dependency block reads through the store\'s own catalog reader, with no problem', async () => {
  const { readManifestDependencies } = await readerPromise;
  const { dependencies, problems } = readManifestDependencies(MANIFEST, 'little-monsters/oshal-app.yaml');
  // The reader fails CLOSED: a block it cannot read comes back null. Catching that here is the
  // whole point — a null block is mirrored into marketplace.json as "declares nothing", which is
  // indistinguishable from a truthful empty declaration once it is in the catalog.
  assert.deepEqual(problems, [], 'the dependencies block must be readable by the catalog generator');
  assert.ok(dependencies, 'the manifest must declare a dependencies block');
  assert.ok(dependencies.required, 'the block must declare a required tier');
  assert.ok(dependencies.optional, 'the block must declare an optional tier');
});

test('every kernel skill this package imports is declared in uses:', () => {
  const skills = new Set(declaredSkills());
  const missing = new Map();
  for (const file of sourceFiles()) {
    for (const specifier of specifiersIn(fs.readFileSync(file, 'utf8'))) {
      const skill = SKILL_BY_SPECIFIER.get(specifier);
      if (skill && !skills.has(skill)) missing.set(skill, `${path.relative(PACKAGE_ROOT, file)} imports ${specifier}`);
    }
  }
  assert.deepEqual([...missing.entries()], [],
    'a kernel module imported without its skill in uses: can be pruned from the built image, and the app then fails at mount');
});

test('the four skills the code proves are declared, and their import sites still exist', () => {
  const skills = new Set(declaredSkills());
  const proofs = [
    ['deck-generation', 'src-routes/education-pptx.ts', '@/features/presentation-generation'],
    ['storage', 'src-routes/education-pptx.ts', '@/app/routes/storage-target'],
    ['voice', 'src-routes/education-voice-routes.ts', '@/features/voice-providers'],
    ['rag', 'src-routes/education-tutor-routes.ts', '@/features/rag'],
  ];
  for (const [skill, file, specifier] of proofs) {
    assert.ok(skills.has(skill), `uses: must declare ${skill}`);
    const source = fs.readFileSync(path.join(PACKAGE_ROOT, file), 'utf8');
    assert.ok(specifiersIn(source).includes(specifier), `${file} must still import ${specifier} (the proof for ${skill})`);
  }
});

test('the tiered block names the app-dependencies compatibility floor', async () => {
  const { readManifestDependencies } = await readerPromise;
  const { dependencies } = readManifestDependencies(MANIFEST, 'little-monsters/oshal-app.yaml');
  assert.ok(dependencies.required && dependencies.optional, 'this package uses the tiered form');
  // scripts/oshal-app-dependencies.js refuses a tiered block that does not name this floor: an
  // older core would otherwise install the package while silently dropping both tiers.
  assert.ok(declaredSkills().includes('app-dependencies'),
    'a required/optional block must declare uses: [app-dependencies] so an older core refuses it instead of dropping the tiers');
});

test('the connector allow-list stays DECLARED and empty in both tiers', async () => {
  const { readManifestDependencies } = await readerPromise;
  const { dependencies } = readManifestDependencies(MANIFEST, 'little-monsters/oshal-app.yaml');
  // Absent is not the same as []. With no connectors key anywhere the platform allow-list is null,
  // which means UNFILTERED — the cockpit then pins the Connectors tile and the whole provider
  // catalog inside a children's app (RibbonNav.js connectorsAllowed, renderConnectorDiscoverView).
  assert.deepEqual(dependencies.required.connectors, [], 'required.connectors must be declared and empty');
  assert.deepEqual(dependencies.optional.connectors, [], 'optional.connectors must be declared and empty');
  assert.deepEqual(dependencies.connectors, [], 'the mirrored allow-list must be an empty list, never absent');
});

test('no app or tool prerequisite is declared, and nothing in the package contradicts that', async () => {
  const { readManifestDependencies } = await readerPromise;
  const { dependencies } = readManifestDependencies(MANIFEST, 'little-monsters/oshal-app.yaml');
  for (const tier of ['required', 'optional']) {
    assert.deepEqual(dependencies[tier].apps, [], `${tier}.apps must stay empty while nothing here reads another package`);
    assert.deepEqual(dependencies[tier].tools, [], `${tier}.tools must stay empty while nothing here uses a registry tool`);
  }
  // The claim above is only true while the code stays inside the package and the framework aliases.
  const escapes = [];
  const unknown = [];
  for (const file of sourceFiles()) {
    for (const specifier of specifiersIn(fs.readFileSync(file, 'utf8'))) {
      const where = `${path.relative(PACKAGE_ROOT, file)} -> ${specifier}`;
      if (specifier.startsWith('.')) {
        const resolved = path.resolve(path.dirname(file), specifier);
        const relative = path.relative(PACKAGE_ROOT, resolved);
        if (relative.startsWith('..') || path.isAbsolute(relative)) escapes.push(where);
        continue;
      }
      if (!specifier.startsWith('@/')) continue;
      if (!SKILL_BY_SPECIFIER.has(specifier) && !UNCONTRACTED_FRAMEWORK_SPECIFIERS.has(specifier)) unknown.push(where);
    }
  }
  assert.deepEqual(escapes, [],
    'a relative import that leaves the package reads another package\'s files at runtime — that is a dependency, declare it');
  assert.deepEqual(unknown, [],
    'a new @/ framework import must be recorded: map it to its kernel skill and declare that skill, or record why no skill contracts it');
});

test('no surface or route calls another installed package\'s mount', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(STORE_ROOT, 'marketplace.json'), 'utf8'));
  const others = catalog.apps.map((app) => app.name).filter((name) => name !== 'little-monsters');
  const files = [...sourceFiles()];
  for (const directory of ['tools', 'ui']) {
    const full = path.join(PACKAGE_ROOT, directory);
    if (!fs.existsSync(full)) continue;
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      if (entry.isFile() && /\.(html|css|js)$/.test(entry.name)) files.push(path.join(full, entry.name));
    }
  }
  const calls = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const name of others) {
      if (new RegExp(`/api/${name}(?![a-z0-9-])`).test(text)) calls.push(`${path.relative(PACKAGE_ROOT, file)} -> /api/${name}`);
    }
  }
  assert.deepEqual(calls, [],
    'calling another package\'s route prefix is a runtime dependency on that package being installed AND active — declare it');
});

test('the catalog mirror is exactly what this manifest declares', async () => {
  const { readManifestDependencies, sameDependencies } = await readerPromise;
  const { dependencies } = readManifestDependencies(MANIFEST, 'little-monsters/oshal-app.yaml');
  const catalog = JSON.parse(fs.readFileSync(path.join(STORE_ROOT, 'marketplace.json'), 'utf8'));
  const entry = catalog.apps.find((app) => app.name === 'little-monsters');
  assert.ok(entry, 'marketplace.json must carry a little-monsters entry');
  assert.ok(sameDependencies(entry.dependencies ?? null, dependencies),
    'run node scripts/gen-catalog-dependencies.mjs — the mirror is generated, never hand-edited');
});
