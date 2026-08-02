/**
 * The hand-derived worked example every venture-engine guard is checked against.
 *
 * THIS FIXTURE IS DELIBERATELY SMALL AND UGLY-ROUND. Every expected value in
 * `venture-golden.test.js` is derived BY HAND in a comment beside the assertion,
 * which is only possible if the numbers stay small enough to multiply on paper.
 * A golden test whose expected values were produced by running the code proves
 * only that the code still does what it did — it cannot tell you the code was
 * ever right.
 *
 * Shape of the worked example: a 1,000-unit run of a three-line product, shipped
 * FOB in three containers, sold direct at $79.99 into a four-week October window.
 * It exercises, on purpose: a quantity price break that only applies at 1,000, a
 * 20% scrap rate chosen because 1/(1-0.2) is exactly 1.25, a supplier minimum
 * that forces an overbuy, a merchandise-processing fee that lands under its
 * per-entry floor, a marine insurance premium above its minimum in the base case
 * and below it at low volume, and a season whose whole cash trough falls before a
 * single unit sells.
 *
 * Not a .test.js file, so the store-CI glob does not run it as a suite.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial worked example — three-line BOM with a price break, exact scrap and a minimum-order overbuy; FOB landed stack with the MPF floor binding; a direct channel; a four-week October window; and a ledger that registers every referenced assumption so the fixture is publishable.
 */
'use strict';

const path = require('node:path');

const PKG = path.resolve(__dirname, '..');

/** Require a COMPILED engine module — the same bytes the framework mounts. */
function engine(name) {
  return require(path.join(PKG, 'routes', `${name}.js`));
}

const A = engine('venture-assumptions');

const D = (dollars) => Math.round(dollars * 1_000_000);

/** A model-estimate source, the weakest a bot-authored number can be. */
const est = (id) => ({ kind: 'model-estimate', agentId: 'venture-bom-analyst', taskId: 't-1', model: 'test', rationale: `estimate for ${id}` });
/** A vendor quote — the strongest source a cost line can carry. */
const quote = (vendor) => ({ kind: 'vendor-quote', vendor, quoteRef: 'Q-1', quotedOn: '2026-07-01', validUntil: '2026-10-01' });
/** A published rate, e.g. a duty schedule or a carrier tariff. */
const published = (pub) => ({ kind: 'published-rate', publication: pub, url: 'https://example.invalid/rate', retrievedAt: '2026-07-15' });

/** Every assumption the fixture references. A missing one makes the model unpublishable. */
const ASSUMPTIONS = [
  { id: 'bom.assembly.cost', label: 'Final assembly charge', value: 0, unit: 'micros', source: quote('Acme Assembly'), confidence: 'quoted' },
  { id: 'bom.shell.unit-cost', label: 'Moulded shell unit cost at 1,000', value: D(4), unit: 'micros', source: quote('Acme Assembly'), confidence: 'quoted', band: { low: D(3.4), high: D(5.2) } },
  { id: 'bom.screw.unit-cost', label: 'Fastener unit cost', value: 3400, unit: 'micros', source: est('screw'), confidence: 'estimated', band: { low: 2800, high: 4600 } },
  { id: 'supplier.acme.terms', label: 'Acme lead time and payment terms', value: 14, unit: 'weeks', source: quote('Acme Assembly'), confidence: 'quoted' },
  { id: 'supplier.fastco.terms', label: 'FastCo lead time and payment terms', value: 8, unit: 'weeks', source: est('fastco'), confidence: 'estimated' },
  { id: 'freight.container.rate', label: '40HQ ocean rate', value: D(3000), unit: 'micros', source: published('Freight broker rate sheet'), confidence: 'benchmarked', band: { low: D(2200), high: D(5400) } },
  { id: 'duty.hts.rate', label: 'HS duty rate', value: 320, unit: 'bps', source: est('hts'), confidence: 'estimated', band: { low: 0, high: 2500 } },
  { id: 'channel.dtc.terms', label: 'Direct channel economics', value: 1, unit: 'ratio', source: est('dtc'), confidence: 'estimated' },
  { id: 'demand.base.units', label: 'Base-case unit demand', value: 1200, unit: 'units', source: est('demand'), confidence: 'guessed', band: { low: 400, high: 2400 } },
  { id: 'org.contractor.rate', label: 'Contract operations support', value: D(24000), unit: 'micros', source: quote('Contractor'), confidence: 'quoted' },
];

