/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive the Inbox and My Day surface scripts in a node:vm context with a minimal DOM and a recording fetch: the mailbox switch reaches the API as ?provider=, reads and drafts stay on the mailbox the list used, the summary follows the digest's mailbox, and a missing connection shows the matching Connect notice. Not a browser receipt.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Yahoo: the mailbox switch offers it, a Yahoo row opens from the list data without a message or draft request, and the connect notice names Yahoo Mail.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The vm global is its own `window`: My Day now carries the audience-view head script and gates its start on `window.AppView`, so the context needs the browser's self-reference. With no kit loaded the head script steps aside and every assertion below still runs the full page.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Yahoo is no longer offered: this installation has no Yahoo connector and its runtime answers every Yahoo read 501. The switch has no Yahoo option, a saved 'yahoo' falls back to the server's pick, and the no-mailbox notice (Inbox, My Day and its audience view) names Google and Outlook only. A Yahoo list the server picks on its own (a core that reads Yahoo) still opens list-only.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The connect notices offer one sign-in button per mailbox provider (tests/mailbox-connect.test.cjs) and keep an All connections link, instead of one link to the unfiltered Connections page.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | The Inbox lists fifty at a time (max=50) and pages; with no `next` in the answer it asks for nothing more, so the reads and drafts below still follow the one list request.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: a missing mailbox is an empty state with ONE primary that opens the connect sheet (no Mail connections link, no /utilities path); My Day greets by local time, hides the mailbox switch until a mailbox is connected, falls back from a saved mailbox that is not connected, and shows the greyed skeleton of what it holds; the Inbox search states its real scope and is disabled with its reason where it cannot search.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (little-monsters--lm-email): with no mailbox connected, the Inbox withholds the Any mailbox switch, Refresh button, disabled search row, search help and stored-copy caption, and reveals them once a mailbox is linked.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

/** A tiny element: enough surface for the two scripts (innerHTML, value, handlers, classList). */
function element(id = '') {
  const classes = new Set();
  return {
    id, innerHTML: '', textContent: '', value: '', className: '', onclick: null, onchange: null, children: [],
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    appendChild(child) { this.children.push(child); return child; },
  };
}

/** Run one surface's inline script against queued JSON answers; returns the recorded requests. */
async function runSurface(file, answers, stored = null) {
  const html = readFileSync(new URL(`../tools/${file}`, import.meta.url), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  const elements = new Map();
  const byId = (id) => { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); };
  const calls = [];
  const context = {
    document: { getElementById: byId, createElement: () => element() },
    localStorage: { getItem: () => stored, setItem: () => undefined },
    navigator: { clipboard: { writeText: () => undefined } },
    fetch: async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET' });
      const next = answers.shift() ?? {};
      return { ok: true, status: 200, json: async () => next };
    },
  };
  // The global is its own `window`, as in a browser. No AppView is loaded here, so My Day's audience-view head
  // script steps aside and the page's own start runs exactly as it does in a core without the shared kit.
  context.window = context;
  vm.createContext(context);
  vm.runInContext(script, context);
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  await settle();
  return { calls, byId, settle };
}

test('the inbox asks for the saved mailbox and shows the Outlook connect notice when it is missing', async () => {
  const { calls, byId } = await runSurface('email-inbox.html', [
    { connected: false, provider: 'outlook', error: 'no_outlook_connection' },
  ], 'outlook');
  assert.equal(calls[0].url, '/api/email/messages?max=50&surface=1&provider=outlook');
  assert.match(byId('items').innerHTML, /<h2>Connect Outlook to see your mail<\/h2>/);
  assert.match(byId('items').innerHTML, /data-connect="outlook">Outlook \/ Microsoft 365</);
  assert.doesNotMatch(byId('items').innerHTML, /utilities|Mail connections|Yahoo/, 'no path and no second link');
  assert.equal(byId('provider').hidden, true, 'no mailbox: switch withheld');
  assert.equal(byId('refresh').hidden, true, 'no mailbox: refresh withheld');
  assert.equal(byId('storeSearch').hidden, true, 'no mailbox: disabled search row withheld');
  assert.equal(byId('searchHelp').hidden, true, 'no mailbox: search help withheld');
  assert.equal(byId('storeLine').hidden, true, 'no mailbox: store line withheld');
  assert.equal(byId('storeQuery').disabled, true, 'no mailbox: the search is disabled');
});

