/**
 * Shared furniture for every generated venture document.
 *
 * THE POSTURE HEADER IS COMPUTED ON EVERY DOCUMENT AND IT CHANGES EVERY TIME THE
 * MODEL DOES. That is deliberate: a fixed disclaimer becomes furniture a reader
 * skims past within two documents, whereas a header that says "31 of 36 figures
 * rest on inputs nobody has quoted" and whose numbers move when the ledger moves
 * has to be read. The counts come from the engine's traceability report and the
 * ledger statistics, never from a literal.
 *
 * `figure()` is the only way a document reads a number out of the model, and it
 * THROWS on an unknown id — the same rule the engine's own token renderer applies.
 * A document that asks for a figure the engine did not compute fails the
 * regeneration rather than printing a blank.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — the computed posture header, the throwing figure accessor, scenario and issue rendering, and the shared provenance footer.
 * 2 | roger.murphy@emeraldcoastsystemsgroup.com   | Added the not-advice boundary to the shared header. It existed only in the package README, which stays in the repository while the documents travel — so the funding ask, the compliance plan and the logistics document carrying an unresolved tariff classification each shipped with a posture line about estimates and no boundary at all. The regeneration now fails a document that lacks it.
 */
'use strict';

const { engine, usd, pct, num, ratioPct, table, cell } = require('../format');

const F = engine('venture-figures');

/**
 * @description Read one figure's raw value out of a model. Throws on an unknown
 *   id, because a document naming a number the engine never computed is a defect
 *   and a blank in its place is indistinguishable from a zero.
 * @param {object} model - A built model.
 * @param {string} id - The figure id.
 * @returns {number} The figure's value in its own unit.
 */
function figure(model, id) {
  const f = model.figures[id];
  if (!f) throw new F.MissingFigureError(id);
  return f.value;
}

/**
 * @description Read a figure, returning null instead of throwing when the engine
 *   legitimately did not produce one — a zero-volume run has no per-unit cost, and
 *   that absence is a result rather than an error.
 * @param {object} model - A built model.
 * @param {string} id - The figure id.
 * @returns {number|null} The value, or null.
 */
function figureOrNull(model, id) {
  const f = model.figures[id];
  return f ? f.value : null;
}

/**
 * @description The confidence grade of a figure — the weakest link in its
 *   provenance chain, resolved by the engine rather than assigned by a writer.
 * @param {object} model - A built model.
 * @param {string} id - The figure id.
 * @returns {string} The confidence word, or `unregistered`.
 */
function figureConfidence(model, id) {
  const f = model.figures[id];
  if (!f) return 'unregistered';
  return f.confidence || 'no registered inputs';
}

/**
 * The sentence the regeneration audit looks for in every document. It lives in the
 * shared header rather than in the package README because the README stays in the
 * repository and the documents travel: the funding ask, the compliance plan and the
 * logistics document carrying an unresolved tariff classification are exactly the
 * three a reader is most likely to forward on their own, and they were carrying a
 * posture line about estimates and no boundary at all.
 */
const ADVICE_BOUNDARY_MARK = 'Not financial, investment, legal, tax or customs advice.';

/**
 * @description The advice boundary, with the specific determinations named. A
 *   generic "consult a professional" is furniture; naming the customs broker, the
 *   laboratory and the accountant tells a reader WHICH question this document is
 *   not answering.
 * @returns {string} The boundary block.
 */
function adviceBoundary() {
  return [
    `> **${ADVICE_BOUNDARY_MARK}** This is a planning instrument built from labelled assumptions, and nothing in it is a manufacturing, purchasing or funding commitment.`,
    '> A tariff classification is a licensed customs broker\'s determination and, where it matters, a binding ruling from the customs authority — not a figure a model chooses.',
    '> A certification scope and a pass are a laboratory\'s determination; this document set has no way to express a compliance claim and does not make one.',
    '> How a cash requirement is funded, and what it does to a balance sheet or a tax position, is an accountant\'s and a lawyer\'s question.',
  ].join('\n');
}

/**
 * @description The computed posture header every document opens with.
 * @param {object} R - The full run result.
 * @param {object} run - The scenario run this document is about.
 * @returns {string} The header block.
 */
function posture(R, run) {
  const t = run.model.traceability;
  const s = run.stats;
  const nq = Object.values(run.meta).filter((m) => m.needsQuote).length;
  return [
    `> **Posture: ${run.model.posture.toUpperCase()} — nothing here is a quote.**`,
    `> ${t.softFigureIds.length} of ${t.totalFigures} computed figures rest on an input that is a model estimate or an outright guess.`,
    `> ${nq} of ${s.total} registered assumptions still need a supplier, broker or lab quote.`,
    `> ${ratioPct(run.landed.shareRatio)} of this scenario's landed cost sits on lines nobody has quoted.`,
    `> Ledger by confidence: ${s.byConfidence.quoted} quoted, ${s.byConfidence.observed} observed, ${s.byConfidence.benchmarked} benchmarked, ${s.byConfidence.estimated} estimated, ${s.byConfidence.guessed} guessed.`,
    `> The engine ${run.model.canPublish ? 'permits' : '**refuses**'} publication of this scenario.`,
    '',
    adviceBoundary(),
    '',
    `_Generated by \`node examples/pumpkin/regenerate.js\` from \`ventures/pumpkin-projection-prop.json\` on a modelling date of ${run.input.onDate}. Every figure below is either computed by the engine or a labelled assumption; none is typed by hand._`,
  ].join('\n');
}

/**
 * @description Name a scenario in one line, so a reader always knows which run a
 *   table came from.
 * @param {object} run - A scenario run.
 * @returns {string} The scenario line.
 */
