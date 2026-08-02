/**
 * Unit economics, channel waterfalls, the profit and loss, the cash model and the
 * funding ask.
 *
 * THE CASH DOCUMENT IS THE ONE THAT MATTERS AND IT IS NOT THE PROFIT AND LOSS. For
 * a seasonal hardgood the factory is paid in full months before the season and the
 * retailer pays months after it, so an annual profit statement hides the only number
 * that can end the company. The dataset says exactly that; this document set
 * therefore prints the monthly cash curve, the trough, the month it happens in and
 * the number of months underwater, and treats the profit statement as secondary.
 *
 * THE WATERFALLS ARE PRINTED PER CHANNEL AND NEVER BLENDED INTO A SINGLE MARGIN
 * PERCENTAGE, because the four routes to market have structurally different fee
 * stacks and a blended figure conceals which one is losing money. Two of them lose
 * money on every unit at the prices the market actually shows.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — per-unit economics across the grid, full per-channel waterfalls, the monthly profit statement, the monthly cash and working-capital model with its trough, and a funding ask stated as the cheque plus what it buys.
 */
'use strict';

const { usd, usd0, pct, ratioPct, num, dec, table, cell, doc } = require('../format');
const C = require('./common');

/**
 * @description Unit economics across the whole grid.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function unitEconomics(R) {
  const rows = R.runs.filter((r) => !r.spec.staffed).map((r) => {
    const m = r.model;
    const w = m.waterfalls[0];
    return [
      cell(r.spec.id), cell(r.spec.variantId), cell(r.spec.corner), cell(r.spec.branchId),
      num(r.spec.runQty), Object.keys(r.spec.channels).join('+'),
      usd(m.bom.recurringUnitMicros), usd(m.landed.buyerUnitMicros),
      usd(w.shelfPriceMicros), usd(w.totalFeeMicros), usd(w.contributionPerUnitMicros),
      w.contributionBps === null ? '—' : pct(w.contributionBps),
    ];
  });
  return doc([
    '# Unit economics',
    C.posture(R, R.base),
    'One row per scenario. The first channel of each is shown; multi-channel runs are broken out in the waterfall document.',
    '',
    table(
      ['Scenario', 'Tier', 'Corner', 'Tariff', 'Run', 'Channel', 'Factory/unit', 'Landed/unit', 'Shelf price', 'Channel cost/unit', 'Contribution/unit', 'Rate'],
      rows, ['l', 'l', 'l', 'l', 'r', 'l', 'r', 'r', 'r', 'r', 'r', 'r'],
    ),
    '## How to read this table',
    unitEconomicsNotes(R),
    '## The cost stack, one unit, base scenario',
    C.scenarioLine(R.base),
    costStackTable(R, R.base),
    C.footer(R),
  ]);
}

/**
 * @description How to read the unit-economics table without being misled by it.
 * @param {object} R - The full run result.
 * @returns {string} The notes.
 */
function unitEconomicsNotes(R) {
  return [
    '**The cost-up rows all show the same contribution rate, and that is an artefact rather than a finding.** Those runs solve the shelf price to hit a 25.0% target, so of course they hit it. Their useful column is the shelf price, which is what the product would have to fetch — compare it with the observed ceilings in the decision summary.',
    '',
    '**The market-priced rows are the ones that carry information.** Their price is fixed at a figure observed on a real retail surface, so the contribution column is a result rather than an input, and two of them are negative.',
    '',
    `**Channel cost per unit is not a percentage of anything convenient.** On the direct channel it is dominated by two fixed amounts — customer acquisition at ${usd(R.base.ledger.byId['CH-1-CAC'].value)} per order and outbound freight at ${usd(R.base.ledger.byId['M-DTC-SHIP'].value)} — which do not shrink as the price falls. That is precisely why the cheaper tier fails harder than the expensive one at direct retail: the fixed channel cost is a larger fraction of a smaller price.`,
  ].join('\n');
}

/**
 * @description A single unit's full cost stack.
 * @param {object} R - The full run result.
 * @param {object} run - The run.
 * @returns {string} A markdown table.
 */
