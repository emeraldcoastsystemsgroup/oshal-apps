/**
 * Bill of materials, manufacturing, supplier management, logistics and compliance.
 *
 * THE SUPPLY-CHAIN DOCUMENTS ARE WHERE A BUSINESS PLAN USUALLY STOPS BEING HONEST,
 * because they are the ones a reader is least equipped to check. So every table
 * here carries the provenance column: which lines rest on a quote, which rest on a
 * researched band, and which rest on nothing. For this venture the answer is
 * uniform and stark, and stating it in every table is the point.
 *
 * THE LANDED-COST DOCUMENT PRINTS BOTH TARIFF BRANCHES SIDE BY SIDE and never a
 * blended figure. The dataset forbids a single landed cost while the classification
 * is unresolved, and the reason is arithmetic rather than caution: the spread
 * between the two published rates is larger than the target margin on the product.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the costed BOM roll-up with per-line provenance, the manufacturing and supplier-management plans built from the engine's own supplier terms, the dual-branch landed-cost stack, and the certification plan with its cost-down levers and the marketing-copy branch.
 */
'use strict';

const { usd, usd0, pct, ratioPct, num, dec, table, cell, doc } = require('../format');
const C = require('./common');

/**
 * @description The costed bill of materials.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function billOfMaterials(R) {
  const run = R.base;
  const kit = R.byId['vb-mid-8528-dtc'];
  return doc([
    '# Bill of materials',
    C.posture(R, run),
    C.scenarioLine(run),
    '## The roll-up',
    bomTable(R, run),
    bomNotes(R, run),
    '## The same product across the three cost corners',
    'A 2.85x-wide band collapsed to a midpoint destroys the only honest thing about it, so every corner is computed rather than averaged.',
    cornerTable(R),
    '## The value tier',
    `The customer-supplies-the-projector kit removes the four highest-value lines. ${C.scenarioLine(kit)}`,
    bomTable(R, kit),
    '## What every one of these numbers is worth',
    provenanceNote(R, run),
    C.footer(R),
  ]);
}

/**
 * @description One run's costed BOM lines, with provenance per line.
 * @param {object} R - The full run result.
 * @param {object} run - The run.
 * @returns {string} A markdown table.
 */
function bomTable(R, run) {
  const m = run.model;
  const nq = new Set(Object.values(run.meta).filter((x) => x.needsQuote).map((x) => x.id));
  const total = m.runRecurringMicros || m.bom.runRecurringMicros;
  const rows = m.bom.lines.map((l) => {
    const a = run.ledger.byId[l.componentId];
    const share = total > 0 ? l.extendedMicros / total : 0;
    return [
      cell(l.componentId), cell(l.name),
      dec(l.effectiveQtyPerUnit, 4), num(l.purchaseQty),
      usd(l.bandUnitCostMicros), usd0(l.extendedMicros), ratioPct(share),
      l.oneTimeMicros ? usd0(l.oneTimeMicros) : '—',
      a ? cell(a.confidence) : '—',
      l.assumptionRefs.some((r) => nq.has(r)) ? '**never quoted**' : 'sourced',
    ];
  });
  rows.push([
    '', '**Total**', '', '', '', `**${usd0(m.bom.runRecurringMicros)}**`, '100.0%',
    `**${usd0(m.bom.oneTimeMicros)}**`, '', `**${ratioPct(run.exWorks.shareRatio)} unquoted**`,
  ]);
  rows.push([
    '', '**Per unit**', '', '', `**${usd(m.bom.recurringUnitMicros)}**`, '', '',
    `**${usd(m.bom.amortizedUnitMicros)}** amortised`, '',
    `**${usd(m.bom.fullyLoadedUnitMicros)}** fully loaded`,
  ]);
  return table(
    ['Id', 'Component', 'Qty/unit', 'Purchase qty', 'Unit cost', 'Extended', 'Share', 'Tooling', 'Confidence', 'Provenance'],
    rows, ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'l', 'l'],
  );
}

