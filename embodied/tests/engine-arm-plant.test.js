/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | B22 half (a): the arm as a plant INSIDE the room. The room model is the bench model's own arm (same joints, same actuators, same radian preamble) standing at the carriage pose with the scene's solids around it; the mount is refused before any model is built when it is outside the room or inside the furniture; on a plant the joint truth is the MEASUREMENT and the guards, the tool point and the tip budget read it; arrival is the plant's; a rehearsal clones the arm, and an arm that is one body refuses the copy. Also the refusals B22's failure modes imply: an unreachable target, a base in the furniture, a mount off the room.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const { E, explored } = require('./helpers');

const ROOM_FIXTURE = path.join(__dirname, '..', 'engine', 'tests', 'fixtures', 'arm-room-kitchen.xml');
const { FakeArmPlant, SingleBodyArmPlant, DROOP_RAD } = require('./fake-arm-plant');

const KITCHEN = () => new E.WorldSim();

test('the room model is the SAME arm the sizing check measures, standing in the scene', () => {
  const sim = KITCHEN();
  const solids = sim.sensingSolids();
  const mount = sim.armMount();
  const room = E.armRoomMjcf('desk-6', solids, mount);
  const bench = E.armMjcf('desk-6');
  // Same joints, same actuators, same angle convention: MuJoCo reads angles as DEGREES without this line and an arm
  // whose limits are read as degrees has no reachable workspace at all.
  assert.ok(room.includes('<compiler angle="radian"'), 'the room model must declare radians');
  for (const j of ['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'grip']) {
    assert.ok(room.includes(`<position name="${j}"`), `${j} actuator`);
    assert.ok(bench.includes(`<position name="${j}"`), `${j} on the bench too`);
  }
  for (const j of ['j1', 'j2', 'j3', 'j4', 'j5', 'j6']) {
    const of = (xml) => xml.split(`<joint name="${j}"`)[1].split('/>')[0];
    assert.equal(of(room), of(bench), `${j} is the same joint in the room as on the bench`);
  }
  // The room supplies the floor and the furniture; there is no bench plane and no bench block.
  assert.ok(!room.includes('name="bench"') && !room.includes('name="block"'), 'the room is not the bench');
  assert.equal((room.match(/class="scene" type=/g) || []).length, solids.length, 'one scene geom per solid');
  assert.ok(room.includes('<geom name="base" type="cylinder"'), 'the printed base it stands on');
  assert.ok(room.includes(`<body name="arm-base" pos="${Number(mount.x.toFixed(6))} ${Number(mount.y.toFixed(6))}`), 'mounted where the carriage parks');
});

test('a mount outside the room is refused before any model is built', () => {
  const sim = KITCHEN();
  const room = sim.scene.room;
  const solids = sim.sensingSolids();
  const outside = { x: room.maxX + 0.5, y: 1, z: 0, yaw: 0 };
  const refusal = E.armMountRefusal(room, solids, outside);
  assert.ok(refusal && refusal.startsWith('refused:'), 'a base off the room is refused');
  assert.ok(refusal.includes('outside the room'), refusal);
  // The base is a plate, not a point: a base whose CENTRE is inside but whose rim hangs over the wall is refused too.
  const onTheEdge = { x: room.maxX - E.ARM_BASE_RADIUS_M / 2, y: 1, z: 0, yaw: 0 };
  assert.ok(E.armMountRefusal(room, solids, onTheEdge), 'a base whose rim overhangs the wall is refused');
  assert.equal(E.armMountRefusal(room, solids, sim.armMount()), null, 'the carriage park is a good mount');
});

test('a scene solid where the arm stands is refused, and says which solid', () => {
  const sim = KITCHEN();
  const solids = sim.sensingSolids();
  const blocker = solids.find((s) => s.name !== 'floor' && s.max[2] > 0.1);
  const inIt = { x: (blocker.min[0] + blocker.max[0]) / 2, y: (blocker.min[1] + blocker.max[1]) / 2, z: 0, yaw: 0 };
  const refusal = E.armMountRefusal(sim.scene.room, solids, inIt);
  assert.ok(refusal && refusal.includes(blocker.name), `expected the refusal to name ${blocker.name}, got ${refusal}`);
  assert.ok(E.solidHitsBase(blocker, inIt), 'the base footprint really overlaps it');
  // The floor is never the thing in the way: the base rests ON it.
  const floor = solids.find((s) => s.name === 'floor');
  if (floor) assert.equal(E.armMountRefusal(sim.scene.room, [floor], sim.armMount()), null, 'the floor is not an obstruction');
});

test('on a plant the joint truth is the MEASUREMENT, not the command echoed back', () => {
  // The arm's guards refuse unknown space, so the world is explored first and the plant then answers for the arm —
  // exactly the switch `POST /world/reset {arm:'physics'}` makes.
  const sim = explored();
  const plant = new FakeArmPlant({ q: [...sim.unit.q] });
  sim.armPlant = plant;
  const target = sim.unit.q.map((v, i) => v + (i === 1 ? 0.15 : 0));
  sim.moveArmJoints(target);
  for (let i = 0; i < 400 && sim.unit.qTarget; i += 1) sim.advance(50);
  assert.equal(sim.unit.qTarget, null, 'the plant reported it settled and the target cleared');
  assert.ok(plant.steps > 0, 'the plant was stepped');
  // The servo stands off its command: the sim holds what was MEASURED, which is not the command.
  const drooped = Math.abs(target[1] - sim.unit.q[1]);
  assert.ok(drooped > DROOP_RAD / 2, `expected the measured angle to sit short of the command, off by ${drooped}`);
  assert.ok(drooped < 0.01, 'and inside the settle tolerance');
  const snap = sim.snapshot();
  assert.equal(snap.unit.backend, 'physics');
  assert.equal(snap.unit.node, null, 'no node identity on a dialled plant');
  assert.equal(snap.unit.servos.torqueNm.length, 6, 'what every servo exerted rides in the snapshot');
  assert.deepEqual(snap.unit.q, sim.unit.q, 'the snapshot reports the measurement');
});

test('a contact with the room is reported as an event, once per contact', () => {
  const sim = explored();
  const plant = new FakeArmPlant({ q: [...sim.unit.q] });
  sim.armPlant = plant;
  sim.moveArmJoints(sim.unit.q.map((v, i) => v + (i === 1 ? 0.1 : 0)));
  plant.forceContact('counter');
  sim.advance(50);
  const hits = sim.snapshot().events.filter((e) => e.text.includes('touched counter'));
  assert.equal(hits.length, 1, 'one contact, one event');
  assert.equal(sim.armTelemetry.contact, 'counter');
  sim.advance(50);
  assert.equal(sim.armTelemetry.contact, null, 'the contact cleared when the plant stopped reporting it');
});

test('a rehearsal clones the arm plant; an arm that is one body refuses the copy', () => {
  const plant = new FakeArmPlant({ q: [...E.STOW_Q] });
  const sim = new E.WorldSim({ armPlant: plant });
  const copy = sim.clone();
  assert.equal(plant.clones, 1, 'the rehearsal asked the arm for a copy');
  assert.ok(copy.armPlant && copy.armPlant !== plant, 'the copy has its own arm');
  assert.equal(copy.snapshot().unit.backend, 'physics');

  const live = explored();
  const one = new SingleBodyArmPlant({ q: [...live.unit.q] });
  live.armPlant = one;
  const twin = live.clone();
  assert.equal(one.clones, 1);
  assert.equal(twin.armPlant, null, 'a body that cannot be copied rehearses on the kinematic twin');
  assert.equal(twin.snapshot().unit.backend, 'kinematic');
  // The twin still moves - the rehearsal is not dead, it is kinematic.
  twin.moveArmJoints(twin.unit.q.map((v, i) => v + (i === 1 ? 0.05 : 0)));
  for (let i = 0; i < 200 && twin.unit.qTarget; i += 1) twin.advance(50);
  assert.equal(twin.unit.qTarget, null, 'the kinematic twin arrives');
});

test('the guards are unchanged on a plant: an unreachable target is refused before the plant is ever stepped', () => {
  const plant = new FakeArmPlant({ q: [...E.STOW_Q] });
  const sim = new E.WorldSim({ armPlant: plant });
  const park = sim.armMount();
  // A point across the room is outside this arm's workspace wherever the carriage stands.
  assert.throws(() => sim.moveArmToWorldPose({ x: park.x + 3, y: park.y, z: 1.0, roll: 0, pitch: Math.PI / 2, yaw: 0 }), /refused/);
  assert.equal(plant.steps, 0, 'a refused command never reaches the plant');
  assert.throws(() => sim.moveArmJoints([0, 0, 0]), /wrong joint count/);
  assert.equal(plant.steps, 0);
});

test('the arm mount follows the carriage, and every fit builds a loadable room model', () => {
  const sim = KITCHEN();
  const park = sim.armMount();
  assert.ok(Math.abs(park.z - sim.unit.base.liftZ) < 1e-9, 'the mount rides the lift');
  const forward = Math.hypot(park.x - sim.unit.base.x, park.y - sim.unit.base.y);
  assert.ok(Math.abs(forward - E.ARM_MOUNT_X) < 1e-9, 'the base sits ARM_MOUNT_X ahead of the carriage frame');
  for (const fit of Object.keys(E.ARM_FITS)) {
    const xml = E.armRoomMjcf(fit, sim.sensingSolids(), park);
    assert.ok(xml.includes(`model="embodied-arm-room-${fit}"`) && xml.trim().endsWith('</mujoco>'), `${fit} builds`);
  }
});

test('a world refuses a plant that is not the arm it believes it is driving', () => {
  const printed = E.buildArm('desk-6').spec;
  const dh = printed.joints.map((j) => [j.d, j.a, j.alpha]);
  // The stock SIM_ARM_6 is a different machine from the printed desk-6 (a 0.35 m upper arm against 0.16 m). A belief
  // built on the wrong link lengths misses the tool point with no symptom at all, so the two are compared at load.
  assert.throws(() => new E.WorldSim({ armPlant: new FakeArmPlant({ dh }) }), /refused: the arm plant is not this arm/);
  const ok = new E.WorldSim({ armSpec: printed, armPlant: new FakeArmPlant({ dh, q: new Array(6).fill(0) }) });
  assert.equal(ok.snapshot().unit.backend, 'physics');
  assert.equal(E.armSpecMismatch(new FakeArmPlant({ dh }), dh), null);
  assert.match(E.armSpecMismatch(new FakeArmPlant({ dh: dh.slice(0, 5) }), dh), /5 joints/);
  assert.match(E.armSpecMismatch(new FakeArmPlant({ dh: [[dh[0][0] + 0.01, dh[0][1], dh[0][2]], ...dh.slice(1)] }), dh), /joint 1 differs/);
});

test('the printed arm really loads and really droops in MuJoCo (measured in the container, recorded here)', () => {
  // Measured by the room-model probe on the engine image (oshal-embodied-engine:local, MuJoCo 3.3.5, 2026-09-14):
  // the kitchen room model loads as 10 bodies / 47 geoms / 7 actuators at a 2 ms timestep, and a shoulder commanded to
  // 1.6 rad settles at 1.595892 — 4.1 mrad SHORT, the elbow 7.4 mrad short, which is why the sim reads the measurement
  // and never the command. This test pins the model the probe loaded so the generator cannot drift away from it.
  const sim = new E.WorldSim();
  const xml = E.armRoomMjcf('desk-6', sim.sensingSolids(), sim.armMount());
  assert.equal((xml.match(/<geom name=/g) || []).length, 47, 'the geom count MuJoCo reported');
  assert.equal((xml.match(/<position /g) || []).length, 7, 'six joints and the grip');
  assert.equal((xml.match(/<body /g) || []).length, 9, 'arm-base, six links, the jaw and the payload (world is the tenth body)');
  assert.ok(xml.includes('timestep="0.002"'), 'the timestep MuJoCo reported');
  // And this is the exact model the probe loaded: regenerate the fixture and re-run the probe when the generator,
  // the arm design or the kitchen scene changes, or these numbers are a claim about a model nobody loaded.
  assert.equal(xml, fs.readFileSync(ROOM_FIXTURE, 'utf8').split(String.fromCharCode(13)).join(''), 'regenerate engine/tests/fixtures/arm-room-kitchen.xml when the generator or the scene changes');
});
