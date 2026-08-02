/**
 * Venture Plan — the LLM boundary, asserted as behaviour.
 *
 * THE ONE THING THAT MUST NOT BE POSSIBLE. A language model is fluent about
 * money. Asked for a bill of materials it will happily return a precise unit cost
 * and, if the schema allows it, a contribution margin — and a precise number reads
 * as a researched number, which is how somebody ends up committing tooling money
 * against a sentence. A persona instruction saying "do not compute" is a hope. The
 * parser is the control, so these guards run the parser.
 *
 * Four rules, each tested by feeding it the thing it must refuse:
 *   - an unknown key (a computed result) REJECTS the row;
 *   - an estimate with no band REJECTS, because a point estimate with no source
 *     is the exact shape that looks researched;
 *   - a claim of `vendor-quote` with nothing attached is DOWNGRADED, and no bot
 *     output can ever produce `vendor-quote` at all;
 *   - a numeral in prose that matches nothing in the model is FLAGGED, and that
 *     one is mutation-tested — change a single digit in the fixture and the guard
 *     must go red, or it is measuring nothing.
 *
 * Plus the document layer's own refusal: a required figure the engine did not
 * compute throws rather than printing a blank, because a blank in a funding
 * document is indistinguishable from a zero.
 *
 * Runs against the COMPILED routes/*.js. Dependency-free node:test.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial guards — unknown-key rejection, the mandatory band, the source-kind downgrade ladder, the confidence cap, mutation-tested prose verification, the every-document-states-a-decision rule, and the throw-on-missing-required-figure refusal.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');

const STUBS = {
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
};
const origLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return origLoad.call(this, request, ...rest);
};

const C = require(path.join(PKG, 'routes', 'venture-bot-contracts.js'));
const D = require(path.join(PKG, 'routes', 'venture-documents.js'));
const CAT = require(path.join(PKG, 'routes', 'venture-doc-catalog.js'));

/** A well-formed assumption row the parser should accept. */
function goodAssumption(over) {
  return Object.assign({
    key: 'market.demand.base-units', domain: 'market', label: 'Annual demand',
    unit: 'units', valueNum: 5000, lowNum: 2000, highNum: 9000,
    sourceKind: 'model-estimate', confidence: 'medium',
  }, over || {});
}

/** A well-formed BOM line the parser should accept. */
function goodBomLine(over) {
  return Object.assign({
    ref: 'PROJ', partName: 'Short-throw projector module', qtyPerUnit: 1,
    lowMicros: 28000000, highMicros: 85000000, confidence: 'low',
  }, over || {});
}

/* ══ 1. a bot cannot return a computed result ════════════════════════════ */

test('an assumption row carrying an unknown key is REJECTED, not repaired', () => {
  const payload = JSON.stringify({
    assumptions: [
      goodAssumption(),
      // The failure this whole package exists to prevent: a fluent, confident,
      // entirely invented financial result riding in beside honest inputs.
      Object.assign(goodAssumption({ key: 'finance.margin' }), { contributionMargin: 4200 }),
    ],
  });
  const out = C.parseAssumptionOutput(payload);
  assert.equal(out.ok, true);
  assert.equal(out.rows.length, 1, 'the clean row survives; the one with a computed result does not');
  assert.equal(out.rows[0].key, 'market.demand.base-units');
  assert.equal(out.rejected.length, 1);
  assert.match(out.rejected[0], /unknown key "contributionMargin"/);
});

test('a whole reply of computed results yields ZERO assumptions', () => {
  const out = C.parseAssumptionOutput(JSON.stringify({
    assumptions: [
      Object.assign(goodAssumption({ key: 'a.b.c' }), { breakEvenUnits: 1200 }),
      Object.assign(goodAssumption({ key: 'd.e.f' }), { npv: 91000 }),
    ],
  }));
  assert.deepEqual(out.rows, [], 'nothing a model computed can enter the ledger');
  assert.equal(out.rejected.length, 2);
});

/* ══ 2. an estimate must carry a band ════════════════════════════════════ */

test('a model estimate with no low/high band is dropped', () => {
  const out = C.parseAssumptionOutput(JSON.stringify({
    assumptions: [goodAssumption({ lowNum: undefined, highNum: undefined })],
  }));
  assert.deepEqual(out.rows, []);
  assert.match(out.rejected[0], /must carry a low\/high band/);
});

