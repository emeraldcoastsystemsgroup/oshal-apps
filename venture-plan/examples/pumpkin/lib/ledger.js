/**
 * Dataset -> engine assumption ledger for the pumpkin venture.
 *
 * THIS MODULE IS THE HONESTY BOUNDARY OF THE WHOLE EXAMPLE. The dataset in
 * `ventures/pumpkin-projection-prop.json` is a researched but entirely UNQUOTED
 * body of evidence; the engine refuses to compute on anything that is not a
 * registered `Assumption`. Everything that crosses from one to the other crosses
 * here, and it crosses carrying its source.
 *
 * THREE RULES ARE ENFORCED MECHANICALLY RATHER THAN PROMISED:
 *
 *   1. A dataset record sourced to `CALC` — a number the compiling model derived
 *      or estimated rather than observed — becomes an engine `model-estimate`.
 *      `normalizeAssumption` then hard-caps it at confidence `estimated`, so no
 *      number in this venture can present itself as quoted. NOTHING here is a
 *      vendor quote, because no vendor has been contacted.
 *
 *   2. Anything the engine needs that the dataset does NOT contain is minted with
 *      the `M-` prefix, a rationale beginning `NOT IN THE DATASET`, and a band, so
 *      it is visibly an addition of this run and the sensitivity sweep measures
 *      what it is worth. Nothing is silently defaulted.
 *
 *   3. `needsQuote` travels with the record. The dataset says the share of landed
 *      cost still resting on needs-quote lines "is the honest confidence in the
 *      whole plan", so that share is computed from these flags rather than stated.
 *
 * The `corner` parameter is what makes the low/mid/high band real end to end: the
 * documents run the whole model at each corner instead of collapsing a 2.85x-wide
 * cost band to a single reassuring midpoint.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — dataset source/confidence mapping onto engine AssumptionSource, corner-aware band resolution, the model-added register, and the needs-quote provenance carried through to the landed-cost share.
 * 2 | roger.murphy@emeraldcoastsystemsgroup.com   | The harbour maintenance fee was registered at 125 bps — ten times the statutory 0.125% — and, carrying no band by design, it was invisible to the sensitivity sweep that would otherwise have surfaced it. Corrected to 12.5 bps and added a plausible-range assertion on every statutory rate, because a decimal slip in a rate is invisible: 125 and 12.5 both look like a fee and both compute.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { engine } = require('./format');

const A = engine('venture-assumptions');
const P = engine('venture-primitives');

/** Micro-dollars per dollar; the engine's money unit. */
const D = (dollars) => Math.round(dollars * 1_000_000);
/** Basis points from a fraction: 0.075 -> 750. */
const BPS = (fraction) => Math.round(fraction * 10_000);

/** The dataset this example is generated from. */
const DATASET_PATH = path.resolve(__dirname, '..', '..', '..', 'ventures', 'pumpkin-projection-prop.json');

/** Identifies this generation run inside every model-estimate source record. */
const RUN_AGENT = 'venture-plan/examples/pumpkin';

/**
 * @description Load the venture dataset from disk.
 * @returns {object} The parsed dataset.
 */
function loadDataset() {
  return JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));
}

/**
 * @description Resolve a low/high band at a corner. This is the function that
 *   keeps the band honest: `mid` is the arithmetic midpoint and is labelled as
 *   such everywhere, never presented as a researched value.
 * @param {{low: number, high: number}} band - The dataset band.
 * @param {'low'|'mid'|'high'} corner - Which corner to take.
 * @returns {number} The value at that corner.
 */
function atCorner(band, corner) {
  if (corner === 'low') return band.low;
  if (corner === 'high') return band.high;
  return (band.low + band.high) / 2;
}

/**
 * @description Read a dataset record's scalar at a corner, whether it carries a
 *   point `value` or a `band`.
 * @param {object} rec - A dataset assumption record.
 * @param {'low'|'mid'|'high'} corner - Which corner to take.
 * @returns {number|null} The scalar, or null when the record is narrative.
 */
function scalarAt(rec, corner) {
  if (rec.band) return atCorner(rec.band, corner);
  return typeof rec.value === 'number' ? rec.value : null;
}

/**
 * @description Map a dataset source id onto an engine `AssumptionSource`. A cited
 *   URL becomes a `published-rate`; a first-party code inspection becomes an
 *   `operator-input`; `CALC` — the dataset's own derivations and estimates —
 *   becomes a `model-estimate`, which the engine then caps at `estimated`.
 * @param {object} ds - The dataset (for its source table).
 * @param {string} sourceId - The dataset source id.
 * @param {string} rationale - Why this number is what it is.
 * @returns {object} An engine AssumptionSource.
 */
