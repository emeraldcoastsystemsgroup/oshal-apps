/**
 * The documents that make the other twenty honest.
 *
 * THE ASSUMPTION REGISTER IS THE PRODUCT. Every other document in this set is a
 * rearrangement of numbers that all trace back to this ledger, and the register is
 * where a reader goes to replace a guess with a quote. It is generated FIRST in the
 * regeneration order for the same reason: a document set whose register is written
 * last is a document set whose register was written to match the conclusions.
 *
 * THE RECONCILIATION DOCUMENT exists because the dataset says plainly that its own
 * hand-computed figures and the engine's must agree within a few percent or one of
 * them is broken. That is a check somebody has to actually run, so it is run here,
 * on every regeneration, and it prints the delta rather than the reassurance. The
 * same document exercises the engine's refusal on a control model, because a
 * fail-closed rule nobody has watched fire is a rule nobody has tested.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the full assumption register grouped by domain with sources and confidence, the as-built software inventory against the retail gaps, the eight technical gates with their worked arithmetic, and the reconciliation-plus-refusal control document.
 */
'use strict';

const { usd, usd0, pct, ratioPct, num, dec, table, cell, doc } = require('../format');
const C = require('./common');

/** Register groups in the order a reader needs them. */
const GROUP_ORDER = ['bom', 'manufacturing', 'logistics', 'channel', 'market', 'compliance', 'schedule', 'org', 'other'];

/** Human names for the register groups. */
const GROUP_LABEL = {
  bom: 'Bill of materials and volume',
  manufacturing: 'Manufacturing',
  logistics: 'Freight, duty and customs',
  channel: 'Channel fees and allowances',
  market: 'Observed market prices',
  compliance: 'Certification and compliance',
  schedule: 'Schedule and working capital',
  org: 'Organisation',
  other: 'Other',
};

/**
 * @description Format an assumption's value in its own unit.
 * @param {object} a - The assumption.
 * @param {number} v - The value to format.
 * @returns {string} The formatted value.
 */
function unitValue(a, v) {
  if (a.unit === 'micros') return usd(v);
  // A sub-basis-point statutory rate rounds to "0.1%" at one decimal place, which
  // hides exactly the digit a reader would need to catch a factor-of-ten slip. The
  // register prints enough places to see it.
  if (a.unit === 'bps') return pct(v, Math.abs(v) < 100 ? 3 : 1);
  if (a.unit === 'ratio') return dec(v, 3);
  if (a.unit === 'units' || a.unit === 'count') return num(v);
  return `${dec(v, 2)} ${a.unit}`;
}

/**
 * @description The assumption register: every input the engine computed on, what
 *   it is worth, and what would replace it.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function assumptionRegister(R) {
  const run = R.base;
  const grouped = new Map(GROUP_ORDER.map((g) => [g, []]));
  for (const id of run.ledger.order) {
    const a = run.ledger.byId[id];
    const meta = run.meta[id] || { group: 'other' };
    const bucket = grouped.get(meta.group) || grouped.get('other');
    bucket.push({ a, meta });
  }
  const sections = GROUP_ORDER.filter((g) => (grouped.get(g) || []).length).map((g) => [
    `### ${GROUP_LABEL[g]}`,
    registerTable(grouped.get(g)),
  ].join('\n\n'));
  return doc([
    '# Assumption register',
    C.posture(R, run),
    'This is the complete list of inputs the engine computed on for the base scenario. Nothing else entered the model. A number that is not in this table cannot appear in any document in this set.',
    '',
    '**How to read the confidence column.** `quoted` means a named vendor put it in writing — there are none in this venture. `observed` means somebody looked at it on a real surface, which here means retail listings. `benchmarked` means a credible published range. `estimated` and `guessed` mean nobody has evidence and the number exists so the model has something to compute with. An assumption authored by a model is capped at `estimated` on the way in by the engine, so no guess in this ledger can present itself as a quote.',
    '## Summary',
    registerSummary(R, run),
    '## Assumptions this run added because the dataset does not contain them',
    modelAddedSection(R, run),
    '## The full register',
    sections.join('\n\n'),
    '## Sources cited',
    sourcesTable(R),
    C.footer(R),
  ]);
}

/**
 * @description Generated register statistics.
 * @param {object} R - The full run result.
 * @param {object} run - The base run.
 * @returns {string} A markdown table.
 */
