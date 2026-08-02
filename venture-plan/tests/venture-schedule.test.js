/**
 * Guards for the critical path and the seasonal cash calendar.
 *
 * The one that matters most: a critical path that lands the goods after the
 * window opens is a BLOCK, not a warning. A seasonal product that arrives late is
 * not carrying a timing risk, it is a product that arrives after the customers
 * went home, and the model must refuse to publish a plan built on it.
 *
 * The rest guard the timing that an annual profit-and-loss statement hides: the
 * factory is paid months before the season, freight and duty are paid at arrival,
 * a trade customer pays months after, and unsold stock is worth a fraction of
 * what it cost.
 *
 * Dependency-free `node --test` suite over the COMPILED module.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial guards — hand-derived critical path and latest honest PO month, the blocking missed-window verdict, deposit/balance timing per supplier, freight and duty at arrival, sell-through normalisation with the residual surfaced, carry versus liquidate signs, retailer terms lagging cash behind the sale, and the oversold-inventory block.
 * 2 | roger.murphy@emeraldcoastsystemsgroup.com   | Added the leg-to-cash identity — every buyer-paid landed leg must leave the bank, asserted on TOTALS under both FOB and EXW, because marine insurance and warehouse-in were costed into goods and paid by nobody. Added the inventory-relief guard: stock the cash statement has already liquidated stops being an asset in the same month.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { engine, D, ventureInput } = require('./fixture-venture');

const S = engine('venture-schedule');
const B = engine('venture-bom');
const Lm = engine('venture-landed');
const Ch = engine('venture-channels');
const M = engine('venture-model');

const ON = '2026-08-01';

/** Assemble a schedule input straight from the fixture, with overrides. */
function scheduleInput(over) {
  const input = ventureInput();
  const bom = B.rollUpBom(input.product.bom, input.runQtyUnits);
  const landed = Lm.computeLandedCost({ ...input.landed, units: 1000, exWorksUnitMicros: bom.recurringUnitMicros });
  const waterfalls = input.channels.map((channel) => Ch.forwardWaterfall({
    channel, landedUnitMicros: landed.buyerUnitMicros, pricing: input.pricing, onDate: ON,
  }));
  return Object.assign({
    bom, suppliers: B.collectSuppliers(input.product.bom), landed, season: input.season,
    toolingMonth: input.timing.toolingMonth, poMonth: input.timing.poMonth,
    transitWeeks: input.timing.transitWeeks, receivingWeeks: input.timing.receivingWeeks,
    channels: input.channels, waterfalls, unitsSold: 1000, unitsBuilt: 1000,
    horizon: Array.from({ length: 24 }, (_, i) => `${2026 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`),
  }, over || {});
}

const eventsOf = (r, kind) => r.events.filter((e) => e.kind === kind);

test('the critical path is hand-derivable and the plan makes its window', () => {
  const i = scheduleInput();
  const cp = S.computeCriticalPath(i.bom, '2026-03', 5, 2, i.season);
  // Acme drives it: 4 weeks qualification + 10 weeks lead = 14, plus 5 weeks
  // transit and 2 weeks receiving = 21 weeks.
  assert.equal(cp.totalWeeks, 21);
  assert.equal(cp.drivingComponentId, 'widget');
  // 21 weeks is 4.85 months, ceiled to 5: an order placed in March is ready in August.
  assert.equal(cp.goodsAvailableMonth, '2026-08');
  // Working backwards from an October window: the order had to be placed by May.
  assert.equal(cp.latestPoMonth, '2026-05');
  assert.equal(cp.weeksLate, 0);
  assert.equal(cp.issues.length, 0);
});

test('a purchase order placed too late BLOCKS — the goods arrive after the season', () => {
  const i = scheduleInput({ poMonth: '2026-07' });
  const r = S.buildCashSchedule(i);
  // July + 5 months = December, two months after the window opens.
  assert.equal(r.criticalPath.goodsAvailableMonth, '2026-12');
  assert.ok(r.criticalPath.weeksLate > 0);
  const blocked = r.issues.find((x) => x.code === 'critical-path-misses-window');
  assert.ok(blocked, 'a missed window must be surfaced');
  assert.equal(blocked.severity, 'block');
  assert.equal(blocked.data.latestPoMonth, '2026-05');
  // And it reaches the model, so the plan does not publish.
  const m = M.buildVentureModel({ ...ventureInput(), timing: { ...ventureInput().timing, poMonth: '2026-07' } });
  assert.equal(m.canPublish, false);
});