function costStackTable(R, run) {
  const m = run.model;
  const w = m.waterfalls[0];
  const rows = [
    ['Factory cost of components and assembly', usd(m.bom.recurringUnitMicros), 'sum of the bill of materials'],
    ['Freight, duty, fees and inbound handling', usd(m.landed.buyerUnitMicros - m.bom.recurringUnitMicros), 'the landed stack less the goods'],
    ['**Landed cost**', `**${usd(m.landed.buyerUnitMicros)}**`, 'what the unit costs sitting in the warehouse'],
    ['Tooling amortised over the run', usd(m.bom.amortizedUnitMicros), 'shown separately; not a marginal cost'],
    ['Channel cost at the required price', usd(w.totalFeeMicros), 'every fee, allowance, return and acquisition cost'],
    ['**Total cost per unit sold**', `**${usd(m.landed.buyerUnitMicros + w.totalFeeMicros)}**`, ''],
    ['Required shelf price at 25.0% contribution', usd(w.shelfPriceMicros), 'solved by the engine'],
  ];
  return table(['', 'Per unit', 'What it is'], rows, ['l', 'r', 'l']);
}

/**
 * @description Full per-channel waterfalls.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function channelWaterfalls(R) {
  const shown = ['va-market-dtc', 'va-market-bigbox', 'vb-market-dtc', 'vb-market-bigbox',
    'va-mid-8528-amazon', 'va-mid-8528-mix'];
  const sections = shown.map((id) => {
    const run = R.byId[id];
    const parts = [`## \`${cell(id)}\``, '', C.scenarioLine(run), '', `_${cell(run.spec.question)}_`, ''];
    for (const w of run.model.waterfalls) {
      parts.push(`### ${cell(w.channelId)} — ${cell(w.kind)}`, '', C.waterfallTable(run.model, w));
    }
    return parts.join('\n');
  });
  return doc([
    '# Channel margin waterfalls',
    C.posture(R, R.base),
    'Every line the money passes through between a shelf price and what is left. Signed: a negative amount reduces what you keep.',
    '',
    '**Two structural facts drive almost everything below.** On a retail shelf the retailer sets the shelf price from your wholesale price rather than the other way round, so the programme allowances come off a number that is already a fraction of the shelf. On a direct channel the two largest deductions are fixed dollar amounts per order, so they do not shrink when the price does.',
    sections.join('\n\n'),
    '## What is not in these waterfalls',
    missingFeesSection(R),
    C.footer(R),
  ]);
}

/**
 * @description Fees the engine's channel shapes do not carry, stated rather than
 *   smuggled into a differently-labelled field.
 * @param {object} R - The full run result.
 * @returns {string} The section.
 */
function missingFeesSection(R) {
  const fuel = R.base.ledger.byId['A-CH-3'];
  const fee = R.base.ledger.byId['A-CH-2'];
  const surcharge = Math.round(fee.value * fuel.value);
  const retailer = R.base.ledger.byId['R-RETAILER'];
  return [
    `**The marketplace fuel surcharge is not modelled.** The engine's marketplace shape has no field for it, and putting it into a differently-named field would mislabel it. The dataset states it at ${ratioPct(fuel.value)} of the fulfilment fee, which on a ${usd(fee.value)} fee is ${usd(surcharge)} per unit. **Every marketplace contribution figure in this document set is optimistic by that amount.**`,
    '',
    `**First-time vendor setup is not in the waterfall either**, because it is not a per-unit fee. It is modelled as fixed spend of ${usd0(retailer.value)} over a ${usd0(retailer.band.low)}–${usd0(retailer.band.high)} range, incurred largely before the first purchase order, and it appears in the cash model rather than the margin stack. The dataset calls it the category of cost first-time vendors most reliably omit.`,
    '',
    `**No early-payment discount is modelled**, because no retailer has offered terms. A real vendor agreement usually carries one, and it comes off the invoice.`,
    '',
    `**The seasonal specialty channel is not modelled at all.** The dataset carries it as a route to market but states no margin, no allowance structure and no payment terms for it, and a channel with invented economics is worse than a channel that is honestly absent.`,
  ].join('\n');
}

