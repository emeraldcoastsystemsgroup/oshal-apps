/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Behaviour of the Get a Ride family view over a stub kit and a stub fetch: on open it reads exactly /history and /home-summary and never the map config, address lookup, fare estimate, Uber link, concierge, conversation or profile; the rides list carries destination, pickup, ride type, the saved estimate and when, and opens nothing (a saved Uber link would start a booking); places are ranked by how often they were asked for; the usual ride, the five-day count, the capped history, the empty, unknown-summary, partial, 401, 403 and failed-read states are each named; the one action opens the cockpit entry. The page's three start paths (the map page's boot, the assistant rail module, the handoff and connected-actions module) are each run against a stub DOM to prove none starts under a view and each still starts without one and without the kit.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'rides';
const PAGE = 'tools/rides-app.html';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/rides"];
const GATE_FILE = 'tools/rides-app.html';

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
 * paints and the reads it makes rather than as substrings of the source.
 * @param {Record<string, object>} answers URL -> JSON body; `{ status, body }` answers with that HTTP status instead.
 * @returns {{ family: Function, urls: string[], opened: string[] }} The family builder, every URL fetched, every A.open href.
 */
function loadFamily(answers) {
  let config = null;
  const urls = [], opened = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', day: (v) => 'D(' + v + ')', money: (v) => '$' + Number(v).toFixed(2), open: (href) => opened.push(href) };
  const fetchStub = (url) => {
    urls.push(url);
    const a = answers[url], status = a === undefined ? 404 : (a.status || 200), body = a === undefined ? {} : a.status ? a.body || {} : a;
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.family === 'function', 'the block boots the family audience');
  return { family: config.audiences.family, urls, opened };
}

// GET /history rows as the route returns them (newest first; NUMERIC fares arrive as strings): the airport is asked
// for twice (once typed in lower case with a trailing space), the grocery twice, the stadium once with a ride type
// this page has no label for; one ride saved no fare and one saved no ride type or pickup.
const TRIPS = [
  { pickup: 'my location', dropoff: 'Synthetic Airport', ride_type: 'comfort', est_fare_low: '23.00', est_fare_high: '30.00', deep_link: 'https://m.uber.com/ul/?action=setPickup&synthetic=1', created_at: '2026-09-27T18:00:00.000Z' },
  { pickup: '12 Synthetic Oak St', dropoff: 'Synthetic Grocery', ride_type: 'uberx', est_fare_low: '9.00', est_fare_high: '12.00', deep_link: 'https://m.uber.com/ul/?synthetic=2', created_at: '2026-09-25T15:00:00.000Z' },
  { pickup: 'my location', dropoff: 'synthetic airport ', ride_type: 'comfort', est_fare_low: null, est_fare_high: null, deep_link: 'https://m.uber.com/ul/?synthetic=3', created_at: '2026-09-20T09:00:00.000Z' },
  { pickup: '', dropoff: 'Synthetic Grocery', ride_type: null, est_fare_low: '9.00', est_fare_high: '12.00', deep_link: 'https://m.uber.com/ul/?synthetic=4', created_at: '2026-09-18T09:00:00.000Z' },
  { pickup: 'my location', dropoff: 'Synthetic Stadium', ride_type: 'uberpool', est_fare_low: '15.00', est_fare_high: '19.00', deep_link: 'https://m.uber.com/ul/?synthetic=5', created_at: '2026-09-10T09:00:00.000Z' },
];
const SUMMARY = { metrics: [{ id: 'ride-handoffs-24h', label: 'Ride links / 24h', value: '1', tone: 'neutral' }, { id: 'ride-handoffs-5d', label: 'Ride links / 5 days', value: '3', tone: 'neutral' }], tiles: [], items: [], asOf: '2026-09-28T12:00:00.000Z', partial: false };
const OK = { '/api/rides/history': { trips: TRIPS }, '/api/rides/home-summary': SUMMARY };
const section = (model, id) => model.sections.find((s) => s && s.id === id);
const stat = (model, id) => model.stats.find((s) => s.id === id);

