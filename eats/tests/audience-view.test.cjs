/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family view asserted as behaviour over a stub kit and a stub fetch: on open it reads exactly GET /home-summary, /profile, /orders/history and /config and never /cart (whose first read creates the diner's cart), /search or /menu (the catalog provider), the concierge or a write; the stats are the pending count and the five-day checkout-link count from the home summary, the saved checkouts from the history and whether Uber Eats is linked; the dishes are the home summary's own cart items read from its detail string; the tastes are the profile in the full page's words for what is not set and an empty section when nothing is saved; the checkouts carry the store, the total and when; the title ladder names the state (things in the order, nothing in the order with the last checkout link, nothing saved yet, some saved data not checked); a partial summary, a failed side read, an unlinked Uber Eats, a 401, a 403 and a failed summary each read as what they are; nothing in the view is clickable and the one action opens the cockpit entry. The page's own scripts are run against a stub DOM to prove that under a view the full start makes no read at all (the cart-creating GET /cart and the provider GET /search included), the assistant rail is not attached and no handoff listener or connected-actions mount runs, while without a view, and with no kit at all, every start step still runs.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Regression for the empty-state title that guessed: with nothing in the order and no checkout link to name, the title said "Nothing saved yet" even when the history read had failed (the checkouts section on the same screen said they could not be checked), when the profile read had failed, or when the profile held saved tastes such as a delivery address (shown in the tiles right below). Now "Nothing saved yet" is asserted only when the history answered empty and the profile answered with no tastes; a failed history read, a failed profile read, both, and a saved address each give "Nothing in the order right now" with a lede naming what is known.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'eats';
const PAGE = 'tools/eats-app.html';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/eats"];
const GATE_FILE = 'tools/eats-app.html';

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
 * paints and the reads it makes rather than as substrings of the source. The stub formatters tag their input:
 * W = AppView.when, $ = AppView.money.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead.
 * @returns {{ family: Function, urls: string[], opened: string[] }} The family builder, every request made, every A.open href.
 */
function loadFamily(answers) {
  let config = null;
  const urls = [], opened = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', money: (v) => '$' + Number(v).toFixed(2), open: (href) => opened.push(href) };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url], status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body : a;
    return Promise.resolve({ ok: status < 400, status, json: () => (body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.family === 'function', 'the block boots the family audience');
  return { family: config.audiences.family, urls, opened };
}

const S = '/api/eats/home-summary', P = '/api/eats/profile', O = '/api/eats/orders/history', C = '/api/eats/config';
const NOW = '2026-09-28T12:00:00.000Z';
/** @returns {object[]} The route's three metrics, each value a digit string or 'Unavailable'. */
const metrics = (pending, day, five) => [
  { id: 'pending-meal-items', label: 'Meal items to review', value: pending, tone: 'neutral' },
  { id: 'meal-handoffs-24h', label: 'Checkout links / 24h', value: day, tone: 'neutral' },
  { id: 'meal-handoffs-5d', label: 'Checkout links / 5 days', value: five, tone: 'neutral' },
];
/** @returns {object} A pending cart item exactly as routes/home-summary.js writes it (detail carries the stamp; the store sits only in the offers). */
const cartItem = (title, stamp) => ({ text: title, detail: 'In your meal cart · ' + stamp, tone: 'neutral', fix: 'eats-concierge',
  actions: ['plan-shopping', 'plan-movie', 'plan-music'].map((integration) => ({ integration, context: { title: 'Prepare for my meal choice', notes: 'Meal choice to discuss: ' + title + '; quantity 1 from Synthetic Noodle House. This is a cart item, not a placed order.' } })) });
const STANDING = { text: 'Pending items in your active meal carts. Checkout links do not confirm an order or delivery.', tone: 'neutral', fix: 'eats-concierge' };
const NONE = { text: 'No saved preparation items to review yet.', tone: 'neutral', fix: 'eats-concierge' };
const NOT_CHECKED = { text: 'Some saved data cannot be checked.', tone: 'warn', fix: 'eats-concierge' };
/** @returns {object} A home summary as the route answers it: tiles mirror the metrics, cart items first, the notes last. */
const summary = (m, items, partial) => ({ metrics: m, tiles: m.slice(0, 4), items, asOf: NOW, partial: !!partial });
const DISHES = [cartItem('Synthetic Pad Thai', '2026-09-28T10:00:00.000Z'), cartItem('Synthetic Spring Rolls', '2026-09-27T19:00:00.000Z')];
const PROFILE = { user_sub: 'diner', display_name: null, dietary: ['vegetarian'], favorite_cuisines: ['Thai', 'Mexican'], default_address: '1 Synthetic Way', budget_per_order: '40.00', notes: null, onboarded: true };
const ORDERS = [
  { store_name: 'Synthetic Noodle House', total: '24.50', handoff_url: 'https://www.ubereats.com/store/synthetic', created_at: '2026-09-26T18:00:00.000Z' },
  { store_name: null, total: null, handoff_url: null, created_at: '2026-09-20T18:00:00.000Z' },
];
const OK = { [S]: summary(metrics('2', '0', '1'), DISHES.concat([STANDING])), [P]: { profile: PROFILE }, [O]: { orders: ORDERS }, [C]: { uberConnected: true } };
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);
const build = (answers) => loadFamily({ ...OK, ...answers }).family({});
const rows = (items) => items.map((i) => [i.title, i.text, i.meta]);

test('on open the view reads only the home summary, the profile, the history and the connection: never the cart, the catalog, the concierge or a write', async () => {
  const view = loadFamily(OK);
  await view.family({});
  assert.deepEqual([...view.urls].sort(), ['GET ' + C, 'GET ' + S, 'GET ' + O, 'GET ' + P]);
  for (const url of view.urls) assert.doesNotMatch(url, /\/(cart|search|menu|chat|conversation|order)(\?|$)/, 'no cart, catalog or concierge read: ' + url);
});

test('the stats, the dishes from the summary\x27s detail string, the tastes and the checkouts; nothing is clickable and the one action opens the cockpit entry', async () => {
  const view = loadFamily(OK);
  const model = await view.family({});
  assert.deepEqual([model.kicker, model.title, model.lede], ['Food delivery', '2 things in the order', 'Newest: Synthetic Pad Thai, added W(2026-09-28T10:00:00.000Z). Finish or change the order in Eats.']);
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.hint || null]), [
    ['pending', 'In the order now', '2', null],
    ['links', 'Checkout links, 5 days', '1', 'Not placed orders'],
    ['saved', 'Saved checkouts', 2, null],
    ['uber', 'Uber Eats', 'Linked', null],
  ]);
  assert.deepEqual(rows(section(model, 'order').items), [
    ['Synthetic Pad Thai', 'Waiting in the order', 'added W(2026-09-28T10:00:00.000Z)'],
    ['Synthetic Spring Rolls', 'Waiting in the order', 'added W(2026-09-27T19:00:00.000Z)'],
  ], 'the standing note is not a dish');
  assert.equal(section(model, 'order').note, null, 'no note when the summary is whole and complete');
  assert.deepEqual(section(model, 'tastes').items.map((t) => [t.title, t.text]), [['Favorite food', 'Thai, Mexican'], ['Dietary needs', 'vegetarian'], ['Budget per order', '$40.00'], ['Delivers to', '1 Synthetic Way']]);
  assert.deepEqual(rows(section(model, 'checkouts').items), [
    ['Synthetic Noodle House', 'Checkout link, $24.50', 'W(2026-09-26T18:00:00.000Z)'],
    ['A restaurant', 'Checkout link, no total saved', 'W(2026-09-20T18:00:00.000Z)'],
  ]);
  assert.equal(section(model, 'checkouts').note, 'A checkout link opens Uber Eats. It does not mean an order was placed or delivered.');
  const every = model.sections.flatMap((s) => s.items);
  assert.ok(every.length === 8 && every.every((i) => !i.href && !i.onClick), 'the view opens, adds and hands off nothing from an item');
  assert.equal(model.actions.length, 1);
  model.actions[0].onClick();
  assert.deepEqual([model.actions[0].label, view.opened], ['Order food in Eats', ['/cockpit/?app=eats']]);
});