/**
 * @description Notes on the roll-up.
 * @param {object} R - The full run result.
 * @param {object} run - The run.
 * @returns {string} The notes.
 */
function bomNotes(R, run) {
  const m = run.model;
  const top = [...m.bom.lines].sort((a, b) => b.extendedMicros - a.extendedMicros).slice(0, 3);
  const scrap = run.ledger.byId['M-SCRAP'];
  const assy = run.ledger.byId['M-ASSY'];
  return [
    `**Three lines are ${ratioPct(top.reduce((s, l) => s + l.extendedMicros, 0) / m.bom.runRecurringMicros)} of the factory cost:** ${top.map((l) => `${cell(l.name)} at ${usd(l.bandUnitCostMicros)}`).join(', ')}. All three are flagged in the dataset as never quoted.`,
    '',
    `**Quantities are scrap-adjusted upward, not downward.** At a ${ratioPct(scrap.value)} scrap rate you buy ${dec(1 / (1 - scrap.value), 4)} parts for every one that ships, so the purchase quantity for a ${num(m.bom.runQtyUnits)}-unit run is ${num(m.bom.lines[0].purchaseQty)} of each single-quantity part. The scrap rate itself is not in the dataset; it is registered by this run with a ${ratioPct(scrap.band.low)}–${ratioPct(scrap.band.high)} range, and a real contract-manufacturer quote states one.`,
    '',
    `**Tooling is never folded into the unit cost.** ${usd0(m.bom.oneTimeMicros)} of tooling is a separate line, and the ${usd(m.bom.amortizedUnitMicros)} per-unit amortisation is shown as derived rather than treated as a marginal cost — spreading it across a run that has not sold yet is how a plan quietly makes its gross margin look better than it is. One tool is bought per run because no tool-life figure exists.`,
    '',
    `**A final assembly and integration charge is carried at ${usd(assy.value)} with a ${usd(assy.band.low)}–${usd(assy.band.high)} range**, because the dataset prices components but no assembly. If the contract manufacturer quotes integration separately, this line is not zero, and it is the difference between this roll-up and the dataset's own hand-check.`,
    '',
    `**No supplier minimum order quantity is modelled anywhere**, because none has been quoted. That makes every figure in this table optimistic rather than conservative at low volume.`,
  ].join('\n');
}

/**
 * @description Factory and landed cost at each corner and branch.
 * @param {object} R - The full run result.
 * @returns {string} A markdown table.
 */
function cornerTable(R) {
  const ids = ['va-low-9505-dtc', 'va-mid-9505-dtc', 'va-mid-8528-dtc', 'va-high-8528-dtc',
    'vb-low-9505-dtc', 'vb-mid-9505-dtc', 'vb-mid-8528-dtc'];
  const rows = ids.map((id) => {
    const r = R.byId[id];
    const m = r.model;
    return [
      cell(id), cell(r.spec.variantId), cell(r.spec.corner), cell(r.spec.branchId),
      usd(m.bom.recurringUnitMicros), usd0(m.bom.oneTimeMicros),
      usd(m.landed.buyerUnitMicros), pct(m.landed.effectiveDutyBps),
      usd(m.waterfalls[0].shelfPriceMicros),
    ];
  });
  return table(
    ['Scenario', 'Tier', 'Corner', 'Tariff', 'Factory/unit', 'Tooling', 'Landed/unit', 'Effective duty', 'Required shelf price'],
    rows, ['l', 'l', 'l', 'l', 'r', 'r', 'r', 'r', 'r'],
  );
}

/**
 * @description The blunt provenance statement each supply document repeats.
 * @param {object} R - The full run result.
 * @param {object} run - The run.
 * @returns {string} The note.
 */
