/**
 * The three documents a decision is actually made from.
 *
 * THE ORDER IS THE ARGUMENT. The summary leads with the verdict and the five
 * numbers that decide it, the inversion document states what would have to be true
 * for the verdict to change, and the gate memo says whether the next tranche of
 * spend is justified. A plan that opens with a company overview and reaches the
 * unit economics on page nine is a plan designed not to be read.
 *
 * THE VERDICT IS COMPUTED, NOT WRITTEN. `verdictFor` reads contribution per unit
 * and break-even off the model and picks a word; there is no branch in this module
 * where a human sentiment overrides the arithmetic. When the engine says a channel
 * loses money on every unit and there is no sell-through that recovers it, this
 * says so in the first line.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the computed verdict, the five decision numbers, the required-price-versus-observed-ceiling comparison, the driver-crossing inversions, and the stage-1 gate memo with its numeric criteria.
 * 2 | roger.murphy@emeraldcoastsystemsgroup.com   | Every sell-through claim now reads the engine's break-even sell-through inversion instead of dividing break-even units by the run quantity. `breakEven.units` is a bisection over RUN SIZE — how many to manufacture — so that division produced a number about a different question entirely, and it contradicted this same document four sections later. The most-likely-failure section no longer hardcodes its conclusion and then splices in whichever driver the sweep happened to return as its evidence; it names the driver the sweep actually found and argues the projector case from the projector's own rank and gate.
 */
'use strict';

const { usd, usd0, pct, ratioPct, num, dec, table, cell, doc } = require('../format');
const C = require('./common');

/**
 * @description The fraction of a run that has to sell for a market-priced
 *   configuration to break even, read off the engine's own inversion.
 *
 *   NOT `breakEven.units / runQtyUnits`. That was the shape of a real defect: the
 *   break-even search bisects over RUN SIZE — the manufacturing quantity — while
 *   sell-through is a separate assumption the search does not move at all. The
 *   ratio of the two answers no question, and it published 97.5% in a document that
 *   reported 85% of the run selling profitably four sections further down.
 *
 * @param {object} R - The full run result.
 * @param {string} runId - A market-priced scenario id.
 * @returns {number|null} The required sell-through as a fraction, or null when none exists.
 */
function sellThroughOf(R, runId) {
  const found = R.marketInversions.find((m) => m.runId === runId);
  return found ? found.inversions.breakEvenSellThroughRatio : null;
}

/** Observed ceilings each cost-up run is measured against. */
const CEILING_FOR = {
  dtc: 'MKT-BUNDLE-CEILING',
  amazon: 'MKT-BUNDLE-CEILING',
  bigbox: 'MKT-ANIMATRONICS-CEILING',
};

/** Ceiling used for the value-tier kit, which competes on a different shelf. */
const KIT_CEILING_FOR = {
  dtc: 'MKT-INCUMBENT-ANCHOR',
  amazon: 'MKT-INCUMBENT-ANCHOR',
  bigbox: 'MKT-INFLATABLES-CEILING',
};

/**
 * @description The observed ceiling a cost-up run should be judged against.
 * @param {object} run - A scenario run.
 * @returns {{id: string, micros: number, label: string}} The ceiling record.
 */
function ceilingFor(run) {
  const channel = Object.keys(run.spec.channels)[0];
  const map = run.spec.variantId === 'V-A' ? CEILING_FOR : KIT_CEILING_FOR;
  const id = map[channel];
  const a = run.ledger.byId[id];
  return { id, micros: a.value, label: a.label };
}

/**
 * @description Turn a market-priced run into a one-word verdict, read off the
 *   engine rather than chosen.
 * @param {object} run - A market-priced scenario run.
 * @returns {{word: string, why: string}} The verdict and its reason.
 */
function verdictFor(run) {
  const w = run.model.waterfalls[0];
  const be = run.model.breakEven;
  if (w.contributionPerUnitMicros < 0) {
    return { word: 'NO', why: `it loses ${usd(-w.contributionPerUnitMicros)} on every unit sold and volume makes that worse` };
  }
  if (be.units === null) return { word: 'NO', why: 'no volume in the plan breaks even' };
  if (be.units > run.model.bom.runQtyUnits) {
    return { word: 'NO', why: `the smallest run that breaks even is ${num(be.units)} units and the plan only makes ${num(run.model.bom.runQtyUnits)}` };
  }
  // This is RUN-SIZE headroom — how far the manufacturing quantity could be cut
  // before the per-unit landed cost stops working. It is not sell-through, and
  // saying "of the run" without saying which quantity is how the two got conflated.
  const headroom = 1 - be.units / run.model.bom.runQtyUnits;
  if (headroom < 0.1) {
    return { word: 'MARGINAL', why: `the smallest run that breaks even is ${num(be.units)} units against a plan of ${num(run.model.bom.runQtyUnits)} — only ${ratioPct(headroom)} of the ORDER SIZE can be cut before the landed cost stops working` };
  }
  return { word: 'YES', why: `the smallest run that breaks even is ${num(be.units)} units against a plan of ${num(run.model.bom.runQtyUnits)}` };
}

/**
 * @description Report a break-even month, flagging the degenerate case where the
 *   engine's "first month cumulative is non-negative" lands on the first month of
 *   the horizon simply because nothing has happened yet. Printing that as a
 *   break-even date would be the sort of technically-true figure this whole
 *   document set exists to keep out.
 * @param {object} run - The run.
 * @param {string|null} month - The engine's break-even month.
 * @returns {string} The month, or a statement of why it is not a real date.
 */
function breakEvenMonth(run, month) {
  if (!month) return 'never inside the 30-month horizon';
  if (month === run.input.horizonStart) {
    return `${cell(month)} — the horizon start, before any money moves, so not a real crossing`;
  }
  return cell(month);
}

/**
 * @description The required-price-versus-ceiling table: the single comparison the
 *   whole venture turns on.
 * @param {object} R - The full run result.
 * @returns {string} A markdown table.
 */
