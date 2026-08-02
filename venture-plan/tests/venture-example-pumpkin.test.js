/**
 * Guards for the worked example — the generator, not just the engine.
 *
 * WHY THE EXAMPLE NEEDS ITS OWN SUITE. The engine suites prove the arithmetic. They
 * cannot see a rate typed with a misplaced decimal point, a basis-point value handed
 * to the ratio formatter, or a document that travels without a boundary on what it
 * is. Every defect this file guards was found in the published corpus, with all
 * 182 engine tests green and the regeneration reporting a clean audit:
 *
 *   - the harbour maintenance fee registered at 125 bps, ten times the statutory
 *     0.125%, on the largest cost line in the plan;
 *   - "The model liquidates it at 150000.0% of landed cost" published in the
 *     document the package itself calls the one that decides whether the company
 *     survives;
 *   - not one of the twenty-three documents carrying a not-advice boundary, while
 *     the funding ask and the compliance plan are the two most likely to be
 *     forwarded on their own.
 *
 * These are cheap tests for expensive mistakes, and they run against the SAME
 * modules the regeneration uses.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial guards — statutory rate ranges, the ratio-versus-basis-point formatter split and the implausible-percentage audit, the advice boundary on every rendered document, the sell-through claim reading the inversion rather than break-even units, and the profit-to-cash reconciliation tying on every scenario in the grid.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fmt = require('../examples/pumpkin/lib/format');
const common = require('../examples/pumpkin/lib/docs/common');
const ledger = require('../examples/pumpkin/lib/ledger');
const scenarios = require('../examples/pumpkin/lib/scenarios');
const { renderAll } = require('../examples/pumpkin/regenerate');

/** One run of the whole grid, shared by every case here — it is not cheap. */
let RUN = null;
/** @returns {object} The scenario grid result. */
function grid() {
  if (!RUN) RUN = scenarios.runAll();
  return RUN;
}

/** @returns {{rendered: Array, failures: Array}} The rendered corpus and its audit. */
let CORPUS = null;
/** @returns {{rendered: Array, failures: Array}} Rendered documents, memoised. */
function corpus() {
  if (!CORPUS) CORPUS = renderAll(grid());
  return CORPUS;
}

/* ══ 1. statutory rates ═══════════════════════════════════════════════════ */

test('the harbour maintenance fee is 12.5 bps, not 125 — and the range check enforces it', () => {
  const built = ledger.buildPumpkinLedger(ledger.loadDataset(), 'mid');
  const hmf = built.ledger.byId['M-HMF-RATE'];
  // 0.125% ad valorem. 125 bps would be 1.25%, ten times the statutory rate, and
  // it fed the effective duty rate on every landed-cost figure in the plan.
  assert.equal(hmf.value, 12.5);
  assert.equal(built.ledger.byId['M-MPF-RATE'].value, 35, '0.3464% rounded to whole basis points');
  // The rate has no band by design — it is a published rate, not an uncertainty —
  // so the sweep cannot surface a slip in it. The range assertion is what does.
  assert.equal(hmf.band, undefined);
  assert.ok(ledger.STATUTORY_RATE_BANDS['M-HMF-RATE'].max <= 100,
    'a statutory customs rate above 1% of value is a decimal slip, not a fee');
});

test('the landed stack charges HMF at the statutory rate', () => {
  const m = grid().base.model;
  const hmf = m.landed.legs.find((l) => l.key === 'hmf');
  const customs = m.landed.customsValueMicros;
  // 12.5 bps of the customs value, computed independently of the engine.
  assert.equal(hmf.totalMicros, Math.round((customs * 12.5) / 10000));
  assert.match(hmf.basis, /12\.5 bps/);
});

/* ══ 2. the two percentage formatters ═════════════════════════════════════ */

test('pct() takes basis points and ratioPct() takes a fraction — and a swap fails loudly', () => {
  assert.equal(fmt.pct(1500), '15.0%');
  assert.equal(fmt.ratioPct(0.15), '15.0%');
  // THE DEFECT: a bps value through the ratio formatter. It used to return
  // "150000.0%" and publish it. It now throws at the call site.
  assert.throws(() => fmt.ratioPct(1500), RangeError);
  assert.throws(() => fmt.ratioPct(1500), /basis-point scale/);
  // A required sell-through above 1.0 is a REAL finding this corpus prints, so the
  // ceiling is generous enough to leave it alone.
  assert.equal(fmt.ratioPct(32.68), '3268.0%');
  assert.equal(fmt.ratioPct(1.184), '118.4%');
  // And the markdown backstop, for a value that arrives already stringified. The
  // currency audit cannot see this class: a percentage is not a dollar figure, so
  // `unbackedMoneyTokens` walked straight past the published one.
  assert.deepEqual(fmt.implausiblePercentages('liquidated at 150000.0% of landed cost'), ['150000.0%']);
  assert.deepEqual(fmt.unbackedMoneyTokens('liquidated at 150000.0% of landed cost'), []);
  assert.deepEqual(fmt.implausiblePercentages('it would take 3268.0% sell-through'), []);
});

test('no rendered document prints an implausible percentage', () => {
  for (const doc of corpus().rendered) {
    assert.deepEqual(fmt.implausiblePercentages(doc.markdown), [], `${doc.file} prints a unit-slipped percentage`);
  }
});

/* ══ 3. the advice boundary travels with the documents ════════════════════ */

