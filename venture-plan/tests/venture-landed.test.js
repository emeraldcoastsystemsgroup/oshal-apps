/**
 * Guards for the landed-cost stack.
 *
 * The three things that go wrong in a landed-cost spreadsheet, each guarded here:
 * freight treated as a per-unit rate when it is a step function of container
 * count; a seller-paid leg added on top of a price that already contains it; and
 * a merchandise-processing fee applied as a flat rate when it has a per-entry
 * floor and ceiling that bind at both ends of a real volume range.
 *
 * The ex-works inversion is checked by round-trip against the forward function,
 * including the case where an MPF cap boundary makes the relation only piecewise
 * affine and the closed form has to give way to bisection.
 *
 * Dependency-free `node --test` suite over the COMPILED module.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial guards — the hand-derived FOB stack at 1,000 units, freight steps at the container boundary, LCL with the minimum chargeable volume binding, incoterm responsibility with seller-paid legs excluded and reported, MPF floor and ceiling, the FOB/CIF customs-value difference, and the ex-works inversion round trip.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { engine, D, landedShape } = require('./fixture-venture');

const L = engine('venture-landed');

const shipment = (over) => Object.assign(landedShape(), { units: 1000, exWorksUnitMicros: 4_020_400 }, over || {});
const legOf = (r, key) => r.legs.find((l) => l.key === key);

test('the worked FOB shipment lands at hand-derived values', () => {
  const r = L.computeLandedCost(shipment());

  // ── Freight is a STEP: 1,000 units at 400 per container = 3 containers x $3,000.
  assert.equal(r.mode, 'fcl');
  assert.equal(r.containers, 3);
  assert.equal(legOf(r, 'oceanFreight').totalMicros, D(9000));

  // ── FOB: the seller pays origin inland and export clearance, so they are
  //    excluded from BUYER landed cost and reported rather than added on top.
  assert.equal(legOf(r, 'originInland').totalMicros, 0);
  assert.equal(legOf(r, 'exportClearance').totalMicros, 0);
  assert.deepEqual(r.sellerPaidLegs, ['originInland', 'exportClearance']);

  // ── Goods: 1,000 x 4,020,400 micros = 4,020,400,000.
  assert.equal(legOf(r, 'exWorks').totalMicros, 4_020_400_000);

  // ── Insurance: 50 bps of (goods + freight) = 13,020,400,000 x 0.005
  //    = 65,102,000, which is above the $50.00 minimum premium.
  assert.equal(legOf(r, 'marineInsurance').totalMicros, 65_102_000);

  // ── Customs value on an FOB basis is the goods alone here, because the two
  //    origin legs are inside the seller's price.
  assert.equal(r.customsValueMicros, 4_020_400_000);

  // ── Duty 320 bps  = 4,020,400,000 x 0.0320 = 128,652,800
  //    Tariff 750 bps = 4,020,400,000 x 0.0750 = 301,530,000
  //    HMF 125 bps    = 4,020,400,000 x 0.0125 =  50,255,000
  assert.equal(legOf(r, 'duty').totalMicros, 128_652_800);
  assert.equal(legOf(r, 'additionalTariff').totalMicros, 301_530_000);
  assert.equal(legOf(r, 'hmf').totalMicros, 50_255_000);

  // ── MPF at 35 bps would be 14,071,400, which is BELOW the $32.71 per-entry
  //    floor, so the floor binds. Applying the bare rate would understate it.
  assert.equal(legOf(r, 'mpf').totalMicros, D(32.71));

  // ── Fixed charges: 1 import entry at $175, 3 drayage moves at $450,
  //    1,000 receipts at $0.75.
  assert.equal(legOf(r, 'importClearance').totalMicros, D(175));
  assert.equal(legOf(r, 'drayage').totalMicros, D(1350));
  assert.equal(legOf(r, 'warehouseIn').totalMicros, D(750));

  // ── Buyer total, added by hand:
  //      4,020,400,000 + 9,000,000,000 +    65,102,000 + 128,652,800
  //    +   301,530,000 +    32,710,000 +    50,255,000 + 175,000,000
  //    + 1,350,000,000 +   750,000,000 = 15,873,649,800
  assert.equal(r.buyerTotalMicros, 15_873_649_800);
  // Per unit: 15,873,649,800 / 1,000 = 15,873,649.8 -> half-up -> 15,873,650
  assert.equal(r.buyerUnitMicros, 15_873_650);

  // ── Effective duty-like rate: (128,652,800 + 301,530,000 + 32,710,000
  //    + 50,255,000) = 513,147,800 over a 4,020,400,000 customs value = 1,276 bps.
  assert.equal(r.effectiveDutyBps, 1276);
});

test('freight steps at the container boundary — one unit more buys a whole container', () => {
  assert.equal(L.computeLandedCost(shipment({ units: 400 })).containers, 1);
  assert.equal(L.computeLandedCost(shipment({ units: 401 })).containers, 2);
  const at400 = legOf(L.computeLandedCost(shipment({ units: 400 })), 'oceanFreight').perUnitMicros;
  const at401 = legOf(L.computeLandedCost(shipment({ units: 401 })), 'oceanFreight').perUnitMicros;
  // $3,000/400 = $7.50 per unit; $6,000/401 = $14.96 per unit. That jump is why
  // break-even downstream searches over rebuilt models instead of dividing.
  assert.equal(at400, D(7.5));
  assert.ok(at401 > at400 * 1.9);
});

test('a container under 70% full is surfaced — freight per unit is carrying empty space', () => {
  const r = L.computeLandedCost(shipment({ units: 410 })); // 410 of 800 slots
  assert.ok(r.issues.some((i) => i.code === 'partial-container'));
  assert.ok(r.containerFillRatio < 0.7);
});

test('LCL takes over below the threshold, and the minimum chargeable volume binds', () => {
  // 30 units at 0.05 CBM = 1.5 CBM actual, below the 2 CBM carrier minimum.
  const r = L.computeLandedCost(shipment({ units: 30 }));
  assert.equal(r.mode, 'lcl');
  assert.equal(legOf(r, 'oceanFreight').totalMicros, D(160)); // 2 CBM x $80, not 1.5 x $80
  assert.ok(r.issues.some((i) => i.code === 'lcl-minimum-chargeable'));
  // Above the minimum the actual volume is charged: 60 units x 0.05 = 3 CBM.
  const bigger = L.computeLandedCost(shipment({ units: 60 }));
  assert.equal(legOf(bigger, 'oceanFreight').totalMicros, D(240));
});

test('incoterm decides who pays: EXW charges every leg, DDP charges almost none', () => {
  const exw = L.computeLandedCost(shipment({ incoterm: 'EXW' }));
  const ddp = L.computeLandedCost(shipment({ incoterm: 'DDP' }));
  assert.equal(exw.sellerPaidLegs.length, 0);
  assert.equal(legOf(exw, 'originInland').totalMicros, D(600)); // 3 containers x $200
  assert.equal(legOf(exw, 'exportClearance').totalMicros, D(150));
  // Under DDP the seller carries freight and duty, so they leave BUYER landed
  // cost entirely — but they are reported, because they are inside the price.
  assert.equal(legOf(ddp, 'duty').totalMicros, 0);
  assert.equal(legOf(ddp, 'oceanFreight').totalMicros, 0);
  assert.ok(ddp.sellerPaidLegs.includes('duty'));
  assert.ok(ddp.issues.some((i) => i.code === 'seller-paid-leg'));
  assert.ok(exw.buyerTotalMicros > ddp.buyerTotalMicros);
});

test('CIF assesses duty on a larger customs value than FOB, and says so', () => {
  const fob = L.computeLandedCost(shipment());
  const cif = L.computeLandedCost(shipment({
    duty: { ...landedShape().duty, customsValueBasis: 'cif' },
  }));
  // CIF adds the buyer-paid freight and insurance to the dutiable value.
  assert.equal(cif.customsValueMicros, fob.customsValueMicros + D(9000) + 65_102_000);
  assert.ok(cif.buyerTotalMicros > fob.buyerTotalMicros);
  assert.ok(cif.issues.some((i) => i.code === 'customs-basis-assumed'));
});

test('the MPF ceiling binds at high volume, the floor at low volume', () => {
  // At 1,000 units the 35 bps rate is under the floor (guarded above). At a
  // customs value large enough, the same rate exceeds the $634.62 ceiling.
  const big = L.computeLandedCost(shipment({ units: 100000 }));
  assert.equal(legOf(big, 'mpf').totalMicros, D(634.62));
  assert.match(legOf(big, 'mpf').basis, /ceiling/);
  assert.match(legOf(L.computeLandedCost(shipment()), 'mpf').basis, /floor/);
});

test('zero units yields a NULL per-unit landed cost, never a division by zero', () => {
  const r = L.computeLandedCost(shipment({ units: 0 }));
  assert.equal(r.buyerUnitMicros, null);
  assert.equal(r.containers, 0);
  assert.ok(r.issues.some((i) => i.code === 'zero-volume'));
});

test('maxExWorksForLanded round-trips against the forward function', () => {
  const base = landedShape();
  for (const target of [D(12), D(15.87365), D(30), D(120)]) {
    const inv = L.maxExWorksForLanded(target, { ...base, units: 1000 });
    const at = L.computeLandedCost({ ...base, units: 1000, exWorksUnitMicros: inv.exWorksUnitMicros });
    const over = L.computeLandedCost({ ...base, units: 1000, exWorksUnitMicros: inv.exWorksUnitMicros + 1 });
    // The answer is the LARGEST factory price that still lands at or under target.
    assert.ok(at.buyerTotalMicros <= target * 1000, `at target ${target}`);
    assert.ok(over.buyerTotalMicros > target * 1000, `one micro more exceeds ${target}`);
    assert.ok(['closed-form', 'bisection'].includes(inv.method));
  }
});

test('an unreachable target BLOCKS instead of returning a negative factory price', () => {
  // Freight, duty and handling alone already exceed $2.00 per unit at 1,000 units.
  const inv = L.maxExWorksForLanded(D(2), { ...landedShape(), units: 1000 });
  assert.equal(inv.exWorksUnitMicros, 0);
  assert.ok(inv.issues.some((i) => i.code === 'inversion-impossible' && i.severity === 'block'));
});

test('logisticsUnitMicros reports the cost to get it here, separate from the goods', () => {
  const r = L.computeLandedCost(shipment());
  // 15,873,649,800 total less 4,020,400,000 of goods = 11,853,249,800 over 1,000
  // units = 11,853,249.8 -> 11,853,250.
  assert.equal(L.logisticsUnitMicros(r), 11_853_250);
});
