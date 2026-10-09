/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S3 — the explorer's parts model against the COMPILED modules under plain node:
 *                     |                             | eleven watertight parts at the seed; every program passes CAD Studio's OWN compiled contract;
 *                     |                             | the programs follow the design vector and the report's drawn dimensions; the mass properties
 *                     |                             | are exact on shapes a hand can check; every emitted object is a D8 portable object in CAD
 *                     |                             | Studio's frame and the committed fixture is what the emitter emits; completeness names every
 *                     |                             | missing mass, price and placement; the displacement budget is unsized, OPEN, GREEN or RED
 *                     |                             | by name and gates parts-complete; and the design document is generated from the record.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
  return originalLoad.call(this, request, parent, isMain);
};

const PACKAGE_DIR = path.resolve(__dirname, '..');
const lib = require(path.join(PACKAGE_DIR, 'routes', 'engine', 'vehicle', 'index.js'));
const wave = require(path.join(PACKAGE_DIR, 'routes', 'engine', 'wave', 'index.js'));
const CAD_CONTRACT = path.join(PACKAGE_DIR, '..', 'cad-studio', 'routes', 'feature-contract.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'explorer-portable-objects.json');

const seed = () => lib.explorerSeed().designVector;
const seawater = wave.mediumById('seawater');

/** @description A stored evaluation of a vector in seawater, as the stage function reads one. */
function sizingRun(vector, sequence = 1) {
  return { sequence, mediumId: 'seawater', plant: lib.EVALUATION_PLANT, vectorFingerprint: lib.designVectorFingerprint(vector), result: { figures: lib.evaluateExplorer(vector, seawater).figures } };
}

/** @description The committed catalog with every row given a mass, a price and a body: what closing the budget needs. */
function completeCatalog(massG = 100, carrier = 'float') {
  const catalog = lib.explorerBoughtCatalog();
  for (const row of catalog.rows) { row.massG = massG; row.approxUsd = 10; if (!row.carriedBy) row.carriedBy = carrier; }
  return catalog;
}

/** @description Every watertight part's portable object at a vector. */
function objectsOf(parts) {
  return [...parts.printed.map((p) => p.portableObject), ...parts.bought.filter((b) => b.portableObject).map((b) => b.portableObject)];
}

test('the seed derives eleven watertight parts: float, sub body, four wings, rudder, three spindle blades and the tether', () => {
  const parts = lib.buildExplorerParts(seed());
  assert.equal(parts.watertightParts, 11);
  assert.equal(parts.watertightParts, lib.EXPLORER_DRAWINGS.watertightParts.count);
  assert.deepEqual(parts.printed.map((p) => [p.id, p.qty]), [['float', 1], ['sub-body', 1], ['wing', 4], ['rudder', 1], ['spindle-blade', 3]]);
  assert.deepEqual(parts.bought.filter((b) => b.geometry).map((b) => b.id), ['umbilical']);
  for (const p of parts.printed) {
    assert.ok(p.material && p.printNotes && p.massEachKg > 0, `${p.id} is printed with material, print notes and a mass`);
    assert.equal(p.massProvenance.source, 'estimate');
  }
  assert.equal(parts.bought.find((b) => b.id === 'wing-hinge').qty, 4, 'one hinge per wing');
  assert.deepEqual(parts.engine, { id: 'ocean-lab.explorer-parts', version: '1.0.0' });
});

test('every part program passes CAD Studio\'s own compiled contract, feature by feature', () => {
  assert.ok(fs.existsSync(CAD_CONTRACT), 'CAD Studio ships its contract compiled in the store checkout');
  const contract = require(CAD_CONTRACT);
  assert.equal(lib.CAD_STUDIO_MAX_DIMENSION_MM, contract.LIMITS.maxDimensionMm);
  const parts = lib.buildExplorerParts(seed());
  const programs = [...parts.printed, ...parts.bought.filter((b) => b.geometry)].map((p) => [p.id, p.geometry.program]);
  assert.equal(programs.length, 6);
  for (const [id, program] of programs) {
    assert.doesNotThrow(() => contract.validateBase(program.base), `${id} base`);
    const list = contract.validateFeatureList(program.features);
    assert.equal(list.length, program.features.length, `${id}: every feature accepted`);
    for (const f of program.features) assert.ok(contract.FEATURE_TYPES.includes(f.type), `${id} ${f.type}`);
  }
  assert.deepEqual(parts.printed.find((p) => p.id === 'wing').geometry.program.features.map((f) => f.type), ['loft', 'translate']);
  assert.deepEqual(parts.printed.find((p) => p.id === 'float').geometry.program.features.map((f) => f.type), ['revolve']);
});

test('the programs follow the design vector and the report\'s drawn dimensions', () => {
  const v = seed();
  const float = lib.floatProgram(v).program.features[0].params.points;
  assert.equal(Math.max(...float.map((p) => p[1])), 560, 'float height from float.heightM');
  assert.equal(Math.max(...float.map((p) => p[0])), 140, 'float radius from float.diameterM');
  assert.ok(Math.abs(lib.revolveVolumeMm3(lib.floatProfile(v)) / 1e6 - 23.43) < 0.01, 'the drawn outline encloses 23.43 L');
  const sub = lib.subProfile(v);
  assert.ok(Math.abs(sub[sub.length - 1][1] - 519.75) < 0.01 && Math.max(...sub.map((p) => p[0])) === 55, 'sub body 519.75 mm long, 110 mm across');
  const wing = lib.wingProgram(v);
  const [root, tip] = wing.sections;
  const chord = (s) => Math.max(...s.points.map((p) => p[0])) - Math.min(...s.points.map((p) => p[0]));
  assert.ok(Math.abs(chord(root) - 48) < 0.01 && Math.abs(chord(tip) - 48 * 0.7083) < 0.01, 'root chord from the vector, tip at the drawn taper');
  assert.equal(root.points.length, 86, 'the report\'s 86-point section');
  const st = lib.wingStations(v);
  assert.ok(Math.abs(st.rootRadiusMm + tip.offset - 148) < 0.01, 'the tip stands 148 mm out: 296 mm tip to tip');
  const blade = lib.spindleBladeProgram();
  assert.equal(blade.sections.length, 5);
  assert.ok(Math.abs(lib.EXPLORER_DRAWINGS.spindle.rootRadiusMm + blade.sections[4].offset - 95) < 1e-6, 'blade tip at the published 95 mm');
  const tether = lib.tetherProgram(v).program.base;
  assert.deepEqual(tether, { kind: 'cylinder', diameter: 6, height: 2000 });
  const wider = JSON.parse(JSON.stringify(v)); wider.wings.chordM = 0.06;
  assert.ok(Math.abs(chord(lib.wingProgram(wider).sections[0]) - 60) < 0.01, 'a changed chord changes the program');
});

test('mass properties are exact on shapes a hand can check', () => {
  const square = (side) => [[-side / 2, -side / 2], [side / 2, -side / 2], [side / 2, side / 2], [-side / 2, side / 2]];
  const m = lib.polygonMoments(square(2));
  assert.equal(m.a, 4); assert.equal(m.sx, 0); assert.ok(Math.abs(m.sxx - 4 / 3) < 1e-12);
  assert.deepEqual(lib.polygonMoments([...square(2)].reverse()).a, 4, 'orientation-free');
  const box = lib.loftMassProperties([{ points: square(10), offset: 0 }, { points: square(10), offset: 20 }], 1e-6, [1, 2, 3]);
  assert.ok(Math.abs(box.volumeMm3 - 2000) < 1e-9 && Math.abs(box.massKg - 0.002) < 1e-12);
  assert.deepEqual(box.centreOfMassMm.map((c) => Math.round(c * 1e9) / 1e9), [1, 2, 13], 'the centre moves with the translation');
  assert.ok(Math.abs(box.inertiaAboutComKgMm2[0][0] - (0.002 * (100 + 400)) / 12) < 1e-9, 'Ixx of a 10 x 10 x 20 box');
  assert.ok(Math.abs(box.inertiaAboutComKgMm2[2][2] - (0.002 * 200) / 12) < 1e-9, 'Izz');
  const frustum = lib.loftMassProperties([{ points: square(10), offset: 0 }, { points: square(20), offset: 30 }], 1e-6);
  assert.ok(Math.abs(frustum.volumeMm3 - (30 / 3) * (100 + 400 + 200)) < 1e-6, 'a loft between two squares is a frustum');
  assert.ok(Math.abs(lib.revolveVolumeMm3([[10, 0], [10, 50]]) - Math.PI * 100 * 50) < 1e-9);
  const shell = lib.revolveShellMassProperties([[10, 0], [10, 50]], 1, 1e-6);
  assert.ok(Math.abs(shell.volumeMm3 - (2 * Math.PI * 10 * 50 + 2 * Math.PI * 100)) < 1e-6, 'a closed cylinder skin');
  assert.ok(Math.abs(shell.centreOfMassMm[2] - 25) < 1e-9);
  const cyl = lib.cylinderMassProperties(6, 2000, null);
  assert.equal(cyl.inertiaAboutComKgMm2, null, 'no inertia without a mass');
});

test('every emitted object is a D8 portable object in CAD Studio\'s frame, and the committed fixture is what the emitter emits', () => {
  const contract = require(CAD_CONTRACT);
  assert.equal(lib.CAD_STUDIO_WORLD_FRAME, contract.describeContract().worldFrame, 'the frame convention is CAD Studio\'s own text');
  const objects = objectsOf(lib.buildExplorerParts(seed()));
  assert.equal(objects.length, 6);
  for (const o of objects) {
    assert.deepEqual(lib.portableObjectProblems(o), [], o.identity.partId);
    assert.deepEqual(Object.keys(o), [...lib.PORTABLE_OBJECT_KEYS]);
  }
  const wing = objects.find((o) => o.identity.partId === 'wing');
  assert.deepEqual(wing.forceModel, { id: 'wave-propulsion', label: wave.envelopeFor('wave-propulsion').label, requires: wave.envelopeFor('wave-propulsion').requires, validIn: ['seawater', 'air'], declared: true });
  assert.deepEqual(wing.attachmentFrame.points.map((p) => p.name), ['pitch-axis-root']);
  assert.equal(objects.filter((o) => o.forceModel).length, 1, 'a hull or a bracket carries no force model');
  const tether = objects.find((o) => o.identity.partId === 'tether');
  assert.equal(tether.massProperties.mass.valueKg, null);
  assert.equal(tether.massProperties.mass.provenance.source, 'unknown');
  assert.equal(tether.massProperties.inertia.aboutCentreOfMassKgMm2, null);
  const sub = objects.find((o) => o.identity.partId === 'sub-body');
  assert.deepEqual(sub.attachmentFrame.points.map((p) => p.name), ['wing-1-port', 'wing-1-starboard', 'wing-2-port', 'wing-2-starboard', 'rudder-stock', 'spindle-axis']);
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert.deepEqual(fixture.objects, JSON.parse(JSON.stringify(objects)), 'regenerate tests/fixtures/explorer-portable-objects.json from the compiled emitter');
});

test('the portable-object validator refuses each broken shape by name', () => {
  const good = objectsOf(lib.buildExplorerParts(seed()))[0];
  const broken = (mutate) => { const o = JSON.parse(JSON.stringify(good)); mutate(o); return lib.portableObjectProblems(o).join(' | '); };
  assert.match(broken((o) => { delete o.forceModel; }), /keys must be exactly/);
  assert.match(broken((o) => { o.extra = 1; }), /keys must be exactly/);
  assert.match(broken((o) => { o.schema = 'oshal.portable-object/2'; }), /schema must be/);
  assert.match(broken((o) => { o.massProperties.mass.valueKg = null; }), /mass is null, so its provenance must be 'unknown'|an inertia tensor needs a mass/);
  assert.match(broken((o) => { o.attachmentFrame.convention = 'Y up'; }), /CAD Studio's world frame/);
  assert.match(broken((o) => { o.attachmentFrame.points.push({ name: 'x', positionMm: [0, 0], axis: null, why: 'x' }); }), /positionMm must be/);
  assert.match(broken((o) => { o.identity.engine = null; }), /identity.engine/);
});

test('completeness names every mass, price and placement nobody published, and the layouts the drawings do not cover', () => {
  const problems = lib.buildExplorerParts(seed()).problems;
  assert.equal(problems.length, 3);
  assert.match(problems[0], /^15 bought or fabricated row\(s\) carry no mass .*the report publishes none$/);
  assert.match(problems[1], /^16 bought or fabricated row\(s\) carry no approximate price .*deliberately omitted/);
  assert.match(problems[2], /^5 row\(s\) are placed on neither .*battery, flight-computer, imu, depth-sensor, consumables/);
  const six = seed(); six.wings.count = 6;
  assert.match(lib.buildExplorerParts(six).problems.join(' '), /wings.count 6 has no drawn rank layout/);
  const long = seed(); long.tether.lengthM = 3;
  assert.match(lib.buildExplorerParts(long).problems.join(' '), /3000 mm body is longer than CAD Studio's 2000 mm limit/);
  assert.deepEqual(lib.buildExplorerParts(seed(), completeCatalog()).problems, []);
});

test('the displacement budget: unsized without a sizing, OPEN on the committed rows, and the stage refuses parts-complete by name', () => {
  const v = seed();
  assert.equal(lib.explorerPartsGate(v, null).budget.status, 'unsized');
  const gate = lib.explorerPartsGate(v, sizingRun(v));
  assert.equal(gate.budget.status, 'open');
  assert.match(gate.budget.why, /an unknown is never read as zero/);
  assert.match(gate.budget.unknowns.join(' '), /no published mass: solar-panel.*placed on no body: battery/);
  const stage = lib.stageOf(lib.EXPLORER_KIND, v, [sizingRun(v)], undefined, (vector, sized) => lib.explorerPartsGate(vector, sized));
  assert.equal(stage.stage, 'sized');
  assert.equal(stage.next, 'parts-complete');
  assert.ok(stage.blockedBy.some((b) => /^the parts model is incomplete: 15 bought/.test(b)));
  assert.ok(stage.blockedBy.some((b) => /^the displacement budget is OPEN/.test(b)));
  assert.match(stage.fabricable, /does not mean the machine is safe to build, fly or wet/);
  assert.equal(lib.stageOf(lib.EXPLORER_KIND, v, [sizingRun(v)]).stage, 'sized', 'a kind with no gate never advances by omission');
});

test('the displacement budget closes GREEN on complete light rows and the stage advances to parts-complete, blocked only at fabricable', () => {
  const v = seed(); const catalog = completeCatalog();
  const gate = lib.explorerPartsGate(v, sizingRun(v), catalog);
  assert.equal(gate.budget.status, 'green', gate.budget.why);
  assert.ok(gate.budget.float.demandsL < gate.budget.float.enclosedL && gate.budget.sub.ballastNetN >= 0);
  assert.ok(gate.budget.sizing.recomputedKmPerYear >= gate.budget.sizing.sizedKmPerYear);
  assert.ok(Math.abs(gate.budget.float.enclosedL - 23.43) < 0.01, 'the float program\'s volume, never the published 24.1 L');
  const stage = lib.stageOf(lib.EXPLORER_KIND, v, [sizingRun(v)], undefined, (vector, sized) => lib.explorerPartsGate(vector, sized, catalog));
  assert.equal(stage.stage, 'parts-complete');
  assert.deepEqual(stage.reached, ['concept', 'sized', 'parts-complete']);
  assert.equal(stage.next, 'fabricable');
  assert.match(stage.blockedBy[0], /OCCT kernel/);
});

test('the displacement budget goes RED by name: a sub no ballast can trim, a float that sinks, parts heavier than the sizing', () => {
  const v = seed();
  const heavySub = completeCatalog(); for (const r of heavySub.rows) if (r.carriedBy === 'sub') r.massG = 3000;
  assert.match(lib.explorerPartsGate(v, sizingRun(v), heavySub).budget.why, /no ballast can lighten it/);
  const sinking = completeCatalog(); for (const r of sinking.rows) if (r.carriedBy === 'float') r.massG = 6000;
  const sunk = lib.explorerPartsGate(v, sizingRun(v), sinking).budget;
  assert.equal(sunk.status, 'red'); assert.match(sunk.why, /it sinks/);
  const small = seed(); small.float.displacementL = 10;
  const loaded = completeCatalog(); for (const r of loaded.rows) if (r.carriedBy === 'float') r.massG = 2000;
  const heavier = lib.explorerPartsGate(small, sizingRun(small), loaded).budget;
  assert.equal(heavier.status, 'red');
  assert.ok(heavier.sizing.recomputedKmPerYear < heavier.sizing.sizedKmPerYear);
  assert.match(heavier.why, /set the float's displacement to what the parts demand and evaluate again/);
  assert.ok(heavier.float.demandsL > 10 && heavier.float.demandsL < heavier.float.enclosedL, 'it floats, deeper than sized');
  const stage = lib.stageOf(lib.EXPLORER_KIND, small, [sizingRun(small)], undefined, (vector, sized) => lib.explorerPartsGate(vector, sized, loaded));
  assert.equal(stage.stage, 'sized');
  assert.match(stage.blockedBy.join(' '), /the displacement budget is RED/);
});

test('a vector change drops the stage below the gate, and an invalid stored vector derives no parts', () => {
  const v = seed(); const moved = seed(); moved.wings.stopAngleDeg = 25;
  const stage = lib.stageOf(lib.EXPLORER_KIND, moved, [sizingRun(v)], undefined, (vector, sized) => lib.explorerPartsGate(vector, sized, completeCatalog()));
  assert.equal(stage.stage, 'concept');
  const bad = lib.explorerPartsGate({ wings: {} }, null);
  assert.equal(bad.parts, null);
  assert.match(bad.problems[0], /stored design vector is not valid/);
});

test('the design document is generated from the record: stage and sentence, parts, not-published rows, budget and points', () => {
  const v = seed(); const run = sizingRun(v);
  const stage = lib.stageOf(lib.EXPLORER_KIND, v, [run], undefined, (vector, sized) => lib.explorerPartsGate(vector, sized));
  const gate = lib.explorerPartsGate(v, run);
  const md = lib.explorerDesignMarkdown({ name: 'Explorer', vehicleId: '00000000-0000-4000-8000-000000000000', stage, parts: gate.parts, budget: gate.budget });
  assert.match(md, /^# Explorer — design/);
  assert.match(md, /\*\*Stage: sized\.\*\* fabricable means the files are complete and self-consistent/);
  assert.match(md, /11 watertight parts/);
  assert.match(md, /\| Float hull \| 1 \| cylinder 14.014 x 560 mm; revolve \| PETG/);
  assert.match(md, /\| Solar panel \| 1 \| cots \| Semi-flexible, marine \| float \| not published \| not published \|/);
  assert.match(md, /\*\*OPEN\*\*/);
  assert.match(md, /\| Sub body \| spindle-axis \|/);
  assert.match(md, /## Open limits \(8\)/);
  const taller = seed(); taller.float.heightM = 0.6;
  const g2 = lib.explorerPartsGate(taller, null);
  assert.match(lib.explorerDesignMarkdown({ name: 'Explorer', vehicleId: 'x', stage, parts: g2.parts, budget: g2.budget }), /cylinder 14.014 x 600 mm; revolve/);
});
