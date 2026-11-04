/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Inbox's stored-copy controls in Chromium over a loopback fixture of the email and schedule routes: before a copy exists the line says search reads Gmail directly and offers "Keep a copy", which turns on the person's mail-copy job ({class:"person"}) and runs one pass; the line then gives the count, reach and "updates every 10 minutes" with "Update now"; "Search all your mail" asks the stored copy over 180 days and a found message opens in the reader; a failed pass says why and keeps the button. At 412 px the page does not scroll sideways.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The listing pages (Roger, 2026-10-30: "i still only see 30 emails in my inbox"): the first request asks for 50, the next page is asked with the answer's before/skip cursor as soon as the end of the list is in view, the heading counts what is loaded and the end note says how far back the copy reaches; a suspended job with a stale copy is said so with "Turn it back on", which activates the job, runs one pass and reloads the list from the copy.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The copy turns itself on: opening the Inbox with Gmail connected activates the job and stores the first mail with no press, a job an update stopped restarts the same way, nothing starts without a Gmail connection, and a job the person paused or a copy whose job they removed stays off until Keep it up to date (Roger, 2026-11-03: "it better be automated when someone installs the application").
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
  const state = { job: 'not-activated', reason: null, connected: true, provider: 'google', copy: null, failSync: false, pages: false, requests: [] };
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    for await (const chunk of req) body += chunk;
    state.requests.push({ method: req.method, path: url.pathname, search: url.search, body });
    if (url.pathname === '/api/email/inbox') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(fs.readFileSync(path.join(PKG, 'tools', 'email-inbox.html'))); }
    if (url.pathname === '/api/email/email-store.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(PKG, 'tools', 'email-store.js'))); }
    if (url.pathname === '/api/email/messages') {
      if (!state.connected) return send(res, 200, { connected: false, message: 'Connect a mailbox first.' });
      if (state.provider !== 'google') return send(res, 200, { provider: state.provider, source: 'live', messages: [], next: null });
      if (url.searchParams.get('q')) return send(res, 200, { provider: 'google', source: 'stored', messages: [ACT], matched: 1, matchedAll: true, days: 180, store: state.copy });
      if (state.pages) {
        const before = url.searchParams.get('before');
        if (!before) return send(res, 200, { provider: 'google', source: 'stored', store: state.copy, reach: COPY.oldestAt, messages: [{ ...ACT, id: 'p1', subject: 'Page one, first' }, { ...ACT, id: 'p2', subject: 'Page one, second', date: '2026-10-20T10:00:00.000Z' }], next: { before: '2026-10-20T10:00:00.000Z', skip: 1 } });
        return send(res, 200, { provider: 'google', source: 'stored', store: state.copy, reach: COPY.oldestAt, messages: [{ ...ACT, id: 'p3', subject: 'Page two, last', date: '2026-10-19T10:00:00.000Z' }], next: null });
      }
      return send(res, 200, { provider: 'google', source: 'live', messages: [{ ...ACT, id: 'other', subject: 'Weekly newsletter' }], store: state.copy, next: null });
    }
    if (url.pathname === '/api/email/message/act') return send(res, 200, { provider: 'google', ...ACT, to: 'me@example.com', body: 'Twenty percent off the fall course.' });
    if (url.pathname === '/api/email/sync/status') return send(res, 200, { store: state.copy, fresh: Boolean(state.copy), schedule: { app: 'email-summarizer', name: 'mail-copy' } });
    if (url.pathname === '/api/email/sync') {
      if (state.failSync) return send(res, 502, { error: 'google 503: backend error' });
      state.copy = COPY;
      return send(res, 200, { provider: 'google', inserted: 1234, state: COPY });
    }
    if (url.pathname === '/api/v1/agent/schedules') return send(res, 200, { schedules: [{ id: 'job-1', app: 'email-summarizer', name: 'mail-copy', status: state.job, reason: state.reason }] });
    if (url.pathname === '/api/v1/agent/schedules/job-1/activate') { state.job = 'active'; state.reason = null; return send(res, 200, { status: 'active' }); }
    if (url.pathname === '/api/v1/agent/schedules/job-1/deactivate') { state.job = 'not-activated'; return send(res, 200, { status: 'inactive' }); }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, origin: `http://127.0.0.1:${server.address().port}` })));
}

async function page(t, viewport, setup = () => {}) {
  const fx = await fixture();
  setup(fx.state);
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => fx.server.close(r)); });
  const p = await browser.newPage({ viewport });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(fx.origin + '/api/email/inbox');
  return { p, fx, errors };
}