/**
 * @description The monthly profit statement.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function profitAndLoss(R) {
  const run = R.byId['va-market-dtc'];
  const rows = run.model.financials.pnl.filter((p) => significantPnl(p)).map((p) => [
    cell(p.month), usd0(p.revenueMicros), usd0(-p.cogsMicros), usd0(p.grossProfitMicros),
    usd0(-p.channelFeeMicros), usd0(-p.marketingMicros), usd0(-p.payrollMicros), usd0(-p.opexMicros),
    usd0(p.ebitdaMicros), usd0(-p.toolingAmortizationMicros), usd0(p.netIncomeMicros), usd0(p.cumulativeNetIncomeMicros),
  ]);
  const t = run.model.financials.totals;
  return doc([
    '# Financial model — profit and loss',
    C.posture(R, run),
    C.scenarioLine(run),
    `_${cell(run.spec.question)}_`,
    '',
    '**This is the only configuration in the plan that returns a positive net income, so it is the one shown in full.** The others are in the unit-economics and decision documents; three of the four market-priced runs lose money on every unit and a monthly statement of a per-unit loss adds nothing.',
    '## Monthly statement',
    'Months with no activity are omitted. Cost of goods is recognised on sale, not on purchase, which is why this statement and the cash statement disagree by months.',
    '',
    table(
      ['Month', 'Revenue', 'COGS', 'Gross profit', 'Channel fees', 'Marketing', 'Payroll', 'Opex', 'EBITDA', 'Tooling amort.', 'Net income', 'Cumulative'],
      rows, ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    ),
    '## Totals across the 30-month horizon',
    table(['', 'Amount'], [
      ['Revenue', usd0(t.revenueMicros)],
      ['Contribution', usd0(t.contributionMicros)],
      ['Fixed costs', usd0(t.fixedCostsMicros)],
      ['Net income', usd0(t.netIncomeMicros)],
      ['Break-even RUN SIZE (a manufacturing quantity, not a sell-through rate)',
        run.model.breakEven.units === null ? 'none exists' : `${num(run.model.breakEven.units)} units against a ${num(run.model.bom.runQtyUnits)}-unit plan`],
      ['Cost of stock that does not sell', usd0(run.model.financials.totals.inventoryWriteDownMicros)],
      ['Month cumulative net income climbs back above zero', cell(R.recovery[run.spec.id].accountingMonth || 'never inside the horizon')],
      ['Month cumulative cash climbs back above zero', cell(R.recovery[run.spec.id].cashMonth || 'never inside the horizon')],
    ], ['l', 'r']),
    '## What this statement does not carry',
    plNotes(R, run),
    C.footer(R),
  ]);
}

/**
 * @description Whether a profit row has anything in it worth printing.
 * @param {object} p - A monthly profit row.
 * @returns {boolean} True when the month has activity.
 */
function significantPnl(p) {
  return p.revenueMicros !== 0 || p.cogsMicros !== 0 || p.opexMicros !== 0
    || p.payrollMicros !== 0 || p.toolingAmortizationMicros !== 0 || p.netIncomeMicros !== 0;
}

/**
 * @description What the profit statement leaves out.
 * @param {object} R - The full run result.
 * @param {object} run - The run shown.
 * @returns {string} The notes.
 */
function plNotes(R, run) {
  const staffed = R.byId['va-mid-8528-dtc-staffed'];
  const rate = R.base.ledger.byId['M-LABOUR-RATE'];
  return [
    `**No salary for anybody.** The payroll column is zero in every month because the base plan is founder-operated and nobody is paid. The dataset lists six functions a hardware venture needs that a software team does not have, and it deliberately refuses to price them, saying the operator must supply a labour rate. See the organisation document for what happens when they are paid: at a placeholder rate of ${usd0(rate.value)} per role per year, the same plan carries ${usd0(staffed.model.headcount.totalMicros)} of headcount cost and net income becomes ${usd0(staffed.model.financials.totals.netIncomeMicros)}.`,
    '',
    `**No annual certification follow-up fees.** A safety listing carries recurring factory-inspection fees; the dataset flags them and does not price them, so from a second production year onward this statement is optimistic by an unstated amount.`,
    '',
    `**No marketplace fuel surcharge**, as stated in the waterfall document.`,
    '',
    `**A single production run and a single season.** The horizon covers one build and one selling window. A second season would repeat the working-capital cycle without repeating the tooling and certification, which is the only structural reason the economics improve with time — and it depends entirely on the first season selling through.`,
  ].join('\n');
}