function provenanceNote(R, run) {
  return [
    `${ratioPct(run.exWorks.shareRatio)} of the factory cost and ${ratioPct(run.landed.shareRatio)} of the landed cost of this configuration rests on lines no supplier, broker or laboratory has ever quoted. ${num(run.stats.byConfidence.quoted)} of the ${num(run.stats.total)} registered assumptions carry a vendor quote.`,
    '',
    `The dataset states that this share is "the honest confidence in the whole plan", and this document set computes it from the flags rather than asserting it. **Three supplier requests for quotation would move it more than any amount of further analysis.**`,
  ].join('\n');
}

/**
 * @description The manufacturing plan.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function manufacturingPlan(R) {
  const run = R.base;
  const m = run.model;
  const lead = run.ledger.byId['M-LEAD'];
  const qual = run.ledger.byId['M-QUAL'];
  const rows = [
    ['Production run', num(m.bom.runQtyUnits), 'Set by the dataset\'s stated first-order volume, which is not derived from any demand forecast'],
    ['Purchase quantity per single-quantity part', num(m.bom.lines[0].purchaseQty), 'Run quantity uplifted for scrap'],
    ['Smallest run no supplier minimum inflates', num(m.bom.moqConstrainedRunUnits), 'Zero minimums are modelled, so this is not a real constraint yet'],
    ['Longest qualification plus lead time', `${num(m.bom.longestLeadWeeks)} weeks`, `Driven by \`${cell(m.bom.longestLeadComponentId)}\``],
    ['Tooling and non-recurring engineering', usd0(m.bom.oneTimeMicros), 'Two moulded parts; no tool exists'],
    ['Rounding residual across the roll-up', usd(m.bom.roundingResidualMicros), 'Surfaced rather than hidden; the per-unit figure times the run does not equal the run total exactly'],
  ];
  return doc([
    '# Manufacturing plan',
    C.posture(R, run),
    C.scenarioLine(run),
    '## The production parameters the model computed on',
    table(['', 'Value', 'Basis'], rows, ['l', 'r', 'l']),
    '## What is actually being manufactured',
    manufacturingNarrative(R, run),
    '## The two moulded parts',
    toolingTable(R, run),
    '## Lead time, and the reason it is the binding constraint',
    [
      `Component production lead time is registered at ${num(lead.value)} weeks with a ${num(lead.band.low)}–${num(lead.band.high)} week range, and supplier qualification at ${num(qual.value)} weeks with a ${num(qual.band.low)}–${num(qual.band.high)} week range. **Neither is in the dataset.** Both were minted by this run because the engine cannot schedule a production order without them, and both are flagged accordingly.`,
      '',
      `That matters more than it looks. At the high corner of both ranges the critical path becomes ${num(R.byId['va-high-8528-dtc'].model.bom.longestLeadWeeks)} weeks, and the engine **blocks** the scenario: goods reach the warehouse in ${cell(R.byId['va-high-8528-dtc'].model.schedule.criticalPath.goodsAvailableMonth)} against a window that opens in ${cell(R.base.input.season.sellWindowStart)}. A seasonal product that arrives after Halloween has not made a smaller profit; it has made no revenue and holds a full run of inventory with near-zero residual value.`,
      '',
      `**Two of the eight questions this plan cannot answer are lead times nobody has stated.** A single conversation with one contract manufacturer would replace both.`,
    ].join('\n'),
    '## Quality and yield',
    [
      `No yield figure, no first-pass-yield target, no inspection plan and no acceptable quality limit exists anywhere in this dataset. The model carries a scrap rate of ${ratioPct(run.ledger.byId['M-SCRAP'].value)} with a ${ratioPct(run.ledger.byId['M-SCRAP'].band.low)}–${ratioPct(run.ledger.byId['M-SCRAP'].band.high)} range purely so the arithmetic has something to work with, and that range appears in the sensitivity chart as ${usd0(R.cashSweep.sweep.bars.find((b) => b.assumptionId === 'M-SCRAP').swingMicros)} of movement in the peak cash requirement.`,
      '',
      `For a product whose failure mode is condensation on an optical surface after six unattended hours outdoors, the absence of any inspection plan is not a documentation gap. It is the gap.`,
    ].join('\n'),
    C.footer(R),
  ]);
}

/**
 * @description What the product physically is.
 * @param {object} R - The full run result.
 * @param {object} run - The run.
 * @returns {string} The narrative.
 */