function sourceFor(ds, sourceId, rationale) {
  const s = ds.sources[sourceId];
  if (sourceId === 'CALC' || !s) {
    return { kind: 'model-estimate', agentId: RUN_AGENT, taskId: `dataset:${sourceId}`, model: 'dataset-derivation', rationale };
  }
  if (sourceId === 'REPO') {
    return { kind: 'operator-input', enteredBy: ds.provenance.compiledBy, enteredAt: s.retrievedAt, note: rationale };
  }
  return { kind: 'published-rate', publication: s.label, url: s.url, retrievedAt: s.retrievedAt };
}

/**
 * @description Map the dataset's three-level confidence onto the engine's
 *   five-level scale. Nothing maps to `quoted`: the dataset's posture block states
 *   that no supplier has been contacted, so no record in this venture is entitled
 *   to the strongest grade. A low-confidence record with no evidence behind it and
 *   a needs-quote flag becomes `guessed`, which is what puts it on the soft-money
 *   list the documents report.
 * @param {string} sourceId - The dataset source id.
 * @param {string} confidence - The dataset confidence, `high`|`medium`|`low`.
 * @param {boolean} needsQuote - Whether the dataset flags it as needing a quote.
 * @param {string} kind - The dataset source `kind`.
 * @returns {string} An engine Confidence.
 */
function confidenceFor(sourceId, confidence, needsQuote, kind) {
  if (sourceId === 'CALC' && confidence === 'low' && needsQuote) return 'guessed';
  if (confidence === 'low') return 'estimated';
  if (confidence === 'high' && (kind === 'retail-listing' || kind === 'first-party-inspection')) return 'observed';
  return 'benchmarked';
}

/**
 * @description Build one engine assumption plus the metadata the assumption
 *   register prints beside it.
 * @param {object} args - Assembly arguments.
 * @returns {{assumption: object, meta: object}} The engine record and its metadata.
 */
function record(args) {
  const {
    ds, id, label, value, unit, sourceId, confidence, needsQuote = false,
    band, datasetId = null, group = 'other', method = '', note = '', modelAdded = false,
    overreachesSource: overreach = false,
  } = args;
  const src = ds.sources[sourceId];
  const source = sourceFor(ds, sourceId, method || label);
  const assumption = {
    id, label, value, unit, source,
    confidence: confidenceFor(sourceId, confidence, needsQuote, src ? src.kind : 'computation'),
  };
  if (band && Number.isFinite(band.low) && Number.isFinite(band.high) && band.low <= band.high) {
    assumption.band = { low: band.low, high: band.high };
  }
  return {
    assumption,
    meta: {
      id, datasetId, group, method, note, needsQuote, modelAdded,
      sourceId, sourceLabel: src ? src.label : 'derived in this run',
      sourceUrl: src ? src.url : null, datasetConfidence: confidence,
      overreachesSource: overreach,
    },
  };
}

/** Dataset assumption ids that enter the financial model, with their engine units. */
const MONEY_UNIT = { micros: true };

/**
 * @description Assumptions minted by this run because the engine needs them and
 *   the dataset does not contain them. Every rationale starts `NOT IN THE
 *   DATASET` so the register can list them as a block, and every one carries a
 *   band so the tornado measures what the omission is worth.
 * @param {object} ds - The dataset.
 * @param {'low'|'mid'|'high'} corner - Which corner to take.
 * @returns {Array<{assumption: object, meta: object}>} The minted records.
 */
