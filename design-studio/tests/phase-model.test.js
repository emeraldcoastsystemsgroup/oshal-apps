/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203, lane @ds-app: the process as data, against the COMPILED modules with no framework import - the vocabulary in its one order; a hanger's brief proposes four phases and the spider's six lines all nine, each with the lines that asked for it, and a thermal need is named as unsolved; validatePhases orders, refuses an unknown kind, an engine the phase brief does not allow, a duplicate and a chain without brief or build; validateBrief and validateArtifact name the field they refuse; validateClosure refuses missing_evidence without the evidence line OR the revision and missing_step on the build phase; the body contract is built from bound reads with every value traced to the fixture reply and refuses body_incomplete when a required read is absent.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const M = require(path.join(PKG, 'routes', 'phase-model.js'));
const { buildBodyContract, BODY_SCHEMA, WALKER_COMMAND } = require(path.join(PKG, 'routes', 'body-contract.js'));
const { SPIDER_18_EXAMPLE, findExample, listExamples } = require(path.join(PKG, 'routes', 'examples.js'));

const SPIDER_LINES = ['holds a Raspberry Pi', 'has heat', 'one LiDAR eye', 'six legs', 'jumps', 'flips its legs when upside down'];

test('the vocabulary is the nine kinds in the ADR order and every kind has a phase brief', () => {
  assert.deepEqual([...M.PHASE_KINDS], ['brief', 'design', 'mechanical', 'electrical', 'sensors', 'controller', 'simulate', 'fabricate', 'build']);
  for (const kind of M.PHASE_KINDS) { const b = M.PHASE_BRIEFS[kind]; assert.equal(b.kind, kind); assert.ok(b.produces && b.closes && b.stages.length && b.action, `${kind} has a full brief`); assert.ok(b.engines.includes(b.defaultEngine)); }
  assert.deepEqual([...M.ENGINES], ['cad-studio', 'circuit-lab', 'embodied', 'scan-to-print', 'reasoned']);
});

test('a hanger proposes brief, design, fabricate, build; the spider proposes all nine with the lines that asked, and heat is unsolved', () => {
  const hanger = M.proposePhases({ what: 'a clothes hanger', requirements: ['holds a coat', 'hangs on a closet rail'], targets: {} });
  assert.deepEqual(hanger.phases.map((p) => p.kind), ['brief', 'design', 'fabricate', 'build']);
  assert.deepEqual(hanger.unsolved, []);
  const spider = M.proposePhases({ what: 'a six-legged walking robot', requirements: SPIDER_LINES, targets: {} });
  assert.deepEqual(spider.phases.map((p) => p.kind), [...M.PHASE_KINDS]);
  assert.match(spider.phases.find((p) => p.kind === 'sensors').why, /one LiDAR eye/);
  assert.match(spider.phases.find((p) => p.kind === 'mechanical').why, /six legs/);
  assert.match(spider.phases.find((p) => p.kind === 'simulate').why, /jumps/);
  assert.equal(spider.phases.find((p) => p.kind === 'electrical').engine, 'circuit-lab');
  assert.equal(spider.unsolved.length, 1); assert.match(spider.unsolved[0], /has heat - a thermal phase has no engine/);
  const fridge = M.proposePhases({ what: 'a garage refrigerator', requirements: ['keeps food cold', 'runs on mains power', 'has a door sensor'], targets: {} });
  assert.deepEqual(fridge.phases.map((p) => p.kind), ['brief', 'design', 'electrical', 'sensors', 'fabricate', 'build']);
  assert.equal(fridge.unsolved.length, 1);
});

test('validatePhases orders the chain and refuses an unknown kind, a disallowed engine, a duplicate and a chain without brief or build', () => {
  const ordered = M.validatePhases([{ kind: 'build' }, { kind: 'design', engine: 'cad-studio' }, { kind: 'brief' }]);
  assert.deepEqual(ordered.map((p) => `${p.kind}:${p.engine}`), ['brief:reasoned', 'design:cad-studio', 'build:reasoned']);
  const refused = (value) => { try { M.validatePhases(value); } catch (e) { return e; } return null; };
  assert.equal(refused([{ kind: 'thermal' }, { kind: 'brief' }, { kind: 'build' }]).code, 'unknown_phase');
  assert.equal(refused([{ kind: 'brief' }, { kind: 'electrical', engine: 'cad-studio' }, { kind: 'build' }]).code, 'unknown_engine');
  assert.equal(refused([{ kind: 'brief' }, { kind: 'design' }, { kind: 'design' }, { kind: 'build' }]).code, 'duplicate_phase');
  assert.equal(refused([{ kind: 'design' }, { kind: 'build' }]).code, 'bad_phases');
  assert.equal(M.validatePhases([{ kind: 'brief' }, { kind: 'simulate', engine: 'embodied', brain: 'anything' }, { kind: 'build' }])[1].brain, undefined, 'the package names no outside brain');
});