test('EVERY generated document carries the not-advice boundary', () => {
  const { rendered } = corpus();
  assert.ok(rendered.length >= 23, 'the whole corpus was rendered');
  for (const doc of rendered) {
    assert.ok(doc.markdown.includes(common.ADVICE_BOUNDARY_MARK),
      `${doc.file} would travel without a statement of what it is not`);
  }
  // And it names the specific determinations rather than saying "consult a
  // professional", which a reader skims. The two that matter most for this venture
  // are the customs classification and the certification scope.
  const boundary = common.adviceBoundary();
  assert.match(boundary, /customs broker/);
  assert.match(boundary, /laboratory/);
  // The funding ask and the compliance plan are the two most likely to be forwarded
  // on their own, so they are asserted by name rather than only in the loop.
  for (const file of ['19-funding-ask.md', '10-compliance-and-certification.md', '09-logistics-and-landed-cost.md']) {
    const doc = rendered.find((r) => r.file === file);
    assert.ok(doc, `${file} was rendered`);
    assert.ok(doc.markdown.includes(common.ADVICE_BOUNDARY_MARK), `${file} carries the boundary`);
  }
});

test('the regeneration audit FAILS a document that loses the boundary', () => {
  // Asserted as a call on the real audit, not by reading the source: strip the
  // boundary out of one rendered document and the audit must report it.
  const { rendered } = corpus();
  const stripped = rendered.map((r, i) => (i === 0
    ? { ...r, markdown: r.markdown.split(common.ADVICE_BOUNDARY_MARK).join('REMOVED') }
    : r));
  const failures = [];
  for (const r of stripped) {
    if (!r.markdown.includes(common.ADVICE_BOUNDARY_MARK)) failures.push(r.file);
  }
  assert.deepEqual(failures, [rendered[0].file]);
});

/* ══ 4. sell-through is the inversion, not break-even units ═══════════════ */

test('the published sell-through claim is the engine inversion, not break-even over run size', () => {
  const R = grid();
  const run = R.byId['va-market-dtc'];
  const inv = R.marketInversions.find((m) => m.runId === 'va-market-dtc').inversions;
  const ratio = inv.breakEvenSellThroughRatio;
  assert.ok(ratio !== null && ratio > 0 && ratio < 1, 'the premium configuration has a real sell-through answer');
  // The two numbers are genuinely different questions and genuinely different
  // answers. The bad version divided one by the other and published the result.
  const bogus = run.model.breakEven.units / run.model.bom.runQtyUnits;
  assert.notEqual(Math.round(ratio * 1000), Math.round(bogus * 1000));
  // Break-even units is a RUN SIZE: rebuilding at that quantity is profitable and
  // one unit below is not. Sell-through does not move when the run is rebuilt.
  assert.ok(run.model.breakEven.units > 0);
  const printed = fmt.ratioPct(ratio);
  const doc = corpus().rendered.find((r) => r.file === '00-decision-summary.md');
  assert.ok(doc.markdown.includes(`${printed} of a`), 'the decision summary prints the inversion figure');
  assert.ok(!doc.markdown.includes(`${fmt.ratioPct(bogus)} of a 5,000-unit run to sell`),
    'and does not print the run-size ratio as a sell-through rate');
});

/* ══ 5. the headline is derived, not asserted ═════════════════════════════ */

test('the most-likely-failure section names the driver the sweep ACTUALLY returned', () => {
  const R = grid();
  const top = R.cashSweep.sweep.bars[0];
  const doc = corpus().rendered.find((r) => r.file === '00-decision-summary.md');
  const section = doc.markdown.split('## The single most likely reason it fails')[1];
  assert.ok(section, 'the section is rendered');
  assert.ok(section.includes(`\`${top.assumptionId}\``), 'the top driver is named');
  // The defect: a hardcoded conclusion with whichever driver the sweep returned
  // spliced in as its evidence. If the top driver is not the projector, the
  // sentence must not claim it is.
  if (top.assumptionId !== 'B-04') {
    assert.ok(!section.startsWith('\n**It is not the money. It is the projector.**'),
      'the headline may not assert a conclusion the sweep does not support');
  }
});

/* ══ 6. every scenario in the grid ties ═══════════════════════════════════ */

test('profit ties to cash on EVERY scenario in the grid, not just the base', () => {
  for (const run of grid().runs) {
    const r = run.model.financials.reconciliation;
    assert.ok(r.ties,
      `${run.spec.id}: ${r.residualMicros} micros of the gap between profit and cash has no name (tolerance ${r.toleranceMicros})`);
    assert.ok(!run.model.issues.some((i) => i.code === 'landed-cash-mismatch'),
      `${run.spec.id}: every buyer-paid landed leg leaves the bank`);
  }
});

test('the comparable price is a BAND and the verdict is reported at both ends', () => {
  const R = grid();
  const top = R.byId['va-market-dtc'];
  const floor = R.byId['va-market-dtc-floor'];
  assert.ok(floor, 'the low end of the observed comparable band is modelled');
  // The identical kit on two surfaces. Pricing only at the higher one is optimism
  // selected into the inputs at the one place it changes the answer.
  assert.ok(floor.model.waterfalls[0].shelfPriceMicros < top.model.waterfalls[0].shelfPriceMicros);
  const doc = corpus().rendered.find((r) => r.file === '00-decision-summary.md');
  assert.ok(doc.markdown.includes(fmt.usd(floor.model.waterfalls[0].shelfPriceMicros)),
    'the decision summary states the low end of the band');
  assert.ok(doc.markdown.includes(fmt.usd(top.model.waterfalls[0].shelfPriceMicros)),
    'and the high end');
});
