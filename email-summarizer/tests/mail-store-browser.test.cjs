/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Inbox's stored-copy controls in Chromium over a loopback fixture of the email and schedule routes: before a copy exists the line says search reads Gmail directly and offers "Keep a copy", which turns on the person's mail-copy job ({class:"person"}) and runs one pass; the line then gives the count, reach and "updates every 10 minutes" with "Update now"; "Search all your mail" asks the stored copy over 180 days and a found message opens in the reader; a failed pass says why and keeps the button. At 412 px the page does not scroll sideways.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.join(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

const NOW = new Date().toISOString();
const COPY = { provider: 'google', stored: 1234, syncedThrough: NOW, oldestAt: '2026-05-02T12:00:00.000Z', complete: true, lastRunAt: NOW, lastError: null };
const ACT = { id: 'act', from: 'Prep Academy <offers@prep.example>', subject: 'Fall ACT prep course: 20% off', date: NOW, snippet: 'Enroll by Friday', unread: true };

/** The routes the page calls, with a recorded request log and switchable answers. */
function fixture() {
  const state = { job: 'inactive', copy: null, failSync: false, requests: [] };
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    for await (const chunk of req) body += chunk;
    state.requests.push({ method: req.method, path: url.pathname, search: url.search, body });
    if (url.pathname === '/api/email/inbox') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(fs.readFileSync(path.join(PKG, 'tools', 'email-inbox.html'))); }
    if (url.pathname === '/api/email/email-store.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(PKG, 'tools', 'email-store.js'))); }
    if (url.pathname === '/api/email/messages') {
      if (url.searchParams.get('q')) return send(res, 200, { provider: 'google', source: 'stored', messages: [ACT], matched: 1, matchedAll: true, days: 180, store: state.copy });
      return send(res, 200, { provider: 'google', source: 'live', messages: [{ ...ACT, id: 'other', subject: 'Weekly newsletter' }], store: state.copy });
    }
    if (url.pathname === '/api/email/message/act') return send(res, 200, { provider: 'google', ...ACT, to: 'me@example.com', body: 'Twenty percent off the fall course.' });
    if (url.pathname === '/api/email/sync/status') return send(res, 200, { store: state.copy, fresh: Boolean(state.copy), schedule: { app: 'email-summarizer', name: 'mail-copy' } });
    if (url.pathname === '/api/email/sync') {
      if (state.failSync) return send(res, 502, { error: 'google 503: backend error' });
      state.copy = COPY;
      return send(res, 200, { provider: 'google', inserted: 1234, state: COPY });
    }
    if (url.pathname === '/api/v1/agent/schedules') return send(res, 200, { schedules: [{ id: 'job-1', app: 'email-summarizer', name: 'mail-copy', status: state.job }] });
    if (url.pathname === '/api/v1/agent/schedules/job-1/activate') { state.job = 'active'; return send(res, 200, { status: 'active' }); }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, origin: `http://127.0.0.1:${server.address().port}` })));
}

async function page(t, viewport) {
  const fx = await fixture();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => fx.server.close(r)); });
  const p = await browser.newPage({ viewport });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(fx.origin + '/api/email/inbox');
  return { p, fx, errors };
}

test('Keep a copy turns on the person\'s job, stores the first pass, and the line reports the copy', async (t) => {
  const { p, fx, errors } = await page(t, { width: 1280, height: 800 });
  const line = p.locator('#storeLine');
  await line.getByText('Search reads Gmail directly (the last 30 days).').waitFor();
  await line.getByRole('button', { name: 'Keep a copy' }).click();
  await line.getByText(/Searchable copy: 1,234 messages back to May 2, 2026 · updated just now · updates every 10 minutes/).waitFor();
  const activate = fx.state.requests.find((r) => r.path === '/api/v1/agent/schedules/job-1/activate');
  assert.deepEqual(JSON.parse(activate.body), { class: 'person' });
  assert.ok(fx.state.requests.some((r) => r.method === 'POST' && r.path === '/api/email/sync'));
  assert.equal(await line.getByRole('button', { name: 'Keep it up to date' }).count(), 0);
  await line.getByRole('button', { name: 'Update now' }).waitFor();
  assert.deepEqual(errors, []);
});

test('Search all your mail asks the stored copy over 180 days and a found message opens', async (t) => {
  const { p, fx, errors } = await page(t, { width: 412, height: 915 });
  await p.getByText('Weekly newsletter').waitFor();
  await p.getByRole('searchbox', { name: 'Search all your mail' }).fill('ACT prep');
  await p.getByRole('button', { name: 'Search', exact: true }).click();
  await p.locator('#count').getByText('1 found in your copy').waitFor();
  const search = fx.state.requests.find((r) => r.path === '/api/email/messages' && r.search.includes('q='));
  assert.equal(new URLSearchParams(search.search).get('q'), 'ACT prep');
  assert.equal(new URLSearchParams(search.search).get('days'), '180');
  await p.getByText('Fall ACT prep course: 20% off').click();
  await p.locator('#reader').getByText('Twenty percent off the fall course.').waitFor();
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll at phone width');
  assert.deepEqual(errors, []);
});

test('a failed pass says why and keeps the button', async (t) => {
  const { p, fx } = await page(t, { width: 1280, height: 800 });
  fx.state.failSync = true;
  const line = p.locator('#storeLine');
  await line.getByRole('button', { name: 'Keep a copy' }).click();
  await line.getByText('Could not update the copy: google 503: backend error').waitFor();
  assert.equal(await line.getByRole('button', { name: 'Keep a copy' }).isEnabled(), true);
});
