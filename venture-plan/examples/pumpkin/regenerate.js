/**
 * Regenerate the pumpkin venture document set from the engine.
 *
 * RUN IT WITH: `node examples/pumpkin/regenerate.js` from `venture-plan/`.
 *
 * THE SCRIPT AUDITS ITS OWN OUTPUT AND EXITS NON-ZERO WHEN IT FAILS. Every dollar
 * figure printed in every document has to have come out of `format.usd()`, which is
 * fed only by the engine; the audit extracts every currency numeral from the
 * finished markdown and requires it to be a member of that emitted set. A figure
 * typed into a sentence by hand is not a member, and the run fails. That is the
 * mechanism behind the claim on every page that no number here was hand-typed —
 * without it the claim would be exactly the sort of assurance this whole package
 * exists to distrust.
 *
 * IT ALSO FAILS ON A COMPETITIVE ABSOLUTE. The house anti-drift rule forbids "only",
 * "nobody else", "unique" and their relatives as competitive claims anywhere, and a
 * generated corpus is exactly where one slips in unnoticed.
 *
 * The document order is deliberate and is not chronological: the decision comes
 * first, the inversion second, and the assumption register third — before any
 * narrative — because those three are what make the rest of it honest.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — runs the scenario grid, renders the twenty-three-document set, writes the generated index, and audits the finished corpus for unbacked currency numerals and competitive absolutes, failing the run on either.
 * 2 | roger.murphy@emeraldcoastsystemsgroup.com   | The audit now also fails on an implausible percentage (a basis-point value handed to the ratio formatter published "150000.0%" and the currency check walked straight past it, because a percentage is not a dollar figure) and on any document missing the not-advice boundary.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { unbackedMoneyTokens, implausiblePercentages, usd0, ratioPct, num, table, cell } = require('./lib/format');
const { adviceBoundary, ADVICE_BOUNDARY_MARK } = require('./lib/docs/common');
const scenarios = require('./lib/scenarios');
const decision = require('./lib/docs/decision');
const evidence = require('./lib/docs/evidence');
const market = require('./lib/docs/market');
const supply = require('./lib/docs/supply');
const finance = require('./lib/docs/finance');
const plan = require('./lib/docs/plan');

/** Where the generated corpus lands. */
const OUT_DIR = __dirname;

/**
 * The document set, in the order a reader should meet it. `why` is printed in the
 * generated index; a document that cannot state why it exists does not belong.
 */