/**
 * @description The cash-flow and working-capital document.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function cashFlow(R) {
  const run = R.byId['va-market-dtc'];
  const m = run.model;
  const rows = m.financials.cash.filter((c, i) => c.netMicros !== 0 || m.financials.cash[i - 1] === undefined
    || m.financials.cash[i - 1].cumulativeMicros !== c.cumulativeMicros).map((c) => {
    const wc = m.financials.workingCapital.find((w) => w.month === c.month) || {};
    return [
      cell(c.month), usd0(c.inflowsMicros), usd0(c.outflowsMicros), usd0(c.netMicros), usd0(c.cumulativeMicros),
      num(wc.inventoryUnits || 0), usd0(wc.inventoryValueMicros || 0),
      usd0(wc.accountsReceivableMicros || 0), usd0(wc.workingCapitalMicros || 0),
    ];
  });
  return doc([
    '# Cash flow and working capital',
    C.posture(R, run),
    C.scenarioLine(run),
    '',
    '**This is the document that decides whether the company survives.** An annual profit statement on a seasonal hardgood hides the only number that can end it, because the factory is paid in full months before the season and a retailer pays months after it.',
    '## The trough',
    troughTable(R, run),
    '## Monthly cash and working capital',
    'Months where nothing moves are omitted. Cumulative is measured from an opening cash position of zero, so it is the funding curve directly.',
    '',
    table(
      ['Month', 'In', 'Out', 'Net', 'Cumulative', 'Inventory units', 'Inventory value', 'Receivables', 'Working capital'],
      rows, ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    ),
    '## Where the money goes before any arrives',
    preRevenueTable(R, run),
    '## The seasonal trap, stated plainly',
    seasonalTrapSection(R, run),
    C.footer(R),
  ]);
}

/**
 * @description The peak-cash summary.
 * @param {object} R - The full run result.
 * @param {object} run - The run.
 * @returns {string} A markdown table.
 */
function troughTable(R, run) {
  const p = run.model.financials.peakCash;
  const pre = R.preRevenue[run.spec.id];
  const rows = [
    ['Deepest cash position', usd0(p.troughMicros), `reached in ${cell(p.month || 'never')}`],
    ['Funding required before revenue exists', usd0(p.fundingRequiredMicros), 'the cheque somebody has to write'],
    ['Months the cash position is negative', num(p.monthsUnderwater), 'across a 30-month horizon'],
    ['Committed before the first sale', usd0(-pre.totalMicros), `first revenue lands in ${cell(pre.firstRevenueMonth || 'never')}`],
    ['Month the cash position climbs back out', cell(R.recovery[run.spec.id].cashMonth || 'never inside the horizon'),
      'the engine reports its own break-even month as the horizon start, because a plan opening at zero is non-negative before anything happens; this is the month it climbs back out of the hole it dug'],
  ];
  return table(['', 'Value', 'What it means'], rows, ['l', 'r', 'l']);
}

/**
 * @description Pre-revenue outflow by kind.
 * @param {object} R - The full run result.
 * @param {object} run - The run.
 * @returns {string} A markdown table.
 */
function preRevenueTable(R, run) {
  const pre = R.preRevenue[run.spec.id];
  const rows = Object.entries(pre.byKind).sort((a, b) => a[1] - b[1]).map(([kind, micros]) => [
    cell(kind), usd0(-micros), ratioPct(micros / pre.totalMicros),
  ]);
  rows.push(['**Total**', `**${usd0(-pre.totalMicros)}**`, '100.0%']);
  return table(['Commitment', 'Amount', 'Share'], rows, ['l', 'r', 'r']);
}