test('validateBrief and validateArtifact name the field they refuse', () => {
  const refused = (fn) => { try { fn(); } catch (e) { return e; } return null; };
  assert.equal(refused(() => M.validateBrief({ what: '' })).field, 'brief.what');
  assert.equal(refused(() => M.validateBrief({ what: 'a thing', targets: { massG: -2 } })).field, 'brief.targets.massG');
  const brief = M.validateBrief({ what: ' a   thing ', requirements: 'holds a coat\n\nhangs up', targets: { massG: '40', sizeMm: '400 x 200' } });
  assert.deepEqual(brief, { what: 'a thing', requirements: ['holds a coat', 'hangs up'], targets: { massG: 40, sizeMm: '400 x 200' } });
  assert.equal(refused(() => M.validateArtifact('design', { engine: 'circuit-lab', kind: 'x' })).field, 'artifact.engine');
  assert.equal(refused(() => M.validateArtifact('design', { engine: 'embodied', kind: 'Bad Kind' })).field, 'artifact.kind');
  assert.equal(refused(() => M.validateArtifact('design', { engine: 'embodied', kind: 'design-fit', read: 'text' })).field, 'artifact.read');
  assert.deepEqual(M.validateArtifact('design', { engine: 'embodied', kind: 'design-fit', fit: 'spider-18' }), { engine: 'embodied', kind: 'design-fit', fit: 'spider-18' });
});

test('validateClosure refuses missing_evidence without the evidence line OR the revision, and missing_step on the build phase', () => {
  const refused = (kind, body) => { try { M.validateClosure(kind, body); } catch (e) { return e; } return null; };
  assert.equal(refused('design', { revision: 'r1' }).code, 'missing_evidence'); assert.equal(refused('design', { revision: 'r1' }).status, 422);
  assert.equal(refused('design', { evidence: 'parts-complete' }).code, 'missing_evidence'); assert.equal(refused('design', { evidence: 'parts-complete' }).field, 'revision');
  assert.equal(refused('build', { evidence: 'ticked', revision: 'bench' }).code, 'missing_step');
  assert.deepEqual(M.validateClosure('design', { evidence: ' parts-complete  · 13 programs ', revision: 7 }), { evidence: 'parts-complete · 13 programs', revision: '7', step: null, by: 'person' });
  assert.equal(M.validateClosure('build', { evidence: 'ticked', revision: 'bench', step: 'assemble:plate', by: 'design-partner' }).by, 'design-partner');
});

test('the spider example binds every phase but the brief by name, with no number of the design in it', () => {
  assert.deepEqual(listExamples().map((e) => e.id), ['spider-18', 'lift-1']);
  assert.equal(findExample('nope'), null);
  const e = SPIDER_18_EXAMPLE;
  assert.deepEqual(e.phases.map((p) => p.kind), [...M.PHASE_KINDS]);
  assert.deepEqual(e.brief.requirements, SPIDER_LINES);
  assert.deepEqual(e.brief.targets, {});
  for (const kind of M.PHASE_KINDS.filter((k) => k !== 'brief')) assert.ok(e.bindings[kind], `${kind} is bound`);
  const numbers = JSON.stringify(e.bindings).match(/\d+(\.\d+)?/g).map(Number).filter((n) => !Number.isInteger(n) || n > 18);
  assert.deepEqual(numbers, [], 'the bindings carry names (spider-18, hexapod-power, seed1), never a measured number');
  for (const kind of Object.keys(e.bindings)) M.validateArtifact(kind, e.bindings[kind]);
});

/** Bound reads in the shape the page records: numbers that are the fixture's, so the contract can be traced to them. */
function reads() {
  const design = { route: '/api/embodied/build/hexapod?fit=spider-18', readAt: '2026-10-30T20:00:00.000Z', revision: 'ab12cd34', servo: { id: 'sts3215-12v', stallNm: 2.942, noLoadRadS: 4.7166 }, joints: [{ joint: 'coxa', nm: 1.15, usableNm: 1.47, stallNm: 2.942, withinContinuous: true }, { joint: 'femur', nm: 1.43, usableNm: 1.47, stallNm: 2.942, withinContinuous: true }, { joint: 'tibia', nm: 1.0, usableNm: 1.47, stallNm: 2.942, withinContinuous: true }] };
  const simulate = { route: '/api/embodied/physics/reports', readAt: '2026-10-30T20:00:01.000Z', certificate: { file: 'hexapod-walk-ppo-shape-seed1.certificate.json', policyFile: 'hexapod-walk-ppo-shape-seed1.zip', policySha256: 'd15f6a7d2048e7ce', buildHash: '7346d37a', ok: true, checked: 1631, refusedCount: 0 },
    plant: { route: '/api/embodied/physics/hexapod/mjcf?fit=spider-18&jump=legs-hop', physicsDt: 0.002, joints: [{ name: 'L1-coxa', rangeRad: [-1.047, 1.047] }, { name: 'L1-femur', rangeRad: [-2.094, 2.094] }, { name: 'L1-tibia', rangeRad: [-2.443, 2.443] }] } };
  const controller = { route: '/api/embodied/physics/status', readAt: '2026-10-30T20:00:02.000Z', node: { nodeId: 'spider-pi', kind: 'hexapod', online: true, endpoint: 'http://spider-pi:7421', tickHz: 50 } };
  const sensors = { route: '/api/embodied/build/hexapod?fit=spider-18', readAt: '2026-10-30T20:00:03.000Z', senses: [{ name: 'lidar', present: true, row: { id: 'ld19-lidar' }, mount: 'Head (LiDAR nose)' }, { name: 'imu', present: true, row: { id: 'bno055-imu' } }, { name: 'joints', present: true, count: 18 }] };
  const binding = (phase, read) => ({ id: phase, phase, artifact: { engine: 'embodied', kind: phase, read }, revision: 1, bound_at: read.readAt });
  return { design: binding('design', design), simulate: binding('simulate', simulate), controller: binding('controller', controller), sensors: binding('sensors', sensors) };
}
const project = { id: 'p1', name: 'spider-18', brief: SPIDER_18_EXAMPLE.brief, phases: SPIDER_18_EXAMPLE.phases, created_at: 'x', updated_at: 'y' };

