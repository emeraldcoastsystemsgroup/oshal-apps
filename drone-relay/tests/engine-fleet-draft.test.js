/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The formation as a Drone Ops fleet-mission draft (backlog B6, first half; B4's slots as latitude / longitude): the plan's local frame lands on the map with the drone package's metres per degree; the default chain drafts five assignments — r1..r4 at 40 m and the tip at 30 m, each one waypoint at its slot, the plan's cruise speed, return to launch — whose holds end together, the farthest relay's after its 123 s of hovering station time; roster ids take the caller's fleet ids; ground nodes are placed by hand and fly in no assignment; a tree drafts one assignment per tip; a perched plan says its holds are sized on a hovering battery; the refusals name the field (no home, a latitude past 80°, an unknown roster id, a malformed or repeated fleet id, an infeasible plan, a formation of more than the eight drones one fleet mission carries); and the draft module itself sends nothing and imports no network or framework module. The real drone-package validator accepting the draft is `tests/fleetmission.core.test.js` (framework checkout).
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

const HOME = { lat: 30.4, lon: -86.6 };

function plan(input) {
  const spec = e.validateSpec(input);
  return { spec, plan: e.planChain(spec) };
}

function refused(field, fn) {
  assert.throws(fn, (err) => err.name === 'SpecError' && err.field === field, `expected a SpecError naming ${field}`);
}

test('a local point lands on the map with the drone package\'s metres per degree', () => {
  assert.equal(e.M_PER_DEG_LAT, 111320);
  assert.deepEqual(e.toGeo(HOME, { x: 0, y: 0, z: 40 }), { lat: 30.4, lon: -86.6, alt: 40 });
  assert.deepEqual(e.toGeo(HOME, { x: 0, y: 111.32, z: 0 }), { lat: 30.401, lon: -86.6, alt: 0 }, '111.32 m north is a thousandth of a degree');
  const east = e.toGeo(HOME, { x: 1000, y: 0, z: 0 });
  assert.equal(east.lat, 30.4);
  assert.ok(Math.abs((east.lon - HOME.lon) * 111320 * Math.cos((30.4 * Math.PI) / 180) - 1000) < 0.02, 'a kilometre east, back to within two centimetres');
});

test('the default chain drafts one assignment per relay and the tip, holding together for one hovering sortie', () => {
  const { spec, plan: p } = plan({ fleetSize: 6 });
  const out = e.formationDraft(spec, p, HOME);
  assert.equal(out.draft.name, 'Relay chain — relay formation');
  assert.deepEqual(out.draft.assignments.map((a) => a.droneId), ['r1', 'r2', 'r3', 'r4', 'tip']);
  assert.deepEqual(out.draft.assignments.map((a) => a.plan.waypoints.length), [1, 1, 1, 1, 1], 'each drone flies to its slot');
  assert.deepEqual(out.draft.assignments.map((a) => a.plan.waypoints[0].alt), [40, 40, 40, 40, 30], 'relays in the relay band, the tip in its own');
  assert.deepEqual(out.draft.assignments.map((a) => a.plan.waypoints[0].lon), [-86.597917, -86.595834, -86.593751, -86.591668, -86.589585]);
  assert.ok(out.draft.assignments.every((a) => a.plan.waypoints[0].lat === 30.4 && a.plan.speedMps === 6 && a.plan.rtlAfterMission === true));
  assert.equal(out.formationHoldS, 123, 'the farthest relay\'s hovering station time');
  assert.deepEqual(out.draft.assignments.map((a) => a.plan.waypoints[0].holdSeconds), [223, 189, 156, 123, 89], 'nearer drones arrive sooner and hold longer: they all leave together');
  const leave = out.draft.assignments.map((a, i) => [200, 400, 600, 800, 1000][i] / 6 + a.plan.waypoints[0].holdSeconds);
  assert.ok(Math.max(...leave) - Math.min(...leave) < 1, `every hold ends within a second of the others (${leave.map(Math.round).join(', ')})`);
  assert.ok(out.notes.some((n) => /Nothing in Drone Relay can execute it/.test(n)));
  assert.ok(out.notes.some((n) => /not part of a Drone Ops fleet mission/.test(n)), 'says what the draft is not');
});

test('roster ids take the caller\'s fleet ids; ground nodes fly in no assignment; a tree drafts every tip', () => {
  const { spec, plan: p } = plan({ fleetSize: 6 });
  const named = e.formationDraft(spec, p, HOME, { r1: 'alpha', tip: 'bravo' });
  assert.deepEqual(named.draft.assignments.map((a) => a.droneId), ['alpha', 'r2', 'r3', 'r4', 'bravo']);
  const ground = plan({ groundNodes: [400], fleetSize: 6, enduranceS: 1800 });
  assert.deepEqual(e.formationDraft(ground.spec, ground.plan, HOME).draft.assignments.map((a) => [a.droneId, a.plan.waypoints[0].lon]), [['r1', -86.597917], ['r2', -86.593751], ['r3', -86.591668], ['tip', -86.589585]], 'the node at 400 m is placed by hand, not flown');
  const tree = plan({ path: [{ x: 0, y: 0 }, { x: 400, y: 0 }], branches: [[{ x: 400, y: 300 }], [{ x: 400, y: -300 }]], fleetSize: 6, enduranceS: 1800 });
  const drafted = e.formationDraft(tree.spec, tree.plan, HOME).draft.assignments;
  assert.deepEqual(drafted.map((a) => a.droneId), ['r1', 'r2', 'r3', 'r4', 'tip1', 'tip2']);
  assert.deepEqual(drafted.slice(4).map((a) => [a.plan.waypoints[0].lat, a.plan.waypoints[0].alt]), [[30.4026949, 30], [30.3973051, 30]], 'a tip 300 m north and one 300 m south of the fork');
  const perched = plan({ fleetSize: 6, posture: 'perch' });
  assert.ok(e.formationDraft(perched.spec, perched.plan, HOME).notes.some((n) => /sized on a hovering battery/.test(n)));
});

test('draft refusals name their field', () => {
  const { spec, plan: p } = plan({ fleetSize: 6 });
  refused('home', () => e.formationDraft(spec, p, undefined));
  refused('home.lat', () => e.formationDraft(spec, p, { lon: -86.6 }));
  refused('home.lon', () => e.formationDraft(spec, p, { lat: 30.4 }));
  refused('home.lat', () => e.formationDraft(spec, p, { lat: 85, lon: 0 }));
  refused('home.lon', () => e.formationDraft(spec, p, { lat: 30, lon: 'west' }));
  refused('drones.r9', () => e.formationDraft(spec, p, HOME, { r9: 'alpha' }));
  refused('drones.s1', () => e.formationDraft(spec, p, HOME, { s1: 'alpha' }));
  refused('drones.r1', () => e.formationDraft(spec, p, HOME, { r1: 'Alpha Leader!' }));
  refused('drones', () => e.formationDraft(spec, p, HOME, { r1: 'alpha', r2: 'alpha' }));
  refused('drones', () => e.formationDraft(spec, p, HOME, { r1: 'r2' }));
  refused('drones', () => e.formationDraft(spec, p, HOME, ['alpha']));
  const small = plan({ fleetSize: 2 });
  refused('plan', () => e.formationDraft(small.spec, small.plan, HOME));
  const long = plan({ path: [{ x: 0, y: 0 }, { x: 2000, y: 0 }], fleetSize: 12, enduranceS: 1800 });
  assert.equal(long.plan.relaysNeeded, 9);
  refused('drones', () => e.formationDraft(long.spec, long.plan, HOME));
  assert.equal(e.FLEET_MISSION_MAX_DRONES, 8);
});

test('the draft module sends nothing: it imports no network, process or framework module', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'routes', 'engine', 'fleet-draft.js'), 'utf8');
  const required = [...source.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(required.sort(), ['./spec-error']);
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|\/api\/drone\//);
});