function manufacturingNarrative(R, run) {
  const ds = R.ds;
  const va = ds.variants.find((v) => v.id === 'V-A');
  const c1 = ds.competitors.find((c) => c.id === 'C-1');
  return [
    `${cell(va.description)}`,
    '',
    `**The physical form factor is not being invented.** ${cell(c1.whatItProvesForUs)}`,
    '',
    `What is being changed is the light engine. ${cell(c1.structuralNote)}`,
    '',
    `In manufacturing terms that means the venture is not developing an inflatable — it is specifying one, adding a purpose-made translucent panel to it, and integrating a projector, a compute module, an audio path and a power harness into a housing that has to survive a night outdoors. **The inflatable is the solved part. The integration is the venture.**`,
  ].join('\n');
}

/**
 * @description Tooling detail.
 * @param {object} R - The full run result.
 * @param {object} run - The run.
 * @returns {string} A markdown table.
 */
function toolingTable(R, run) {
  const rows = R.ds.bom.filter((b) => b.toolingCostBand).map((b) => {
    const a = run.ledger.byId[`${b.id}-TOOLING`];
    return [
      cell(b.id), cell(b.component), cell(b.variantIds.join(', ')),
      a ? usd(a.value) : '—',
      a ? `${usd(a.band.low)} – ${usd(a.band.high)}` : '—',
      cell(b.toolingNote || ''),
    ];
  });
  return table(['Id', 'Part', 'Tiers', 'Modelled tooling', 'Range', 'Note'], rows, ['l', 'l', 'l', 'r', 'l', 'l']);
}

/**
 * @description The supplier plan.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function supplierPlan(R) {
  const run = R.base;
  const suppliers = new Map();
  for (const line of run.model.bom.lines) {
    if (!suppliers.has(line.supplierId)) suppliers.set(line.supplierId, { id: line.supplierId, lines: [], spend: 0 });
    const s = suppliers.get(line.supplierId);
    s.lines.push(line);
    s.spend += line.extendedMicros;
  }
  const total = run.model.bom.runRecurringMicros;
  const rows = [...suppliers.values()].sort((a, b) => b.spend - a.spend).map((s) => [
    cell(s.id), num(s.lines.length), cell(s.lines.map((l) => l.componentId).join(', ')),
    usd0(s.spend), ratioPct(total > 0 ? s.spend / total : 0),
    s.lines.length === 1 ? '**single source, single line**' : 'single source',
    'not contacted',
  ]);
  return doc([
    '# Supplier plan and supplier-relationship management',
    C.posture(R, run),
    C.scenarioLine(run),
    '## Every supplier in this plan',
    `**There are none.** Every entry below is a category of supplier the product needs, not a company anybody has spoken to. The engine records all of them as unqualified and warns on every line accordingly — ${num(run.model.issues.filter((i) => i.code === 'supplier-unqualified').length)} warnings in this scenario.`,
    '',
    table(['Supplier category', 'Lines', 'Components', 'Run spend', 'Share', 'Sourcing risk', 'Status'], rows, ['l', 'r', 'l', 'r', 'r', 'l', 'l']),
    '## Payment terms and what they do to cash',
    paymentTermsSection(R, run),
    '## The request-for-quotation package',
    rfqSection(R, run),
    '## Single-source exposure',
    singleSourceSection(R, run),
    C.footer(R),
  ]);
}

/**
 * @description Supplier payment terms and their cash consequence.
 * @param {object} R - The full run result.
 * @param {object} run - The run.
 * @returns {string} The section.
 */
