/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Joint registration (BACKLOG B10): consistent box and cylinder views register to exactly the extents the greedy propagation gave, with zero residual; the skewed three-view loop reports a residual on EVERY view, each carrying a third of the loop's 40 % misfit (no fit can tell which of three views in one loop is skewed); a fourth view closing a second loop makes the skewed photo carry the largest residual and moves blame off the views that agree (least squares averages, so the view sharing its axis pair still carries some; warnings are ordered worst first); three known dimensions stay exact and each view's misfit against them is reported; the fit is deterministic.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));

const rect = (uMm, vMm) => e.maskFromPredicate(200, 200, (x, y) => Math.abs(x - 100) < uMm && Math.abs(y - 100) < vMm);
const box = () => [
  { view: 'front', mask: rect(60, 30) },
  { view: 'top', mask: rect(60, 40) },
  { view: 'right', mask: rect(40, 30) },
];
/** The skewed fixture of engine-reconstruction: the right view's height reads 42 instead of 30. */
const skewed = () => [
  { view: 'front', mask: rect(60, 30) },
  { view: 'top', mask: rect(60, 40) },
  { view: 'right', mask: rect(40, 42) },
];
const byView = (reg) => Object.fromEntries(reg.residuals.map((r) => [r.view, r]));

test('B10: consistent views register to exactly the extents the greedy propagation gave, with zero residual', () => {
  for (const anchor of [{ axis: 'x', mm: 60 }, { axis: 'y', mm: 40 }, { axis: 'z', mm: 30 }]) {
    const reg = e.registerSilhouettes(box(), [anchor]);
    assert.deepEqual(reg.sizeMm, { x: 60, y: 40, z: 30 }, `anchored on ${anchor.axis}`);
    assert.equal(reg.sources[anchor.axis], 'known');
    assert.deepEqual(reg.views.map((v) => v.mmPerPx), [0.5, 0.5, 0.5]);
    assert.deepEqual(reg.residuals.map((r) => [r.u, r.v, r.disagreement]), [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    assert.deepEqual(reg.warnings, []);
  }
  const cylinder = e.registerSilhouettes([
    { view: 'front', mask: rect(40, 50) },
    { view: 'top', mask: e.maskFromPredicate(200, 200, (x, y) => Math.hypot(x - 100, y - 100) < 40) },
  ], [{ axis: 'z', mm: 50 }]);
  assert.deepEqual(cylinder.sizeMm, { x: 40, y: 40, z: 50 });
  assert.deepEqual(cylinder.sources, { x: 'derived', y: 'derived', z: 'known' });
  const recon = e.reconstructFromSilhouettes(box(), [{ axis: 'x', mm: 60 }], { resolution: 48, smoothIterations: 0 });
  assert.equal(recon.report.gridVolumeMm3, 72000, 'the carved box is unchanged to the voxel');
});

test('B10: the skewed three-view loop reports a residual on every view, each carrying a third of the loop misfit', () => {
  const reg = e.registerSilhouettes(skewed(), [{ axis: 'x', mm: 60 }]);
  const loop = (84 / 80) * (80 / 120) / (60 / 120); // z/y (right) x y/x (top) against z/x (front): 1.4
  const share = 1 - loop ** (-1 / 3);
  const r = byView(reg);
  for (const view of ['front', 'top', 'right']) {
    assert.ok(Math.abs(r[view].disagreement - share) < 1e-9, `${view}: ${r[view].disagreement} against ${share}`);
    assert.ok(reg.warnings.some((w) => w.startsWith(`${view} view:`) && /disagree with the joint fit of all views by 11%/.test(w)), reg.warnings.join(' | '));
  }
  assert.equal(reg.sources.x, 'known');
  assert.equal(reg.sizeMm.x, 60, 'the measured extent is held exactly');
  assert.ok(reg.sizeMm.z > 30 && reg.sizeMm.z < 42, `z is a compromise between the views that see it: ${reg.sizeMm.z}`);
});

test('B10: a fourth view closing a second loop makes the skewed photo carry the largest residual', () => {
  const three = byView(e.registerSilhouettes(skewed(), [{ axis: 'x', mm: 60 }]));
  const reg = e.registerSilhouettes([...skewed(), { view: 'left', mask: rect(40, 30) }], [{ axis: 'x', mm: 60 }]);
  const r = byView(reg);
  for (const view of ['front', 'top', 'left']) assert.ok(r.right.disagreement > r[view].disagreement, `right ${r.right.disagreement} must exceed ${view} ${r[view].disagreement}`);
  assert.ok(r.right.disagreement > three.right.disagreement, 'the second loop moves blame onto the skewed view');
  assert.ok(r.front.disagreement < three.front.disagreement && r.top.disagreement < three.top.disagreement, 'and off the views that agree');
  assert.ok(r.right.v > 0 && r.right.u < 0, 'the right outline is too tall along Z and short along Y against the fit');
  // Least squares averages: the left view measures the same Y/Z pair as the skewed right view, so it
  // carries part of that error (13 % here) rather than none. The largest residual names the photo;
  // it is not the only one.
  assert.ok(r.left.disagreement > r.front.disagreement);
  assert.deepEqual(reg.warnings.filter((w) => /disagree/.test(w)).map((w) => w.split(' ')[0]), ['right', 'left'], 'worst first, whatever order the views were supplied in');
  const reordered = e.registerSilhouettes([{ view: 'left', mask: rect(40, 30) }, ...skewed()], [{ axis: 'x', mm: 60 }]);
  assert.equal(reordered.warnings.filter((w) => /disagree/.test(w))[0].split(' ')[0], 'right');
});

test('B10: three known dimensions are held exactly and each view reports its misfit against them', () => {
  const views = [{ view: 'front', mask: rect(60, 30) }, { view: 'top', mask: rect(60, 40) }];
  const reg = e.registerSilhouettes(views, [{ axis: 'x', mm: 80 }, { axis: 'y', mm: 40 }, { axis: 'z', mm: 30 }]);
  assert.deepEqual(reg.sizeMm, { x: 80, y: 40, z: 30 });
  assert.deepEqual(reg.sources, { x: 'known', y: 'known', z: 'known' });
  const r = byView(reg);
  assert.ok(r.front.u < 0 && r.front.v > 0, 'the front outline is short along X and long along Z against 80 x 30');
  assert.ok(r.front.disagreement > 0.1 && r.top.disagreement > 0.1);
});

test('B10: the joint fit is deterministic', () => {
  assert.deepEqual(e.registerSilhouettes(skewed(), [{ axis: 'x', mm: 60 }]), e.registerSilhouettes(skewed(), [{ axis: 'x', mm: 60 }]));
});
