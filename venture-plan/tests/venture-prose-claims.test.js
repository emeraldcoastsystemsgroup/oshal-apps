/**
 * Venture Plan - narration states break-even as computed and a contradicting claim carries a visible check note; a retry asks for the JSON alone.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: the narrated "What would have to be true" said the funding covers "the 36 month cash deficit before the venture reaches break-even" while the figure table read break-even not reachable. Over the REAL document catalogue and the compiled modules: every document that prints break-even reports it unreachable when the snapshot has no value; the narrate prompt (the compiled venture-bots over a recording bot rail) names it under NOT REACHABLE; a sentence claiming it is reached is removed while negated sentences, {{fig:...}} tokens, "$1.50" and paragraph breaks stay; the strict analyst retry carries STRICT_JSON and the first call does not.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Review of sweep 10: the filter dropped every un-negated sentence naming break-even, so the conditions "What would have to be true" is for ("To break even within the horizon, the landed cost would have to fall to $2.10 per lid.", "Demand would need to triple for the plan to reach break-even.") vanished. Must-keep: those and other conditional or hypothetical sentences; must-remove: the original false claim and other assertions that break-even is reached (a reach verb, "breaks even", a time or volume, "expected to"); a section left empty is kept with a note that says why, never dropped.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Round 14: nothing is deleted. breakEvenFacts over the REAL engine (the fixture venture, its P&L through a JSONB round trip) states break-even reached with its month and run size, or not reached with the horizon net income as the gap; the narrate prompt carries those lines under BREAK-EVEN AS COMPUTED. withBreakEvenCheck keeps every sentence: conditions (the round-12 example, "At $2.10 per lid ...", "With demand tripled ...") get no note; the round-13 modal claims ("The $250,000 raise would cover the 36 month cash deficit before the venture reaches break-even.", "... which should reassure investors.", "Sales of ... carry the venture past break-even.") keep their prose and get the visible check note; a reached model gets no note; no section is dropped.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const prompts = [];
const STUBS = {
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  '@/app/routes/inline-bot-execution': {
    executeBotOrInline: async (_ctx, _client, agentId, request) => { prompts.push({ agentId, text: request.text }); return { response: '{}', cost: 0 }; },
  },
};
const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};
const bots = require(path.join(PKG, 'routes', 'venture-bots.js'));
Module._load = originalLoad;
const claims = require(path.join(PKG, 'routes', 'venture-prose-claims.js'));
const { DOC_CATALOG } = require(path.join(PKG, 'routes', 'venture-doc-catalog.js'));

const NOTE = '*Check: the computed model does not reach break-even within the horizon.*';
const NOT_REACHED = { reached: false };
const REACHED = { reached: true };

/** Sentences that set a condition or a hypothesis for breaking even: never a claim that it is reached. */
const CONDITIONS = [
  'To break even within the horizon, the landed cost would have to fall to $2.10 per lid.',
  'Demand would need to triple for the plan to reach break-even.',
  'Pricing above $14 is the main lever.',
  'If the landed cost falls below $2.10, the plan breaks even in month 30.',
  'The plan must sell 9,000 lids a year to break even.',
  'Break-even could come in year three with a cheaper lid.',
  'A cheaper freight lane is what it takes to reach break-even.',
  'Break-even depends on the landed cost.',
  'Without a cheaper lid the plan never breaks even.',
  'At $2.10 per lid the plan breaks even in month 30.',
  'With demand tripled the plan breaks even in year three.',
  'The plan breaks even in month 30, assuming the price holds.',
  'Once demand triples, the plan breaks even in month 20.',
];

/** Sentences that assert break-even IS reached, including the round-13 review's modal forms (a modal in ANOTHER clause). */
const CLAIMS = [
  'The funding covers the 36 month cash deficit before the venture reaches break-even.',
  'The $250,000 raise would cover the 36 month cash deficit before the venture reaches break-even.',
  'The funding should cover the 36 month cash deficit before the venture reaches break-even.',
  'The raise needs to cover the 36 month cash deficit before the venture reaches break-even.',
  'The venture reaches break-even in month 14, after which it needs only working capital.',
  'The company is expected to break even in year two, which would allow a second product line.',
  'Break-even arrives in month 14 and the founders may then take a salary.',
  'Once the plan breaks even in month 18, it could fund expansion from cash flow.',
  'The plan breaks even in month 14, which should reassure investors.',
  'Sales of {{fig:demand.unitsPerYear}} units carry the venture past break-even.',
  'It reaches break-even in month 14.',
  'Break-even comes at 4,000 units.',
  'The time to break-even is 14 months.',
  'Break-even arrives in May.',
  'Pricing above $14 lets the plan break even.',
  'At month 14 the plan breaks even.',
];

