/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0 (Fill it in on my Chrome, design APPLY-ORBIT 5.2): the receipt as a person reads it, in Chromium at 1440x900 and 412x915 over Career's real routes on a made-up person's store (the kernel's record of an ended attempt stood in). Red on store main 75fa525e. Submission activity lists the run under Filled in on your Chrome with its state and its job, and opening it shows what Career did: the file uploaded with its version, each change on each page with what the site had, what Career entered and where it came from (your record: role 1 job title, your answer on the card, saved answer), the questions, the hand-back and the pictures. The job page of a run that reached Review without a confirmation reads Not seen yet with I applied and the same receipt.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { playwright, tools, ORIGIN, PHONE, DESKTOP } from './helpers/ux-page.mjs';
import { applyHarness, WORKDAY } from './helpers/career-apply-fixture.mjs';

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const png = (label) => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(label)]);
let browser, h;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); h = await applyHarness(); });
after(async () => { await browser?.close(); await h?.stop(); });

/** One run that reached Review, ended Not seen, with its kernel record read back through the real sync route. */
async function ended(sub) {
  const person = h.person(sub), { body } = await h.call('GET', '/apply-review/7', null, sub);
  const run = (await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: body.packetDigest, approved: true }, sub)).body.run;
  await h.call('POST', `/apply-runs/${run.id}/bind`, {}, sub); await h.call('POST', `/apply-runs/${run.id}/start`, {}, sub);
  const workId = 'b2000000-0000-0000-0000-00000000000' + h.port.started.length, input = JSON.parse(fs.readFileSync(path.join(person.dir, `apply-${run.id}-1.json`), 'utf8'));
  const page = png('my experience ' + sub);
  h.port.artifacts.set(workId + '/page-1.png', { name: 'page-1.png', sha256: sha(page), byteLength: page.length, base64: page.toString('base64') });
  h.port.rows = [{ id: workId, state: 'completed', executor: 'orbit-apply-v1' }];
  h.port.accepted.set(workId, { version: 2, intentId: run.id, attempt: 1, requestDigest: input.requestDigest, outcome: 'not_seen', data: {
    reason: 'Not seen yet; mark it applied when you have.',
    uploads: [{ document: 'resume-docx', field: 'Select file', page: 'Autofill with Resume', name: input.task.documents[0].name, size: 40, sha256: input.task.documents[0].sha256 }],
    changes: [{ page: 'My Experience', label: 'Job Title', group: 'Work Experience 1', before: 'Office Mgr', after: 'Office Manager', from: 'role:1.title' },
      { page: 'My Experience', label: 'From', group: 'Work Experience 3', before: '', after: '05/2012', from: 'card:month' },
      { page: 'Application Questions', label: 'Will you require sponsorship?', group: '', before: 'Select One', after: 'No', from: 'answer:question:' + 'a'.repeat(64) }],
    questions: [{ text: 'Will you require sponsorship?', answer: 'No', from: 'saved answer' }],
    handBacks: [{ reason: 'sign-in', text: 'Sign in to this employer’s site in the Chrome window Career opened.', at: '2026-11-21T10:00:00Z', endedAt: '2026-11-21T10:02:00Z' }],
    pictures: [{ artifact: 'page-1.png', sha256: sha(page), page: 'My Experience', at: '2026-11-21T10:05:00Z' }] } });
  const synced = await h.call('POST', `/apply-runs/${run.id}/sync`, {}, sub);
  assert.equal(synced.body.run.status, 'not_seen', JSON.stringify(synced.body));
  return { person, run };
}
async function open(sub, size, file, query) {
  const context = await browser.newContext({ ...size, locale: 'en-US', timezoneId: 'UTC' });
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.origin !== ORIGIN) return route.abort();
    if (p === '/screen') return route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(tools, file)) });
    const asset = p.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
    if (asset) return route.fulfill({ status: 200, contentType: asset[1].endsWith('.css') ? 'text/css' : 'application/javascript', body: fs.readFileSync(path.join(tools, asset[1])) });
    if (/^\/api\/career-hunter\/(apply-review|apply-runs|saved-answers)/.test(p)) {
      const answer = await fetch(h.origin + p + url.search, { method: req.method(), headers: { 'content-type': 'application/json', 'x-test-person': sub }, body: req.postData() || undefined });
      return route.fulfill({ status: answer.status, contentType: answer.headers.get('content-type') || 'application/json', body: Buffer.from(await answer.arrayBuffer()) });
    }
    if (/^\/(shared|cockpit|ui)\//.test(p)) return route.fulfill({ status: 200, contentType: p.endsWith('.css') ? 'text/css' : 'application/javascript', body: '' });
    if (p === '/api/career-hunter/jobs/7') return json({ job: { id: 7, title: 'Office Manager', company: 'Example Freight Co', status: 'generated', has_resume: true, has_cover: true, url: WORKDAY, board: {}, application: { needsGeneration: false, draft: { revision: 1, guidance: '', experienceIds: [] } } } });
    if (p === '/api/career-hunter/experience-bank') return json({ version: 1, revision: 'r1', entries: [] });
    if (p === '/api/career-hunter/resume/state') return json({ hasResume: true });
    if (p === '/api/career-hunter/applications') return json({ applications: [] });
    if (p === '/api/career-hunter/submission-queue') return json({ items: [] });
    if (p === '/api/career-hunter/jobs') return json({ jobs: [] });
    if (p === '/api/apply-operator/workers') return json({ workers: [], available: false });
    if (p === '/api/apply/cards') return json({ cards: [], kept: [] });
    return json({});
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/screen${query}`, { waitUntil: 'load' });
  return { page, context };
}
const press = (size, target) => (size === PHONE ? target.tap() : target.click());
async function receiptReads(page) {
  const receipt = page.locator('#applyReceipt');
  await receipt.waitFor();
  const text = (await receipt.innerText()).replace(/\s+/g, ' ');
  assert.match(text, /What Career did on the employer’s form/);
  assert.match(text, /Example Freight Co - Office Manager - Job 7 - Resume\.docx · this job’s Word résumé · Autofill with Resume · version [0-9a-f]{10}/);
  assert.match(text, /Job Title \(Work Experience 1\): “Office Mgr” → “Office Manager” · your record: role 1 job title/);
  assert.match(text, /From \(Work Experience 3\): “05\/2012” · your answer on the card/);
  assert.match(text, /“Select One” → “No” · saved answer/);
  assert.match(text, /Sign in: Sign in to this employer’s site in the Chrome window Career opened\./);
  assert.equal(await receipt.locator('img').count(), 1);
  assert.match(await receipt.locator('img').getAttribute('src'), /\/apply-runs\/[\w-]+\/picture\/1\/1$/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing is wider than the screen');
}

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: Submission activity lists the run and opens its receipt of what Career did`, async () => {
    const sub = 'dana-receipt-' + label; await ended(sub);
    const { page, context } = await open(sub, size, 'career-submissions.html', '');
    try {
      await page.locator('#assistActivity:not([hidden])').waitFor();
      const row = page.locator('.assist-row summary');
      assert.equal((await row.innerText()).replace(/\s+/g, ' '), 'Office Manager · Example Freight Co · Not seen yet');
      await press(size, row);
      await receiptReads(page);
    } finally { await context.close(); }
  });

  test(`${label}: the job page of a run Career did not see submitted says Not seen yet, offers I applied and shows the receipt`, async () => {
    const sub = 'dana-receipt-job-' + label; await ended(sub);
    const { page, context } = await open(sub, size, 'career-application.html', '?view=queue&application=7&step=review');
    try {
      await page.getByRole('heading', { name: 'Not seen yet' }).waitFor();
      assert.equal(await page.locator('#assistLine').innerText(), 'Mark it applied when you have.');
      assert.equal(await page.getByRole('button', { name: 'I applied', exact: true }).isVisible(), true);
      await receiptReads(page);
    } finally { await context.close(); }
  });
}
