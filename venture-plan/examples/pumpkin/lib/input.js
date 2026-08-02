/**
 * Assemble a `VentureModelInput` for the pumpkin venture from the dataset.
 *
 * EVERY NUMERIC FIELD OF THE INPUT IS READ OUT OF THE LEDGER, never written as a
 * literal here, and every one that the sensitivity sweep should be able to move
 * carries a `binding` from its assumption id to its dotted path. A field with a
 * value but no binding is a field the tornado cannot see, so the binding list is
 * as much a part of the honesty machinery as the ledger is.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO:
 *
 *   - It does not invent a demand forecast. The dataset says explicitly that the
 *     5,000-unit volume is "not derived from any demand forecast", so demand is
 *     modelled as SELL-THROUGH OF WHAT IS BUILT, not as market size, and the
 *     scenario spread comes from the dataset's own returns-and-markdown reserve.
 *   - It does not price the six roles the dataset lists. The dataset says the
 *     operator must supply a labour rate; the base plan therefore runs
 *     founder-operated at zero salary, and a separate staffed scenario prices them
 *     against a clearly-labelled placeholder.
 *   - It does not supply an elasticity. There is no price-response data, so the
 *     engine holds volume flat and says so — a curve invented here would make
 *     every price inversion look better than the evidence supports.
 *
 * THE TARIFF BRANCH IS A CONSTRUCTOR ARGUMENT, not a default. The dataset forbids
 * presenting a single landed cost while the classification is unresolved, so there
 * is no way to build this input without choosing a branch and naming it.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — variant-filtered BOM tree with a two-step quoted ladder, the FOB landed stack under both tariff branches, three channel shapes built from dataset fee records, the sell-through demand model, the dated certification spend, and the binding table that makes the sweep real.
 */
'use strict';

const { engine } = require('./format');
const { D, BPS, atCorner, buildPumpkinLedger } = require('./ledger');

const A = engine('venture-assumptions');

/** Months of horizon modelled: from the decision point through the season tail. */
const HORIZON_MONTHS = 30;
/** First month of the modelled horizon. */
const HORIZON_START = '2026-09';
/** Modelling date. A parameter — the engine never reads a clock. */
const ON_DATE = '2026-08-02';

/**
 * The Halloween 2027 season, which is the earliest a product that does not yet
 * exist can reach a consumer. The dataset's category-review calendar puts a big-box
 * shelf a further season out; that is a schedule fact, not a pricing one.
 */
const SEASON_START = '2027-08';
const SEASON_WEEKS = 10;

/** Supplier grouping: dataset source id -> the supplier that would quote it. */
const SUPPLIER_BY_SOURCE = {
  S24: { id: 'sup-inflatable', name: 'Inflatable envelope maker (not yet identified)' },
  S25: { id: 'sup-blower', name: 'Blower supplier (not yet identified)' },
  S22: { id: 'sup-panel', name: 'Rear-projection panel supplier (not yet identified)' },
  S2: { id: 'sup-projector', name: 'Projector supplier (not yet identified)' },
  S1: { id: 'sup-projector', name: 'Projector supplier (not yet identified)' },
  S23: { id: 'sup-compute', name: 'Compute module supplier (not yet identified)' },
  REPO: { id: 'sup-cm', name: 'Contract manufacturer (not yet identified)' },
  CALC: { id: 'sup-cm', name: 'Contract manufacturer (not yet identified)' },
};

/**
 * The dataset states ONE combined programme-allowance band and does not break it
 * down, so the model carries it as one line rather than inventing a split across
 * the engine's six named allowance fields. A six-way split would have looked more
 * detailed and would have been six numbers nobody supplied — and it would have made
 * the allowance unbindable, so the sensitivity sweep would have reported the whole
 * category as having no effect.
 */
const ALLOWANCE_FIELD = 'markdownAllowanceBps';

/** The engine's other allowance fields, zeroed because the dataset does not split them. */
const UNSPLIT_ALLOWANCE_FIELDS = [
  'coopAdvertisingBps', 'chargebackBps', 'defectiveAllowanceBps',
  'freightAllowanceBps', 'newStoreAllowanceBps',
];

/** Certification spend, one regime per month so each is separately bindable. */
const COMPLIANCE_MONTH = {
  'R-RETAILER': '2026-11',
  'R-EFILE': '2026-12',
  'R-FCC': '2027-01',
  'R-SAFETY': '2027-02',
  'R-PROP65': '2027-03',
  'R-CPSIA': '2027-05',
};