function requiredPriceTable(R) {
  const rows = R.runs.filter((r) => r.spec.mode === 'cost-up' && !r.spec.staffed && Object.keys(r.spec.channels).length === 1)
    .map((r) => {
      const w = r.model.waterfalls[0];
      const ceiling = ceilingFor(r);
      const gap = w.shelfPriceMicros - ceiling.micros;
      const over = ceiling.micros > 0 ? gap / ceiling.micros : 0;
      return [
        cell(r.spec.id), cell(r.spec.variantId), cell(r.spec.corner), cell(r.spec.branchId),
        num(r.spec.runQty), Object.keys(r.spec.channels)[0],
        usd(r.model.landed.buyerUnitMicros), usd(w.shelfPriceMicros), usd(ceiling.micros),
        gap > 0 ? `over by ${usd(gap)} (${ratioPct(over, 0)})` : `under by ${usd(-gap)}`,
      ];
    });
  return table(
    ['Scenario', 'Tier', 'Corner', 'Tariff', 'Run', 'Channel', 'Landed/unit', 'Required shelf price', 'Observed ceiling', 'Verdict'],
    rows, ['l', 'l', 'l', 'l', 'r', 'l', 'r', 'r', 'r', 'l'],
  );
}

/**
 * @description The market-priced verdict table: what happens at the price the
 *   market actually shows.
 * @param {object} R - The full run result.
 * @returns {string} A markdown table.
 */