test('an inverted band is dropped rather than silently swapped', () => {
  const out = C.parseAssumptionOutput(JSON.stringify({
    assumptions: [goodAssumption({ lowNum: 9000, highNum: 2000 })],
  }));
  assert.deepEqual(out.rows, []);
  assert.match(out.rejected[0], /band is inverted/);
});

test('a BOM line without a price band is dropped — an unbanded cost reads as known', () => {
  const out = C.parseBomOutput(JSON.stringify({
    bom_lines: [goodBomLine(), goodBomLine({ ref: 'CASE', lowMicros: undefined, highMicros: undefined })],
  }));
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].ref, 'PROJ');
  assert.match(out.rejected[0], /a cost line must carry a low\/high band/);
});

/* ══ 3. a bot cannot certify its own number ══════════════════════════════ */

test('a claimed vendor-quote with no evidence is downgraded to a model estimate', () => {
  assert.equal(C.resolveSourceKind('vendor-quote', undefined, undefined), 'model-estimate');
  assert.equal(C.resolveSourceKind('published-source', undefined, undefined), 'model-estimate');
  assert.equal(C.resolveSourceKind('user-entered', undefined, undefined), 'model-estimate');
});

test('even WITH evidence a bot can never produce vendor-quote', () => {
  const withUrl = C.resolveSourceKind('vendor-quote', 'https://example.invalid/rate-card', undefined);
  assert.equal(withUrl, 'published-source',
    'a received quote is a human action recorded through POST /quotes, and nothing else');
  assert.equal(C.resolveSourceKind('published-source', 'https://example.invalid/x', undefined), 'published-source');
  // Nor a user's own entry: that is a person typing into the assumption editor.
  assert.equal(C.resolveSourceKind('user-entered', 'https://example.invalid/x', undefined), 'published-source');
});

test('a bare string is not evidence — a prose note cannot manufacture a source', () => {
  // The earlier rule accepted any `sourceDetail` of eight characters or more, which
  // meant "see p.12" promoted a guess to a published source. A bot that writes
  // eight characters is not a bot that read a page, so only a URL counts now — and
  // even a URL is never fetched, which is why the confidence ceiling downstream
  // still caps a published source at `benchmarked`.
  assert.equal(C.resolveSourceKind('published-source', undefined, 'see p.12 of the supplier rate card'), 'model-estimate');
  assert.equal(C.resolveSourceKind('vendor-quote', undefined, 'quoted by a supplier last week'), 'model-estimate');
  assert.equal(C.resolveSourceKind('published-source', 'not-a-url', 'a detailed note'), 'model-estimate');
  // The row is still accepted; it is just recorded as what it is.
  const out = C.parseAssumptionOutput(JSON.stringify({
    assumptions: [goodAssumption({ sourceKind: 'published-source', sourceDetail: 'CBP fee schedule, page 4' })],
  }));
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].sourceKind, 'model-estimate');
  assert.equal(out.rows[0].sourceDetail, 'CBP fee schedule, page 4', 'the claim is kept, it is just not believed');
});

test('a bot claiming HIGH confidence in its own estimate is capped at medium', () => {
  const out = C.parseAssumptionOutput(JSON.stringify({
    assumptions: [goodAssumption({ confidence: 'high', sourceKind: 'vendor-quote' })],
  }));
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].sourceKind, 'model-estimate');
  assert.equal(out.rows[0].confidence, 'medium',
    'the model may not tell you it is confident about a number it invented');
});

/* ══ 4. the JSON extractor is not fooled by wrapping ═════════════════════ */

test('a fenced or prefixed reply still parses; a reply with no object fails loudly', () => {
  const payload = '{"assumptions":[]}';
  assert.deepEqual(C.extractJsonObject('Here you go:\n```json\n' + payload + '\n```'), { assumptions: [] });
  assert.deepEqual(C.extractJsonObject(payload), { assumptions: [] });
  assert.equal(C.extractJsonObject('I could not do that.'), null);
  assert.equal(C.extractJsonObject('{"broken": '), null);
  const failed = C.parseAssumptionOutput('sorry, no JSON here');
  assert.equal(failed.ok, false, 'an unusable reply is a failure, never an empty success');
});

