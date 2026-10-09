/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company view asserted as behaviour: the head block runs against a stub kit and a stub fetch, so the tests prove what it reads on open (only /readiness, /signals for 7 days, /home-summary and /linkedin-content-queue, all database reads: never /profiles, which asks LinkedIn, Facebook and X live, and never a draft, an organize, a queue write or a post), that the stats and the notifications say what they count (an unreadable metric as not read, the latest 15 of more, the route's own empty note), that the queue reads newest first with each ticket state named, that setup offers Connect only where something is missing, and that a queue answered without JSON, a failed summary or setup read, a refusal and a failure each read as what they are. The Composer's classic and module scripts are run with stubs too: under an audience view it fetches no profiles, adds no handoff listener, appends no section and fetches no connected-actions offer.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | GET /signals answers at most 100 rows (LIMIT 100), so a notifications answer at that cap is not a total: the note must read "The latest 15 of 100 or more", and below the cap it still names the count the route returned.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'social';
const PAGE = 'tools/social-composer.html';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/social"];
const GATE_FILE = 'tools/social-composer.html';

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
 * @description Run the head block against a stub kit and a stub fetch, so the company view is asserted as the model it
 * paints and the reads it makes. The stub formatters tag their input: W = AppView.when, N = num.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead.
 * @returns {{ company: Function, urls: string[], opened: string[] }} The builder, every request made, every A.open href.
 */
function loadCompany(answers) {
  let config = null;
  const urls = [], opened = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', num: (v) => 'N(' + v + ')', open: (href) => opened.push(href) };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url], status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body : a;
    return Promise.resolve({ ok: status < 400, status, json: () => (body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { company: config.audiences.company, urls, opened };
}

const R = '/api/social/readiness', G = '/api/social/signals?days=7', H = '/api/social/home-summary', Q = '/api/social/linkedin-content-queue';
const READY = { facebook: { ready: false, providers: [], detail: 'Not connected — connect Facebook under Accounts.' }, signals: { ready: true, count: 23, detail: '23 social notifications captured in the last 30 days.' } };
const SIGNALS = { signals: [
  { id: 's1', from: '"LinkedIn" <messages-noreply@linkedin.example.test>', subject: 'Synthetic Person commented on your post', snippet: '', receivedAt: '2026-09-27T12:00:00.000Z' },
  { id: 's2', from: 'notify@x.example.test', subject: '', snippet: '', receivedAt: '2026-09-26T09:00:00.000Z' },
], windowDays: 7 };
const SUMMARY = { metrics: [{ id: 'notifications-24h', label: 'Social notices / 24h', value: '4' }, { id: 'notifications-5d', label: 'Social notices / 5d', value: 'Unavailable' }], items: [], partial: true };
const TICKETS = { tickets: [
  { ticketId: 't1', title: 'LinkedIn post: Older topic', status: 'complete', stateGroup: 'complete', metadata: { topic: 'Older topic' }, createdAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-21T10:00:00.000Z' },
  { ticketId: 't2', title: 'LinkedIn post: Synthetic launch', status: 'approval_required', stateGroup: 'approval_required', metadata: { topic: 'Synthetic launch' }, createdAt: '2026-09-26T10:00:00.000Z', updatedAt: '2026-09-27T10:00:00.000Z' },
  { ticketId: 't3', title: 'LinkedIn post: Queued idea', status: 'approved', stateGroup: 'approved', metadata: {}, createdAt: '2026-09-25T10:00:00.000Z', updatedAt: '2026-09-25T10:00:00.000Z' },
] };
const OK = { [R]: READY, [G]: SIGNALS, [H]: SUMMARY, [Q]: TICKETS };
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);

test('on open the view reads only database-backed routes: never the live profiles, a draft, an organize or a queue write', async () => {
  const view = loadCompany(OK);
  await view.company({});
  assert.deepEqual([...view.urls].sort(), ['GET ' + R, 'GET ' + G, 'GET ' + H, 'GET ' + Q].sort());
  assert.ok(!view.urls.some((u) => /profiles|draft|organize|facebook|twitter|post/.test(u)), 'no live network read and no write');
});

test('the stats and the notifications say what they count', async () => {
  const model = await loadCompany(OK).company({});
  assert.equal(model.lede, '23 social notifications captured in the last 30 days.');
  assert.deepEqual(model.stats.map((x) => [x.id, x.value, x.hint || null]), [['notifications-24h', 'N(4)', null], ['notifications-5d', '—', 'Could not be read'], ['captured', 'N(23)', null], ['queue', 2, 'open of 3'], ['facebook', 'Not connected', null]]);
  assert.deepEqual([stat(model, 'notifications-5d').tone, stat(model, 'facebook').tone], ['warn', 'warn']);
  const signals = section(model, 'signals');
  assert.deepEqual(signals.rows, [['LinkedIn', 'Synthetic Person commented on your post', 'W(2026-09-27T12:00:00.000Z)'], ['notify@x.example.test', '(no subject)', 'W(2026-09-26T09:00:00.000Z)']]);
  assert.match(signals.note, /not unread totals or a complete feed\.$/);
  const many = { signals: Array.from({ length: 40 }, (_, i) => ({ id: 'n' + i, from: 'n@example.test', subject: 'Synthetic ' + i, receivedAt: '2026-09-27T00:00:00.000Z' })), windowDays: 7 };
  const full = section(await loadCompany({ ...OK, [G]: many }).company({}), 'signals');
  assert.deepEqual([full.rows.length, / The latest 15 of 40\.$/.test(full.note)], [15, true]);
  const none = section(await loadCompany({ ...OK, [G]: { signals: [], windowDays: 7, note: 'No social notifications captured yet — enable email notifications on X/Facebook/LinkedIn to your connected inbox; the ingest cron picks them up.' } }).company({}), 'signals');
  assert.match(none.empty, /^No social notifications captured yet/, 'the route\x27s own note');
});

test('a notifications answer at the route cap of 100 says "of 100 or more", not a total', async () => {
  const rowsOf = (n) => ({ signals: Array.from({ length: n }, (_, i) => ({ id: 'c' + i, from: 'c@example.test', subject: 'Synthetic ' + i, receivedAt: '2026-09-27T00:00:00.000Z' })), windowDays: 7 });
  const capped = section(await loadCompany({ ...OK, [G]: rowsOf(100) }).company({}), 'signals');
  assert.equal(capped.rows.length, 15);
  assert.match(capped.note, / The latest 15 of 100 or more\.$/);
  const under = section(await loadCompany({ ...OK, [G]: rowsOf(99) }).company({}), 'signals');
  assert.match(under.note, / The latest 15 of 99\.$/, 'below the cap the count is the whole answer');
});

test('the LinkedIn queue reads newest first with each state named, and setup offers the one action that fits', async () => {
  const view = loadCompany(OK);
  const model = await view.company({});
  assert.deepEqual(section(model, 'queue').rows, [
    ['Synthetic launch', { text: 'Approval required', tone: 'warn' }, 'W(2026-09-26T10:00:00.000Z)', 'W(2026-09-27T10:00:00.000Z)'],
    ['LinkedIn post: Queued idea', { text: 'Queued', tone: null }, 'W(2026-09-25T10:00:00.000Z)', 'W(2026-09-25T10:00:00.000Z)'],
    ['Older topic', { text: 'Done', tone: 'ok' }, 'W(2026-09-20T10:00:00.000Z)', 'W(2026-09-21T10:00:00.000Z)'],
  ]);
  const setup = section(model, 'setup').items;
  assert.deepEqual(setup.map((i) => [i.title, i.badge || null, typeof i.onClick]), [['Facebook Pages', 'Not connected', 'function'], ['Social notifications', 'Arriving', 'object'], ['LinkedIn and X', null, 'function']]);
  setup[0].onClick(); setup[2].onClick();
  assert.deepEqual(model.actions.map((a) => a.label), ['Open the Composer', 'Connect accounts']);
  model.actions[1].onClick();
  assert.deepEqual(view.opened, ['/utilities', '/cockpit/?app=social', '/utilities']);
  const ready = await loadCompany({ ...OK, [R]: { facebook: { ready: true, providers: ['meta-business'], detail: 'Connected (meta-business).' }, signals: READY.signals } }).company({});
  assert.deepEqual([ready.actions.length, stat(ready, 'facebook').value, stat(ready, 'facebook').tone], [1, 'Connected', null]);
  const empty = await loadCompany({ ...OK, [Q]: { tickets: [] } }).company({});
  assert.deepEqual([section(empty, 'queue').empty, stat(empty, 'queue').value], ['No LinkedIn post requests in the queue.', 0]);
});

test('a failed queue, summary or setup read, a refusal and a failure each read as what they are', async () => {
  const crashed = await loadCompany({ ...OK, [Q]: { http: 500, body: undefined } }).company({});
  assert.deepEqual([section(crashed, 'queue').empty, stat(crashed, 'queue').value, stat(crashed, 'queue').hint], ['The LinkedIn queue could not be read (HTTP 500).', '—', 'Could not be read']);
  const noSummary = await loadCompany({ ...OK, [H]: { http: 503, body: { metrics: [{ id: 'notifications-24h', label: 'Social notices / 24h', value: 'Unavailable' }, { id: 'notifications-5d', label: 'Social notices / 5d', value: 'Unavailable' }], items: [], partial: true } } }).company({});
  assert.deepEqual([stat(noSummary, 'notifications-24h').value, stat(noSummary, 'notifications-24h').hint], ['—', 'Could not be read']);
  const noSetup = await loadCompany({ ...OK, [R]: { http: 500, body: { error: 'readiness unavailable' } } }).company({});
  assert.deepEqual([section(noSetup, 'setup').items.length, section(noSetup, 'setup').empty, noSetup.actions.length, stat(noSetup, 'facebook').value],
    [0, 'Setup could not be checked (HTTP 500).', 1, '—']);
  const signedOut = await loadCompany({ [R]: { http: 401, body: {} }, [G]: { http: 401, body: {} }, [H]: { http: 401, body: {} }, [Q]: { http: 401, body: {} } }).company({});
  assert.equal(signedOut.title, 'Sign in to see your social desk');
  const denied = await loadCompany({ ...OK, [R]: { http: 403, body: {} }, [G]: { http: 403, body: {} } }).company({});
  assert.equal(denied.title, 'This account cannot open Social');
  await assert.rejects(loadCompany({ ...OK, [R]: { http: 500, body: {} }, [G]: { http: 502, body: { error: 'db down' } } }).company({}),
    /^Error: Social could not read your notifications or setup \(HTTP 502\)\.$/);
});

/** @returns {object} A stub element with the members the Composer's scripts touch. */
function node() { return { value: '', tagName: 'INPUT', textContent: '', innerHTML: '', className: '', disabled: false, style: {}, dataset: {}, focus() {}, setAttribute() {}, addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => [], appendChild() {} }; }

/**
 * @description Run the Composer's classic script with a stub DOM and fetch.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {string[]} Every URL the Composer fetched.
 */
function runComposer(activeView) {
  const open = html.lastIndexOf('<script>'), src = html.slice(open + 8, html.indexOf('</script>', open));
  const fetches = [];
  new Function('window', 'AppView', 'document', 'fetch', src)({ AppView: { active: () => activeView } }, { active: () => activeView }, { getElementById: node, querySelectorAll: () => [], createElement: node },
    (url) => { fetches.push(url); return new Promise(() => {}); });
  return fetches;
}

/**
 * @description Run the page's module script (imports stripped) against stub modules and a stub DOM.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {{ handoff: number, actions: number, appended: number }} How often each start step ran.
 */
function runModule(activeView) {
  const src = html.slice(html.indexOf('<script type="module">') + 22, html.indexOf('</script>', html.indexOf('<script type="module">')));
  const calls = { handoff: 0, actions: 0, appended: 0 };
  const documentStub = { getElementById: node, createElement: node, body: { append: () => { calls.appended++; } } };
  new Function('window', 'AppView', 'document', 'receiveHandoff', 'mountConnectedActions', src.replace(/^import .*$/gm, ''))(
    { AppView: { active: () => activeView } }, { active: () => activeView }, documentStub,
    () => { calls.handoff++; }, () => { calls.actions++; return Promise.resolve(); });
  return calls;
}

test('under an audience view the Composer asks no network for profiles and its module mounts nothing', () => {
  assert.deepEqual(runComposer('company'), []);
  assert.deepEqual(runComposer(null), ['/api/social/profiles'], 'the full Composer still loads the connected profiles');
  assert.deepEqual(runModule('company'), { handoff: 0, actions: 0, appended: 0 });
  assert.deepEqual(runModule(null), { handoff: 1, actions: 1, appended: 1 }, 'the full page still mounts all three');
  assert.doesNotMatch(html, /^loadAccounts\(\);$/m, 'no ungated start is left');
});