function marketVerdictTable(R) {
  const rows = R.runs.filter((r) => r.spec.mode === 'market').map((r) => {
    const w = r.model.waterfalls[0];
    const v = verdictFor(r);
    const be = r.model.breakEven;
    return [
      cell(r.spec.id), cell(r.spec.variantId), Object.keys(r.spec.channels)[0],
      usd(w.shelfPriceMicros), usd(r.model.landed.buyerUnitMicros),
      usd(w.contributionPerUnitMicros), w.contributionBps === null ? '—' : pct(w.contributionBps),
      be.units === null ? '**none exists**' : num(be.units),
      usd(r.model.financials.totals.netIncomeMicros),
      `**${v.word}**`,
    ];
  });
  return table(
    ['Scenario', 'Tier', 'Channel', 'Shelf price', 'Landed/unit', 'Contribution/unit', 'Rate', 'Break-even units', 'Net income over 30 months', 'Verdict'],
    rows, ['l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'c'],
  );
}

/**
 * @description The five decision numbers for one run.
 * @param {object} R - The full run result.
 * @param {object} run - The run to summarise.
 * @returns {string} A markdown table.
 */
function decisionNumbers(R, run) {
  const m = run.model;
  const pre = R.preRevenue[run.spec.id];
  const rec = R.recovery[run.spec.id];
  const be = m.breakEven;
  const rows = [
    ['What it costs to find out', usd0(-pre.totalMicros),
      `Every dollar committed before the first unit sells in ${cell(pre.firstRevenueMonth || 'never')} — tooling, certification and the whole production order`],
    ['Peak cash requirement', usd0(m.financials.peakCash.fundingRequiredMicros),
      `The deepest the cash position goes, in ${cell(m.financials.peakCash.month || 'never')}, across ${num(m.financials.peakCash.monthsUnderwater)} months underwater`],
    // `breakEven.units` is a MINIMUM RUN SIZE — the smallest quantity to
    // manufacture — found by rebuilding the model at each candidate volume. It is
    // not a sell-through requirement, and dividing it by the planned run to make
    // one is how this table came to contradict the sell-through inversion two
    // documents away.
    ['Break-even run size', be.units === null ? '**no run size breaks even**' : `${num(be.units)} units`,
      be.units === null
        ? 'Contribution is negative, so every additional unit deepens the loss'
        : `The smallest quantity worth MANUFACTURING against a ${num(m.bom.runQtyUnits)}-unit plan. Below it the per-unit landed cost rises far enough on container and minimum-order steps to sink the plan; it is not a sell-through rate.`],
    ['Break-even date (cash)', cell(rec.cashMonth || (rec.wentNegative ? 'never inside the 30-month horizon' : 'the position never goes negative')),
      'First month the cash position climbs back out of the hole it dug'],
    ['Break-even date (accounting)', cell(rec.accountingMonth || 'never inside the 30-month horizon'),
      'First month cumulative net income climbs back above zero'],
    ['Landed cost per unit', usd(m.landed.buyerUnitMicros),
      `${ratioPct(run.landed.shareRatio)} of it rests on lines nobody has quoted`],
  ];
  return table(['Question', 'Answer', 'What it means'], rows, ['l', 'r', 'l']);
}

/**
 * @description The break-even is a step, not a slope, and a reader who is not told
 *   that will believe the plan degrades gently below it.
 * @param {object} R - The full run result.
 * @returns {string} The section.
 */
function breakEvenStepSection(R) {
  const s = R.breakEvenStep;
  if (!s) return '';
  const rows = [
    ['Run quantity', num(s.below.units), num(s.at.units)],
    [`Pieces of \`${cell(s.at.componentId)}\` actually purchased`, num(s.below.purchaseQty), num(s.at.purchaseQty)],
    ['Price band that applies', `the step quoted from ${num(s.below.band)} piece`, `the step quoted from ${num(s.at.band)} pieces`],
    [`Unit cost of \`${cell(s.at.componentId)}\``, usd(s.below.unitCostMicros), usd(s.at.unitCostMicros)],
    ['Factory cost per unit', usd(s.below.factoryUnitMicros), usd(s.at.factoryUnitMicros)],
    ['Landed cost per unit', usd(s.below.landedUnitMicros), usd(s.at.landedUnitMicros)],
    ['Net income across the horizon', usd0(s.below.netIncomeMicros), usd0(s.at.netIncomeMicros)],
  ];
  const swing = s.at.netIncomeMicros - s.below.netIncomeMicros;
  return [
    `### The break-even is a cliff, not a slope`,
    '',
    `That ${num(s.units)}-unit figure is not a margin crossing. It is the exact run size at which the **purchase** quantity — the run plus its scrap allowance — reaches the ${num(s.at.band)}-piece quantity every cost band in the dataset is quoted at. One unit below it, every component reverts to the small-run price the dataset itself puts 25 to 60 percent higher. Shown on \`${cell(s.at.componentId)}\`, ${cell(s.at.componentName)}, the largest purchased line:`,
    '',
    table(['', `Run of ${num(s.below.units)}`, `Run of ${num(s.at.units)}`], rows, ['l', 'r', 'r']),
    '',
    `**One unit of run quantity is worth ${usd0(swing)} of net income here.** The textbook fixed-cost-over-contribution formula gives ${s.closedForm === null ? 'no answer' : `${num(s.closedForm)} units`} for the same question, and the engine flags the divergence rather than reporting the tidier number — contribution is not constant in volume when component prices are quoted in steps and ocean freight is sold by the container.`,
    '',
    `The practical reading: **there is no gentle scaling-down of this plan.** A cautious operator who orders fewer units to reduce risk crosses a price break and loses more money, not less. That is the trap the pilot-volume section below makes concrete.`,
  ].join('\n');
}

/**
 * @description The largest named non-cash term in a run's profit-to-cash bridge.
 * @param {object} run - A scenario run.
 * @returns {number} Micros of returns-salvage credit that never becomes cash.
 */
function rec_gap(run) {
  return run.model.financials.reconciliation.returnsSalvageCreditMicros;
}

/**
 * @description The viable configuration still does not return the cheque inside
 *   the horizon, and that is worth its own paragraph.
 * @param {object} R - The full run result.
 * @param {object} run - The viable market-priced run.
 * @returns {string} The section.
 */
function cashNeverReturnsSection(R, run) {
  const rec = R.recovery[run.spec.id];
  const cash = run.model.financials.cash;
  const last = cash[cash.length - 1];
  const net = run.model.financials.totals.netIncomeMicros;
  const unsold = run.model.schedule.unsoldAtWindowEnd;
  if (rec.cashMonth) return '';
  return [
    `### And the one that clears its unit cost still does not return the cheque`,
    '',
    `Net income across the horizon is ${usd0(net)}. The cash position at the end of the horizon is ${usd0(last.cumulativeMicros)} — it never climbs back above where it started, across ${num(run.model.financials.peakCash.monthsUnderwater)} of ${num(cash.length)} months.`,
    '',
    // NAME THE DIFFERENCE, DO NOT CHARACTERISE IT. This paragraph used to explain
    // the whole gap as a timing effect — "cost of goods is recognised when a unit
    // sells while the run was paid for at bill of lading" — in a horizon with more
    // than a year of settled quiet after the last cash event, which means the gap
    // was permanent and the explanation was wrong. The engine's reconciliation now
    // states every term, and this reads it rather than describing it.
    `The two figures differ, and every dollar of the difference is named in [\`22-engine-reconciliation-and-refusal-control.md\`](22-engine-reconciliation-and-refusal-control.md). At the end of the horizon nothing is owed either way — no receivable, no payable, no stock — so this is not a timing effect that later months resolve. It is ${usd0(rec_gap(run))} of non-cash credit for returned units the model treats as resellable stock and never resells. ${num(unsold)} units of the ${num(run.model.bom.runQtyUnits)}-unit run are also still unsold when the window closes; they liquidate for ${usd0(run.model.schedule.postSeasonMicros)} and the ${usd0(run.model.financials.totals.inventoryWriteDownMicros)} they cost is charged against the profit above.`,
    '',
    `**A plan that is profitable on paper and never returns its capital is the specific failure a seasonal hardgood produces**, and it is the reason this document set leads with the cash statement rather than the profit statement.`,
  ].join('\n');
}

/**
 * @description The three assumptions the whole plan rests on, read off the
 *   sensitivity sweep rather than chosen by a writer.
 * @param {object} R - The full run result.
 * @returns {string} A markdown table.
 */
function topDrivers(R) {
  const rows = R.cashSweep.sweep.topThree.map((b, i) => {
    const meta = R.base.meta[b.assumptionId] || {};
    const a = R.base.ledger.byId[b.assumptionId];
    const fmt = (v) => (a.unit === 'micros' ? usd(v) : a.unit === 'bps' ? pct(v) : dec(v, 3));
    return [
      String(i + 1), cell(b.assumptionId), cell(b.label),
      `${fmt(b.lowValue)} – ${fmt(b.highValue)}`, fmt(b.baseValue),
      usd0(b.swingMicros), cell(a.confidence),
      meta.needsQuote ? 'yes' : 'no',
    ];
  });
  return table(
    ['#', 'Assumption', 'What it is', 'Researched range', 'Modelled at', 'Moves peak cash by', 'Confidence', 'Needs a quote'],
    rows, ['r', 'l', 'l', 'l', 'r', 'r', 'l', 'c'],
  );
}

/**
 * @description The decision summary. Leads with the verdict, then the five numbers,
 *   then the comparison that produced the verdict.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function decisionSummary(R) {
  const base = R.base;
  const vaDtc = R.byId['va-market-dtc'];
  const vaBox = R.byId['va-market-bigbox'];
  const vbDtc = R.byId['vb-market-dtc'];
  const vbBox = R.byId['vb-market-bigbox'];
  const pilot = R.byId['va-pilot-500-dtc'];
  const digital = R.base.ledger.byId['MKT-DIGITAL-COMPARABLE'];
  return doc([
    '# Decision summary — projected talking jack-o\'-lantern',
    C.posture(R, base),
    '## The verdict, in one paragraph',
    verdictParagraph(R, { vaDtc, vaBox, vbDtc, vbBox }),
    '## The five numbers that decide it',
    [
      `Read for the **one configuration in this plan that clears its own cost**, so the numbers are the best case rather than an average of good and bad ones. ${C.scenarioLine(vaDtc)}`,
      '',
      `_Break-even is quoted only for market-priced runs. A cost-up run solves its price to hold a contribution rate, so its break-even volume is an artefact of the pricing rule and is not reported as a decision number anywhere in this document set._`,
    ].join('\n'),
    decisionNumbers(R, vaDtc),
    breakEvenStepSection(R),
    cashNeverReturnsSection(R, vaDtc),
    [
      `**The same five numbers for the cost-up base scenario**, where the question is not "does it pay" but "what would it have to fetch". ${C.scenarioLine(base)} Its landed cost is ${usd(base.model.landed.buyerUnitMicros)} and its required shelf price is ${usd(base.model.waterfalls[0].shelfPriceMicros)}, against an observed ceiling of ${usd(ceilingFor(base).micros)} — ${usd(base.model.waterfalls[0].shelfPriceMicros - ceilingFor(base).micros)} over. Committed before first revenue: ${usd0(-R.preRevenue[base.spec.id].totalMicros)}; peak funding ${usd0(base.model.financials.peakCash.fundingRequiredMicros)} in ${cell(base.model.financials.peakCash.month)}.`,
    ].join('\n'),
    '## Sold at the price the market actually shows',
    'These runs take the observed shelf price as given and ask what happens. This is the table that decides the venture; the cost-up table below only says what the product would have to fetch.',
    marketVerdictTable(R),
    marketNotes(R, { vaDtc, vaBox, vbDtc, vbBox }),
    '## What it would have to sell for, against what the shelf actually shows',
    'Every run below is priced up from its own landed cost to a 25.0% target contribution, then compared with a price observed on a real retail surface today.',
    requiredPriceTable(R),
    '## The three assumptions the whole thing rests on',
    'Ranked by how far each one moves the peak cash requirement when it is swung across its own researched range, with the entire model rebuilt at each end. Nothing here was chosen by a writer.',
    topDrivers(R),
    '## The single most likely reason it fails',
    mostLikelyFailure(R),
    '## What a first-timer can actually order',
    firstTimerSection(R, pilot),
    '## The tier that is not a hardware venture at all',
    `The dataset carries a third tier with no bill of materials: a seasonal licence to the face renderer for a customer who already owns a projector. It has no landed cost, no tariff exposure, no certification, no inventory and no seasonal cash trough, so **it is not modelled by this engine at all** — there is nothing for a landed-cost stack to compute. The observed comparable price for a digital Halloween decoration download is ${usd(digital.value)}, and it is the only tier whose schedule is not governed by a retailer's 9-to-12-month category review calendar.`,
    '',
    'That is a real finding rather than a consolation prize: the software this venture would be selling **already exists and runs today**, and the tier that ships it carries none of the four costs that make the other two tiers fail.',
    C.footer(R),
  ]);
}

/**
 * @description The computed verdict paragraph.
 * @param {object} R - The full run result.
 * @param {object} runs - The four market-priced runs.
 * @returns {string} The paragraph.
 */
function verdictParagraph(R, runs) {
  const { vaDtc, vaBox, vbDtc, vbBox } = runs;
  const vBox = verdictFor(vaBox);
  const vDtc = verdictFor(vaDtc);
  const boxW = vaBox.model.waterfalls[0];
  const kitW = vbDtc.model.waterfalls[0];
  const kitBoxW = vbBox.model.waterfalls[0];
  const dtcW = vaDtc.model.waterfalls[0];
  const floor = R.byId['va-market-dtc-floor'];
  const floorW = floor.model.waterfalls[0];
  // THE SELL-THROUGH FIGURE IS THE INVERSION, NOT breakEven.units / runQty.
  // breakEven.units is a bisection over RUN SIZE — how many to manufacture — and
  // dividing it by the run quantity produced a number that had nothing to do with
  // sell-through and contradicted this document four sections further down.
  const sellThrough = sellThroughOf(R, 'va-market-dtc');
  return [
    `**As a product sold in a store, the arithmetic says no.** Placed at the very top of the Halloween animatronics shelf — ${usd(boxW.shelfPriceMicros)}, the highest price observed in that category on a real retail surface — the self-contained unit loses ${usd(-boxW.contributionPerUnitMicros)} on every unit before a single dollar of overhead. The engine ${vBox.word === 'NO' ? 'refuses to name a break-even volume' : 'names a break-even volume'} for it, because ${vBox.why}. The cheaper customer-supplies-the-projector kit is worse, not better: at the incumbent's observed ${usd(kitW.shelfPriceMicros)} price it loses ${usd(-kitW.contributionPerUnitMicros)} a unit, and at the top of the plain inflatables shelf it loses ${usd(-kitBoxW.contributionPerUnitMicros)}.`,
    '',
    `**Sold direct, one configuration clears — but only at the top of the comparable's own price band.** The comparable used here is a projector-and-screen Halloween bundle, and the identical kit sells at ${usd(floorW.shelfPriceMicros)} on a mass retailer's shelf and ${usd(dtcW.shelfPriceMicros)} on a marketplace listing. At the ${usd(dtcW.shelfPriceMicros)} end the self-contained unit contributes ${usd(dtcW.contributionPerUnitMicros)} per unit, ${pct(dtcW.contributionBps)} of revenue, and ${vDtc.why}. At the ${usd(floorW.shelfPriceMicros)} end — the price a customer comparing the two surfaces would pay — it loses ${usd(-floorW.contributionPerUnitMicros)} a unit and the engine refuses to name a break-even volume at all. The positive answer is not a property of the product; it is a property of which listing you price against.`,
    '',
    `That best case is also narrow: it needs ${ratioPct(sellThrough)} of a ${num(vaDtc.model.bom.runQtyUnits)}-unit run to sell inside a six-week window, against a sell-through figure that has no evidence behind it whatsoever. The ${num(vaDtc.model.schedule.unsoldAtWindowEnd)} units that do not sell at the planned rate cost ${usd0(vaDtc.model.financials.totals.inventoryWriteDownMicros)} net of what the liquidation recovers, and that cost is charged against the profit below.`,
    '',
    `**And every one of those numbers is provisional.** ${ratioPct(R.base.landed.shareRatio)} of the landed cost rests on lines no supplier has quoted; ${R.base.stats.byConfidence.quoted} of ${R.base.stats.total} registered assumptions carry a vendor quote. The direction of the finding is robust — the gaps are tens of percent, far wider than any single band's uncertainty — but no absolute figure in this document should be committed against.`,
    '',
    `Ranked bluntly: **the store shelf is not reachable, direct-at-a-premium is arguable, and the software-only tier carries none of the four costs that kill the other two.**`,
  ].join('\n');
}

/**
 * @description Notes explaining what the market table means where it refuses.
 * @param {object} R - The full run result.
 * @param {object} runs - The four market-priced runs.
 * @returns {string} The notes.
 */
function marketNotes(R, runs) {
  const inv = Object.fromEntries(R.marketInversions.map((m) => [m.runId, m.inversions]));
  const kit = inv['vb-market-dtc'];
  const box = inv['va-market-bigbox'];
  return [
    `**On the kit sold direct at ${usd(runs.vbDtc.model.waterfalls[0].shelfPriceMicros)}, the engine returns something stronger than a loss.** The maximum landed cost that price can carry at the target contribution is ${usd(kit.maxAffordableLandedUnitMicros)}, and no factory price reaches it — the engine's own words are that "freight, duty and handling alone already exceed the target landed cost; no factory price, not even zero, reaches it." Free goods would not rescue that configuration. Its break-even would take ${ratioPct(kit.breakEvenSellThroughRatio, 0)} sell-through of a run, which is more than everything made.`,
    '',
    `**On the big-box shelf the gap is large but finite.** The highest landed cost ${usd(runs.vaBox.model.waterfalls[0].shelfPriceMicros)} can carry is ${usd(box.maxAffordableLandedUnitMicros)}, against an actual landed cost of ${usd(box.actualLandedUnitMicros)}; the implied factory-gate ceiling is ${usd(box.maxAffordableFactoryUnitMicros)} against an actual ${usd(box.actualFactoryUnitMicros)}. The product would have to become roughly ${dec(box.actualFactoryUnitMicros / box.maxAffordableFactoryUnitMicros, 1)}x cheaper to make.`,
    '',
    '_Break-even is reported only for the market-priced runs. In a cost-up run the price floats up with the cost to hold the contribution rate by construction, so its break-even volume is an artefact of the pricing rule and means nothing._',
  ].join('\n');
}

/**
 * @description The most likely failure, argued from the sweep and the dataset's
 *   own unresolved gates.
 * @param {object} R - The full run result.
 * @returns {string} The section.
 */
function mostLikelyFailure(R) {
  const bars = R.cashSweep.sweep.bars;
  const top = bars[0];
  const ds = R.ds;
  const tg5 = ds.technicalGates.find((g) => g.id === 'TG-5');
  const r6 = ds.criticalRisks.find((r) => r.id === 'R-6');
  const b04 = ds.bom.find((b) => b.id === 'B-04');
  const projectorRank = bars.findIndex((b) => b.assumptionId === 'B-04') + 1;
  const projector = projectorRank > 0 ? bars[projectorRank - 1] : null;
  // THE HEADLINE IS DERIVED, NOT ASSERTED. An earlier version hardcoded "it is not
  // the money, it is the projector" and then spliced in whichever driver the sweep
  // happened to return as its supporting evidence — which in one run was ocean
  // transit time, described as "the part in that band". A real computed number
  // presented as proof of a claim it does not support is worse than no number.
  const topIsProjector = top.assumptionId === 'B-04';
  return [
    topIsProjector
      ? '**It is not the money. It is the projector.**'
      : `**The money and the part are two different risks, and the sweep ranks the money first.**`,
    '',
    topIsProjector
      ? `The sensitivity sweep puts \`${top.assumptionId}\` — ${cell(top.label)} — at the top on its own: swinging it across its researched range moves the peak cash requirement by ${usd0(top.swingMicros)}, more than any other input in the ledger.`
      : `The sensitivity sweep's top driver is \`${top.assumptionId}\` — ${cell(top.label)} — which moves the peak cash requirement by ${usd0(top.swingMicros)} across its researched range. That is a schedule-and-cash exposure, not a design one, and it is not the projector.${projector ? ` The projector cost band, \`B-04\`, ranks ${num(projectorRank)} on the same chart at ${usd0(projector.swingMicros)}.` : ''}`,
    '',
    `**The projector is nonetheless where the design can fail outright**, which is a different kind of risk from a number moving: the dataset's own geometry gate says the part in that price band may not exist at all. A standard mini projector of the class priced at ${usd(R.base.ledger.byId['B-04'].band.low)}–${usd(R.base.ledger.byId['B-04'].band.high)} is built around a 1.2–1.5:1 throw ratio, which does not close inside a six-foot envelope at the intended face size. ${cell(b04.note.split('.').slice(-3).join('.').trim())}`,
    '',
    `Three further failures are unresolved by any arithmetic in this plan and each of them is a plausible ending on its own:`,
    '',
    `1. **Moisture on the optics.** ${cell(tg5.verdict)} No number in this document addresses it.`,
    `2. **The software cannot run unattended.** ${cell(r6.impact)} Estimated at ${cell(String(ds.softwareBaseline.doesNotExistAndBlocksRetail[0].engineeringEstimateWeeks.low))}–${cell(String(ds.softwareBaseline.doesNotExistAndBlocksRetail[0].engineeringEstimateWeeks.high))} weeks, low confidence, with no scoping session held.`,
    `3. **Nobody has ever heard it.** Far-field speech capture over a continuously-running blower two to four feet away is entirely unmeasured. If it cannot hear a child from the walkway, the headline feature does not work and the product is an expensive light.`,
  ].join('\n');
}

