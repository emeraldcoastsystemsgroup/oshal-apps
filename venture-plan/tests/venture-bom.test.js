/**
 * Guards for the bill-of-materials roll-up.
 *
 * Four rules decide whether the unit cost is honest, and each has a guard here:
 * scrap DIVIDES (2% scrap means buying 1.0204, not 1.02); price bands are
 * SELECTED and never interpolated or extrapolated; a supplier minimum's overbuy
 * is a named cost rather than a silent inflation of unit cost; and tooling is
 * reported separately from the marginal cost it is not.
 *
 * Expected values are derived by hand beside each assertion.
 *
 * Dependency-free `node --test` suite over the COMPILED module.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial guards — hand-derived roll-up, scrap divides not multiplies, band selection at exact boundary quantities, below-lowest and above-quoted-ceiling both surfaced without extrapolation, MOQ overbuy costed, tooling by tool life, the sum-of-parts identity, cycle detection, and the zero-volume null.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { engine, D, bomTree, acme, fastco } = require('./fixture-venture');

const B = engine('venture-bom');

const ref = (id) => ({ minQty: 1, unitCostMicros: id, assumptionRef: 'x' });

test('scrap DIVIDES: 2% scrap means buying 1/(1-0.02) = 1.0204 per good unit, not 1.02', () => {
  const flat = B.flattenBom({
    id: 'p', name: 'p', qtyPerParent: 1, discrete: true, scrapRateRatio: 0.02,
    priceBreaks: [ref(1_000_000)], supplier: acme(),
  });
  // 1 / 0.98 = 1.020408163265306...
  assert.ok(Math.abs(flat[0].effectiveQtyPerUnit - 1.0204081632653061) < 1e-12);
  // The naive multiply would give 1.02 — a 0.04% understatement per level, compounding.
  assert.notEqual(flat[0].effectiveQtyPerUnit, 1.02);
});

test('scrap compounds down the tree', () => {
  // Parent 20% scrap (x1.25), child qty 4 with 20% scrap (x1.25):
  //   parent effective = 1 x 1 / 0.8 = 1.25
  //   child  effective = 1.25 x 4 / 0.8 = 6.25
  const flat = B.flattenBom({
    id: 'root', name: 'root', qtyPerParent: 1, discrete: true, scrapRateRatio: 0.2,
    priceBreaks: [ref(0)], supplier: acme(),
    children: [{
      id: 'kid', name: 'kid', qtyPerParent: 4, discrete: true, scrapRateRatio: 0.2,
      priceBreaks: [ref(1000)], supplier: acme(),
    }],
  });
  assert.equal(flat[0].effectiveQtyPerUnit, 1.25);
  assert.equal(flat[1].effectiveQtyPerUnit, 6.25);
});

test('a BOM cycle throws rather than looping — an infinite roll-up is not a number', () => {
  const node = { id: 'a', name: 'a', qtyPerParent: 1, discrete: true, scrapRateRatio: 0, priceBreaks: [ref(0)], supplier: acme() };
  node.children = [node];
  assert.throws(() => B.flattenBom(node), /BOM cycle/);
  const rollup = B.rollUpBom(node, 10);
  assert.equal(rollup.issues[0].code, 'bom-cycle');
  assert.equal(rollup.issues[0].severity, 'block');
  assert.equal(B.bomIsPublishable(rollup), false);
});

test('price bands are SELECTED at exact boundary quantities, never interpolated', () => {
  const breaks = [
    { minQty: 1, unitCostMicros: D(5), assumptionRef: 'a' },
    { minQty: 1000, unitCostMicros: D(4), assumptionRef: 'a' },
    { minQty: 5000, unitCostMicros: D(3.5), assumptionRef: 'a' },
  ];
  assert.equal(B.selectPriceBreak(breaks, 999).band.unitCostMicros, D(5));
  assert.equal(B.selectPriceBreak(breaks, 1000).band.unitCostMicros, D(4)); // exact boundary
  assert.equal(B.selectPriceBreak(breaks, 4999).band.unitCostMicros, D(4));
  assert.equal(B.selectPriceBreak(breaks, 5000).band.unitCostMicros, D(3.5));
  // 3000 sits between two quoted steps; the price is the LOWER step's price, not
  // an interpolation between them — vendors quote steps, and a line drawn between
  // two of them invents a price nobody offered.
  const mid = B.selectPriceBreak(breaks, 3000);
  assert.equal(mid.band.unitCostMicros, D(4));
  assert.equal(mid.position, 'in-band');
  // Caller order is irrelevant: the ladder is sorted internally.
  assert.equal(B.selectPriceBreak([...breaks].reverse(), 1000).band.unitCostMicros, D(4));
});

test('below the lowest quoted break is surfaced and priced at that break, not extrapolated upward', () => {
  const comp = {
    id: 'c', name: 'Small part', qtyPerParent: 1, discrete: true, scrapRateRatio: 0,
    priceBreaks: [{ minQty: 1000, unitCostMicros: D(4), assumptionRef: 'a' }],
    supplier: { ...acme(), moqUnits: 0 },
  };
  const r = B.rollUpBom(comp, 100);
  const line = r.lines[0];
  assert.equal(line.bandUnitCostMicros, D(4)); // the quoted price, exactly — no markup invented
  assert.equal(line.outsideQuotedBands, true);
  assert.ok(r.issues.some((i) => i.code === 'below-lowest-price-break' && i.severity === 'warn'));
});

test('above the quoted ceiling is surfaced and priced at the top band, not extrapolated downward', () => {
  const comp = {
    id: 'c', name: 'Big part', qtyPerParent: 1, discrete: true, scrapRateRatio: 0,
    priceBreaks: [{ minQty: 1000, maxQty: 20000, unitCostMicros: D(4), assumptionRef: 'a' }],
    supplier: { ...acme(), moqUnits: 0 },
  };
  const r = B.rollUpBom(comp, 50000);
  assert.equal(r.lines[0].bandUnitCostMicros, D(4)); // exactly the top band — no volume discount invented
  assert.equal(r.lines[0].outsideQuotedBands, true);
  assert.ok(r.issues.some((i) => i.code === 'above-highest-price-break'));
  // Deliberately conservative: 50,000 x $4.00 = $200,000, not a guessed cheaper rate.
  assert.equal(r.runRecurringMicros, D(200000));
});

test('a component with no quoted price at any quantity BLOCKS rather than costing zero', () => {
  const comp = {
    id: 'c', name: 'Unpriced part', qtyPerParent: 1, discrete: true, scrapRateRatio: 0,
    priceBreaks: [], supplier: acme(),
  };
  const r = B.rollUpBom(comp, 100);
  assert.ok(r.issues.some((i) => i.code === 'below-lowest-price-break' && i.severity === 'block'));
  assert.equal(B.bomIsPublishable(r), false);
});

test('the worked example rolls up to hand-derived values at 1,000 units', () => {
  const r = B.rollUpBom(bomTree(), 1000);
  const byId = Object.fromEntries(r.lines.map((l) => [l.componentId, l]));

  // ── Assembly node: 1 per unit, $0 assembly charge.
  assert.equal(byId.widget.effectiveQtyPerUnit, 1);
  assert.equal(byId.widget.extendedMicros, 0);

  // ── Shell: 1 per unit, 1,000 bought, which lands exactly on the 1,000-piece
  //    break at $4.00. 1,000 x $4.00 = $4,000.00.
  assert.equal(byId.shell.purchaseQty, 1000);
  assert.equal(byId.shell.bandUnitCostMicros, D(4));
  assert.equal(byId.shell.outsideQuotedBands, false);
  assert.equal(byId.shell.extendedMicros, D(4000));

  // ── Fastener: 4 per unit at 20% scrap = 4 x 1.25 = 5.0 exactly, so 5,000 are
  //    needed. FastCo's minimum is 6,000, so 6,000 are bought at $0.0034:
  //      extended    = 6,000 x 3,400 micros = 20,400,000 micros = $20.40
  //      MOQ overbuy = 1,000 x 3,400 micros =  3,400,000 micros =  $3.40
  assert.equal(byId.screw.effectiveQtyPerUnit, 5);
  assert.equal(byId.screw.purchaseQtyRaw, 5000);
  assert.equal(byId.screw.purchaseQty, 6000);
  assert.equal(byId.screw.extendedMicros, 20_400_000);
  assert.equal(byId.screw.moqOverbuyMicros, 3_400_000);
  assert.ok(r.issues.some((i) => i.code === 'moq-overbuy'));

  // ── Roll-up: 0 + 4,000,000,000 + 20,400,000 = 4,020,400,000 micros = $4,020.40
  assert.equal(r.runRecurringMicros, 4_020_400_000);
  assert.equal(r.recurringUnitMicros, 4_020_400); // /1,000, exact
  assert.equal(r.roundingResidualMicros, 0);

  // ── Tooling: $2,000 on a tool good for 100,000 pieces; 1,000 bought so one
  //    tool. NEVER folded into the unit cost — reported separately.
  assert.equal(r.oneTimeMicros, D(2000));
  assert.equal(byId.shell.toolsRequired, 1);
  assert.equal(r.amortizedUnitMicros, D(2)); // $2,000 / 1,000 units
  assert.equal(r.fullyLoadedUnitMicros, 4_020_400 + D(2));

  // ── Smallest honest run: FastCo's 6,000 minimum over 5 per unit = 1,200 units.
  assert.equal(r.moqConstrainedRunUnits, 1200);

  // ── Critical path driver: Acme, 4 weeks qualification + 10 weeks lead = 14.
  assert.equal(r.longestLeadWeeks, 14);
  assert.equal(r.longestLeadComponentId, 'widget');
});

test('the run total equals the sum of its parts at every price-break boundary', () => {
  for (const units of [1, 999, 1000, 1001, 4999, 5000, 20000]) {
    const r = B.rollUpBom(bomTree(), units);
    const sum = r.lines.reduce((a, l) => a + l.extendedMicros, 0);
    assert.equal(r.runRecurringMicros, sum, `sum of parts at ${units} units`);
    const oneTime = r.lines.reduce((a, l) => a + l.oneTimeMicros, 0);
    assert.equal(r.oneTimeMicros, oneTime, `one-time sum at ${units} units`);
  }
});

test('tooling buys another tool once tool life is exceeded', () => {
  const tree = bomTree();
  tree.children[0].toolingLifeUnits = 400;
  // 1,000 shells over a 400-piece tool life = ceil(1000/400) = 3 tools x $2,000.
  assert.equal(B.rollUpBom(tree, 1000).oneTimeMicros, D(6000));
});

test('zero volume yields NULL per-unit figures, never Infinity and never a silent zero', () => {
  const r = B.rollUpBom(bomTree(), 0);
  assert.equal(r.recurringUnitMicros, null);
  assert.equal(r.amortizedUnitMicros, null);
  assert.equal(r.fullyLoadedUnitMicros, null);
  assert.ok(r.issues.some((i) => i.code === 'zero-volume'));
});

test('an unqualified supplier is flagged so a provisional price is not read as a firm one', () => {
  const tree = bomTree();
  tree.children[1].supplier = { ...fastco(), qualified: false };
  const r = B.rollUpBom(tree, 1000);
  assert.ok(r.issues.some((i) => i.code === 'supplier-unqualified' && i.where === 'bom:screw'));
});

test('purchase orders group by supplier and split deposit from balance exactly', () => {
  const r = B.rollUpBom(bomTree(), 1000);
  const pos = B.supplierPurchaseOrders(r, B.collectSuppliers(bomTree()));
  const acmePo = pos.find((p) => p.supplier.supplierId === 'acme');
  const fastPo = pos.find((p) => p.supplier.supplierId === 'fastco');
  // Acme carries the assembly ($0) and the shell ($4,000) — 30% deposit.
  assert.equal(acmePo.poValueMicros, D(4000));
  assert.equal(acmePo.depositMicros, D(1200));
  assert.equal(acmePo.balanceMicros, D(2800));
  // FastCo: $20.40 at a 50% deposit.
  assert.equal(fastPo.poValueMicros, 20_400_000);
  assert.equal(fastPo.depositMicros, 10_200_000);
  assert.equal(fastPo.balanceMicros, 10_200_000);
  // Deposit plus balance is the order value, exactly, for every supplier.
  for (const p of pos) assert.equal(p.depositMicros + p.balanceMicros, p.poValueMicros);
});