function paymentTermsSection(R, run) {
  const dep = run.ledger.byId['A-WC-1-DEPOSIT'];
  const events = run.model.schedule.events.filter((e) => e.kind === 'po-deposit' || e.kind === 'po-balance');
  const rows = events.map((e) => [cell(e.month), cell(e.kind), usd0(e.amountMicros), cell(e.note)]);
  return [
    `The dataset states first-order terms for a new buyer plainly: ${pct(dep.value)} deposit on order, the balance on bill of lading, and no net terms. Modelled exactly that way:`,
    '',
    table(['Month', 'Event', 'Amount', 'Note'], rows, ['l', 'l', 'r', 'l']),
    '',
    `**The factory is paid in full before the goods have left the water.** That is the first half of the seasonal cash trap; the second half is that a retailer pays 60 to 90 days after Halloween. See the cash-flow document.`,
  ].join('\n');
}

/**
 * @description What a request for quotation must actually ask for.
 * @param {object} R - The full run result.
 * @param {object} run - The run.
 * @returns {string} The section.
 */
function rfqSection(R, run) {
  const ds = R.ds;
  const optics = ds.assumptions.find((a) => a.id === 'A-OPT-1');
  const b04 = ds.bom.find((b) => b.id === 'B-04');
  return [
    'Three quotations on the projector line are the highest-leverage action available to this venture, and a badly-written request produces a number that is worse than none because it looks like evidence.',
    '',
    `**Specify the projector in measured ANSI lumens with a test report, and refuse anything else.** ${cell(optics.dataQualityWarning)}`,
    '',
    `**State the throw ratio as a requirement, not a preference.** ${cell(b04.spec)}`,
    '',
    `**Ask every supplier for the four things the model is missing**, because each of them is registered here as a guess: the minimum order quantity, the production lead time, the qualification and first-article time, and the assembly or integration charge if it is quoted separately from components.`,
    '',
    `**Ask what the price is at ${num(R.byId['va-pilot-500-dtc'].model.bom.runQtyUnits)} units as well as at ${num(run.model.bom.runQtyUnits)}.** The dataset's own small-run uplift of ${ratioPct(run.ledger.byId['A-VOL-2-UPLIFT'].band.low, 0)}–${ratioPct(run.ledger.byId['A-VOL-2-UPLIFT'].band.high, 0)} is an estimate, and the pilot economics turn on it.`,
  ].join('\n');
}

/**
 * @description Single-source exposure.
 * @param {object} R - The full run result.
 * @param {object} run - The run.
 * @returns {string} The section.
 */
function singleSourceSection(R, run) {
  const b05 = R.ds.bom.find((b) => b.id === 'B-05');
  return [
    'Every component in this plan has exactly one source, because every component has zero sources. Two are worth naming separately:',
    '',
    `- **The projector.** It is the largest line, the top of the sensitivity chart, and the one whose required specification may not exist in its assumed price class at all. A second source is not a resilience measure here; it is the primary evidence-gathering exercise.`,
    `- **The compute module.** ${cell(b05.note)}`,
    '',
    `A seasonal product has one shipment a year and no chance to recover from a supplier failure inside the season. The dataset's schedule places the last usable purchase-order date at ${cell(run.model.schedule.criticalPath.latestPoMonth)}; after that a supplier problem does not delay the season, it removes it.`,
  ].join('\n');
}