function modelAdded(ds, corner) {
  const mk = (id, label, band, unit, method, group) => record({
    ds, id, label, unit, group, modelAdded: true, needsQuote: true,
    value: atCorner(band, corner), band, sourceId: 'CALC', confidence: 'low',
    method: `NOT IN THE DATASET: ${method}`,
  });
  return [
    mk('M-ASSY', 'Final assembly and integration charge per unit', { low: 0, high: D(8) }, 'micros',
      'the dataset prices components but carries no assembly, integration or test charge. Modelled at the low corner as zero on the reading that ex-works component bands already include their own labour; the band exists so the sweep can price the omission.', 'manufacturing'),
    mk('M-SCRAP', 'Production scrap and yield loss', { low: 0, high: 0.05 }, 'ratio',
      'no yield figure exists. A real contract-manufacturer quote states one.', 'manufacturing'),
    mk('M-LEAD', 'Component production lead time', { low: 6, high: 14 }, 'weeks',
      'the dataset gives ocean transit and certification lead times but no component production lead time.', 'schedule'),
    mk('M-QUAL', 'Supplier qualification and first-article time', { low: 3, high: 10 }, 'weeks',
      'sampling, first-article and factory-audit time before a production order can be placed.', 'schedule'),
    mk('M-RECEIVING', 'Port-to-shelf receiving and put-away', { low: 1, high: 3 }, 'weeks',
      'drayage, deconsolidation, inland delivery to the distribution centre and put-away. A-CAL-6 now ends at the port of entry, so these weeks are counted once, here.', 'schedule'),
    mk('M-DTC-SHIP', 'Direct outbound shipping per unit', { low: D(9), high: D(28) }, 'micros',
      'a 24x16x14in carton is a dimensional-weight parcel shipment and the dataset carries no parcel rate.', 'channel'),
    mk('M-DTC-PICKPACK', 'Direct pick, pack and packaging per unit', { low: D(1.5), high: D(5) }, 'micros',
      'third-party fulfilment handling. No quote exists.', 'channel'),
    mk('M-DTC-SALVAGE', 'Fraction of a returned unit recovered as resellable stock', { low: 0.3, high: 0.8 }, 'ratio',
      'seasonal returns arrive late in the window with limited resale time.', 'channel'),
    mk('M-FBA-WEIGHT', 'Packed shipping weight', { low: 160, high: 320 }, 'oz',
      'the dataset gives a carton size but no weight. Weight decides the marketplace size tier, which decides two fee lines at once. Recorded in ounces because that is the unit the fulfilment fee table is keyed on.', 'channel'),
    mk('M-FBA-ACOS', 'Marketplace advertising cost of sale', { low: 500, high: 2500 }, 'bps',
      'a new seasonal listing with no rank buys its own traffic. No campaign data exists.', 'channel'),
    mk('M-FBA-INBOUND', 'Marketplace inbound placement per unit', { low: D(0.8), high: D(3) }, 'micros',
      'freight into the fulfilment network plus placement charges.', 'channel'),
    mk('M-LIQUIDATION', 'Fraction of landed cost recovered liquidating unsold stock', { low: 0, high: 3000 }, 'bps',
      'the dataset says unsold seasonal stock has "near-zero residual value after 1 November" but states no recovery rate.', 'finance'),
    mk('M-LABOUR-RATE', 'Blended fully-loaded annual cost of one venture role', { low: D(70000), high: D(160000) }, 'micros',
      'the dataset deliberately refuses to price the six roles it lists and says the operator must supply a rate. This is a placeholder for the staffed scenario ONLY; the base plan runs founder-operated at zero salary.', 'org'),
    mk('M-CONTAINER-CBM', 'Practically loadable volume of a 40ft high-cube container', { low: 60, high: 76 }, 'cbm',
      'a container specification, not a market rate. The range is packing efficiency on a bulky light carton, and it decides how many containers the run needs — which is a step, not a slope.', 'logistics'),
    mk('M-INSURANCE', 'Marine cargo insurance rate on the customs value', { low: 30, high: 60 }, 'bps',
      'no insurance quote exists.', 'logistics'),
    mk('M-BROKER-ENTRY', 'Customs broker entry fee per shipment', { low: D(125), high: D(350) }, 'micros',
      'no broker has quoted. The dataset R-EFILE record covers the eFiling capability requirement but states no entry fee.', 'logistics'),
    mk('M-DRAYAGE', 'Drayage per container, port to distribution centre', { low: D(400), high: D(1200) }, 'micros',
      'no drayage quote exists.', 'logistics'),
    mk('M-WAREHOUSE-IN', 'Receiving and put-away per unit', { low: D(0.5), high: D(2) }, 'micros',
      'no third-party logistics quote exists.', 'logistics'),
    ...statutoryFees(ds),
  ];
}

/**
 * The plausible band each statutory rate must fall inside, as basis points. This
 * table exists because of a real defect: the harbour maintenance fee was registered
 * at 125 bps, ten times the statutory 0.125%, which overstated it by $9,803 on a
 * 5,000-unit run and fed a wrong effective duty rate into every landed-cost figure
 * in the plan. A rate is the one input where a decimal slip is invisible — 125 and
 * 12.5 both look like a fee and both compute — and the record carried no band, so
 * the sensitivity sweep could not surface it either. This is the check that does.
 */