/**
 * @description The pilot-volume section. The operator asked specifically what
 *   happens at volumes a first-timer can reach, and the answer is worse.
 * @param {object} R - The full run result.
 * @param {object} pilot - The pilot-volume run.
 * @returns {string} The section.
 */
function firstTimerSection(R, pilot) {
  const full = R.base;
  const pre = R.preRevenue[pilot.spec.id];
  const uplift = R.base.ledger.byId['A-VOL-2-UPLIFT'];
  return [
    `Every cost band in the dataset is stated at a ${num(full.model.bom.runQtyUnits)}-unit order. A first-time vendor with no production history rarely places one. At the dataset's own pilot volume of ${num(pilot.model.bom.runQtyUnits)} units, with the stated ${ratioPct(uplift.band.low, 0)}–${ratioPct(uplift.band.high, 0)} small-run cost uplift applied:`,
    '',
    pilotTable(R, pilot, full),
    '',
    `The pilot lowers the cheque — ${usd0(-pre.totalMicros)} committed before revenue instead of ${usd0(-R.preRevenue[full.spec.id].totalMicros)} — and it raises the price the product would have to fetch to ${usd(pilot.model.waterfalls[0].shelfPriceMicros)}, which is further above every observed ceiling than the full run was. **Smaller is safer and less viable at the same time**, and that is the trap a seasonal hardgood sets for a first-timer: the order size that makes the risk survivable is the order size at which the unit economics stop working.`,
    '',
    `No component minimum order quantity is modelled anywhere in this plan, because none has been quoted. At pilot volume a supplier minimum is one of the likeliest sources of overbuy, so the pilot figures above are optimistic rather than conservative.`,
  ].join('\n');
}