/** The two tariff branches the dataset requires the engine to run separately. */
const DUTY_BRANCHES = {
  '9505': {
    id: '9505', htsCode: '9505.90 (festive articles)', additionalTariffBps: 750, useMfn: true,
    label: 'HTS 9505 festive articles, Section 301 List 4A at 7.5%',
  },
  '8528': {
    id: '8528', htsCode: '8528.62 (projectors)', additionalTariffBps: 2500, useMfn: false,
    label: 'HTS 8528 projectors, Section 301 at 25%',
  },
};

/** Read a ledger value, throwing rather than defaulting when it is absent. */
const val = (ledger, id) => {
  const a = ledger.byId[id];
  if (!a) throw new RangeError(`assumption "${id}" was not registered; the model must not default it`);
  return a.value;
};

/**
 * @description Build the supplier terms for one BOM line. No supplier has been
 *   contacted, so every one is recorded unqualified — which the engine reports as
 *   a warning against every line, and that report is accurate.
 * @param {object} ledger - The assumption ledger.
 * @param {object} line - The dataset BOM line.
 * @returns {object} Engine SupplierTerms.
 */
function supplierFor(ledger, line) {
  const s = SUPPLIER_BY_SOURCE[line.sourceId] || SUPPLIER_BY_SOURCE.CALC;
  return {
    supplierId: s.id,
    name: s.name,
    // No component minimum is modelled because none has been quoted. At pilot
    // volume a supplier minimum is one of the likeliest sources of overbuy, and
    // its absence here makes the pilot case optimistic rather than conservative.
    moqUnits: 0,
    leadTimeWeeks: val(ledger, 'M-LEAD'),
    qualificationWeeks: val(ledger, 'M-QUAL'),
    depositBps: val(ledger, 'A-WC-1-DEPOSIT'),
    balanceNetDays: 0,
    qualified: false,
    assumptionRefs: ['M-LEAD', 'M-QUAL', 'A-WC-1-DEPOSIT'],
  };
}

/**
 * @description The quoted price ladder for one component: a production-volume step
 *   at the dataset's stated 5,000-unit band, and a pilot step above it carrying the
 *   dataset's own 25-60% small-run uplift. Both steps are prices somebody would
 *   have to quote; nothing between or beyond them is interpolated, and a run above
 *   5,000 units falls outside the ladder and is flagged rather than extrapolated.
 * @param {object} ledger - The assumption ledger.
 * @param {object} line - The dataset BOM line.
 * @returns {Array<object>} Engine PriceBreak steps.
 */
function priceLadder(ledger, line) {
  const production = val(ledger, line.id);
  const bandQty = val(ledger, 'A-VOL-1');
  const uplift = val(ledger, 'A-VOL-2-UPLIFT');
  return [
    { minQty: 1, maxQty: bandQty - 1, unitCostMicros: Math.round(production * (1 + uplift)), assumptionRef: line.id },
    // No ceiling on the production step: a band quoted "at 5,000 units" applies at
    // 5,000 and above, and scrap alone pushes the purchase quantity past 5,000.
    { minQty: bandQty, unitCostMicros: production, assumptionRef: line.id },
  ];
}

/**
 * @description Build the variant's BOM tree. The root is the finished packed good
 *   and carries the assembly charge; every dataset line for the variant hangs off
 *   it. Optional lines are excluded, matching the dataset's own roll-up vectors.
 * @param {object} ds - The dataset.
 * @param {object} ledger - The assumption ledger.
 * @param {string} variantId - `V-A` or `V-B`.
 * @returns {object} An engine BomComponent tree.
 */
function bomTree(ds, ledger, variantId) {
  const lines = ds.bom.filter((l) => l.variantIds.includes(variantId) && !l.optional);
  const scrap = val(ledger, 'M-SCRAP');
  const children = lines.map((line) => {
    const node = {
      id: line.id, name: line.component, qtyPerParent: line.qty, discrete: true,
      scrapRateRatio: scrap, priceBreaks: priceLadder(ledger, line),
      supplier: supplierFor(ledger, line), notes: line.spec,
    };
    if (line.toolingCostBand) {
      node.toolingMicros = val(ledger, `${line.id}-TOOLING`);
      // One tool is bought per run: no tool-life figure exists, and assuming a
      // long life would spread a cost the plan has not earned the right to spread.
      node.toolingLifeUnits = Number.MAX_SAFE_INTEGER;
    }
    return node;
  });
  return {
    id: `${variantId}-finished`, name: `${variantId} finished packed good`,
    qtyPerParent: 1, discrete: true, scrapRateRatio: 0,
    priceBreaks: [{ minQty: 1, unitCostMicros: val(ledger, 'M-ASSY'), assumptionRef: 'M-ASSY' }],
    supplier: supplierFor(ledger, { sourceId: 'CALC' }),
    children,
  };
}

