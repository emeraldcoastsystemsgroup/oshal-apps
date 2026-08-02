/**
 * Market, competition and the route to market.
 *
 * THE COMPETITIVE SECTION MAKES NO ABSOLUTE CLAIMS. Not "the only", not "nobody
 * else", not "unique". Where a rival structurally cannot do something the document
 * says WHY — a rotating gobo has no frame buffer, a pre-rendered video file cannot
 * lip-sync to a sentence that did not exist when the file was made — and where the
 * difference is merely current it says that instead. A competitive absolute is the
 * cheapest sentence in a business plan and the first one a buyer disproves.
 *
 * THE COMPETITION IS ALSO THE BEST NEWS IN THE PLAN, and the document leads with
 * that rather than burying it: a projection inflatable ships at retail today, which
 * means the geometry, the thermal behaviour, the weather tolerance and the retail
 * acceptance of the form factor are demonstrated rather than hoped for. The same
 * fact sets the price anchor that the value tier cannot clear.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — observed price surfaces with their sources, the structural competitive comparison without absolutes, and the channel-by-channel route to market with the sequencing the arithmetic implies.
 */
'use strict';

const { usd, usd0, pct, ratioPct, num, dec, table, cell, doc } = require('../format');
const C = require('./common');

/**
 * @description The market and competition document.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function marketAndCompetition(R) {
  const ds = R.ds;
  return doc([
    '# Market and competition',
    C.posture(R, R.base),
    '## The prices actually observed on retail surfaces',
    'These are the only numbers in this entire document set that somebody can go and verify today. Everything else is researched, estimated or guessed.',
    '',
    observedPriceTable(R),
    '## What already ships, and what it means',
    competitorSections(R, ds),
    '## The shelves this product would have to live on',
    shelfTable(R, ds),
    '## The differentiation claim that survives scrutiny',
    differentiationSection(R, ds),
    C.footer(R),
  ]);
}

/**
 * @description Observed retail prices from the ledger.
 * @param {object} R - The full run result.
 * @returns {string} A markdown table.
 */
function observedPriceTable(R) {
  const ids = ['MKT-ANIMATRONICS-CEILING', 'MKT-INFLATABLES-CEILING', 'MKT-INCUMBENT-ANCHOR',
    'MKT-BUNDLE-CEILING', 'MKT-DIGITAL-COMPARABLE'];
  const rows = ids.map((id) => {
    const a = R.base.ledger.byId[id];
    const meta = R.base.meta[id];
    return [
      cell(id), cell(a.label), usd(a.value),
      a.band ? `${usd(a.band.low)} – ${usd(a.band.high)}` : '—',
      cell(a.confidence),
      meta.sourceUrl ? `[${cell(meta.sourceId)}](${meta.sourceUrl})` : cell(meta.sourceId),
    ];
  });
  return table(['Id', 'What it is', 'Observed', 'Observed band', 'Confidence', 'Source'], rows, ['l', 'l', 'r', 'l', 'l', 'l']);
}

/**
 * @description One section per competitor.
 * @param {object} R - The full run result.
 * @param {object} ds - The dataset.
 * @returns {string} The sections.
 */
function competitorSections(R, ds) {
  return ds.competitors.map((c) => {
    const price = c.priceObserved !== null && c.priceObserved !== undefined
      ? usd(Math.round(c.priceObserved * 1e6))
      : `${usd(Math.round(c.priceBandObserved.low * 1e6))} – ${usd(Math.round(c.priceBandObserved.high * 1e6))}`;
    const parts = [
      `### ${cell(c.name)} — ${price}`, '',
      `**Product.** ${cell(c.product)}`, '',
      `**What it does.** ${cell(c.whatItDoes)}`, '',
      `**What it does not do.** ${cell(c.whatItDoesNot)}`, '',
      `**Why that is structural rather than a feature gap.** ${cell(c.structuralNote)}`, '',
    ];
    if (c.whatItProvesForUs) parts.push(`**What it proves for this venture.** ${cell(c.whatItProvesForUs)}`, '');
    if (c.whatItCostsUs) parts.push(`**What it costs this venture.** ${cell(c.whatItCostsUs)}`, '');
    return parts.join('\n');
  }).join('\n');
}

/**
 * @description The shelves, with the required price against each.
 * @param {object} R - The full run result.
 * @param {object} ds - The dataset.
 * @returns {string} A markdown table.
 */