test('on open the family view reads only the saved rides and the home summary', async () => {
  const view = loadFamily(OK);
  await view.family({ refresh() {} });
  assert.deepEqual([...view.urls].sort(), ['/api/rides/history', '/api/rides/home-summary']);
  for (const url of view.urls) assert.doesNotMatch(url, /config|geocode|reverse|estimate|request|chat|conversation|profile|vendor/, 'no map, lookup, estimate, hand-off, concierge or profile read: ' + url);
});

test('the rides list names where, from where, the ride and its saved estimate, and opens nothing', async () => {
  const view = loadFamily(OK);
  const model = await view.family({ refresh() {} });
  assert.equal(model.kicker, 'Getting around');
  assert.equal(model.title, '5 rides planned');
  assert.equal(model.lede, 'Newest: to Synthetic Airport, planned W(2026-09-27T18:00:00.000Z).');
  assert.deepEqual(model.stats.map((s) => [s.id, s.value, s.hint]), [['planned', 5, null], ['recent', '3', 'Handed to Uber'], ['last', 'W(2026-09-27T18:00:00.000Z)', undefined], ['usual', 'Comfort', undefined]]);
  const rides = section(model, 'rides');
  assert.deepEqual(rides.items.map((l) => [l.title, l.text, l.meta]), [
    ['To Synthetic Airport', 'From my location · Comfort · about $23.00–$30.00', 'planned W(2026-09-27T18:00:00.000Z)'],
    ['To Synthetic Grocery', 'From 12 Synthetic Oak St · UberX · about $9.00–$12.00', 'planned W(2026-09-25T15:00:00.000Z)'],
    ['To synthetic airport', 'From my location · Comfort · no fare estimate saved', 'planned W(2026-09-20T09:00:00.000Z)'],
    ['To Synthetic Grocery', 'From my location · about $9.00–$12.00', 'planned W(2026-09-18T09:00:00.000Z)'],
    ['To Synthetic Stadium', 'From my location · uberpool · about $15.00–$19.00', 'planned W(2026-09-10T09:00:00.000Z)'],
  ]);
  assert.match(rides.note, /^Each ride was handed to Uber to confirm and pay; this list cannot tell whether the ride happened\.$/);
  const places = section(model, 'places').items;
  assert.deepEqual(places.map((p) => [p.title, p.text, p.meta]), [
    ['Synthetic Airport', '2 rides', 'last W(2026-09-27T18:00:00.000Z)'],
    ['Synthetic Grocery', '2 rides', 'last W(2026-09-25T15:00:00.000Z)'],
    ['Synthetic Stadium', '1 ride', 'last W(2026-09-10T09:00:00.000Z)'],
  ], 'places rank by how often they were asked for, the most recent first on a tie, one place however it was typed');
  for (const item of rides.items.concat(places)) assert.ok(!item.href && !item.onClick && !item.target, 'a saved ride or place opens nothing: its Uber link would start a booking');
  assert.equal(model.actions.length, 1);
  model.actions[0].onClick();
  assert.deepEqual(view.opened, ['/cockpit/?app=rides'], 'the one action escapes to Get a Ride in the cockpit');
});

test('with no saved ride the state says so and nothing is ranked; a full history is marked as the newest twenty', async () => {
  const empty = await loadFamily({ ...OK, '/api/rides/history': { trips: [] } }).family({ refresh() {} });
  assert.equal(empty.title, 'No rides planned yet');
  assert.equal(empty.lede, 'Open Get a Ride to plan one. It shows an estimate and hands the ride to Uber, where you confirm and pay.');
  assert.deepEqual([section(empty, 'rides').items, section(empty, 'rides').empty, section(empty, 'rides').note], [[], 'No rides planned yet.', null]);
  assert.equal(section(empty, 'places'), undefined, 'no places without rides');
  assert.deepEqual(empty.stats.map((s) => s.value), [0, '3', '—', '—']);
  const twenty = Array.from({ length: 20 }, (_, i) => ({ ...TRIPS[1], created_at: new Date(Date.UTC(2026, 8, 27, 12) - i * 36e5).toISOString() }));
  const full = await loadFamily({ ...OK, '/api/rides/history': { trips: twenty } }).family({ refresh() {} });
  assert.equal(full.title, '20+ rides planned');
  assert.deepEqual([stat(full, 'planned').value, stat(full, 'planned').hint], ['20+', 'Showing the newest 20']);
  assert.equal(section(full, 'rides').items.length, 10);
});