test('the title names the state: one thing, more in the order than the summary lists, nothing in the order with the last checkout link, nothing saved yet', async () => {
  const one = await build({ [S]: summary(metrics('1', '0', '0'), [DISHES[0], STANDING]) });
  assert.deepEqual([one.title, section(one, 'order').note], ['1 thing in the order', null]);
  const more = await build({ [S]: summary(metrics('5', '0', '0'), DISHES.concat([STANDING])) });
  assert.deepEqual([more.title, section(more, 'order').items.length, section(more, 'order').note], ['5 things in the order', 2, 'Showing the newest 2 of 5. Open Eats for the whole order.']);
  const empty = await build({ [S]: summary(metrics('0', '0', '1'), [NONE, STANDING]) });
  assert.deepEqual([empty.title, empty.lede, section(empty, 'order').items, section(empty, 'order').empty], ['Nothing in the order right now', 'Last checkout link: Synthetic Noodle House, W(2026-09-26T18:00:00.000Z).', [], 'Nothing in the order right now.']);
  const fresh = await build({ [S]: summary(metrics('0', '0', '0'), [NONE, STANDING]), [O]: { orders: [] }, [P]: { profile: { user_sub: 'diner', onboarded: false, dietary: [], favorite_cuisines: [] } } });
  assert.deepEqual([fresh.title, fresh.lede], ['Nothing saved yet', 'Open Eats to find a restaurant and start an order. You confirm and pay in Uber Eats, never here.']);
  assert.deepEqual([section(fresh, 'tastes').items, section(fresh, 'tastes').empty, section(fresh, 'checkouts').items, section(fresh, 'checkouts').empty, stat(fresh, 'saved').value], [[], 'Nothing saved yet. Eats learns tastes as you order.', [], 'No checkout links yet.', 0]);
});

