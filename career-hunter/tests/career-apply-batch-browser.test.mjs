/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-REGEN: the List's bar also offers Generate again (3), the three selected jobs that have documents (tools/career-jobs-table.js 5); Fill in several on my Chrome is still its filled button.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Store gate (Career 1.74.0): a queue read that fails is never written into My jobs' status line (it replaced New matches' Saved: after a swipe in the gate's match-deck case), and New matches does not read the queue at all. Red before the fix: the status line said the read's error.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The Table too: select all there, Fill in several on my Chrome is the bar's filled button; a job whose approval ended while it waited says so and Approve again (1) approves it again on its own sheet and puts it back in the queue.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane APPLY-BATCH (Roger, 2026-11-21: "i really need to be able to post 200 resumes by monday"): Fill in several on my Chrome on the shipped My jobs page (tools/career-job-lists.html) and job page (tools/career-application.html) in Chromium at 1440x900 and 412x915. Every call of the batch, the queue and the single run (GET /apply-review, POST /apply-batch, /advance, /next, /pause, /go-on, /stop, POST /apply-runs/:id/sync and /kept, GET /apply-runs) goes to Career's real routes over HTTP on a made-up person's real store; the job list read and the kernel's own routes (the Job Apply computers, the question cards, the confirmed ticket cancel) are stood in, and the kernel's work record is a scripted one per ticket. Proved: in the List of Getting ready each row has a Select checkbox once his Job Apply computer reports browser-apply; the bar offers Fill in several on my Chrome; its sheet lists each job with company, title, files and site, says how Career fills them in once, and says one selected job still needs documents with Prepare them; Approve and start queues three and starts the first; the panel follows it (Filling in, Ready for you with Next job, which stops that run through the kernel's confirmed cancel and starts the next); a reload keeps the queue; a failed job reported, Pause and Go on, then Submitted with the counts and Clear; the job page shows the same panel, where Stop the queue stops the job on the computer and ends the rest. Nothing is wider than the screen. Red on store main 6ffd5378 (no Select checkbox in the List and no Fill in several on my Chrome).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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
  h.port.createTicket = async (input) => { h.port.created.push(input); return { ticketId: uuid('a4000000', ++tickets) }; };
  h.port.startTicket = async (ticketId, input) => {
    const id = uuid('b4000000', works.length + 1), task = JSON.parse(Buffer.from(input.files[0].bytes).toString('utf8'));
    works.push({ id, ticketId, task }); rows.set(id, { id, ticketId, state: 'queued', executor: 'orbit-apply-v1' });
    return { envelope: { id } };
  };
  h.port.getTicketWork = async (ticketId) => [...rows.values()].filter((row) => row.ticketId === ticketId).map(({ ticketId: _t, ...row }) => ({ ...row }));
});
after(async () => { await browser?.close(); await h?.stop(); });

const runsOf = (dir) => JSON.parse(readFileSync(join(dir, 'apply-runs.json'), 'utf8')).runs;
const mine = (dir) => { const own = runsOf(dir); return works.filter((work) => own[work.task.intentId]); };
const workOf = (dir, postingId) => mine(dir).filter((work) => work.task.task.postingId === postingId).at(-1);
const set = (work, patch) => rows.set(work.id, { ...rows.get(work.id), ...patch });
/** He pressed Submit and the kernel saw the employer's confirmation: the attempt's accepted answer and its picture. */
function submitted(work) {
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('thank you ' + work.id)]), sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  h.port.artifacts.set(work.id + '/confirmation.png', { name: 'confirmation.png', sha256, byteLength: bytes.length, base64: bytes.toString('base64') });
  h.port.accepted.set(work.id, { version: 2, intentId: work.task.intentId, attempt: work.task.attempt, requestDigest: work.task.requestDigest, outcome: 'submitted_by_you',
    data: { confirmation: { artifact: 'confirmation.png', sha256, text: 'Thank you for applying' } } });
  set(work, { state: 'completed' });
}
const listJob = (id, company, extra = {}) => ({ id, company, title: 'Office Manager', status: 'generated', favorite: true, active: 1, has_resume: 1, has_cover: 1, workplaceType: 'onsite',
  location: 'Springfield, IL', url: `https://example${id}.wd1.myworkdayjobs.com/job/${id}`, description: 'A real description.', board: { favorite: true, savedAt: '2026-11-20T15:00:00Z' }, ...extra });