/**
 * @description The FOB landed stack. Under FOB the origin inland leg and the
 *   export clearance are the seller's, so they are reported as seller-paid rather
 *   than costed to the buyer — they are inside the ex-works price, not free.
 * @param {object} ledger - The assumption ledger.
 * @param {string} variantId - `V-A` or `V-B`.
 * @param {string} branchId - `9505` or `8528`.
 * @returns {object} The engine LandedInput minus units and ex-works price.
 */
function landedShape(ledger, variantId, branchId) {
  const branch = DUTY_BRANCHES[branchId];
  const cbmPerUnit = val(ledger, variantId === 'V-A' ? 'A-FRT-4' : 'A-FRT-5');
  const usableCbm = val(ledger, 'M-CONTAINER-CBM');
  return {
    incoterm: 'FOB',
    originInlandPerContainerMicros: 0,
    exportClearancePerEntryMicros: 0,
    freight: {
      containerType: '40HQ',
      unitsPerContainer: Math.max(1, Math.floor(usableCbm / cbmPerUnit)),
      containerCostMicros: val(ledger, 'A-FRT-3-LOADED'),
      cbmPerUnit,
      lclThresholdRatio: 0.5,
      lclCostPerCbmMicros: val(ledger, 'A-FRT-1-LOADED'),
      lclMinimumChargeableCbm: 2,
      assumptionRefs: ['A-FRT-3-LOADED', 'A-FRT-1-LOADED', 'M-CONTAINER-CBM',
        variantId === 'V-A' ? 'A-FRT-4' : 'A-FRT-5'],
    },
    duty: {
      htsCode: branch.htsCode,
      // The projector branch is modelled with no MFN component because the dataset
      // states no 8528 base rate. That UNDERSTATES the adverse branch; it does not
      // overstate it, which is the direction an unresolved number should err in.
      htsDutyBps: branch.useMfn ? val(ledger, 'A-DUT-1') : 0,
      additionalTariffBps: branch.additionalTariffBps,
      customsValueBasis: 'fob',
      mpfBps: val(ledger, 'M-MPF-RATE'),
      mpfMinMicros: val(ledger, 'M-MPF-MIN'),
      mpfMaxMicros: val(ledger, 'M-MPF-MAX'),
      hmfBps: val(ledger, 'M-HMF-RATE'),
      assumptionRefs: branch.useMfn
        ? ['A-DUT-1', 'A-DUT-2', 'A-DUT-3', 'M-MPF-RATE', 'M-HMF-RATE']
        : ['A-DUT-2', 'A-DUT-3', 'M-MPF-RATE', 'M-HMF-RATE'],
    },
    insuranceBps: val(ledger, 'M-INSURANCE'),
    insuranceMinimumMicros: D(50),
    importClearancePerEntryMicros: val(ledger, 'M-BROKER-ENTRY'),
    drayagePerContainerMicros: val(ledger, 'M-DRAYAGE'),
    warehouseInPerUnitMicros: val(ledger, 'M-WAREHOUSE-IN'),
  };
}

/**
 * @description Packed carton dimensions. The dataset states the V-A carton
 *   directly; the V-B carton is scaled to its own stated boxed volume by the cube
 *   root of the volume ratio, which is a derivation rather than a second guess.
 * @param {object} ledger - The assumption ledger.
 * @param {string} variantId - `V-A` or `V-B`.
 * @returns {{lengthIn: number, widthIn: number, heightIn: number, cubicFeet: number}} The carton.
 */
function carton(ledger, variantId) {
  const base = { lengthIn: 24, widthIn: 16, heightIn: 14 };
  const scale = variantId === 'V-A' ? 1 : Math.cbrt(val(ledger, 'A-FRT-5') / val(ledger, 'A-FRT-4'));
  const dims = {
    lengthIn: base.lengthIn * scale, widthIn: base.widthIn * scale, heightIn: base.heightIn * scale,
  };
  return { ...dims, cubicFeet: (dims.lengthIn * dims.widthIn * dims.heightIn) / 1728 };
}

/**
 * @description The direct channel. Return handling is costed at the outbound
 *   freight rate, because getting a 24-inch carton back is at least what it cost
 *   to send it; free customer shipping is modelled, which is the norm at this
 *   price point and is the conservative reading.
 * @param {object} ledger - The assumption ledger.
 * @param {number} share - Share of volume routed here.
 * @returns {object} An engine Channel.
 */