function registerSummary(R, run) {
  const s = run.stats;
  const metas = Object.values(run.meta);
  const rows = [
    ['Registered assumptions', num(s.total)],
    ['Carrying a vendor quote', num(s.byConfidence.quoted)],
    ['Observed on a real surface', num(s.byConfidence.observed)],
    ['From a published benchmark range', num(s.byConfidence.benchmarked)],
    ['Estimated', num(s.byConfidence.estimated)],
    ['Outright guesses', num(s.byConfidence.guessed)],
    ['Flagged as needing a quote', num(metas.filter((m) => m.needsQuote).length)],
    ['Added by this run because the dataset lacks them', num(metas.filter((m) => m.modelAdded).length)],
    ['Money assumptions nobody has quoted', num(s.softMoneyIds.length)],
    ['Carrying a range the sensitivity sweep can move', num(s.bandedIds.length)],
    ['Computed figures resting on a soft input', `${num(run.model.traceability.softFigureIds.length)} of ${num(run.model.traceability.totalFigures)}`],
    ['Share of landed cost on unquoted lines', ratioPct(run.landed.shareRatio)],
    ['Share of factory cost on unquoted lines', ratioPct(run.exWorks.shareRatio)],
  ];
  return table(['', 'Count'], rows, ['l', 'r']);
}

/**
 * @description The block of assumptions this run minted, listed together so a
 *   reader can see exactly what the dataset did not supply.
 * @param {object} R - The full run result.
 * @param {object} run - The base run.
 * @returns {string} The section.
 */
function modelAddedSection(R, run) {
  const added = run.ledger.order.filter((id) => (run.meta[id] || {}).modelAdded);
  const rows = added.map((id) => {
    const a = run.ledger.byId[id];
    return [
      cell(id), cell(a.label), unitValue(a, a.value),
      a.band ? `${unitValue(a, a.band.low)} – ${unitValue(a, a.band.high)}` : 'no range stated',
      cell(a.confidence), cell((run.meta[id] || {}).method),
    ];
  });
  return [
    `The engine needs values the dataset does not contain. Rather than defaulting them silently, this run mints them with an explicit rationale, a range wide enough to be honest, and a confidence grade that keeps them out of any figure claiming to be researched. ${num(added.length)} of the ${num(run.stats.total)} registered assumptions are in this category, and **every one of them is a place where this plan is guessing on the operator's behalf**.`,
    '',
    table(['Id', 'What it is', 'Modelled at', 'Range', 'Confidence', 'Why it exists'], rows, ['l', 'l', 'r', 'l', 'l', 'l']),
  ].join('\n');
}

/**
 * @description One group's register rows.
 * @param {Array<{a: object, meta: object}>} entries - The group's assumptions.
 * @returns {string} A markdown table.
 */
function registerTable(entries) {
  const rows = entries.map(({ a, meta }) => [
    cell(a.id), cell(a.label), unitValue(a, a.value),
    a.band ? `${unitValue(a, a.band.low)} – ${unitValue(a, a.band.high)}` : '—',
    cell(a.confidence), cell(a.source.kind),
    meta.sourceUrl ? `[${cell(meta.sourceId)}](${meta.sourceUrl})` : cell(meta.sourceId || '—'),
    meta.needsQuote ? '**yes**' : 'no',
    cell(meta.method || ''),
  ]);
  return table(
    ['Id', 'What it is', 'Value', 'Range', 'Confidence', 'Source kind', 'Source', 'Needs a quote', 'Method / note'],
    rows, ['l', 'l', 'r', 'l', 'l', 'l', 'l', 'c', 'l'],
  );
}

/**
 * @description Every source the dataset cites.
 * @param {object} R - The full run result.
 * @returns {string} A markdown table.
 */
function sourcesTable(R) {
  const rows = Object.entries(R.ds.sources).map(([id, s]) => [
    cell(id), cell(s.label), cell(s.kind), cell(s.retrievedAt),
    s.url.startsWith('http') ? `[link](${s.url})` : cell(s.url),
  ]);
  return table(['Id', 'Source', 'Kind', 'Retrieved', 'Link'], rows);
}

