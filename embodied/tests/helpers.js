/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Shared test helpers: an explored world (the explore plan run to
 *                     |                             | completion, so guards that block unknown space let the scripted
 *                     |                             | suites drive and reach), and a runner that ticks a control
 *                     |                             | authority until its executor leaves `running`. Not a test file:
 *                     |                             | the store-ci glob is engine-*.test.js.
 */
'use strict';
const path = require('node:path');

const E = require(path.join(__dirname, '..', 'routes', 'engine', 'index.js'));

/** Run the control authority until the executor leaves `running`, bounded in simulated time. */
function runUntilSettled(control, sim, limitS = 1500) {
  const start = sim.timeMs;
  while (control.executor.state === 'running' && (sim.timeMs - start) / 1000 < limitS) { control.tick(); if (control.executor.state !== 'running') break; sim.advance(200); }
  control.tick();
  return control.executor.state;
}

/** A fresh world whose room has been explored (base LiDAR + drone frontier exploration). */
function explored(maxScans = 12) {
  const sim = new E.WorldSim();
  const control = new E.ControlAuthority(sim, () => {});
  control.execute(E.planExplore(sim, maxScans), 'explorer');
  const end = runUntilSettled(control, sim, 900);
  if (end !== 'done') throw new Error(`exploration did not finish: ${end} ${control.executor.failure ?? ''}`);
  return sim;
}

/** The discovered surface nearest a height, largest first. */
function surfaceAtHeight(sim, z, tol = 0.03) {
  return sim.world.surfaces.filter((s) => Math.abs(s.z - z) <= tol).sort((a, b) => b.areaM2 - a.areaM2)[0] ?? null;
}

module.exports = { E, runUntilSettled, explored, surfaceAtHeight };