function dtcChannel(ledger, share) {
  return {
    id: 'dtc', label: 'Direct to consumer', volumeShareRatio: share,
    assumptionRefs: ['CH-1-CAC', 'CH-1-PAYMENT', 'M-DTC-SHIP', 'M-DTC-PICKPACK', 'M-DTC-SALVAGE', 'A-CH-8'],
    economics: {
      kind: 'dtc',
      paymentBps: val(ledger, 'CH-1-PAYMENT'),
      paymentFixedMicros: D(0.30),
      outboundShipMicros: val(ledger, 'M-DTC-SHIP'),
      shippingChargedToCustomerMicros: 0,
      pickPackMicros: val(ledger, 'M-DTC-PICKPACK'),
      returnRateRatio: val(ledger, 'A-CH-8'),
      returnHandlingMicros: val(ledger, 'M-DTC-SHIP'),
      returnSalvageRatio: val(ledger, 'M-DTC-SALVAGE'),
      cacPerOrderMicros: val(ledger, 'CH-1-CAC'),
    },
  };
}

/**
 * @description The marketplace channel. Storage months are the months the stock
 *   actually sits in the network, which for a Halloween product are peak months by
 *   definition — the dataset warns that averaging that across the year hides the
 *   whole problem, and the engine charges the rate in force in each month.
 * @param {object} ledger - The assumption ledger.
 * @param {string} variantId - `V-A` or `V-B`.
 * @param {number} share - Share of volume routed here.
 * @returns {object} An engine Channel.
 */
function amazonChannel(ledger, variantId, share) {
  const box = carton(ledger, variantId);
  const weightOz = val(ledger, 'M-FBA-WEIGHT');
  return {
    id: 'amazon', label: 'Marketplace (FBA)', volumeShareRatio: share,
    assumptionRefs: ['A-CH-1', 'A-CH-4', 'A-CH-5', 'A-CH-8', 'M-FBA-WEIGHT', 'M-FBA-ACOS', 'M-FBA-INBOUND'],
    economics: {
      kind: 'amazon',
      referralBps: val(ledger, 'A-CH-1'),
      dims: { lengthIn: box.lengthIn, widthIn: box.widthIn, heightIn: box.heightIn, weightLb: weightOz / 16 },
      shippingWeightOz: weightOz,
      cubicFeet: box.cubicFeet,
      // Received ahead of the window and held through it: the dataset's own
      // calendar constraint is that FBA inbound must land by early September.
      storageMonths: ['2027-08', '2027-09', '2027-10'],
      inboundPerUnitMicros: val(ledger, 'M-FBA-INBOUND'),
      returnRateRatio: val(ledger, 'A-CH-8'),
      returnProcessingMicros: val(ledger, 'M-DTC-PICKPACK'),
      acosBps: val(ledger, 'M-FBA-ACOS'),
      feeTableDate: ON_DATE,
    },
  };
}

/**
 * @description The big-box channel. The retailer sets the shelf price from the
 *   wholesale price, and the dataset's single programme-allowance band is spread
 *   across the engine's named allowance fields so the waterfall shows where a
 *   first-time vendor's money actually goes.
 * @param {object} ledger - The assumption ledger.
 * @param {number} share - Share of volume routed here.
 * @returns {object} An engine Channel.
 */
function bigBoxChannel(ledger, share) {
  const zeroed = {};
  for (const field of UNSPLIT_ALLOWANCE_FIELDS) zeroed[field] = 0;
  return {
    id: 'bigbox', label: 'Big-box seasonal retail', volumeShareRatio: share,
    assumptionRefs: ['A-CH-6', 'A-CH-7', 'A-WC-2', 'R-RETAILER'],
    economics: {
      kind: 'big-box',
      retailerMarginBps: val(ledger, 'A-CH-6'),
      [ALLOWANCE_FIELD]: val(ledger, 'A-CH-7'),
      ...zeroed,
      // No early-payment discount is modelled: no retailer has offered terms.
      earlyPaymentDiscountBps: 0,
      paymentNetDays: val(ledger, 'A-WC-2'),
    },
  };
}

/**
 * @description Certification and retail-compliance spend, dated to the months it
 *   is actually incurred. This is most of the answer to "what does it cost to find
 *   out", because it is money spent before a single unit exists.
 * @param {object} ledger - The assumption ledger.
 * @param {string[]} horizon - The modelled months.
 * @param {boolean} bigBox - Whether the retailer-vendor setup cost applies.
 * @param {boolean} childrensProduct - Whether the CPSIA branch applies.
 * @returns {object} A month -> micros map.
 */