const STATUTORY_RATE_BANDS = {
  'M-MPF-RATE': { min: 1, max: 100 },
  'M-HMF-RATE': { min: 1, max: 100 },
};

/**
 * @description US statutory customs fee rates. Not market estimates and not in the
 *   dataset, so they are registered rather than hardcoded — a reader can see them,
 *   and a stale rate is visible instead of buried in the landed-cost engine. No
 *   band: these are published rates, not uncertain ranges, and sweeping them would
 *   manufacture uncertainty that does not exist. They are RANGE-CHECKED instead,
 *   which is the control a sweep cannot provide for a rate that has no uncertainty
 *   but does have a decimal point.
 * @param {object} ds - The dataset.
 * @returns {Array<{assumption: object, meta: object}>} The records.
 */
function statutoryFees(ds) {
  const mk = (id, label, value, unit, method) => {
    const guard = STATUTORY_RATE_BANDS[id];
    if (guard) P.assertRateBps(value, `${id} (${label})`, guard.min, guard.max);
    return record({
      ds, id, label, value, unit, group: 'logistics', modelAdded: true, needsQuote: true,
      sourceId: 'CALC', confidence: 'medium',
      method: `NOT IN THE DATASET: ${method}`,
    });
  };
  return [
    mk('M-MPF-RATE', 'Merchandise processing fee rate', 35, 'bps',
      'US statutory ad valorem rate on formal entries, 0.3464% rounded to 35 bps. Verify against the current CBP fee schedule before any entry.'),
    mk('M-MPF-MIN', 'Merchandise processing fee, per-entry minimum', D(32.71), 'micros',
      'US statutory per-entry floor. Verify against the current CBP fee schedule.'),
    mk('M-MPF-MAX', 'Merchandise processing fee, per-entry maximum', D(634.62), 'micros',
      'US statutory per-entry ceiling. Verify against the current CBP fee schedule.'),
    mk('M-HMF-RATE', 'Harbour maintenance fee rate', 12.5, 'bps',
      'US statutory rate on ocean arrivals: 0.125% ad valorem, which is 12.5 basis points and NOT 125. Verify against the current CBP fee schedule.'),
  ];
}

/**
 * @description Build the engine ledger for one corner of the dataset's bands.
 * @param {object} ds - The dataset.
 * @param {'low'|'mid'|'high'} corner - Which corner of every band to take.
 * @returns {{ledger: object, meta: object, issues: Array, records: Array}} The
 *   built ledger, per-id metadata, normalisation issues and the raw records.
 */
function buildPumpkinLedger(ds, corner) {
  const records = [
    ...bomRecords(ds, corner),
    ...logisticsRecords(ds, corner),
    ...channelRecords(ds, corner),
    ...scheduleRecords(ds, corner),
    ...orgRecords(ds, corner),
    ...regulatoryRecords(ds, corner),
    ...marketRecords(ds, corner),
    ...modelAdded(ds, corner),
  ];
  const built = A.buildLedger(records.map((r) => r.assumption));
  const meta = {};
  for (const r of records) meta[r.meta.id] = r.meta;
  return { ledger: built.ledger, issues: built.issues, meta, records };
}

/**
 * @description One assumption per BOM line plus the two tooling lines. The
 *   assumption id IS the dataset BOM id, so a figure's `assumptionRefs` names the
 *   physical part it rests on.
 * @param {object} ds - The dataset.
 * @param {'low'|'mid'|'high'} corner - Band corner.
 * @returns {Array<{assumption: object, meta: object}>} The records.
 */
