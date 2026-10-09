/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Behaviour of the Feeds company view over a stub kit and a stub fetch: on open it reads exactly /home-summary and /settings and never /messages (which indexes on a first open and syncs in the background otherwise), /status (which can refresh the Slack token) or /sync; the title comes from the 24 h count, the four stats carry the summary's counts and a minute-grained sync age with the auto-index note, the newest saved entries carry channel, message and when, the summary's own notes are listed, the one action opens the cockpit entry; the no-index, unavailable-count, partial, failed-settings, 401, 403 and failed-read states are each named. The dashboard script itself is run against a stub DOM to prove its start (settings, messages, the live poll) does not run under a view while it still runs without one, and with no kit at all.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'feeds';
const PAGE = 'tools/feeds.html';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/feeds"];
const GATE_FILE = 'tools/feeds.html';

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
 * paints and the reads it makes rather than as substrings of the source.
 * @param {Record<string, object>} answers URL -> JSON body; `{ status, body }` answers with that HTTP status instead.
 * @returns {{ company: Function, urls: string[], opened: string[] }} The company builder, every URL fetched, every A.open href.
 */
function loadCompany(answers) {
  let config = null;
  const urls = [], opened = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', day: (v) => 'D(' + v + ')', open: (href) => opened.push(href) };
  const fetchStub = (url) => {
    urls.push(url);
    const a = answers[url], status = a === undefined ? 404 : (a.status || 200), body = a === undefined ? {} : a.status ? a.body || {} : a;
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { company: config.audiences.company, urls, opened };
}

const hoursAgo = (h) => new Date(Date.now() - h * 36e5).toISOString();
const SYNCED = new Date(Date.now() - 42 * 60000).toISOString();
const AT_OPS = hoursAgo(2), AT_SALES = hoursAgo(30);
/**
 * @description A saved entry exactly as GET /home-summary shapes it: "<channel>: <message>" in text, the message in detail,
 * and the integration context whose notes lead with "<channel> · <iso>".
 * @param {string} channel The channel name.
 * @param {string} text The message text.
 * @param {string} at The posted time as an ISO string.
 * @returns {object} The summary item.
 */
function entryItem(channel, text, at) {
  const notes = channel + ' · ' + at + '\n' + text;
  return { text: (channel + ': ' + text).slice(0, 120), detail: text.slice(0, 400), tone: 'neutral', fix: 'feeds-dashboard',
    actions: ['prepare-document', 'prepare-post'].map((integration) => ({ integration, context: { title: 'Review a saved feed entry', notes } })) };
}
const metrics = (day, five, channels, sync) => [
  { id: 'indexed-24h', label: 'Indexed Slack / 24h', value: day, tone: 'neutral' },
  { id: 'indexed-5d', label: 'Indexed Slack / 5 days', value: five, tone: 'neutral' },
  { id: 'indexed-channels', label: 'Channels in index', value: channels, tone: 'neutral' },
  { id: 'sync-age', label: 'Last recorded sync', value: sync, tone: 'neutral' },
];
const SAVED_NOTE = { text: 'Saved Slack index only. Counts use rolling 24/120 hours; they are not unread counts or all Slack history.', tone: 'neutral', fix: 'feeds-dashboard' };
const SUMMARY = {
  tiles: metrics('12', '47', '5', '42m ago'), metrics: metrics('12', '47', '5', '42m ago'),
  items: [
    // The message itself carries ": " so the channel split is proven to take the first one.
    entryItem('synthetic-ops', 'Deploy of the synthetic API finished: smoke green.', AT_OPS),
    entryItem('synthetic-sales', 'Synthetic Corp signed the renewal.', AT_SALES),
    { metricId: 'sync-age', text: 'Last recorded sync: ' + SYNCED + '.', tone: 'neutral', fix: 'feeds-dashboard' },
    SAVED_NOTE,
  ],
  asOf: new Date().toISOString(), lastSyncedAt: SYNCED, partial: false,
};
const SETTINGS = { pollEnabled: true, pollIntervalMinutes: 30, maxChannels: 20, perChannel: 20, sentimentEnabled: false, lastSyncedAt: SYNCED };
const OK = { '/api/feeds/home-summary': SUMMARY, '/api/feeds/settings': SETTINGS };
const section = (model, id) => model.sections.find((s) => s && s.id === id);
const stat = (model, id) => model.stats.find((s) => s.id === id);

test('on open the company view reads only the home summary and the settings', async () => {
  const view = loadCompany(OK);
  await view.company({ refresh() {} });
  assert.deepEqual([...view.urls].sort(), ['/api/feeds/home-summary', '/api/feeds/settings']);
  for (const url of view.urls) assert.doesNotMatch(url, /messages|status|sync|connect|dashboard/, 'no indexing, token or sync read: ' + url);
});

test('the board: title from the 24 h count, four stats with a minute-grained sync age, the newest entries with channel, message and when, the notes, one action', async () => {
  const view = loadCompany(OK);
  const model = await view.company({ refresh() {} });
  assert.equal(model.kicker, 'Productivity · Feeds');
  assert.equal(model.title, '12 indexed in the last 24 hours');
  assert.equal(model.lede, '47 in 5 days across 5 channels');
  assert.deepEqual(model.stats.map((s) => [s.id, s.value, s.tone || null]), [['day', 12, null], ['fiveDays', 47, null], ['channels', 5, null], ['sync', '42 min ago', null]]);
  assert.equal(stat(model, 'sync').hint, 'Auto-index every 30 min');
  const entries = section(model, 'recent').items;
  assert.deepEqual(entries.map((e) => [e.title, e.text, e.meta]), [
    ['synthetic-ops', 'Deploy of the synthetic API finished: smoke green.', 'W(' + AT_OPS + ')'],
    ['synthetic-sales', 'Synthetic Corp signed the renewal.', 'W(' + AT_SALES + ')'],
  ]);
  assert.ok(entries.every((e) => !e.href && !e.onClick), 'an entry opens nothing from the view');
  assert.match(section(model, 'recent').note, /^Up to three newest entries/);
  assert.deepEqual(section(model, 'notes').items.map((n) => [n.title, n.tone]), [['Last recorded sync: ' + SYNCED + '.', null], [SAVED_NOTE.text, null]]);
  assert.equal(model.actions.length, 1);
  assert.equal(model.actions[0].label, 'Open the live stream');
  model.actions[0].onClick();
  assert.deepEqual(view.opened, ['/cockpit/?app=feeds'], 'the one action escapes to Feeds in the cockpit');
});

test('no saved index yet is named, with the connect-and-sync action and a warn sync stat; auto-index off is named', async () => {
  const none = { ...SUMMARY, metrics: metrics('0', '0', '0', 'Not recorded'), tiles: [], lastSyncedAt: null,
    items: [{ metricId: 'sync-age', text: 'No valid sync time is recorded. Open Feeds to connect or sync Slack.', tone: 'neutral', fix: 'feeds-dashboard' }, SAVED_NOTE] };
  const model = await loadCompany({ ...OK, '/api/feeds/home-summary': none, '/api/feeds/settings': { ...SETTINGS, pollEnabled: false, lastSyncedAt: null } }).company({ refresh() {} });
  assert.equal(model.title, 'No saved Slack index yet');
  assert.equal(model.lede, 'Connect Slack and sync once in Feeds to fill it. This board reads the saved index only and never starts a sync.');
  assert.equal(model.actions[0].label, 'Connect and sync in Feeds');
  assert.deepEqual([stat(model, 'sync').value, stat(model, 'sync').tone, stat(model, 'sync').hint], ['Not recorded', 'warn', 'Auto-index off']);
  assert.deepEqual([section(model, 'recent').items, section(model, 'recent').empty], [[], 'No saved entries in the last five days.']);
  assert.equal(section(model, 'notes').items.length, 2);
});

test('unavailable counts read as unknown, a partial summary is said, and a failed settings read only drops the auto-index note', async () => {
  const partial = { ...SUMMARY, metrics: metrics('Unavailable', 'Unavailable', 'Unavailable', 'Unavailable'), tiles: [], lastSyncedAt: null, partial: true,
    items: [{ text: 'The saved Slack index cannot be checked.', tone: 'warn', fix: 'feeds-dashboard' }, { metricId: 'sync-age', text: 'The last feed sync cannot be checked.', tone: 'warn', fix: 'feeds-dashboard' }, SAVED_NOTE] };
  const model = await loadCompany({ '/api/feeds/home-summary': partial, '/api/feeds/settings': { status: 500, body: { error: 'boom' } } }).company({ refresh() {} });
  assert.equal(model.title, 'Saved Slack index');
  assert.equal(model.lede, 'Counts could not be checked.');
  for (const id of ['day', 'fiveDays', 'channels']) assert.deepEqual([stat(model, id).value, stat(model, id).hint], ['—', 'Could not check'], id);
  assert.deepEqual([stat(model, 'sync').value, stat(model, 'sync').tone, stat(model, 'sync').hint], ['Unavailable', 'warn', null]);
  assert.deepEqual(section(model, 'notes').items.map((n) => n.tone), ['warn', 'warn', null]);
  const half = await loadCompany({ ...OK, '/api/feeds/home-summary': { ...SUMMARY, metrics: metrics('3', '9', 'Unavailable', '42m ago'), partial: true } }).company({ refresh() {} });
  assert.equal(half.title, '3 indexed in the last 24 hours');
  assert.equal(half.lede, '9 in 5 days · some sources could not be checked');
});

test('a refusal is named without counts, and a failed summary read fails with its status, not a database message', async () => {
  const signedOut = await loadCompany({ ...OK, '/api/feeds/home-summary': { status: 401, body: { error: 'not_authenticated' } } }).company({ refresh() {} });
  assert.equal(signedOut.title, 'Sign in to see the feed index');
  assert.ok(!signedOut.stats && !signedOut.sections, 'a refusal paints no counts');
  const denied = await loadCompany({ ...OK, '/api/feeds/home-summary': { status: 403, body: {} } }).company({ refresh() {} });
  assert.equal(denied.title, 'This account cannot open Feeds');
  assert.equal(denied.lede, 'The Feeds routes refused this account (HTTP 403).');
  await assert.rejects(loadCompany({ ...OK, '/api/feeds/home-summary': { status: 503, body: { error: 'relation "feed_messages" does not exist' } } }).company({ refresh() {} }),
    /^Error: Feeds could not read the saved index \(HTTP 503\)\.$/);
});

/**
 * @description Run the dashboard's own script (the last script of the page) against a stub DOM, a stub fetch and a
 * kit whose active() answers as given, to observe whether its start runs and what it reads.
 * @param {string|null|undefined} activeView What AppView.active() answers; undefined leaves window.AppView absent.
 * @returns {Promise<{ fetched: string[], polls: number[] }>} Every URL fetched and every interval the live poll set.
 */
async function runDashboard(activeView) {
  const s = html.lastIndexOf('<script>'); const src = html.slice(s + 8, html.indexOf('</script>', s));
  const fetched = [], polls = [];
  const node = () => ({ className: '', textContent: '', innerHTML: '', value: '', disabled: false, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } });
  const documentStub = { getElementById: () => node() };
  const fetchStub = (url) => { fetched.push(url); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(/messages/.test(url) ? { connected: false, messages: [] } : SETTINGS) }); };
  const kit = activeView === undefined ? undefined : { active: () => activeView };
  new Function('window', 'document', 'fetch', 'setInterval', 'clearInterval', 'AppView', src)({ AppView: kit }, documentStub, fetchStub, (_fn, ms) => { polls.push(ms); return 1; }, () => {}, kit);
  await new Promise((resolve) => setTimeout(resolve, 25));
  return { fetched, polls };
}

test('under an audience view the dashboard start does not run: nothing is read and no live poll is set; without a view, and without the kit, it starts as before', async () => {
  assert.deepEqual(await runDashboard('company'), { fetched: [], polls: [] });
  assert.deepEqual(await runDashboard(null), { fetched: ['/api/feeds/settings', '/api/feeds/messages?limit=300'], polls: [15000] });
  assert.deepEqual(await runDashboard(undefined), { fetched: ['/api/feeds/settings', '/api/feeds/messages?limit=300'], polls: [15000] }, 'a core without the kit runs the dashboard as before');
  assert.doesNotMatch(html, /^\s*loadSettings\(\)\.then/m, 'no ungated start is left');
});