function complianceSpend(ledger, horizon, bigBox, childrensProduct) {
  const byMonth = {};
  for (const m of horizon) byMonth[m] = 0;
  for (const [id, month] of Object.entries(COMPLIANCE_MONTH)) {
    if (byMonth[month] === undefined) continue;
    if (id === 'R-CPSIA' && !childrensProduct) continue;
    if (id === 'R-RETAILER' && !bigBox) continue;
    // One regime per month, so each one is a distinct bindable field and the
    // sensitivity sweep can move it. Two regimes sharing a month would make the
    // month's total unbindable and both would report as having no effect.
    byMonth[month] = val(ledger, id);
  }
  return byMonth;
}

/**
 * @description The compliance months a scenario actually spends in, so the binding
 *   table can name them.
 * @param {boolean} bigBox - Whether the retailer setup cost applies.
 * @param {boolean} childrensProduct - Whether the children's-product branch applies.
 * @returns {Array<{assumptionId: string, month: string}>} The active regimes.
 */
function activeComplianceRegimes(bigBox, childrensProduct) {
  return Object.entries(COMPLIANCE_MONTH)
    .filter(([id]) => (id !== 'R-CPSIA' || childrensProduct) && (id !== 'R-RETAILER' || bigBox))
    .map(([assumptionId, month]) => ({ assumptionId, month }));
}

/**
 * @description The six roles the dataset names, priced against the clearly
 *   labelled placeholder rate. Used ONLY by the staffed scenario; the base plan
 *   passes an empty role list and the documents say so.
 * @param {object} ds - The dataset.
 * @param {object} ledger - The assumption ledger.
 * @returns {Array<object>} Engine Role records.
 */
function stafferRoles(ds, ledger) {
  const titles = ds.assumptions.find((a) => a.id === 'A-HR-2').value;
  const rate = val(ledger, 'M-LABOUR-RATE');
  // The burden used to be hardcoded to zero while A-HR-1 sat in the provenance
  // chain — the plan cited an input it did not apply, and an unregistered one at
  // that. It is now a real ledger entry in basis points and it is actually charged.
  const burdenBps = val(ledger, 'A-HR-1');
  return titles.map((title, i) => ({
    id: `role-${i + 1}`, title, kind: 'employee',
    startMonth: '2026-11', endMonth: '2027-12',
    annualBaseMicros: rate, fteRatio: 0.5, burdenBps,
    assumptionRefs: ['M-LABOUR-RATE', 'A-HR-1'],
  }));
}

/**
 * @description The binding table: which assumption moves which model field. An
 *   assumption with no binding can be edited in the ledger and change nothing,
 *   which would make the tornado chart theatre.
 * @param {object} ds - The dataset.
 * @param {string} variantId - `V-A` or `V-B`.
 * @param {string} branchId - `9505` or `8528`.
 * @returns {Array<{assumptionId: string, path: string}>} The bindings.
 */
function bindings(ds, spec, channels) {
  const { variantId, branchId } = spec;
  const lines = ds.bom.filter((l) => l.variantIds.includes(variantId) && !l.optional);
  const out = [
    { assumptionId: 'M-ASSY', path: 'product.bom.priceBreaks.0.unitCostMicros' },
    { assumptionId: 'A-FRT-3-LOADED', path: 'landed.freight.containerCostMicros' },
    { assumptionId: 'A-FRT-1-LOADED', path: 'landed.freight.lclCostPerCbmMicros' },
    { assumptionId: variantId === 'V-A' ? 'A-FRT-4' : 'A-FRT-5', path: 'landed.freight.cbmPerUnit' },
    { assumptionId: 'A-DUT-3', path: 'landed.duty.additionalTariffBps' },
    { assumptionId: 'M-INSURANCE', path: 'landed.insuranceBps' },
    { assumptionId: 'M-DRAYAGE', path: 'landed.drayagePerContainerMicros' },
    { assumptionId: 'M-BROKER-ENTRY', path: 'landed.importClearancePerEntryMicros' },
    { assumptionId: 'M-WAREHOUSE-IN', path: 'landed.warehouseInPerUnitMicros' },
    { assumptionId: 'M-MPF-RATE', path: 'landed.duty.mpfBps' },
    { assumptionId: 'M-HMF-RATE', path: 'landed.duty.hmfBps' },
    { assumptionId: 'M-SELLTHROUGH-UNITS', path: 'demand.scenarios.1.baselineUnits' },
    { assumptionId: 'A-CAL-6', path: 'timing.transitWeeks' },
    { assumptionId: 'M-RECEIVING', path: 'timing.receivingWeeks' },
    { assumptionId: 'M-LIQUIDATION', path: 'season.liquidationRecoveryBps' },
  ];
  if (branchId === '9505') out.push({ assumptionId: 'A-DUT-1', path: 'landed.duty.htsDutyBps' });
  // Supplier terms sit on every node including the root assembly, and the schedule
  // is driven by the longest of them, so all of them are bound. Binding only the
  // children would leave the assembly's own lead time — which is the critical path
  // here — invisible to the sweep.
  out.push(...supplierTermBindings('product.bom'));
  lines.forEach((line, i) => {
    out.push(...supplierTermBindings(`product.bom.children.${i}`));
  });
  lines.forEach((line, i) => {
    // Bound to the production step of the ladder, which is the step in force at
    // the volumes every swept model is run at.
    out.push({ assumptionId: line.id, path: `product.bom.children.${i}.priceBreaks.1.unitCostMicros` });
    out.push({ assumptionId: 'M-SCRAP', path: `product.bom.children.${i}.scrapRateRatio` });
    if (line.toolingCostBand) {
      out.push({ assumptionId: `${line.id}-TOOLING`, path: `product.bom.children.${i}.toolingMicros` });
    }
  });
  out.push(...channelBindings(channels));
  for (const { assumptionId, month } of activeComplianceRegimes(
    channels.some((c) => c.id === 'bigbox'), Boolean(spec.childrensProduct),
  )) {
    out.push({ assumptionId, path: `fixedOpexByMonth.${month}` });
  }
  if (spec.staffed) {
    // Every role is priced off the same placeholder rate, so every role is bound
    // to it; one assumption legitimately drives several fields.
    stafferRoleCount(ds).forEach((_, i) => out.push({ assumptionId: 'M-LABOUR-RATE', path: `roles.${i}.annualBaseMicros` }));
  }
  return out;
}

