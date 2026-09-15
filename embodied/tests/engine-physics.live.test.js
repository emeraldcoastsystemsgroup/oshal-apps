/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | B19 on the real plant: a residual report the container wrote is certified by this world's guards and its policy then flies a hover and a leg through the same drone.goto guards (exercised when the bridge's report directory holds one).
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The real plant: against a running engine bridge (EMBODIED_ENGINE_ADDR, e.g. 127.0.0.1:7413 with `python engine/container/embodied_engine_bridge.py` in a venv, or the container) the synchronous client verifies the hello, loads the generated MJCF, and the simulation on the MuJoCo plant anchors on the pad, climbs, holds the phase until the controller settles, registers a sweep at altitude against the map with the true pose within centimetres of the belief, runs a drone-first exploration to done through every unchanged guard with the drone back on the pad, and rehearses on a cloned session. Without the address it does not run and says so.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { E, runUntilSettled } = require('./helpers');

const ADDR = process.env.EMBODIED_ENGINE_ADDR;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('the MuJoCo plant behind the bridge flies the kinematic sim\'s drone', { skip: ADDR ? false : 'EMBODIED_ENGINE_ADDR not set — the live physics suite needs a running engine bridge' }, () => {
  const bridge = new E.SyncBridge({ ...E.parseEngineAddr(ADDR), timeoutMs: 30000 });
  const hello = bridge.hello();
  assert.equal(hello.engine, 'mujoco'); assert.equal(hello.protocol, E.BRIDGE_PROTOCOL);
  const probe = new E.WorldSim({ sensorSet: E.RECON_MINI });
  const plant = E.RemotePlant.load(bridge, E.droneMjcf('recon-mini', probe.sensingSolids(), probe.scene.droneHome), 5);
  near(plant.loaded.massKg, 0.746, 1e-6); near(plant.loaded.restZ, 0.03, 1e-6);
  const sim = new E.WorldSim({ sensorSet: E.RECON_MINI, plant });
  sim.scanDrone();
  assert.equal(sim.localization.status, 'anchored');
  near(sim.truth.z, 0.03, 0.002, 'resting on the pad plate');
  sim.droneTakeoff();
  const cruise = sim.droneLimits.cruiseAlt;
  sim.advance((cruise / sim.droneLimits.climbSpeed) * 1000 + 100);
  assert.equal(sim.drone.mode, 'takeoff', 'held until the controller settles');
  sim.advance(4000);
  assert.equal(sim.drone.mode, 'hover');
  near(sim.truth.z, cruise, 0.05, 'the plant holds the mission altitude');
  sim.scanDrone();
  assert.ok(['tracking', 'dead-reckoned'].includes(sim.localization.status), sim.localization.status);
  assert.ok(sim.localizationError().positionM < 0.08, `belief within 8 cm of the plant's truth, got ${sim.localizationError().positionM}`);
  sim.droneLand(); sim.advance(12000);
  assert.equal(sim.drone.mode, 'landed'); assert.equal(sim.localization.status, 'anchored');
  const plan = E.planExplore(sim, 4, { droneFirst: true });
  const v = E.validatePlan(sim, plan);
  assert.ok(v.ok, v.issues.join('; '));
  const control = new E.ControlAuthority(sim, () => {});
  control.execute(plan, 'physics');
  assert.equal(runUntilSettled(control, sim, 1200), 'done', control.executor.failure ?? '');
  assert.ok(sim.world.stats().knownFraction > 0.2);
  assert.equal(sim.drone.mode, 'landed'); assert.equal(sim.droneDown, null);
  // B19 on the real plant: a report the container wrote, its recorded flight certified by THIS world's guards, then the
  // certified policy flying the plant through the same drone.goto guards. Needs the bridge started with EMBODIED_REPORT_DIR
  // pointing at a directory holding a residual report and its policy zip (train_hover.py --residual writes both).
  const listing = bridge.call('reports');
  const entry = listing.reports.find((r) => r.report && r.report.mode === 'residual' && r.report.policyFile && listing.policies.includes(r.report.policyFile));
  if (!entry) { console.log(`no residual report + policy in ${listing.dir} — the certified-policy flight was not exercised`); plant.drop(); bridge.close(); return; }
  // A single-plane map certifies nothing off its scan plane: the recorded flight dips a few centimetres under the mission
  // altitude, into voxel layers the ring never carved. The gate refuses that honestly; so the drone scans those layers
  // first (a manual pass one layer down along the leg), exactly what the tile tells a person to do.
  const blind = E.certifyFlight(sim, entry.report.policy.trajectory);
  assert.equal(blind.ok, false, 'straight after the exploration the gate refuses: the path leaves the scan plane');
  assert.match(blind.refused[0].reason, /unknown/);
  const low = sim.world.map.voxelCentreZ(cruise - 0.05);
  sim.droneTakeoff(); sim.advance((cruise / sim.droneLimits.climbSpeed) * 1000 + 4000); sim.scanDrone();
  for (const x of [0.6, 1.3, 2.0]) { sim.droneGoto([x, 0.6, low]); sim.advance(5000); sim.scanDrone(); }
  sim.droneLand(); sim.advance(12000);
  const verdict = E.certifyFlight(sim, entry.report.policy.trajectory);
  assert.ok(verdict.ok, `once the layers under the plane are scanned the recorded flight passes: ${JSON.stringify(verdict.refused[0] ?? null)} (${verdict.refusedCount} refused)`);
  plant.drop();
  const flown = E.RemotePlant.load(bridge, E.droneMjcf('recon-mini', probe.sensingSolids(), probe.scene.droneHome), 5, { kind: 'policy', file: entry.report.policyFile, residual: true });
  assert.equal(flown.controller, `policy:${entry.report.policyFile}`);
  const sim2 = new E.WorldSim({ sensorSet: E.RECON_MINI, plant: flown });
  sim2.world = sim.world.clone();
  sim2.scanDrone(); sim2.droneTakeoff(); sim2.advance((cruise / sim2.droneLimits.climbSpeed) * 1000 + 100); sim2.advance(4000);
  assert.equal(sim2.drone.mode, 'hover', 'the policy-flown plant settled after the climb');
  sim2.scanDrone();
  const leg = [sim2.drone.x + 1.4, sim2.drone.y, cruise];
  sim2.droneGoto(leg); sim2.advance(6000);
  assert.equal(sim2.drone.mode, 'hover'); assert.equal(sim2.droneDown, null, 'no strike on the leg');
  assert.ok(Math.hypot(sim2.truth.x - leg[0], sim2.truth.y - leg[1], sim2.truth.z - leg[2]) < 0.15, `the policy flew the leg to within 15 cm (${sim2.localizationError().positionM.toFixed(3)} m belief error)`);
  console.log(`certified policy ${entry.report.policyFile} flew the leg: truth (${sim2.truth.x.toFixed(2)}, ${sim2.truth.y.toFixed(2)}, ${sim2.truth.z.toFixed(2)})`);
  flown.drop(); bridge.close();
});
