/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | An ArmPlant double for the B22 seam tests: a first-order lag toward the commanded joint angles with a deliberate steady-state DROOP (a position servo stands off its command by its load over its gain), a torque per joint, a contact a test can force and a clone that starts where the live arm stands. It proves the simulation's arm-plant path -- measured angles are what the guards read, arrival is the plant's, a rehearsal clones the arm. The real MuJoCo arm is proven by the room-model probe and the live suite.
 */
'use strict';

const TAU_S = 0.15;
/** A position servo settles SHORT of its command by its load over its gain: the double droops the way the real one does. */
const DROOP_RAD = 0.004;

class FakeArmPlant {
  constructor(opts = {}) {
    this.engine = 'fake-arm'; this.version = '0'; this.seed = opts.seed ?? 0; this.backend = opts.backend ?? 'physics';
    this.dh = opts.dh ?? [];
    this.q = (opts.q ?? [0, 0, 0, 0, 0, 0]).slice();
    this.steps = 0; this.clones = 0; this.dropped = false; this.forced = null; this.grip = 0.05;
    this.droop = opts.droop ?? DROOP_RAD;
    this.commands = [];
  }
  forceContact(name) { this.forced = name; }
  step(qTarget, grip, dt) {
    this.steps += 1;
    this.commands.push(qTarget.slice());
    const k = Math.min(1, dt / TAU_S);
    this.q = this.q.map((v, i) => v + ((qTarget[i] ?? v) - this.droop - v) * k);
    this.grip = grip;
    const error = Math.max(...this.q.map((v, i) => Math.abs((qTarget[i] ?? v) - v)));
    const contact = this.forced; this.forced = null;
    const torqueNm = this.q.map((_v, i) => Number((0.4 + 0.1 * i).toFixed(4)));
    return { q: this.q.slice(), torqueNm, grip, contact, settled: error < 0.01 };
  }
  clone() { this.clones += 1; return new FakeArmPlant({ seed: this.seed, q: this.q, droop: this.droop, backend: this.backend, dh: this.dh }); }
  drop() { this.dropped = true; }
}

/** An arm that is one real body: it cannot be copied, so a rehearsal falls back to the kinematic twin. */
class SingleBodyArmPlant extends FakeArmPlant {
  clone() { this.clones += 1; return null; }
}

module.exports = { FakeArmPlant, SingleBodyArmPlant, DROOP_RAD };