/**
 * @description Pilot-versus-production comparison.
 * @param {object} R - The full run result.
 * @param {object} pilot - The pilot run.
 * @param {object} full - The production run.
 * @returns {string} A markdown table.
 */
function pilotTable(R, pilot, full) {
  const row = (label, a, b) => [label, a, b];
  const rows = [
    row('Run quantity', num(full.model.bom.runQtyUnits), num(pilot.model.bom.runQtyUnits)),
    row('Factory cost per unit', usd(full.model.bom.recurringUnitMicros), usd(pilot.model.bom.recurringUnitMicros)),
    row('Landed cost per unit', usd(full.model.landed.buyerUnitMicros), usd(pilot.model.landed.buyerUnitMicros)),
    row('Tooling and NRE for the run', usd(full.model.bom.oneTimeMicros), usd(pilot.model.bom.oneTimeMicros)),
    row('Tooling amortised per unit', usd(full.model.bom.amortizedUnitMicros), usd(pilot.model.bom.amortizedUnitMicros)),
    row('Required shelf price at 25.0% contribution', usd(full.model.waterfalls[0].shelfPriceMicros), usd(pilot.model.waterfalls[0].shelfPriceMicros)),
    row('Committed before first revenue', usd0(-R.preRevenue[full.spec.id].totalMicros), usd0(-R.preRevenue[pilot.spec.id].totalMicros)),
    row('Peak cash requirement', usd0(full.model.financials.peakCash.fundingRequiredMicros), usd0(pilot.model.financials.peakCash.fundingRequiredMicros)),
    row('Containers shipped', num(full.model.landed.containers), num(pilot.model.landed.containers)),
  ];
  return table(['', 'Production run', 'Pilot run'], rows, ['l', 'r', 'r']);
}

