/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family view asserted as behaviour: the head block runs against a stub kit and a stub fetch, so the tests prove what it reads on open (only /config and /watches: never a flight, hotel or car search, which call Duffel and record prices and searches on read, and never the concierge), that a trip date goes to AppView.day as the stored calendar day while checks and saves go to AppView.when, that a trip today is coming up and one gone by reads "Date passed", that tripped watches read as "Price dropped" or "Reached target", that demo, test-token, live and unknown prices are each named (with the connect action only in demo), and that empty, refused and failed reads read as what they are. The page's module script is run with stubs too: under an audience view it adds no handoff listener, appends no section to the body and fetches no connected-actions offer, and the full page's init runs only behind the gate.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'travel';
const PAGE = 'tools/travel-app.html';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/travel"];
const GATE_FILE = 'tools/travel-app.html';

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

/**
 * @description Run the head block against a stub kit and a stub fetch, so the family view is asserted as the model it
 * paints and the reads it makes rather than as substrings of the source. The stub formatters tag their input, so a
 * test can tell a calendar day (D) from a timestamp (W) from money ($).
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead.
 * @returns {{ family: Function, urls: string[], opened: string[] }} The family builder, every URL fetched, every A.open href.
 */
function loadFamily(answers) {
  let config = null;
  const urls = [], opened = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', day: (v) => 'D(' + v + ')', money: (v, c) => '$' + Number(v).toFixed(2) + ' ' + c, open: (href) => opened.push(href) };
  const fetchStub = (url) => {
    urls.push(url);
    const a = answers[url], status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body || {} : a;
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.family === 'function', 'the block boots the family audience');
  return { family: config.audiences.family, urls, opened };
}