function bomRecords(ds, corner) {
  const out = [];
  for (const line of ds.bom) {
    out.push(record({
      ds, id: line.id, datasetId: line.id, group: 'bom',
      label: `${line.component} — unit cost at ${ds.assumptions.find((a) => a.id === 'A-VOL-1').value} units`,
      value: D(atCorner(line.unitCostBand, corner)), unit: 'micros',
      band: { low: D(line.unitCostBand.low), high: D(line.unitCostBand.high) },
      sourceId: line.sourceId, confidence: line.confidence, needsQuote: Boolean(line.needsQuote),
      method: line.spec, note: line.note || '',
    }));
    if (line.toolingCostBand) {
      out.push(record({
        ds, id: `${line.id}-TOOLING`, datasetId: line.id, group: 'bom',
        label: `${line.component} — tooling / NRE`,
        value: D(atCorner(line.toolingCostBand, corner)), unit: 'micros',
        band: { low: D(line.toolingCostBand.low), high: D(line.toolingCostBand.high) },
        sourceId: line.sourceId, confidence: 'low', needsQuote: true,
        method: line.toolingNote || 'Tooling estimate', note: line.note || '',
      }));
    }
  }
  out.push(...passthrough(ds, corner, 'bom', ['A-VOL-1', 'A-VOL-2'], { 'A-VOL-1': 'units', 'A-VOL-2': 'units' }));
  out.push(record({
    ds, id: 'A-VOL-2-UPLIFT', datasetId: 'A-VOL-2', group: 'bom',
    label: 'Component cost uplift at pilot volume versus the 5,000-unit band',
    value: atCorner({ low: 0.25, high: 0.6 }, corner), unit: 'ratio', band: { low: 0.25, high: 0.6 },
    sourceId: 'CALC', confidence: 'low', needsQuote: true,
    method: 'Stated in the dataset A-VOL-2 note: at 500 units expect component costs 25 to 60 percent above the 5,000-unit band.',
  }));
  return out;
}

/**
 * @description Freight, tariff and customs assumptions.
 * @param {object} ds - The dataset.
 * @param {'low'|'mid'|'high'} corner - Band corner.
 * @returns {Array<{assumption: object, meta: object}>} The records.
 */
function logisticsRecords(ds, corner) {
  const money = { 'A-FRT-1': true, 'A-FRT-3': true };
  const units = {
    'A-FRT-1': 'micros', 'A-FRT-2': 'ratio', 'A-FRT-3': 'micros',
    'A-FRT-4': 'cbm', 'A-FRT-5': 'cbm', 'A-DUT-1': 'bps', 'A-DUT-2': 'bps',
  };
  const out = passthrough(ds, corner, 'logistics', Object.keys(units), units, money);
  // A-DUT-2 is the PUBLISHED Section 301 reference: 7.5% for some subcodes, 25%
  // for others. Which one applies is the unresolved classification question, and
  // that question is carried by A-DUT-3, which is the record the model binds and
  // the sweep moves. Leaving a band on both would put the same uncertainty on the
  // tornado twice and let a reader believe two independent things are uncertain.
  // The same reasoning applies to the raw freight records: A-FRT-1/2/3 are the
  // published inputs to the surcharge-loaded rates the model actually binds, so
  // their ranges live on the loaded records and carrying them twice would put one
  // uncertainty on the tornado twice.
  for (const id of ['A-DUT-2', 'A-FRT-1', 'A-FRT-2', 'A-FRT-3']) {
    const r = out.find((x) => x.assumption.id === id);
    if (r) delete r.assumption.band;
  }
  out.push(...loadedFreightRates(ds, corner));
  return out;
}

/**
 * @description Freight rates with the surcharge stack already applied. The
 *   dataset states the base rate and the surcharge uplift separately, and warns
 *   that a Halloween product ships in the peak-surcharge window; the engine takes
 *   one container rate, so the two are combined HERE, with the formula stated, and
 *   the combined record is what the model binds to. Combining downstream would put
 *   arithmetic somewhere the provenance chain cannot see it.
 * @param {object} ds - The dataset.
 * @param {'low'|'mid'|'high'} corner - Band corner.
 * @returns {Array<{assumption: object, meta: object}>} The records.
 */
function loadedFreightRates(ds, corner) {
  const fcl = ds.assumptions.find((a) => a.id === 'A-FRT-3').band;
  const lcl = ds.assumptions.find((a) => a.id === 'A-FRT-1').band;
  const sur = ds.assumptions.find((a) => a.id === 'A-FRT-2').band;
  // The dataset A-FRT-1 note puts CFS handling at 8 to 15 USD/CBM on top of the
  // base LCL rate; it is a stated component of that record, not a new number.
  const cfs = { low: 8, high: 15 };
  const load = (base, extra) => ({
    low: D((base.low + (extra ? extra.low : 0)) * (1 + sur.low)),
    high: D((base.high + (extra ? extra.high : 0)) * (1 + sur.high)),
  });
  const fclBand = load(fcl, null);
  const lclBand = load(lcl, cfs);
  return [
    record({
      ds, id: 'A-FRT-3-LOADED', datasetId: 'A-FRT-3', group: 'logistics',
      label: 'FCL 40ft rate including the surcharge stack',
      value: atCorner(fclBand, corner), unit: 'micros', band: fclBand,
      sourceId: 'S17', confidence: 'medium', needsQuote: true,
      method: 'A-FRT-3 base rate x (1 + A-FRT-2 surcharge uplift). The dataset states the peak-season surcharge lands exactly when a Halloween product must ship.',
    }),
    record({
      ds, id: 'A-FRT-1-LOADED', datasetId: 'A-FRT-1', group: 'logistics',
      label: 'LCL rate per CBM including CFS handling and the surcharge stack',
      value: atCorner(lclBand, corner), unit: 'micros', band: lclBand,
      sourceId: 'S17', confidence: 'medium', needsQuote: true,
      method: '(A-FRT-1 base rate + CFS handling stated in its note) x (1 + A-FRT-2 surcharge uplift).',
    }),
  ];
}