test('the inbox search states the real scope of the mailbox it read', async () => {
  const gmail = await runSurface('email-inbox.html', [{ provider: 'google', source: 'live', messages: [], next: null }]);
  assert.equal(gmail.byId('provider').hidden, false);
  assert.equal(gmail.byId('refresh').hidden, false);
  assert.equal(gmail.byId('storeSearch').hidden, false);
  assert.equal(gmail.byId('storeQuery').placeholder, 'Search Gmail · last 30 days');
  assert.equal(gmail.byId('storeQuery').disabled, false);
  assert.equal(gmail.byId('searchHelp').hidden, true);
  const copy = await runSurface('email-inbox.html', [{ provider: 'google', source: 'stored', store: { stored: 900, complete: true }, messages: [], next: null }]);
  assert.equal(copy.byId('storeQuery').placeholder, 'Search Gmail · last 180 days', 'a complete copy searches its 180 days');
  const outlook = await runSurface('email-inbox.html', [{ provider: 'outlook', source: 'live', messages: [], next: null }], 'outlook');
  assert.equal(outlook.byId('storeQuery').disabled, true);
  assert.equal(outlook.byId('searchGo').disabled, true);
  assert.equal(outlook.byId('searchHelp').textContent, 'Outlook cannot be searched here yet: search reads Gmail only.');
});

test('the inbox lets the server pick, then reads and drafts on the mailbox the list used', async () => {
  const { calls, byId, settle } = await runSurface('email-inbox.html', [
    { provider: 'outlook', messages: [{ id: 'AAMk/1=', from: 'Alpha <alpha@oshal.example.com>', subject: 'Hello', snippet: 'hi', date: '' }] },
    { id: 'AAMk/1=', from: 'Alpha <alpha@oshal.example.com>', subject: 'Hello', date: '', body: 'text' },
    { draft: 'Thanks' },
  ], 'not-a-provider');
  assert.equal(calls[0].url, '/api/email/messages?max=50&surface=1', 'an unknown saved value falls back to the server default');
  assert.equal(byId('count').textContent, '1 loaded · Outlook');
  const row = byId('items').children[0];
  row.onclick();
  await settle();
  assert.equal(calls[1].url, '/api/email/message/AAMk%2F1%3D?provider=outlook');
  byId('draftBtn').onclick();
  await settle();
  assert.deepEqual([calls[2].url, calls[2].method], ['/api/email/draft?provider=outlook', 'POST']);
});

test('a Yahoo list the server picks still opens from the list data alone, because Yahoo is read list-only', async () => {
  const { calls, byId, settle } = await runSurface('email-inbox.html', [
    { provider: 'yahoo', messages: [{ id: '1079', from: 'Sender <sender@mail.example.com>', subject: 'Yahoo hello', snippet: '', date: '2026-09-27T14:05:00.000Z' }] },
  ], 'yahoo');
  assert.equal(calls[0].url, '/api/email/messages?max=50&surface=1', 'a saved Yahoo choice is not requested: the switch no longer offers it');
  assert.equal(byId('count').textContent, '1 loaded · Yahoo');
  byId('items').children[0].onclick();
  await settle();
  assert.equal(calls.length, 1, 'no message fetch and no draft request for a Yahoo row');
  assert.match(byId('reader').innerHTML, /Yahoo hello/);
  assert.match(byId('reader').innerHTML, /read list-only here/);
});