/** @param {number} offset Days from today. @returns {string} That local calendar day as 'YYYY-MM-DD'. */
function localDay(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const WATCHES = [
  { watch_id: 'a', kind: 'flight', route_key: 'flight:VPS-ATL', query: { origin: 'VPS', destination: 'ATL', departDate: localDay(0), pax: 2, cabin: 'economy' }, target_price: '150.00', last_price: '149.00', currency: 'USD', status: 'tripped', last_checked_at: '2026-09-26T12:00:00.000Z', created_at: '2026-09-01T12:00:00.000Z' },
  { watch_id: 'b', kind: 'flight', route_key: 'flight:VPS-DEN', query: JSON.stringify({ origin: 'VPS', destination: 'DEN', departDate: localDay(30), returnDate: localDay(33) }), target_price: null, last_price: null, currency: 'USD', status: 'active', last_checked_at: null, created_at: '2026-09-02T12:00:00.000Z' },
  { watch_id: 'c', kind: 'car', route_key: 'car:MIAMI', query: { city: 'Miami', pickupDate: localDay(-1), dropoffDate: localDay(2) }, target_price: null, last_price: '80.00', currency: 'USD', status: 'active', last_checked_at: '2026-09-25T12:00:00.000Z', created_at: '2026-09-03T12:00:00.000Z' },
];
const OK = { '/api/travel/config': { connected: true, mode: 'live', live: true }, '/api/travel/watches': { items: WATCHES } };
const CTX = { refresh() {} };
const section = (model, id) => model.sections.find((s) => s && s.id === id);
const stat = (model, id) => model.stats.find((s) => s.id === id);

test('on open the view reads only the Duffel status and the fare watches, never a price search', async () => {
  const view = loadFamily(OK);
  await view.family(CTX);
  assert.deepEqual([...view.urls].sort(), ['/api/travel/config', '/api/travel/watches']);
  for (const url of view.urls) assert.doesNotMatch(url, /flights|hotels|cars|chat|conversation|profile/, 'no provider search, concierge or profile read: ' + url);
});

test('trip dates are calendar days through AppView.day; checks and saves are timestamps through AppView.when', async () => {
  const model = await loadFamily(OK).family(CTX);
  const upcoming = section(model, 'upcoming').items, rows = section(model, 'watches').items;
  assert.deepEqual(upcoming.map((i) => [i.when, i.title]), [['D(' + localDay(0) + ')', 'VPS → ATL'], ['D(' + localDay(30) + ')', 'VPS → DEN and back']], 'today is coming up, soonest first; the day gone by is not');
  assert.equal(model.lede, 'Next: VPS → ATL on D(' + localDay(0) + ') (W(' + localDay(0) + '))');
  assert.deepEqual(rows.map((r) => r.meta), ['checked W(2026-09-26T12:00:00.000Z)', 'saved W(2026-09-02T12:00:00.000Z)', 'checked W(2026-09-25T12:00:00.000Z)']);
  assert.equal(rows[0].text, 'D(' + localDay(0) + ') · Flight · economy · 2 travellers · last seen $149.00 USD · target $150.00 USD');
  assert.equal(rows[1].text, 'D(' + localDay(30) + ') · Flight · no price checked yet', 'a query stored as JSON text is still read');
  assert.deepEqual([rows[2].title, rows[2].badge, rows[2].tone], ['Car in Miami', 'Date passed', 'warn']);
});

test('tripped watches read as what tripped them, and the price source is named with the connect action only in demo', async () => {
  const live = await loadFamily(OK).family(CTX);
  assert.deepEqual([section(live, 'watches').items[0].badge, section(live, 'upcoming').items[0].text.endsWith(' · Reached target')], ['Reached target', true]);
  assert.equal(live.title, 'A watched fare dropped');
  assert.deepEqual([stat(live, 'prices').value, section(live, 'watches').note, live.actions.length], ['Live', null, 1]);
  const dropped = await loadFamily({ ...OK, '/api/travel/watches': { items: [{ ...WATCHES[0], target_price: null }] } }).family(CTX);
  assert.equal(section(dropped, 'watches').items[0].badge, 'Price dropped');
  const test_ = await loadFamily({ ...OK, '/api/travel/config': { connected: true, mode: 'live', live: false } }).family(CTX);
  assert.deepEqual([stat(test_, 'prices').value, section(test_, 'watches').note, test_.actions.length], ['Test', 'Prices come from a Duffel test token.', 1]);
  const demoView = loadFamily({ ...OK, '/api/travel/config': { connected: false, mode: 'demo', live: false } });
  const demo = await demoView.family(CTX);
  assert.deepEqual([stat(demo, 'prices').value, /demo data/.test(section(demo, 'watches').note), demo.lede.endsWith(' · demo prices')], ['Demo', true, true]);
  demo.actions.find((a) => a.label === 'Connect live prices').onClick();
  assert.deepEqual(demoView.opened, ['/utilities']);
  const unknown = await loadFamily({ ...OK, '/api/travel/config': { http: 500, body: {} } }).family(CTX);
  assert.deepEqual([stat(unknown, 'prices').value, stat(unknown, 'prices').hint, unknown.actions.length], ['—', 'Could not check', 1]);
});

test('an empty radar, a refusal and a failed read each read as what they are', async () => {
  const empty = await loadFamily({ ...OK, '/api/travel/watches': { items: [] } }).family(CTX);
  assert.deepEqual([empty.title, stat(empty, 'next').value, section(empty, 'upcoming').items.length], ['No trips on the radar', '—', 0]);
  assert.equal(section(empty, 'upcoming').empty, 'No fare watches yet. Search a trip in Travel and tap Watch.');
  const signedOut = await loadFamily({ ...OK, '/api/travel/watches': { http: 401, body: { error: 'Not authenticated' } } }).family(CTX);
  assert.equal(signedOut.title, 'Sign in to see your trips');
  const denied = await loadFamily({ ...OK, '/api/travel/config': { http: 403, body: {} } }).family(CTX);
  assert.equal(denied.title, 'This account cannot open Travel');
  await assert.rejects(loadFamily({ ...OK, '/api/travel/watches': { http: 500, body: { error: 'relation "travel_watches" does not exist' } } }).family(CTX),
    /^Error: Travel could not read the fare watches \(HTTP 500\)\.$/);
});

/**
 * @description Run the page's module script (imports stripped) against stub modules and a stub DOM.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {{ handoff: number, actions: number, appended: number }} How often each start step ran.
 */
function runModule(activeView) {
  const src = html.slice(html.indexOf('<script type="module">') + 22, html.indexOf('</script>', html.indexOf('<script type="module">')));
  const calls = { handoff: 0, actions: 0, appended: 0 };
  const node = () => ({ value: '', tagName: 'INPUT', style: {}, focus() {}, setAttribute() {} });
  const documentStub = { getElementById: node, createElement: node, body: { append: () => { calls.appended++; } } };
  const body = src.replace(/^import .*$/gm, '');
  new Function('window', 'AppView', 'document', 'receiveHandoff', 'mountConnectedActions', body)(
    { AppView: { active: () => activeView } }, { active: () => activeView }, documentStub,
    () => { calls.handoff++; }, () => { calls.actions++; return Promise.resolve(); });
  return calls;
}

test('under an audience view the module script adds no listener, appends no section and fetches no offer', () => {
  assert.deepEqual(runModule('family'), { handoff: 0, actions: 0, appended: 0 });
  assert.deepEqual(runModule(null), { handoff: 1, actions: 1, appended: 1 }, 'the full page still mounts all three');
  assert.match(html, /\nif \(!window\.AppView \|\| !AppView\.active\(\)\) \(async function init\(\)\{\n/, 'the full page init is gated');
  assert.doesNotMatch(html, /^\(async function init\(\)\{$/m, 'no ungated init is left');
});