test('a failed home summary reads as unknown and keeps the rides; an unavailable count and a partial summary are named', async () => {
  const unknown = await loadFamily({ ...OK, '/api/rides/home-summary': { status: 503, body: { error: 'boom' } } }).family({ refresh() {} });
  assert.deepEqual([stat(unknown, 'recent').value, stat(unknown, 'recent').hint], ['—', 'Could not check']);
  assert.equal(section(unknown, 'rides').items.length, 5, 'the rides still show');
  const partial = await loadFamily({ ...OK, '/api/rides/home-summary': { ...SUMMARY, partial: true, metrics: [{ id: 'ride-handoffs-5d', value: 'Unavailable' }] } }).family({ refresh() {} });
  assert.deepEqual([stat(partial, 'recent').value, stat(partial, 'recent').hint], ['—', 'Could not check']);
  assert.match(section(partial, 'rides').note, /Some saved ride data could not be checked\.$/);
});

test('a refusal is named, and a failed rides read fails with its status, not a database message', async () => {
  const signedOut = await loadFamily({ ...OK, '/api/rides/history': { status: 401, body: { error: 'Not authenticated' } } }).family({ refresh() {} });
  assert.equal(signedOut.title, 'Sign in to see your rides');
  assert.ok(!signedOut.stats && !signedOut.sections, 'a refusal paints no counts');
  const denied = await loadFamily({ ...OK, '/api/rides/home-summary': { status: 403, body: {} } }).family({ refresh() {} });
  assert.equal(denied.title, 'This account cannot open Get a Ride');
  await assert.rejects(loadFamily({ ...OK, '/api/rides/history': { status: 500, body: { error: 'relation "rides_requests" does not exist' } } }).family({ refresh() {} }),
    /^Error: Get a Ride could not read the saved rides \(HTTP 500\)\.$/);
});

/**
 * @description A permissive stand-in for a DOM node: known fields hold values, any other property is a no-op method
 * returning another stand-in, so a full-page start can run far enough to show which reads it makes.
 * @returns {object} The stand-in node.
 */
function stubNode() {
  const base = { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } };
  return new Proxy(base, { get: (t, p) => (p in t ? t[p] : p === 'then' || typeof p === 'symbol' ? undefined : () => stubNode()), set: (t, p, v) => { t[p] = v; return true; } });
}

/**
 * @description A stand-in document that records every selector queried and every element created.
 * @param {string[]} touched Receives each selector and created tag.
 * @returns {object} The stand-in document.
 */
function stubDocument(touched) {
  const doc = stubNode();
  doc.querySelector = (selector) => { touched.push(selector); return stubNode(); };
  doc.getElementById = (id) => { touched.push('#' + id); return stubNode(); };
  doc.querySelectorAll = () => [];
  doc.createElement = (tag) => { touched.push('<' + tag + '>'); return stubNode(); };
  return doc;
}

/** @returns {string[]} The bodies of the page's inline module scripts, in page order. */
const modules = () => [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * @description Run the map page's own script (the classic script that defines API and boot) against a stub DOM, a stub
 * fetch and a kit whose active() answers as given.
 * @param {string|null|undefined} activeView What AppView.active() answers; undefined leaves window.AppView absent.
 * @returns {Promise<{ fetched: string[], touched: string[] }>} Every URL fetched and every DOM query made.
 */
async function runMapPage(activeView) {
  const s = html.indexOf("<script>\nconst API = '/api/rides';");
  assert.ok(s > 0, 'the map page script is where the guard expects it');
  const src = html.slice(s + 8, html.indexOf('</script>', s));
  const fetched = [], touched = [];
  const fetchStub = (url) => { fetched.push(url); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ trips: [] }) }); };
  const kit = activeView === undefined ? undefined : { active: () => activeView };
  const win = stubNode(); win.AppView = kit; win.L = undefined; win.google = undefined;
  new Function('window', 'document', 'localStorage', 'fetch', 'AppView', src)(win, stubDocument(touched), { getItem: () => null, setItem() {} }, fetchStub, kit);
  await tick();
  return { fetched, touched };
}