/**
 * @description Channel fee and allowance assumptions.
 * @param {object} ds - The dataset.
 * @param {'low'|'mid'|'high'} corner - Band corner.
 * @returns {Array<{assumption: object, meta: object}>} The records.
 */
function channelRecords(ds, corner) {
  const units = {
    'A-CH-1': 'bps', 'A-CH-2': 'micros', 'A-CH-3': 'ratio', 'A-CH-4': 'micros',
    'A-CH-5': 'micros', 'A-CH-6': 'bps', 'A-CH-7': 'bps', 'A-CH-8': 'ratio',
  };
  const money = { 'A-CH-2': true, 'A-CH-4': true, 'A-CH-5': true };
  const out = passthrough(ds, corner, 'channel', Object.keys(units), units, money);
  const cac = ds.channels.find((c) => c.id === 'CH-1').customerAcquisitionCost;
  out.push(record({
    ds, id: 'CH-1-CAC', datasetId: 'CH-1', group: 'channel',
    label: 'Direct customer acquisition cost per order',
    value: D(atCorner(cac.band, corner)), unit: 'micros',
    band: { low: D(cac.band.low), high: D(cac.band.high) },
    sourceId: cac.sourceId, confidence: cac.confidence, needsQuote: Boolean(cac.needsQuote),
    method: cac.note,
  }));
  out.push(record({
    ds, id: 'CH-1-PAYMENT', datasetId: 'CH-1', group: 'channel',
    label: 'Direct card payment processing rate',
    value: BPS(ds.channels.find((c) => c.id === 'CH-1').feeModel.paymentProcessing), unit: 'bps',
    sourceId: 'CALC', confidence: 'medium',
    method: 'Stated in the dataset CH-1 feeModel as a standard card rate.',
  }));
  return out;
}

/**
 * @description Calendar and working-capital assumptions.
 * @param {object} ds - The dataset.
 * @param {'low'|'mid'|'high'} corner - Band corner.
 * @returns {Array<{assumption: object, meta: object}>} The records.
 */
function scheduleRecords(ds, corner) {
  const units = { 'A-CAL-1': 'months', 'A-CAL-4': 'weeks', 'A-CAL-5': 'weeks', 'A-CAL-6': 'weeks', 'A-WC-2': 'days' };
  const out = passthrough(ds, corner, 'schedule', Object.keys(units), units);
  // The certification and outreach lead times are reported by the timeline
  // document but are not inputs to any computed figure, so their bands are
  // removed: a swept input that cannot move the model reports a flat bar, and a
  // flat bar reads as "this does not matter" rather than "this is not modelled".
  for (const id of ['A-CAL-1', 'A-CAL-4', 'A-CAL-5']) {
    const r = out.find((x) => x.assumption.id === id);
    if (r) delete r.assumption.band;
  }
  out.push(record({
    ds, id: 'A-WC-1-DEPOSIT', datasetId: 'A-WC-1', group: 'schedule',
    label: 'Supplier deposit taken at order',
    value: 3000, unit: 'bps', sourceId: 'CALC', confidence: 'medium', needsQuote: true,
    method: 'Stated in the dataset A-WC-1: 30 percent deposit on order, 70 percent on bill of lading, no net terms for a new buyer.',
  }));
  return out;
}

/**
 * @description The employer-burden rate the staffed scenario prices roles at.
 *
 *   REGISTERED BECAUSE IT WAS BEING CITED AND NEVER RECORDED. The staffed roles
 *   named `A-HR-1` in their provenance chain while the dataset record — a 1.25-1.4x
 *   multiplier over base salary — was never converted into an engine assumption,
 *   and the roles carried a burden of zero. So the staffed plan understated its own
 *   payroll AND pointed at an input that did not exist. The dataset states a
 *   multiplier; the engine works in basis points of base salary, which is
 *   `(multiplier - 1) x 10,000`.
 *
 *   Plan altitude only: the payroll application in this same store computes the
 *   real employer cost from real wage bases, and this never pretends to.
 * @param {object} ds - The dataset.
 * @param {'low'|'mid'|'high'} corner - Band corner.
 * @returns {Array<{assumption: object, meta: object}>} The records.
 */
