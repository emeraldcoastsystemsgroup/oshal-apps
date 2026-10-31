/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family view asserted as behaviour over a stub kit and a stub fetch: on open it reads exactly GET /home-summary, /profile, /orders/history and /config and never /cart (whose first read creates the diner's cart), /search or /menu (the catalog provider), the concierge or a write; the stats are the pending count and the five-day checkout-link count from the home summary, the saved checkouts from the history and whether Uber Eats is linked; the dishes are the home summary's own cart items read from its detail string; the tastes are the profile in the full page's words for what is not set and an empty section when nothing is saved; the checkouts carry the store, the total and when; the title ladder names the state (things in the order, nothing in the order with the last checkout link, nothing saved yet, some saved data not checked); a partial summary, a failed side read, an unlinked Uber Eats, a 401, a 403 and a failed summary each read as what they are; nothing in the view is clickable and the one action opens the cockpit entry. The page's own scripts are run against a stub DOM to prove that under a view the full start makes no read at all (the cart-creating GET /cart and the provider GET /search included), the assistant rail is not attached and no handoff listener or connected-actions mount runs, while without a view, and with no kit at all, every start step still runs.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Regression for the empty-state title that guessed: with nothing in the order and no checkout link to name, the title said "Nothing saved yet" even when the history read had failed (the checkouts section on the same screen said they could not be checked), when the profile read had failed, or when the profile held saved tastes such as a delivery address (shown in the tiles right below). Now "Nothing saved yet" is asserted only when the history answered empty and the profile answered with no tastes; a failed history read, a failed profile read, both, and a saved address each give "Nothing in the order right now" with a lede naming what is known.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | An unlinked Uber Eats no longer claims Eats "still browses its built-in catalog": the native kernel has no catalog without an Uber Eats connection, so the hint says restaurant search needs one.
 * 5   | maintainer@emeraldcoastsystemsgroup.com     | Where /config answers rail 'absent' (no Uber Eats connector on this installation) the stat reads "None here", not "Not linked" with advice to connect.
 * 6   | maintainer@emeraldcoastsystemsgroup.com     | 1.4.0: the view is the restaurants opened in Uber Eats (the home summary's hand-off items, detail 'Opened in Uber Eats · <stamp>'), the saved tastes and the recent links; the stats are today's and the five-day counts, the saved links and the rail (places = Handoff); the full start without an address makes no restaurant search.
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
const metrics = (day, five, restaurants) => [
  { id: 'meal-handoffs-24h', label: 'Uber Eats links / 24h', value: day, tone: 'neutral' },
  { id: 'meal-handoffs-5d', label: 'Uber Eats links / 5 days', value: five, tone: 'neutral' },
  { id: 'meal-restaurants-30d', label: 'Restaurants opened / 30 days', value: restaurants, tone: 'neutral' },
];
/** @returns {object} A hand-off exactly as routes/home-summary.js writes it (detail carries the stamp). */
const handoffItem = (store, stamp) => ({ text: store, detail: 'Opened in Uber Eats · ' + stamp, tone: 'neutral', fix: 'eats-concierge',
  actions: ['plan-shopping', 'plan-movie', 'plan-music'].map((integration) => ({ integration, context: { title: 'Prepare for my meal from ' + store, notes: 'Restaurant opened in Uber Eats: ' + store + ' on ' + stamp + '. Opening the link is not a placed order; the dishes, address and payment are chosen in Uber Eats.' } })) });
const STANDING = { text: 'Uber Eats links opened from Eats. Opening a link does not confirm an order or delivery.', tone: 'neutral', fix: 'eats-concierge' };
const NONE = { text: 'No saved Uber Eats links yet.', tone: 'neutral', fix: 'eats-concierge' };
const NOT_CHECKED = { text: 'Some saved data cannot be checked.', tone: 'warn', fix: 'eats-concierge' };
/** @returns {object} A home summary as the route answers it: tiles mirror the metrics, hand-offs first, the notes last. */
const summary = (m, items, partial) => ({ metrics: m, tiles: m.slice(0, 4), items, asOf: NOW, partial: !!partial });
const OPENED = [handoffItem('Synthetic Noodle House', '2026-09-28T10:00:00.000Z'), handoffItem('Synthetic Taqueria', '2026-09-27T19:00:00.000Z')];
const PROFILE = { user_sub: 'diner', display_name: null, dietary: ['vegetarian'], favorite_cuisines: ['Thai', 'Mexican'], default_address: '1 Synthetic Way', budget_per_order: '40.00', notes: null, onboarded: true };
const ORDERS = [
  { store_id: 'ChIJ-noodle', store_name: 'Synthetic Noodle House', total: null, handoff_url: 'https://www.ubereats.com/search?q=Synthetic+Noodle+House&pl=synthetic', created_at: '2026-09-28T10:00:00.000Z' },
  { store_id: null, store_name: null, total: null, handoff_url: null, created_at: '2026-09-20T18:00:00.000Z' },
];
const OK = { [S]: summary(metrics('1', '2', '2'), OPENED.concat([STANDING])), [P]: { profile: PROFILE }, [O]: { orders: ORDERS }, [C]: { rail: 'places', source: 'Google Places', handoff: 'uber-eats', uberConnected: false } };
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);
const build = (answers) => loadFamily({ ...OK, ...answers }).family({});
const rows = (items) => items.map((i) => [i.title, i.text, i.meta]);
test('on open the view reads only the home summary, the profile, the history and the config: never the restaurant source, a photo, the concierge or a write', async () => {
  const view = loadFamily(OK);
  await view.family({});
  assert.deepEqual([...view.urls].sort(), ['GET ' + C, 'GET ' + S, 'GET ' + O, 'GET ' + P]);
  for (const url of view.urls) assert.doesNotMatch(url, /\/(search|photo|chat|conversation|order)(\?|$)/, 'no restaurant, photo or concierge read: ' + url);
});
test('the stats, the hand-offs from the summary\x27s detail string, the tastes and the links; nothing is clickable and the one action opens the cockpit entry', async () => {
  const view = loadFamily(OK);
  const model = await view.family({});
  assert.deepEqual([model.kicker, model.title, model.lede], ['Food delivery', 'Last restaurant: Synthetic Noodle House', 'Opened in Uber Eats W(2026-09-28T10:00:00.000Z). Open Eats to find another or open it again.']);
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.hint || null]), [
    ['day', 'Opened today', '1', 'Not placed orders'],
    ['links', 'Opened, 5 days', '2', 'Not placed orders'],
    ['saved', 'Saved links', 2, null],
    ['uber', 'Uber Eats', 'Handoff', 'Opens at your address on your own sign-in'],
  ]);
  assert.deepEqual(rows(section(model, 'recent').items), [
    ['Synthetic Noodle House', 'Opened in Uber Eats', 'opened W(2026-09-28T10:00:00.000Z)'],
    ['Synthetic Taqueria', 'Opened in Uber Eats', 'opened W(2026-09-27T19:00:00.000Z)'],
  ], 'the standing note is not a hand-off');
  assert.equal(section(model, 'recent').note, null, 'no note when the summary is whole and complete');
  assert.deepEqual(section(model, 'tastes').items.map((t) => [t.title, t.text]), [['Favorite food', 'Thai, Mexican'], ['Dietary needs', 'vegetarian'], ['Budget per order', '$40.00'], ['Delivers to', '1 Synthetic Way']]);
  assert.deepEqual(rows(section(model, 'checkouts').items), [
    ['Synthetic Noodle House', 'Uber Eats link', 'W(2026-09-28T10:00:00.000Z)'],
    ['A restaurant', 'Uber Eats link', 'W(2026-09-20T18:00:00.000Z)'],
  ]);
  assert.equal(section(model, 'checkouts').note, 'A link opens Uber Eats at your address with that restaurant searched. It does not mean an order was placed or delivered.');
  const every = model.sections.flatMap((s) => s.items);
  assert.ok(every.length === 8 && every.every((i) => !i.href && !i.onClick), 'the view opens and hands off nothing from an item');
  assert.equal(model.actions.length, 1);
  model.actions[0].onClick();
  assert.deepEqual([model.actions[0].label, view.opened], ['Order food in Eats', ['/cockpit/?app=eats']]);
});
test('the title names the state: more opened than listed, none lately with the last link named, nothing saved yet', async () => {
  const more = await build({ [S]: summary(metrics('1', '5', '3'), OPENED.concat([STANDING])) });
  assert.deepEqual([more.title, section(more, 'recent').items.length, section(more, 'recent').note], ['Last restaurant: Synthetic Noodle House', 2, 'Showing the newest 2 of 5. Open Eats for all of them.']);
  const empty = await build({ [S]: summary(metrics('0', '0', '0'), [NONE, STANDING]) });
  assert.deepEqual([empty.title, empty.lede, section(empty, 'recent').items, section(empty, 'recent').empty], ['No restaurant opened recently', 'Last Uber Eats link: Synthetic Noodle House, W(2026-09-28T10:00:00.000Z).', [], 'No restaurant opened in the last five days.']);
  const fresh = await build({ [S]: summary(metrics('0', '0', '0'), [NONE, STANDING]), [O]: { orders: [] }, [P]: { profile: { user_sub: 'diner', onboarded: false, dietary: [], favorite_cuisines: [] } } });
  assert.deepEqual([fresh.title, fresh.lede], ['Nothing saved yet', 'Open Eats to find the restaurants near you and open one in Uber Eats. You choose the dishes and pay in Uber Eats, never here.']);
  assert.deepEqual([section(fresh, 'tastes').items, section(fresh, 'tastes').empty, section(fresh, 'checkouts').items, section(fresh, 'checkouts').empty, stat(fresh, 'saved').value], [[], 'Nothing saved yet. Eats learns tastes as you order.', [], 'No Uber Eats links yet.', 0]);
});
// Nothing opened lately and no link to name. BLANK is what GET /profile answers for a diner with no row
// (loadProfile's default); ADDRESS is what the full page's "Use location" button saves (defaultAddress, onboarded).
const IDLE = summary(metrics('0', '0', '0'), [NONE, STANDING]);
const BLANK = { user_sub: 'diner', onboarded: false, dietary: [], favorite_cuisines: [] };
const ADDRESS = { ...BLANK, default_address: '1 Synthetic Way', onboarded: true };
const idleHead = (model) => [model.title, model.lede];
test('with nothing opened the title says "Nothing saved yet" only when the history answered empty and the profile holds no tastes, never over a failed read or saved tastes', async () => {
  const historyFailed = await build({ [S]: IDLE, [P]: { profile: BLANK }, [O]: { http: 500, body: { error: 'boom' } } });
  assert.deepEqual(idleHead(historyFailed), ['No restaurant opened recently', 'Saved links could not be checked.']);
  assert.equal(section(historyFailed, 'checkouts').empty, 'Saved links could not be checked.', 'the title agrees with the section below it');
  const profileFailed = await build({ [S]: IDLE, [P]: { http: 500, body: { error: 'boom' } }, [O]: { orders: [] } });
  assert.deepEqual(idleHead(profileFailed), ['No restaurant opened recently', 'Saved tastes could not be checked.']);
  assert.equal(section(profileFailed, 'tastes').empty, 'Saved tastes could not be checked.');
  const bothFailed = await build({ [S]: IDLE, [P]: { http: 503, body: {} }, [O]: { http: 500, body: undefined } });
  assert.deepEqual(idleHead(bothFailed), ['No restaurant opened recently', 'Saved links could not be checked. Saved tastes could not be checked.']);
  const addressSaved = await build({ [S]: IDLE, [P]: { profile: ADDRESS }, [O]: { orders: [] } });
  assert.deepEqual(idleHead(addressSaved), ['No restaurant opened recently', 'Eats keeps the saved tastes for the next order.']);
  assert.deepEqual(section(addressSaved, 'tastes').items.map((t) => [t.title, t.text]), [['Favorite food', 'Any craving'], ['Dietary needs', 'No diet set'], ['Budget per order', 'Budget open'], ['Delivers to', '1 Synthetic Way']], 'the tiles below show what the title now acknowledges');
  const tastesNoHistory = await build({ [S]: IDLE, [O]: { http: 500, body: {} } });
  assert.deepEqual(idleHead(tastesNoHistory), ['No restaurant opened recently', 'Saved links could not be checked. Eats keeps the saved tastes for the next order.']);
  const blank = await build({ [S]: IDLE, [P]: { profile: BLANK }, [O]: { orders: [] } });
  assert.deepEqual(idleHead(blank), ['Nothing saved yet', 'Open Eats to find the restaurants near you and open one in Uber Eats. You choose the dishes and pay in Uber Eats, never here.']);
});
test('a partial summary, a failed side read and an installation with no restaurant source each read as what they are', async () => {
  const partial = await build({ [S]: summary(metrics('Unavailable', 'Unavailable', 'Unavailable'), [NOT_CHECKED, STANDING], true) });
  assert.deepEqual([partial.title, partial.lede], ['Some saved data cannot be checked', 'Eats could not read part of what it keeps. Open Eats to see the restaurants near you.']);
  assert.deepEqual([stat(partial, 'day').value, stat(partial, 'day').hint, stat(partial, 'links').value, stat(partial, 'links').hint], ['—', 'Could not check', '—', 'Could not check']);
  assert.deepEqual([section(partial, 'recent').items, section(partial, 'recent').empty, section(partial, 'recent').note], [[], 'The recent restaurants could not be checked.', 'Some saved data could not be checked.']);
  const someLoaded = await build({ [S]: summary(metrics('Unavailable', '2', 'Unavailable'), OPENED.concat([NOT_CHECKED, STANDING]), true) });
  assert.deepEqual([someLoaded.title, section(someLoaded, 'recent').items.length, section(someLoaded, 'recent').note], ['Last restaurant: Synthetic Noodle House', 2, 'Some saved data could not be checked.']);
  const sides = await build({ [P]: { http: 500, body: { error: 'boom' } }, [O]: { http: 503, body: {} }, [C]: { http: 500, body: undefined } });
  assert.equal(sides.title, 'Last restaurant: Synthetic Noodle House', 'the recent hand-offs still show');
  assert.deepEqual([section(sides, 'tastes').items, section(sides, 'tastes').empty], [[], 'Saved tastes could not be checked.']);
  assert.deepEqual([section(sides, 'checkouts').items, section(sides, 'checkouts').empty, stat(sides, 'saved').value, stat(sides, 'saved').hint], [[], 'Saved links could not be checked.', '—', 'Could not check']);
  assert.deepEqual([stat(sides, 'uber').value, stat(sides, 'uber').hint], ['—', 'Could not check']);
  const notSetUp = await build({ [C]: { rail: 'absent', uberConnected: false } });
  assert.deepEqual([stat(notSetUp, 'uber').value, stat(notSetUp, 'uber').hint], ['Not set up', 'This installation names no restaurant source'], 'no source here is not something to link');
  const capped = await build({ [O]: { orders: Array.from({ length: 20 }, () => ORDERS[0]) } });
  assert.deepEqual([stat(capped, 'saved').value, section(capped, 'checkouts').items.length], ['20+', 8], 'the history route stops at 20 and the view shows the newest 8');
});
test('a refusal from any read and a failed summary each read as what they are', async () => {
  const signedOut = await build({ [S]: { http: 401, body: { error: 'not_authenticated' } } });
  assert.deepEqual([signedOut.title, signedOut.lede, signedOut.sections, signedOut.stats], ['Sign in to see your restaurants', 'Eats shows the restaurants of whoever is signed in, and this session is not signed in.', undefined, undefined]);
  const denied = await build({ [P]: { http: 403, body: {} } });
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Eats', 'The Eats routes refused this account (HTTP 403).'], 'a refusal from a side read is a refusal');
  // Every source failed: the route answers 503 with its own body (counts Unavailable, the not-checked note) and no error field.
  await assert.rejects(build({ [S]: { http: 503, body: summary(metrics('Unavailable', 'Unavailable', 'Unavailable'), [NOT_CHECKED, STANDING], true) } }), /^Error: Eats could not read the saved links \(HTTP 503\)\.$/);
  await assert.rejects(build({ [S]: { http: 500, body: undefined } }), /^Error: Eats could not read the saved links \(HTTP 500\)\.$/, 'a non-JSON failure keeps its status');
  // The Eats routes answer a 500 with the raw err.message (a database sentence); the view names the status, never that text.
  await assert.rejects(build({ [S]: { http: 500, body: { error: 'relation "eats_orders" does not exist' } } }), /^Error: Eats could not read the saved links \(HTTP 500\)\.$/, 'a raw route error is not shown to the household');
  await assert.rejects(build({ [S]: { http: 404, body: { error: 'Synthetic endpoint unavailable' } } }), /^Error: Synthetic endpoint unavailable$/, 'a non-server failure keeps the route\x27s own error');
});

/** @returns {object} A stub element with the members the page's own scripts touch on start. */
function node() {
  return { value: '', textContent: '', innerHTML: '', className: '', disabled: false, scrollTop: 0, scrollHeight: 0, style: {}, dataset: {}, tagName: 'DIV',
    classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, appendChild() {}, setAttribute() {}, prepend() {}, focus() {}, replaceChildren() {}, append() {}, querySelectorAll: () => [], hidden: true, href: '' };
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

// With no saved address the page's own start makes no restaurant search: it asks for the address instead.
const FULL_READS = ['/api/eats/profile', '/api/eats/orders/history', '/api/eats/config'];

test('under an audience view the full start reads nothing; without one, and with no kit, it reads the profile, the history and the config (and no restaurant search without an address)', async () => {
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
