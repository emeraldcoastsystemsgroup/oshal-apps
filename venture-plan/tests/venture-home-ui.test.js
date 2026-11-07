/**
 * Venture Plan - the console's first screen (UX audit 2026-11-05, venture-plan--venture-home, grade C).
 *
 * The audit found 520 px of banners and a static five-box step strip before the tabs, code names ("buyerTotalMicros /
 * units", "max(0, -trough)") on the headline cards, Delete beside Run the analysts, and Break-even volume reading
 * "not computed" on a model with a $4.05 contribution. Read-only on production, the reproduction venture's stored
 * model holds "[warn] financials:break-even: No volume up to 5000 units turns a profit over the horizon": the engine
 * searched up to the planned run and no run size in it breaks even (fixed costs $441,758 across the horizon), so the
 * honest card says that instead of "not computed" or "Add fixed costs". This suite runs the page's own functions
 * (extracted from tools/venture.html) against stub elements, with every figure formula the real engine registers.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial (1.5.3): a card's formula reads in words or not at all for every figure the engine registers; Break-even names the run the engine searched or that each unit loses money; the one status line reads the run, posture and publish state and its info button controls the details; Rename saves through PATCH /ventures/:id; the venture menu holds switching, New venture, Rename and Delete, the head keeps Recompute and the one primary Run the analysts; the stage strip is one line and the tabs are the phone's bottom bar.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { engine, ventureInput } = require('./fixture-venture');

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
/** A `var NAME = ...;` statement of the page, up to the line that closes it. */
function varSource(name) {
  const start = html.indexOf(`var ${name} = `);
  assert.ok(start >= 0, `venture.html declares ${name}`);
  return html.slice(start, html.indexOf('};', start) + 2);
}

const HELPERS = ['esc', 'isNum', 'group', 'usd', 'roundHalfUp', 'pctOfBps', 'pctOfRatio', 'count', 'fmtUnit', 'fmtFigure', 'figConfidence', 'findAssumption', 'confChip',
  'parseWarnings'];
const UNDER_TEST = ['formulaWords', 'missingFigure', 'figTile', 'ventureName', 'renameVenture'];