/** The fixture venture through the REAL compiled engine, its tables round-tripped as the snapshot stores them (JSONB). */
function engineSnapshot(overrides) {
  const Module = require('node:module');
  const load = Module._load;
  Module._load = function stubbed(request, ...rest) {
    return Object.prototype.hasOwnProperty.call(STUBS, request) ? STUBS[request] : load.call(this, request, ...rest);
  };
  try {
    const { engine, ventureInput } = require('./fixture-venture');
    const model = engine('venture-model').buildVentureModel(ventureInput(overrides && overrides(require('./fixture-venture'))));
    const tables = engine('venture-documents').buildTables(model, { vendors: [], tasks: [], roles: [], bomLines: [] });
    return { model, figures: JSON.parse(JSON.stringify(model.figures)), tables: JSON.parse(JSON.stringify(tables)) };
  } finally {
    Module._load = load;
  }
}

test('break-even is not a NOT REACHABLE figure any more: breakEvenFacts states it, reached or not', () => {
  const printing = DOC_CATALOG.filter((spec) => spec.sections.some((s) => s.kind === 'figures' && (s.optionalKeys || []).includes('breakEven.units')));
  assert.ok(printing.length >= 2, 'the executive documents print break-even');
  for (const spec of printing) {
    assert.equal(claims.unreachableFigures(spec, {}).some((u) => u.id === 'breakEven.units'), false, spec.key);
  }
  const withRoles = DOC_CATALOG.find((spec) => spec.sections.some((s) => (s.optionalKeys || []).includes('headcount.totalMicros')));
  assert.ok(withRoles, 'the org document prints headcount cost');
  assert.deepEqual(claims.unreachableFigures(withRoles, {}).find((u) => u.id === 'headcount.totalMicros'),
    { id: 'headcount.totalMicros', fact: 'Headcount cost: no roles are planned' }, 'other unreachable figures are still named');
});

test('breakEvenFacts over the real engine: the reached month and run size, or not reached with the horizon net income as the gap', () => {
  const reached = engineSnapshot();
  const facts = claims.breakEvenFacts(reached.figures, reached.tables);
  const [y, m] = reached.model.breakEven.accountingBreakEvenMonth.split('-').map(Number);
  assert.equal(facts.reached, true);
  assert.equal(facts.month, (y - 2026) * 12 + m, 'the month the engine computed, counted from the plan start');
  assert.equal(facts.units, reached.model.breakEven.units);
  assert.equal(facts.horizonMonths, 24);
  assert.deepEqual(facts.lines, [
    `At the planned run size, cumulative net income first turns non-negative in month ${facts.month} of the 24-month plan horizon (month 1 is the first plan month).`,
    'The smallest run size that breaks even within the horizon is {{fig:breakEven.units}}.',
  ]);
  const short = engineSnapshot(({ D }) => ({ pricing: { kind: 'fixed-shelf', shelfPriceMicros: D(30) } }));
  assert.equal(short.model.breakEven.units, null, 'at $30 no run size breaks even');
  assert.ok(short.figures['financials.netIncomeMicros'].value < 0);
  assert.deepEqual(claims.breakEvenFacts(short.figures, short.tables), {
    reached: false, month: null, units: null, horizonMonths: 24,
    lines: [
      'Break-even is NOT reached within the 24-month plan horizon.',
      'At the planned run size, cumulative net income does NOT turn non-negative within the 24-month plan horizon.',
      'Net income across the horizon is {{fig:financials.netIncomeMicros}}: that shortfall is the gap the plan would have to close to break even.',
      'No run size in this model breaks even within the 24-month plan horizon.',
    ],
  });
});

