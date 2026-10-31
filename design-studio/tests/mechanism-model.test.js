/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203 D9, lane @ds-plant: the mechanism as data, against the COMPILED modules with no framework import - a mechanism is validated field by field and refused by name (part_not_bound against the design's bound parts, unknown_motor for a row the mechanism does not declare, cycle for a loop, a part hung from two joints or a loose part hanging from another, bad_mechanism naming the field); the task is read from the brief's line in its units (kg or g, mm/cm/m, s or min; lift, raise, hoist) and absent when no line states one; the plant spec is composed from the mechanism, the parts' kernel reports and the motor rows as read with every number one of those (part_not_read, motor_not_read when a read is missing); the lift example validates against its own binding, its programs validate against CAD Studio's compiled feature contract (its absence FAILS, never skips) and carry no measured number; the body contract for a generated plant publishes the engine's actuators from the row, the certified reach policy and the plant route as the node.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const PKG = path.resolve(__dirname, '..');
const MM = require(path.join(PKG, 'routes', 'mechanism-model.js'));
const { LIFT_1_EXAMPLE, LIFT_1_MECHANISM, findExample } = require(path.join(PKG, 'routes', 'examples.js'));
const { buildBodyContract, PLANT_COMMAND } = require(path.join(PKG, 'routes', 'body-contract.js'));
const M = require(path.join(PKG, 'routes', 'phase-model.js'));

const refused = (fn) => { try { fn(); } catch (e) { return e; } return null; };
const BINDING = { engine: 'cad-studio', kind: 'cad-models', parts: [{ id: 'base' }, { id: 'column' }, { id: 'carriage' }], modelIds: ['m-1', 'm-2', 'm-3'] };
const lift = () => JSON.parse(JSON.stringify(LIFT_1_MECHANISM));

test('a mechanism is validated field by field and refused by name', () => {
  const ok = MM.validateMechanism(lift(), BINDING);
  assert.equal(ok.base, 'base'); assert.equal(ok.joints.length, 2); assert.deepEqual(ok.motors, [{ rowId: 'sts3215-12v', source: 'embodied' }]); assert.equal(ok.payload.massKg, 2); assert.equal(ok.task, null);
  assert.deepEqual(ok.joints[1], { id: 'carriage-slide', parent: 'column', child: 'carriage', type: 'slide', axis: [0, 0, 1], rangeRad: null, rangeM: [0, 0.35], originMm: [0, 0, 0], drivenBy: 'sts3215-12v', gearRatio: 40 });
  assert.deepEqual(ok.joints[0].axis, [0, 0, 1], 'a fixed joint carries no axis of its own');
  const loose = lift(); loose.parts.push({ id: 'hook' });
  assert.equal(refused(() => MM.validateMechanism(loose, null)).code, 'bad_mechanism');
  assert.match(refused(() => MM.validateMechanism(loose, null)).message, /hook .*not joined/);
  const unbound = lift(); unbound.parts.push({ id: 'hook' }); unbound.joints.push({ id: 'h', parent: 'carriage', child: 'hook', type: 'fixed' });
  const e = refused(() => MM.validateMechanism(unbound, BINDING)); assert.equal(e.code, 'part_not_bound'); assert.equal(e.status, 422); assert.match(e.message, /hook is not among the Design phase's bound parts/);
  assert.equal(MM.validateMechanism(unbound, null).parts.length, 4, 'without a binding naming parts, nothing holds the mechanism to a list');
  const motor = lift(); motor.joints[1].drivenBy = 'nema17';
  const m = refused(() => MM.validateMechanism(motor, BINDING)); assert.equal(m.code, 'unknown_motor'); assert.match(m.message, /nema17, a motor row the mechanism does not declare \(motors: sts3215-12v\)/);
  const twice = lift(); twice.joints.push({ id: 'again', parent: 'base', child: 'carriage', type: 'fixed' });
  assert.equal(refused(() => MM.validateMechanism(twice, BINDING)).code, 'cycle');
  const loop = lift(); loop.joints.push({ id: 'back', parent: 'carriage', child: 'base', type: 'fixed' });
  assert.match(refused(() => MM.validateMechanism(loop, BINDING)).message, /the base is ground/);
  const ring = lift(); ring.parts.push({ id: 'a' }, { id: 'b' }); ring.joints.push({ id: 'ab', parent: 'a', child: 'b', type: 'fixed' }, { id: 'ba', parent: 'b', child: 'a', type: 'fixed' });
  const r = refused(() => MM.validateMechanism(ring, null)); assert.equal(r.code, 'cycle'); assert.match(r.message, /hang from each other/);
  for (const [mutate, field] of [[(x) => { x.joints[1].type = 'ball'; }, 'joints[1].type'], [(x) => { x.joints[1].rangeM = [1, 0]; }, 'joints[1].rangeM'], [(x) => { x.joints[1].gearRatio = 0; }, 'joints[1].gearRatio'], [(x) => { x.joints[1].axis = [0, 0, 0]; }, 'joints[1].axis'], [(x) => { x.joints[0].drivenBy = 'sts3215-12v'; }, 'joints[0].drivenBy'], [(x) => { x.payload.massKg = -1; }, 'payload.massKg'], [(x) => { x.motors[0].source = 'amazon'; }, 'motors[0].source'], [(x) => { x.base = 'floor'; }, 'base'], [(x) => { x.parts[0].id = 'a/b'; }, 'parts[0].id']]) {
    const bad = lift(); mutate(bad); const err = refused(() => MM.validateMechanism(bad, null));
    assert.ok(err, field); assert.equal(err.field, field, `${field}: ${err.message}`);
  }
  assert.equal(refused(() => MM.validateMechanism(lift(), null) && MM.validateTask({ deltaMm: [0, 0, 0], timeS: 5 })).field, 'task.deltaMm');
  assert.deepEqual(MM.validateTask({ deltaMm: ['0', 0, 300], timeS: '5', line: ' lifts ' }), { line: 'lifts', deltaMm: [0, 0, 300], timeS: 5, loadKg: null });
  const payloadOff = lift(); payloadOff.payload.attachedTo = 'hook';
  assert.equal(refused(() => MM.validateMechanism(payloadOff, null)).code, 'part_not_bound');
  assert.deepEqual(MM.boundPartIds(BINDING), new Set(['base', 'column', 'carriage', 'm-1', 'm-2', 'm-3'])); assert.equal(MM.boundPartIds({ engine: 'embodied', kind: 'design-fit' }), null); assert.equal(MM.boundPartIds({ engine: 'cad-studio', kind: 'cad-models' }), null);
});

test('the task is read from the brief\'s line in its own units, and is absent when no line states one', () => {
  const t = (line) => MM.taskFromBrief({ what: 'x', requirements: [line], targets: {} });
  assert.deepEqual(t('lifts 2 kg to 300 mm in 5 s'), { line: 'lifts 2 kg to 300 mm in 5 s', deltaMm: [0, 0, 300], timeS: 5, loadKg: 2 });
  assert.deepEqual(t('raises a 500 g jar by 12 cm in 2.5 seconds'), { line: 'raises a 500 g jar by 12 cm in 2.5 seconds', deltaMm: [0, 0, 120], timeS: 2.5, loadKg: 0.5 });
  assert.deepEqual(t('hoists 1.5 kg up 1 m in 1 min'), { line: 'hoists 1.5 kg up 1 m in 1 min', deltaMm: [0, 0, 1000], timeS: 60, loadKg: 1.5 });
  assert.equal(t('holds a coat'), null); assert.equal(t('lifts a coat'), null); assert.equal(t('lifts 0 kg to 300 mm in 5 s'), null);
  assert.equal(MM.taskFromBrief({ what: 'x', requirements: ['stands on a base', 'lifts 2 kg to 300 mm in 5 s'], targets: {} }).timeS, 5, 'the first lifting line');
  assert.equal(MM.taskFromBrief(LIFT_1_EXAMPLE.brief).loadKg, 2);
});

test('the plant spec is composed from the mechanism, the parts\' kernel reports and the motor rows as read; a missing read is refused by name', () => {
  const mech = MM.validateMechanism({ ...lift(), task: { line: 'lifts 2 kg to 300 mm in 5 s', deltaMm: [0, 0, 300], timeS: 5, loadKg: 2 } }, null);
  const parts = [{ id: 'base', massG: 496, extentsMm: [200, 200, 10], route: '/api/cad-studio/models', readAt: 'now', revision: 1, modelId: 'm-1' }, { id: 'column', massG: 794, extentsMm: [40, 40, 400], revision: 1 }, { id: 'carriage', massG: 150, extentsMm: [80, 60, 40], revision: 2 }];
  const rows = [{ rowId: 'sts3215-12v', source: 'embodied', name: 'fixture servo', stallNm: 2.942, noLoadRadS: 4.7166, continuousNm: 1.471, route: '/api/embodied/build/catalog', readAt: 'now' }];
  const spec = MM.plantSpecFrom(mech, parts, rows);
  assert.deepEqual(spec.parts[0], { id: 'base', name: 'Base plate', massKg: 0.496, extentsM: [0.2, 0.2, 0.01], source: { modelId: 'm-1', route: '/api/cad-studio/models', readAt: 'now', revision: 1 } });
  assert.equal(spec.parts[2].massKg, 0.15); assert.equal(spec.base, 'base');
  assert.deepEqual(spec.joints[0], { id: 'column-mount', parent: 'base', child: 'column', type: 'fixed', axis: [0, 0, 1], range: undefined, originM: [0, 0, 0.01] });
  assert.deepEqual(spec.joints[1].range, [0, 0.35]); assert.deepEqual(spec.joints[1].originM, [0, 0, 0]);
  assert.deepEqual(spec.actuators, [{ joint: 'carriage-slide', stallNm: 2.942, noLoadRadS: 4.7166, gearRatio: 40, continuousNm: 1.471, row: { id: 'sts3215-12v', source: 'embodied', name: 'fixture servo', route: '/api/embodied/build/catalog', readAt: 'now' } }]);
  assert.deepEqual(spec.payload, { massKg: 2, attachedTo: 'carriage' });
  assert.deepEqual(spec.task, { deltaM: [0, 0, 0.3], timeS: 5, loadKg: 2, line: 'lifts 2 kg to 300 mm in 5 s' });
  assert.deepEqual(spec.senses, ['joints', 'imu', 'payload']);
  const src = fs.readFileSync(path.join(PKG, 'src-routes', 'mechanism-model.ts'), 'utf8');
  assert.ok(!/9\.8\d*|2\.94|4\.71|1\.47/.test(src), 'no gravity, stall, speed or rating typed in the model');
  const noPart = refused(() => MM.plantSpecFrom(mech, parts.slice(0, 2), rows)); assert.equal(noPart.code, 'part_not_read'); assert.equal(noPart.status, 422); assert.match(noPart.message, /carriage has no kernel report/);
  const noRow = refused(() => MM.plantSpecFrom(mech, parts, [])); assert.equal(noRow.code, 'motor_not_read'); assert.match(noRow.message, /sts3215-12v, but that row was not read/);
  const noRating = refused(() => MM.plantSpecFrom(mech, parts, [{ ...rows[0], continuousNm: null }])); assert.equal(noRating.code, 'motor_not_read');
  const byModel = MM.plantSpecFrom({ ...mech, parts: [{ id: 'base', name: 'Base', modelId: 'm-1' }, ...mech.parts.slice(1)] }, [{ id: 'm-1', modelId: 'm-1', massG: 10, extentsMm: [1, 1, 1] }, ...parts.slice(1)], rows);
  assert.equal(byModel.parts[0].massKg, 0.01, 'a part is matched by its model id too');
});

test('the lift example validates against its own binding, its programs validate against CAD Studio\'s compiled contract, and nothing measured is in it', () => {
  assert.equal(findExample('lift-1'), LIFT_1_EXAMPLE);
  assert.deepEqual(LIFT_1_EXAMPLE.phases.map((p) => `${p.kind}:${p.engine}`), ['brief:reasoned', 'design:cad-studio', 'mechanical:reasoned', 'electrical:reasoned', 'simulate:embodied', 'fabricate:scan-to-print', 'build:reasoned']);
  M.validatePhases(LIFT_1_EXAMPLE.phases);
  for (const kind of Object.keys(LIFT_1_EXAMPLE.bindings)) M.validateArtifact(kind, LIFT_1_EXAMPLE.bindings[kind]);
  const mech = MM.validateMechanism(LIFT_1_MECHANISM, LIFT_1_EXAMPLE.bindings.design);
  assert.deepEqual(mech.parts.map((p) => p.id), LIFT_1_EXAMPLE.bindings.design.parts.map((p) => p.id));
  const contractPath = path.join(__dirname, '..', '..', 'cad-studio', 'routes', 'feature-contract.js');
  assert.ok(fs.existsSync(contractPath), `CAD Studio's compiled feature contract is required at ${contractPath}: the lift's programs are validated against the real contract, never skipped`);
  const contract = require(contractPath);
  for (const p of LIFT_1_EXAMPLE.bindings.design.parts) {
    assert.doesNotThrow(() => contract.validateBase(p.program.base), `${p.id} base`);
    const list = contract.validateFeatureList(p.program.features);
    assert.equal(list.length, p.program.features.length, `${p.id}: every feature accepted`);
    list.forEach((f, i) => { assert.equal(f.id, p.program.features[i].id); assert.ok(contract.FEATURE_TYPES.includes(f.type)); });
  }
  assert.equal(LIFT_1_EXAMPLE.bindings.design.parts.length, 3); assert.equal(LIFT_1_EXAMPLE.bindings.simulate.kind, 'plant');
  assert.equal(JSON.stringify(LIFT_1_EXAMPLE.bindings.simulate).match(/\d/g), null, 'the simulate binding is a name, never a number');
  assert.equal(LIFT_1_MECHANISM.task, null, 'the task is read from the brief when the project is created, never typed in the example');
});

test('the body contract of a generated plant publishes the actuators from the row, the certified reach policy and the plant route as the node', () => {
  const project = { id: 'p-lift', name: 'lift-1', brief: LIFT_1_EXAMPLE.brief, phases: LIFT_1_EXAMPLE.phases };
  const plant = { kind: 'plant', route: '/api/embodied/physics/plant', readAt: 't', physicsDt: 0.002, controlDtS: 0.02, specSha256: 'spec-1', massKg: 3.528, actuators: [{ joint: 'carriage-slide', type: 'slide', range: [0, 0.35], stallNm: 2.942, noLoadRadS: 4.7166, gearRatio: 40, continuousNm: 1.471, unit: 'N', row: { id: 'sts3215-12v', source: 'embodied' } }], joints: [], senses: [{ name: 'joints', present: true, count: 1, rateHz: 50 }, { name: 'imu', present: true, rateHz: 50 }, { name: 'payload', present: true, rateHz: 50 }] };
  const read = { route: '/api/embodied/physics/reports', readAt: 't', plant, report: { file: 'plant-p-lift-reach-seed0.json' }, certificate: { file: 'plant-p-lift-reach-ppo-seed0.certificate.json', policyFile: 'plant-p-lift-reach-ppo-seed0.zip', policySha256: 'sha-lift', buildHash: 'build-x', ok: true, checked: 1875, refusedCount: 0 } };
  const bindings = { design: { id: 'b1', phase: 'design', revision: 1, bound_at: 't', artifact: { ...LIFT_1_EXAMPLE.bindings.design, read: { route: '/api/cad-studio/models', readAt: 't', revision: 'r-1' } } }, simulate: { id: 'b2', phase: 'simulate', revision: 2, bound_at: 't', artifact: { engine: 'embodied', kind: 'plant', read } } };
  const { body, required } = buildBodyContract(project, bindings);
  assert.deepEqual(required, [], body.missing.join('; '));
  assert.deepEqual(body.actuators, [{ joint: 'carriage-slide', rangeRad: [0, 0.35], unit: 'm', type: 'slide', continuousNm: 1.471, stallNm: 2.942, noLoadRpm: 45.04, gearRatio: 40 }]);
  assert.deepEqual(body.plant, { engine: 'embodied', mjcf: '/api/embodied/physics/plant', physicsDt: 0.002, tickS: 0.02, kind: 'plant', specSha256: 'spec-1' });
  assert.deepEqual(body.walker, { kind: 'certified-policy', policySha256: 'sha-lift', certificate: 'plant-p-lift-reach-ppo-seed0.certificate.json', command: PLANT_COMMAND, door: 'plant.step {command}' });
  assert.deepEqual(body.node, { kind: 'plant', endpoint: '/api/embodied/physics/plant' });
  assert.equal(body.senses.find((s) => s.name === 'joints').count, 1); assert.equal(body.senses.find((s) => s.name === 'imu').present, true); assert.equal(body.senses.find((s) => s.name === 'lidar').present, false);
  assert.equal(body.senses.find((s) => s.name === 'payload').present, true, 'the plant\'s payload sensor is published beside the cube\'s vocabulary');
  assert.deepEqual(body.missing, [], 'every value has an engine read');
  const unbuilt = buildBodyContract(project, { simulate: { ...bindings.simulate, artifact: { engine: 'embodied', kind: 'plant', read: { ...read, plant: { kind: 'plant', route: '/api/embodied/physics/plant' } } } } });
  assert.ok(unbuilt.required.some((m) => /^actuators:/.test(m)) && unbuilt.required.some((m) => /^plant\.physicsDt/.test(m)), unbuilt.required.join('; '));
  const refusedCert = buildBodyContract(project, { simulate: { ...bindings.simulate, artifact: { engine: 'embodied', kind: 'plant', read: { ...read, certificate: { ...read.certificate, ok: false } } } } });
  assert.equal(refusedCert.body.walker.kind, 'none'); assert.ok(refusedCert.required.some((m) => /^walker:/.test(m)));
});
