/**
 * Venture Plan - the "What would have to be true" verdicts and the publish state agree with the engine.
 *
 * Live (2026-10-12 sweep 6, reproduced on a fresh venture): break-even needed 85.2% sell-through while the plan sells
 * 100%, and the row read "Gap -14.8% / breached" because the sell-through threshold was compared lower-is-better. The
 * landed-cost, factory-price and run rows printed "no plan value to compare" while the tiles above showed $46.52 and
 * $33.29: the rows read m.landed / m.bom / m.runQtyUnits, which the stored snapshot does not carry. The header said
 * "This model will not publish. 0 blocking issue(s)" and "Figures resting on a guess 0 of 37" while every headline
 * tile was labelled guessed: the snapshot keeps issues as "[block] where: message" strings, and has no traceability
 * lists. This suite runs the page's own functions (extracted from tools/venture.html) against stub elements, with
 * figure values and inversions copied from the live reproduction.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sell-through headroom is headroom; the plan's landed cost, factory cost and run are read from the figure registry and the inversion answer; stored "[severity] where: message" warnings count as issues; the posture strip counts the guessed figures and the unregistered inputs the page shows.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The sell-through row's plan side is the share the plan's demand sells, min(demand.units, planned run) / planned run, not a fixed 100%: the package engine's own fixture with conservative demand 400 on a 1,000 run loses $5,469.34, needs 51.1% and sells 40%, and the row printed "+48.9% headroom". A threshold above 100% reads "impossible"; a missing demand or run figure shows no plan value instead of a made-up one.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Step 4 with documents stored and a model that will not publish says the documents are rendered and marked not publishable until the blockers clear; live it said "must clear before a document renders" while all 17 documents opened.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'venture.html'), 'utf8');

/** The source of one `function name(...) { ... }` in the page, matched by braces. */
function fnSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `venture.html defines ${name}`);
  let depth = 0;
  for (let i = html.indexOf('{', start); i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    else if (html[i] === '}') { depth -= 1; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(`unbalanced ${name}`);
}

const HELPERS = ['esc', 'isNum', 'group', 'usd', 'roundHalfUp', 'pctOfBps', 'pctOfRatio', 'count', 'fmtUnit', 'fmtLoose',
  'figConfidence', 'findAssumption', 'pstat', 'postureWord', 'postureNote', 'documentsBlockedNeed'];
const UNDER_TEST = ['parseWarnings', 'figValue', 'provenanceCounts', 'invRow', 'sellThroughRow', 'renderInversionCard', 'renderHeader', 'renderStages'];

/** The page's functions bound to a state object and stub elements. */
function page(S) {
  const els = {};
  const $ = (id) => { if (!els[id]) els[id] = { hidden: false, innerHTML: '', textContent: '' }; return els[id]; };
  const body = `var MICROS_PER_CENT = 10000; var MICROS_PER_DOLLAR = 1000000;
    var CONFIDENCE = ['quoted', 'observed', 'benchmarked', 'estimated', 'guessed'];\n${
    [...HELPERS, ...UNDER_TEST].map(fnSource).join('\n')}\nreturn { ${UNDER_TEST.join(', ')} };`;
  return { fns: new Function('S', '$', body)(S, $), els };
}

/** Figures as the live snapshot stored them (values from the reproduction venture). */
const FIGURES = {
  'landed.buyerUnitMicros': { value: 46520102, unit: 'micros', kind: 'computed', confidence: 'guessed', assumptionRefs: ['bom.bom.housing.unit-cost', 'landed.freight.container-rate'] },
  'bom.fullyLoadedUnitMicros': { value: 33287135, unit: 'micros', kind: 'computed', confidence: 'guessed', assumptionRefs: ['bom.bom.housing.unit-cost', 'bom.final-assembly.cost'] },
  'breakEven.units': { value: 4995, unit: 'units', kind: 'computed', confidence: 'guessed', assumptionRefs: ['market.demand.base-units'] },
  'landed.containers': { value: 13, unit: 'count', kind: 'computed', confidence: null, assumptionRefs: ['landed.freight.container-rate'] },
};
const ASSUMPTIONS = [{ key: 'bom.bom.housing.unit-cost', confidence: 'medium' }];
const WARNINGS = [
  '[warn] bom:bom.housing: "Housing & Clip Assembly" is costed against No supplier assigned, which has not been qualified; the price and the lead time are both provisional.',
  '[block] model:traceability: 34 figure(s) rest on input(s) that are not registered as assumptions at all: bom.final-assembly.cost, channel.dtc.terms. A number with no source is not an estimate.',
  '[info] landed:incoterm: Under FOB the seller pays "originInland", so it is excluded from buyer landed cost.',
];

const verdictOf = (rowHtml) => /<td class="(pos|neg|faint)">([^<]*)<\/td><\/tr>/.exec(rowHtml);

test('needing less than everything you made to sell is headroom; needing more is breached', () => {
  const { fns } = page({ model: { figures: {} }, assumptions: [] });
  const ok = verdictOf(fns.invRow('Sell-through', 0.852, 'ratio', 1, 'everything you made', 'higher-is-better'));
  assert.deepEqual([ok[1], ok[2]], ['pos', 'headroom']);
  assert.match(fns.invRow('Sell-through', 0.852, 'ratio', 1, 'x', 'higher-is-better'), />\+14\.8%</);
  const bad = verdictOf(fns.invRow('Sell-through', 1.3, 'ratio', 1, 'x', 'higher-is-better'));
  assert.equal(bad[1], 'neg');
});

test('the inversion card compares every threshold with the plan values the tiles show', () => {
  // The live venture's demand covered its run, so the plan sells all 5,000.
  const figures = { ...FIGURES, 'demand.units': { value: 6200, unit: 'units', kind: 'computed', confidence: 'guessed', assumptionRefs: ['market.demand.base-units'] } };
  const S = { model: { figures }, assumptions: ASSUMPTIONS,
    inversions: { maxAffordableLandedUnitMicros: 30467927, maxAffordableFactoryUnitMicros: 17562122, minViableVolumeUnits: 4995,
      breakEvenSellThroughRatio: 0.852, plannedRunUnits: 5000, issues: [] } };
  const card = page(S).fns.renderInversionCard();
  const rows = card.split('<tr>').slice(2);
  assert.equal(rows.length, 4);
  assert.doesNotMatch(card, /no plan value to compare/, 'every row has the plan side');
  assert.match(rows[0], /\$46\.52/); assert.equal(verdictOf(rows[0])[1], 'neg', 'landed $46.52 over the $30.47 ceiling is breached');
  assert.match(rows[1], /\$33\.29/); assert.equal(verdictOf(rows[1])[1], 'neg');
  assert.match(rows[2], />5,000</); assert.equal(verdictOf(rows[2])[2], 'headroom', 'a 5,000 run clears a 4,995 break-even run');
  assert.match(rows[3], />85\.2%<.*>100\.0%<.*>\+14\.8%</s); assert.equal(verdictOf(rows[3])[2], 'headroom');
  assert.match(html, /GET +\/ventures\/:id\/inversion +-> \{ inversions, plannedRunUnits \}/);
});

/** The inversion card's sell-through row for a venture whose demand and planned run are given. */
function sellThroughRowFor(demandUnits, runUnits, ratio) {
  const figures = demandUnits === null ? {} : { 'demand.units': { value: demandUnits, unit: 'units', kind: 'computed', confidence: 'guessed' } };
  const S = { model: { figures }, assumptions: [],
    inversions: { maxAffordableLandedUnitMicros: null, maxAffordableFactoryUnitMicros: null, minViableVolumeUnits: null,
      breakEvenSellThroughRatio: ratio, plannedRunUnits: runUnits, issues: [] } };
  return page(S).fns.renderInversionCard().split('<tr>').slice(2)[3];
}

test('the plan sells the share its demand covers, so demand below the threshold is breached', () => {
  // The package engine on tests/fixture-venture.js with conservative demand 400 and a 1,000 run: net income
  // -$5,469.34, break-even sell-through 0.5113793. The plan sells 400 of 1,000 = 40%, which misses break-even.
  const row = sellThroughRowFor(400, 1000, 0.5113793076202243);
  assert.match(row, /the share the plan’s demand sells/);
  assert.match(row, />51\.1%<.*>40\.0%<.*>−11\.1%</s);
  assert.deepEqual(verdictOf(row).slice(1), ['neg', 'breached — the plan is on the wrong side of this']);
  assert.doesNotMatch(row, /headroom/);
  // Demand above the run sells the whole run, never more than 100%.
  const full = sellThroughRowFor(7000, 5000, 0.852);
  assert.match(full, />100\.0%<.*>\+14\.8%</s);
  assert.equal(verdictOf(full)[2], 'headroom');
  // Demand of 60% clears a 51.1% need.
  assert.equal(verdictOf(sellThroughRowFor(600, 1000, 0.5113793076202243))[2], 'headroom');
});

test('the compiled engine and the page agree: a plan that loses money does not read headroom', () => {
  const fx = require('./fixture-venture.js');
  const input = fx.ventureInput();
  input.demand.selected = 'conservative';
  input.demand.scenarios[0].baselineUnits = 400;
  const model = fx.engine('venture-model').buildVentureModel(input);
  const inv = fx.engine('venture-sensitivity').computeInversions({ model, modelInput: input, requiredContributionBps: 3000 });
  assert.ok(model.figures['financials.netIncomeMicros'].value < 0, 'the reproduction plan loses money');
  const S = { model: { figures: model.figures }, assumptions: [],
    inversions: { ...inv, plannedRunUnits: model.bom.runQtyUnits } };
  const row = page(S).fns.renderInversionCard().split('<tr>').slice(2)[3];
  assert.equal(verdictOf(row)[1], 'neg');
  assert.doesNotMatch(row, /headroom/);
});

test('more than everything you made is impossible, and a missing demand or run is not replaced by 100%', () => {
  const over = sellThroughRowFor(7000, 5000, 1.3);
  assert.deepEqual(verdictOf(over).slice(1), ['neg', 'impossible — more than everything you made would have to sell']);
  assert.doesNotMatch(over, /headroom/);
  for (const row of [sellThroughRowFor(null, 1000, 0.5), sellThroughRowFor(400, null, 0.5), sellThroughRowFor(400, 0, 0.5)]) {
    assert.equal(verdictOf(row)[2], 'no plan value to compare');
    assert.doesNotMatch(row, /100\.0%/);
  }
});

test('stored "[severity] where: message" warnings are issues, so the refused model names its blocker', () => {
  const { fns } = page({ model: null, assumptions: [] });
  const issues = fns.parseWarnings(WARNINGS);
  assert.deepEqual(issues.map((i) => i.severity), ['warn', 'block', 'info']);
  assert.equal(issues[1].where, 'model:traceability');
  assert.match(issues[1].message, /^34 figure\(s\) rest on input\(s\)/);
  assert.deepEqual(fns.parseWarnings(undefined), []);
  assert.equal(fns.parseWarnings([{ severity: 'block', code: 'x' }])[0].code, 'x', 'engine-shaped issues pass through');
  assert.match(html, /issues: m\.issues \|\| parseWarnings\(m\.warnings\),/);
});

test('the header and the stage strip agree with the issues and the guessed chips', () => {
  const model = { figures: FIGURES, posture: 'estimate', canPublish: false, traceability: { byConfidence: { low: 4 } }, issues: page({}).fns.parseWarnings(WARNINGS) };
  const S = { venture: { name: 'Reading light' }, ventureId: 'v1', model, assumptions: ASSUMPTIONS, documents: [] };
  const { fns, els } = page(S);
  fns.renderHeader();
  assert.match(els.publishBanner.innerHTML, /This model will not publish\.<\/b> 1 blocking issue\(s\)/);
  assert.match(els.posture.innerHTML, /Figures resting on a guess<\/div><div class="v nums">3 of 4</);
  // bom.final-assembly.cost, landed.freight.container-rate and market.demand.base-units are named by figures and
  // registered by no assumption.
  assert.match(els.posture.innerHTML, /Unsourced inputs<\/div><div class="v nums">3</);
  fns.renderStages();
  assert.match(els.stages.innerHTML, /1 blocking issue\(s\) must clear before a document renders: model:traceability/);
  // With documents stored they are there to open: Step 4 says so and names what keeps them from publishing.
  const stored = page({ ...S, documents: [{ docKey: 'executive-summary' }, { docKey: 'pitch' }] });
  stored.fns.renderStages();
  assert.match(stored.els.stages.innerHTML, /2 document\(s\) rendered, each marked not publishable until 1 blocking issue\(s\) clear: model:traceability\./);
  assert.doesNotMatch(stored.els.stages.innerHTML, /before a document renders/);
  assert.doesNotMatch(els.stages.innerHTML + els.publishBanner.innerHTML, /\b0 blocking issue/);
  // canPublish false with no stated blocker never prints a zero count either.
  const quiet = { ...S, model: { ...model, issues: [] } };
  const q = page(quiet);
  q.fns.renderHeader(); q.fns.renderStages();
  assert.doesNotMatch(q.els.publishBanner.innerHTML + q.els.stages.innerHTML, /0 blocking issue/);
  assert.match(q.els.publishBanner.innerHTML, /without stating a blocking issue/);
});