// Nothing in the order and no checkout link to name. BLANK is what GET /profile answers for a diner with no row
// (loadProfile's default); ADDRESS is what the full page's "Use location" button saves (defaultAddress, onboarded).
const IDLE = summary(metrics('0', '0', '0'), [NONE, STANDING]);
const BLANK = { user_sub: 'diner', onboarded: false, dietary: [], favorite_cuisines: [] };
const ADDRESS = { ...BLANK, default_address: '1 Synthetic Way', onboarded: true };
const idleHead = (model) => [model.title, model.lede];

test('with nothing in the order the title says "Nothing saved yet" only when the history answered empty and the profile holds no tastes, never over a failed read or saved tastes', async () => {
  const historyFailed = await build({ [S]: IDLE, [P]: { profile: BLANK }, [O]: { http: 500, body: { error: 'boom' } } });
  assert.deepEqual(idleHead(historyFailed), ['Nothing in the order right now', 'Saved checkouts could not be checked.']);
  assert.equal(section(historyFailed, 'checkouts').empty, 'Saved checkouts could not be checked.', 'the title agrees with the section below it');
  const profileFailed = await build({ [S]: IDLE, [P]: { http: 500, body: { error: 'boom' } }, [O]: { orders: [] } });
  assert.deepEqual(idleHead(profileFailed), ['Nothing in the order right now', 'Saved tastes could not be checked.']);
  assert.equal(section(profileFailed, 'tastes').empty, 'Saved tastes could not be checked.');
  const bothFailed = await build({ [S]: IDLE, [P]: { http: 503, body: {} }, [O]: { http: 500, body: undefined } });
  assert.deepEqual(idleHead(bothFailed), ['Nothing in the order right now', 'Saved checkouts could not be checked. Saved tastes could not be checked.']);
  const addressSaved = await build({ [S]: IDLE, [P]: { profile: ADDRESS }, [O]: { orders: [] } });
  assert.deepEqual(idleHead(addressSaved), ['Nothing in the order right now', 'Eats keeps the saved tastes for the next order.']);
  assert.deepEqual(section(addressSaved, 'tastes').items.map((t) => [t.title, t.text]), [['Favorite food', 'Any craving'], ['Dietary needs', 'No diet set'], ['Budget per order', 'Budget open'], ['Delivers to', '1 Synthetic Way']], 'the tiles below show what the title now acknowledges');
  const tastesNoHistory = await build({ [S]: IDLE, [O]: { http: 500, body: {} } });
  assert.deepEqual(idleHead(tastesNoHistory), ['Nothing in the order right now', 'Saved checkouts could not be checked. Eats keeps the saved tastes for the next order.']);
  const blank = await build({ [S]: IDLE, [P]: { profile: BLANK }, [O]: { orders: [] } });
  assert.deepEqual(idleHead(blank), ['Nothing saved yet', 'Open Eats to find a restaurant and start an order. You confirm and pay in Uber Eats, never here.']);
});

