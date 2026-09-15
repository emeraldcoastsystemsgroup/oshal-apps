/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The drone designer against the COMPILED engine: momentum-theory
 *                     |                             | sizing reproduces the hardware design's rows, the mass budget
 *                     |                             | sums from the parts, every printed part's CAD program validates
 *                     |                             | against CAD Studio's own compiled contract (base and every
 *                     |                             | feature), the two fits differ where they should, the sim's
 *                     |                             | sensor poses and the parts model share the sensor set, and the
 *                     |                             | design document's tables are generated, not typed.
 *
 * Plain node: `node --test tests/engine-build.test.js`.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { E } = require('./helpers');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

test('momentum-theory sizing reproduces the design document rows', () => {
  const six = E.sizeHover({ propIn: 6, auwG: 750, cells: 4, mAh: 1500 });
  near(six.pElectricalW, 105, 1, '6 in / 750 g electrical power');
  near(six.hoverMin, 10.2, 0.1, '6 in / 750 g hover');
  assert.equal(six.thrustPerMotorHoverG, 187.5); assert.equal(six.thrustPerMotorTw2G, 375);
  const five = E.sizeHover({ propIn: 5, auwG: 750, cells: 4, mAh: 1500 });
  near(five.pElectricalW, 126, 1, '5 in / 750 g'); near(five.hoverMin, 8.5, 0.1, '5 in hover');
  near(E.tipSpeedMps(6, 9000), 72, 1, 'tip speed'); near(E.tipSpeedMps(5, 14000), 93, 1, 'tip speed');
  assert.ok(E.sizeHover({ propIn: 7, auwG: 750, cells: 4, mAh: 1500 }).hoverMin > six.hoverMin, 'a bigger disc hovers longer');
});

test('the printed drone: mass budget sums from the parts and the sizing is at that mass', () => {
  const d = E.buildDrone('recon-mini');
  assert.equal(d.sensorSet.id, 'recon-mini');
  near(d.massBudget.allUpG, 746, 8, 'all-up mass matches the design document');
  assert.equal(d.massBudget.allUpG, Math.round(d.massBudget.printedG + d.massBudget.boughtG + d.massBudget.batteryG));
  assert.equal(d.sizing.auwG, d.massBudget.allUpG, 'sized at the budget, not a typed number');
  assert.equal(d.sizing.propIn, 6); assert.equal(d.sizing.cells, 4);
  assert.ok(d.sizing.hoverMin > 9.5 && d.sizing.hoverMin < 11, `${d.sizing.hoverMin.toFixed(1)} min`);
  assert.ok(d.tipSpeedMps < 75, 'quiet enough for a room');
  assert.equal(d.layout.wheelbaseMm, 260); assert.ok(d.layout.propClearanceMm >= 30);
  assert.ok(d.approxUsd > 450 && d.approxUsd < 750, `about $${d.approxUsd} in bought parts (generated, approximate)`);
  assert.equal(d.parts.filter((p) => p.id !== 'pad').every((p) => p.massEachG > 0 && p.qty > 0), true);
});

test('the reserve fit carries the 3-D sensor on the same frame with bigger props and battery', () => {
  const d = E.buildDrone('recon-3d');
  assert.equal(d.sensorSet.id, 'recon-3d');
  assert.equal(d.sizing.propIn, 7); assert.equal(d.sizing.cells, 6);
  assert.ok(d.massBudget.allUpG > 1150 && d.massBudget.allUpG < 1450, `${d.massBudget.allUpG} g`);
  assert.ok(d.layout.wheelbaseMm > E.buildDrone('recon-mini').layout.wheelbaseMm);
  assert.ok(d.bought.some((b) => b.id === 'lidar3d') && !d.bought.some((b) => b.id === 'tof'));
  assert.equal(E.fitById('nonsense'), null); assert.equal(E.fitById('recon-3d'), 'recon-3d');
});

test('every printed part is a valid CAD Studio program: base and every feature pass its compiled contract', () => {
  const contractPath = path.join(__dirname, '..', '..', 'cad-studio', 'routes', 'feature-contract.js');
  assert.ok(fs.existsSync(contractPath), 'CAD Studio ships its contract compiled in the store checkout');
  const contract = require(contractPath);
  for (const fit of ['recon-mini', 'recon-3d']) {
    const d = E.buildDrone(fit);
    assert.ok(d.parts.length >= 8, 'eight parts');
    for (const p of d.parts) {
      assert.doesNotThrow(() => contract.validateBase(p.cad.base), `${fit} ${p.id} base`);
      const list = contract.validateFeatureList(p.cad.features);
      assert.equal(list.length, p.cad.features.length, `${fit} ${p.id} features all accepted`);
      assert.ok(p.cad.features.length <= contract.LIMITS.maxFeatures);
      for (const f of p.cad.features) assert.ok(contract.FEATURE_TYPES.includes(f.type), `${p.id} ${f.type}`);
    }
  }
  const plate = E.buildDrone('recon-mini').parts.find((p) => p.id === 'centre-plate');
  assert.equal(plate.cad.features.filter((f) => f.type === 'hole').length, 16, 'stack and arm holes');
});

test('the sim and the parts model share the sensor set: the mast the sim flies is the mast the printer makes', () => {
  for (const fit of ['recon-mini', 'recon-3d']) {
    const d = E.buildDrone(fit);
    const sim = new E.WorldSim({ sensorSet: d.sensorSet });
    assert.equal(sim.sensorSet.id, d.sensorSet.id);
    const mastPart = d.parts.find((p) => p.id === 'mast');
    assert.equal(mastPart.cad.base.height, d.layout.mastMm);
    if (d.sensorSet.mastM > 0) assert.equal(d.layout.mastMm, Math.round(d.sensorSet.mastM * 1000), 'mast height from the sensor set');
  }
});

test('the design document tables are generated, not typed', () => {
  const md = E.designMarkdown('recon-mini');
  assert.match(md, /## Propulsion sizing/); assert.match(md, /## Printed parts/); assert.match(md, /## Mass budget/); assert.match(md, /\*\*All-up\*\* \| \*\*7\d\d\*\*/);
  assert.match(md, /Centre plate/); assert.match(md, /LD19/);
  assert.ok(E.sizingTable().split('\n').length > 10);
});