function shelfTable(R, ds) {
  const rows = [
    ['Halloween animatronics', usd(R.base.ledger.byId['MKT-ANIMATRONICS-CEILING'].band.low),
      usd(R.base.ledger.byId['MKT-ANIMATRONICS-CEILING'].band.high),
      usd(R.byId['va-mid-8528-bigbox'].model.waterfalls[0].shelfPriceMicros),
      'V-A self-contained', 'above the top of the shelf'],
    ['Plain Halloween inflatables', usd(R.base.ledger.byId['MKT-INFLATABLES-CEILING'].band.low),
      usd(R.base.ledger.byId['MKT-INFLATABLES-CEILING'].band.high),
      usd(R.byId['vb-mid-8528-bigbox'].model.waterfalls[0].shelfPriceMicros),
      'V-B kit', 'far above the top of the shelf'],
    ['Direct, premium projector bundle', usd(R.base.ledger.byId['MKT-BUNDLE-CEILING'].value),
      usd(R.base.ledger.byId['MKT-BUNDLE-CEILING'].value),
      usd(R.byId['va-mid-8528-dtc'].model.waterfalls[0].shelfPriceMicros),
      'V-A self-contained', 'above, but within reach at a better cost corner'],
    ['Digital decoration download', usd(R.base.ledger.byId['MKT-DIGITAL-COMPARABLE'].value),
      usd(R.base.ledger.byId['MKT-DIGITAL-COMPARABLE'].value),
      '_no bill of materials to price_', 'V-C software only', 'no landed cost at all'],
  ];
  return [
    table(['Shelf', 'Observed low', 'Observed high', 'Price this product needs', 'Tier', 'Position'], rows,
      ['l', 'r', 'r', 'r', 'l', 'l']),
    '',
    `**The premium tier cannot be merchandised as an inflatable and the value tier cannot be merchandised as an animatronic.** The self-contained unit's required price is several times the top of the inflatables shelf, and the kit has no feature story that supports an animatronics price. Each tier therefore has exactly one shelf it could belong on, and on that shelf the arithmetic in the decision summary applies.`,
  ].join('\n');
}

/**
 * @description The defensible differentiation claim.
 * @param {object} R - The full run result.
 * @param {object} ds - The dataset.
 * @returns {string} The section.
 */
function differentiationSection(R, ds) {
  const c3 = ds.competitors.find((c) => c.id === 'C-3');
  const c2 = ds.competitors.find((c) => c.id === 'C-2');
  const sw3 = ds.softwareBaseline.exists.find((e) => e.id === 'SW-3');
  return [
    `**"The props on this shelf respond to presence. This one can respond to words."** ${cell(c3.structuralNote.split('.').slice(-1)[0].trim())}`,
    '',
    `That claim is narrow, it is true, and it is checkable. It does not say anybody else is incapable of building this; it says what the difference is and why it is architectural: ${cell(sw3.what)} — ${cell(sw3.evidence)}. ${cell(c2.structuralNote)}`,
    '',
    `**What that claim does not do is carry a price.** The animatronics shelf tops out at an observed ${usd(R.base.ledger.byId['MKT-ANIMATRONICS-CEILING'].band.high)}, and at that price the self-contained unit loses ${usd(-R.byId['va-market-bigbox'].model.waterfalls[0].contributionPerUnitMicros)} per unit. A better story does not move a shelf ceiling; it moves sell-through at a price the shelf already supports.`,
    '',
    `**And the demonstration risk runs the other way.** A pre-rendered video library sets a high production-quality bar. A procedural face has to look deliberately stylised and good rather than like a cheaper version of rendered video, and no part of this plan prices that design work.`,
  ].join('\n');
}

/**
 * @description The go-to-market document.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function goToMarket(R) {
  const ds = R.ds;
  const rows = ds.channels.map((c) => {
    const modelled = ['CH-1', 'CH-2', 'CH-3'].includes(c.id);
    const runId = { 'CH-1': 'va-market-dtc', 'CH-2': 'va-mid-8528-amazon', 'CH-3': 'va-market-bigbox' }[c.id];
    const run = runId ? R.byId[runId] : null;
    return [
      cell(c.id), cell(c.name), cell(c.fits.join(', ')),
      modelled ? 'yes' : '**not modelled**',
      run ? usd(run.model.waterfalls[0].contributionPerUnitMicros) : '—',
      cell(c.calendarConstraint || ''),
    ];
  });
  return doc([
    '# Go to market',
    C.posture(R, R.base),
    '## Every route, and whether the model can price it',
    table(['Id', 'Channel', 'Fits', 'Modelled', 'Contribution/unit where priced', 'Calendar constraint'], rows),
    '',
    '**One route is deliberately not modelled.** The seasonal specialty channel has no stated margin, allowance structure or payment terms anywhere in the dataset, and a channel with invented economics is worse than one that is honestly absent.',
    '## The marketplace trap this model does charge for',
    marketplaceSection(R, ds),
    '## Why a first-time vendor is not a candidate for a shelf',
    firstVendorSection(R, ds),
    '## The sequence the arithmetic implies',
    sequenceSection(R),
    C.footer(R),
  ]);
}

/**
 * @description The seasonal marketplace storage trap.
 * @param {object} R - The full run result.
 * @param {object} ds - The dataset.
 * @returns {string} The section.
 */