/**
 * @description The inversion document: what would have to be true.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function whatWouldHaveToBeTrue(R) {
  return doc([
    '# What would have to be true',
    C.posture(R, R.base),
    'Every figure below was produced by rebuilding the entire model at a different value of one input and reading the answer off it — not by rearranging a formula. Where a crossing exists it was bracketed by sampling before it was bisected, so no number here is a confident answer to a question whose answer lies outside the range anybody has evidence for.',
    '## The three named break-evens',
    namedBreakevensTable(R),
    '## What each driver would have to become',
    'For each market-priced configuration, the value at which contribution per unit reaches zero — and, where no value inside the researched range reaches it, the plain statement that none does.',
    crossingsTable(R),
    crossingsNotes(R),
    '## What is already true, and what it is worth',
    alreadyTrueSection(R),
    '## The order to buy evidence in',
    buyEvidenceSection(R),
    C.footer(R),
  ]);
}

/**
 * @description The three always-present inversion rows for every market run.
 * @param {object} R - The full run result.
 * @returns {string} A markdown table.
 */
function namedBreakevensTable(R) {
  const rows = R.marketInversions.map(({ runId, run, inversions: i }) => [
    cell(runId), usd(i.shelfPriceMicros),
    i.maxAffordableLandedUnitMicros === null ? '**unreachable**' : usd(i.maxAffordableLandedUnitMicros),
    usd(i.actualLandedUnitMicros),
    i.maxAffordableFactoryUnitMicros === null ? '**impossible — no factory price reaches it**' : usd(i.maxAffordableFactoryUnitMicros),
    usd(i.actualFactoryUnitMicros),
    i.breakEvenSellThroughRatio === null ? '**none exists**' : ratioPct(i.breakEvenSellThroughRatio, 0),
    i.minViableVolumeUnits === null ? '**none exists**' : num(i.minViableVolumeUnits),
  ]);
  return table(
    ['Scenario', 'Shelf price', 'Max landed cost it carries', 'Actual landed', 'Max factory price', 'Actual factory', 'Break-even sell-through', 'Minimum viable volume'],
    rows, ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
  );
}

/**
 * @description The driver-crossing table.
 * @param {object} R - The full run result.
 * @returns {string} A markdown table.
 */
function crossingsTable(R) {
  const rows = R.crossings.map((c) => {
    const fmt = (v) => (c.unit === 'micros' ? usd(v) : c.unit === 'bps' ? pct(v) : dec(v, 3));
    const answer = c.crossing === null
      ? (c.reason === 'always-positive' ? 'already clears at every value in range' : '**no value in range clears it**')
      : fmt(c.crossing);
    return [
      cell(c.runId), cell(c.assumptionId), cell(c.label),
      `${fmt(c.band.low)} – ${fmt(c.band.high)}`, fmt(c.baseValue),
      usd(c.baseContributionMicros), answer,
      c.crossing === null && c.reason === 'never-positive' ? usd(c.bestContributionMicros) : '—',
    ];
  });
  return table(
    ['Scenario', 'Driver', 'What it is', 'Researched range', 'Modelled at', 'Contribution now', 'Value at which contribution reaches zero', 'Best the range can do'],
    rows, ['l', 'l', 'l', 'l', 'r', 'r', 'r', 'r'],
  );
}

/**
 * @description Prose reading of the crossings.
 * @param {object} R - The full run result.
 * @returns {string} The notes.
 */