const orbit = { workers: [{ id: 'orbit-1', clientId: 'orbit-1', kind: 'orbit', hostname: 'Dana’s laptop', available: true, tools: ['browser.control'], features: ['holds-person-mark', 'browser-apply'] }],
  selectedDeviceId: 'orbit-1', selectedDeviceName: 'Dana’s laptop', selectionConfigured: true, available: true };

/** A made-up person with three prepared jobs in the real store, and one more on the list with no documents yet. */
function person(sub) {
  const { dir } = h.person(sub); h.job(sub, 8, { company: 'Sample Freight Two' }); h.job(sub, 9, { company: 'Sample Freight Three' });
  return { dir, jobs: [listJob(7, 'Example Freight Co'), listJob(8, 'Sample Freight Two'), listJob(9, 'Sample Freight Three'), listJob(11, 'Sample Freight Five', { status: 'promoted', has_resume: 0, has_cover: 0 })] };
}
/**
 * @description Open My jobs (Getting ready) or a job's page for one made-up person. Career's apply routes are the real
 * ones; the job list and the kernel's routes are stood in. @returns {Promise<{page:object,context:object,kernel:object}>}
 */
async function open(sub, size, jobs, where = 'list', { failBatch = false, view = 'queue' } = {}) {
  const kernel = { cancelled: [], batchReads: 0 }, context = await browser.newContext({ ...size, locale: 'en-US', timezoneId: 'UTC' });
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== ORIGIN) return route.abort();
    if (p === `${API}/board-native`) return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(tools, 'career-job-lists.html')) });
    if (p === '/screen') return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(tools, 'career-application.html')) });
    const asset = p.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
    if (asset && existsSync(join(tools, asset[1]))) return route.fulfill({ status: 200, contentType: asset[1].endsWith('.css') ? 'text/css' : 'application/javascript', body: readFileSync(join(tools, asset[1])) });
    if (p.startsWith(`${API}/apply-batch`)) kernel.batchReads += 1;
    if (failBatch && p.startsWith(`${API}/apply-batch`)) return json({ error: 'Your fill-in queue is unavailable.' }, 503);
    if (/^\/api\/career-hunter\/(apply-review|apply-runs|apply-batch|saved-answers)/.test(p)) {
      const answer = await fetch(h.origin + p + url.search, { method: req.method(), headers: { 'content-type': 'application/json', 'x-test-person': sub }, body: req.postData() || undefined });
      return route.fulfill({ status: answer.status, contentType: answer.headers.get('content-type') || 'application/json', body: Buffer.from(await answer.arrayBuffer()) });
    }
    if (/^\/(shared|cockpit|ui)\//.test(p)) return route.fulfill({ status: 200, contentType: p.endsWith('.css') ? 'text/css' : 'application/javascript', body: '' });
    if (p === '/api/auth/user') return json({ authenticated: true, sub, tenant: 'tenant-1', principal_id: sub });
    if (p === '/api/guest/session') return json({ guest: false });
    if (p === `${API}/jobs`) return json({ jobs: jobs.filter((job) => url.searchParams.get('status') !== 'tracked'), exhausted: true, exclusions: [], home: { known: true, label: 'Springfield, IL', radiusMiles: 50, line: '', settingsUrl: `${API}/settings` } });
    const one = p.match(/^\/api\/career-hunter\/jobs\/(\d+)$/);
    if (one) { const job = jobs.find((item) => item.id === Number(one[1])); return json({ job: { ...job, has_resume: true, has_cover: true, application: { needsGeneration: false, draft: { revision: 1, guidance: '', experienceIds: [] } } } }); }
    if (p === `${API}/jobs/stats`) return json({ saved: jobs.length, byStatus: [] });
    if (p === `${API}/resume/state`) return json({ hasResume: true, roles: 3, indexing: false });
    if (p === `${API}/experience-bank`) return json({ version: 1, revision: 'r1', entries: [] });
    if (p === `${API}/submission-queue`) return json({ items: [] });
    if (p === `${API}/applications`) return json({ applications: [] });
    if (p === '/api/apply-operator/workers') return json(orbit);
    if (p === '/api/apply/cards') return json({ cards: [], kept: [] });
    if (p === '/confirmations') return json({ confirmation: 'confirm-1' });
    const cancel = p.match(/^\/tickets\/([\w-]+)\/cancel$/);
    if (cancel) {
      kernel.cancelled.push({ ticket: cancel[1], confirm: req.headers()['x-oshal-confirm'] });
      for (const row of rows.values()) if (row.ticketId === cancel[1] && !['completed', 'failed'].includes(row.state)) row.state = 'cancelled';
      return json({ ok: true });
    }
    return json({});
  });
  const page = await context.newPage();
  await page.clock.install();
  await page.goto(where === 'list' ? `${ORIGIN}${API}/board-native?view=${view}` : `${ORIGIN}/screen?view=queue&application=${where}`, { waitUntil: 'load' });
  return { page, context, kernel };
}
const press = (size, target) => (size === PHONE ? target.tap() : target.click());
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const panel = (page) => page.locator('#applyBatch');
/** Move the page's time on until `done` answers truthy; the queue moves on every four seconds. */
async function until(page, done, most = 40) {
  for (let i = 0; i < most; i += 1) { if (await done()) return true; await page.clock.runFor(1000); await new Promise((resolve) => setTimeout(resolve, 40)); }
  return done();
}
const state = (page, id) => panel(page).locator(`[data-ab-job="${id}"]`).getAttribute('data-ab-state');

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: select in the List, approve three on one sheet, and the queue runs one after another`, async () => {
    const sub = `dana-batch-page-${label}`, { dir, jobs } = person(sub);
    const { page, context, kernel } = await open(sub, size, jobs);
    try {
      await page.locator('[data-job-id="11"] [data-select]').waitFor();
      for (const id of [7, 8, 9, 11]) await press(size, page.locator(`[data-job-id="${id}"] [data-select]`));
      await page.locator('#bulkBar').getByText('4 selected').waitFor();
      assert.deepEqual(await page.locator('#bulkBar .jt-actions button').allInnerTexts(), ['Fill in several on my Chrome', 'Generate again (3)'], 'the List offers these two (Generate again counts the three with documents)');
      await press(size, page.getByRole('button', { name: 'Fill in several on my Chrome' }));
      const sheet = page.getByRole('dialog', { name: 'Fill in 3 jobs on my Chrome?' });
      await sheet.waitFor();
      const items = await sheet.locator('.ab-job').allInnerTexts();
      assert.equal(items.length, 3);
      assert.match(items[0], /^Example Freight Co · Office Manager/);
      assert.match(items[1], /Sample Freight Two · Office Manager[\s\S]*Résumé for upload forms \(Word\), uploaded · Résumé \(PDF\) · Cover letter \(PDF\)[\s\S]*Workday · example8\.wd1\.myworkdayjobs\.com/);
      assert.equal(await sheet.locator('.ab-flags li').count(), 3, 'how Career fills them in, said once');
      assert.match(await sheet.locator('.ab-stop').innerText(), /^Career stops at each employer’s Review page/);
      assert.equal((await sheet.locator('.ab-needs').innerText()).replace(/\s+/g, ' ').trim(), '1 job you selected still needs documents, so Career leaves it out. Prepare them');
      assert.equal(await sheet.getByRole('button', { name: 'Prepare them' }).isVisible(), true, 'with a button to prepare it');
      assert.ok(await fits(page), 'the sheet fits the screen');
      await press(size, sheet.getByRole('button', { name: 'Approve and start 3' }));
      await panel(page).locator('[data-ab-job="9"]').waitFor();
      assert.equal(await panel(page).locator('#applyBatchTitle').innerText(), 'Filling in job 1 of 3 on your Chrome');
      assert.equal(await panel(page).locator('#applyBatchCounts').innerText(), '0 submitted · 0 ready for you · 0 waiting for you · 0 failed · 2 in line');
      assert.deepEqual([await state(page, 7), await state(page, 8)], ['filling', 'waiting']);
      assert.equal(mine(dir).length, 1, 'one job started');

      set(workOf(dir, 7), { state: 'running', apply: { attempt: 1, state: 'ready', ready: 'Ready: check it and press Submit in the Chrome window.' } });
      assert.ok(await until(page, async () => (await state(page, 7)) === 'ready'), 'ready at Review shows');
      await press(size, panel(page).getByRole('button', { name: 'Next job' }));
      assert.ok(await until(page, async () => (await state(page, 8)) === 'filling'), 'Next job starts the next');
      assert.equal(kernel.cancelled.length, 1, 'the ready run was stopped through the kernel’s cancel');
      assert.equal(kernel.cancelled[0].confirm, 'confirm-1');
      assert.match(await panel(page).locator('[data-ab-job="7"]').innerText(), /Left open in its Chrome window/);

      await page.reload({ waitUntil: 'load' });
      await page.clock.runFor(500);
      await panel(page).locator('[data-ab-job="9"]').waitFor();
      assert.deepEqual([await state(page, 7), await state(page, 8), await state(page, 9)], ['ready', 'filling', 'waiting'], 'a reload keeps the queue');

      await press(size, panel(page).getByRole('button', { name: 'Pause the queue' }));
      await panel(page).getByRole('button', { name: 'Go on' }).waitFor();
      assert.equal(await panel(page).locator('#applyBatchTitle').innerText(), 'Your fill-in queue is paused');
      set(workOf(dir, 8), { state: 'failed' });
      assert.ok(await until(page, async () => (await state(page, 8)) === 'failed'));
      assert.equal(mine(dir).length, 2, 'paused: the next does not start');
      await press(size, panel(page).getByRole('button', { name: 'Go on' }));
      assert.ok(await until(page, async () => (await state(page, 9)) === 'filling'), 'Go on starts the next');
      submitted(workOf(dir, 9));
      assert.ok(await until(page, async () => (await panel(page).locator('#applyBatchTitle').innerText()) === 'Your fill-in queue is finished'));
      assert.equal(await state(page, 9), 'submitted');
      assert.match(await panel(page).locator('[data-ab-job="9"]').innerText(), /Submitted by you; the employer’s confirmation was seen\./);
      assert.equal(await panel(page).locator('#applyBatchCounts').innerText(), '1 submitted · 1 ready for you · 0 waiting for you · 1 failed');
      assert.deepEqual(await panel(page).locator('.ab-actions button').allInnerTexts(), ['Clear'], 'a finished queue offers Clear');
      assert.ok(await fits(page), 'nothing is wider than the screen');
    } finally { await context.close(); }
  });

  test(`${label}: the job page shows the queue, and Stop the queue stops the job on the computer and ends the rest`, async () => {
    const sub = `dana-batch-stop-${label}`, { dir, jobs } = person(sub);
    const reviews = [];
    for (const id of [7, 8]) reviews.push({ postingId: id, packetDigest: (await h.call('GET', '/apply-review/' + id, null, sub)).body.packetDigest });
    await h.call('POST', '/apply-batch', { jobs: reviews, approved: true }, sub);
    await h.call('POST', '/apply-batch/advance', {}, sub);
    set(workOf(dir, 7), { state: 'running', apply: { attempt: 1, state: 'filling', page: { label: 'My Information' } } });
    const { page, context, kernel } = await open(sub, size, jobs, 8);
    try {
      await panel(page).locator('#applyBatchCounts').waitFor();
      assert.equal(await panel(page).locator('#applyBatchTitle').innerText(), 'Filling in job 1 of 2 on your Chrome');
      assert.equal(await panel(page).locator('#applyBatchLine').innerText(), 'Example Freight Co: My Information');
      await press(size, panel(page).getByRole('button', { name: 'Stop the queue' }));
      await panel(page).getByRole('button', { name: 'Clear' }).waitFor();
      assert.equal(await panel(page).locator('#applyBatchTitle').innerText(), 'Your fill-in queue stopped');
      assert.equal(kernel.cancelled.length, 1, 'the job on his computer was stopped through the kernel’s cancel first');
      const queue = (await h.call('GET', '/apply-batch', null, sub)).body.queue;
      assert.deepEqual(queue.entries.map((entry) => [entry.postingId, entry.state]), [[7, 'skipped'], [8, 'skipped']]);
      assert.ok(await fits(page), 'nothing is wider than the screen');
    } finally { await context.close(); }
  });
}

test('the Table: Fill in several on my Chrome is the bar’s filled button, and a job whose approval ended asks to be approved again', async () => {
  const sub = 'dana-batch-table', { dir, jobs } = person(sub);
  const { page, context } = await open(sub, DESKTOP, jobs);
  try {
    await page.locator('[data-job-id="11"] [data-select]').waitFor();
    await page.getByRole('tab', { name: 'Table' }).click();
    await page.locator('#jobsTable [data-id="9"]').waitFor();
    await page.locator('#jtAll').check();
    await page.locator('#bulkBar').getByText('4 selected').waitFor();
    assert.deepEqual(await page.locator('#bulkBar .jt-actions .ck-primary').allInnerTexts(), ['Fill in several on my Chrome'], 'the filled button of Getting ready');
    await page.locator('#bulkBar').getByRole('button', { name: 'Fill in several on my Chrome' }).click();
    const sheet = page.getByRole('dialog', { name: 'Fill in 3 jobs on my Chrome?' });
    await sheet.getByRole('button', { name: 'Approve and start 3' }).click();
    await panel(page).locator('[data-ab-job="9"]').waitFor();
    const file = join(dir, 'apply-runs.json'), stored = JSON.parse(readFileSync(file, 'utf8'));
    for (const run of Object.values(stored.runs)) if (run.postingId === 8) run.expiresAt = new Date(Date.now() - 60000).toISOString();
    writeFileSync(file, JSON.stringify(stored) + '\n', { mode: 0o600 });
    set(workOf(dir, 7), { state: 'cancelled' });
    assert.ok(await until(page, async () => (await state(page, 9)) === 'filling'), 'the job after the expired one starts');
    assert.equal(await state(page, 8), 'needs-you');
    assert.match(await panel(page).locator('[data-ab-job="8"]').innerText(), /Your approval of this job ended \(an approval lasts 24 hours\)\. Approve it again to fill it in\./);
    assert.equal(workOf(dir, 8), undefined, 'the expired job never started');
    await panel(page).getByRole('button', { name: 'Approve again (1)' }).click();
    const again = page.getByRole('dialog', { name: 'Fill in 1 job on my Chrome?' });
    await again.getByRole('button', { name: 'Approve and start 1' }).click();
    assert.ok(await until(page, async () => (await state(page, 8)) === 'waiting'), 'approved again, it waits for the job on the computer');
    assert.ok(await fits(page), 'nothing is wider than the screen');
  } finally { await context.close(); }
});

test('a fill-in queue that cannot be read is never written into My jobs’ status line, and New matches does not read it', async () => {
  const sub = 'dana-batch-unread', { jobs } = person(sub);
  const { page, context, kernel } = await open(sub, DESKTOP, jobs, 'list', { failBatch: true });
  try {
    await page.locator('[data-job-id="7"]').waitFor();
    await until(page, async () => kernel.batchReads >= 2, 12);
    assert.ok(kernel.batchReads >= 1, 'Getting ready reads the queue');
    assert.doesNotMatch(await page.locator('#actionState').innerText(), /unavailable/, 'the status line keeps what the page said');
    assert.equal(await panel(page).isVisible(), false);
  } finally { await context.close(); }
  const matches = await open(sub, PHONE, jobs, 'list', { view: 'matches' });
  try {
    await matches.page.waitForLoadState('load');
    await matches.page.clock.runFor(9000);
    assert.equal(matches.kernel.batchReads, 0, 'New matches (the swipe deck) does not read the queue');
  } finally { await matches.context.close(); }
});