test('the narrate prompt states break-even as computed and lets a condition stay a condition', async () => {
  const lines = ['Break-even is NOT reached within the 24-month plan horizon.', 'No run size in this model breaks even within the 24-month plan horizon.'];
  prompts.length = 0;
  await bots.narrate({}, {}, 'alice', 'Executive summary', ['what-must-be-true'], { 'cash.peakNeedMicros': 'Peak cash need: $123,326.92' }, [], lines);
  const text = prompts[0].text;
  assert.match(text, /BREAK-EVEN AS COMPUTED \(state break-even only as computed here/);
  assert.match(text, /may be written as a condition/);
  for (const line of lines) assert.ok(text.includes(`  ${line}`), line);
  assert.doesNotMatch(text, /NOT REACHABLE/, 'break-even is not a NOT REACHABLE figure');
  prompts.length = 0;
  await bots.narrate({}, {}, 'alice', 'Executive summary', ['what-must-be-true'], {});
  assert.doesNotMatch(prompts[0].text, /BREAK-EVEN AS COMPUTED/, 'nothing is added without facts');
});

test('conditions stay exactly as written with no note; the round-12 example is untouched', () => {
  const review = 'To break even within the horizon, the landed cost would have to fall to $2.10 per lid. Demand would need to triple '
    + 'for the plan to reach break-even. Pricing above $14 is the main lever.';
  assert.deepEqual(claims.withBreakEvenCheck({ 'what-must-be-true': review }, NOT_REACHED),
    { prose: { 'what-must-be-true': review }, flagged: [] });
  for (const sentence of CONDITIONS) {
    assert.equal(claims.claimsReached(sentence), false, `condition: ${sentence}`);
    assert.deepEqual(claims.withBreakEvenCheck({ s: sentence }, NOT_REACHED), { prose: { s: sentence }, flagged: [] }, sentence);
  }
});

test('a claim that break-even is reached keeps its prose and gets the visible check note, never a deletion', () => {
  for (const sentence of CLAIMS) {
    assert.equal(claims.claimsReached(sentence), true, `claim: ${sentence}`);
    const text = `Demand is an estimate. ${sentence} Pricing is the lever.`;
    assert.deepEqual(claims.withBreakEvenCheck({ s: text }, NOT_REACHED), { prose: { s: `${text}\n\n${NOTE}` }, flagged: ['s'] }, sentence);
  }
  assert.doesNotMatch(NOTE, /\d/, 'the note carries no numeral for the unverified-number check to refuse');
  assert.equal(claims.BREAK_EVEN_CHECK_NOTE, NOTE);
});

test('one note per section; negations, tokens, decimals and paragraphs stay; no section is dropped', () => {
  const prose = {
    'what-must-be-true': 'Each lid lands at {{fig:landed.buyerUnitMicros}} with $1.50 of freight. The funding covers the 36 month cash '
      + 'deficit before the venture reaches break-even. It reaches break-even in month 14.\n\nWithout a cheaper lid the plan never breaks even.',
    risks: 'The plan breaks even in month 14.',
    channels: 'Amazon carries most of the volume.',
  };
  const out = claims.withBreakEvenCheck(prose, NOT_REACHED);
  assert.deepEqual(out.prose, {
    'what-must-be-true': `${prose['what-must-be-true']}\n\n${NOTE}`, risks: `${prose.risks}\n\n${NOTE}`, channels: prose.channels,
  });
  assert.deepEqual(out.flagged.sort(), ['risks', 'what-must-be-true']);
});

test('a plan whose computed model reaches break-even gets no note, whatever its prose says', () => {
  const reached = engineSnapshot();
  const facts = claims.breakEvenFacts(reached.figures, reached.tables);
  const prose = { s: CLAIMS.join(' '), t: CONDITIONS.join(' ') };
  assert.deepEqual(claims.withBreakEvenCheck(prose, facts), { prose, flagged: [] });
  assert.deepEqual(claims.withBreakEvenCheck(prose, REACHED), { prose, flagged: [] });
});

test('the strict analyst retry asks for the JSON object alone; the first call does not', async () => {
  const spec = { name: 'Mug lid', ideaText: 'a spill-proof lid', spec: {} };
  prompts.length = 0;
  await bots.authorBom({}, {}, 'alice', spec, 5000);
  await bots.authorBom({}, {}, 'alice', spec, 5000, true);
  await bots.authorMarket({}, {}, 'alice', spec, true);
  await bots.authorOps({}, {}, 'alice', spec, {}, true);
  assert.equal(prompts[0].text.includes(bots.STRICT_JSON), false);
  for (const call of prompts.slice(1)) assert.ok(call.text.includes(bots.STRICT_JSON), call.agentId);
  assert.match(bots.STRICT_JSON, /could not be read as JSON\. Reply with the JSON object ONLY: start with \{ and end with \}/);
});