function orgRecords(ds, corner) {
  const rec = ds.assumptions.find((a) => a.id === 'A-HR-1');
  if (!rec || !rec.band) return [];
  const toBps = (multiplier) => Math.round((multiplier - 1) * 10_000);
  const band = { low: toBps(rec.band.low), high: toBps(rec.band.high) };
  return [record({
    ds, id: 'A-HR-1', datasetId: 'A-HR-1', group: 'org',
    label: `${rec.label}, expressed as basis points of base salary`,
    value: toBps(atCorner(rec.band, corner)), unit: 'bps', band,
    sourceId: rec.sourceId, confidence: rec.confidence, needsQuote: true,
    method: `${rec.method} Converted from the dataset's multiplier: (multiplier - 1) x 10,000 bps.`,
  })];
}

/**
 * @description Certification and retail-compliance cost assumptions. These are the
 *   spend that happens BEFORE a single unit ships, which is most of the answer to
 *   "what does it cost to find out if this works".
 * @param {object} ds - The dataset.
 * @param {'low'|'mid'|'high'} corner - Band corner.
 * @returns {Array<{assumption: object, meta: object}>} The records.
 */
function regulatoryRecords(ds, corner) {
  return ds.regulatory.map((r) => {
    const band = r.costBand || r.costBandIfApplies;
    return record({
      ds, id: r.id, datasetId: r.id, group: 'compliance',
      label: `${r.regime} — cost`,
      value: D(atCorner(band, corner)), unit: 'micros',
      band: { low: D(band.low), high: D(band.high) },
      sourceId: r.sourceId, confidence: r.confidence, needsQuote: Boolean(r.needsQuote),
      method: r.costNote || r.basis, note: r.applies,
    });
  });
}

/**
 * @description Look up one of a competitor's observed price points by its stable
 *   ROLE rather than by array position. Index lookups broke the moment a second
 *   retail surface was recorded for the same kit: the digital-download comparable
 *   silently repointed at a $229.99 projector bundle.
 * @param {object} competitor - A dataset competitor record.
 * @param {string} role - The point's role, e.g. `content-only`.
 * @returns {object} The price comparison point.
 */
function point(competitor, role) {
  const found = (competitor.priceComparisonPoints || []).find((p) => p.role === role);
  if (!found) throw new RangeError(`${competitor.id} has no price comparison point with role "${role}"`);
  return found;
}

/**
 * @description Observed retail price points. These are the only records in the
 *   whole ledger backed by something anyone can go and look at today, which is
 *   why they are the ceilings every cost-up price is compared against.
 * @param {object} ds - The dataset.
 * @param {'low'|'mid'|'high'} corner - Band corner.
 * @returns {Array<{assumption: object, meta: object}>} The records.
 */
function marketRecords(ds, corner) {
  const bigBox = ds.channels.find((c) => c.id === 'CH-3');
  const animatronics = bigBox.observedPricePoints[0];
  const inflatables = bigBox.observedPricePoints[1];
  const gemmy = ds.competitors.find((c) => c.id === 'C-1');
  const atmos = ds.competitors.find((c) => c.id === 'C-2');
  const mk = (id, label, dollars, sourceId, method, band) => record({
    ds, id, group: 'market', label, value: D(dollars), unit: 'micros',
    band: band ? { low: D(band.low), high: D(band.high) } : undefined,
    sourceId, confidence: 'high', method,
  });
  return [
    mk('MKT-ANIMATRONICS-CEILING', 'Observed top of the Halloween animatronics shelf', animatronics.band.high,
      animatronics.sourceId, `Observed retail listings: ${animatronics.examples.join('; ')}`, animatronics.band),
    mk('MKT-INFLATABLES-CEILING', 'Observed top of the plain Halloween inflatables shelf', inflatables.band.high,
      inflatables.sourceId, inflatables.note, inflatables.band),
    mk('MKT-INCUMBENT-ANCHOR', 'Observed price of the incumbent projection inflatable', gemmy.priceObserved,
      gemmy.priceSourceId, `${gemmy.name} ${gemmy.product}`),
    // The SAME kit sells at 229.99 on a mass retailer's shelf and 414.99 on a
    // marketplace listing. Recording only the higher surface — which an earlier
    // revision did — is how a comparable becomes an argument, and this plan's one
    // clearing configuration was priced at it. The band is registered so the sweep
    // can move it, and the low end is the price a customer comparing the two pays.
    // Points are looked up by ROLE, not by index: adding a surface to the dataset
    // must not silently repoint the digital comparable at a projector kit.
    mk('MKT-BUNDLE-FLOOR', 'Observed price of a projector-plus-screen Halloween bundle at a mass retailer', atmos.priceObservedBand.low,
      point(atmos, 'bundle-mass-retail').sourceId, point(atmos, 'bundle-mass-retail').what, atmos.priceObservedBand),
    mk('MKT-BUNDLE-CEILING', 'Observed price of a projector-plus-screen Halloween bundle on a marketplace listing', atmos.priceObservedBand.high,
      point(atmos, 'bundle-marketplace').sourceId, point(atmos, 'bundle-marketplace').what, atmos.priceObservedBand),
    mk('MKT-DIGITAL-COMPARABLE', 'Observed price of a digital Halloween decoration download', point(atmos, 'content-only').price,
      point(atmos, 'content-only').sourceId, point(atmos, 'content-only').what),
  ];
}

