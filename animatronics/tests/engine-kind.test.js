/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The `prop` kind seam against embodied's compiled capability manifest (read-only cross-package import, the way circuit-lab reads CAD Studio's contract): our manifest carries exactly embodied's CapabilityManifest fields; our vocabulary row has embodied's row shape (senses, acts, minSafetyClass); embodied's validator still REFUSES kind `prop` today — that refusal is the fold-in target and this test goes red the day it lands, so the duplicate vocabulary here gets removed rather than forgotten; the safety class rises to kinetic on a strong servo; e-stop and disarm are confirm-exempt.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | THE FOLD-IN LANDED (ADR-156 D6, core BACKLOG 2026-09-14). The seam inverted: embodied now OWNS `KIND_VOCABULARY.prop` and this test asserts AGREEMENT instead of refusal. It imports embodied's real row and fails on any drift in either direction; it feeds a real rig's manifest — the skull template, built by this package's own compiler from the servo catalog — to embodied's own `validateManifest` and requires it to be ACCEPTED; it holds the confirm rule to embodied's `actRequiresConfirm`; and it asserts nothing here is invented, so the row cannot be quietly re-forked. The one thing it still pins as REFUSED is a prop on the swarm rail — the ADR-149 gate B20 records — because learning the word must not mint the node.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | AGREEMENT IS NOT THE IMPORT. Entry 2 held a frozen literal equal to embodied's row, which is a drift guard on a duplicate — the core entry asked for the row to be READ from its owner. So the assertions moved from "the copy equals theirs" to "the answer comes from their module": the package is pointed at a FIXTURE packages root whose embodied declares a different row, and its vocabulary and a real rig's manifest must change with it — something a frozen copy can never do. The unhappy shapes the copy existed to avoid are pinned too: no embodied, an embodied with no `prop` row, one with no CONFIRM_EXEMPT_ACTS and one that throws each refuse with a reason naming the owner, and NONE of them falls back to a row invented here. The default root still binds to the real sibling, still hands a real rig to embodied's own validateManifest, and a prop still does not enrol as a node.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | THE READ IS A DECLARED DEPENDENCY. Entry 3 made this the first store package to read a sibling package at run time, and the manifest still declared no app dependency at all: an installer offering Animatronics never offered embodied, and the edge existed only in code. The manifest now names embodied under dependencies.optional.apps - the tier the platform defines as an install-time OFFER that never blocks - and these cases fail if that declaration goes away, in the manifest, through the store's own dependency reader and in the generated catalog mirror.
 *
 * Dependency-free: plain node against routes/engine and embodied/routes/engine. Run: node --test "tests/*-*.test.js"
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const E = require(path.join(__dirname, '..', 'routes', 'engine', 'index.js'));

const EMBODIED = path.join(__dirname, '..', '..', 'embodied', 'routes', 'engine', 'nodes', 'capability-manifest.js');
assert.ok(fs.existsSync(EMBODIED), `embodied's compiled capability manifest must exist for the seam test (${EMBODIED})`);
const embodied = require(EMBODIED);

const rows = E.servoMap(E.loadServoCatalog(path.join(__dirname, '..', 'catalog', 'servos.json')).servos);
const templates = E.buildTemplates(rows);
const skull = templates.find((t) => t.id === 'skull');

const temps = [];
/**
 * @description A packages root holding ONE package — a stand-in `embodied` whose compiled
 * vocabulary module is exactly the source given. The package resolves its row through the same
 * file path and the same `require` it uses in a deployment, so what is under test is the real
 * cross-package read and not a stub of it.
 * @param source - The module body, or null for a packages root with no embodied in it at all.
 * @returns The packages root.
 */
function packagesRootWith(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anim-prop-vocab-'));
  temps.push(root);
  if (source !== null) {
    const dir = path.join(root, 'embodied', 'routes', 'engine', 'nodes');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'capability-manifest.js'), source, 'utf8');
  }
  return root;
}
test.after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