test('deposits fall at the order and balances at shipment plus terms — months before revenue', () => {
  const r = S.buildCashSchedule(scheduleInput());
  const deposits = eventsOf(r, 'po-deposit');
  const balances = eventsOf(r, 'po-balance');
  // Both deposits are paid in the PO month, March.
  assert.ok(deposits.every((e) => e.month === '2026-03'));
  // Acme: 30% of $4,000 = $1,200 at order; the $2,800 balance ships in July
  // (14 weeks from March, ceiled to 4 months) and is due net 30, so August.
  const acmeDeposit = deposits.find((e) => e.note.startsWith('Acme'));
  const acmeBalance = balances.find((e) => e.note.startsWith('Acme'));
  assert.equal(acmeDeposit.amountMicros, -D(1200));
  assert.equal(acmeBalance.amountMicros, -D(2800));
  assert.equal(acmeBalance.month, '2026-08');
  // FastCo: 8 weeks from March is May, net 0.
  assert.equal(balances.find((e) => e.note.startsWith('FastCo')).month, '2026-05');
  // Every one of them is an OUTFLOW, months ahead of the October window.
  assert.ok([...deposits, ...balances].every((e) => e.amountMicros < 0));
});

test('freight and duty fall at arrival, and duty is bundled with the charges that release the goods', () => {
  const r = S.buildCashSchedule(scheduleInput());
  // 14 weeks lead + 5 weeks transit = 19 weeks from March, ceiled to 5 months.
  assert.equal(eventsOf(r, 'freight')[0].month, '2026-08');
  // Ocean freight 3 x $3,000 = $9,000, PLUS the marine insurance premium the buyer
  // pays under FOB: 50 bps of (ex-works $4,020.40 + freight $9,000) = $65.102.
  // Insurance used to be inside landed cost and inside no cash event at all.
  assert.equal(eventsOf(r, 'freight')[0].amountMicros, -(D(9000) + 65_102_000));
  // duty + tariff + MPF + HMF + import clearance + drayage + warehouse-in
  // = 128,652,800 + 301,530,000 + 32,710,000 + 50,255,000 + 175,000,000
  //   + 1,350,000,000 + 750,000,000 (1,000 units x $0.75 receiving)
  assert.equal(eventsOf(r, 'duty-and-fees')[0].amountMicros, -2_788_147_800);
  assert.equal(eventsOf(r, 'duty-and-fees')[0].month, '2026-08');
});

test('EVERY buyer-paid landed leg leaves the bank — a leg cannot be costed and not paid', () => {
  const r = S.buildCashSchedule(scheduleInput());
  const input = scheduleInput();
  const owed = S.buyerPaidLogisticsMicros(input.landed);
  const paid = -[...eventsOf(r, 'freight'), ...eventsOf(r, 'duty-and-fees')]
    .reduce((a, e) => a + e.amountMicros, 0);
  assert.equal(paid, owed,
    'the import cash events are derived from the buyer-paid legs, so adding a leg cannot skip the cash calendar');
  // And the goods themselves are paid through the purchase orders.
  const po = -[...eventsOf(r, 'po-deposit'), ...eventsOf(r, 'po-balance')]
    .reduce((a, e) => a + e.amountMicros, 0);
  assert.equal(po + paid, input.landed.buyerTotalMicros + input.bom.roundingResidualMicros,
    'purchase orders plus import charges equal the landed cost of the run');
});

