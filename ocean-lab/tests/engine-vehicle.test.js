/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S2 — the explorer record's engine half, against the COMPILED modules under plain
 *                     |                             | node: the kind's eight limit rows are the design study's "What is not true" sentences and a
 *                     |                             | kind with no limits, no figures or an undeclared force model is refused at load; the seed is
 *                     |                             | a valid vector with a provenance for every field; the validator names what is wrong with a bad
 *                     |                             | vector; the stage reads concept, then sized at the evaluated vector, and drops the moment the
 *                     |                             | vector changes, while a foreign plant's run never sizes it; and the D5 fingerprints — a real
 *                     |                             | manifest version or null, an engine tree hash that is stable, recomputable and moves with one
 *                     |                             | byte, and the displayability rule naming every missing field.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review fix: the limit-row case compared only each row's lead
 *                     |                             | sentence, so two rows that had drifted from the study (an
 *                     |                             | appended report addendum, "manifold; a" for "manifold. A")
 *                     |                             | passed. It now asserts each sentence EQUALS the study's whole
 *                     |                             | bullet, and that the report's occurrence-mix point lives in
 *                     |                             | the site-data row's retireWhen instead of in the sentence.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
  return originalLoad.call(this, request, parent, isMain);
};

const PACKAGE_DIR = path.resolve(__dirname, '..');
const ENGINE = path.join(PACKAGE_DIR, 'routes', 'engine');
const wave = require(path.join(ENGINE, 'wave', 'index.js'));
const lib = require(path.join(ENGINE, 'vehicle', 'index.js'));

const seed = lib.explorerSeed();
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * The design study's "What is not true" bullets (core docs/research/autonomous-explorer-design-study.md),
 * each whole, with the bold markers dropped and its wrapped lines joined by one space. The rows are stored
 * and shown as the study's sentences, so each must equal its bullet exactly - an addendum or a changed
 * stop is drift.
 */
const STUDY_BULLETS = [
  'Nothing was built. No hardware exists. No tank test, no sea trial, no physical validation of any kind.',
  'No site data is real. Every tidal constituent set and soil profile is an illustrative parameter set, labelled as such in the code. No verdict here is site-specific.',
  'Drag is a correlation stack, not a solved boundary layer. Section C_D should be read as roughly 1.2–1.5× conservative.',
  'No structural analysis. Nobody has checked whether a printed wing survives hinge loads at 2 knots in a 2 m sea. That may push the part out of print entirely.',
  'Wave-glider stop angles below ~15° are unmodelled. The sweep says shallower is faster all the way down to 5°; real vehicles use 20–25°. Hinge loads, control authority and tether snatch are absent from the model.',
  'The mesh validator does not check self-intersection. Topology is verified closed and manifold. A sufficiently twisted loft could pass every check and still be unprintable.',
  'Two physics implementations exist with no parity test. The browser consoles mirror the server models; nothing asserts they agree on a single number.',
  'This never ran in the swarm. No ticket, no bot-node, no manifest, no persona. It was built by hand with scripts. That is a process failure, not a modelling one.',
];

test('the kind carries the study\'s eight "What is not true" sentences as limit rows, in order, each exactly the study text', () => {
  const limits = lib.EXPLORER_KIND.limits;
  assert.equal(limits.length, 8);
  limits.forEach((l, i) => {
    assert.equal(l.sentence, STUDY_BULLETS[i], `${l.id} is the study's bullet ${i + 1}, whole and unaltered`);
    assert.ok(l.retireWhen.length > 20, `${l.id} says what would retire it`);
    assert.equal(typeof l.blocking, 'boolean');
  });
  assert.deepEqual(limits.filter((l) => l.blocking).map((l) => l.id), ['nothing-built', 'no-structural-analysis', 'no-self-intersection-check']);
  const siteData = limits.find((l) => l.id === 'no-real-site-data');
  assert.match(siteData.retireWhen, /occurrence mix \(which the report also calls an illustrative parameter set, not a survey\)/, 'the report\'s occurrence-mix point is kept, as what a survey replaces, not appended to the study sentence');
});

