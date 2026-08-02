/**
 * Guards for the channel margin waterfall, in both directions.
 *
 * THE PROPERTY THAT CARRIES THE DESIGN: pricing forward from a cost and then
 * inverting back to the maximum affordable cost must return where it started, for
 * every channel shape. That round trip is only exact because no channel fee
 * depends on landed cost, so `validateChannel` rejecting a cost-dependent fee is
 * guarded here too — it is not a stylistic rule, it is what keeps the inverse from
 * quietly becoming an approximation.
 *
 * The other guards are refusals: an unreachable target margin BLOCKS rather than
 * returning an absurd price, and a channel that loses money per unit returns a
 * NEGATIVE contribution rather than a clamped zero.
 *
 * Dependency-free `node --test` suite over the COMPILED module.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial guards — the hand-derived direct waterfall, the bidirectional round trip across all four channel shapes, the cost-dependent-fee rejection, the unreachable-margin block, the negative-contribution surface, big-box wholesale versus net wholesale, marketplace peak storage, and the returns salvage factor.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  engine, D, dtcChannel, amazonChannel, bigBoxChannel, distributorChannel,
} = require('./fixture-venture');

const C = engine('venture-channels');
const F = engine('venture-fba-tables');

const ON = '2026-08-01';
const LANDED = 15_873_650; // the fixture's hand-derived landed unit cost
const stepOf = (w, key) => w.steps.find((s) => s.key === key);

test('the direct waterfall computes to hand-derived values at $79.99', () => {
  const w = C.forwardWaterfall({
    channel: dtcChannel(), landedUnitMicros: LANDED,
    pricing: { kind: 'fixed-shelf', shelfPriceMicros: D(79.99) }, onDate: ON,
  });

  // Shelf $79.99, no shipping charged, so gross revenue is the shelf price.
  assert.equal(w.grossRevenueMicros, 79_990_000);

  // ── Refunds: 5% of orders x $79.99 = 3,999,500
  assert.equal(-stepOf(w, 'returns-refund').amountMicros, 3_999_500);
  // ── Payment: 290 bps of $79.99 = 2,319,710, plus the $0.30 fixed = 2,619,710
  assert.equal(-stepOf(w, 'payment').amountMicros, 2_619_710);
  // ── Outbound $6.50, pick/pack $1.25, acquisition $12.00
  assert.equal(-stepOf(w, 'outbound-shipping').amountMicros, D(6.50));
  assert.equal(-stepOf(w, 'pick-pack').amountMicros, D(1.25));
  assert.equal(-stepOf(w, 'customer-acquisition').amountMicros, D(12));
  // ── Returns handling: 5% x $3.00 = 150,000
  assert.equal(-stepOf(w, 'returns-handling').amountMicros, 150_000);

  //  3,999,500 + 2,619,710 + 6,500,000 + 1,250,000 + 12,000,000 + 150,000
  //  = 26,519,210
  assert.equal(w.totalFeeMicros, 26_519_210);

  // ── Landed cost enters at 9,750 bps, because 5% of units come back and half
  //    of those are resellable: 1 - 0.05 x 0.5 = 0.975.
  assert.equal(w.landedFactorBps, 9750);
  // 15,873,650 x 0.9750 = 15,476,808.75 -> half-up -> 15,476,809
  assert.equal(-stepOf(w, 'landed-cost').amountMicros, 15_476_809);

  // ── Contribution: 79,990,000 - 26,519,210 - 15,476,809 = 37,993,981
  assert.equal(w.contributionPerUnitMicros, 37_993_981);
  // 37,993,981 / 79,990,000 = 47.4984% -> 4,750 bps
  assert.equal(w.contributionBps, 4750);
});

test('the waterfall reconciles: gross revenue less every deduction IS the contribution', () => {
  for (const channel of [dtcChannel(), amazonChannel(), bigBoxChannel(), distributorChannel()]) {
    const w = C.forwardWaterfall({
      channel, landedUnitMicros: LANDED,
      pricing: { kind: 'fixed-shelf', shelfPriceMicros: D(79.99) }, onDate: ON,
    });
    const sum = w.steps.reduce((a, s) => a + s.amountMicros, 0);
    assert.equal(sum, w.contributionPerUnitMicros, `${channel.id}: steps must sum to contribution`);
  }
});

test('forward-then-inverse round-trips for every channel shape', () => {
  // Price from cost at a target contribution, then ask what landed cost that
  // price can afford at the same target. The answer must be where we started.
  // The tolerance is 16 micros ($0.000016) because each fee component rounds
  // independently; anything larger would be a real defect in the affine split.
  for (const channel of [dtcChannel(), amazonChannel(), bigBoxChannel(), distributorChannel()]) {
    for (const targetBps of [1000, 2500, 4000]) {
      const fwd = C.forwardWaterfall({
        channel, landedUnitMicros: LANDED,
        pricing: { kind: 'from-cost', targetContributionBps: targetBps }, onDate: ON,
      });
      assert.ok(fwd.shelfPriceMicros > 0, `${channel.id} @ ${targetBps}: a price was found`);
      const back = C.maxAffordableLandedCost({
        channel, shelfPriceMicros: fwd.shelfPriceMicros,
        requiredContributionBps: targetBps, onDate: ON,
      });
      const drift = Math.abs(back.maxLandedUnitMicros - LANDED);
      assert.ok(drift <= 16, `${channel.id} @ ${targetBps} bps: round trip drifted ${drift} micros`);
    }
  }
});

test('from-cost finds the SMALLEST price that clears the target, not merely one that does', () => {
  const channel = dtcChannel();
  const target = 3000;
  const w = C.forwardWaterfall({
    channel, landedUnitMicros: LANDED, pricing: { kind: 'from-cost', targetContributionBps: target }, onDate: ON,
  });
  const at = (s) => C.forwardWaterfall({ channel, landedUnitMicros: LANDED, pricing: { kind: 'fixed-shelf', shelfPriceMicros: s }, onDate: ON });
  const meets = (s) => at(s).contributionPerUnitMicros >= Math.round((at(s).grossRevenueMicros * target) / 10000);
  assert.ok(meets(w.shelfPriceMicros), 'the returned price clears the target');
  assert.ok(!meets(w.shelfPriceMicros - 1), 'one micro less does not');
});

test('an unreachable target margin BLOCKS rather than returning an absurd price', () => {
  // A big-box channel whose retailer margin plus allowances already consume most
  // of the shelf price cannot also yield a 70% contribution at any price.
  const w = C.forwardWaterfall({
    channel: bigBoxChannel(), landedUnitMicros: LANDED,
    pricing: { kind: 'from-cost', targetContributionBps: 7000 }, onDate: ON,
  });
  assert.equal(w.shelfPriceMicros, 0);
  const blocked = w.issues.find((i) => i.code === 'unreachable-target-margin');
  assert.ok(blocked && blocked.severity === 'block');
  // The message must state WHY, in numbers — the fee rate and the target.
  assert.ok(blocked.data.feeVarBps > 0);
});

test('a channel that loses money per unit returns a NEGATIVE contribution, never a clamped zero', () => {
  const w = C.forwardWaterfall({
    channel: dtcChannel(), landedUnitMicros: LANDED,
    pricing: { kind: 'fixed-shelf', shelfPriceMicros: D(19.99) }, onDate: ON,
  });
  assert.ok(w.contributionPerUnitMicros < 0, 'the loss is reported as a loss');
  assert.ok(w.issues.some((i) => i.code === 'negative-contribution'));
  // 19,990,000 - fees - 15,476,809: hand-checkable that it must be under water.
  assert.ok(w.totalFeeMicros + 15_476_809 > 19_990_000);
});

test('validateChannel REJECTS a cost-dependent fee — that invariant is what makes the inverse exact', () => {
  const bad = dtcChannel();
  bad.economics.landedSurchargeBps = 250;
  const issues = C.validateChannel(bad);
  const blocked = issues.find((i) => i.code === 'cost-dependent-fee-rejected');
  assert.ok(blocked, 'a landed-cost-dependent fee must be rejected');
  assert.equal(blocked.severity, 'block');
  // And it reaches the waterfall, so a caller cannot price the channel and ignore it.
  const w = C.forwardWaterfall({
    channel: bad, landedUnitMicros: LANDED,
    pricing: { kind: 'fixed-shelf', shelfPriceMicros: D(79.99) }, onDate: ON,
  });
  assert.ok(w.issues.some((i) => i.code === 'cost-dependent-fee-rejected' && i.severity === 'block'));
});

test('a rate at or above 100%, or a ratio outside 0-1, BLOCKS — such a stack cannot be inverted', () => {
  const bad = bigBoxChannel();
  bad.economics.retailerMarginBps = 10000;
  assert.ok(C.validateChannel(bad).some((i) => i.code === 'invalid-channel-rate' && i.severity === 'block'));
  const badRatio = dtcChannel();
  badRatio.economics.returnRateRatio = 1.4;
  assert.ok(C.validateChannel(badRatio).some((i) => i.code === 'invalid-channel-rate' && i.severity === 'block'));
});

test('big-box net wholesale is strictly below wholesale by the whole allowance stack', () => {
  const w = C.forwardWaterfall({
    channel: bigBoxChannel(), landedUnitMicros: LANDED,
    pricing: { kind: 'fixed-shelf', shelfPriceMicros: D(129.99) }, onDate: ON,
  });
  // 40% retailer margin: wholesale = $129.99 x 0.60 = $77.994 = 77,994,000 micros
  assert.equal(w.wholesaleMicros, 77_994_000);
  assert.ok(w.netWholesaleMicros < w.wholesaleMicros, 'allowances must reduce what you bank');
  // Allowances total 1,300 bps of wholesale: 500 + 200 + 100 + 150 + 200 + 100 + 50.
  // 77,994,000 x 0.13 = 10,139,220
  assert.equal(w.wholesaleMicros - w.netWholesaleMicros, 10_139_220);
});

test('fixed-wholesale grosses back up to the shelf price the retailer will set', () => {
  const w = C.forwardWaterfall({
    channel: bigBoxChannel(), landedUnitMicros: LANDED,
    pricing: { kind: 'fixed-wholesale', wholesaleMicros: D(60) }, onDate: ON,
  });
  // $60.00 wholesale at a 40% retailer margin implies a $100.00 shelf price.
  assert.equal(w.shelfPriceMicros, D(100));
  assert.equal(w.wholesaleMicros, D(60));
});

test('marketplace peak-month storage costs more than the same volume off-peak', () => {
  const { table } = F.fbaTableFor('2026-08-01');
  const peak = F.fbaStorageCost(table, 3, ['2026-10', '2026-11', '2026-12'], true);
  const offPeak = F.fbaStorageCost(table, 3, ['2026-04', '2026-05', '2026-06'], true);
  assert.ok(peak > offPeak, 'a seasonal product sits in storage through exactly the expensive months');
  // Averaging the rate across the year would hide the entire problem.
  assert.ok(peak / offPeak >= 2);
});

test('the marketplace fee card carries its provenance and says it is unverified', () => {
  const picked = F.fbaTableFor('2026-08-01');
  assert.equal(picked.table.verified, false);
  assert.ok(picked.issues.some((i) => i.code === 'unsourced-estimate'));
  assert.ok(picked.table.url && picked.table.retrievedAt && picked.table.publishedBy);
  // A card more than a year older than the modelled date is called out.
  assert.ok(F.fbaTableFor('2028-01-01').issues.some((i) => i.code === 'fee-table-stale'));
});

test('size tier decides both the fulfilment fee and the storage rate', () => {
  assert.equal(F.classifySizeTier({ lengthIn: 10, widthIn: 6, heightIn: 0.5, weightLb: 0.5 }), 'small-standard');
  assert.equal(F.classifySizeTier({ lengthIn: 16, widthIn: 12, heightIn: 6, weightLb: 10 }), 'large-standard');
  assert.equal(F.classifySizeTier({ lengthIn: 24, widthIn: 18, heightIn: 12, weightLb: 9 }), 'large-bulky');
  assert.equal(F.classifySizeTier({ lengthIn: 40, widthIn: 30, heightIn: 30, weightLb: 60 }), 'extra-large-50-70');
  assert.equal(F.isOversizeTier('large-bulky'), true);
  assert.equal(F.isOversizeTier('large-standard'), false);
});

test('a unit heavier than every fee row falls to the heaviest row, never to a free zero', () => {
  const { table } = F.fbaTableFor('2026-08-01');
  const heaviest = Math.max(...table.rows.filter((r) => r.tier === 'large-bulky').map((r) => r.feeMicros));
  assert.equal(F.fbaFulfilmentFee(table, 'large-bulky', 99999), heaviest);
  assert.ok(heaviest > 0, 'a missing fee is a fee of zero, and zero is the most dangerous default in a margin model');
});

test('returns salvage lowers the landed-cost term, and no salvage leaves it whole', () => {
  const noSalvage = dtcChannel();
  noSalvage.economics.returnSalvageRatio = 0;
  const w0 = C.forwardWaterfall({ channel: noSalvage, landedUnitMicros: LANDED, pricing: { kind: 'fixed-shelf', shelfPriceMicros: D(79.99) }, onDate: ON });
  assert.equal(w0.landedFactorBps, 10000);
  const wFull = C.forwardWaterfall({ channel: dtcChannel(), landedUnitMicros: LANDED, pricing: { kind: 'fixed-shelf', shelfPriceMicros: D(79.99) }, onDate: ON });
  assert.equal(wFull.landedFactorBps, 9750);
  assert.ok(wFull.contributionPerUnitMicros > w0.contributionPerUnitMicros);
});

test('blended contribution weights by normalised volume share', () => {
  const a = { ...dtcChannel(), volumeShareRatio: 3 };
  const b = { ...bigBoxChannel(), volumeShareRatio: 1 };
  const price = { kind: 'fixed-shelf', shelfPriceMicros: D(79.99) };
  const wa = C.forwardWaterfall({ channel: a, landedUnitMicros: LANDED, pricing: price, onDate: ON });
  const wb = C.forwardWaterfall({ channel: b, landedUnitMicros: LANDED, pricing: price, onDate: ON });
  const blended = C.blendedContributionPerUnit([wa, wb], [a, b]);
  // Shares 3 and 1 normalise to 0.75 and 0.25 — they do not have to sum to 1 as given.
  assert.deepEqual(C.normalisedShares([a, b]), [0.75, 0.25]);
  assert.equal(blended, Math.round(wa.contributionPerUnitMicros * 0.75 + wb.contributionPerUnitMicros * 0.25));
});

test('payment terms drive the cash lag, and direct channels settle in month', () => {
  assert.equal(C.channelPaymentNetDays(bigBoxChannel()), 60);
  assert.equal(C.channelPaymentNetDays(distributorChannel()), 45);
  assert.equal(C.channelPaymentNetDays(amazonChannel()), 14);
  assert.equal(C.channelPaymentNetDays(dtcChannel()), 2);
});
