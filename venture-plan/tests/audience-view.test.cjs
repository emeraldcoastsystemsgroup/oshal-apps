/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Venture Plan's extra start paths are gated explicitly (loadVentures(), which auto-selects the first venture and fires its six reads, and both module scripts, which received handoffs and appended a section to <body> unconditionally), and the company view is asserted as behaviour against a stub kit and stub reads: only the list, the Home summary and at most eight venture headers are read (never assumptions, model, documents, inversion or sensitivity), the portfolio, attention, runs and evidence say what the headers say, a deleted venture drops out while an unreadable one is marked, and signed-out, failed-list, failed-summary and empty cases are each named.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The evidence section read coverage.byConfidence in the engine's words (quoted/observed/benchmarked/estimated/guessed) while GET /ventures/:id sends the store's coverageOf (byConfidence low/medium/high, bySourceKind over SOURCE_KINDS), so every bar painted "0 of N" on real data and this test passed only against an invented fixture. The view now counts coverage.bySourceKind; the fixture's coverage comes from the package's real coverageOf; and a new case crosses that boundary: the keys the view reads must be exactly routes/venture-types.js SOURCE_KINDS, and a header built by the real coverageOf over every source kind and confidence must paint counts that add up to its total.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'venture-plan';
const PAGE = 'tools/venture.html';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/venture","/api/venture-plan"];
const GATE_FILE = 'tools/venture.html';

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
const start = html.indexOf('<script src="/shared/ui/js/app-view.js"></script>');
const block = (() => { const s = html.indexOf('<script>', start); const e = html.indexOf('</script>', s); return html.slice(s + 8, e); })();

test('the shared kit is loaded right after the theme bootstrap, stylesheet first', () => {
  const bootstrap = html.indexOf('<script src="/shared/ui/js/surface-theme.js"></script>');
  assert.ok(bootstrap >= 0, 'theme bootstrap present');
  const css = html.indexOf('<link rel="stylesheet" href="/shared/ui/css/app-view.css" />');
  assert.ok(css > bootstrap && start > css, 'app-view.css then app-view.js follow the bootstrap');
  assert.equal(html.split('/shared/ui/js/app-view.js').length - 1, 1, 'the kit is included once');
});

test('the page boots the kit with its own application name and exactly the audiences it provides', () => {
  const boot = block.match(/A\.boot\(\{([\s\S]*?)\}\);/);
  assert.ok(boot, 'A.boot({...}) present');
  assert.match(boot[1], new RegExp("app: '" + APP + "'"));
  const declared = boot[1].match(/audiences: \{([^}]*)\}/);
  assert.ok(declared, 'audiences map present');
  const names = declared[1].split(',').map(s => s.split(':')[0].trim()).filter(Boolean).sort();
  assert.deepEqual(names, [...AUDIENCES].sort());
  assert.match(boot[1], /escapeLabel: '[^']+'/, 'the escape names the full application');
});

test('the full page start is gated on the kit decision and survives a missing kit', () => {
  const gated = GATE_FILE === PAGE ? html : fs.readFileSync(path.join(ROOT, GATE_FILE), 'utf8');
  assert.match(gated, /if \(!window\.AppView \|\| !AppView\.active\(\)\)/);
});

test('the head block parses and reads only this package\x27s own routes', () => {
  assert.doesNotThrow(() => new Function(block));
  const reads = [...block.matchAll(/fetch\(\s*'([^']+)'/g)].map(m => m[1]).concat([...block.matchAll(/fetch\(\s*(BASE|API)\s*\+/g)].map(() => ALLOWED_PREFIXES[0]));
  assert.ok(reads.length >= 1, 'the block reads through fetch');
  for (const r of reads) assert.ok(ALLOWED_PREFIXES.some(p => r === p || r.startsWith(p + '/')), 'read stays on an allowed prefix: ' + r);
  assert.doesNotMatch(block, /innerHTML\s*=/, 'the block builds no HTML from data');
});

const GATE = 'if (!window.AppView || !AppView.active())';

test('loadVentures and both module scripts run only without an audience view', () => {
  assert.ok(html.includes('  ' + GATE + ' loadVentures();\n})();\n</script>'), 'the console start, the last statement of its IIFE, is gated');
  assert.doesNotMatch(html, /\n\s*loadVentures\(\);\n\}\)\(\);/, 'no ungated start remains at the end of the IIFE');
  const modules = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.equal(modules.length, 2, 'the handoff receiver and the connected-actions module');
  for (const code of modules) {
    // Static imports stay (the modules only define functions; the handoff is posted on load, which a dynamic
    // import would miss); every statement after them runs inside the gate.
    const body = code.replace(/^\s*import\s[^;]+;\s*/gm, '').trim();
    assert.ok(body.startsWith(GATE + ' {') && body.endsWith('}'), 'the module body runs only inside the gate');
    for (const call of ['receiveHandoff(', 'mountConnectedActions(', 'document.body.append']) {
      if (code.includes(call)) assert.ok(code.indexOf(call) > code.indexOf(GATE), call + ' runs only inside the gate');
    }
  }
});