/** The page's functions bound to a state object, stub elements and a recording API. */
function page(S, world = { calls: [], toasts: [], failures: [], rail: 0 }) {
  const els = {};
  const $ = (id) => {
    if (!els[id]) els[id] = { hidden: false, innerHTML: '', textContent: '', value: '', disabled: false, attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; } };
    return els[id];
  };
  const api = (method, url, body) => { world.calls.push([method, url, body]); return Promise.resolve({ venture: { id: 'v1', name: body && body.name } }); };
  const body = `var MICROS_PER_CENT = 10000; var MICROS_PER_DOLLAR = 1000000;
    var CONFIDENCE = ['quoted', 'observed', 'benchmarked', 'estimated', 'guessed']; var CONFIDENCE_NOTE = {};
    ${varSource('FORMULA_WORDS')}\n${[...HELPERS, ...UNDER_TEST].map(fnSource).join('\n')}\nreturn { ${UNDER_TEST.join(', ')} };`;
  const fns = new Function('S', '$', 'api', 'toast', 'fail', 'renderRail', body)(S, $, api,
    (msg, kind) => world.toasts.push([msg, kind]), (e) => world.failures.push(e.message), () => { world.rail += 1; });
  return { fns, els, $, world };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('every figure the engine registers reads on its card in words or not at all, never as code', () => {
  const model = engine('venture-model').buildVentureModel(ventureInput());
  const { fns } = page({ model: null, assumptions: [] });
  const ids = Object.keys(model.figures);
  assert.ok(ids.length > 30, `the engine registers its figures (${ids.length})`);
  for (const id of ids) {
    const words = fns.formulaWords(id, model.figures[id]);
    assert.doesNotMatch(words, /[a-z][A-Z]|\w\(|_/, `${id}: "${words}"`);
  }
  assert.equal(fns.formulaWords('landed.buyerUnitMicros', { formula: 'buyerTotalMicros / units' }), 'landed cost of the run ÷ units');
  assert.equal(fns.formulaWords('financials.fundingRequiredMicros', { formula: 'max(0, -trough)' }), 'the deepest cash position, as the amount to raise');
  assert.equal(fns.formulaWords('x.y', { formula: 'sum of monthly revenue' }), 'sum of monthly revenue', 'a formula in words stays');
  assert.equal(fns.formulaWords('x.y', { formula: 'someMicros / units' }), '', 'an unknown code formula shows nothing');
});

test('the headline cards print the words, and a card with no words has no formula line', () => {
  const figures = {
    'landed.buyerUnitMicros': { value: 21442810, unit: 'micros', label: 'Landed cost per unit (BOM cost included)', formula: 'buyerTotalMicros / units' },
    'x.code': { value: 1, unit: 'count', label: 'Code', formula: 'fooBar(1)' },
  };
  const { fns } = page({ model: { figures, issues: [] }, assumptions: [] });
  const tile = fns.figTile('landed.buyerUnitMicros', 'Landed cost per unit');
  assert.match(tile, /<div class="f">landed cost of the run ÷ units<\/div>/);
  assert.doesNotMatch(tile, /buyerTotalMicros/);
  assert.doesNotMatch(fns.figTile('x.code', 'Code'), /class="f"/);
});

test('Break-even says the run the engine searched, or that each unit loses money, instead of "not computed"', () => {
  const searched = ['[warn] financials:break-even: No volume up to 5000 units turns a profit over the horizon, so break-even lies outside the range this plan contemplates.'];
  const S = { model: { figures: {}, issues: [] }, assumptions: [] };
  const p = page(S);
  S.model.issues = new Function(`${fnSource('parseWarnings')}; return parseWarnings;`)()(searched);
  assert.deepEqual(p.fns.missingFigure('breakEven.units'),
    { v: 'Not within 5,000 units', note: 'No run up to the planned 5,000 units turns a profit over the horizon.' });
  assert.match(p.fns.figTile('breakEven.units', 'Break-even volume'), /<div class="v faint">Not within 5,000 units<\/div>/);
  S.model.issues = [{ severity: 'block', where: 'financials:break-even', message: 'Contribution is -2000000 micros per unit, so every additional unit deepens the loss.' }];
  assert.deepEqual(p.fns.missingFigure('breakEven.units'), { v: 'None', note: 'Each unit sold loses money, so no volume breaks even.' });
  S.model.issues = [];
  assert.equal(p.fns.missingFigure('breakEven.units').v, 'not computed', 'no stated reason keeps the plain gap');
  S.model.issues = new Function(`${fnSource('parseWarnings')}; return parseWarnings;`)()(searched);
  assert.equal(p.fns.missingFigure('financials.netIncomeMicros').v, 'not computed', 'only break-even reads the search');
});

test('Rename saves the new name through PATCH /ventures/:id and shows it in the header and the list', async () => {
  const S = { ventureId: 'v1', venture: { id: 'v1', name: 'old' }, ventures: [{ id: 'v1', name: 'old' }] };
  const p = page(S);
  p.$('renameInput').value = '  Reading light  ';
  p.fns.renameVenture();
  await settle(); await settle();
  assert.deepEqual(p.world.calls, [['PATCH', '/ventures/v1', { name: 'Reading light' }]]);
  assert.equal(p.$('vName').textContent, 'Reading light');
  assert.equal(S.ventures[0].name, 'Reading light');
  assert.equal(S.venture.name, 'Reading light');
  assert.equal(p.world.rail, 1, 'the list is repainted');
  assert.equal(p.$('renameForm').hidden, true);
  assert.deepEqual(p.world.toasts.at(-1), ['Renamed to “Reading light”.', 'ok']);
  const empty = page({ ventureId: 'v1', ventures: [] });
  empty.$('renameInput').value = '   ';
  empty.fns.renameVenture();
  assert.deepEqual(empty.world.calls, [], 'an empty name is not sent');
  assert.deepEqual(empty.world.toasts.at(-1), ['Type the new name first.', 'bad']);
});

test('the status line reads the run, the posture and the publish state, and its info button controls the details', () => {
  const BEGIN = '/* ═══ run status (tests/venture-run-ui.test.js runs this block)';
  const block = html.slice(html.indexOf(BEGIN), html.indexOf('/* ═══ end run status'));
  const els = { statusLine: { hidden: true, innerHTML: '' }, statusDetails: { hidden: true } };
  const S = { ventureId: 'v1', run: null, statusParts: { posture: 'ESTIMATE', soft: 35, computed: 38, quoted: 0, ledger: 50, unsourced: 0, publish: 'warn' } };
  const render = new Function('S', '$', `${fnSource('esc')}\n${block}\nreturn renderStatusLine;`)(S, (id) => els[id]);
  render();
  const shown = els.statusLine.innerHTML.replace(/<[^>]+>/g, '');
  assert.match(shown, /^ESTIMATE · 35 of 38 figures rest on a guess · 0 of 50 assumptions quoted or observed · no unsourced input · Planning instrument, not a quote/);
  assert.match(els.statusLine.innerHTML, /<button class="infobtn subtle" type="button" id="statusInfo" aria-controls="statusDetails" aria-expanded="false"/);
  assert.equal(els.statusLine.hidden, false);
  S.ventureId = null;
  render();
  assert.equal(els.statusLine.hidden, true, 'no venture, no status line');
  assert.match(html, /if \(t\.closest && t\.closest\('#statusInfo'\)\) \{\n\s+var d = \$\('statusDetails'\); d\.hidden = !d\.hidden; renderStatusLine\(\); return;/);
});

test('the head keeps Recompute and the one primary Run the analysts; the venture menu holds the rest', () => {
  const head = html.slice(html.indexOf('<div class="row head-actions-row" id="headActions" hidden>'), html.indexOf('<div class="muted small idea-line" id="vIdea">'));
  assert.match(head, /id="recomputeBtn" type="button"/);
  assert.match(head, /id="researchBtn" class="primary"/);
  assert.doesNotMatch(head, /deleteVentureBtn|Delete/, 'Delete left the top bar');
  const menu = html.slice(html.indexOf('<div class="vmenu" id="ventureMenu" hidden>'), html.indexOf('<div class="row head-actions-row"'));
  for (const id of ['vlist', 'newBtn', 'renameBtn', 'deleteVentureBtn', 'renameForm', 'deleteConfirm']) assert.match(menu, new RegExp(`id="${id}"`), id);
  assert.match(html, /<button class="vname" id="ventureMenuBtn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="ventureMenu"/);
  assert.doesNotMatch(html, /id="(newBtn|emptyNewBtn)"[^>]*class="primary"|class="primary"[^>]*id="(newBtn|emptyNewBtn)"/, 'New venture is secondary');
  const primaries = html.slice(html.indexOf('<body>'), html.indexOf('<div id="tip" hidden>')).match(/<button[^>]*class="primary"[^>]*>/g) || [];
  assert.deepEqual(primaries.map((b) => /id="([^"]+)"/.exec(b)[1]), ['n_go', 'renameSave', 'researchBtn'],
    'one primary on the screen; the others belong to the new-venture form and the rename panel');
  assert.doesNotMatch(html, /<aside class="rail">/, 'no ventures rail: the name menu switches');
});

test('the stage strip is one line, the tabs are the phone bottom bar, and the toast clears it', () => {
  assert.match(html, /\.stages \{ display: flex; gap: 4px; align-items: center; overflow-x: auto; white-space: nowrap;/);
  assert.match(html, /\.stage \.n \{ display: none; \}/);
  assert.match(html, /\.stage\.done \.need, \.stage:not\(\.current\):not\(\.blocked\) \.need \{ display: none; \}/);
  const phone = html.slice(html.indexOf('@media (max-width: 640px)'));
  assert.match(phone, /\.tabs \{ position: fixed; left: 0; right: 0; bottom: 0;/);
  assert.match(phone, /\.tab \{ flex-direction: column; gap: 1px; min-height: 56px;/);
  assert.match(phone, /body\.has-venture \{ padding-bottom: calc\(68px \+ env\(safe-area-inset-bottom\)\); \}/);
  assert.match(phone, /body\.has-venture #toast \{ bottom: calc\(72px \+ env\(safe-area-inset-bottom\)\); \}/);
  assert.match(html, /#toast \{ position: fixed; left: 50%; bottom: 18px; transform: translateX\(-50%\); z-index: 90; border-radius: 10px; pointer-events: none;/);
});