const DOCUMENTS = [
  { file: '00-decision-summary.md', render: decision.decisionSummary, why: 'The verdict, the five numbers behind it, and the single most likely reason it fails.' },
  { file: '01-what-would-have-to-be-true.md', render: decision.whatWouldHaveToBeTrue, why: 'Every driver inverted: what each input would have to become, found by rebuilding the whole model rather than rearranging a formula.' },
  { file: '02-assumption-register.md', render: evidence.assumptionRegister, why: 'Every input the engine computed on, with its source, its confidence and whether anybody has quoted it. The document that makes the other twenty-two honest.' },
  { file: '03-what-exists-and-what-does-not.md', render: evidence.whatExists, why: 'The software that runs today against the hardware that does not exist at all.' },
  { file: '04-technical-feasibility-gates.md', render: evidence.technicalGates, why: 'Eight gates with their worked arithmetic. Three overturned an intuition; two are open and no arithmetic closes them.' },
  { file: '05-market-and-competition.md', render: market.marketAndCompetition, why: 'The prices observed on real retail surfaces, and what already ships.' },
  { file: '06-bill-of-materials.md', render: supply.billOfMaterials, why: 'The costed roll-up at every corner, with per-line provenance.' },
  { file: '07-manufacturing-plan.md', render: supply.manufacturingPlan, why: 'What is actually being manufactured, the tooling, and why lead time is the binding constraint.' },
  { file: '08-supplier-plan-srm.md', render: supply.supplierPlan, why: 'Every supplier category the product needs, none of which has been contacted, and the request-for-quotation package that would change that.' },
  { file: '09-logistics-and-landed-cost.md', render: supply.logistics, why: 'The landed stack under both tariff classifications, never blended into one.' },
  { file: '10-compliance-and-certification.md', render: supply.compliance, why: 'Four regimes, when the money is spent, and the branch decided by marketing copy rather than engineering.' },
  { file: '11-unit-economics.md', render: finance.unitEconomics, why: 'One row per scenario, and how to read the table without being misled by the cost-up rows.' },
  { file: '12-channel-margin-waterfalls.md', render: finance.channelWaterfalls, why: 'Every line the money passes through, per channel, plus the fees this model cannot carry.' },
  { file: '13-financial-model-pl.md', render: finance.profitAndLoss, why: 'The monthly profit statement for the one configuration that returns a positive net income.' },
  { file: '14-cash-flow-and-working-capital.md', render: finance.cashFlow, why: 'The document that decides whether the company survives: the monthly cash curve and its trough.' },
  { file: '15-sensitivity-and-risk.md', render: plan.sensitivity, why: 'What moves the answer, measured by rebuilding the entire model at each end of each researched range.' },
  { file: '16-org-and-hiring-plan.md', render: plan.organisation, why: 'Why the base plan pays nobody, and what happens when the six functions are staffed.' },
  { file: '17-timeline-and-critical-path.md', render: plan.timeline, why: 'Scheduled backward from a date that does not move, and the corner where the season is lost.' },
  { file: '18-go-to-market.md', render: market.goToMarket, why: 'Every route to market, the seasonal marketplace trap, and the sequence the arithmetic implies.' },
  { file: '19-funding-ask.md', render: finance.fundingAsk, why: 'The cheque, what it buys, and what it conspicuously does not buy.' },
  { file: '20-fatal-flaw-register.md', render: plan.fatalFlaws, why: 'Ranked by what ends the venture rather than by what is easy to mitigate.' },
  { file: '21-stage-1-gate-memo.md', render: decision.gateMemo, why: 'Whether the next tranche of spend is justified, judged against criteria stated as numbers.' },
  { file: '22-engine-reconciliation-and-refusal-control.md', render: evidence.reconciliation, why: 'The engine checked against the dataset\'s own independent hand-computation, and the refusal mechanism demonstrated on a control model.' },
];

/**
 * Competitive absolutes the house anti-drift rule forbids anywhere. Matched with
 * word boundaries and only in the competitive senses that actually mislead — "the
 * only tier that", "no other product" — rather than every use of the word.
 */
const ABSOLUTE_PATTERNS = [
  /\bthe only (?:one|product|company|platform|vendor|system|thing that)\b/i,
  /\bno (?:one|body|other) (?:else|product|company|vendor|platform)\b/i,
  /\bnobody else\b/i,
  /\bunique(?:ly)? (?:in|among|positioned|able|capable)\b/i,
  /\bunmatched\b/i,
  /\bfirst and only\b/i,
  /\bindustry[- ]leading\b/i,
  /\bbest[- ]in[- ]class\b/i,
];

/**
 * @description Scan a document for competitive absolutes.
 * @param {string} markdown - The rendered document.
 * @returns {string[]} The offending phrases.
 */
function competitiveAbsolutes(markdown) {
  const hits = [];
  for (const re of ABSOLUTE_PATTERNS) {
    const m = markdown.match(re);
    if (m) hits.push(m[0]);
  }
  return hits;
}

/**
 * @description Render every document, then audit the finished corpus.
 * @param {object} R - The scenario run result.
 * @returns {{rendered: Array, failures: Array}} The documents and any audit failures.
 */
