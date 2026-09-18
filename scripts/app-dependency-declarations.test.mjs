/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-17 00:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Hold every store package's prerequisite declaration to what its code actually does. Two arms, because either alone can be defeated: a DETECTOR that fails on any cross-package edge nobody declared, and a LEDGER of the edges already proven by reading the code, each pinned to the file and the exact call that proves it. A catalog `--check` cannot do this job - marketplace.json's dependency block is GENERATED from the manifest, so a declaration that goes missing disappears from both sides at once and the mirror still reports "current". The ledger also records the two shapes that are NOT dependencies: an `integrations.offers` target (the framework resolves an inactive target to state:'unavailable'), and a package named in prose in a .md or .json record.
 *
 * @module app-dependency-declarations.test
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { describe, findEdges, packages, mountPrefixes, undeclaredEdges } from './app-dependency-declarations.mjs';
import { readManifestDependencies, sameDependencies } from './manifest-dependencies.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The cross-package edges that were proven by reading the code, with the file and the exact call
 * that proves each one. This table is the arm that outlives the detector: narrowing a pattern or
 * excluding a directory silences the detector, but a row here still fails when either half goes -
 * the call, or the declaration. `tier` is what the edge was classified as after reading how the
 * caller behaves when the target is absent: every one of these degrades (a toast, a hidden chip,
 * an empty tab), so every one is `optional`. `required` would mean install refuses to orphan it.
 */
const PROVEN = [
  ['cad-studio', 'scan-to-print', 'optional', 'tools/cad-studio.js', "fetch('/api/scan-to-print/jobs/'"],
  ['scan-to-print', 'cad-studio', 'optional', 'tools/scan-to-print.js', "fetch('/api/cad-studio/models'"],
  ['embodied', 'cad-studio', 'optional', 'tools/embodied.js', "fetch('/api/cad-studio/models'"],
  ['circuit-lab', 'cad-studio', 'optional', 'src-routes/design-routes.ts', "path: '/api/cad-studio/models'"],
  ['circuit-lab', 'cad-studio', 'optional', 'tools/circuit-lab.js', 'fetch(out.cadStudio.path'],
  ['portrait-studio', 'create', 'optional', 'tools/portrait-studio.html', "fetch('/api/create/brand-kit'"],
  ['presentations', 'create', 'optional', 'tools/presentations.html', "fetch('/api/create/brand-kit'"],
  ['video', 'create', 'optional', 'tools/video.html', "fetch('/api/create/brand-kit'"],
  ['social', 'email-summarizer', 'optional', 'tools/social-composer.html', 'href="/api/email/inbox"'],
  ['finance', 'intelligent-trades', 'optional', 'oshal-app.yaml', 'iframeUrl: /api/trading/'],
  ['finance', 'world', 'optional', 'oshal-app.yaml', 'iframeUrl: /api/world/app'],
  ['finance', 'kalshi', 'optional', 'oshal-app.yaml', 'iframeUrl: /api/kalshi/'],
  ['intelligent-trades', 'world', 'optional', 'oshal-app.yaml', 'iframeUrl: /api/world/app'],
  ['home', 'drone', 'optional', 'oshal-app.yaml', 'iframeUrl: /api/drone/app'],
  ['home', 'sat-ops', 'optional', 'oshal-app.yaml', 'iframeUrl: /api/sat/app'],
  ['home', 'pumpkin', 'optional', 'oshal-app.yaml', 'iframeUrl: /api/pumpkin/app'],
  ['home', 'spaces', 'optional', 'oshal-app.yaml', 'iframeUrl: /api/spaces/app'],
  ['home', 'camera', 'optional', 'oshal-app.yaml', 'iframeUrl: /api/camera/app'],
  ['switchboard', 'feeds', 'optional', 'oshal-app.yaml', 'iframeUrl: /api/feeds/dashboard'],
];

/** @description The dependency tiers one package declares, read through the catalog's own reader. */
function tiersOf(name) {
  const { dirByName } = packages(ROOT);
  const manifest = path.join(ROOT, dirByName.get(name), 'oshal-app.yaml');
  const { dependencies, problems } = readManifestDependencies(fs.readFileSync(manifest, 'utf8'), `${name}/oshal-app.yaml`);
  assert.deepEqual(problems, [], `${name}: the dependencies block must be readable by the catalog generator`);
  return dependencies;
}

test('every package\'s dependency block reads through the catalog generator with no problem', () => {
  const { names } = packages(ROOT);
  const unreadable = names.filter((name) => {
    const deps = tiersOf(name);
    return !deps || !deps.required || !deps.optional;
  });
  // A block the reader cannot parse comes back null, and null is mirrored as "declares nothing" -
  // indistinguishable in the catalog from a package that truthfully depends on nothing.
  assert.deepEqual(unreadable, [], 'every package must declare a readable required/optional block');
});

