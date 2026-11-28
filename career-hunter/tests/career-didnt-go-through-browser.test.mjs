/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.77.6 (the owner, 2026-11-27: "for any aplication that doesnt submit correctly have a new tab that listas the failed aplications and what went wrong"): Didn't go through on the shipped My jobs page (tools/career-job-lists.html) in Chromium at 1440x900 and 412x915, for made-up people. Every call of the list, the fill-in queue and the runs (GET /didnt-go-through, GET /apply-review, POST /apply-batch, /advance, POST /apply-runs/:id/go-on, GET /apply-runs) goes to Career's real routes over HTTP on the person's real store, where each failure was made through those routes; the counts, the person and the kernel's own routes are stood in. Proved: the stage row of My jobs has Didn't go through after Getting ready with its count, on Saved too, and Applications' row does not; the tab is selected and titled, has no search, filters, Table or pager, says how many it shows and lists the jobs newest first, each with its title linking to the job's page, company, site and host, when it ended, What went wrong in Career's words and What to do next, with one filled button: Go on, Approve again or Open the job; Approve again is the fill-in queue's own approval sheet for that job and, approved, the job leaves the list and the count goes down; Go on is refused while the queue has a job on the computer, and otherwise goes on with the run and opens the job's page; a person with nothing listed reads Nothing to fix with Open Getting ready. Nothing is wider than the screen. Red before the change: the row had no Didn't go through and ?view=didnt-go-through opened Saved.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.77.6, the apply-all run's Skip: a job the fill-in queue skipped while it waited for the person's answer (its run stopped through its ticket, then Skip) shows on Didn't go through as "Skipped while it waited for you: Needs your answer: ... Nothing was submitted." with Approve again, while the queue's next job on the computer is not listed.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { playwright, tools, ORIGIN, PHONE, DESKTOP } from './helpers/ux-page.mjs';
import { applyHarness } from './helpers/career-apply-fixture.mjs';

const API = '/api/career-hunter';
const uuid = (head, n) => head + '-0000-0000-0000-' + String(n).padStart(12, '0');
let browser, h;
const works = [], rows = new Map();
before(async () => {
  browser = await playwright().chromium.launch({ headless: true });
  h = await applyHarness();
  let tickets = 0;
  h.port.createTicket = async (input) => { h.port.created.push(input); return { ticketId: uuid('a6000000', ++tickets) }; };
  h.port.startTicket = async (ticketId, input) => {
    const id = uuid('b6000000', works.length + 1), task = JSON.parse(Buffer.from(input.files[0].bytes).toString('utf8'));
    works.push({ id, ticketId, task }); rows.set(id, { id, ticketId, state: 'queued', executor: 'orbit-apply-v1' });
    return { envelope: { id } };
  };
  h.port.getTicketWork = async (ticketId) => [...rows.values()].filter((row) => row.ticketId === ticketId).map(({ ticketId: _t, ...row }) => ({ ...row }));
});
after(async () => { await browser?.close(); await h?.stop(); });

const workOf = (runId) => works.filter((work) => work.task.intentId === runId).at(-1);
const set = (work, patch) => rows.set(work.id, { ...rows.get(work.id), ...patch });
const sync = (sub, runId) => h.call('POST', '/apply-runs/' + runId + '/sync', {}, sub);
async function start(sub, id) {
  const review = await h.call('GET', '/apply-review/' + id, null, sub);
  const runId = (await h.call('POST', '/apply-runs', { postingId: id, packetDigest: review.body.packetDigest, approved: true }, sub)).body.run.id;
  await h.call('POST', '/apply-runs/' + runId + '/bind', {}, sub); await h.call('POST', '/apply-runs/' + runId + '/start', {}, sub);
  return runId;
}
/**
 * A made-up person whose applications went three ways on their Chrome, each through Career's own routes: job 7's
 * computer stopped (Go on), job 8 was stopped (Approve again), job 9 was left open at Review; with `going`, job 10 is still
 * being filled in on the computer. @returns {Promise<{runs:Record<number,string>}>}
 */