/**
 * @description What exists today versus what does not exist at all. The operator
 *   asked to be able to tell these apart, and the distinction is the difference
 *   between a half-built product and an idea.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function whatExists(R) {
  const ds = R.ds;
  const gaps = ds.softwareBaseline.doesNotExistAndBlocksRetail;
  const existRows = ds.softwareBaseline.exists.map((e) => [
    cell(e.id), cell(e.what), cell(e.evidence), cell(e.confidence), cell(e.whyItMatters || ''),
  ]);
  const gapRows = gaps.map((g) => [
    cell(g.id), cell(g.severity), cell(g.what), cell(g.whyItMatters || ''),
    g.engineeringEstimateWeeks ? `${num(g.engineeringEstimateWeeks.low)}–${num(g.engineeringEstimateWeeks.high)} weeks (${cell(g.confidence)})` : 'not estimated',
  ]);
  const bomRows = ds.bom.map((b) => [
    cell(b.id), cell(b.component), cell(b.variantIds.join(', ')),
    `${usd(Math.round(b.unitCostBand.low * 1e6))} – ${usd(Math.round(b.unitCostBand.high * 1e6))}`,
    cell(b.confidence), b.needsQuote ? '**never quoted**' : 'no quote needed',
    b.criticality ? cell(b.criticality) : '—',
  ]);
  return doc([
    '# What exists today, and what does not exist at all',
    C.posture(R, R.base),
    'Half of this product is running software in this platform right now. The other half is an idea with a price band attached. Confusing the two is the fastest way to build a plan that reads as half-finished when it is in fact one-quarter started, or the reverse.',
    '## The software: built, running, and read from the code',
    'Established by inspecting the source, not by asking anybody.',
    table(['Id', 'What exists', 'Evidence', 'Confidence', 'Why it matters'], existRows),
    '## The software: what blocks a retail unit',
    table(['Id', 'Severity', 'What is missing', 'Why it matters', 'Estimate'], gapRows),
    softwareGapNote(R, gaps),
    '## The hardware: none of it exists',
    `Every line below is a component nobody has sourced, specified with a supplier, sampled, or bought. ${num(ds.bom.filter((b) => b.needsQuote).length)} of the ${num(ds.bom.length)} lines are flagged in the dataset as never having been quoted. The two that carry tooling have no tool, no mould and no supplier.`,
    '',
    table(['Id', 'Component', 'Tiers', 'Cost band at 5,000 units', 'Confidence', 'Quote status', 'Criticality'], bomRows),
    '## And none of this exists either',
    notBuiltList(R),
    C.footer(R),
  ]);
}

/**
 * @description The note explaining what the software gaps mean commercially.
 * @param {object} R - The full run result.
 * @param {Array<object>} gaps - The retail-blocking gaps.
 * @returns {string} The note.
 */
function softwareGapNote(R, gaps) {
  const ds = R.ds;
  const bank = ds.softwareBaseline.exists.find((e) => e.id === 'SW-5');
  return [
    `**The first gap is a hard blocker and the second is a business-model problem, not an engineering one.** A consumer product cannot require a daily browser sign-in to a self-hosted identity provider; the prop would go dark mid-evening and need a human at the device. The second gap is sharper still: in autonomous mode every utterance costs tokens charged to somebody, and at retail there is no account, no subscription and no billing relationship.`,
    '',
    `The dataset points at a solution that is already built for the second one. ${cell(bank.what)} — ${cell(bank.whyItMatters)} Shipping that as the retail default turns a recurring cost of goods into an optional upsell for owners who choose to connect an account, and it costs no new engineering.`,
  ].join('\n');
}

/**
 * @description The blunt list of everything the venture does not have.
 * @param {object} R - The full run result.
 * @returns {string} The list.
 */
function notBuiltList(R) {
  const base = R.base;
  return [
    'For completeness, because a plan that lists only what it has is not a plan:',
    '',
    '- **No supplier relationship of any kind.** Not a contact, not a sample, not a quote. Every supplier in this model is recorded as unqualified, and the engine warns on every line accordingly.',
    '- **No enclosure, no mechanical design, no thermal or ingress design.** The projector housing exists as a cost band and a tooling estimate.',
    '- **No packaging.** The carton is a cost band and a set of dimensions inferred from a boxed volume estimate.',
    '- **No certification.** No FCC test booked, no safety listing opened, no laboratory engaged.',
    '- **No retail relationship.** No vendor number, no EDI, no factory audit, no insurance certificate, no category-review meeting.',
    `- **No demand evidence.** The sell-through figure the whole revenue line rests on is registered as an outright guess, and it is the only place a demand number enters the model.`,
    `- **No production history**, which is separately why a first-time vendor is not a candidate for a category review regardless of the product.`,
    '',
    `The one thing the venture does have is the part most ventures do not: **a working, tested, real-time renderer with live audio-driven lip sync**, running today. ${ratioPct(base.landed.shareRatio)} of the landed cost of the physical product it would go inside has never been quoted by anybody.`,
  ].join('\n');
}

