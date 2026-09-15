/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the gear-to-CAD-Studio hand-off under plain node:
 *                     |                             | the involute outline is a closed polygon with one tip arc per
 *                     |                             | tooth, every point between the root and tip radii,
 *                     |                             | the pitch-circle tooth thickness within a few percent of
 *                     |                             | half the circular pitch; the CAD Studio body VALIDATES
 *                     |                             | against CAD Studio's own contract (read-only cross-package
 *                     |                             | import of cad-studio/routes/feature-contract.js); too many
 *                     |                             | teeth, a bore into the rim and a non-gear are refused.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const g = require(path.resolve(__dirname, '..', 'routes', 'gear-profile.js'));
const c = require(path.resolve(__dirname, '..', 'routes', 'circuit-contract.js'));
const CAD_CONTRACT = path.resolve(__dirname, '..', '..', 'cad-studio', 'routes', 'feature-contract.js');

const gear = (props) => c.validatePart({ id: 'G1', type: 'gear', props }, 'part');

test('the outline is a closed polygon with one tooth per tooth count, bounded by the root and tip radii', () => {
  for (const [teeth, moduleMm] of [[12, 1], [20, 1.5], [60, 1], [120, 0.5]]) {
    const pts = g.involuteOutline({ teeth, moduleMm, pressureAngleDeg: 20, faceWidthMm: 8, boreMm: 3 });
    const rp = (moduleMm * teeth) / 2, ra = rp + moduleMm, rf = rp - 1.25 * moduleMm;
    assert.ok(pts.length <= g.CAD_SKETCH_MAX_POINTS, `${teeth} teeth → ${pts.length} points`);
    let tips = 0;
    for (const [x, y] of pts) { const r = Math.hypot(x, y); assert.ok(r >= rf - 1e-3 && r <= ra + 1e-3, `r=${r}`); if (r > ra - 1e-3) tips += 1; }
    assert.equal(tips, 2 * teeth, 'two tip points per tooth (the tip arc)');
    // angles increase monotonically around the circle (no self-intersection from ordering)
    // (points are rounded to 4 decimals, so a flank point can sit a few 1e-5 rad behind its neighbour)
    let prev = Math.atan2(pts[0][1], pts[0][0]), turns = 0;
    for (const [x, y] of pts.slice(1)) { let a = Math.atan2(y, x); while (a < prev - 1e-3) a += 2 * Math.PI; turns += a - prev; prev = a; }
    assert.ok(turns > 2 * Math.PI - Math.PI / teeth - 0.05 && turns < 2 * Math.PI + 0.05, `swept ${turns}`);
  }
});

test('the tooth thickness at the pitch circle is half the circular pitch', () => {
  const teeth = 20, moduleMm = 2;
  const pts = g.involuteOutline({ teeth, moduleMm, pressureAngleDeg: 20, faceWidthMm: 8, boreMm: 3 });
  const rp = (moduleMm * teeth) / 2;
  // the first tooth is centred on angle 0: find the flank crossings of the pitch circle nearest it
  const near = pts.filter(([x, y]) => Math.abs(Math.hypot(x, y) - rp) < 0.3 * moduleMm && Math.abs(Math.atan2(y, x)) < Math.PI / teeth);
  assert.ok(near.length >= 2);
  const angles = near.map(([x, y]) => Math.atan2(y, x));
  const thickness = (Math.max(...angles) - Math.min(...angles)) * rp;
  assert.ok(Math.abs(thickness - (Math.PI * moduleMm) / 2) < 0.12 * moduleMm, `thickness ${thickness} vs ${(Math.PI * moduleMm) / 2}`);
});

test('the CAD Studio body validates against CAD Studio\'s own contract', { skip: !fs.existsSync(CAD_CONTRACT) && 'cad-studio is not checked out beside this package' }, () => {
  const cad = require(CAD_CONTRACT);
  const made = g.cadStudioBody(gear({ teeth: 30, moduleMm: 1.5, faceWidthMm: 10, boreMm: 5 }), {}, { designId: 'd1' });
  assert.equal(made.ok, true);
  const base = cad.validateBase(made.body.base);
  assert.equal(base.kind, 'sketch'); assert.equal(base.plane, 'XY'); assert.equal(base.height, 10);
  const features = cad.validateFeatureList(made.body.features);
  assert.equal(features.length, 1); assert.equal(features[0].type, 'hole'); assert.equal(features[0].params.diameter, 5);
  assert.match(made.body.title, /gear 30t m1\.5/);
  assert.equal(made.body.source.kind, 'circuit-lab');
  assert.equal(made.outline.pitchRadiusMm, 22.5);
});

test('overrides apply; too many teeth, a bore into the rim and a non-gear are refused', () => {
  const ok = g.cadStudioBody(gear({ teeth: 20 }), { faceWidthMm: 6, boreMm: 0 }, {});
  assert.equal(ok.ok, true); assert.equal(ok.body.base.height, 6); assert.deepEqual(ok.body.features, []);
  assert.match(g.cadStudioBody(gear({ teeth: 200, moduleMm: 1 }), {}, {}).reason, /at most 120 teeth/);
  assert.match(g.cadStudioBody(gear({ teeth: 12, moduleMm: 1 }), { boreMm: 9 }, {}).reason, /rim/);
  assert.match(g.cadStudioBody(gear({ teeth: 12 }), { faceWidthMm: 0.5 }, {}).reason, /faceWidthMm/);
  assert.match(g.cadStudioBody(c.validatePart({ id: 'R1', type: 'resistor' }, 'part'), {}, {}).reason, /not a gear/);
});
