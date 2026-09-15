/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The node rail without a container (B20): the fleet mints a node on its first heartbeat, refuses malformed ones, flags a plant from another engine tree, goes offline on silence and refuses to hand out a dead link; a node double on loopback (a worker thread speaking the rail exactly as the Python front does) is commanded under the swarm service secret — the wrong secret and a stale build are refused before the first request — and the simulation flies it through the same seam as the dialled plant, holding a phase until the node settles, cloning a session for the rehearsal; a node that is one body refuses to be cloned, the rehearsal runs on the kinematic twin, and a drone-first exploration runs to done over the rail through every unchanged guard.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | A node belongs to one owner: seen and handed out only to that owner, refused from another, unowned visible to all.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { E, runUntilSettled } = require('./helpers');
const { startFakeNode } = require('./fake-node');

const T0 = 1_000_000;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const mjcfFor = (probe) => E.droneMjcf('recon-mini', probe.sensingSolids(), probe.scene.droneHome);

test('the fleet mints a node on its first heartbeat, refuses malformed ones, and goes offline on silence', () => {
  const fleet = new E.DroneNodeFleet();
  const hb = { nodeId: 'plant-a', kind: 'plant', endpointUrl: 'http://127.0.0.1:7414/', protocol: 1, engine: 'mujoco', version: '3.3.5', buildHash: 'abc', sessions: 1, telemetry: { x: 1 }, events: [{ seq: 1, at: 't', kind: 'load', text: 's' }, { seq: 2, at: 't', kind: 'contact', text: 'island' }] };
  assert.deepEqual(fleet.ingest(hb, T0), { nodeId: 'plant-a', ack: 2 });
  assert.equal(fleet.ingest({ ...hb, events: [{ seq: 2, at: 't', kind: 'contact', text: 'island' }, { seq: 3, at: 't', kind: 'drop', text: 's' }] }, T0 + 1000).ack, 3, 'events merge by seq; the ack is the highest held');
  const [row] = fleet.list(T0 + 1000, 'abc');
  assert.equal(row.online, true); assert.equal(row.stale, false); assert.equal(row.endpointUrl, 'http://127.0.0.1:7414'); assert.equal(row.events.length, 3); assert.equal(row.sessions, 1);
  assert.equal(fleet.list(T0 + 1000, 'other')[0].stale, true, 'a plant node from another engine tree is flagged');
  for (const bad of [{ ...hb, nodeId: '../x' }, { ...hb, endpointUrl: 'ftp://x' }, { ...hb, kind: 'toaster' }, { ...hb, protocol: '1' }, { ...hb, telemetry: 'x' }, { ...hb, events: [{ seq: -1 }] }, {}, null]) {
    assert.throws(() => fleet.ingest(bad, T0), E.NodeValidationError);
  }
  assert.ok(fleet.isOnline('plant-a', T0 + 1000 + E.HEARTBEAT_STALE_MS - 1));
  assert.equal(fleet.isOnline('plant-a', T0 + 1000 + E.HEARTBEAT_STALE_MS), false);
  assert.throws(() => fleet.get('plant-a', T0 + 60000), (e) => e instanceof E.NodeOffline && e.known && e.lastSeenMs === T0 + 1000 && /offline/.test(e.message));
  assert.throws(() => fleet.get('nobody', T0), (e) => e instanceof E.NodeOffline && !e.known && /unknown node/.test(e.message));
  fleet.ingest({ ...hb, kind: 'drone', nodeId: 'body-1', events: [] }, T0);
  assert.equal(fleet.list(T0, 'zzz').find((n) => n.nodeId === 'body-1').stale, null, 'a real body is not held to the plant\'s engine tree');
  // A node belongs to one owner: seen and handed out only to that owner; the machine view sees everything.
  fleet.ingest({ ...hb, nodeId: 'owned-1', events: [] }, T0, 'dave');
  assert.ok(fleet.list(T0, null, 'dave').some((n) => n.nodeId === 'owned-1'));
  assert.equal(fleet.list(T0, null, 'erin').some((n) => n.nodeId === 'owned-1'), false, 'another owner does not see it');
  assert.ok(fleet.list(T0, null).some((n) => n.nodeId === 'owned-1'), 'the machine view sees everything');
  assert.throws(() => fleet.get('owned-1', T0, 'erin'), (e) => e instanceof E.NodeOffline && !e.known, 'unknown to another owner');
  assert.equal(fleet.get('owned-1', T0, 'dave').ownerSub, 'dave');
  assert.throws(() => fleet.ingest({ ...hb, nodeId: 'owned-1', events: [] }, T0, 'erin'), /another owner/);
  assert.equal(fleet.get('plant-a', T0 + 1000, 'erin').ownerSub, null, 'an unowned node is visible to all');
  fleet.ingest({ ...hb, events: [] }, T0 + 1000, 'dave');
  assert.equal(fleet.get('plant-a', T0 + 1000, 'dave').ownerSub, 'dave', 'the first owner to claim an unowned node keeps it');
  assert.throws(() => fleet.get('plant-a', T0 + 1000, 'erin'), /unknown node/);
  assert.ok(fleet.forget('body-1')); assert.equal(fleet.forget('body-1'), false);
  const small = new E.DroneNodeFleet({ maxNodes: 1 });
  small.ingest(hb, T0);
  assert.throws(() => small.ingest({ ...hb, nodeId: 'plant-b' }, T0), /limit/);
});