test('no package has a cross-package edge it does not declare', () => {
  const missing = undeclaredEdges(ROOT, readManifestDependencies);
  assert.deepEqual(missing.map((row) => `${row.pkg} -> ${row.other}`), [],
    'a package that imports, fetches or frames another package depends on it being installed AND '
    + 'active. Declare it in dependencies (optional unless the caller is genuinely broken without '
    + `it), then run node scripts/gen-catalog-dependencies.mjs.\n  ${describe(missing)}`);
});

test('every proven edge still has its call, and is still declared', () => {
  const broken = [];
  for (const [pkg, other, tier, file, needle] of PROVEN) {
    const { dirByName } = packages(ROOT);
    const full = path.join(ROOT, dirByName.get(pkg), file);
    if (!fs.existsSync(full)) { broken.push(`${pkg}/${file} is gone — re-prove or drop the ${pkg} -> ${other} row`); continue; }
    if (!fs.readFileSync(full, 'utf8').includes(needle)) {
      broken.push(`${pkg}/${file} no longer contains ${JSON.stringify(needle)} — re-prove or drop the ${pkg} -> ${other} row`);
      continue;
    }
    const deps = tiersOf(pkg);
    if (!(deps?.[tier]?.apps ?? []).includes(other)) broken.push(`${pkg} must declare ${tier}.apps: [${other}] — proved by ${pkg}/${file}`);
  }
  assert.deepEqual(broken, [], 'a proven cross-package edge lost its declaration or its proof');
});

test('an integrations.offers target is a hand-off, not a dependency', () => {
  const { names, dirByName } = packages(ROOT);
  // resolveAppIntegrations resolves an offer whose target is inactive to state:'unavailable', so an
  // offer degrades and never breaks. Store-wide this is the common case, not an edge case: dozens
  // of packages offer to `presentations`. The detector must be blind to offers, or declaring an
  // offer target would become the convention - the exact defect gen-catalog-dependencies.mjs had
  // to fix when the launchers advertised as hard dependencies the apps they merely route to.
  const offerers = names.filter((name) => fs.readFileSync(path.join(ROOT, dirByName.get(name), 'oshal-app.yaml'), 'utf8')
    .includes('targetApp: presentations'));
  assert.ok(offerers.length >= 20, `expected many packages to offer to presentations, found ${offerers.length}`);
  const reached = new Set(findEdges(ROOT).filter((e) => e.other === 'presentations').map((e) => e.pkg));
  assert.deepEqual(offerers.filter((name) => reached.has(name)), [],
    'an offer alone must never be reported as an edge — these packages offer to presentations and '
    + 'nothing else in them touches it');
  // And the declarations agree: an offerer that declares presentations does so for a real edge.
  const declaringOfferers = offerers.filter((name) => (tiersOf(name)?.optional?.apps ?? [])
    .concat(tiersOf(name)?.required?.apps ?? []).includes('presentations'));
  assert.deepEqual(declaringOfferers, [], 'no package may declare presentations on the strength of an offer');
});

test('the detector still looks at every kind of file a call can live in', () => {
  // Narrowing the detector is the cheapest way to make the arm above green, and on its own it is
  // SILENT: the ledger only notices once a declaration is also dropped. This is the canary for it.
  const edges = findEdges(ROOT);
  const kinds = new Set(edges.map((e) => (e.file === 'oshal-app.yaml' ? 'manifest' : path.extname(e.file))));
  for (const kind of ['manifest', '.html', '.js', '.ts']) {
    assert.ok(kinds.has(kind), `the detector no longer finds any edge in a ${kind} file — it has been narrowed`);
  }
  const pairs = new Set(edges.map((e) => `${e.pkg} -> ${e.other}`));
  assert.ok(pairs.size >= 30, `the detector sees only ${pairs.size} cross-package pairs store-wide; it saw 43 when this landed`);
});

test('mount ownership is unambiguous, so a call is attributed to one package', () => {
  // The detector keys on declared mountPath prefixes, not on package names: intelligent-trades
  // mounts at /api/trading and sat-ops at /api/sat. Two packages claiming one prefix would make
  // every call across it a guess, so the detector drops such a prefix — and this fails instead.
  assert.deepEqual(mountPrefixes(ROOT).ambiguous, [], 'two packages claim one /api prefix');
});

test('the catalog mirror is exactly what every manifest declares', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'marketplace.json'), 'utf8'));
  const stale = catalog.apps.filter((entry) => {
    const manifest = path.join(ROOT, entry.source.path, 'oshal-app.yaml');
    const { dependencies } = readManifestDependencies(fs.readFileSync(manifest, 'utf8'), `${entry.name}/oshal-app.yaml`);
    return !sameDependencies(entry.dependencies ?? null, dependencies);
  }).map((entry) => entry.name);
  assert.deepEqual(stale, [], 'run node scripts/gen-catalog-dependencies.mjs — the mirror is generated, never hand-edited');
});