test('a partial summary, a failed side read and an unlinked Uber Eats each read as what they are', async () => {
  const partial = await build({ [S]: summary(metrics('Unavailable', '0', 'Unavailable'), [NOT_CHECKED, STANDING], true) });
  assert.deepEqual([partial.title, partial.lede], ['Some saved data cannot be checked', 'Eats could not read part of what it keeps. Open Eats to see the order.']);
  assert.deepEqual([stat(partial, 'pending').value, stat(partial, 'pending').hint, stat(partial, 'links').value, stat(partial, 'links').hint], ['—', 'Could not check', '—', 'Could not check']);
  assert.deepEqual([section(partial, 'order').items, section(partial, 'order').empty, section(partial, 'order').note], [[], 'The order could not be checked.', 'Some saved data could not be checked.']);
  const someLoaded = await build({ [S]: summary(metrics('2', 'Unavailable', 'Unavailable'), DISHES.concat([NOT_CHECKED, STANDING]), true) });
  assert.deepEqual([someLoaded.title, section(someLoaded, 'order').items.length, section(someLoaded, 'order').note], ['2 things in the order', 2, 'Some saved data could not be checked.']);
  const sides = await build({ [P]: { http: 500, body: { error: 'boom' } }, [O]: { http: 503, body: {} }, [C]: { http: 500, body: undefined } });
  assert.equal(sides.title, '2 things in the order', 'the order still shows');
  assert.deepEqual([section(sides, 'tastes').items, section(sides, 'tastes').empty], [[], 'Saved tastes could not be checked.']);
  assert.deepEqual([section(sides, 'checkouts').items, section(sides, 'checkouts').empty, stat(sides, 'saved').value, stat(sides, 'saved').hint], [[], 'Saved checkouts could not be checked.', '—', 'Could not check']);
  assert.deepEqual([stat(sides, 'uber').value, stat(sides, 'uber').hint], ['—', 'Could not check']);
  const unlinked = await build({ [C]: { uberConnected: false } });
  assert.deepEqual([stat(unlinked, 'uber').value, stat(unlinked, 'uber').hint, stat(unlinked, 'uber').tone || null], ['Not linked', 'Eats still browses its built-in catalog', null]);
  const capped = await build({ [O]: { orders: Array.from({ length: 20 }, () => ORDERS[0]) } });
  assert.deepEqual([stat(capped, 'saved').value, section(capped, 'checkouts').items.length], ['20+', 8], 'the history route stops at 20 and the view shows the newest 8');
});

test('a refusal from any read and a failed summary each read as what they are', async () => {
  const signedOut = await build({ [S]: { http: 401, body: { error: 'not_authenticated' } } });
  assert.deepEqual([signedOut.title, signedOut.lede, signedOut.sections, signedOut.stats], ['Sign in to see the order', 'Eats shows the order of whoever is signed in, and this session is not signed in.', undefined, undefined]);
  const denied = await build({ [P]: { http: 403, body: {} } });
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Eats', 'The Eats routes refused this account (HTTP 403).'], 'a refusal from a side read is a refusal');
  // Every source failed: the route answers 503 with its own body (counts Unavailable, the not-checked note) and no error field.
  await assert.rejects(build({ [S]: { http: 503, body: summary(metrics('Unavailable', 'Unavailable', 'Unavailable'), [NOT_CHECKED, STANDING], true) } }), /^Error: Eats could not read the saved order \(HTTP 503\)\.$/);
  await assert.rejects(build({ [S]: { http: 500, body: undefined } }), /^Error: Eats could not read the saved order \(HTTP 500\)\.$/, 'a non-JSON failure keeps its status');
  // The Eats routes answer a 500 with the raw err.message (a database sentence); the view names the status, never that text.
  await assert.rejects(build({ [S]: { http: 500, body: { error: 'relation "eats_carts" does not exist' } } }), /^Error: Eats could not read the saved order \(HTTP 500\)\.$/, 'a raw route error is not shown to the household');
  await assert.rejects(build({ [S]: { http: 404, body: { error: 'Synthetic endpoint unavailable' } } }), /^Error: Synthetic endpoint unavailable$/, 'a non-server failure keeps the route\x27s own error');
});