/**
 * @description The seasonal working-capital trap.
 * @param {object} R - The full run result.
 * @param {object} run - The run.
 * @returns {string} The section.
 */
function seasonalTrapSection(R, run) {
  const m = run.model;
  const box = R.byId['va-market-bigbox'].model;
  const liq = R.base.ledger.byId['M-LIQUIDATION'];
  return [
    `**You pay the factory before the goods sail and you get paid after Halloween.** The purchase-order balance falls due on bill of lading, and the direct channel at least collects at the point of sale. Through a retailer it is worse: payment terms of ${num(R.base.ledger.byId['A-WC-2'].value)} days after a season that ends on 31 October put the money in the following calendar year, and the big-box configuration's trough is ${usd0(box.financials.peakCash.troughMicros)} in ${cell(box.financials.peakCash.month || 'never')} against ${usd0(m.financials.peakCash.troughMicros)} in ${cell(m.financials.peakCash.month || 'never')} for the direct one.`,
    '',
    // M-LIQUIDATION is recorded in BASIS POINTS, so it goes through pct(), not
    // ratioPct(). Passing a bps value to the ratio formatter published "150000.0%"
    // in the document this package calls the one that decides whether the company
    // survives — and the regeneration audit missed it because that audit checks
    // currency numerals, not percentages.
    `**Unsold stock is close to worthless on 1 November.** The model liquidates it at ${pct(liq.value)} of landed cost, over a ${pct(liq.band.low)}–${pct(liq.band.high)} range this run registered because the dataset states "near-zero residual value" without a rate. Units unsold when the window closes: ${num(m.schedule.unsoldAtWindowEnd)}, and they cost ${usd0(m.financials.totals.inventoryWriteDownMicros)} net of the ${usd0(m.schedule.postSeasonMicros)} the liquidation recovers.`,
    '',
    `**There is no second chance inside the season.** The critical path is ${num(m.schedule.criticalPath.totalWeeks)} weeks and the window is ${num(R.base.input.season.sellWindowWeeks)} weeks long. A reorder placed on the first day of a sell-out would arrive months after the last customer stopped looking, which means the run quantity is a one-shot bet placed roughly ${num(m.schedule.criticalPath.totalWeeks)} weeks before any demand signal exists.`,
    '',
    `That is the structural reason the sell-through assumption is the most dangerous number in this plan: it is registered as an outright guess, it cannot be corrected mid-season, and it multiplies the largest cash commitment the venture makes.`,
  ].join('\n');
}

/**
 * @description The funding ask.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function fundingAsk(R) {
  const dtc = R.byId['va-market-dtc'];
  const pilot = R.byId['va-pilot-500-dtc'];
  const base = R.base;
  const rows = [
    ['Full production run, direct, at the observed premium price', usd0(dtc.model.financials.peakCash.fundingRequiredMicros),
      cell(dtc.model.financials.peakCash.month), usd0(dtc.model.financials.totals.netIncomeMicros)],
    ['Pilot run, direct', usd0(pilot.model.financials.peakCash.fundingRequiredMicros),
      cell(pilot.model.financials.peakCash.month), usd0(pilot.model.financials.totals.netIncomeMicros)],
    ['Full production run, big-box shelf', usd0(R.byId['va-market-bigbox'].model.financials.peakCash.fundingRequiredMicros),
      cell(R.byId['va-market-bigbox'].model.financials.peakCash.month), usd0(R.byId['va-market-bigbox'].model.financials.totals.netIncomeMicros)],
  ];
  return doc([
    '# Funding requirement',
    C.posture(R, base),
    '## What each path costs to attempt',
    table(['Path', 'Peak funding required', 'Trough month', 'Net income over 30 months'], rows, ['l', 'r', 'l', 'r']),
    '## What that money buys, and what it does not',
    fundingNarrative(R, dtc),
    '## A cheaper question to answer first',
    cheaperFirstSection(R),
    C.footer(R),
  ]);
}

/**
 * @description What the funding buys.
 * @param {object} R - The full run result.
 * @param {object} dtc - The viable direct run.
 * @returns {string} The section.
 */