/**
 * @description The logistics and landed-cost document, both branches side by side.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function logistics(R) {
  const adverse = R.byId['va-mid-8528-dtc'];
  const favourable = R.byId['va-mid-9505-dtc'];
  return doc([
    '# Logistics and landed cost',
    C.posture(R, adverse),
    '## Both tariff branches, never one',
    tariffBranchTable(R),
    tariffNarrative(R, adverse, favourable),
    '## The landed stack, adverse branch',
    C.scenarioLine(adverse),
    C.landedStackTable(adverse),
    '## The landed stack, favourable branch',
    C.scenarioLine(favourable),
    C.landedStackTable(favourable),
    '## Freight',
    freightSection(R, adverse),
    '## What is missing from this stack',
    [
      'Every leg above except the goods themselves rests on a rate this run registered rather than one the dataset supplied: marine insurance, the customs broker\'s entry fee, drayage and receiving. Each carries a range and each appears in the sensitivity chart. **None of them is large enough to change the verdict**, which is worth saying plainly rather than leaving a reader to wonder whether the logistics detail is where the answer hides. It is not; the answer is in the bill of materials and the channel.',
      '',
      'The one genuinely consequential logistics number is the tariff, and it is not a logistics question at all — it is a legal classification question that costs a broker\'s opinion to settle and moves more money than every other leg combined.',
    ].join('\n'),
    C.footer(R),
  ]);
}

/**
 * @description The two-branch comparison.
 * @param {object} R - The full run result.
 * @returns {string} A markdown table.
 */
function tariffBranchTable(R) {
  const pairs = [
    ['V-A self-contained', 'va-mid-9505-dtc', 'va-mid-8528-dtc'],
    ['V-B kit', 'vb-mid-9505-dtc', 'vb-mid-8528-dtc'],
  ];
  const rows = pairs.map(([label, favId, advId]) => {
    const fav = R.byId[favId].model;
    const adv = R.byId[advId].model;
    const dutyLeg = (m) => (m.landed.legs.find((l) => l.key === 'duty') || { perUnitMicros: 0 }).perUnitMicros
      + (m.landed.legs.find((l) => l.key === 'additionalTariff') || { perUnitMicros: 0 }).perUnitMicros;
    return [
      cell(label),
      usd(dutyLeg(fav)), usd(fav.landed.buyerUnitMicros), pct(fav.landed.effectiveDutyBps),
      usd(dutyLeg(adv)), usd(adv.landed.buyerUnitMicros), pct(adv.landed.effectiveDutyBps),
      usd(adv.landed.buyerUnitMicros - fav.landed.buyerUnitMicros),
    ];
  });
  return table(
    ['Tier', 'Duty/unit (9505)', 'Landed (9505)', 'Effective rate', 'Duty/unit (8528)', 'Landed (8528)', 'Effective rate', 'Spread per unit'],
    rows, ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
  );
}

/**
 * @description Why the branch matters more than any other logistics number.
 * @param {object} R - The full run result.
 * @param {object} adverse - The adverse-branch run.
 * @param {object} favourable - The favourable-branch run.
 * @returns {string} The section.
 */
function tariffNarrative(R, adverse, favourable) {
  const spread = adverse.model.landed.buyerUnitMicros - favourable.model.landed.buyerUnitMicros;
  const contribution = R.byId['va-market-dtc'].model.waterfalls[0].contributionPerUnitMicros;
  const a = R.ds.assumptions.find((x) => x.id === 'A-DUT-3');
  const cross = R.crossings.find((c) => c.runId === 'va-market-bigbox' && c.assumptionId === 'A-DUT-3');
  return [
    `**${usd(spread)} per unit turns on a question nobody has asked a customs broker.** ${cell(a.whyItMatters)}`,
    '',
    `For scale: on the only market-priced configuration that clears its cost, contribution per unit is ${usd(contribution)}. The classification spread is ${dec(spread / contribution, 2)}x that figure. **The unresolved tariff question is larger than the entire margin on the product.**`,
    '',
    `The engine models the projector branch with no most-favoured-nation component at all, because the dataset states no base rate for it. That understates the adverse branch rather than overstating it, which is the direction an unresolved number should err in.`,
    '',
    `**Winning the favourable classification does not on its own rescue the retail shelf.** Contribution on the big-box configuration reaches zero at an applied rate of ${pct(cross.crossing)}, and neither candidate rate is that: they are ${pct(cross.band.low)} and ${pct(cross.band.high)}. The classification is worth real money and is worth settling before any purchase order — it is not a rescue.`,
    '',
    `**What would settle it:** ${cell(a.resolveBy)}`,
  ].join('\n');
}

