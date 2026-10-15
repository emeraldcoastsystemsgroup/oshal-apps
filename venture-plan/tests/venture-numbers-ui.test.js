/**
 * Venture Plan - the Numbers tab reads the stored model the way the engine wrote it, and a venture can be deleted.
 *
 * Live (2026-10-11): "Where the shelf price goes" showed 8 identical empty 'dtc' cards with '—' contribution, because
 * the stored snapshot keeps the waterfall as flat step rows and the page read each row as a whole waterfall. "Which
 * guess moves the answer most" listed outcomes that were all worse than the plan's net income even in the favourable
 * direction: the sweep measures against its own rebuild of the current assumptions, which the table never showed,
 * and an import duty of 300 bps read as '300'. The page had no way to delete a venture although DELETE /ventures/:id
 * exists. This suite runs the page's own functions (extracted from tools/venture.html) against stub elements.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Flat waterfall rows group into one card per channel with the engine's contribution figure; sweep rows show the sweep's own baseline and each assumption in its unit, and name a stale saved model; Delete calls DELETE /ventures/:id only after a confirm and returns to the empty state.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 14: after Delete the deleted venture's run banner, posture tiles and publish banner stayed on screen; Delete now clears them and stops a watched run.
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

const HELPERS = ['esc', 'isNum', 'group', 'usd', 'roundHalfUp', 'pctOfBps', 'pctOfRatio', 'count', 'fmtUnit', 'fmtLoose'];
const UNDER_TEST = ['groupWaterfalls', 'waterfallMarks', 'assumptionFormatter', 'tornadoBaselineNote', 'deleteVenture'];

/** The page's functions bound to a state object, stub elements and a recording API. */
function page(S, world) {
  const els = {};
  const $ = (id) => { if (!els[id]) els[id] = { hidden: false, innerHTML: '', textContent: '', disabled: false }; return els[id]; };
  const api = (method, url) => { world.calls.push([method, url]); return Promise.resolve({ ok: true }); };
  const window = { confirm: (msg) => { world.confirms.push(msg); return world.confirmAnswer; } };
  const body = `var MICROS_PER_CENT = 10000; var MICROS_PER_DOLLAR = 1000000;\n${
    [...HELPERS, ...UNDER_TEST].map(fnSource).join('\n')}\nreturn { ${UNDER_TEST.join(', ')} };`;
  const fns = new Function('S', '$', 'api', 'toast', 'fail', 'loadVentures', 'window', 'HEAD0', body)(
    S, $, api, (msg) => world.toasts.push(msg), (e) => world.failures.push(e.message),
    () => { world.reloaded += 1; return Promise.resolve(); }, window, { name: 'Venture Plan', idea: 'Turn an idea…' });
  return { fns, els, $ };
}

const newWorld = (confirmAnswer = true) => ({ calls: [], confirms: [], toasts: [], failures: [], reloaded: 0, confirmAnswer });

/** The live snapshot's shape: one channel, eight flat step rows, contribution in the figures. */
const FLAT = ['Shelf price', 'Payment processing', 'Returns', 'Fulfilment', 'Shipping', 'Acquisition', 'Packaging', 'Landed cost of goods']
  .map((step, i) => ({ channelId: 'dtc', step, amountMicros: i === 0 ? 79000000 : -2000000 - i, basis: 'per unit' }));
const FIGURES = {
  'channel.dtc.contributionPerUnitMicros': { value: 47380000, unit: 'micros' },
  'channel.dtc.contributionBps': { value: 5997, unit: 'bps' },
  'financials.netIncomeMicros': { value: -393686080000, unit: 'micros' },
};