test('opening the Inbox with Gmail connected turns the job on and stores the first mail, with nothing to press', async (t) => {
  const { p, fx, errors } = await page(t, { width: 1280, height: 800 });
  const line = p.locator('#storeLine');
  await line.getByText(/Searchable copy: 1,234 messages back to May 2, 2026 · updated just now · updates every 10 minutes/).waitFor();
  const activate = fx.state.requests.find((r) => r.path === '/api/v1/agent/schedules/job-1/activate');
  assert.deepEqual(JSON.parse(activate.body), { class: 'person' });
  assert.ok(fx.state.requests.some((r) => r.method === 'POST' && r.path === '/api/email/sync'));
  assert.equal(await line.getByRole('button', { name: 'Keep it up to date' }).count(), 0);
  assert.equal(await line.getByRole('button', { name: 'Keep a copy' }).count(), 0, 'nothing to press');
  await line.getByRole('button', { name: 'Update now' }).waitFor();
  assert.deepEqual(errors, []);
});

for (const [name, setup] of [
  ['no mailbox connected', (state) => { state.connected = false; }],
  ['a mailbox that is not Gmail', (state) => { state.provider = 'microsoft'; }],
  ['a job the person paused', (state) => { state.job = 'suspended'; state.reason = 'owner_paused'; state.copy = COPY; }],
  ['a copy whose job the person removed', (state) => { state.copy = COPY; }],
]) {
  test(`nothing turns itself on with ${name}`, async (t) => {
    const { p, fx, errors } = await page(t, { width: 1280, height: 800 }, setup);
    await p.locator('#storeLine').waitFor();
    await p.waitForTimeout(400);
    const posts = fx.state.requests.filter((r) => r.method === 'POST').map((r) => r.path);
    assert.deepEqual(posts, [], 'no job started and no mail stored');
    assert.deepEqual(errors, []);
  });
}

test('Keep it up to date turns a job the person stopped back on when they ask', async (t) => {
  const { p, fx } = await page(t, { width: 1280, height: 800 }, (state) => { state.copy = COPY; });
  const line = p.locator('#storeLine');
  await line.getByRole('button', { name: 'Keep it up to date' }).click();
  await line.getByText(/updates every 10 minutes/).waitFor();
  assert.ok(fx.state.requests.some((r) => r.method === 'POST' && r.path === '/api/v1/agent/schedules/job-1/activate'));
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

test('a failed first pass says why and offers Try again', async (t) => {
  const { p, fx } = await page(t, { width: 1280, height: 800 }, (state) => { state.failSync = true; });
  const line = p.locator('#storeLine');
  await line.getByText('Could not turn on your mail copy: google 503: backend error').waitFor();
  fx.state.failSync = false;
  await line.getByRole('button', { name: 'Try again' }).click();
  await line.getByText(/updates every 10 minutes/).waitFor();
});

test('the list pages: fifty asked, the next page follows the before/skip cursor when the end is in view, and the end note says how far the copy reaches', async (t) => {
  const { p, fx, errors } = await page(t, { width: 1280, height: 800 }, (state) => { state.job = 'active'; });
  await p.getByText('Weekly newsletter').waitFor();
  const first = fx.state.requests.find((r) => r.path === '/api/email/messages');
  assert.equal(new URLSearchParams(first.search).get('max'), '50');
  await p.locator('#more').getByText('That is the last 7 days in your mailbox. Search for older mail.').waitFor();
  fx.state.pages = true;
  fx.state.copy = COPY;
  await p.getByRole('button', { name: '↻' }).click();
  await p.getByText('Page two, last').waitFor();
  assert.deepEqual(await p.locator('.item .subj').allTextContents(), ['Page one, first', 'Page one, second', 'Page two, last'], 'the second page was loaded as the end came into view, after the first');
  const second = fx.state.requests.filter((r) => r.path === '/api/email/messages' && r.search.includes('before=')).map((r) => new URLSearchParams(r.search));
  assert.equal(second.length, 1, 'the cursor was followed once; the last page had none');
  assert.equal(second[0].get('before'), '2026-10-20T10:00:00.000Z');
  assert.equal(second[0].get('skip'), '1');
  await p.locator('#count').getByText('3 loaded · Google').waitFor();
  await p.locator('#more').getByText('Everything in your copy back to May 2, 2026.').waitFor();
  assert.deepEqual(errors, []);
});

test('a job an update stopped restarts when the Inbox opens, runs a pass and reloads the list from the copy', async (t) => {
  const stale = new Date(Date.now() - 10 * 3600_000).toISOString();
  const { p, fx, errors } = await page(t, { width: 412, height: 915 }, (state) => {
    state.copy = { ...COPY, complete: false, syncedThrough: stale, lastRunAt: stale };
    state.job = 'suspended';
    state.reason = 'deny_tier';
    state.pages = true;
  });
  const line = p.locator('#storeLine');
  await line.getByText(/updated just now · updates every 10 minutes/).waitFor();
  const paths = fx.state.requests.filter((r) => r.method === 'POST').map((r) => r.path);
  assert.deepEqual(paths, ['/api/v1/agent/schedules/job-1/activate', '/api/email/sync'], 'activated, then one pass runs, with nothing to press');
  await p.getByText('Page two, last').waitFor();
  assert.equal(await line.getByRole('button', { name: 'Turn it back on' }).count(), 0);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll at phone width');
  assert.deepEqual(errors, []);
});