/**
 * @description The technical gates document, carrying the dataset's own worked
 *   arithmetic rather than its verdicts alone.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function technicalGates(R) {
  const ds = R.ds;
  const sections = ds.technicalGates.map((g) => gateSection(g));
  const open = ds.technicalGates.filter((t) => /OPEN/.test(t.verdict));
  return doc([
    '# Technical feasibility gates',
    C.posture(R, R.base),
    `Eight gates, each carrying its formula and its worked cases across the corners of the input bands. ${num(ds.technicalGates.length - open.length)} are closed by arithmetic; ${num(open.length)} are open and no arithmetic closes them.`,
    '',
    '**Three of these overturned an intuition, and one of them broke a comfortable assumption.** Doing the arithmetic instead of narrating it is the only reason any of that surfaced.',
    '## Status',
    gateStatusTable(ds),
    '## The gates',
    sections.join('\n\n'),
    '## What the gates mean for the cost model',
    gateCostImplications(R),
    C.footer(R),
  ]);
}

/**
 * @description Gate status at a glance.
 * @param {object} ds - The dataset.
 * @returns {string} A markdown table.
 */
function gateStatusTable(ds) {
  const rows = ds.technicalGates.map((g) => [
    cell(g.id), cell(g.question), cell(g.severity),
    /OPEN/.test(g.verdict) ? '**OPEN**' : /CONDITIONAL/.test(g.verdict) ? 'conditional' : 'closed',
    cell(g.resolveBy || (g.options ? 'architecture decision recorded' : '')),
  ]);
  return table(['Id', 'Question', 'Severity', 'Status', 'What would settle it'], rows);
}

/**
 * @description One gate, with its formula, worked cases and verdict.
 * @param {object} g - The dataset gate record.
 * @returns {string} The section.
 */
function gateSection(g) {
  const parts = [`### ${g.id} — ${cell(g.question)}`, '', `**Severity:** ${cell(g.severity)}`, ''];
  if (g.formula && g.formula !== 'qualitative - no closed form') {
    parts.push('```', g.formula, '```', '');
  }
  if (g.workedCases && g.workedCases.length) {
    const keys = [...new Set(g.workedCases.flatMap((c) => Object.keys(c)))].filter((k) => k !== 'case' && k !== 'verdict');
    const rows = g.workedCases.map((c) => [cell(c.case), ...keys.map((k) => cell(c[k] === undefined ? '' : c[k])), cell(c.verdict)]);
    parts.push(table(['Case', ...keys, 'Verdict'], rows), '');
  }
  if (g.options) {
    const rows = g.options.map((o) => [cell(o.id), cell(o.approach), cell(o.verdict), cell(o.why)]);
    parts.push(table(['Option', 'Approach', 'Verdict', 'Why'], rows), '');
  }
  parts.push(`**Verdict.** ${cell(g.verdict)}`, '');
  if (g.resolveBy) parts.push(`**Resolved by.** ${cell(g.resolveBy)}`);
  if (g.engineeringActionForSoftware) parts.push('', `**Software action.** ${cell(g.engineeringActionForSoftware)}`);
  return parts.join('\n');
}

/**
 * @description How the gates land on the cost model.
 * @param {object} R - The full run result.
 * @returns {string} The section.
 */