async function person(sub, { going = true } = {}) {
  h.person(sub); for (const id of [8, 9, 10]) h.job(sub, id, { company: 'Sample Freight ' + id });
  const runs = {};
  runs[7] = await start(sub, 7); set(workOf(runs[7]), { state: 'failed' }); await sync(sub, runs[7]);
  runs[8] = await start(sub, 8); set(workOf(runs[8]), { state: 'cancelled' }); await sync(sub, runs[8]);
  runs[9] = await start(sub, 9); set(workOf(runs[9]), { state: 'running', apply: { attempt: 1, state: 'ready', ready: 'Ready: check it and press Submit in the Chrome window.' } }); await sync(sub, runs[9]);
  set(workOf(runs[9]), { state: 'cancelled' }); await sync(sub, runs[9]);
  if (going) { runs[10] = await start(sub, 10); set(workOf(runs[10]), { state: 'running', apply: { attempt: 1, state: 'filling', page: { label: 'My Information' } } }); await sync(sub, runs[10]); }
  return { runs };
}
const orbit = { workers: [{ id: 'orbit-1', clientId: 'orbit-1', kind: 'orbit', hostname: 'Avery’s laptop', available: true, tools: ['browser.control'], features: ['holds-person-mark', 'browser-apply'] }],
  selectedDeviceId: 'orbit-1', selectedDeviceName: 'Avery’s laptop', selectionConfigured: true, available: true };
/**
 * @description Open My jobs at `view` for one made-up person: Career's list, queue and run routes are the real ones; the
 * counts, the person and the kernel's routes are stood in. A job's own page answers a stand-in. @returns {Promise<{page:object,context:object}>}
 */