test('flat stored waterfall rows become one card per channel with the engine contribution', () => {
  const { fns } = page({}, newWorld());
  const two = FLAT.concat([{ channelId: 'amazon', step: 'Shelf price', amountMicros: 79000000, basis: 'as priced' }]);
  const ws = fns.groupWaterfalls(two, FIGURES);
  assert.deepEqual(ws.map((w) => w.channelId), ['dtc', 'amazon']);
  assert.equal(ws[0].steps.length, 8);
  assert.equal(ws[0].steps[0].label, 'Shelf price');
  assert.equal(ws[0].contributionPerUnitMicros, 47380000);
  assert.equal(ws[0].contributionBps, 5997);
  assert.equal(ws[1].contributionPerUnitMicros, null, 'a channel without the figure states the gap');
  assert.equal(fns.waterfallMarks(ws[1]).length, 1, 'no closing bar is drawn from a missing contribution');
  assert.equal(fns.waterfallMarks(ws[0]).at(-1).to, 47380000);
  const engine = [{ channelId: 'dtc', steps: [{ label: 'x', amountMicros: 1 }], contributionPerUnitMicros: 5 }];
  assert.equal(fns.groupWaterfalls(engine, {})[0].contributionPerUnitMicros, 5, 'an engine-shaped waterfall passes through');
});

test('the sweep table says what its outcomes are measured against and reads values in their unit', () => {
  const S = { model: { figures: FIGURES }, assumptions: [{ key: 'landed.importDutyBps', unit: 'bps' }, { key: 'price.retail', unit: 'micros' }] };
  const { fns } = page(S, newWorld());
  assert.equal(fns.assumptionFormatter('landed.importDutyBps')(300), '3.00%');
  assert.equal(fns.assumptionFormatter('price.retail')(89000000), '$89.00');
  assert.equal(fns.assumptionFormatter('unknown')(7), '7');
  const note = fns.tornadoBaselineNote({ baseObjectiveMicros: -440000000000 });
  assert.match(note, /At every plan value it is \(\$440,000\.00\)\./);
  assert.match(note, /The saved model shows \(\$393,686\.08\): it was computed at its last Recompute/);
  const same = fns.tornadoBaselineNote({ baseObjectiveMicros: -393686080000 });
  assert.doesNotMatch(same, /saved model/);
  assert.match(html, /<th class="num">Outcome at plan value<\/th>/);
  assert.match(html, /esc\(usd\(b\.baseObjectiveMicros\)\)/);
});

test('Delete removes the open venture only after a confirm and returns to the empty state', async () => {
  const declined = newWorld(false);
  const a = page({ ventureId: 'v1', ventures: [{ id: 'v1', name: 'sweep3 venture' }] }, declined);
  a.fns.deleteVenture();
  assert.deepEqual(declined.calls, []);
  assert.match(declined.confirms[0], /Delete “sweep3 venture”/);

  const world = newWorld(true);
  const S = { ventureId: 'v1', ventures: [{ id: 'v1', name: 'sweep3 venture' }], model: {}, assumptions: [1] };
  const b = page(S, world);
  b.$('emptyCard').hidden = true;
  b.$('runBanner').innerHTML = '<div class="banner warn"><b>The run finished, but not every phase did.</b></div>';
  b.$('posture').innerHTML = 'ESTIMATE 23 of 37';
  b.$('publishBanner').innerHTML = '<div class="banner warn">Planning instrument, not a quote.</div>';
  b.fns.deleteVenture();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(world.calls, [['DELETE', '/ventures/v1']]);
  assert.equal(S.ventureId, null);
  assert.equal(b.$('emptyCard').hidden, false);
  assert.equal(b.$('headActions').hidden, true);
  // Sweep 14: the deleted venture's run banner, posture tiles and publish banner stayed under "VENTURES Nothing yet.".
  assert.equal(b.$('runBanner').innerHTML, '');
  assert.equal(b.$('publishBanner').innerHTML, '');
  assert.equal(b.$('posture').hidden, true);
  assert.equal(S.run, null);
  assert.equal(world.reloaded, 1);
  assert.match(html, /id="deleteVentureBtn"/);
  assert.match(html, /\$\('deleteVentureBtn'\)\.addEventListener\('click', deleteVenture\)/);
});