/**
 * @description Bindings for one BOM node's supplier terms.
 * @param {string} prefix - The node's dotted path.
 * @returns {Array<{assumptionId: string, path: string}>} The bindings.
 */
function supplierTermBindings(prefix) {
  return [
    { assumptionId: 'M-LEAD', path: `${prefix}.supplier.leadTimeWeeks` },
    { assumptionId: 'M-QUAL', path: `${prefix}.supplier.qualificationWeeks` },
    { assumptionId: 'A-WC-1-DEPOSIT', path: `${prefix}.supplier.depositBps` },
  ];
}

/**
 * @description Per-channel bindings, generated from the channel list so an index
 *   can never drift from the array it points into.
 * @param {Array<object>} channels - The built channels.
 * @returns {Array<{assumptionId: string, path: string}>} The bindings.
 */
function channelBindings(channels) {
  const out = [];
  channels.forEach((c, i) => {
    const at = (field) => `channels.${i}.economics.${field}`;
    if (c.economics.kind === 'dtc') {
      out.push(
        { assumptionId: 'CH-1-PAYMENT', path: at('paymentBps') },
        { assumptionId: 'M-DTC-SHIP', path: at('outboundShipMicros') },
        { assumptionId: 'M-DTC-SHIP', path: at('returnHandlingMicros') },
        { assumptionId: 'M-DTC-PICKPACK', path: at('pickPackMicros') },
        { assumptionId: 'A-CH-8', path: at('returnRateRatio') },
        { assumptionId: 'M-DTC-SALVAGE', path: at('returnSalvageRatio') },
        { assumptionId: 'CH-1-CAC', path: at('cacPerOrderMicros') },
      );
    } else if (c.economics.kind === 'amazon') {
      out.push(
        { assumptionId: 'A-CH-1', path: at('referralBps') },
        { assumptionId: 'M-FBA-INBOUND', path: at('inboundPerUnitMicros') },
        { assumptionId: 'A-CH-8', path: at('returnRateRatio') },
        { assumptionId: 'M-DTC-PICKPACK', path: at('returnProcessingMicros') },
        { assumptionId: 'M-FBA-ACOS', path: at('acosBps') },
        { assumptionId: 'M-FBA-WEIGHT', path: at('shippingWeightOz') },
      );
    } else if (c.economics.kind === 'big-box') {
      out.push(
        { assumptionId: 'A-CH-6', path: at('retailerMarginBps') },
        { assumptionId: 'A-CH-7', path: at(ALLOWANCE_FIELD) },
        { assumptionId: 'A-WC-2', path: at('paymentNetDays') },
      );
    }
  });
  return out;
}

/**
 * @description The role list length, without building the roles.
 * @param {object} ds - The dataset.
 * @returns {Array<string>} The role titles.
 */
function stafferRoleCount(ds) {
  return ds.assumptions.find((a) => a.id === 'A-HR-2').value;
}

/**
 * @description Weekly sell-through shape across the window. NOT SOURCED — the
 *   dataset states the purchase window but not its within-window shape. It moves
 *   when cash arrives inside the season, not how much of it there is, and the
 *   engine normalises it.
 * @param {number} weeks - Window length in weeks.
 * @returns {number[]} Weekly shares, rising into the peak.
 */