function crossingsNotes(R) {
  const kitCac = R.crossings.find((c) => c.runId === 'vb-market-dtc' && c.assumptionId === 'CH-1-CAC');
  const boxProj = R.crossings.find((c) => c.runId === 'va-market-bigbox' && c.assumptionId === 'B-04');
  const boxDuty = R.crossings.find((c) => c.runId === 'va-market-bigbox' && c.assumptionId === 'A-DUT-3');
  const boxMargin = R.crossings.find((c) => c.runId === 'va-market-bigbox' && c.assumptionId === 'A-CH-6');
  return [
    `**The kit at the incumbent's price cannot be rescued by any single driver.** Customer acquisition at its cheapest researched value still leaves it at ${usd(kitCac.bestContributionMicros)} a unit; outbound shipping at its cheapest leaves it there too; and the envelope at its cheapest only improves it to ${usd(R.crossings.find((c) => c.runId === 'vb-market-dtc' && c.assumptionId === 'B-01').bestContributionMicros)}. Three independent levers, each pulled to the best value anybody has researched, and none of them crosses zero.`,
    '',
    `**The big-box shelf has exactly one lever that crosses.** The projector would have to fall from ${usd(boxProj.baseValue)} to ${usd(boxProj.crossing)} — inside the researched band, and therefore not obviously impossible. But that band is the one the dataset flags as unsafe until a supplier confirms a short-throw lens exists in it at all, so the lever that works is attached to the question nobody has answered.`,
    '',
    `**Tariff classification alone does not save it.** Contribution reaches zero at an applied rate of ${pct(boxDuty.crossing)}, and neither published rate is that: the two candidates are ${pct(boxDuty.band.low)} and ${pct(boxDuty.band.high)}. Winning the favourable classification is worth real money and is worth pursuing, but it does not on its own make the shelf reachable.`,
    '',
    `**Retailer margin is not negotiable enough to matter.** ${boxMargin.crossing === null ? `No value across the researched ${pct(boxMargin.band.low)}–${pct(boxMargin.band.high)} range reaches zero contribution; the best the range does is ${usd(boxMargin.bestContributionMicros)} a unit.` : `Contribution reaches zero at ${pct(boxMargin.crossing)}.`} A first-time vendor with no listing, no certification and no production history is in any case not the party who sets that number.`,
  ].join('\n');
}

/**
 * @description What already exists, and what it removes from the build.
 * @param {object} R - The full run result.
 * @returns {string} The section.
 */
function alreadyTrueSection(R) {
  const ds = R.ds;
  const rows = ds.softwareBaseline.exists.map((e) => [cell(e.id), cell(e.what), cell(e.evidence), cell(e.confidence)]);
  return [
    'The software half of this product is not a plan. It runs today, in this platform, and it was established by reading the code rather than by asking anybody:',
    '',
    table(['Id', 'What exists', 'Evidence', 'Confidence'], rows),
    '',
    `That is the strongest thing the venture has, and it does not appear anywhere in the cost model — the engine prices physical goods, and every one of these lines costs nothing to reproduce. It is also why the software-only tier carries no landed cost at all.`,
  ].join('\n');
}

/**
 * @description The ranked order to buy evidence in, from the dataset's own list
 *   cross-checked against the computed sweep.
 * @param {object} R - The full run result.
 * @returns {string} The section.
 */
function buyEvidenceSection(R) {
  const swept = new Map(R.cashSweep.sweep.bars.map((b) => [b.assumptionId, b]));
  const rows = R.ds.openQuestionsRankedByLeverage.map((q) => {
    const ids = q.id.split('/').map((s) => s.trim());
    const bar = ids.map((id) => swept.get(id)).find(Boolean);
    return [
      String(q.rank), cell(q.id), cell(q.question), cell(q.settledBy),
      bar ? usd0(bar.swingMicros) : 'not a swept input',
    ];
  });
  return [
    'The dataset ranks its own open questions by leverage. The final column is this run\'s independent check: how far the corresponding assumption moves the peak cash requirement when the whole model is rebuilt at each end of its range. Where the two agree, the ranking is doing real work; where a question has no swept input, it is a question arithmetic cannot answer at all.',
    '',
    table(['Rank', 'Input', 'Question', 'What would settle it', 'Moves peak cash by'], rows),
    '',
    `The two highest-leverage questions cost almost nothing to answer: three supplier requests for quotation on a short-throw projector, and a customs classification opinion. Neither requires a prototype, tooling, a certification booking or a purchase order. **Every priced commitment in this plan can wait until both are answered**, and the ${usd0(-R.preRevenue[R.base.spec.id].totalMicros)} of pre-revenue spend should not begin until they are.`,
  ].join('\n');
}

/**
 * @description The stage-1 gate memo: whether the next tranche of spend is
 *   justified, judged against criteria stated numerically.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function gateMemo(R) {
  const criteria = gateCriteria(R);
  const failed = criteria.filter((c) => !c.pass);
  const rows = criteria.map((c) => [
    c.pass ? 'PASS' : '**FAIL**', cell(c.id), cell(c.criterion), cell(c.required), cell(c.actual),
  ]);
  return doc([
    '# Stage 1 gate memo — is the next tranche of spend justified?',
    C.posture(R, R.base),
    `**Recommendation: ${failed.length === 0 ? 'PROCEED to stage 2' : 'DO NOT COMMIT PRICED SPEND'}.** ${failed.length} of ${criteria.length} gate criteria fail.`,
    '## The criteria and where the plan stands',
    'Each criterion is a number, not a judgement, and each states the gap when it fails.',
    table(['Result', 'Id', 'Criterion', 'Required', 'Actual'], rows, ['c', 'l', 'l', 'l', 'r']),
    '## What this gate is actually deciding',
    gateNarrative(R, criteria, failed),
    '## What stage 1 should buy, and what it should not',
    gateActions(R),
    C.footer(R),
  ]);
}

/**
 * @description The gate criteria, evaluated against the models.
 * @param {object} R - The full run result.
 * @returns {Array<object>} Criterion results.
 */