/** @returns {object} A stub element with the members the page's own scripts touch on start. */
function node() {
  return { value: '', textContent: '', innerHTML: '', className: '', disabled: false, scrollTop: 0, scrollHeight: 0, style: {}, dataset: {}, tagName: 'DIV',
    classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, appendChild() {}, setAttribute() {}, prepend() {}, focus() {}, querySelectorAll: () => [] };
}
/** @returns {object} A stub document that answers every lookup with a fresh stub element and binds nothing. */
function dom() { return { querySelector: node, querySelectorAll: () => [], getElementById: node, createElement: node, addEventListener() {} }; }
/** @returns {string} The source of the page's script whose body contains `marker`, without its tags. */
function scriptWith(marker) {
  const at = html.indexOf(marker), open = html.lastIndexOf('<script', at), close = html.indexOf('</script>', at);
  return html.slice(html.indexOf('>', open) + 1, close);
}
const view = (active) => ({ active: () => active });

/**
 * @description Run the page's classic script (the full Eats start) against a stub DOM, a stub fetch and the given kit state.
 * @param {object|undefined} kit What window.AppView is: a kit answering the active view, or undefined for a core without the kit.
 * @returns {Promise<string[]>} Every URL the start fetched, in order.
 */
async function runFull(kit) {
  const reads = [];
  const fetchStub = (url) => { reads.push(url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], orders: [], profile: {}, total: 0, uberConnected: false }) }); };
  new Function('window', 'AppView', 'document', 'fetch', 'localStorage', scriptWith("const API = '/api/eats';"))({ AppView: kit, addEventListener() {} }, kit, dom(), fetchStub, { getItem: () => null, setItem() {} });
  await new Promise((resolve) => setTimeout(resolve, 20));
  return reads;
}

/**
 * @description Run the assistant-rail module script with its dynamic imports answered by stubs.
 * @param {object|undefined} kit What window.AppView is.
 * @returns {Promise<{ imports: number, attached: number, ready: number }>} Modules imported, bridge clients attached, bridge-ready events dispatched.
 */
async function runRail(kit) {
  const calls = { imports: 0, attached: 0, ready: 0 };
  const src = scriptWith('surface-bridge-client.js').replace(/await import\('([^']+)'\)/g, "await __import('$1')");
  const AsyncFunction = (async () => {}).constructor;
  const modules = { createSurfaceBridgeClient: () => ({ attach: () => { calls.attached++; } }), createSurfaceProducer: () => ({}) };
  await new AsyncFunction('window', 'AppView', 'Event', 'console', '__import', src)({ AppView: kit, dispatchEvent: () => { calls.ready++; } }, kit, function Event() {}, { warn() {} }, () => { calls.imports++; return Promise.resolve(modules); });
  return calls;
}

/**
 * @description Run the handoff module script (imports stripped) against stub modules and a stub DOM.
 * @param {object|undefined} kit What window.AppView is.
 * @returns {Promise<{ handoffs: number, mounted: number }>} Handoff listeners bound and connected-actions mounts.
 */
async function runHandoff(kit) {
  const calls = { handoffs: 0, mounted: 0 };
  const src = scriptWith('receiveHandoff(').replace(/^import .*$/gm, '');
  const AsyncFunction = (async () => {}).constructor;
  await new AsyncFunction('window', 'AppView', 'document', 'receiveHandoff', 'mountConnectedActions', src)({ AppView: kit }, kit, dom(), () => { calls.handoffs++; }, () => { calls.mounted++; return Promise.resolve(); });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return calls;
}

const FULL_READS = ['/api/eats/profile', '/api/eats/orders/history', '/api/eats/cart', '/api/eats/search?q=&limit=16', '/api/eats/config'];

test('under an audience view the full start reads nothing (the cart-creating /cart and the provider /search included); without one, and with no kit, it reads what it always did', async () => {
  assert.deepEqual(await runFull(view('family')), []);
  assert.deepEqual(await runFull(view(null)), FULL_READS);
  assert.deepEqual(await runFull(undefined), FULL_READS);
});

test('under an audience view the assistant rail is not attached and no handoff listener or connected-actions mount runs; without one they all do', async () => {
  assert.deepEqual(await runRail(view('family')), { imports: 0, attached: 0, ready: 0 });
  assert.deepEqual(await runRail(view(null)), { imports: 2, attached: 1, ready: 1 });
  assert.deepEqual(await runRail(undefined), { imports: 2, attached: 1, ready: 1 });
  assert.deepEqual(await runHandoff(view('family')), { handoffs: 0, mounted: 0 });
  assert.deepEqual(await runHandoff(view(null)), { handoffs: 1, mounted: 1 });
});