/**
 * @description Run the head block against a stub kit and stub reads and return the company model with the requests
 * it made, so the view is asserted as what it paints and what it asks for, not as a substring of the source.
 * @param {Record<string, {status?: number, body?: object}|object>} answers Route path -> JSON body, or {status, body}.
 * @returns {Promise<{model: object, requests: Array<{url: string, method: string}>}>} The model and the requests.
 */
async function companyModel(answers) {
  let config = null;
  const requests = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'when ' + v, day: (v) => (v ? 'day ' + v : '—'), pct: (v) => Math.round(Number(v)) + '%' };
  const reply = (url) => { const a = answers[url]; if (a === undefined) return { status: 404, body: {} }; return a && a.status ? a : { status: 200, body: a }; };
  const fetchStub = (url, opts) => {
    requests.push({ url, method: (opts && opts.method) || 'GET' });
    const a = reply(url);
    return Promise.resolve({ ok: a.status < 400, status: a.status, json: () => Promise.resolve(a.body || {}) });
  };
  new Function('window', 'fetch', block)({ AppView: kit, location: { pathname: '/api/venture/', assign() {} } }, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { model: await config.audiences.company({ refresh() {} }), requests };
}

const fixture = () => require('./audience-view.fixture.cjs')({ iso: (h) => new Date(Date.now() + h * 36e5).toISOString() }).reads;
const section = (model, id) => model.sections.find((s) => s.id === id);
const stat = (model, id) => model.stats.find((s) => s.id === id);
// The package's own coverage roll-up and vocabulary: the shape GET /ventures/:id sends in coverage.
const { coverageOf } = require('./audience-view.fixture.cjs');
const { SOURCE_KINDS, CONFIDENCES } = require(path.join(ROOT, 'routes', 'venture-types.js'));

test('the evidence section reads the store\x27s own source kinds from a header built by the real coverageOf', async () => {
  const shown = new Function('return ' + block.match(/var SOURCES = (\[[^\n]*\]);/)[1])().map((k) => k[0]);
  assert.deepEqual([...shown].sort(), [...SOURCE_KINDS].sort(), 'the view reads exactly the source kinds coverageOf counts');
  const live = SOURCE_KINDS.flatMap((sourceKind) => CONFIDENCES.map((confidence) => ({ sourceKind, confidence })));
  const v = { ...fixture()['/api/venture/ventures'].ventures[0], id: 'v-all' };
  const { model } = await companyModel({ '/api/venture/ventures': { ventures: [v] }, '/api/venture/ventures/v-all': { venture: v, coverage: coverageOf(live), latestModel: null, latestRun: null } });
  const items = section(model, 'evidence').items;
  assert.equal(items.length, SOURCE_KINDS.length);
  for (const i of items) assert.equal(i.text, CONFIDENCES.length + ' of ' + live.length, i.label + ' shows its real count, not zero');
  assert.equal(items.reduce((n, i) => n + Number(i.text.split(' ')[0]), 0), live.length, 'the bars add up to the assumptions behind them');
});