function gateCriteria(R) {
  const box = R.byId['va-market-bigbox'];
  const dtc = R.byId['va-market-dtc'];
  const base = R.base;
  const nqShare = base.landed.shareRatio;
  const quoted = base.stats.byConfidence.quoted;
  const boxContribution = box.model.waterfalls[0].contributionPerUnitMicros;
  const dtcBe = dtc.model.breakEven.units;
  const runQty = dtc.model.bom.runQtyUnits;
  return [
    {
      id: 'G1-1', criterion: 'At least one route to market shows a positive contribution at an observed price',
      required: 'one or more', actual: `${R.runs.filter((r) => r.spec.mode === 'market' && r.model.waterfalls[0].contributionPerUnitMicros > 0).length} of ${R.runs.filter((r) => r.spec.mode === 'market').length}`,
      pass: R.runs.some((r) => r.spec.mode === 'market' && r.model.waterfalls[0].contributionPerUnitMicros > 0),
    },
    {
      id: 'G1-2', criterion: 'The retail-shelf route clears its own cost at the top observed shelf price',
      required: 'contribution above zero', actual: usd(boxContribution), pass: boxContribution > 0,
    },
    {
      id: 'G1-3', criterion: 'The viable route breaks even on less than 90% of the run',
      required: `${num(Math.floor(runQty * 0.9))} units or fewer`,
      actual: dtcBe === null ? 'no break-even' : `${num(dtcBe)} units`,
      pass: dtcBe !== null && dtcBe <= runQty * 0.9,
    },
    {
      id: 'G1-4', criterion: 'No more than half the landed cost rests on unquoted lines',
      required: '50.0% or less', actual: ratioPct(nqShare), pass: nqShare <= 0.5,
    },
    {
      id: 'G1-5', criterion: 'At least one cost line carries a real vendor quote',
      required: '1 or more', actual: `${quoted}`, pass: quoted >= 1,
    },
    {
      id: 'G1-6', criterion: 'Every product-killing technical gate is closed',
      required: 'zero open', actual: `${R.ds.technicalGates.filter((g) => /OPEN/.test(g.verdict)).length} open (${R.ds.technicalGates.filter((g) => /OPEN/.test(g.verdict)).map((g) => g.id).join(', ')})`,
      pass: R.ds.technicalGates.every((g) => !/OPEN/.test(g.verdict)),
    },
    {
      id: 'G1-7', criterion: 'The production run reaches the shelf before the selling window opens at every corner',
      required: 'zero scenarios late',
      actual: `${R.runs.filter((r) => r.model.schedule.criticalPath.weeksLate > 0).length} of ${R.runs.length} scenarios miss the window`,
      pass: R.runs.every((r) => r.model.schedule.criticalPath.weeksLate <= 0),
    },
    {
      id: 'G1-8', criterion: 'The software runs unattended for a full evening without a human at the device',
      required: 'yes', actual: 'no — a 24-hour sign-in cap ends the session mid-party', pass: false,
    },
  ];
}

/**
 * @description The narrative reading of the gate.
 * @param {object} R - The full run result.
 * @param {Array<object>} criteria - The criterion results.
 * @param {Array<object>} failed - The failing criteria.
 * @returns {string} The section.
 */
function gateNarrative(R, criteria, failed) {
  const pre = R.preRevenue[R.base.spec.id];
  return [
    `This gate is not deciding whether the idea is good. It is deciding whether to convert ${usd0(-pre.totalMicros)} of unspent option value into committed tooling, certification bookings and a purchase order, on a plan where ${ratioPct(R.base.landed.shareRatio)} of the landed cost has never been quoted by anybody.`,
    '',
    `${failed.length} criteria fail, and they fail in two distinct ways. **${criteria.filter((c) => !c.pass && ['G1-2', 'G1-3', 'G1-4', 'G1-5'].includes(c.id)).length} of them are about evidence** — no quote exists, so nothing is known to the standard a manufacturing commitment requires. Those are cheap to fix and fixing them is exactly what stage 1 is for. **The rest are about the product** — an open moisture gate, an unmeasured microphone, a projector whose required optics may not exist at the assumed price, and software that cannot yet run a full evening unattended. Those are not fixed by buying evidence; they are fixed by building something and testing it.`,
    '',
    `The one criterion that passes cleanly is the most important one to read carefully: a positive contribution exists, but only at the TOP of the comparable's own observed price band, on a single configuration, needing ${ratioPct(sellThroughOf(R, 'va-market-dtc'))} sell-through inside a six-week window, against a sell-through assumption that is registered as an outright guess. At the bottom of the same band — the identical comparable kit on a mass retailer's shelf at ${usd(R.byId['va-market-dtc-floor'].model.waterfalls[0].shelfPriceMicros)} — the configuration loses ${usd(-R.byId['va-market-dtc-floor'].model.waterfalls[0].contributionPerUnitMicros)} a unit and there is no sell-through that recovers it. **A single passing route with no demand evidence is not a business case; it is a hypothesis with a price attached.**`,
  ].join('\n');
}

/**
 * @description What the stage should and should not buy.
 * @param {object} R - The full run result.
 * @returns {string} The section.
 */
function gateActions(R) {
  const pre = R.preRevenue[R.base.spec.id];
  const byKind = Object.entries(pre.byKind).sort((a, b) => a[1] - b[1])
    .map(([kind, micros]) => [cell(kind), usd0(-micros)]);
  return [
    '**Buy, in this order, because each one can kill the venture on its own and none of them requires a commitment:**',
    '',
    '1. Three supplier requests for quotation on a short-throw projector at the production volume, specified in measured ANSI lumens with a test report and a stated throw ratio. Cost: sourcing time. This is the top bar of the sensitivity chart and the top of the dataset\'s own leverage ranking.',
    '2. A customs classification opinion, or a binding ruling request. Cost: a broker\'s fee, which no record in this dataset prices.',
    '3. A fabric sample and a light-meter reading on the rear-projection panel, which decides whether the product is visible at all.',
    '4. One prototype and an overnight dew-cycle test, plus a sound-pressure measurement at the microphone position with the blower running.',
    '',
    '**Do not commit, until those four are answered:**',
    '',
    table(['Commitment', 'Amount'], byKind, ['l', 'r']),
    '',
    `That total — ${usd0(-pre.totalMicros)} — is the cheque this gate is protecting, and every dollar of it is spent before a single unit sells in ${cell(pre.firstRevenueMonth || 'never')}. The four items above cost a fraction of it and can each independently prove the rest unnecessary.`,
    '',
    `**The one commitment that is safe to make now** is the tier with no bill of materials. It carries no tooling, no certification, no inventory, no tariff exposure and no seasonal cash trough, and the software it would sell already runs.`,
  ].join('\n');
}

module.exports = { decisionSummary, whatWouldHaveToBeTrue, gateMemo, verdictFor, ceilingFor };