/** The three-line product structure. */
function bomTree() {
  return {
    id: 'widget', name: 'Widget assembly', qtyPerParent: 1, discrete: true, scrapRateRatio: 0,
    priceBreaks: [{ minQty: 0, unitCostMicros: 0, assumptionRef: 'bom.assembly.cost' }],
    supplier: acme(),
    children: [
      {
        id: 'shell', name: 'Moulded shell', qtyPerParent: 1, discrete: true, scrapRateRatio: 0,
        priceBreaks: [
          { minQty: 1, unitCostMicros: D(5), assumptionRef: 'bom.shell.unit-cost' },
          { minQty: 1000, unitCostMicros: D(4), assumptionRef: 'bom.shell.unit-cost' },
        ],
        supplier: acme(),
        toolingMicros: D(2000),
        toolingLifeUnits: 100000,
      },
      {
        // 20% scrap is chosen so 1/(1-0.2) is exactly 1.25 and the expected
        // quantity can be checked on paper: 4 x 1.25 = 5 per finished unit.
        id: 'screw', name: 'Fastener', qtyPerParent: 4, discrete: true, scrapRateRatio: 0.2,
        priceBreaks: [{ minQty: 1, unitCostMicros: 3400, assumptionRef: 'bom.screw.unit-cost' }],
        supplier: fastco(),
      },
    ],
  };
}

/** Assembly supplier: 14 weeks of qualification plus lead — the critical path. */
function acme() {
  return {
    supplierId: 'acme', name: 'Acme Assembly', moqUnits: 0, leadTimeWeeks: 10, qualificationWeeks: 4,
    depositBps: 3000, balanceNetDays: 30, qualified: true, assumptionRefs: ['supplier.acme.terms'],
  };
}

/** Fastener supplier: a 6,000-piece minimum against a 5,000-piece need. */
function fastco() {
  return {
    supplierId: 'fastco', name: 'FastCo', moqUnits: 6000, leadTimeWeeks: 6, qualificationWeeks: 2,
    depositBps: 5000, balanceNetDays: 0, qualified: true, assumptionRefs: ['supplier.fastco.terms'],
  };
}

/** The landed stack, without units or the ex-works price the BOM supplies. */
function landedShape() {
  return {
    incoterm: 'FOB',
    originInlandPerContainerMicros: D(200),
    exportClearancePerEntryMicros: D(150),
    freight: {
      containerType: '40HQ', unitsPerContainer: 400, containerCostMicros: D(3000), cbmPerUnit: 0.05,
      lclThresholdRatio: 0.5, lclCostPerCbmMicros: D(80), lclMinimumChargeableCbm: 2,
      assumptionRefs: ['freight.container.rate'],
    },
    duty: {
      htsCode: '9505.90.6000', htsDutyBps: 320, additionalTariffBps: 750, customsValueBasis: 'fob',
      mpfBps: 35, mpfMinMicros: D(32.71), mpfMaxMicros: D(634.62), hmfBps: 125,
      assumptionRefs: ['duty.hts.rate'],
    },
    insuranceBps: 50,
    insuranceMinimumMicros: D(50),
    importClearancePerEntryMicros: D(175),
    drayagePerContainerMicros: D(450),
    warehouseInPerUnitMicros: D(0.75),
  };
}

/** The direct channel. */
function dtcChannel() {
  return {
    id: 'dtc', label: 'Direct to consumer', volumeShareRatio: 1,
    assumptionRefs: ['channel.dtc.terms'],
    economics: {
      kind: 'dtc', paymentBps: 290, paymentFixedMicros: D(0.30),
      outboundShipMicros: D(6.50), shippingChargedToCustomerMicros: 0, pickPackMicros: D(1.25),
      returnRateRatio: 0.05, returnHandlingMicros: D(3), returnSalvageRatio: 0.5,
      cacPerOrderMicros: D(12),
    },
  };
}