test('a brace inside a string does not truncate the object', () => {
  const parsed = C.extractJsonObject('{"note":"a } inside a string","n":1}');
  assert.deepEqual(parsed, { note: 'a } inside a string', n: 1 });
});

/* ══ 5. prose numerals are checked — and the check is mutation-tested ════ */

test('verifyProseNumbers passes numerals that match the model', () => {
  const known = [18420000, 5000, 4250];
  const prose = 'Landed cost is $18.42 per unit at a run of 5,000 units.';
  assert.deepEqual(C.verifyProseNumbers(prose, known), [],
    'a figure copied exactly from the table must not be flagged');
});

test('MUTATION: change one digit in the prose and the guard goes red', () => {
  const known = [18420000, 5000, 4250];
  const clean = 'Landed cost is $18.42 per unit at a run of 5,000 units.';
  const mutated = clean.replace('$18.42', '$18.43');
  assert.deepEqual(C.verifyProseNumbers(clean, known), []);
  const flagged = C.verifyProseNumbers(mutated, known);
  assert.ok(flagged.length >= 1,
    'a single fabricated digit must surface — if this passes, the check is measuring nothing');
  assert.ok(flagged.some((f) => f.includes('18.43')));
});

test('a fabricated large figure in prose is flagged', () => {
  const flagged = C.verifyProseNumbers('We project $4.2m of revenue in year one.', [18420000, 5000]);
  assert.ok(flagged.length >= 1, 'a revenue number nobody computed is exactly what must not ride through');
});

test('ordinary small integers in a sentence are not flagged', () => {
  assert.deepEqual(C.verifyProseNumbers('The season is a 6 week window across 3 channels.', [999999]), [],
    'flagging every count would drown the real hits and train the reader to ignore the badge');
});

/* ══ 6. the catalogue cannot be padded ═══════════════════════════════════ */

test('EVERY document states the decision it supports and has sections', () => {
  assert.equal(CAT.DOC_CATALOG.length, 17);
  for (const spec of CAT.DOC_CATALOG) {
    assert.ok(spec.decision && spec.decision.trim().length > 20,
      `${spec.key} must state a real decision — a document that supports none is padding`);
    assert.ok(spec.sections.length >= 1, `${spec.key} must have sections`);
    assert.ok(spec.audience && spec.audience.trim(), `${spec.key} must name its reader`);
  }
  assert.equal(new Set(CAT.DOC_KEYS).size, 17, 'document keys are unique');
});

test('no document specification can contain a literal number to print', () => {
  // Figures are resolved by ID from the computed registry. A spec that carried a
  // number would be a place a number could enter a plan without being computed.
  for (const spec of CAT.DOC_CATALOG) {
    for (const section of spec.sections) {
      if (section.kind !== 'figures') continue;
      for (const key of [...section.keys, ...(section.optionalKeys || [])]) {
        assert.equal(typeof key, 'string');
        assert.ok(!/^\d/.test(key), `${spec.key} references a literal, not a figure id`);
      }
    }
  }
});

/* ══ 7. the renderer refuses rather than printing a blank ════════════════ */

/** A minimal render source with exactly the figures a test wants. */
function sources(figures, over) {
  return Object.assign({
    figures,
    tables: {},
    coverage: {
      totalAssumptions: 2, bySourceKind: { 'model-estimate': 1 },
      byConfidence: { low: 1 }, estimatePct: 50,
    },
    posture: 'estimate', canPublish: false, warnings: [], assumptions: [], prose: {},
    ventureName: 'Widget', computedAt: '2026-08-02T00:00:00.000Z',
  }, over || {});
}

/** One computed figure. */
function figure(id, value, unit) {
  return {
    id, label: id, value, unit: unit || 'micros', kind: 'computed',
    formula: 'test', assumptionRefs: ['a.b.c'], confidence: 'estimated',
  };
}

