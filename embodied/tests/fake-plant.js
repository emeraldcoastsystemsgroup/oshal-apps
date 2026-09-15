/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | A PhysicsPlant double for the seam tests: a first-order lag toward the commanded setpoint with a deterministic sway, `settled` only once the truth is on the setpoint, a contact any test can force, and sensors cast by the package's own raycaster from the plant's truth in the compact frame shape the real bridge returns. It proves the simulation's plant path (hold until settled, strike from contact, sensing through framesToSweeps); the real container is proven by the live suite.
 */
'use strict';
const { E } = require('./helpers');

const TAU_S = 0.4;

class FakePlant {
  constructor(solids, home, opts = {}) {
    this.engine = 'fake'; this.version = '0'; this.seed = opts.seed ?? 0; this.controller = opts.controller ?? 'pid';
    this.solids = solids;
    this.truth = { x: home[0], y: home[1], z: home[2] + 0.03, yaw: 0 };
    this.t = 0; this.steps = 0; this.clones = 0; this.dropped = false; this.forced = null; this.sway = opts.sway ?? 0.02;
  }
  forceContact(name) { this.forced = name; }
  step(sp, phase, dt) {
    this.t += dt; this.steps += 1;
    const k = Math.min(1, dt / TAU_S);
    if (phase !== 'landed') {
      this.truth = { x: this.truth.x + (sp.x - this.truth.x) * k, y: this.truth.y + (sp.y - this.truth.y) * k, z: this.truth.z + (sp.z - this.truth.z) * k, yaw: this.truth.yaw + (sp.yaw - this.truth.yaw) * k };
    }
    const err = Math.hypot(sp.x - this.truth.x, sp.y - this.truth.y, phase === 'landing' ? Math.max(0, this.truth.z - sp.z - 0.03) : sp.z - this.truth.z);
    const contact = this.forced; this.forced = null;
    const pose = { x: this.truth.x + this.sway * Math.sin(this.t), y: this.truth.y + this.sway * Math.cos(this.t * 0.7), z: this.truth.z, yaw: this.truth.yaw };
    return { pose, tiltRad: 0.01, speed: err / TAU_S, contact, settled: phase === 'landed' || err < 0.02, motorsN: [1.8, 1.8, 1.8, 1.8] };
  }
  sense(spec) {
    const names = [...new Set(this.solids.map((s) => s.name))];
    const raw = (sweep) => {
      const f = { origin: sweep.origin, p: [], n: [], t: [], geom: [], misses: [] };
      for (const h of sweep.hits) { f.p.push(...h.point); f.n.push(...h.normal); f.t.push(h.t); f.geom.push(names.indexOf(h.name)); }
      for (const m of sweep.misses) f.misses.push(...m);
      return f;
    };
    const out = { names, truth: { ...this.truth, tiltRad: 0.01, speed: 0 } };
    const truth = this.truth;
    if (spec.ring) {
      const opts = { azimuthCount: spec.ring.azimuthCount, elevationsDeg: spec.ring.elevationsDeg, maxRange: spec.ring.maxRange, ...(spec.zenith ? { zenith: spec.zenith } : {}) };
      const ring = E.lidarSweep([truth.x, truth.y, truth.z], truth.yaw, this.solids, opts);
      out.ring = raw(ring);
    }
    if (spec.depth) {
      const d = spec.depth;
      const intr = { width: d.width, height: d.height, fx: d.fx, fy: d.fy, cx: d.cx, cy: d.cy };
      out.depth = raw(E.renderDepthPicture(intr, { position: [truth.x, truth.y, truth.z - 0.02], yaw: truth.yaw, pitch: d.pitch }, this.solids, d.maxRange, d.stride).sweep);
    }
    if (spec.nadir) out.nadir = raw(E.lidarSweep([truth.x, truth.y, truth.z - 0.02], truth.yaw, this.solids, { azimuthCount: 1, elevationsDeg: [-90], maxRange: spec.nadir.maxRange }));
    return out;
  }
  clone() { const c = new FakePlant(this.solids, [0, 0, 0], { seed: this.seed, sway: this.sway, controller: this.controller }); c.truth = { ...this.truth }; c.t = this.t; this.clones += 1; return c; }
  drop() { this.dropped = true; }
}

module.exports = { FakePlant };