test('embodied owns the prop row, and this package READS it rather than keeping one of its own', () => {
  const theirs = embodied.KIND_VOCABULARY.prop;
  assert.ok(theirs, "embodied must carry KIND_VOCABULARY.prop — the ADR-156 D6 fold-in");
  const bound = E.loadPropVocabulary();
  assert.equal(bound.ok, true, bound.ok ? '' : `the package could not bind to embodied's row: ${bound.reason}`);
  assert.equal(path.resolve(bound.module), path.resolve(EMBODIED), 'the row must come from embodied’s compiled module, not from anywhere else');
  assert.deepEqual([...bound.row.senses], [...theirs.senses]);
  assert.deepEqual([...bound.row.acts], [...theirs.acts]);
  assert.equal(bound.row.minSafetyClass, theirs.minSafetyClass);
  assert.equal(theirs.minSafetyClass, 1, 'a micro-servo eye mechanism is low-energy, not kinetic');
  assert.equal(Object.isFrozen(bound.row), true, 'the bound row is read, never edited at runtime');
  // Shape equality against a DIFFERENT kind, so a field added to the vocabulary's row shape is
  // caught even when the prop row itself is untouched.
  assert.deepEqual(Object.keys(bound.row).sort(), Object.keys(embodied.KIND_VOCABULARY.drone).sort());
  // And the package names embodied as the owner, which is what the capabilities route publishes.
  assert.equal(E.PROP_VOCABULARY_OWNER, 'embodied');
  // There is no second declaration left to fork: the package exports no row and no exempt set.
  assert.equal(E.PROP_VOCABULARY, undefined, 'the package must not export a vocabulary row of its own');
  assert.equal(E.PROP_CONFIRM_EXEMPT, undefined, 'the confirm-exempt set is embodied’s, derived from its row');
});

const MANIFEST = path.join(__dirname, '..', 'oshal-app.yaml');
const STORE_READER = path.join(__dirname, '..', '..', 'scripts', 'manifest-dependencies.mjs');
const CATALOG = path.join(__dirname, '..', '..', 'marketplace.json');

/**
 * @description The manifest's `dependencies:` block, both tiers, as declared. Parsed line by line
 * rather than with a YAML runtime because this suite is dependency-free and, like every package
 * suite, may be run against a COPY OF THIS PACKAGE ALONE - the manifest travels with the package,
 * a YAML library and the store checkout do not. Manifests are CRLF in a Windows checkout, so a
 * block regex built on `\s` would capture an empty string there and read as "nothing declared".
 * @param text - The raw oshal-app.yaml text.
 * @returns `{ required, optional }`, each with the apps / tools / connectors it declares.
 */