/**
 * @description The freight section.
 * @param {object} R - The full run result.
 * @param {object} run - The run.
 * @returns {string} The section.
 */
function freightSection(R, run) {
  const m = run.model;
  const f = run.input.landed.freight;
  const cbm = run.ledger.byId['A-FRT-4'];
  const usable = run.ledger.byId['M-CONTAINER-CBM'];
  const rate = run.ledger.byId['A-FRT-3-LOADED'];
  const rows = [
    ['Boxed volume per unit', `${dec(cbm.value, 4)} CBM`, 'Estimated from a 24 x 16 x 14 inch carton; never measured'],
    ['Practically loadable container volume', `${dec(usable.value, 1)} CBM`, `Range ${dec(usable.band.low, 0)}–${dec(usable.band.high, 0)} CBM for a bulky light carton`],
    ['Units per container', num(f.unitsPerContainer), 'Loadable volume divided by boxed volume'],
    ['Containers for the run', num(m.landed.containers), `${ratioPct(m.landed.containerFillRatio)} filled`],
    ['Rate per container including surcharges', usd0(rate.value), `Base rate uplifted by the surcharge stack; range ${usd0(rate.band.low)}–${usd0(rate.band.high)}`],
    ['Freight per unit', usd((m.landed.legs.find((l) => l.key === 'oceanFreight') || {}).perUnitMicros), 'Whole containers divided across the run'],
  ];
  return [
    table(['', 'Value', 'Basis'], rows, ['l', 'r', 'l']),
    '',
    `**Freight is a step, not a slope.** ${num(m.landed.containers)} containers are bought for a run that fills ${ratioPct(m.landed.containerFillRatio)} of them; one more unit past a container boundary buys a whole container. That is why the break-even search reports the profit curve as non-monotone in volume and why a plan that treats freight as a per-unit rate gets the wrong answer at exactly the volumes a first-timer would consider.`,
    '',
    `**The surcharge stack is applied at the high end for a reason.** The dataset warns that the peak-season surcharge lands exactly when a Halloween product must ship, so the rate above is the base rate with the stack applied rather than a bare spot quote.`,
  ].join('\n');
}

/**
 * @description The compliance and certification plan.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function compliance(R) {
  const run = R.base;
  const ds = R.ds;
  const rows = ds.regulatory.map((r) => {
    const a = run.ledger.byId[r.id];
    const lead = r.leadTimeWeeksBand ? `${num(r.leadTimeWeeksBand.low)}–${num(r.leadTimeWeeksBand.high)} weeks`
      : r.leadTimeDaysBand ? `${num(r.leadTimeDaysBand.low)}–${num(r.leadTimeDaysBand.high)} days` : 'not stated';
    return [
      cell(r.id), cell(r.regime), cell(r.applies),
      a ? usd0(a.value) : '—', a ? `${usd0(a.band.low)} – ${usd0(a.band.high)}` : '—',
      lead, r.needsQuote ? '**never quoted**' : 'sourced',
    ];
  });
  const spend = Object.entries(run.input.fixedOpexByMonth).filter(([, v]) => v > 0);
  const spendRows = spend.map(([month, v]) => [cell(month), usd0(v)]);
  const total = spend.reduce((s, [, v]) => s + v, 0);
  spendRows.push(['**Total before any unit ships**', `**${usd0(total)}**`]);
  return doc([
    '# Compliance and certification',
    C.posture(R, run),
    '## Every regime that applies',
    table(['Id', 'Regime', 'Applies to', 'Modelled cost', 'Range', 'Lead time', 'Provenance'], rows, ['l', 'l', 'l', 'r', 'l', 'l', 'l']),
    '## When the money is spent',
    'Certification is not a line at the end of a plan; it is cash out months before a unit exists, and it is dated in the cash model accordingly.',
    '',
    table(['Month', 'Compliance spend'], spendRows, ['l', 'r']),
    '## The two cost-down levers that are sourcing decisions, not compliance decisions',
    costDownSection(R, ds),
    '## The branch decided by marketing copy',
    childrensProductSection(R, ds),
    '## What this document cannot say',
    [
      '**No claim of compliance with any standard appears anywhere in this document set, and none can.** Nothing has been tested, no laboratory has been engaged, and no certificate exists. Every figure above is a published cost range for work that has not been booked.',
      '',
      `The recurring cost is also understated: a safety listing carries annual factory follow-up inspection fees, which the dataset flags as needing a quote and does not price. They are not in the model, so every profit figure in this document set is optimistic by an unstated amount from year two onward.`,
      '',
      `And one regime is already live. Electronic filing of compliance certificates with customs took effect ahead of any plausible first shipment here; it is a customs-broker capability requirement rather than an optional nicety, and a broker without it cannot clear the entry.`,
    ].join('\n'),
    C.footer(R),
  ]);
}

/**
 * @description The certification cost-down levers.
 * @param {object} R - The full run result.
 * @param {object} ds - The dataset.
 * @returns {string} The section.
 */