test('under an audience view the map page does not start; without a view, and without the kit, it reads its history and map config', async () => {
  assert.deepEqual(await runMapPage('family'), { fetched: [], touched: [] }, 'no read and no DOM touch behind the view');
  for (const activeView of [null, undefined]) {
    const full = await runMapPage(activeView);
    assert.deepEqual(full.fetched, ['/api/rides/history', '/api/rides/config'], 'the full page starts as before (kit ' + (activeView === undefined ? 'absent' : 'rendering nothing') + ')');
    assert.ok(full.touched.includes('#pickup'), 'the full page wires its controls');
  }
  assert.doesNotMatch(html, /^\s*boot\(\);/m, 'no ungated start is left');
});

/**
 * @description Run the assistant-rail module with its dynamic imports routed to stubs.
 * @param {string|null|undefined} activeView What AppView.active() answers; undefined leaves window.AppView absent.
 * @returns {Promise<{ imported: string[], attached: number, events: string[], bridge: boolean }>} What the module started.
 */
async function runRail(activeView) {
  const src = modules().find((m) => m.includes('surface-bridge-client.js'));
  assert.ok(src && /await import\(/.test(src), 'the rail module imports the shared bridge');
  const imported = [], events = [];
  let attached = 0;
  const importStub = (spec) => { imported.push(spec); return Promise.resolve({ createSurfaceBridgeClient: () => ({ attach: () => { attached += 1; } }), createSurfaceProducer: () => ({}) }); };
  const kit = activeView === undefined ? undefined : { active: () => activeView };
  const win = { AppView: kit, dispatchEvent: (e) => events.push(e.type) };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('window', 'AppView', '__import', src.replace(/await import\(/g, 'await __import('))(win, kit, importStub);
  return { imported, attached, events, bridge: Boolean(win.__bridge && win.__bridgeProducer) };
}

test('under an audience view the assistant rail is not attached; without a view, and without the kit, it is', async () => {
  assert.deepEqual(await runRail('family'), { imported: [], attached: 0, events: [], bridge: false });
  for (const activeView of [null, undefined]) {
    assert.deepEqual(await runRail(activeView), { imported: ['/shared/ui/js/surface-bridge-client.js', '/shared/ui/js/surface-bridge-producer.js'], attached: 1, events: ['bridge-ready'], bridge: true });
  }
});

/**
 * @description Run the handoff and connected-actions module with its two imports replaced by recording stubs.
 * @param {string|null|undefined} activeView What AppView.active() answers; undefined leaves window.AppView absent.
 * @returns {{ handoffs: string[], offers: string[], touched: string[] }} The handoff actions listened for, the apps whose offers were fetched, the DOM queried.
 */
function runHandoff(activeView) {
  const src = modules().find((m) => m.includes('receiveHandoff'));
  const imports = src.match(/^import .*$/gm) || [];
  assert.deepEqual(imports, ["import { receiveHandoff } from '/cockpit/js/app-handoff.js';", "import { mountConnectedActions } from '/cockpit/js/app-workflows.js';"]);
  const handoffs = [], offers = [], touched = [];
  const kit = activeView === undefined ? undefined : { active: () => activeView };
  new Function('receiveHandoff', 'mountConnectedActions', 'document', 'window', 'AppView', src.replace(/^import .*$/gm, ''))(
    (spec) => handoffs.push(spec.action), (opts) => { offers.push(opts.app); return Promise.resolve(); }, stubDocument(touched), { AppView: kit }, kit);
  return { handoffs, offers, touched };
}

test('under an audience view no handoff listener is added and no connected-actions offer is fetched; without a view, and without the kit, both are', () => {
  assert.deepEqual(runHandoff('family'), { handoffs: [], offers: [], touched: [] });
  for (const activeView of [null, undefined]) {
    const full = runHandoff(activeView);
    assert.deepEqual([full.handoffs, full.offers], [['plan-ride'], ['rides']]);
    assert.ok(full.touched.includes('.search-stack'), 'the offer bar mounts in the page');
  }
});