test('the body contract publishes every value from the bound reads, traced to the fixture, and nothing else', () => {
  const { body, required } = buildBodyContract(project, reads());
  assert.deepEqual(required, []);
  assert.equal(body.schema, BODY_SCHEMA); assert.equal(body.project, 'p1'); assert.equal(body.revision, 'ab12cd34');
  assert.deepEqual(body.plant, { engine: 'embodied', mjcf: '/api/embodied/physics/hexapod/mjcf?fit=spider-18&jump=legs-hop', physicsDt: 0.002, tickS: 0.02 });
  assert.deepEqual(body.actuators, [
    { joint: 'L1-coxa', rangeRad: [-1.047, 1.047], continuousNm: 1.47, stallNm: 2.942, noLoadRpm: 45.04 },
    { joint: 'L1-femur', rangeRad: [-2.094, 2.094], continuousNm: 1.47, stallNm: 2.942, noLoadRpm: 45.04 },
    { joint: 'L1-tibia', rangeRad: [-2.443, 2.443], continuousNm: 1.47, stallNm: 2.942, noLoadRpm: 45.04 },
  ]);
  assert.deepEqual(body.walker, { kind: 'certified-gait', policySha256: 'd15f6a7d2048e7ce', certificate: 'hexapod-walk-ppo-shape-seed1.certificate.json', command: WALKER_COMMAND, door: 'hexapod.step {command}' });
  assert.deepEqual(body.node, { kind: 'hexapod', endpoint: 'http://spider-pi:7421' });
  assert.deepEqual(body.senses.map((s) => `${s.name}:${s.present}`), ['lidar:true', 'imu:true', 'joints:true', 'vision:false', 'audio:false', 'thermal:false', 'touch:false']);
  assert.equal(body.senses[2].count, 18);
  assert.deepEqual(body.missing, ['senses.lidar.rateHz: no engine reply stated the rate', 'senses.imu.rateHz: no engine reply stated the rate', 'senses.joints.rateHz: no engine reply stated the rate']);
  assert.deepEqual(body.readAt, { design: '2026-10-30T20:00:00.000Z', simulate: '2026-10-30T20:00:01.000Z', controller: '2026-10-30T20:00:02.000Z', sensors: '2026-10-30T20:00:03.000Z' });
});

test('the body contract is body_incomplete without the plant, the certificate or the node read, and names each missing value', () => {
  const r = reads();
  delete r.simulate; delete r.controller;
  const { body, required } = buildBodyContract(project, r);
  assert.deepEqual(required, ['actuators: the simulate phase has no plant read (the MJCF joints and ranges)', 'plant.physicsDt: the simulate phase has no plant read (the MJCF timestep)', 'walker.policySha256: the simulate phase has no certificate read', 'node.kind: the controller phase has no node read']);
  assert.equal(body.walker.kind, 'none'); assert.equal(body.plant.physicsDt, null); assert.deepEqual(body.actuators, []);
  const refusedCert = reads(); refusedCert.simulate.artifact.read.certificate.ok = false;
  assert.deepEqual(buildBodyContract(project, refusedCert).required, ['walker: the bound certificate did not pass (ok is not true)']);
  const byName = reads(); delete byName.controller; byName.controller = { id: 'c', phase: 'controller', artifact: { engine: 'embodied', kind: 'node', nodeKind: 'hexapod' }, revision: 1, bound_at: 'x' };
  const named = buildBodyContract(project, byName);
  assert.equal(named.body.node.kind, 'hexapod'); assert.equal(named.body.node.endpoint, null); assert.equal(named.body.plant.tickS, null);
  assert.ok(named.body.missing.some((m) => /plant\.tickS/.test(m)));
});