/** A marketplace channel, used by the tests that exercise the dated fee card. */
function amazonChannel() {
  return {
    id: 'fba', label: 'Marketplace', volumeShareRatio: 1,
    assumptionRefs: ['channel.dtc.terms'],
    economics: {
      kind: 'amazon', referralBps: 1500,
      dims: { lengthIn: 24, widthIn: 18, heightIn: 12, weightLb: 9 },
      shippingWeightOz: 160, cubicFeet: 3,
      storageMonths: ['2026-08', '2026-09', '2026-10'],
      inboundPerUnitMicros: D(1.10), returnRateRatio: 0.06, returnProcessingMicros: D(2),
      acosBps: 900, feeTableDate: '2026-07-01',
    },
  };
}

/** A big-box channel: the retailer sets shelf price from your wholesale. */
function bigBoxChannel() {
  return {
    id: 'bigbox', label: 'National retailer', volumeShareRatio: 1,
    assumptionRefs: ['channel.dtc.terms'],
    economics: {
      kind: 'big-box', retailerMarginBps: 4000, markdownAllowanceBps: 500, coopAdvertisingBps: 200,
      defectiveAllowanceBps: 100, chargebackBps: 150, earlyPaymentDiscountBps: 200,
      freightAllowanceBps: 100, newStoreAllowanceBps: 50, paymentNetDays: 60,
    },
  };
}

/** A two-step distribution channel. */
function distributorChannel() {
  return {
    id: 'dist', label: 'Distributor', volumeShareRatio: 1,
    assumptionRefs: ['channel.dtc.terms'],
    economics: {
      kind: 'distributor', distributorMarginBps: 2500, retailerMarginBps: 4000,
      allowancesBps: 300, paymentNetDays: 45,
    },
  };
}

/**
 * The complete model input. Every field is a plain value so a test can copy it
 * and change exactly one thing.
 */
function ventureInput(overrides) {
  const built = A.buildLedger(ASSUMPTIONS);
  const fixedOpexByMonth = {};
  for (let i = 0; i < 24; i += 1) {
    const month = `${2026 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
    fixedOpexByMonth[month] = D(250);
  }
  const input = {
    ledger: built.ledger,
    bindings: [
      { assumptionId: 'bom.screw.unit-cost', path: 'product.bom.children.1.priceBreaks.0.unitCostMicros' },
      { assumptionId: 'freight.container.rate', path: 'landed.freight.containerCostMicros' },
      { assumptionId: 'duty.hts.rate', path: 'landed.duty.htsDutyBps' },
      { assumptionId: 'demand.base.units', path: 'demand.scenarios.1.baselineUnits' },
    ],
    product: { name: 'Widget', bom: bomTree() },
    runQtyUnits: 1000,
    landed: landedShape(),
    channels: [dtcChannel()],
    pricing: { kind: 'fixed-shelf', shelfPriceMicros: D(79.99) },
    demand: {
      scenarios: [
        { key: 'conservative', baselineUnits: 600, assumptionRef: 'demand.base.units' },
        { key: 'base', baselineUnits: 1200, assumptionRef: 'demand.base.units' },
        { key: 'optimistic', baselineUnits: 2400, assumptionRef: 'demand.base.units' },
      ],
      selected: 'base',
      elasticity: null,
    },
    season: {
      sellWindowStart: '2026-10', sellWindowWeeks: 4,
      weeklySellThrough: [0.15, 0.30, 0.35, 0.20],
      postSeasonPolicy: 'liquidate', carryHoldingBpsPerMonth: 150, liquidationRecoveryBps: 3000,
      assumptionRefs: [],
    },
    timing: { toolingMonth: '2026-02', poMonth: '2026-03', transitWeeks: 5, receivingWeeks: 2 },
    roles: [{
      id: 'ops', title: 'Operations support', kind: 'contractor',
      startMonth: '2026-01', endMonth: '2026-12',
      annualBaseMicros: D(24000), fteRatio: 0.25, burdenBps: 0,
      assumptionRefs: ['org.contractor.rate'],
    }],
    fixedOpexByMonth,
    openingCashMicros: 0,
    horizonStart: '2026-01',
    horizonMonths: 24,
    onDate: '2026-08-01',
  };
  return Object.assign(input, overrides || {});
}

module.exports = {
  PKG, engine, D, ASSUMPTIONS, ventureInput, bomTree, acme, fastco, landedShape,
  dtcChannel, amazonChannel, bigBoxChannel, distributorChannel,
};