/**
 * @description Turn a list of dataset assumption ids into engine records without
 *   restating any of their content — the dataset is the single source of the
 *   label, the method, the source and the confidence.
 * @param {object} ds - The dataset.
 * @param {'low'|'mid'|'high'} corner - Band corner.
 * @param {string} group - Register grouping.
 * @param {string[]} ids - Dataset assumption ids.
 * @param {object} units - Map of id -> engine unit.
 * @param {object} [money] - Map of id -> true when the value is in dollars.
 * @returns {Array<{assumption: object, meta: object}>} The records.
 */
function passthrough(ds, corner, group, ids, units, money = {}) {
  const out = [];
  for (const id of ids) {
    const rec = ds.assumptions.find((a) => a.id === id);
    if (!rec) continue;
    const raw = scalarAt(rec, corner);
    if (raw === null) continue;
    const unit = units[id] || 'ratio';
    const convert = (n) => (money[id] ? D(n) : unit === 'bps' ? BPS(n) : n);
    const overreach = overreachesSource(rec);
    out.push(record({
      ds, id, datasetId: id, group, label: rec.label,
      value: convert(raw), unit,
      band: rec.band ? { low: convert(rec.band.low), high: convert(rec.band.high) } : undefined,
      sourceId: rec.sourceId,
      // A record whose own band goes beyond what its cited page states is not
      // benchmarked against that page, whatever the dataset claims. It is an
      // estimate that happens to have a link next to it.
      confidence: overreach ? 'low' : rec.confidence,
      needsQuote: Boolean(rec.needsQuote) || overreach,
      method: overreach ? `WIDER THAN ITS CITED SOURCE: ${rec.method}` : rec.method,
      note: rec.note || rec.whyItMatters || rec.dataQualityWarning || '',
      overreachesSource: overreach,
    }));
  }
  return out;
}

/**
 * @description Whether a dataset record's own value or band goes beyond the range
 *   its cited source actually states.
 *
 *   THIS IS HERE BECAUSE A REAL RECORD FAILED IT. The ocean-transit assumption —
 *   the largest single driver of the funding requirement in this venture — was
 *   graded `benchmarked` with a clickable link and a "no quote needed" flag while
 *   claiming roughly twice what the cited page says. A source-kind column and a
 *   confidence column say nothing about whether the number came from the page; only
 *   comparing the two does. Records that quote a numeric range from their source
 *   carry `sourceStatedRange`, and this is what checks them against it.
 *
 * @param {object} rec - A dataset assumption record.
 * @returns {boolean} True when the record claims more than its source supports.
 */
function overreachesSource(rec) {
  const stated = rec.sourceStatedRange;
  if (!stated || !Number.isFinite(stated.low) || !Number.isFinite(stated.high)) return false;
  const claimed = rec.band
    ? [rec.band.low, rec.band.high]
    : (typeof rec.value === 'number' ? [rec.value, rec.value] : []);
  return claimed.some((v) => v < stated.low || v > stated.high);
}

module.exports = {
  D, BPS, DATASET_PATH, MONEY_UNIT, loadDataset, atCorner, scalarAt,
  buildPumpkinLedger, sourceFor, confidenceFor, overreachesSource, STATUTORY_RATE_BANDS,
};