function dependencyTiers(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^dependencies:\s*$/.test(line));
  assert.ok(start >= 0, 'the manifest declares a dependencies block');
  const tiers = {};
  let tier = null;
  let list = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i].replace(/\s+$/, '');
    if (raw === '' || /^\s*#/.test(raw)) continue;
    if (!/^\s/.test(raw)) break; // a line in column zero ends the block
    const indent = raw.match(/^ */)[0].length;
    const body = raw.trim().replace(/\s+#.*$/, '').trim();
    const item = /^-\s+(.+)$/.exec(body);
    if (item) { assert.ok(list, `a list item outside any key: ${body}`); list.push(item[1].trim()); continue; }
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(body);
    assert.ok(kv, `neither a key nor a list item: ${body}`);
    const [, key, value] = kv;
    if (indent === 2 && (key === 'required' || key === 'optional')) {
      assert.equal(value, '', `the ${key} tier must be a mapping of apps/tools/connectors`);
      tier = {}; tiers[key] = tier; list = null; continue;
    }
    assert.ok(tier, `"${key}" is declared outside a required/optional tier`);
    assert.ok(['apps', 'tools', 'connectors'].includes(key), `unknown dependency key "${key}"`);
    if (value === '') { list = []; tier[key] = list; continue; }
    const flow = /^\[(.*)\]$/.exec(value);
    assert.ok(flow, `"${key}" is neither a flow list nor a block sequence: ${value}`);
    tier[key] = flow[1].trim() === '' ? [] : flow[1].split(',').map((e) => e.trim().replace(/^['"]|['"]$/g, ''));
    list = null;
  }
  assert.ok(tiers.required && tiers.optional, 'the manifest declares both dependency tiers');
  return tiers;
}

test('the run-time read is a DECLARED optional dependency: the manifest OFFERS embodied', () => {
  // This package is the first in the store to read a sibling package's module at run time, and a
  // dependency that exists only in code is one an installer cannot offer and a person cannot see.
  // `optional` is the tier the platform defines for exactly this - offered at install, never
  // blocking - so the declaration is what turns "it reads embodied" into "install offers embodied".
  const tiers = dependencyTiers(fs.readFileSync(MANIFEST, 'utf8'));
  assert.deepEqual(tiers.optional.apps, ['embodied'], 'embodied owns the prop vocabulary this package READS, so the manifest must offer it');
  assert.ok(tiers.optional.apps.includes(E.PROP_VOCABULARY_OWNER), 'the package the code reads at run time is the package the manifest names');
  // Optional and NOT required, in both directions: everything but the capability manifest works
  // with embodied absent (the refusal cases below prove it), so requiring it would refuse an
  // install that should succeed and would make removing embodied an orphaning error.
  assert.deepEqual(tiers.required.apps, [], 'the package runs without embodied, so the edge belongs in the optional tier');
  assert.deepEqual([tiers.required.tools, tiers.required.connectors, tiers.optional.tools, tiers.optional.connectors], [[], [], [], []]);
});

test('the store reads that offer the same way, and the catalog mirrors it', { skip: !fs.existsSync(STORE_READER) && 'the store checkout is not around this package (a single-package copy)' }, async () => {
  // The case above is this package's own word for it. This is the boundary that decides what an
  // installer sees: the reader marketplace.json's dependency block is GENERATED through, and the
  // generated block itself, because an installer reads the catalog and never this YAML.
  const { readManifestDependencies } = await import(pathToFileURL(STORE_READER).href);
  const read = readManifestDependencies(fs.readFileSync(MANIFEST, 'utf8'), 'animatronics/oshal-app.yaml');
  assert.deepEqual(read.problems, [], 'the store reader parses this manifest');
  assert.deepEqual(read.dependencies.optional.apps, ['embodied']);
  assert.deepEqual(read.dependencies.apps, [], 'the flat compatibility key is the REQUIRED tier - an offer never becomes a hard dependency');
  const entry = JSON.parse(fs.readFileSync(CATALOG, 'utf8')).apps.find((a) => a.name === 'animatronics');
  assert.ok(entry, 'the catalog carries this package');
  assert.deepEqual(entry.dependencies, read.dependencies, 'marketplace.json mirrors the manifest - regenerate it with scripts/gen-catalog-dependencies.mjs, never by hand');
});

test('the row is READ, not copied — a different embodied gives a different answer', () => {
  // The assertion a frozen literal can never satisfy. If the package ever goes back to declaring
  // its own row, it will keep answering with the real vocabulary here and this fails.
  const root = packagesRootWith([
    "'use strict';",
    'exports.KIND_VOCABULARY = {',
    "  prop: { senses: ['channel-state'], acts: ['pose', 'wave', 'e-stop'], minSafetyClass: 2 },",
    '};',
    "exports.CONFIRM_EXEMPT_ACTS = new Set(['e-stop']);",
    '',
  ].join('\n'));
  const bound = E.loadPropVocabulary(root);
  assert.equal(bound.ok, true, bound.ok ? '' : bound.reason);
  assert.deepEqual([...bound.row.senses], ['channel-state']);
  assert.deepEqual([...bound.row.acts], ['pose', 'wave', 'e-stop']);
  assert.equal(bound.row.minSafetyClass, 2);
  assert.deepEqual([...bound.confirmExempt], ['e-stop'], 'the exempt set is this row’s acts narrowed by embodied’s own set');
  // And the manifest a rig enrols with is built from THAT row, not from anything held here.
  const manifest = E.capabilityManifestFor('prop-skull', skull.rig, 11, root);
  assert.deepEqual(manifest.senses, ['channel-state']);
  assert.deepEqual(manifest.acts, ['pose', 'wave', 'e-stop']);
  // The real sibling is untouched by the fixture — the binding is per packages root.
  assert.deepEqual([...E.loadPropVocabulary().row.acts], [...embodied.KIND_VOCABULARY.prop.acts]);
});

test('no owner, no vocabulary — and nothing invented in its place', () => {
  const cases = [
    { name: 'embodied is not installed', root: packagesRootWith(null), reason: /not installed beside this package/ },
    { name: 'embodied carries no prop row', root: packagesRootWith("'use strict';\nexports.KIND_VOCABULARY = { drone: { senses: [], acts: [], minSafetyClass: 2 } };\nexports.CONFIRM_EXEMPT_ACTS = new Set();\n"), reason: /no usable KIND_VOCABULARY\.prop row/ },
    { name: 'embodied carries no confirm-exempt set', root: packagesRootWith("'use strict';\nexports.KIND_VOCABULARY = { prop: { senses: [], acts: [], minSafetyClass: 1 } };\n"), reason: /no CONFIRM_EXEMPT_ACTS set/ },
    { name: 'embodied’s module throws', root: packagesRootWith("'use strict';\nthrow new Error('half-installed');\n"), reason: /could not be read: half-installed/ },
  ];
  for (const c of cases) {
    const bound = E.loadPropVocabulary(c.root);
    assert.equal(bound.ok, false, `${c.name}: the package must refuse, never guess`);
    assert.match(bound.reason, c.reason, c.name);
    assert.match(bound.reason, /embodied/, `${c.name}: the refusal names the package that owns the row`);
    assert.equal(E.capabilityManifestFor('prop-skull', skull.rig, 11, c.root), null, `${c.name}: no vocabulary, no capability manifest`);
  }
});

test("a real rig's manifest is ACCEPTED by embodied's own validateManifest", () => {
  // Not a hand-written fixture: the skull template built from the servo catalog, through this
  // package's own capabilityManifestFor. If the rig compiler ever emits a field embodied does not
  // know, or an act outside the row, this is where it is caught.
  const ours = E.capabilityManifestFor('prop-skull', skull.rig, 11);
  const verdict = embodied.validateManifest(ours);
  assert.equal(verdict.ok, true, `embodied refused a real rig: ${verdict.ok ? '' : verdict.issues.join('; ')}`);
  assert.deepEqual(verdict.manifest, ours, 'embodied validates our manifest field for field, unchanged');
  assert.equal(ours.kind, 'prop');
  assert.equal(ours.safetyClass, 2, 'an 11 kg·cm servo is kinetic');
  assert.deepEqual(ours.envelope, { channels: 7, maxDegPerS: 600, supplyVolts: 6, supplyAmps: 5, stallKgCm: 11 });
  // The low-energy end of the same kind, also through embodied.
  const eyes = E.capabilityManifestFor('prop-eyes', templates[0].rig, 1.8);
  assert.equal(eyes.safetyClass, 1, 'micro servos are low-energy');
  assert.equal(embodied.validateManifest(eyes).ok, true);
});

test("confirm-exempt is embodied's decision, and our rail is stricter than the floor", () => {
  const exempt = E.loadPropVocabulary().confirmExempt;
  assert.deepEqual([...exempt].sort(), ['disarm', 'e-stop'], 'the prop acts embodied exempts today');
  const armed = embodied.validateManifest(E.capabilityManifestFor('prop-skull', skull.rig, 11)).manifest;
  for (const act of exempt) {
    assert.ok(embodied.CONFIRM_EXEMPT_ACTS.has(act), `embodied must also exempt ${act}`);
    assert.equal(embodied.actRequiresConfirm(armed, act), false, `${act} must never wait for a confirm`);
  }
  assert.equal(exempt.has('pose'), false);
  assert.equal(embodied.actRequiresConfirm(armed, 'pose'), true);
  // The floor says a class-1 rig needs no confirm at all. THIS package still answers 428 to an
  // unconfirmed arm at every class (routes.core.test.js proves it), because a person should be in
  // front of a mechanism before it moves. A kind is a minimum, never a ceiling.
  const low = embodied.validateManifest(E.capabilityManifestFor('prop-eyes', templates[0].rig, 1.8)).manifest;
  assert.equal(embodied.actRequiresConfirm(low, 'arm'), false);
});

test('the kind is vocabulary only — a prop still does not enrol as a node on the rail', () => {
  // ADR-156 D5: under the ADR-149 gate a package-owned machine caller is refused on the box, so a
  // prop is driven from the person's browser session. This is the clause the BACKLOG entry left
  // explicitly out of scope, and it stays out until that decision is made.
  const embodiedFleet = path.join(__dirname, '..', '..', 'embodied', 'routes', 'engine', 'node', 'node-fleet.js');
  assert.ok(fs.existsSync(embodiedFleet));
  assert.throws(
    () => require(embodiedFleet).validateHeartbeat({ nodeId: 'prop-skull', kind: 'prop', endpointUrl: 'http://127.0.0.1:9000', protocol: 1, engine: 'animatronics', version: '0.2.1', buildHash: 'x', sessions: 0 }),
    /kind must be "plant" or "drone"/,
  );
});