function renderAll(R) {
  const rendered = [];
  for (const d of DOCUMENTS) {
    const markdown = d.render(R);
    rendered.push({ ...d, markdown });
  }
  // The index is rendered last so it can report the corpus it indexes, and it is
  // audited alongside everything else.
  const index = renderIndex(R, rendered);
  rendered.push({ file: 'README.md', why: 'The generated index.', markdown: index });
  const failures = [];
  for (const r of rendered) {
    const unbacked = unbackedMoneyTokens(r.markdown);
    if (unbacked.length) failures.push({ file: r.file, kind: 'unbacked-currency', detail: unbacked.join(', ') });
    const absolutes = competitiveAbsolutes(r.markdown);
    if (absolutes.length) failures.push({ file: r.file, kind: 'competitive-absolute', detail: absolutes.join(', ') });
    // A basis-point value handed to the ratio formatter prints ten thousand times
    // too large. The currency audit walks straight past it, because a percentage is
    // not a dollar figure — which is how "150000.0% of landed cost" was published.
    const percentages = implausiblePercentages(r.markdown);
    if (percentages.length) failures.push({ file: r.file, kind: 'implausible-percentage', detail: percentages.join(', ') });
    if (r.markdown.includes('_uncomputed_')) {
      failures.push({ file: r.file, kind: 'uncomputed-figure', detail: 'a figure the engine did not produce reached a document' });
    }
    if (!r.markdown.includes(ADVICE_BOUNDARY_MARK)) {
      failures.push({ file: r.file, kind: 'missing-advice-boundary', detail: 'the document does not carry the not-advice boundary' });
    }
  }
  return { rendered, failures };
}

/**
 * @description The generated index.
 * @param {object} R - The scenario run result.
 * @param {Array} rendered - The rendered documents.
 * @returns {string} The index markdown.
 */
function renderIndex(R, rendered) {
  const base = R.base;
  const rows = rendered.map((d) => [`[\`${cell(d.file)}\`](${d.file})`, cell(d.why)]);
  return [
    '# Pumpkin venture — the generated document set',
    '',
    `> **Posture: ${base.model.posture.toUpperCase()}.** No supplier has been contacted, no quote has been received, no unit has been built and nothing has been sold. Every figure in this corpus is either computed by the venture engine or a labelled assumption carrying its own source and confidence. **Nothing here is a manufacturing commitment and none of it should be shown to a lender or an investor as a forecast.**`,
    '',
    adviceBoundary(),
    '',
    ...indexBody(R, base, rows, rendered),
  ].join('\n');
}

/**
 * @description The generated counts table for the index.
 * @param {object} R - The scenario run result.
 * @param {object} base - The base run.
 * @param {Array} rendered - The rendered documents.
 * @returns {string} A markdown table.
 */
function indexCounts(R, base, rendered) {
  const counts = [
    ['Documents generated', num(rendered.length + 1)],
    ['Scenarios modelled', num(R.runs.length)],
    ['Full model rebuilds for the sensitivity analysis', num(R.cashSweep.rebuilds + R.marginSweep.rebuilds)],
    ['Registered assumptions in the base ledger', num(base.stats.total)],
    ['Assumptions carrying a vendor quote', num(base.stats.byConfidence.quoted)],
    ['Assumptions flagged as needing a quote', num(Object.values(base.meta).filter((m) => m.needsQuote).length)],
    ['Assumptions this run added because the dataset lacks them', num(Object.values(base.meta).filter((m) => m.modelAdded).length)],
    ['Computed figures in the base model', num(base.model.traceability.totalFigures)],
    ['Computed figures resting on a soft input', num(base.model.traceability.softFigureIds.length)],
    ['Share of landed cost on unquoted lines', ratioPct(base.landed.shareRatio)],
    ['Model posture', cell(base.model.posture)],
  ];
  return table(['', 'Value'], counts, ['l', 'r']);
}

/**
 * @description The body of the generated index.
 * @param {object} R - The scenario run result.
 * @param {object} base - The base run.
 * @param {Array} rows - The document rows.
 * @param {Array} rendered - The rendered documents.
 * @returns {string[]} The index lines.
 */