test('a kind that declares no limits, no figures or an undeclared force model is refused at load', () => {
  const kind = lib.EXPLORER_KIND;
  assert.throws(() => lib.assertKindDeclared({ ...kind, limits: [] }), /declares no limits/);
  assert.throws(() => lib.assertKindDeclared({ ...kind, requiredFigures: [] }), /no required figures/);
  assert.throws(() => lib.assertKindDeclared({ ...kind, forceModels: ['wave-propulsion', 'tide-mill'] }), /no declared envelope: tide-mill/);
  assert.equal(lib.assertKindDeclared(kind), kind);
});

test('the seed is a valid vector, names the dated study it replays, and carries a provenance for every authored field', () => {
  assert.deepEqual(lib.validateExplorerVector(seed.designVector), []);
  assert.equal(seed.kind, lib.EXPLORER_KIND.id);
  assert.match(seed.study.document, /autonomous-explorer-design-study\.md$/);
  const fields = ['wings.count', 'wings.spanM', 'wings.chordM', 'wings.section', 'wings.stopAngleDeg', 'tether.lengthM', 'tether.diameterM', 'float.diameterM', 'float.heightM', 'float.displacementL', 'sub.diameterM', 'sub.lengthM', 'sub.netWeightN', 'site.seaStates.heightM', 'site.seaStates.periodS', 'site.seaStates.occurrence', 'site.underWayMinSpeedMs'];
  for (const f of fields) {
    assert.ok(seed.provenance[f], `${f} has a provenance`);
    assert.ok(['published', 'reconstructed', 'assumed'].includes(seed.provenance[f].source), `${f}: ${seed.provenance[f].source}`);
  }
  assert.equal(seed.provenance['site.seaStates.periodS'].source, 'reconstructed', 'the unpublished periods are never presented as published');
  assert.ok(lib.explorerSeed() !== lib.explorerSeed(), 'every caller gets its own copy');
});

test('the validator names what is wrong with a vector, one problem per field', () => {
  assert.deepEqual(lib.validateExplorerVector(null), ['the design vector must be an object']);
  const bad = clone(seed.designVector);
  bad.wings.stopAngleDeg = 60;
  bad.tether.lengthM = 0;
  bad.wings.section = 'NACA 9999x';
  bad.float.displacementL = 1000;
  bad.site.seaStates[0].occurrence = 0.5;
  const problems = lib.validateExplorerVector(bad);
  for (const needle of ['stopAngleDeg', 'tether.lengthM', 'wings.section', 'float.displacementL', 'sum to 1']) {
    assert.ok(problems.some((p) => p.includes(needle)), `names ${needle}: ${problems.join(' | ')}`);
  }
});

test('the derived geometry: the float floats at the draft its displacement fills, and k_form is Hoerner at the sub\'s fineness', () => {
  const { geometry, vehicle } = lib.deriveWaveVehicle(seed.designVector);
  assert.ok(Math.abs(geometry.floatDraftM - 0.0241 / (Math.PI * 0.14 ** 2)) < 1e-12);
  const f = 0.11 / 0.54;
  assert.ok(Math.abs(geometry.formFactor - (1 + 1.5 * f ** 1.5 + 7 * f ** 3)) < 1e-12);
  assert.deepEqual(lib.nacaSpec('NACA 2412'), { maxCamber: 0.02, camberPos: 0.4, thickness: 0.12 });
  assert.equal(vehicle.frictionLengthM, 0.54);
  assert.deepEqual(vehicle.wetted.map((w) => w.id), ['float', 'sub', 'tether']);
});

/** A stored run the way the stage function reads one. */
function runAt(sequence, vector, plant = lib.EVALUATION_PLANT, figures = { meanSpeedMs: 0.2, meanKnots: 0.4, underWayFraction: 0.6, kmPerDay: 20, kmPerYear: 7000 }) {
  return { sequence, mediumId: 'seawater', plant, vectorFingerprint: lib.designVectorFingerprint(vector), result: { figures } };
}

