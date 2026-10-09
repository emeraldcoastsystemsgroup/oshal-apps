/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company view asserted as behaviour: the head block runs against a stub kit, a stub fetch and a stub DOM, so the tests prove what it reads on open (only GET /digest, with the mailbox the reader picked in My Day, and /summary/cached: never POST /summary, which spends a communications-bot run and rewrites the saved digest), that the counts say they are a sample of the newest 25 messages of the last day, what the tables, calendar and senders show, that a new digest is written only on a click (once, even on a double click) and a refused one is named, and that a mailbox not connected, a core without a Yahoo reader, a refusal and a failure each read as what they are. The page's own script is run with stubs too: under an audience view it binds no mailbox switch and reads nothing.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'email-summarizer';
const PAGE = 'tools/email-my-day.html';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/email"];
const GATE_FILE = 'tools/email-my-day.html';

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

/** @param {string} tag @param {object} [attrs] @param {Array} [children] @returns {object} A stub element the tests can read. */
function fakeEl(tag, attrs, children) { return { tag, attrs: attrs || {}, children: (children || []).filter((c) => c !== null && c !== undefined && c !== false) }; }
/** @returns {object} A stub custom-section body with the three DOM calls the view makes. */
function fakeBody() {
  return { children: [], get firstChild() { return this.children[0]; }, removeChild(n) { this.children.splice(this.children.indexOf(n), 1); }, appendChild(n) { this.children.push(n); return n; } };
}
/** @param {object|string} node @returns {string} Every text the node and its children carry. */
function textOf(node) {
  if (typeof node === 'string') return node;
  return [node.attrs && node.attrs.text ? String(node.attrs.text) : ''].concat((node.children || []).map(textOf)).join(' ').replace(/\s+/g, ' ').trim();
}
/** @param {object} node @param {string} tag @returns {object|null} The first descendant with that tag. */
function find(node, tag) {
  if (node.tag === tag) return node;
  for (const c of node.children || []) { const f = typeof c === 'object' ? find(c, tag) : null; if (f) return f; }
  return null;
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * @description Run the head block against a stub kit, a stub fetch and a stub localStorage, so the company view is
 * asserted as the model it paints and the requests it makes. The stub formatters tag their input (W = AppView.when).
 * @param {Record<string, object>} answers 'URL' (GET) or 'POST URL' -> JSON body; `{ http, body }` answers with that status.
 * @param {string} [picked] What My Day saved as the reader's mailbox choice.
 * @returns {{ company: Function, calls: string[], opened: string[] }} The builder, every request made, every A.open href.
 */
function loadCompany(answers, picked) {
  let config = null;
  const calls = [], opened = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', day: (v) => 'D(' + v + ')', open: (href) => opened.push(href), el: fakeEl };
  const fetchStub = (url, opt) => {
    const method = (opt && opt.method) || 'GET';
    calls.push(method + ' ' + url);
    const a = answers[(method === 'POST' ? 'POST ' : '') + url], status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body || {} : a;
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  };
  new Function('window', 'fetch', 'localStorage', block)({ AppView: kit }, fetchStub, { getItem: () => (picked === undefined ? null : picked) });
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { company: config.audiences.company, calls, opened };
}

const DIGEST = {
  provider: 'google', date: '2026-09-27', total: 25, unreadCount: 7, importantCount: 3, starredCount: 1, unread: [], important: [], starred: [],
  topSenders: [{ name: 'Synthetic Client', count: 4 }, { name: 'Synthetic Bank', count: 1 }],
  events: [{ summary: 'Synthetic standup', start: '2026-09-27T14:00:00.000Z', location: 'Room 2' }, { summary: 'Synthetic offsite', start: '2026-09-27', location: '' }],
  priority: [
    { id: 'm1', from: '"Synthetic Client" <client@example.test>', subject: 'Contract question', receivedAt: '2026-09-27T12:00:00.000Z', unread: true, important: true, starred: false },
    { id: 'm2', from: 'bank@example.test', subject: '', receivedAt: '', unread: false, important: false, starred: true },
  ],
};
const CACHED = { cached: { summary: 'Reply to the client about the contract.', updatedAt: '2026-09-27T08:00:00.000Z' } };
const OK = { '/api/email/digest?surface=1': DIGEST, '/api/email/summary/cached': CACHED };
const section = (model, id) => model.sections.find((s) => s && s.id === id);
const stat = (model, id) => model.stats.find((s) => s.id === id);
/** @param {object} model @returns {object} The saved digest section painted into a stub body. */
function paintDigest(model) { const body = fakeBody(); section(model, 'digest').render(body); return body; }

test('on open the view reads only the digest and the saved digest, never the bot', async () => {
  const view = loadCompany(OK);
  paintDigest(await view.company({}));
  assert.deepEqual([...view.calls].sort(), ['GET /api/email/digest?surface=1', 'GET /api/email/summary/cached']);
  const outlook = loadCompany({ ...OK, '/api/email/digest?surface=1&provider=outlook': { ...DIGEST, provider: 'outlook' } }, 'outlook');
  const model = await outlook.company({});
  assert.ok(outlook.calls.includes('GET /api/email/digest?surface=1&provider=outlook'), 'the mailbox picked in My Day is the one read');
  assert.match(model.lede, /^Outlook · /);
  const unknown = loadCompany(OK, 'hotmail');
  await unknown.company({});
  assert.ok(unknown.calls.includes('GET /api/email/digest?surface=1'), 'an unknown saved choice lets the server pick');
  for (const call of [...view.calls, ...outlook.calls, ...unknown.calls]) assert.match(call, /^GET /, 'nothing but reads on open: ' + call);
});

test('the counts say they are a sample, and the tables show what the digest returned', async () => {
  const model = await loadCompany(OK).company({});
  assert.equal(model.lede, 'Google · 7 unread · 2 events today');
  assert.deepEqual(['unread', 'important', 'starred', 'events', 'recent'].map((id) => [stat(model, id).value, stat(model, id).hint]),
    [[7, 'in the newest 25 of the last 24 h'], [3, 'in the newest 25 of the last 24 h'], [1, 'in the newest 25 of the last 24 h'], [2, null], [25, 'Capped at the newest 25']]);
  assert.deepEqual(section(model, 'needs').rows, [['Synthetic Client', 'Contract question', 'W(2026-09-27T12:00:00.000Z)', 'Unread · Important'], ['bank@example.test', '(no subject)', '—', 'Starred']]);
  const calendar = section(model, 'calendar').items;
  assert.deepEqual(calendar.map((i) => [i.title, i.text]), [['Synthetic standup', 'Room 2'], ['Synthetic offsite', null]]);
  assert.equal(calendar[1].when, 'All day', 'a calendar day is an all-day event, not midnight');
  assert.doesNotMatch(calendar[0].when, /All day|Time not given/, 'a timestamp is a time of day');
  assert.deepEqual(section(model, 'senders').items.map((i) => [i.title, i.meta]), [['Synthetic Client', '4 messages'], ['Synthetic Bank', '1 message']]);
  const small = await loadCompany({ ...OK, '/api/email/digest?surface=1': { ...DIGEST, total: 12, priority: [], topSenders: [] } }).company({});
  assert.deepEqual([stat(small, 'unread').hint, stat(small, 'recent').hint], ['in the last 24 h', null]);
  assert.equal(section(small, 'needs').empty, 'Nothing flagged important or starred in the last 24 h.');
  const yahoo = await loadCompany({ ...OK, '/api/email/digest?surface=1': { ...DIGEST, provider: 'yahoo', events: [] } }).company({});
  assert.deepEqual([section(yahoo, 'calendar').empty, stat(yahoo, 'events').hint], ['Yahoo Mail has no calendar here: oshal reads the Yahoo inbox only.', 'No calendar for Yahoo Mail']);
});

test('the saved digest says when the bot wrote it, and a new one is written only on a click', async () => {
  const view = loadCompany({ ...OK, 'POST /api/email/summary?provider=google': { provider: 'google', summary: 'Two replies owed; standup at nine.' } });
  const body = paintDigest(await view.company({}));
  assert.match(textOf(body), /Reply to the client about the contract\. Written W\(2026-09-27T08:00:00\.000Z\)\. This is when the bot wrote it, not how fresh the inbox is\./);
  assert.equal(view.calls.filter((c) => c.startsWith('POST')).length, 0, 'no summary on open');
  find(body, 'button').attrs.onClick(); find(body, 'button').attrs.onClick();
  assert.equal(find(body, 'button').attrs.text, 'Summarizing…');
  await settle();
  assert.deepEqual(view.calls.filter((c) => c.startsWith('POST')), ['POST /api/email/summary?provider=google'], 'one bot run for the mailbox the digest read, even on a double click');
  assert.match(textOf(body), /^Two replies owed; standup at nine\. Written W\(/);
  assert.equal(find(body, 'button').attrs.disabled, null, 'ready for another run');
  const lost = loadCompany({ ...OK, 'POST /api/email/summary?provider=google': { http: 409, body: { error: 'no_google_connection' } } });
  const lostBody = paintDigest(await lost.company({}));
  find(lostBody, 'button').attrs.onClick(); await settle();
  assert.match(textOf(lostBody), /^Reply to the client about the contract\..*The mailbox is not connected any more, so no summary was written\./);
  const none = paintDigest(await loadCompany({ ...OK, '/api/email/summary/cached': { cached: null } }).company({}));
  assert.match(textOf(none), /^No digest saved yet\. Summarize my day/);
  const unreadable = paintDigest(await loadCompany({ ...OK, '/api/email/summary/cached': { http: 500, body: {} } }).company({}));
  assert.match(textOf(unreadable), /The saved digest could not be read \(HTTP 500\)\./);
});

test('no mailbox, no Yahoo reader, a refusal and a failure each read as what they are', async () => {
  const setup = loadCompany({ ...OK, '/api/email/digest?surface=1': { connected: false, provider: 'outlook', error: 'no_outlook_connection', message: 'Connect your Outlook / Microsoft 365 account at /utilities first.' } });
  const model = await setup.company({});
  assert.deepEqual([model.title, model.lede, model.actions[0].label, model.stats], ['No Outlook / Microsoft 365 account connected', 'Connect your Outlook / Microsoft 365 account at /utilities first.', 'Connect Outlook', undefined]);
  model.actions[0].onClick();
  assert.deepEqual(setup.opened, ['/utilities']);
  const body = paintDigest(model);
  assert.equal(find(body, 'button'), null, 'no summary offered without a mailbox');
  assert.match(textOf(body), /Reply to the client about the contract\./, 'the saved digest still shows');
  const reconnect = await loadCompany({ ...OK, '/api/email/digest?surface=1': { connected: false, provider: 'google', error: 'reconnect_required', message: 'Reconnect your Google account at /utilities.' } }).company({});
  assert.equal(reconnect.title, 'This mailbox needs to be reconnected');
  const noReader = await loadCompany({ ...OK, '/api/email/digest?surface=1&provider=yahoo': { http: 501, body: { error: 'provider_unavailable' } } }, 'yahoo').company({});
  assert.equal(noReader.title, 'Yahoo Mail is not available here');
  const signedOut = await loadCompany({ '/api/email/digest?surface=1': { http: 401, body: {} }, '/api/email/summary/cached': { http: 401, body: {} } }).company({});
  assert.equal(signedOut.title, 'Sign in to see your inbox');
  const denied = await loadCompany({ ...OK, '/api/email/digest?surface=1': { http: 403, body: {} } }).company({});
  assert.equal(denied.title, 'This account cannot open Intelligent Communication');
  await assert.rejects(loadCompany({ ...OK, '/api/email/digest?surface=1': { http: 502, body: { error: 'google 500: backend' } } }).company({}),
    /^Error: Intelligent Communication could not read your mailbox \(HTTP 502\)\.$/);
});

/**
 * @description Run the page's own script with a stub DOM, storage and fetch.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {{ fetches: string[], bound: boolean }} What the full page read and whether the mailbox switch was bound.
 */
function runPage(activeView) {
  const src = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const fetches = [], nodes = {};
  const documentStub = { getElementById: (id) => (nodes[id] = nodes[id] || { id, value: '', innerHTML: '', textContent: '', onchange: null }) };
  new Function('window', 'AppView', 'document', 'localStorage', 'fetch', src)(
    { AppView: { active: () => activeView } }, { active: () => activeView }, documentStub, { getItem: () => null, setItem() {} },
    (url) => { fetches.push(url); return new Promise(() => {}); });
  return { fetches, bound: typeof (nodes.provider && nodes.provider.onchange) === 'function' };
}

test('under an audience view the full page binds no mailbox switch and reads nothing', () => {
  assert.deepEqual(runPage('company'), { fetches: [], bound: false });
  assert.deepEqual(runPage(null), { fetches: ['/api/email/digest?surface=1'], bound: true }, 'the full page still starts');
  assert.doesNotMatch(html, /^run\(\);$/m, 'no ungated start is left');
});