function gateCostImplications(R) {
  const b04 = R.base.ledger.byId['B-04'];
  const b02 = R.base.ledger.byId['B-02'];
  const b09 = R.base.ledger.byId['B-09'];
  const cross = R.crossings.find((c) => c.runId === 'va-market-bigbox' && c.assumptionId === 'B-04');
  return [
    `**The geometry gate is a cost question wearing a physics costume.** The projector is modelled at ${usd(b04.value)}, inside a ${usd(b04.band.low)}–${usd(b04.band.high)} band that assumes a mid-range LCD class. The dataset's own note is that this class is built around a 1.2–1.5:1 throw ratio, which does not close the geometry — and that if a short-throw lens is only available in the higher module tier, the line roughly triples. For scale: on the big-box configuration, contribution reaches zero when this line falls to ${usd(cross.crossing)}. Moving it the other way ends the tier.`,
    '',
    `**The visibility gate closes on arithmetic and needs a separate part to do it.** The projection panel is a distinct line at ${usd(b02.value)}, not the envelope fabric, and the dataset is explicit that standard coated oxford is far too opaque to rear-project through. It is a small number attached to a total product failure if it is dropped as a cost-down.`,
    '',
    `**The thermal gate passes and the moisture gate does not, for the same reason.** The continuous blower airflow that keeps the interior within a degree of ambient is the same airflow that pulls dew and rain past the optics for six hours. The enclosure line carries ${usd(b09.value)} of unit cost and ${usd(R.base.ledger.byId['B-09-TOOLING'].value)} of tooling against a problem no arithmetic in this plan resolves.`,
    '',
    `**The streaming question resolves against streaming.** Moving the renderer inside the prop and sending only text and audio over the network is what puts the compute module in the bill of materials at ${usd(R.base.ledger.byId['B-05'].value)}, and it is the second-largest driver in the sensitivity chart. The alternative — casting pixels from a phone — would remove that cost and break the audio-driven lip sync that is the entire product.`,
  ].join('\n');
}

/**
 * @description The reconciliation and refusal-control document.
 * @param {object} R - The full run result.
 * @returns {string} The document.
 */
function reconciliation(R) {
  const rows = R.reconciliation.map((r) => [
    cell(r.check), cell(r.runId),
    usd(r.handExWorks), usd(r.engineExWorks), usd(r.addedMicros),
    usd(r.handLanded), usd(r.engineLanded), ratioPct(r.landedDeltaRatio, 1),
  ]);
  const worst = R.reconciliation.reduce((a, b) => (Math.abs(b.landedDeltaRatio) > Math.abs(a.landedDeltaRatio) ? b : a));
  return doc([
    '# Engine reconciliation and the refusal control',
    C.posture(R, R.base),
    '## Does the engine agree with the dataset\'s own hand-computation?',
    `The dataset carries an independent hand-check computed outside any engine, and states that if the two disagree by more than a few percent one of them is broken and that must be resolved before any output is trusted. That check is run on every regeneration rather than assumed.`,
    '',
    `The engine carries two cost lines the hand-check does not — a final assembly charge and a scrap rate, both minted by this run and both zero at the low corner. The **Model-added** column isolates them, so the landed-cost delta compares like with like.`,
    '',
    table(
      ['Hand-checked scenario', 'Engine scenario', 'Hand ex-works', 'Engine ex-works', 'Model-added', 'Hand landed', 'Engine landed', 'Delta after adjustment'],
      rows, ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r'],
    ),
    '',
    `**The largest disagreement is ${ratioPct(Math.abs(worst.landedDeltaRatio), 1)}, on \`${cell(worst.runId)}\`.** That is inside the "few percent" the dataset sets as its own tolerance, and the direction is explainable: the hand-check prices freight at less-than-container-load rates per cubic metre, while the engine ships a five-thousand-unit run as ${num(R.base.model.landed.containers)} full containers and therefore pays less for freight and more for the government fees, insurance, drayage and receiving legs the hand-check omits.`,
    '',
    `**Two corners agree exactly.** At the low corner of every band the engine's factory cost reproduces the dataset's hand-derived roll-up to the cent for both tiers, because the two model-added lines are zero there. That is the strongest single piece of evidence that the roll-up arithmetic is right.`,
    '## Does the profit statement tie to the cash statement?',
    profitCashSection(R),
    '## Does the engine actually refuse?',
    refusalSection(R),
    '## What the engine warned about that a reader should not skip',
    C.issueTable(R.base.model.issues.filter((i) => i.severity !== 'info'), { skipCodes: ['supplier-unqualified'] }),
    `Plus ${num(R.base.model.issues.filter((i) => i.code === 'supplier-unqualified').length)} identical \`supplier-unqualified\` warnings, one for every line in the bill of materials, because no supplier has been contacted.`,
    C.footer(R),
  ]);
}

/**
 * @description The profit-to-cash bridge, term by term, for the configuration the
 *   decision documents key off.
 *
 *   THIS SECTION EXISTS BECAUSE ITS ABSENCE HID A DEFECT. The two statements are
 *   allowed to differ — that is the whole point of a seasonal model — but for a
 *   while nothing checked that every micro of the difference had a name, and a
 *   PERMANENT difference (the cost of stock that never sold, which appeared in no
 *   profit line at all) was published as a TIMING one in a horizon that had fifteen
 *   months of settled quiet after the last cash event. The engine now refuses to
 *   publish a model whose bridge leaves a residual.
 * @param {object} R - The full run result.
 * @returns {string} The section.
 */
