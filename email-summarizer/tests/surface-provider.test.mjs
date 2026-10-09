/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive the Inbox and My Day surface scripts in a node:vm context with a minimal DOM and a recording fetch: the mailbox switch reaches the API as ?provider=, reads and drafts stay on the mailbox the list used, the summary follows the digest's mailbox, and a missing connection shows the matching Connect notice. Not a browser receipt.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Yahoo: the mailbox switch offers it, a Yahoo row opens from the list data without a message or draft request, and the connect notice names Yahoo Mail.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The vm global is its own `window`: My Day now carries the audience-view head script and gates its start on `window.AppView`, so the context needs the browser's self-reference. With no kit loaded the head script steps aside and every assertion below still runs the full page.
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
  assert.equal(calls[0].url, '/api/email/messages?max=30&surface=1&provider=outlook');
  assert.match(byId('items').innerHTML, /No Outlook \/ Microsoft 365 account connected\./);
  assert.match(byId('items').innerHTML, /href="\/utilities"[^>]*>Connect Outlook/);
});

test('the inbox lets the server pick, then reads and drafts on the mailbox the list used', async () => {
  const { calls, byId, settle } = await runSurface('email-inbox.html', [
    { provider: 'outlook', messages: [{ id: 'AAMk/1=', from: 'Alpha <alpha@oshal.example.com>', subject: 'Hello', snippet: 'hi', date: '' }] },
    { id: 'AAMk/1=', from: 'Alpha <alpha@oshal.example.com>', subject: 'Hello', date: '', body: 'text' },
    { draft: 'Thanks' },
  ], 'not-a-provider');
  assert.equal(calls[0].url, '/api/email/messages?max=30&surface=1', 'an unknown saved value falls back to the server default');
  assert.equal(byId('count').textContent, '1 shown · Outlook');
  const row = byId('items').children[0];
  row.onclick();
  await settle();
  assert.equal(calls[1].url, '/api/email/message/AAMk%2F1%3D?provider=outlook');
  byId('draftBtn').onclick();
  await settle();
  assert.deepEqual([calls[2].url, calls[2].method], ['/api/email/draft?provider=outlook', 'POST']);
});

test('a Yahoo row opens from the list data alone, because Yahoo is read list-only', async () => {
  const { calls, byId, settle } = await runSurface('email-inbox.html', [
    { provider: 'yahoo', messages: [{ id: '1079', from: 'Sender <sender@mail.example.com>', subject: 'Yahoo hello', snippet: '', date: '2026-09-27T14:05:00.000Z' }] },
  ], 'yahoo');
  assert.equal(calls[0].url, '/api/email/messages?max=30&surface=1&provider=yahoo');
  assert.equal(byId('count').textContent, '1 shown · Yahoo');
  byId('items').children[0].onclick();
  await settle();
  assert.equal(calls.length, 1, 'no message fetch and no draft request for a Yahoo row');
  assert.match(byId('reader').innerHTML, /Yahoo hello/);
  assert.match(byId('reader').innerHTML, /read list-only here/);
});

test('the Yahoo connect notice names Yahoo Mail', async () => {
  const { byId } = await runSurface('email-my-day.html', [{ connected: false, provider: 'yahoo', error: 'no_yahoo_connection' }], 'yahoo');
  assert.match(byId('content').innerHTML, /No Yahoo Mail account connected\.<br><a href="\/utilities" target="_top">Connect Yahoo Mail/);
});

test("My Day summarizes the digest's own mailbox and names the missing one", async () => {
  const digest = { provider: 'outlook', date: '2026-09-27', unreadCount: 1, total: 1, events: [], topSenders: [] };
  const ready = await runSurface('email-my-day.html', [digest, { summary: 'Busy day' }], 'outlook');
  assert.deepEqual(ready.calls.map((c) => [c.url, c.method]), [
    ['/api/email/digest?surface=1&provider=outlook', 'GET'],
    ['/api/email/summary?provider=outlook', 'POST'],
  ]);
  assert.equal(ready.byId('aiBody').textContent, 'Busy day');
  const none = await runSurface('email-my-day.html', [{ connected: false, provider: null, error: 'no_mail_connection' }]);
  assert.equal(none.calls[0].url, '/api/email/digest?surface=1');
  assert.match(none.byId('content').innerHTML, /No mailbox connected\.<br><a href="\/utilities" target="_top">Connect Google, Outlook or Yahoo/);
});