async function open(sub, size, view = 'didnt-go-through') {
  const context = await browser.newContext({ ...size, locale: 'en-US', timezoneId: 'UTC' });
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== ORIGIN) return route.abort();
    if (p === `${API}/board-native` && url.searchParams.has('application')) return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Job page</title><h1>Job ${url.searchParams.get('application')}</h1>` });
    if (p === `${API}/board-native`) return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(tools, 'career-job-lists.html')) });
    const asset = p.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
    if (asset && existsSync(join(tools, asset[1]))) return route.fulfill({ status: 200, contentType: asset[1].endsWith('.css') ? 'text/css' : 'application/javascript', body: readFileSync(join(tools, asset[1])) });
    if (/^\/api\/career-hunter\/(didnt-go-through|apply-review|apply-runs|apply-batch|saved-answers)/.test(p)) {
      const answer = await fetch(h.origin + p + url.search, { method: req.method(), headers: { 'content-type': 'application/json', 'x-test-person': sub }, body: req.postData() || undefined });
      return route.fulfill({ status: answer.status, contentType: answer.headers.get('content-type') || 'application/json', body: Buffer.from(await answer.arrayBuffer()) });
    }
    if (/^\/(shared|cockpit|ui)\//.test(p)) return route.fulfill({ status: 200, contentType: p.endsWith('.css') ? 'text/css' : 'application/javascript', body: '' });
    if (p === '/api/auth/user') return json({ authenticated: true, sub, tenant: 'tenant-1', principal_id: sub });
    if (p === '/api/guest/session') return json({ guest: false });
    if (p === `${API}/jobs/stats`) return json({ saved: 0, byStatus: [] });
    if (p === `${API}/jobs`) return json({ jobs: [], exhausted: true, exclusions: [], home: { known: true, label: 'Springfield, IL', radiusMiles: 50, line: '', settingsUrl: `${API}/settings` } });
    if (p === `${API}/resume/state`) return json({ hasResume: true, roles: 3, indexing: false });
    if (p === `${API}/submission-queue`) return json({ items: [] });
    if (p === `${API}/applications`) return json({ applications: [] });
    if (p === '/api/apply-operator/workers') return json(orbit);
    if (p === '/api/apply/cards') return json({ cards: [], kept: [] });
    return json({});
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}${API}/board-native?view=${view}`, { waitUntil: 'load' });
  return { page, context };
}
const press = (size, target) => (size === PHONE ? target.tap() : target.click());
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ').trim();
const tabs = (page) => page.getByRole('tablist', { name: 'Application stages' }).locator('a[role=tab]');
/** The tab itself, by its stage, and a wait until its words (label and count) are `words`. */
const mine = (page) => page.locator('a[role=tab][data-stage="didnt-go-through"]');
const tabReads = (page, words) => page.waitForFunction((want) => document.querySelector('a[role=tab][data-stage="didnt-go-through"]')?.textContent === want, words);
const order = (page) => page.locator('[data-dg-row]').evaluateAll((list) => list.map((row) => Number(row.dataset.dgRow)));

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: Didn’t go through lists each job that was not sent with what went wrong and what to do next, and Approve again takes it off the list`, async () => {
    const sub = `avery-quinn-${label}`;
    await person(sub);
    const { page, context } = await open(sub, size);
    try {
      await page.locator('[data-dg-row="7"]').waitFor();
      assert.deepEqual(await tabs(page).allTextContents(), ['New matches', 'Saved', 'Getting ready', 'Didn’t go through3', 'Removed'], 'after Getting ready, with its count');
      assert.equal(await mine(page).getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('#pageTitle').textContent(), 'Didn’t go through');
      assert.equal(await page.title(), 'Didn’t go through');
      for (const id of ['keywordSearch', 'filters', 'jobsViewSwitch']) assert.equal(await page.locator('#' + id).isVisible(), false, `no ${id} on this tab`);
      assert.equal(await page.locator('#pager').isVisible(), false, 'no pager');
      assert.equal(await text(page.locator('#requestState')), '3 shown · newest first');
      assert.deepEqual(await order(page), [9, 8, 7], 'newest first; the job still being filled in is not listed');

      const left = page.locator('[data-dg-row="9"]');
      assert.equal(await left.locator('.dg-title').innerText(), 'Office Manager');
      assert.equal(await left.locator('.dg-title').getAttribute('href'), `${API}/board-native?view=queue&application=9`, 'the title opens the job’s own page');
      assert.equal(await text(left.locator('.job-company')), 'Sample Freight 9');
      assert.equal(await text(left.locator('.dg-site')), 'Workday · example9.wd1.myworkdayjobs.com');
      assert.match(await text(left.locator('.meta')), /Ended [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M/);
      assert.equal(await text(left.locator('.dg-what')), 'What went wrong Career filled it in and left it open at the employer’s Review page in its Chrome window. Career did not see it submitted.');
      assert.equal(await text(left.locator('.dg-next')), 'What to do next If you pressed Submit in that Chrome window, open the job and press I applied. If not, open the job and press Fill it in on my Chrome.');
      assert.deepEqual(await left.locator('.row-actions .btn').allInnerTexts(), ['Open the job']);
      assert.match(await left.locator('.row-actions .btn').getAttribute('class'), /\bprimary\b/, 'Open the job is the next thing to do here');

      const stopped = page.locator('[data-dg-row="8"]');
      assert.equal(await text(stopped.locator('.dg-what')), 'What went wrong You stopped it. Nothing was submitted.');
      assert.match(await text(stopped.locator('.dg-next')), /^What to do next Press Approve again to put it back in your fill-in queue\./);
      assert.deepEqual(await stopped.locator('.row-actions .btn').allInnerTexts(), ['Approve again', 'Open the job']);
      const failed = page.locator('[data-dg-row="7"]');
      assert.equal(await text(failed.locator('.dg-what')), 'What went wrong Your computer stopped before the form reached Review. Nothing was submitted.');
      assert.deepEqual(await failed.locator('.row-actions .btn').allInnerTexts(), ['Go on', 'Open the job']);
      assert.equal(await failed.locator('.row-actions .btn.primary').count(), 1, 'one filled button for the next thing to do');
      const sizes = await page.locator('[data-dg-row] .row-actions .btn').evaluateAll((list) => list.map((el) => el.getBoundingClientRect().height));
      assert.ok(sizes.every((height) => height >= 44), `every button is a 44px target (${sizes.join(', ')})`);
      assert.ok(await fits(page), 'nothing is wider than the screen');

      await press(size, stopped.getByRole('button', { name: 'Approve again' }));
      const sheet = page.getByRole('dialog', { name: 'Fill in 1 job on my Chrome?' });
      await sheet.waitFor();
      assert.match(await text(sheet.locator('.ab-job')), /^Sample Freight 8 · Office Manager/, 'the fill-in queue’s own sheet, for that job');
      await press(size, sheet.getByRole('button', { name: 'Approve and start 1' }));
      await page.locator('[data-dg-row="8"]').waitFor({ state: 'detached' });
      assert.deepEqual(await order(page), [9, 7], 'approved again, it is in the queue and no longer listed');
      await tabReads(page, 'Didn’t go through2');
      await page.locator('#applyBatchLine').getByText('Waiting for the form Career is filling in for Sample Freight 10 to end; the next job starts after it.').waitFor();
      assert.equal(await page.locator('#applyBatch [data-ab-job="8"]').getAttribute('data-ab-state'), 'waiting', 'the queue waits for the job on his computer');

      await press(size, failed.getByRole('button', { name: 'Go on' }));
      await page.locator('#actionState').getByText('Career is filling in Sample Freight 10 on your computer now. Press Go on again when it has ended.').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('view'), 'didnt-go-through', 'it stays on the list');
      assert.equal((await h.call('GET', '/apply-runs?postingId=7', null, sub)).body.runs[0].status, 'failed', 'and nothing went on: one application on the computer at a time');
      assert.ok(await fits(page), 'nothing is wider than the screen');
    } finally { await context.close(); }
  });

  test(`${label}: a job the fill-in queue skipped while it waited for an answer says what it waited for`, async () => {
    const sub = `drew-parker-${label}`, jobs = [];
    h.person(sub); h.job(sub, 8, { company: 'Sample Freight 8' });
    for (const id of [7, 8]) jobs.push({ postingId: id, packetDigest: (await h.call('GET', '/apply-review/' + id, null, sub)).body.packetDigest });
    await h.call('POST', '/apply-batch', { jobs, approved: true }, sub); await h.call('POST', '/apply-batch/advance', {}, sub);
    const runId = (await h.call('GET', '/apply-runs?postingId=7', null, sub)).body.runs[0].id;
    set(workOf(runId), { state: 'running', apply: { attempt: 1, state: 'waiting_for_you', reason: { kind: 'question', text: 'Do you hold a clearance?' } } });
    await h.call('POST', '/apply-batch/advance', {}, sub);
    set(workOf(runId), { state: 'cancelled' });
    assert.equal((await h.call('POST', '/apply-batch/skip', { postingId: 7 }, sub)).code, 200);
    const { page, context } = await open(sub, size);
    try {
      const row = page.locator('[data-dg-row="7"]');
      await row.waitFor();
      assert.equal(await text(row.locator('.dg-what')), 'What went wrong Skipped while it waited for you: Needs your answer: Do you hold a clearance? Nothing was submitted.');
      assert.deepEqual(await row.locator('.row-actions .btn').allInnerTexts(), ['Approve again', 'Open the job']);
      assert.deepEqual(await order(page), [7], 'the queue’s next job, on the computer now, is not listed');
      await tabReads(page, 'Didn’t go through1');
      assert.ok(await fits(page), 'nothing is wider than the screen');
    } finally { await context.close(); }
  });

  test(`${label}: Go on goes on with the run and opens the job’s page; the count shows on Saved and not on Applications; nothing listed reads Nothing to fix`, async () => {
    const sub = `blake-rivera-${label}`, { runs } = await person(sub, { going: false });
    let { page, context } = await open(sub, size, 'saved');
    try {
      await tabReads(page, 'Didn’t go through3');
      assert.equal(await mine(page).getAttribute('href'), `${API}/board-native?view=didnt-go-through`);
      assert.equal(await mine(page).getAttribute('aria-selected'), 'false');
    } finally { await context.close(); }
    ({ page, context } = await open(sub, size, 'status'));
    try {
      await page.getByRole('tab', { name: 'Applied' }).waitFor();
      assert.deepEqual(await tabs(page).allTextContents(), ['Applied', 'Interviewing', 'Offer', 'Closed'], 'Applications’ row has no such tab');
    } finally { await context.close(); }
    ({ page, context } = await open(sub, size));
    try {
      const failed = page.locator('[data-dg-row="7"]');
      await press(size, failed.getByRole('button', { name: 'Go on' }));
      await page.waitForURL((address) => address.searchParams.get('application') === '7');
      assert.equal(await page.locator('h1').innerText(), 'Job 7', 'the job’s own page opened to follow it');
      const run = (await h.call('GET', '/apply-runs?postingId=7', null, sub)).body.runs[0];
      assert.deepEqual([run.id, run.status, run.attempt], [runs[7], 'queued', 2], 'the same approval goes on with its next attempt');
    } finally { await context.close(); }
    h.person(`casey-morgan-${label}`);
    ({ page, context } = await open(`casey-morgan-${label}`, size));
    try {
      await page.getByRole('heading', { name: 'Nothing to fix' }).waitFor();
      assert.equal(await page.getByRole('link', { name: 'Open Getting ready' }).getAttribute('href'), `${API}/board-native?view=queue`);
      await tabReads(page, 'Didn’t go through');
      assert.equal(await mine(page).locator('.n').count(), 0, 'no count when nothing is listed');
      assert.equal((await page.locator('#requestState').innerText()).trim(), '');
      assert.ok(await fits(page), 'nothing is wider than the screen');
    } finally { await context.close(); }
  });
}
