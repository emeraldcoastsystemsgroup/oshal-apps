/**
 * Guards for the provenance chain, the figure registry and the fail-closed
 * publish rule.
 *
 * THIS IS THE SUITE THE WHOLE APP RESTS ON. The engine's claim is that every
 * number it prints is traceable to either a computation or a labelled assumption.
 * These guards assert that mechanically:
 *
 *   - A model-authored estimate cannot claim to be a vendor quote. The downgrade
 *     happens on the way IN, so a language model cannot launder its own guess.
 *   - A figure that rests on an assumption nobody registered turns `canPublish`
 *     FALSE. Not flagged, not footnoted — the plan does not publish.
 *   - A document that names a figure the engine never computed THROWS, because a
 *     silently blank number in a funding document is indistinguishable from zero.
 *   - Posture and every count are DERIVED. One estimated cost line makes the whole
 *     model an estimate, because a plan is only as committed as its weakest cost.
 *
 * Dependency-free `node --test` suite over the COMPILED modules.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial guards — the model-estimate confidence cap, unit-checked ledger reads, the transitive figure-to-assumption chain, the unsourced-input publish block, the missing-figure throw, derived posture and generated counts, and the weakest-link confidence rule.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { engine, D, ASSUMPTIONS, ventureInput } = require('./fixture-venture');

const A = engine('venture-assumptions');
const Fg = engine('venture-figures');
const M = engine('venture-model');

const modelEstimate = { kind: 'model-estimate', agentId: 'bot', taskId: 't', model: 'm', rationale: 'r' };

test('a model-estimate CANNOT claim to be quoted — the cap is applied on the way in', () => {
  const claimed = {
    id: 'x', label: 'A number a bot made up', value: D(4), unit: 'micros',
    source: modelEstimate, confidence: 'quoted',
  };
  const { assumption, issues } = A.normalizeAssumption(claimed);
  assert.equal(assumption.confidence, 'estimated');
  const downgrade = issues.find((i) => i.code === 'model-confidence-downgraded');
  assert.ok(downgrade, 'the downgrade is on the record, not silent');
  assert.equal(downgrade.data.claimed, 'quoted');
  assert.equal(downgrade.data.recorded, 'estimated');
  // 'observed' and 'benchmarked' are also above the cap and are also refused.
  assert.equal(A.normalizeAssumption({ ...claimed, confidence: 'observed' }).assumption.confidence, 'estimated');
  assert.equal(A.normalizeAssumption({ ...claimed, confidence: 'benchmarked' }).assumption.confidence, 'estimated');
  // 'guessed' is BELOW the cap and is left alone — a bot may admit to less.
  assert.equal(A.normalizeAssumption({ ...claimed, confidence: 'guessed' }).assumption.confidence, 'guessed');
  // A human-entered or vendor-quoted number is not touched.
  const vendor = { ...claimed, source: { kind: 'vendor-quote', vendor: 'V', quoteRef: 'Q', quotedOn: '2026-01-01' } };
  assert.equal(A.normalizeAssumption(vendor).assumption.confidence, 'quoted');
});

test('RELABELLING the guess does not launder it — every bot-authorable kind is capped', () => {
  // The hole this closes: the cap used to apply to `model-estimate` alone, so a bot
  // that called its own guess a published rate and attached a URL it had never
  // opened kept the confidence it claimed. Executed against the engine, that one
  // relabelling flipped a whole document set's posture from ESTIMATE to quoted with
  // zero issues raised. A URL is not evidence a parser can check; a bot writing one
  // is a bot writing a string.
  const base = { id: 'x', label: 'A rate a bot says it read', value: D(4), unit: 'micros' };
  const published = {
    ...base, source: { kind: 'published-rate', publication: 'Some page', url: 'https://example.invalid/price', retrievedAt: '2026-08-01' },
  };
  for (const claimed of ['quoted', 'observed']) {
    const { assumption, issues } = A.normalizeAssumption({ ...published, confidence: claimed });
    assert.equal(assumption.confidence, 'benchmarked', `published-rate claiming ${claimed} is capped`);
    const downgrade = issues.find((i) => i.code === 'model-confidence-downgraded');
    assert.ok(downgrade, `the ${claimed} downgrade is on the record`);
    assert.equal(downgrade.data.sourceKind, 'published-rate');
  }
  // A benchmark dataset is the same class of claim and gets the same ceiling.
  const benchmarked = { ...base, source: { kind: 'benchmark', dataset: 'D', note: 'n' }, confidence: 'quoted' };
  assert.equal(A.normalizeAssumption(benchmarked).assumption.confidence, 'benchmarked');
  // The two grades that mean somebody LOOKED are reachable only through the two
  // source kinds a human has to create.
  assert.equal(A.SOURCE_CONFIDENCE_CEILING['vendor-quote'], 'quoted');
  assert.equal(A.SOURCE_CONFIDENCE_CEILING['operator-input'], 'observed');
  for (const kind of ['published-rate', 'benchmark', 'model-estimate']) {
    assert.ok(
      A.isWeakerConfidence(A.SOURCE_CONFIDENCE_CEILING[kind], 'observed'),
      `${kind} can never reach observed or quoted`,
    );
  }
});

test('a bot cannot flip the POSTURE of a document set by relabelling its own guesses', () => {
  // The executed proof: take every money assumption, call it a published rate with
  // a plausible URL and claim it is quoted. The posture must stay an estimate.
  const relabelled = ASSUMPTIONS.map((a) => (a.unit === 'micros'
    ? {
      ...a, confidence: 'quoted',
      source: { kind: 'published-rate', publication: 'A page a bot named', url: 'https://example.invalid/x', retrievedAt: '2026-08-01' },
    }
    : a));
  const built = A.buildLedger(relabelled);
  assert.equal(Fg.derivePosture(built.ledger), 'estimate');
  assert.ok(built.issues.some((i) => i.code === 'model-confidence-downgraded'));
  // Only a real vendor quote lifts it, and that is a human action.
  const quoted = ASSUMPTIONS.map((a) => (a.unit === 'micros'
    ? { ...a, confidence: 'quoted', source: { kind: 'vendor-quote', vendor: 'V', quoteRef: 'Q', quotedOn: '2026-01-01' } }
    : a));
  assert.equal(Fg.derivePosture(A.buildLedger(quoted).ledger), 'quoted');
});

test('an inverted or non-finite band is dropped rather than swept over nonsense', () => {
  const bad = {
    id: 'x', label: 'x', value: 10, unit: 'bps', source: modelEstimate, confidence: 'estimated',
    band: { low: 90, high: 10 },
  };
  const { assumption, issues } = A.normalizeAssumption(bad);
  assert.equal(assumption.band, undefined);
  assert.ok(issues.length > 0);
  assert.equal(A.normalizeAssumption({ ...bad, band: { low: 1, high: Infinity } }).assumption.band, undefined);
});

test('reading an assumption in the wrong unit THROWS — a rate read as money looks plausible', () => {
  const { ledger } = A.buildLedger(ASSUMPTIONS);
  assert.equal(A.readMicros(ledger, 'bom.shell.unit-cost'), D(4));
  assert.equal(A.readBps(ledger, 'duty.hts.rate'), 320);
  assert.throws(() => A.readMicros(ledger, 'duty.hts.rate'), /recorded in bps but was read as micros/);
  assert.throws(() => A.readAssumption(ledger, 'nope', 'micros'), /not in the ledger/);
});

test('ledger statistics are GENERATED — a document prints these, it never types one', () => {
  const { ledger } = A.buildLedger(ASSUMPTIONS);
  const stats = A.ledgerStats(ledger);
  assert.equal(stats.total, ledger.order.length);
  assert.equal(
    Object.values(stats.byConfidence).reduce((a, b) => a + b, 0), stats.total,
    'the confidence buckets account for every assumption',
  );
  assert.equal(
    Object.values(stats.bySourceKind).reduce((a, b) => a + b, 0), stats.total,
    'the source buckets account for every assumption',
  );
  // Soft money = a money assumption a model authored or nobody has any basis for.
  assert.ok(stats.softMoneyIds.includes('bom.screw.unit-cost'));
  assert.ok(!stats.softMoneyIds.includes('bom.shell.unit-cost'), 'a vendor quote is not soft');
  assert.ok(!stats.softMoneyIds.includes('duty.hts.rate'), 'soft MONEY, not soft rates');
});

test('every figure in a computed model resolves to registered assumptions — no orphan numbers', () => {
  const m = M.buildVentureModel(ventureInput());
  assert.ok(Object.keys(m.figures).length >= 30, 'the registry covers the model');
  for (const [id, f] of Object.entries(m.figures)) {
    assert.equal(f.id, id);
    assert.ok(f.label && f.label.length > 3, `${id} is labelled`);
    assert.ok(Number.isFinite(f.value), `${id} is a finite number`);
    assert.ok(f.formula && f.formula.length > 3, `${id} states how it was derived`);
    // THE NON-VACUOUS HALF. Iterating the reference list says nothing about a
    // figure whose list is EMPTY — the loop body runs zero times and the test named
    // "no orphan numbers" passes for exactly the orphan case. It was green while
    // fourteen of thirty-six computed figures, the funding requirement and net
    // income among them, referenced nothing at all.
    assert.ok(
      f.kind !== 'computed' || f.assumptionRefs.length > 0,
      `${id} is an orphan number — a computed figure with no assumption chain`,
    );
    for (const ref of f.assumptionRefs) {
      assert.ok(m.input.ledger.byId[ref], `${id} rests on registered assumption ${ref}`);
    }
  }
  assert.deepEqual(m.traceability.unsourcedFigureIds, []);
});

test('an orphan computed figure is UNSOURCED, not clean — and it stops the model publishing', () => {
  const m = M.buildVentureModel(ventureInput());
  // Mutation: strip the chain off one headline figure and re-classify. Both
  // branches of the classifier are `.some()` over the reference list, so an empty
  // list used to fall through both and score identically to a fully-quoted number.
  const orphaned = {
    ...m.figures,
    'financials.fundingRequiredMicros': { ...m.figures['financials.fundingRequiredMicros'], assumptionRefs: [] },
  };
  const t = Fg.computeTraceability(orphaned, m.input.ledger);
  assert.ok(
    t.unsourcedFigureIds.includes('financials.fundingRequiredMicros'),
    'a computed figure naming no input is unprovenanced',
  );
  assert.ok(!t.softFigureIds.includes('financials.fundingRequiredMicros'), 'and it is not merely soft');
  // A count is allowed to have no chain: it counts records, it does not rest on them.
  assert.ok(!t.unsourcedFigureIds.includes('ledger.total'));
});

test('the headline numbers name the inputs they actually rest on', () => {
  const m = M.buildVentureModel(ventureInput());
  const refs = (id) => m.figures[id].assumptionRefs;
  // The funding requirement genuinely depends on how much of the run sells and on
  // what the goods cost to land. Saying so is what lets a reader see that the
  // cheque rests on a guess rather than presenting it as if it rested on nothing.
  assert.ok(refs('financials.fundingRequiredMicros').length >= 5);
  assert.ok(refs('financials.revenueMicros').includes('demand.base.units'));
  assert.ok(refs('breakEven.units').includes('demand.base.units'));
  assert.ok(refs('financials.netIncomeMicros').includes('bom.screw.unit-cost'));
  // And the confidence of an aggregate is the weakest link in that chain.
  assert.equal(m.figures['financials.fundingRequiredMicros'].confidence, 'guessed');
});

test("a figure's confidence is its WEAKEST link, not its average", () => {
  const m = M.buildVentureModel(ventureInput());
  // The BOM cost rests on a quoted shell price AND an estimated fastener price.
  const bom = m.figures['bom.recurringUnitMicros'];
  assert.ok(bom.assumptionRefs.includes('bom.shell.unit-cost'));
  assert.ok(bom.assumptionRefs.includes('bom.screw.unit-cost'));
  assert.equal(bom.confidence, 'estimated', 'a chain is worth its worst link');
  assert.equal(A.weakestConfidence(['quoted', 'guessed', 'observed']), 'guessed');
  assert.equal(A.weakestConfidence([]), null);
  assert.equal(A.isWeakerConfidence('guessed', 'quoted'), true);
  assert.equal(A.isWeakerConfidence('quoted', 'guessed'), false);
});

test('an input nobody registered turns canPublish FALSE and names exactly what is missing', () => {
  const input = ventureInput();
  // Remove one registered assumption; the BOM still references it.
  delete input.ledger.byId['bom.shell.unit-cost'];
  input.ledger.order = input.ledger.order.filter((id) => id !== 'bom.shell.unit-cost');
  const m = M.buildVentureModel(input);
  assert.equal(m.canPublish, false, 'a number with no source is a placeholder, not an estimate');
  assert.ok(m.traceability.unsourcedFigureIds.includes('bom.recurringUnitMicros'));
  const blocked = m.issues.find((i) => i.code === 'unsourced-estimate' && i.severity === 'block');
  assert.ok(blocked);
  assert.match(blocked.data.missingAssumptionIds, /bom\.shell\.unit-cost/);
  // And the figures that DO have sources are unaffected — the block is targeted.
  assert.ok(!m.traceability.unsourcedFigureIds.includes('headcount.totalMicros'));
});

test('a document naming a figure the engine never computed THROWS', () => {
  const m = M.buildVentureModel(ventureInput());
  assert.throws(
    () => Fg.renderFigureTokens('Funding required: {{fig:financials.notARealFigure}}', m.figures),
    Fg.MissingFigureError,
  );
  // A blank where a figure should be is indistinguishable from a zero, which is
  // why this is a throw and not an empty string.
  try {
    Fg.renderFigureTokens('{{fig:nope}}', m.figures);
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(e.figureId, 'nope');
  }
});

test('figure tokens render with the right units and can be discovered before rendering', () => {
  const m = M.buildVentureModel(ventureInput());
  const template = 'Funding: {{fig:financials.fundingRequiredMicros}} at {{fig:channel.dtc.contributionBps}} on {{fig:bom.lineCount|raw}} lines.';
  assert.deepEqual(Fg.referencedFigureIds(template), [
    'bom.lineCount', 'channel.dtc.contributionBps', 'financials.fundingRequiredMicros',
  ]);
  const out = Fg.renderFigureTokens(template, m.figures);
  assert.match(out, /\$24,623\.65/);   // the hand-derived cash trough
  assert.match(out, /47\.50%/);        // 4,750 bps of contribution
  assert.match(out, /on 3 lines/);     // three BOM nodes
});

test('posture is DERIVED: one estimated cost line makes the whole model an estimate', () => {
  const input = ventureInput();
  const m = M.buildVentureModel(input);
  assert.equal(m.posture, 'estimate');

  // Replace every money assumption with a vendor quote and the posture lifts.
  const quoted = ASSUMPTIONS.map((a) => (a.unit === 'micros'
    ? { ...a, source: { kind: 'vendor-quote', vendor: 'V', quoteRef: 'Q', quotedOn: '2026-01-01' }, confidence: 'quoted' }
    : a));
  assert.equal(Fg.derivePosture(A.buildLedger(quoted).ledger), 'quoted');
  // Downgrade one of them back and it collapses to an estimate again.
  const oneSoft = quoted.map((a) => (a.id === 'bom.screw.unit-cost' ? { ...a, source: modelEstimate, confidence: 'estimated' } : a));
  assert.equal(Fg.derivePosture(A.buildLedger(oneSoft).ledger), 'estimate');
  // Only measured results earn 'actual'.
  const observed = quoted.map((a) => (a.unit === 'micros' ? { ...a, confidence: 'observed' } : a));
  assert.equal(Fg.derivePosture(A.buildLedger(observed).ledger), 'actual');
});

test('traceability counts are generated and the soft list names the guessed money', () => {
  const m = M.buildVentureModel(ventureInput());
  const t = m.traceability;
  assert.equal(t.totalFigures, Object.keys(m.figures).length);
  assert.equal(t.computedFigures + t.assumptionFigures, Object.values(m.figures).filter((f) => f.kind !== 'count').length);
  // The BOM unit cost rests on a model-authored fastener price, so it is soft.
  assert.ok(t.softFigureIds.includes('bom.recurringUnitMicros'));
  assert.equal(t.ledger.total, m.input.ledger.order.length);
  // And the generated count figure agrees with the ledger it was generated from.
  assert.equal(m.figures['ledger.total'].value, m.input.ledger.order.length);
  assert.equal(m.figures['ledger.softMoneyCount'].value, t.ledger.softMoneyIds.length);
});

test('a duplicate assumption id is surfaced rather than silently merged', () => {
  const dup = [...ASSUMPTIONS, { ...ASSUMPTIONS[1], value: D(99) }];
  const { ledger, issues } = A.buildLedger(dup);
  assert.equal(ledger.order.length, ASSUMPTIONS.length, 'order does not gain a phantom entry');
  assert.equal(ledger.byId['bom.shell.unit-cost'].value, D(99), 'the later record wins');
  assert.ok(issues.some((i) => /Duplicate assumption id/.test(i.message)));
});

test('collectRefs dedupes and sorts so a provenance chain is stable output', () => {
  assert.deepEqual(
    A.collectRefs(['b', 'a'], { assumptionRefs: ['a', 'c'] }, undefined, null, []),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(A.unresolvedRefs(A.buildLedger(ASSUMPTIONS).ledger, ['duty.hts.rate', 'ghost', 'ghost']), ['ghost']);
});