test('a node on the rail flies the sim: commands over its endpoint under the secret, the sim holds a phase until it settles', async () => {
  const node = await startFakeNode({ nodeId: 'plant-a', secret: 's3cret' });
  try {
    const fleet = new E.DroneNodeFleet();
    fleet.ingest(node.heartbeat(), T0);
    const probe = new E.WorldSim({ sensorSet: E.RECON_MINI });
    const mjcf = mjcfFor(probe);
    assert.throws(() => E.RailDroneNode.load(fleet.get('plant-a', T0), mjcf, 1, { kind: 'pid' }, { secret: '', expectedBuildHash: null }), (e) => e instanceof E.EngineFailure && e.code === 'capability_unavailable' && /SWARM_SERVICE_SECRET/.test(e.reason));
    assert.throws(() => E.RailDroneNode.load(fleet.get('plant-a', T0), mjcf, 1, { kind: 'pid' }, { secret: 'wrong', expectedBuildHash: null }), (e) => e instanceof E.EngineFailure && e.code === 'capability_unavailable' && /service secret/.test(e.reason));
    assert.throws(() => E.RailDroneNode.load(fleet.get('plant-a', T0), mjcf, 1, { kind: 'pid' }, { secret: 's3cret', expectedBuildHash: 'other-tree' }), (e) => e instanceof E.EngineFailure && e.code === 'protocol_mismatch');
    const rail = E.RailDroneNode.load(fleet.get('plant-a', T0), mjcf, 1, { kind: 'pid' }, { secret: 's3cret', expectedBuildHash: 'fake-build' });
    assert.equal(rail.link, 'rail'); assert.equal(rail.nodeId, 'plant-a'); assert.equal(rail.endpoint, node.endpointUrl); assert.equal(rail.kind, 'plant');
    assert.equal(rail.engine, 'fake'); assert.equal(rail.version, '0'); assert.equal(rail.seed, 1); assert.equal(rail.controller, 'pid');
    assert.ok(E.isDroneNode(rail));
    const sim = new E.WorldSim({ sensorSet: E.RECON_MINI, plant: rail });
    sim.scanDrone();
    assert.equal(sim.localization.status, 'anchored');
    near(sim.truth.z, 0.03, 1e-9, 'the node\'s rest height is the truth');
    sim.droneTakeoff();
    const cruise = sim.droneLimits.cruiseAlt;
    sim.advance((cruise / sim.droneLimits.climbSpeed) * 1000 + 100);
    assert.equal(sim.drone.mode, 'takeoff', 'held until the node reports settled');
    sim.advance(3000);
    assert.equal(sim.drone.mode, 'hover');
    near(sim.truth.z, cruise, 0.05);
    const snap = sim.snapshot().drone;
    assert.equal(snap.backend, 'node');
    assert.deepEqual(snap.node, { nodeId: 'plant-a', link: 'rail', endpoint: node.endpointUrl });
    assert.deepEqual(snap.plant, { engine: 'fake', version: '0', seed: 1, controller: 'pid' });
    const copy = sim.clone();
    assert.ok(E.isDroneNode(copy.plant) && copy.plant.link === 'rail' && copy.plant.nodeId === 'plant-a', 'the rehearsal clone is a session on the same node');
    assert.equal((await node.stats()).sessions, 2);
    copy.plant.drop();
    rail.drop();
    assert.equal((await node.stats()).sessions, 0, 'both sessions dropped on the node');
    assert.throws(() => rail.step({ x: 0, y: 0, z: 0, yaw: 0 }, 'hover', 0.05), /closed/);
  } finally { await node.close(); }
});

test('a node that is one body refuses to be cloned: the rehearsal runs on the kinematic twin, the flight runs on the node', async () => {
  const node = await startFakeNode({ nodeId: 'body-1', secret: 's3cret', refuseClone: true });
  try {
    const fleet = new E.DroneNodeFleet();
    fleet.ingest(node.heartbeat(), T0);
    const probe = new E.WorldSim({ sensorSet: E.RECON_MINI });
    const rail = E.RailDroneNode.load(fleet.get('body-1', T0), mjcfFor(probe), 2, { kind: 'pid' }, { secret: 's3cret', expectedBuildHash: null });
    const sim = new E.WorldSim({ sensorSet: E.RECON_MINI, plant: rail });
    assert.equal(rail.clone(), null);
    const copy = sim.clone();
    assert.equal(copy.plant, null, 'the copy is the kinematic twin');
    assert.deepEqual(copy.truth, sim.truth);
    const plan = E.planExplore(sim, 3, { droneFirst: true });
    const v = E.validatePlan(sim, plan);
    assert.ok(v.ok, v.issues.join('; '));
    assert.equal((await node.stats()).sessions, 1, 'the rehearsal did not touch the node');
    const control = new E.ControlAuthority(sim, () => {});
    control.execute(plan, 'rail');
    assert.equal(runUntilSettled(control, sim, 900), 'done', control.executor.failure ?? '');
    assert.ok(sim.world.stats().knownFraction > 0.2);
    assert.equal(sim.drone.mode, 'landed');
    assert.equal(sim.localization.status, 'anchored', 'home again on the pad');
    assert.ok((await node.stats()).commands > 400, 'the exploration flew over the rail (one envelope per 50 ms step)');
    rail.drop();
  } finally { await node.close(); }
});