test('the company view reads the list, the summary and each header, and paints the portfolio', async () => {
  const reads = fixture();
  const { model, requests } = await companyModel(reads);
  assert.deepEqual(requests.map((r) => r.method + ' ' + r.url).sort(), ['GET /api/venture-plan/home-summary', 'GET /api/venture/ventures', 'GET /api/venture/ventures/v-1', 'GET /api/venture/ventures/v-2', 'GET /api/venture/ventures/v-3']);
  assert.equal(model.lede, '3 saved ventures · 5 model estimates to replace with quotes');
  assert.deepEqual(model.stats.map((s) => [s.id, s.value]), [['saved-ventures', 3], ['model-estimates', 5], ['publishable', 1], ['runs-running', 1], ['open-questions', 2]]);
  const rows = section(model, 'portfolio').rows.map((r) => r.cells);
  assert.deepEqual(rows[0], ['Synthetic lamp', 'Modelled', 'day 2027-03-01', '42%', { text: 'Estimate', tone: 'warn' }, { text: 'Will not publish', tone: 'bad' }, 'when ' + reads['/api/venture/ventures/v-1'].latestModel.computedAt, 'when ' + reads['/api/venture/ventures'].ventures[0].updatedAt]);
  assert.deepEqual(rows[1].slice(2, 6), ['—', '0%', { text: 'Quoted', tone: 'ok' }, { text: 'Publishable', tone: 'ok' }]);
  assert.deepEqual(rows[2].slice(3, 7), ['No assumptions', 'No model yet', '—', '—']);
  const attention = section(model, 'attention').items;
  assert.deepEqual(attention.map((i) => i.title), ['Synthetic lamp', 'Synthetic bike rack'], 'the publishable venture needs nothing');
  assert.equal(attention[1].text, 'Bill of materials run failed at assume · No computed model yet (recompute is free) · 2 open questions from scoping');
  assert.equal(attention[1].tone, 'bad');
  assert.deepEqual(section(model, 'runs').items.map((i) => i.title), ['Market run in progress', 'Full analyst run finished', 'Bill of materials run failed'], 'newest run first');
  assert.match(section(model, 'runs').items[0].text, /1 of 2 bot phases finished · phase assume · scheduled$/);
  const evidence = Object.fromEntries(section(model, 'evidence').items.map((i) => [i.label, i.text]));
  assert.deepEqual(evidence, { 'Vendor quote': '8 of 22', 'Published source': '3 of 22', 'Entered by hand': '3 of 22', 'Derived from other figures': '3 of 22', 'Model estimate': '5 of 22' });
  assert.ok([...attention, ...section(model, 'portfolio').rows].every((i) => typeof i.onClick === 'function' && !i.href), 'every row opens the full console; none writes');
});

test('a long list joins only the eight most recent headers and says so', async () => {
  const base = fixture()['/api/venture/ventures'].ventures[0];
  const ventures = Array.from({ length: 11 }, (_, i) => ({ ...base, id: 'v-' + i, name: 'Synthetic venture ' + i }));
  const answers = { '/api/venture/ventures': { ventures } };
  ventures.forEach((v) => { answers['/api/venture/ventures/' + v.id] = { venture: v, coverage: coverageOf([]), latestModel: null, latestRun: null }; });
  const { model, requests } = await companyModel(answers);
  assert.equal(requests.filter((r) => /\/ventures\/v-/.test(r.url)).length, 8, 'eight headers, not eleven');
  assert.equal(section(model, 'portfolio').rows.length, 8);
  assert.equal(section(model, 'portfolio').note, 'The 8 most recently updated of 11 ventures; the rest are in Venture Plan.');
  assert.equal(stat(model, 'publishable').hint, 'of 8 shown');
  assert.equal(stat(model, 'saved-ventures').value, 11, 'a failed summary falls back to the list count');
  assert.equal(stat(model, 'model-estimates').value, null, 'the estimate count is unknown, not zero');
  assert.equal(stat(model, 'model-estimates').hint, 'Summary unavailable');
  assert.equal(model.lede, '11 saved ventures');
});

test('a deleted venture drops out; an unreadable one stays, marked', async () => {
  const answers = { ...fixture(), '/api/venture/ventures/v-2': { status: 404, body: { error: 'not found' } }, '/api/venture/ventures/v-3': { status: 500, body: { error: 'Synthetic failure' } } };
  const { model } = await companyModel(answers);
  const rows = section(model, 'portfolio').rows.map((r) => r.cells);
  assert.deepEqual(rows.map((c) => c[0]), ['Synthetic lamp', 'Synthetic bike rack']);
  assert.deepEqual(rows[1][3], { text: 'Could not load', tone: 'bad' });
  const rack = section(model, 'attention').items.find((i) => i.title === 'Synthetic bike rack');
  assert.equal(rack.text, 'Its details could not be read right now · 2 open questions from scoping');
});

test('signed out, a failed list and an empty list are each named', async () => {
  await assert.rejects(companyModel({ '/api/venture/ventures': { status: 401, body: { error: 'authentication required' } }, '/api/venture-plan/home-summary': { status: 401, body: {} } }), /Sign in to see your ventures\./);
  await assert.rejects(companyModel({ '/api/venture/ventures': { status: 500, body: { error: 'internal error' } } }), /could not read your ventures right now \(HTTP 500\)/);
  const { model, requests } = await companyModel({ '/api/venture/ventures': { ventures: [] }, '/api/venture-plan/home-summary': { metrics: [{ id: 'saved-ventures', value: '0' }, { id: 'estimated-assumptions', value: '0' }] } });
  assert.equal(requests.length, 2, 'no header is read for an empty list');
  assert.equal(model.title, 'No saved ventures yet');
  assert.equal(model.actions[0].label, 'Describe an idea');
  for (const id of ['portfolio', 'attention', 'runs', 'evidence']) assert.equal((section(model, id).rows || section(model, id).items).length, 0, id + ' is empty');
});