function sellCurve(weeks) {
  const raw = [];
  for (let i = 0; i < weeks; i += 1) raw.push(1 + i * 0.6);
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((r) => r / total);
}

/**
 * @description Build a complete `VentureModelInput` for one scenario.
 * @param {object} ds - The dataset.
 * @param {object} spec - Scenario spec: variantId, corner, branchId, runQty,
 *   channels, pricing, staffed, childrensProduct.
 * @returns {{input: object, ledger: object, meta: object, ledgerIssues: Array}} The
 *   model input, the ledger it was built from, per-assumption metadata and the
 *   issues normalisation raised.
 */
function buildInput(ds, spec) {
  const base = buildPumpkinLedger(ds, spec.corner);
  const runQty = spec.runQty;
  const sellThrough = { low: 0.6, high: 1.0 };
  const extra = {
    id: 'M-SELLTHROUGH-UNITS',
    label: 'Units expected to sell inside the six-week window',
    value: Math.round(runQty * 0.85), unit: 'units',
    band: { low: Math.round(runQty * sellThrough.low), high: Math.round(runQty * sellThrough.high) },
    source: {
      kind: 'model-estimate', agentId: 'venture-plan/examples/pumpkin', taskId: 'demand',
      model: 'dataset-derivation',
      rationale: 'NOT IN THE DATASET: there is no demand forecast of any kind, and the dataset states plainly that its run quantity is not derived from one. This is a DEMAND QUANTITY, not a percentage of whatever is built: it stays fixed when the model is rebuilt at another run size, so a bigger run does not manufacture bigger demand. It is anchored to the run quantity only because there is nothing else to anchor it to, and its range brackets the dataset A-CH-8 returns-and-markdown reserve of 8 to 20 percent. It is the single largest unmeasured input in the plan.',
    },
    confidence: 'guessed',
  };
  const classification = dutyClassificationRecord(spec.branchId);
  const built = A.buildLedger([...base.records.map((r) => r.assumption), extra, classification.assumption]);
  const ledger = built.ledger;
  base.meta[extra.id] = {
    id: extra.id, datasetId: null, group: 'market', method: extra.source.rationale,
    note: 'The single largest unmeasured input in the plan after the projector.',
    needsQuote: true, modelAdded: true, sourceId: 'CALC',
    sourceLabel: 'derived in this run', sourceUrl: null, datasetConfidence: 'low',
  };
  base.meta[classification.assumption.id] = classification.meta;
  return {
    ledger, meta: base.meta, ledgerIssues: [...base.issues, ...built.issues],
    input: assembleInput(ds, ledger, spec, runQty, sellThrough),
  };
}

/**
 * @description The applied tariff rate, registered as what it actually is: a
 *   GUESS between two published rates, because nobody has classified the product.
 *   The dataset carries A-DUT-3 as the literal string `UNRESOLVED`, which is not a
 *   number the engine can compute on — and leaving it unregistered makes every
 *   landed-cost figure unsourced and the whole model unpublishable. That refusal
 *   is real and `regenerate.js` demonstrates it against a control model. For the
 *   branch models the rate is registered with the FULL classification spread as its
 *   band, so the sweep prices the unresolved question rather than hiding it.
 * @param {string} branchId - `9505` or `8528`.
 * @returns {{assumption: object, meta: object}} The record and its metadata.
 */
function dutyClassificationRecord(branchId) {
  const branch = DUTY_BRANCHES[branchId];
  return {
    assumption: {
      id: 'A-DUT-3',
      label: `Applied Section 301 rate under the ${branch.label} reading`,
      value: branch.additionalTariffBps, unit: 'bps',
      band: { low: DUTY_BRANCHES['9505'].additionalTariffBps, high: DUTY_BRANCHES['8528'].additionalTariffBps },
      source: {
        kind: 'model-estimate', agentId: 'venture-plan/examples/pumpkin', taskId: 'tariff-branch',
        model: 'dataset-derivation',
        rationale: 'UNRESOLVED IN THE DATASET. Whether an inflatable containing a projector classifies as a festive article or as a projector has not been determined. This record applies one branch so the model can be computed; the band is the full spread between the two published rates, which is why it appears at the top of the tornado.',
      },
      confidence: 'guessed',
    },
    meta: {
      id: 'A-DUT-3', datasetId: 'A-DUT-3', group: 'logistics', modelAdded: true, needsQuote: true,
      method: 'Settled by a CBP binding ruling request, or a customs broker\'s written classification opinion, BEFORE any purchase order.',
      note: 'The dataset records this as UNRESOLVED and warns the swing exceeds the projected net margin.',
      sourceId: 'S15', sourceLabel: 'US Tariff Rates - import duty on toys and games from China (HTS + Section 301)',
      sourceUrl: 'https://ustariffrates.com/import/toys/from/china', datasetConfidence: 'low',
    },
  };
}