function indexBody(R, base, rows, rendered) {
  return [
    '## What this is',
    '',
    'A worked example of the `venture-plan` application: one idea — an inflatable Halloween pumpkin with a projector inside it that throws a talking, lip-syncing jack-o\'-lantern face onto its own skin — taken through the full venture document set.',
    '',
    'The architecture that produced it splits at the arithmetic line. A language model may propose an assumption, and every assumption enters carrying where it came from and how much it is worth; **all the arithmetic is done in code**, by a deterministic engine with no clock, no randomness and no network. A model-authored number is capped at `estimated` confidence on the way in, so no guess in this corpus can present itself as a quote.',
    '',
    '## Regenerate',
    '',
    '```bash',
    'cd venture-plan',
    'node examples/pumpkin/regenerate.js',
    '```',
    '',
    'The regeneration audits its own output and exits non-zero if any dollar figure in any document did not come out of the engine, if any competitive absolute appears, or if any document references a figure the engine did not compute.',
    '',
    '## The corpus',
    '',
    table(['Document', 'Why it exists'], rows),
    '',
    '## Generated counts',
    '',
    indexCounts(R, base, rendered),
    '',
    '## The headline',
    '',
    `Read [\`00-decision-summary.md\`](00-decision-summary.md) first. In one line: **as an item sold in a store the arithmetic says no** — at the top of the observed Halloween animatronics shelf the self-contained unit loses ${usd0(-R.byId['va-market-bigbox'].model.waterfalls[0].contributionPerUnitMicros)} on every unit, and the cheaper kit is worse rather than better. One configuration does clear its cost: the self-contained unit sold direct at a premium price. And the tier that carries no bill of materials at all — the software, which already runs today — carries none of the costs that kill the other two.`,
    '',
    '## What this corpus is not',
    '',
    '- **Not a forecast.** Nothing has been produced or sold, and there is no track record.',
    `- **Not sourced.** ${ratioPct(base.landed.shareRatio)} of the landed cost rests on lines nobody has quoted; ${num(base.stats.byConfidence.quoted)} of ${num(base.stats.total)} registered assumptions carry a vendor quote.`,
    '- **Not a compliance opinion.** No standard has been tested against, no laboratory engaged and no certificate exists. No claim of compliance appears anywhere, and the document set cannot express one.',
    '- **Not a customs classification.** The tariff treatment is unresolved and the spread between the two candidate readings is larger than the margin on the product.',
    '',
    'The direction of the findings is robust — the gaps are tens of percent, far wider than any single band\'s uncertainty. The absolute figures are not. Use this to decide what evidence to buy next.',
    '',
  ];
}

/**
 * @description Write the corpus and report.
 * @returns {number} Process exit code.
 */
function main() {
  const started = Date.now();
  process.stdout.write('Running the scenario grid through the engine...\n');
  const R = scenarios.runAll();
  process.stdout.write(`  ${R.runs.length} scenarios, ${R.cashSweep.rebuilds + R.marginSweep.rebuilds} sensitivity rebuilds, ${R.elapsedMs} ms\n`);
  process.stdout.write('Rendering documents...\n');
  const { rendered, failures } = renderAll(R);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const r of rendered) {
    fs.writeFileSync(path.join(OUT_DIR, r.file), r.markdown, 'utf8');
    process.stdout.write(`  ${r.file} (${r.markdown.length} bytes)\n`);
  }
  process.stdout.write(`\nAudit: ${failures.length === 0 ? 'clean' : `${failures.length} FAILURE(S)`}\n`);
  for (const f of failures) process.stdout.write(`  ${f.file}: ${f.kind} — ${f.detail}\n`);
  process.stdout.write(`\n${rendered.length} documents in ${Date.now() - started} ms\n`);
  return failures.length === 0 ? 0 : 1;
}

if (require.main === module) process.exitCode = main();

module.exports = { DOCUMENTS, renderAll, renderIndex, competitiveAbsolutes, main };