test('the stage is computed: concept, then sized at the evaluated vector, and back to concept the moment the vector changes', () => {
  const v = seed.designVector;
  const concept = lib.stageOf(lib.EXPLORER_KIND, v, []);
  assert.equal(concept.stage, 'concept');
  assert.equal(concept.fabricable, lib.FABRICABLE_SENTENCE);
  assert.equal(concept.openLimits.length, 8);
  const sized = lib.stageOf(lib.EXPLORER_KIND, v, [runAt(1, v)]);
  assert.equal(sized.stage, 'sized');
  assert.equal(sized.sizedBy, 1);
  assert.equal(sized.next, 'parts-complete');
  assert.ok(sized.blockedBy[0].includes('parts model'));
  const moved = clone(v); moved.wings.stopAngleDeg = 22;
  const dropped = lib.stageOf(lib.EXPLORER_KIND, moved, [runAt(1, v)]);
  assert.equal(dropped.stage, 'concept');
  assert.match(dropped.because, /vector changed/);
  assert.equal(lib.designVectorFingerprint({ b: 1, a: [1, { d: 2, c: 3 }] }), lib.designVectorFingerprint({ a: [1, { c: 3, d: 2 }], b: 1 }), 'key order is not identity');
});

test('only this lab\'s own evaluation sizes the record: a foreign plant or a run missing a required figure does not', () => {
  const v = seed.designVector;
  assert.equal(lib.stageOf(lib.EXPLORER_KIND, v, [runAt(1, v, 'embodied:analytic')]).stage, 'concept');
  assert.equal(lib.stageOf(lib.EXPLORER_KIND, v, [runAt(1, v, lib.EVALUATION_PLANT, { meanSpeedMs: 0.2 })]).stage, 'concept');
  assert.deepEqual(lib.STAGES, ['concept', 'sized', 'parts-complete', 'fabricable', 'built']);
  assert.equal(lib.FABRICABLE_SENTENCE, 'fabricable means the files are complete and self-consistent. It does not mean the machine is safe to build, fly or wet.');
});

test('the package version is read from the real manifest, and is null without a manifest or with a placeholder', (t) => {
  assert.match(lib.readPackageVersion(PACKAGE_DIR), /^\d+\.\d+\.\d+$/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-lab-version-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(lib.readPackageVersion(dir), null);
  fs.writeFileSync(path.join(dir, 'oshal-app.yaml'), 'name: ocean-lab\nversion: unknown\n');
  assert.equal(lib.readPackageVersion(dir), null);
});

test('the engine tree hash is stable, recomputable over a copy, moves with one byte, and is null over nothing', (t) => {
  const own = lib.routesEngineBuildHash();
  assert.match(own, /^[0-9a-f]{64}$/);
  assert.equal(lib.routesEngineBuildHash(), own);
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-lab-engine-'));
  t.after(() => fs.rmSync(copy, { recursive: true, force: true }));
  fs.cpSync(ENGINE, copy, { recursive: true });
  assert.equal(lib.hashEngineTree(copy), own, 'the same bytes hash the same');
  const target = path.join(copy, 'wave', 'wave-propulsion.js');
  fs.writeFileSync(target, fs.readFileSync(target, 'utf8') + '\n// one more line\n');
  assert.notEqual(lib.hashEngineTree(copy), own, 'one changed module moves the hash');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ocean-lab-empty-'));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  assert.equal(lib.hashEngineTree(empty), null);
});

test('a run is displayable only with its medium id, a real package version and a 64-hex build hash — each missing field named', () => {
  const good = { mediumId: 'air', engineFingerprints: { packageVersion: '0.16.3', routesBuildHash: 'a'.repeat(64) } };
  assert.deepEqual(lib.displayabilityProblems(good), []);
  assert.deepEqual(lib.displayabilityProblems({}), ['medium.id', 'engine.packageVersion', 'engine.routesBuildHash']);
  assert.deepEqual(lib.displayabilityProblems({ ...good, engineFingerprints: { packageVersion: 'unknown', routesBuildHash: null } }), ['engine.packageVersion', 'engine.routesBuildHash']);
  assert.equal(wave.WAVE_ENGINE.id, 'ocean-lab.wave-propulsion');
});