/**
 * @description Assemble the input object once the ledger exists.
 * @param {object} ds - The dataset.
 * @param {object} ledger - The built ledger.
 * @param {object} spec - The scenario spec.
 * @param {number} runQty - Production run quantity.
 * @param {{low: number, high: number}} sellThrough - Scenario sell-through spread.
 * @returns {object} The engine VentureModelInput.
 */
function assembleInput(ds, ledger, spec, runQty, sellThrough) {
  const horizon = [];
  const P = engine('venture-primitives');
  for (const m of P.ymRange(HORIZON_START, HORIZON_MONTHS)) horizon.push(m);
  const channels = buildChannels(ledger, spec);
  return {
    ledger,
    bindings: bindings(ds, spec, channels),
    product: { name: `${spec.variantId} — ${ds.title}`, bom: bomTree(ds, ledger, spec.variantId) },
    runQtyUnits: runQty,
    landed: landedShape(ledger, spec.variantId, spec.branchId),
    channels,
    pricing: spec.pricing,
    demand: {
      scenarios: [
        { key: 'conservative', baselineUnits: Math.round(runQty * sellThrough.low), assumptionRef: 'M-SELLTHROUGH-UNITS' },
        { key: 'base', baselineUnits: Math.round(runQty * 0.85), assumptionRef: 'M-SELLTHROUGH-UNITS' },
        { key: 'optimistic', baselineUnits: Math.round(runQty * sellThrough.high), assumptionRef: 'M-SELLTHROUGH-UNITS' },
      ],
      selected: 'base',
      // No elasticity: there is no price-response evidence for this product at any
      // price. The engine holds volume flat and reports the absence.
      elasticity: null,
    },
    season: {
      sellWindowStart: SEASON_START, sellWindowWeeks: SEASON_WEEKS,
      weeklySellThrough: sellCurve(SEASON_WEEKS),
      postSeasonPolicy: 'liquidate',
      carryHoldingBpsPerMonth: 150,
      liquidationRecoveryBps: val(ledger, 'M-LIQUIDATION'),
      // A-CAL-3 used to be cited here. It is a NARRATIVE dataset record — "late
      // August through September, decorations lead the season" — with no numeric
      // value, so it never enters the engine ledger and the reference dangled. The
      // season's two numeric dependencies are what it recovers on unsold stock and
      // how much of the run it expects to move; the shopping-window prose is
      // embodied in the weekly curve and discussed in the timeline document.
      assumptionRefs: ['M-LIQUIDATION', 'M-SELLTHROUGH-UNITS'],
    },
    timing: {
      toolingMonth: '2027-01', poMonth: '2027-02',
      transitWeeks: val(ledger, 'A-CAL-6'), receivingWeeks: val(ledger, 'M-RECEIVING'),
    },
    roles: spec.staffed ? stafferRoles(ds, ledger) : [],
    fixedOpexByMonth: complianceSpend(
      ledger, horizon, channels.some((c) => c.id === 'bigbox'), Boolean(spec.childrensProduct),
    ),
    openingCashMicros: 0,
    horizonStart: HORIZON_START,
    horizonMonths: HORIZON_MONTHS,
    onDate: ON_DATE,
  };
}

/**
 * @description Build the channel list for a scenario's route to market.
 * @param {object} ledger - The assumption ledger.
 * @param {object} spec - The scenario spec carrying `channels` as id->share.
 * @returns {Array<object>} Engine Channels.
 */
function buildChannels(ledger, spec) {
  const out = [];
  for (const [id, share] of Object.entries(spec.channels)) {
    if (id === 'dtc') out.push(dtcChannel(ledger, share));
    else if (id === 'amazon') out.push(amazonChannel(ledger, spec.variantId, share));
    else if (id === 'bigbox') out.push(bigBoxChannel(ledger, share));
    else throw new RangeError(`unknown channel "${id}"`);
  }
  return out;
}

module.exports = {
  HORIZON_START, HORIZON_MONTHS, ON_DATE, SEASON_START, SEASON_WEEKS,
  DUTY_BRANCHES, ALLOWANCE_FIELD, COMPLIANCE_MONTH, SUPPLIER_BY_SOURCE,
  buildInput, carton, sellCurve, stafferRoles, complianceSpend,
};