function costDownSection(R, ds) {
  const fcc = ds.regulatory.find((r) => r.id === 'R-FCC');
  const safety = ds.regulatory.find((r) => r.id === 'R-SAFETY');
  const run = R.base;
  return [
    `**Radio certification: ${cell(fcc.costDownLever)}** The modelled cost is ${usd0(run.ledger.byId['R-FCC'].value)} against a ${usd0(run.ledger.byId['R-FCC'].band.low)}–${usd0(run.ledger.byId['R-FCC'].band.high)} range, and which end of that range applies is decided when the compute module is chosen — not when the certification is booked.`,
    '',
    `**Safety listing: ${cell(safety.costDownLever)}** The modelled cost is ${usd0(run.ledger.byId['R-SAFETY'].value)} against a ${usd0(run.ledger.byId['R-SAFETY'].band.low)}–${usd0(run.ledger.byId['R-SAFETY'].band.high)} range. The dataset notes that the power distribution and internal harness line is the assembly a listing actually evaluates, which makes it the one component where cheapening the part is how a certification failure happens.`,
    '',
    `Together these two levers are worth up to ${usd0((run.ledger.byId['R-FCC'].band.high - run.ledger.byId['R-FCC'].band.low) + (run.ledger.byId['R-SAFETY'].band.high - run.ledger.byId['R-SAFETY'].band.low))} of the pre-revenue spend, and both are decided by which components are bought.`,
  ].join('\n');
}

/**
 * @description The children's-product determination branch.
 * @param {object} R - The full run result.
 * @param {object} ds - The dataset.
 * @returns {string} The section.
 */
function childrensProductSection(R, ds) {
  const r = ds.regulatory.find((x) => x.id === 'R-CPSIA');
  const a = R.base.ledger.byId['R-CPSIA'];
  return [
    `**${cell(r.theTrap)}**`,
    '',
    `${cell(r.basis)}`,
    '',
    `Modelled at ${usd0(a.value)} per material per production lot, over a ${usd0(a.band.low)}–${usd0(a.band.high)} range — **per lot, not once**. The base scenario does not carry it, because the base scenario assumes the mitigation.`,
    '',
    `**The mitigation is a marketing constraint with a dollar value attached.** ${cell(r.mitigation)}`,
    '',
    `This is the single strangest finding in the plan and it is worth stating plainly: the product's most compelling sentence — a child talks to it and it answers — is also the sentence that may pull it into a testing regime, a certificate requirement and permanent tracking labels. **Get a compliance opinion on the packaging copy before the packaging is printed**, not after.`,
  ].join('\n');
}

module.exports = { billOfMaterials, manufacturingPlan, supplierPlan, logistics, compliance };