function marketplaceSection(R, ds) {
  const ch2 = ds.channels.find((c) => c.id === 'CH-2');
  const run = R.byId['va-mid-8528-amazon'];
  const w = run.model.waterfalls[0];
  const peak = R.base.ledger.byId['A-CH-4'];
  const off = R.base.ledger.byId['A-CH-5'];
  const storage = w.steps.find((s) => /storage/i.test(s.label));
  return [
    `${cell(ch2.theSeasonalTrap)}`,
    '',
    `The engine charges storage at the rate in force in each month the stock is actually held rather than at an annual average: ${usd(peak.value)} per cubic foot per month in the peak months against ${usd(off.value)} outside them. On this configuration that is ${storage ? usd(-storage.amountMicros) : usd(0)} per unit.`,
    '',
    `The dataset also carries a warning worth repeating: a bulky home item at a low price point can lose close to half its revenue to marketplace fees before storage or advertising is counted at all. That is a warning about the value tier specifically, and this model reproduces it — the kit's marketplace contribution is ${usd(R.byId['vb-mid-8528-amazon'].model.waterfalls[0].contributionPerUnitMicros)} per unit at a price solved to clear a 25.0% target, which is a price no observed shelf supports.`,
    '',
    `**The inbound deadline is not negotiable.** Inventory must be received into the fulfilment network by early September; fourth-quarter inbound restrictions and receiving delays are real, and they sit ${num(R.base.model.schedule.criticalPath.totalWeeks)} weeks downstream of a purchase order.`,
  ].join('\n');
}

/**
 * @description Why the shelf is not available regardless of price.
 * @param {object} R - The full run result.
 * @param {object} ds - The dataset.
 * @returns {string} The section.
 */
function firstVendorSection(R, ds) {
  const ch3 = ds.channels.find((c) => c.id === 'CH-3');
  const retailer = ds.regulatory.find((r) => r.id === 'R-RETAILER');
  const a = R.base.ledger.byId['R-RETAILER'];
  return [
    `${cell(ch3.firstTimeVendorReality)}`,
    '',
    `And before any of that there is a bill. ${cell(retailer.basis)}`,
    '',
    `Modelled at ${usd0(a.value)} over a ${usd0(a.band.low)}–${usd0(a.band.high)} range, and — this is the part first-time vendors miss — **largely incurred before the first purchase order**. ${cell(retailer.note)}`,
    '',
    `So the shelf is gated three ways at once: by the arithmetic (the unit loses money at the top observed price), by the calendar (two seasons out for a product that does not exist), and by the vendor requirements (a setup cost incurred before any revenue, on top of a certification programme). **Any one of those alone would defer it.**`,
  ].join('\n');
}

/**
 * @description The sequencing the numbers imply.
 * @param {object} R - The full run result.
 * @returns {string} The section.
 */
function sequenceSection(R) {
  const digital = R.base.ledger.byId['MKT-DIGITAL-COMPARABLE'];
  const dtc = R.byId['va-market-dtc'];
  const floor = R.byId['va-market-dtc-floor'];
  const sellThrough = (R.marketInversions.find((m) => m.runId === 'va-market-dtc') || {})
    .inversions.breakEvenSellThroughRatio;
  const pre = R.preRevenue[R.base.spec.id];
  return [
    'Not a recommendation dressed as a conclusion — this falls out of the tables above and is stated so a reader can disagree with the arithmetic rather than with a preference.',
    '',
    `**First, the tier with no bill of materials.** No landed cost, no tariff exposure, no certification, no inventory, no seasonal cash trough, and no dependence on a retailer's category-review calendar. Observed comparable price ${usd(digital.value)}. It is the only tier that can reach a customer this season, and the software it sells already runs. Its real value is not the revenue — it is that it buys the sell-through and acquisition-cost evidence the entire hardware case is missing, without a manufacturing commitment.`,
    '',
    // Sell-through comes from the engine's inversion. Dividing break-even units by
    // the run quantity answers a different question: the break-even search moves
    // the MANUFACTURING QUANTITY and never touches sell-through at all.
    `**Second, direct at a premium, and only if the sourcing evidence supports it.** The self-contained unit at the TOP of the observed direct-bundle band, ${usd(dtc.model.waterfalls[0].shelfPriceMicros)}, is the one configuration in this plan that contributes positively, at ${usd(dtc.model.waterfalls[0].contributionPerUnitMicros)} per unit — and at the bottom of that same band, ${usd(floor.model.waterfalls[0].shelfPriceMicros)} for the identical comparable kit on a mass retailer's shelf, it loses ${usd(-floor.model.waterfalls[0].contributionPerUnitMicros)} a unit. The premium case needs ${ratioPct(sellThrough)} of the run to sell inside a six-week window and ${usd0(dtc.model.financials.peakCash.fundingRequiredMicros)} of funding, ${ratioPct(-pre.totalMicros / dtc.model.financials.peakCash.fundingRequiredMicros)} of it committed before the first sale.`,
    '',
    `**Third, and not before two seasons out, the retail shelf** — if by then the cost bands have been replaced by quotes that land near their low corners. At the researched midpoint it is not reachable, and the gap is not a rounding error.`,
    '',
    `**The value tier is the one to stop working on.** It is the intuitive answer — make it cheaper, sell more — and it is the configuration the arithmetic rejects most firmly: no researched value of acquisition cost, outbound freight or envelope cost turns it contribution-positive at the incumbent's price, and the engine reports that no factory price at all, including zero, reaches the required landed cost.`,
  ].join('\n');
}

module.exports = { marketAndCompetition, goToMarket };