test('no surface offers Yahoo: no switch option, no saved Yahoo request, no "or Yahoo" in the notices', async () => {
  for (const file of ['email-inbox.html', 'email-my-day.html']) {
    const html = readFileSync(new URL(`../tools/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /<option value="yahoo">/, `${file} offers no Yahoo mailbox`);
    assert.doesNotMatch(html, /\bor Yahoo/, `${file} never says to connect Yahoo`);
    const { calls } = await runSurface(file, [{ connected: false, provider: null, error: 'no_mail_connection' }], 'yahoo');
    assert.doesNotMatch(calls[0].url, /provider=yahoo/);
  }
});

test("My Day summarizes the digest's own mailbox and names the missing one", async () => {
  const digest = { provider: 'outlook', date: '2026-09-27', unreadCount: 1, total: 1, events: [], topSenders: [] };
  const ready = await runSurface('email-my-day.html', [digest, { summary: 'Busy day' }], 'outlook');
  assert.deepEqual(ready.calls.map((c) => [c.url, c.method]), [
    ['/api/email/digest?surface=1&provider=outlook', 'GET'],
    ['/api/email/summary?provider=outlook', 'POST'],
  ]);
  assert.equal(ready.byId('aiBody').textContent, 'Busy day');
  assert.equal(ready.byId('provider').hidden, false, 'a connected mailbox shows the switch');
  const none = await runSurface('email-my-day.html', [{ connected: false, provider: null, error: 'no_mail_connection' }]);
  assert.equal(none.calls[0].url, '/api/email/digest?surface=1');
  const html = none.byId('content').innerHTML;
  assert.match(html, /<h2>Connect a mailbox to see your day<\/h2>/);
  assert.equal((html.match(/class="btn"/g) || []).length, 1, 'one primary');
  assert.match(html, /<button type="button" class="btn" data-connect-open>Connect a mailbox<\/button>/);
  assert.match(html, /<dialog class="connect-sheet"[^>]*>[\s\S]*data-connect="gmail">Google \(Gmail\)<\/button><button type="button" class="sheet-row" data-connect="outlook">Outlook \/ Microsoft 365</);
  assert.doesNotMatch(html, /Mail connections|utilities/);
  assert.deepEqual([...html.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]).slice(1), ['Priority mail', 'Follow-ups', 'Today'], 'the greyed skeleton names what arrives');
  assert.doesNotMatch(html, /<section>[^]*?(@|Subject|From)/, 'skeleton blocks only, no invented mail');
  assert.equal(none.byId('provider').hidden, true, 'no mailbox: no switch');
});

test('My Day reads any connected mailbox when the saved one is not connected, because the switch is hidden', async () => {
  const digest = { provider: 'outlook', date: '2026-09-27', unreadCount: 0, total: 0, events: [], topSenders: [] };
  const run = await runSurface('email-my-day.html', [{ connected: false, provider: 'google', error: 'no_google_connection' }, digest, { summary: 'Quiet' }], 'google');
  assert.deepEqual(run.calls.slice(0, 2).map((c) => c.url), ['/api/email/digest?surface=1&provider=google', '/api/email/digest?surface=1']);
  assert.equal(run.byId('provider').hidden, false);
});

test('My Day greets by the local time of day instead of a fixed "Good day"', async () => {
  const html = readFileSync(new URL('../tools/email-my-day.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /☀️ Good day/);
  const run = await runSurface('email-my-day.html', [{ connected: false, provider: null, error: 'no_mail_connection' }]);
  const h = new Date().getHours();
  assert.equal(run.byId('greet').textContent, h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');
  const greeting = new Function(html.match(/function greeting\(now\)\{[^\n]+\}/)[0] + '; return greeting;')();
  assert.deepEqual([9, 13, 20].map((hour) => greeting(new Date(2026, 10, 6, hour))), ['Good morning', 'Good afternoon', 'Good evening']);
});