test('under EXW the origin legs are the buyers, and they are paid too', () => {
  const base = scheduleInput();
  const exw = {
    ...base,
    landed: Lm.computeLandedCost({
      ...ventureInput().landed, incoterm: 'EXW', units: 1000,
      exWorksUnitMicros: base.bom.recurringUnitMicros,
    }),
  };
  const r = S.buildCashSchedule(exw);
  const paid = -[...eventsOf(r, 'freight'), ...eventsOf(r, 'duty-and-fees')]
    .reduce((a, e) => a + e.amountMicros, 0);
  assert.equal(paid, S.buyerPaidLogisticsMicros(exw.landed));
  // EXW moves origin inland ($200/container x 3) and export clearance ($150) onto
  // the buyer, so the bill is strictly larger than under FOB.
  assert.ok(paid > S.buyerPaidLogisticsMicros(base.landed));
});

test('the whole run sells inside the four-week October window', () => {
  const r = S.buildCashSchedule(scheduleInput());
  assert.deepEqual(r.unitsSoldByMonth, { '2026-10': 1000 });
  assert.equal(r.unsoldAtWindowEnd, 0);
  // Direct settles in month, so the cash arrives in October too.
  const remit = eventsOf(r, 'channel-remittance');
  assert.equal(remit.length, 1);
  assert.equal(remit[0].month, '2026-10');
  // Cash remitted per unit is revenue less what the channel WITHHOLDS. The
  // $12.00 acquisition spend is not withheld — you pay it out separately — so it
  // is 79,990,000 - (26,519,210 - 12,000,000) = 65,470,790 per unit.
  assert.equal(remit[0].amountMicros, (79_990_000 - 14_519_210) * 1000);
});

test('a retailer on net-60 pays two months after the sale — that lag is the plan', () => {
  const input = ventureInput();
  const bigBox = { ...require('./fixture-venture').bigBoxChannel(), volumeShareRatio: 1 };
  const bom = B.rollUpBom(input.product.bom, 1000);
  const landed = Lm.computeLandedCost({ ...input.landed, units: 1000, exWorksUnitMicros: bom.recurringUnitMicros });
  const w = Ch.forwardWaterfall({ channel: bigBox, landedUnitMicros: landed.buyerUnitMicros, pricing: input.pricing, onDate: ON });
  const r = S.buildCashSchedule(scheduleInput({ channels: [bigBox], waterfalls: [w] }));
  const paid = eventsOf(r, 'retailer-payment');
  assert.equal(paid.length, 1);
  assert.equal(paid[0].month, '2026-12'); // sold in October, paid net 60
});

test('a sell-through curve that does not sum to one is normalised and the residual is reported', () => {
  const season = { ...ventureInput().season, weeklySellThrough: [1, 1, 1, 1] };
  const { weekly, issues } = S.normalisedSellThrough(season);
  assert.deepEqual(weekly, [0.25, 0.25, 0.25, 0.25]);
  assert.ok(issues.some((i) => i.code === 'sell-through-renormalised'));
  assert.equal(issues[0].data.declaredSum, 4);
  // Units still allocate to exactly the total, never one short.
  const { byMonth } = S.unitsByMonth(season, 999);
  assert.equal(Object.values(byMonth).reduce((a, b) => a + b, 0), 999);
});

test('unsold stock is either dumped for a fraction or carried at a cost — opposite signs', () => {
  const liquidated = S.buildCashSchedule(scheduleInput({ unitsSold: 600 }));
  assert.equal(liquidated.unsoldAtWindowEnd, 400);
  // 400 units x $15.87365 landed = 6,349,460,000, recovered at 3,000 bps.
  assert.equal(liquidated.postSeasonMicros, Math.round(15_873_650 * 400 * 0.30));
  assert.ok(liquidated.postSeasonMicros > 0, 'liquidation is an inflow, however painful');

  const carriedSeason = { ...ventureInput().season, postSeasonPolicy: 'carry' };
  const carried = S.buildCashSchedule(scheduleInput({ unitsSold: 600, season: carriedSeason }));
  assert.ok(carried.postSeasonMicros < 0, 'carrying stock is an outflow every month it sits');
  assert.ok(carried.events.some((e) => e.kind === 'holding-cost'));
});