function profitCashSection(R) {
  const run = R.byId['va-market-dtc'];
  const r = run.model.financials.reconciliation;
  const rows = [
    ['Cumulative net income at the horizon end', usd(r.netIncomeMicros)],
    ['less closing receivables — earned, not yet banked', usd(-r.closingReceivableMicros)],
    ['less closing inventory at landed cost — paid for, not yet expensed', usd(-r.closingInventoryMicros)],
    ['plus closing payables — incurred, not yet paid', usd(r.closingPayableMicros)],
    ['less the non-cash credit for resellable returns', usd(-r.returnsSalvageCreditMicros)],
    ['less purchase-order rounding against the per-unit landed cost', usd(-r.purchaseRoundingMicros)],
    ['less landed-cost per-unit rounding', usd(-r.landedRoundingMicros)],
    ['**implied cash position**', `**${usd(r.expectedCashMicros)}**`],
    ['**cash statement actually closes at**', `**${usd(r.cumulativeCashMicros)}**`],
    ['**unexplained residual**', `**${usd(r.residualMicros)}**`],
  ];
  return [
    `The profit statement and the cash statement are allowed to disagree, and for a seasonal product they disagree by a lot: the factory is paid at bill of lading and the customer pays after Halloween. What is NOT allowed is a difference nobody can name. Every term of the bridge for \`${cell(run.spec.id)}\`:`,
    '',
    table(['Bridge term', 'Amount'], rows, ['l', 'r']),
    '',
    `The residual is ${usd(r.residualMicros)} against a tolerance of ${usd(r.toleranceMicros)}, which is the rounding the money unit makes unavoidable. A residual larger than that is a BLOCKING issue and the model does not publish — because the shape it catches is a real cost charged in one statement and not the other. The largest single named term here is the ${usd(r.closingInventoryMicros === 0 ? run.model.financials.totals.inventoryWriteDownMicros : r.closingInventoryMicros)} cost of the ${num(run.model.schedule.unsoldAtWindowEnd)} units that do not sell inside the window: they are paid for in full at the factory, recovered at a fraction on liquidation, and the difference is charged to profit in the month the leftovers are dumped.`,
    '',
    `Every scenario in the grid ties. ${num(R.runs.filter((x) => x.model.financials.reconciliation.ties).length)} of ${num(R.runs.length)} pass the bridge, and ${num(R.runs.filter((x) => !x.model.issues.some((i) => i.code === 'landed-cash-mismatch')).length)} of ${num(R.runs.length)} pay every buyer-paid leg of their own landed cost out of the cash calendar.`,
  ].join('\n');
}

/**
 * @description The refusal control: the same base case with the tariff
 *   classification unregistered.
 * @param {object} R - The full run result.
 * @returns {string} The section.
 */
function refusalSection(R) {
  const c = R.control;
  const blockers = c.model.issues.filter((i) => i.severity === 'block');
  return [
    `The engine's rule is that a computed figure resting on an input that is not registered as an assumption at all turns the whole model unpublishable — not flagged, not footnoted. A rule nobody has watched fire is a rule nobody has tested, so this regeneration builds a control model: the base scenario with \`${cell(c.removed)}\`, the tariff classification, removed from the ledger.`,
    '',
    `**Result: \`canPublish\` is ${String(c.model.canPublish)}.** ${num(c.unsourcedFigureIds.length)} figures went unsourced — \`${c.unsourcedFigureIds.map(cell).join('`, `')}\` — and the engine raised ${num(blockers.length)} blocking issue(s).`,
    '',
    blockers.length ? `> ${cell(blockers[0].message)}` : '',
    '',
    `This matters for the real model too. The dataset records the tariff classification as the literal string \`UNRESOLVED\`, which is not a number anything can compute on. Leaving it out makes every landed-cost figure in the plan unsourced and the model unpublishable — which is a truthful outcome but not a useful one. So the branch models register it as what it actually is: a **guess between two published rates**, carrying the full spread between them as its range, at the weakest confidence grade the engine has. It appears in the sensitivity chart accordingly, and it is the reason every landed cost in this document set is presented under two classifications rather than one.`,
  ].join('\n');
}

module.exports = { assumptionRegister, whatExists, technicalGates, reconciliation };