function scenarioLine(run) {
  const s = run.spec;
  const channels = Object.entries(s.channels).map(([id, share]) => `${id} ${ratioPct(share, 0)}`).join(' / ');
  const price = s.mode === 'market' ? 'priced at the observed market ceiling' : 'priced up from cost to a 25.0% target contribution';
  return `**Scenario \`${s.id}\`** — ${s.variantId}, ${s.corner} corner of every cost band, ${s.branchId} tariff branch, ${num(s.runQty)}-unit run, ${channels}, ${price}.`;
}

/**
 * @description Render an issue list as a table. Issues are the engine's own
 *   warnings and refusals; a document that hides them is not reporting the model
 *   the engine built.
 * @param {Array<object>} issues - Engine issues.
 * @param {object} [opts] - `{ skipCodes: string[] }` to fold repetitive noise.
 * @returns {string} A markdown table.
 */
function issueTable(issues, opts) {
  const skip = new Set((opts && opts.skipCodes) || []);
  const rows = issues.filter((i) => !skip.has(i.code))
    .map((i) => [i.severity.toUpperCase(), cell(i.code), cell(i.where), cell(i.message)]);
  return table(['Severity', 'Code', 'Where', 'What the engine said'], rows);
}

/**
 * @description Count issues by code, so a document can say "13 lines carry the
 *   same warning" instead of printing it thirteen times.
 * @param {Array<object>} issues - Engine issues.
 * @returns {Array<{code: string, severity: string, count: number, sample: string}>} Grouped counts.
 */
function issueCounts(issues) {
  const by = new Map();
  for (const i of issues) {
    const k = `${i.severity}:${i.code}`;
    if (!by.has(k)) by.set(k, { code: i.code, severity: i.severity, count: 0, sample: i.message });
    by.get(k).count += 1;
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

/**
 * @description The standard footer: where the numbers came from and what would
 *   change them.
 * @param {object} R - The full run result.
 * @returns {string} The footer block.
 */
function footer(R) {
  return [
    '---',
    '',
    '### Where these numbers come from',
    '',
    `Every computed figure in this document was produced by the venture engine in \`venture-plan/routes/\` from the assumption ledger built out of \`ventures/pumpkin-projection-prop.json\`. Every assumption carries a source and a confidence grade; see [\`02-assumption-register.md\`](02-assumption-register.md) for the full ledger and [\`22-engine-reconciliation-and-refusal-control.md\`](22-engine-reconciliation-and-refusal-control.md) for the check of the engine against the dataset's own independent hand-computation.`,
    '',
    `Regenerate with \`node examples/pumpkin/regenerate.js\` from \`venture-plan/\`. The regeneration audits its own output: any dollar figure in any document that did not come out of the engine fails the run.`,
  ].join('\n');
}

/**
 * @description A per-unit cost stack for a run, straight off the engine's legs.
 * @param {object} run - A scenario run.
 * @returns {string} A markdown table.
 */
function landedStackTable(run) {
  const m = run.model;
  const nq = new Set(Object.values(run.meta).filter((x) => x.needsQuote).map((x) => x.id));
  const rows = m.landed.legs.map((leg) => [
    cell(leg.key),
    leg.paidBy === 'buyer' ? usd(leg.perUnitMicros) : '_inside the supplier price_',
    usd(leg.totalMicros),
    cell(leg.basis),
    leg.assumptionRefs.some((r) => nq.has(r)) ? 'needs a quote' : cell(leg.assumptionRefs.join(', ') || '—'),
  ]);
  rows.push([
    '**landed per unit**', `**${usd(m.landed.buyerUnitMicros)}**`, `**${usd(m.landed.buyerTotalMicros)}**`,
    `${m.landed.mode.toUpperCase()}, ${num(m.landed.containers)} container(s) at ${ratioPct(m.landed.containerFillRatio)} fill`,
    `${ratioPct(run.landed.shareRatio)} unquoted`,
  ]);
  return table(['Leg', 'Per unit', 'Run total', 'Basis', 'Provenance'], rows, ['l', 'r', 'r', 'l', 'l']);
}

/**
 * @description A waterfall table for one channel of a run.
 * @param {object} model - A built model.
 * @param {object} w - The channel waterfall.
 * @returns {string} A markdown table.
 */
function waterfallTable(model, w) {
  const rows = [['Shelf price', usd(w.shelfPriceMicros), 'as priced']];
  if (w.wholesaleMicros !== null) {
    rows.push(['Wholesale you invoice', usd(w.wholesaleMicros), 'shelf less the retailer margin']);
    rows.push(['Net wholesale after allowances', usd(w.netWholesaleMicros), 'wholesale less every programme allowance']);
  }
  if (w.grossRevenueMicros !== w.shelfPriceMicros) {
    rows.push(['Gross revenue collected', usd(w.grossRevenueMicros), 'shelf price plus anything charged on top']);
  }
  for (const step of w.steps) {
    rows.push([cell(step.label), usd(step.amountMicros), cell(step.basis)]);
  }
  rows.push(['Landed cost of goods', usd(-w.landedUnitMicros), 'from the landed stack']);
  rows.push([`**Contribution per unit**`, `**${usd(w.contributionPerUnitMicros)}**`,
    `**${w.contributionBps === null ? 'no revenue' : pct(w.contributionBps)} of gross revenue**`]);
  return table(['Line', 'Per unit', 'Basis'], rows, ['l', 'r', 'l']);
}

module.exports = {
  figure, figureOrNull, figureConfidence, posture, scenarioLine,
  issueTable, issueCounts, footer, landedStackTable, waterfallTable,
  adviceBoundary, ADVICE_BOUNDARY_MARK,
};