test('the cost of an unsold unit is computed ONCE and both readers use it', () => {
  const liquidated = S.buildCashSchedule(scheduleInput({ unitsSold: 600 }));
  const d = liquidated.disposition;
  // $15.87365 landed, recovered at 3,000 bps, so $11.111555 is gone per unit.
  assert.equal(d.writeDownPerUnitMicros, 15_873_650 - Math.round(15_873_650 * 0.30));
  assert.equal(d.writeDownPerUnitMicros, 11_111_555);
  // And the P&L charge is exactly that rate times the count — not a second derivation.
  assert.equal(d.totalChargeMicros, 11_111_555 * 400);
  assert.equal(Object.values(d.chargeByMonth).reduce((a, b) => a + b, 0), d.totalChargeMicros);
  assert.equal(d.stockValueMicros, d.totalChargeMicros + d.recoveryMicros);
  // The rate exists even when nothing is left over, because the sell-through
  // inversion asks for the RATE, not the count.
  const soldOut = S.buildCashSchedule(scheduleInput());
  assert.equal(soldOut.disposition.unitsUnsold, 0);
  assert.equal(soldOut.disposition.writeDownPerUnitMicros, 11_111_555);
  assert.equal(soldOut.disposition.totalChargeMicros, 0);
});

test('liquidated stock stops being an asset in the month it is sold for scrap', () => {
  const r = S.buildCashSchedule(scheduleInput({ unitsSold: 600 }));
  const dumped = r.disposition.disposedMonth;
  assert.equal(dumped, '2026-11', 'the window closes in October, the leftovers go in November');
  assert.equal(r.unitsOnHandByMonth['2026-10'], 400, 'still on hand while the window is open');
  // The same 400 units cannot be an asset AND already sold. Before the fix they sat
  // on the balance sheet for the rest of the horizon after the cash had been banked.
  for (const m of Object.keys(r.unitsOnHandByMonth).filter((x) => x >= dumped)) {
    assert.equal(r.unitsOnHandByMonth[m], 0, `${m} carries no stock after the liquidation`);
  }
  // Carried stock is a different answer: it really is still there.
  const carriedSeason = { ...ventureInput().season, postSeasonPolicy: 'carry' };
  const carried = S.buildCashSchedule(scheduleInput({ unitsSold: 600, season: carriedSeason }));
  assert.equal(carried.disposition.disposedMonth, null);
  assert.equal(carried.unitsOnHandByMonth['2026-12'], 400);
});

test('selling more than was built is a stockout, not revenue — and it BLOCKS', () => {
  const r = S.buildCashSchedule(scheduleInput({ unitsSold: 1500, unitsBuilt: 1000 }));
  const blocked = r.issues.find((i) => i.code === 'oversold-inventory');
  assert.ok(blocked && blocked.severity === 'block');
  // Only what exists is sold.
  assert.equal(Object.values(r.unitsSoldByMonth).reduce((a, b) => a + b, 0), 1000);
});

test('inventory is zero before the goods land and drains as the season sells', () => {
  const r = S.buildCashSchedule(scheduleInput());
  assert.equal(r.unitsOnHandByMonth['2026-07'], 0); // not yet arrived
  assert.equal(r.unitsOnHandByMonth['2026-08'], 1000); // received
  assert.equal(r.unitsOnHandByMonth['2026-09'], 1000);
  assert.equal(r.unitsOnHandByMonth['2026-10'], 0); // sold through
});

test('every cash event is signed, dated and carries a note a reader can act on', () => {
  const r = S.buildCashSchedule(scheduleInput());
  for (const e of r.events) {
    assert.match(e.month, /^\d{4}-(0[1-9]|1[0-2])$/, 'every event is dated to a month');
    assert.ok(Number.isInteger(e.amountMicros), 'every amount is integer micros');
    assert.ok(e.note.length > 10, `every event explains itself: ${e.kind}`);
    assert.ok(Array.isArray(e.assumptionRefs));
  }
  // Tooling is spent before a single unit exists.
  assert.equal(eventsOf(r, 'tooling')[0].month, '2026-02');
  assert.equal(eventsOf(r, 'tooling')[0].amountMicros, -D(2000));
});