test('a REQUIRED figure the engine did not compute makes the render THROW, naming it', () => {
  const spec = CAT.getDocSpec('cash-flow-and-working-capital');
  const partial = {
    'financials.peakCashTroughMicros': figure('financials.peakCashTroughMicros', -1000000),
    // fundingRequiredMicros and monthsUnderwater deliberately absent.
  };
  assert.throws(
    () => D.renderDocument(spec, sources(partial)),
    (err) => {
      assert.equal(err.name, 'MissingFiguresError');
      assert.deepEqual(err.figureIds,
        ['financials.fundingRequiredMicros', 'financials.monthsUnderwater']);
      return true;
    },
    'a blank where a funding number belongs is indistinguishable from a zero',
  );
});

test('an OPTIONAL figure that is legitimately absent renders as "not reachable"', () => {
  const spec = CAT.getDocSpec('financial-model');
  const figures = {
    'financials.revenueMicros': figure('financials.revenueMicros', 0),
    'financials.contributionMicros': figure('financials.contributionMicros', -5000000),
    'financials.fixedCostsMicros': figure('financials.fixedCostsMicros', 14000000),
    'financials.netIncomeMicros': figure('financials.netIncomeMicros', -19000000),
    // breakEven.units is optional: "never" is an answer, not a hole.
  };
  const doc = D.renderDocument(spec, sources(figures));
  assert.match(doc.bodyMd, /not reachable/);
  assert.match(doc.bodyMd, /breakEven\.units/);
});

test('the posture header is COMPUTED and states the estimate share numerically', () => {
  const spec = CAT.getDocSpec('assumption-register');
  const doc = D.renderDocument(spec, sources({}));
  assert.match(doc.bodyMd, /Posture: estimate/);
  assert.match(doc.bodyMd, /50%/, 'the share is generated from the coverage, never typed');
  assert.match(doc.bodyMd, /will not publish/,
    'an unpublishable model says so in the header, not in a footnote');
  assert.match(doc.bodyMd, /Decision this supports:/);
});

test('a publishable model gets the traceability line instead of the refusal', () => {
  const spec = CAT.getDocSpec('assumption-register');
  const doc = D.renderDocument(spec, sources({}, { canPublish: true }));
  assert.ok(!/will not publish/.test(doc.bodyMd));
  assert.match(doc.bodyMd, /traces to a registered assumption/);
});

test('prose that fabricates a number is reported on the rendered document', () => {
  const spec = CAT.getDocSpec('concept-brief');
  const doc = D.renderDocument(spec, sources(
    { 'bom.lineCount': figure('bom.lineCount', 14, 'count'), 'landed.containers': figure('landed.containers', 2, 'count') },
    { prose: { concept: 'A prop that retails at $299.99.', customer: 'Families.', 'out-of-scope': 'Nothing.' } },
  ));
  assert.ok(doc.unverifiedNumbers.some((n) => n.includes('299.99')),
    'a price nobody computed is surfaced so the surface can badge the document');
});

test('a missing prose section says so rather than leaving a silent gap', () => {
  const spec = CAT.getDocSpec('concept-brief');
  const doc = D.renderDocument(spec, sources(
    { 'bom.lineCount': figure('bom.lineCount', 3, 'count'), 'landed.containers': figure('landed.containers', 1, 'count') },
  ));
  assert.match(doc.bodyMd, /Not written\./);
  assert.deepEqual(doc.unverifiedNumbers, []);
});

/* ══ 8. the register survives a spreadsheet ══════════════════════════════ */

test('the assumption register CSV escapes quotes and keeps the source columns', () => {
  const csv = D.renderRegisterCsv([{
    key: 'bom.PROJ.unit-cost', domain: 'manufacturing', label: 'A "short throw" module',
    unit: 'micros', valueNum: 56500000, valueText: null, lowNum: 28000000, highNum: 85000000,
    sourceKind: 'model-estimate', sourceDetail: null, sourceUrl: null, confidence: 'low',
    authoredBy: 'venture-bom-analyst', createdAt: '2026-08-02T00:00:00.000Z',
  }]);
  const [head, row] = csv.split('\n');
  assert.ok(head.includes('source_kind') && head.includes('confidence') && head.includes('authored_by'));
  assert.ok(row.includes('"A ""short throw"" module"'), 'a quote in a label cannot break the file');
  assert.ok(row.includes('model-estimate'),
    'the CSV is the artefact somebody works through replacing guesses with quotes');
});