function fundingNarrative(R, dtc) {
  const pre = R.preRevenue[dtc.spec.id];
  const be = dtc.model.breakEven;
  const inv = R.marketInversions.find((m) => m.runId === dtc.spec.id);
  const sellThrough = inv ? inv.inversions.breakEvenSellThroughRatio : null;
  return [
    `The headline figure is ${usd0(dtc.model.financials.peakCash.fundingRequiredMicros)}, and ${ratioPct(-pre.totalMicros / dtc.model.financials.peakCash.fundingRequiredMicros)} of it is spent before a single unit is sold. It buys tooling for two moulded parts, four certification exercises, and one production run of ${num(dtc.model.bom.runQtyUnits)} units.`,
    '',
    `**It does not buy the answers to the questions that decide the venture.** Those are: whether a short-throw projector exists in its assumed price class, how customs classifies the product, whether the optics survive an overnight dew cycle, whether the microphone can hear a child over the blower, and whether anybody buys one. All five are cheaper than any line in the funding table and none of them requires this money.`,
    '',
    // Sell-through is the engine's inversion; `breakEven.units` is a minimum RUN
    // SIZE. The two answer different questions and were being conflated here.
    `**And the return it is being asked to produce is thin and conditional.** Net income of ${usd0(dtc.model.financials.totals.netIncomeMicros)} over the horizon — after charging ${usd0(dtc.model.financials.totals.inventoryWriteDownMicros)} for the ${num(dtc.model.schedule.unsoldAtWindowEnd)} units the plan does not sell — needing ${sellThrough === null ? 'a sell-through no quantity of selling reaches' : `${ratioPct(sellThrough)} of the run to sell`} inside a six-week window, ${be.units === null ? 'with no run size that breaks even' : `and a run no smaller than ${num(be.units)} units for the per-unit landed cost to hold`}, at the TOP of the observed price band for one comparable product, with a sell-through figure registered as an outright guess, in a category where a first-time vendor has no shelf.`,
    '',
    `**Posture: this is a planning instrument, not a track record.** Nothing here has been produced or sold. No supplier has quoted. ${ratioPct(R.base.landed.shareRatio)} of the landed cost rests on lines nobody has priced. These figures should be used to decide what evidence to buy next, and should not be presented to a lender or an investor as a forecast.`,
  ].join('\n');
}

/**
 * @description The cheaper alternative the arithmetic points at.
 * @param {object} R - The full run result.
 * @returns {string} The section.
 */
function cheaperFirstSection(R) {
  const digital = R.base.ledger.byId['MKT-DIGITAL-COMPARABLE'];
  const pre = R.preRevenue[R.base.spec.id];
  return [
    `The software this venture would be selling already exists and runs today. Sold on its own it carries no bill of materials, no tooling, no certification, no tariff exposure, no inventory and no seasonal cash trough — **which is to say it carries none of the four things that produce the ${usd0(-pre.totalMicros)} of pre-revenue commitment above**. The observed comparable price for a digital Halloween decoration is ${usd(digital.value)}.`,
    '',
    `It is also the only path that can reach a customer this season. Every hardware path in this plan is governed by a retailer category-review calendar that runs 9 to 12 months ahead of the selling season, plus 3 to 4 months of outreach before the window; compounded, a first big-box conversation about a product that does not yet exist happens two seasons out.`,
    '',
    `**And it buys the one number the whole hardware case rests on.** The sell-through assumption is the largest unmeasured input in the plan and cannot be corrected mid-season. A software-only season produces real demand data, real customer-acquisition cost data, and a list of people who have already paid for the thing — at a fraction of the funding requirement, and without a single manufacturing commitment.`,
  ].join('\n');
}

module.exports = { unitEconomics, channelWaterfalls, profitAndLoss, cashFlow, fundingAsk };
