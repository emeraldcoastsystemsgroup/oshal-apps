/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career 1.79.0, Answers to review in Chromium at 1440x900 and 412x915, for made-up people: the shipped page (tools/career-answers-review.html), My jobs' Didn't go through and Saved answers, every Career call going to Career's real routes over HTTP on the person's real store (the drafts written by the real drafting module with fixture inference), the kernel's card routes, the person and the counts stood in. Proved: the page lists the written question with the jobs waiting on it (the one on the computer marked), Career's draft read-only with the role it drew on and Approve, Edit then Approve, Write my own, Skip; plain questions and a check with an answer box; Edit then Approve saves the edited words, the paused job goes back in Fill in several, the card waiting on the computer is answered in the person's session without Keep, and the card says so; a plain answer the same; Skip and Review again; Didn't go through opens with Answers to review and its count, the tab carries "N to review" and the waiting job leads with Answer the question; Saved answers has Answer written questions without my review, off, which saves on with Undo; a person with nothing waiting reads Nothing to review. Every button is a 44px target (48px, full width on a phone) and nothing is wider than the screen.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { playwright, tools, ORIGIN, PHONE, DESKTOP } from './helpers/ux-page.mjs';
import { applyHarness, packageRoot } from './helpers/career-apply-fixture.mjs';

const require = createRequire(import.meta.url);
const API = '/api/career-hunter';
const uuid = (head, n) => head + '-0000-0000-0000-' + String(n).padStart(12, '0');
const python = process.env.JOBHUNTER_PYTHON || 'python3';
const WRITTEN = 'Tell us about your experience running an office for a growing team.';
const START = 'When can you start?', CHECK = 'What is 3 + 4?';
const ASKS = (...questions) => `Career asks you in Approvals: ${questions.join(' / ')}. Career types your answer in for you.`;
const DRAFT = 'As Office Manager at Example Freight Co I ran the front office for 40 people. I kept the office running for the whole team every day.';
const DRAFT_PY = 'import json,os\nfrom unittest.mock import patch\nfrom jobhunter import enrich, written_answers\n'
  + 'with patch.object(enrich,"complete",return_value=os.environ["FIXTURE_ANSWER"]):\n print(json.dumps(written_answers.run(os.environ["CH_ANSWER_DRAFTS"])))';
/** Where a reviewer can look at the page: the screenshots stay out of the repository. */
const SHOTS = process.env.CAREER_REVIEW_SHOTS || '';
const PLATFORM = process.env.OSHAL_KERNEL_PLATFORM || '';
let browser, h, cardIdOf, questionId;
const works = [], rows = new Map(), kernel = new Map();
before(async () => {
  browser = await playwright().chromium.launch({ headless: true });
  h = await applyHarness();
  ({ cardId: cardIdOf } = require('../lib/career-apply-sync.js')); ({ questionId } = require('../lib/career-apply-answers.js'));
  let tickets = 0;
  h.port.createTicket = async (input) => { h.port.created.push(input); return { ticketId: uuid('a8000000', ++tickets) }; };
  h.port.startTicket = async (ticketId, input) => {
    const id = uuid('b8000000', works.length + 1), task = JSON.parse(Buffer.from(input.files[0].bytes).toString('utf8'));
    works.push({ id, ticketId, task }); rows.set(id, { id, ticketId, state: 'queued', executor: 'orbit-apply-v1' });
    return { envelope: { id } };
  };
  h.port.getTicketWork = async (ticketId) => [...rows.values()].filter((row) => row.ticketId === ticketId).map(({ ticketId: _t, ...row }) => ({ ...row }));
  h.engineAsync = ({ sub, dir, paths, extra }) => {
    const out = spawnSync(python, ['-c', DRAFT_PY], { cwd: packageRoot, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, PYTHONPATH: join(packageRoot, 'engine'), JOBHUNTER_MULTIUSER: '1', OSHAL_USER_SUB: sub, JOBHUNTER_DATA: dir, JOBHUNTER_CORPUS_DB: paths.corpusDb,
        JOBHUNTER_USER_DB: paths.userDb, JOBHUNTER_CAREER_DB: join(dir, 'career_db.json'), ...extra, FIXTURE_ANSWER: JSON.stringify({ answer: DRAFT, evidence: ['R1'] }) } });
    assert.equal(out.status, 0, out.stderr);
    return { started: true };
  };
});
after(async () => { await browser?.close(); await h?.stop(); });

const workOf = (runId) => works.filter((work) => work.task.intentId === runId).at(-1);
const set = (work, patch) => rows.set(work.id, { ...rows.get(work.id), ...patch });
const sync = (sub, runId) => h.call('POST', '/apply-runs/' + runId + '/sync', {}, sub);
async function approveRun(sub, postingId) {
  const review = await h.call('GET', '/apply-review/' + postingId, null, sub);
  const runId = (await h.call('POST', '/apply-runs', { postingId, packetDigest: review.body.packetDigest, approved: true }, sub)).body.run.id;
  await h.call('POST', '/apply-runs/' + runId + '/bind', {}, sub); await h.call('POST', '/apply-runs/' + runId + '/start', {}, sub);
  return runId;
}
/** A run waiting on its cards now; the kernel's card route lists them for the person's own session. */
async function waiting(sub, postingId, ...questions) {
  const runId = await approveRun(sub, postingId);
  set(workOf(runId), { state: 'running', apply: { attempt: 1, state: 'waiting_for_you', reason: { kind: 'question', text: ASKS(...questions) } } });
  await sync(sub, runId);
  const list = kernel.get(sub) || [];
  for (const text of questions) {
    const id = questionId(text, 'textarea');
    list.push({ id: cardIdOf(runId, id), app: 'career-hunter', appName: 'Career', run: runId, ask: { question: text, questionId: id, options: [], slot: null }, answered: null });
  }
  kernel.set(sub, list);
  return runId;
}
async function paused(sub, postingId, text) {
  const runId = await approveRun(sub, postingId), work = workOf(runId);
  set(work, { state: 'completed' });
  h.port.accepted.set(work.id, { version: 2, intentId: runId, attempt: 1, requestDigest: work.task.requestDigest, outcome: 'paused',
    data: { reason: 'Paused: Career waited 30 minutes for you to answer its question. Nothing was submitted. Press Go on to start again.',
      questions: [{ text, answer: null, from: '', keep: false, card: cardIdOf(runId, questionId(text, 'textarea')) }], changes: [], pictures: [], uploads: [], handBacks: [] } });
  await sync(sub, runId);
  return runId;
}
/** A made-up person: job 7 waits on its written question on the computer, job 8 paused on it, job 9 paused on a start date, job 10 waits on a check. */
async function person(sub) {
  const someone = h.person(sub);
  for (const id of [8, 9, 10]) h.job(sub, id, { company: 'Sample Freight ' + id });
  await waiting(sub, 7, WRITTEN); await paused(sub, 8, WRITTEN); await paused(sub, 9, START); await waiting(sub, 10, CHECK);
  return someone;
}
const real = /^\/api\/career-hunter\/(answers-to-review|didnt-go-through|apply-review|apply-runs|apply-batch|saved-answers)(\/|$|\?)/;
async function open(sub, size, address) {
  const context = await browser.newContext({ ...size, locale: 'en-US', timezoneId: 'UTC' });
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== ORIGIN) return route.abort();
    if (p === `${API}/answers-to-review-ui`) return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(tools, 'career-answers-review.html')) });
    if (p === `${API}/saved-answers-ui`) return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(tools, 'career-saved-answers.html')) });
    if (p === `${API}/board-native` && url.searchParams.has('application')) return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(tools, 'career-application.html')) });
    if (p === `${API}/board-native`) return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(tools, 'career-job-lists.html')) });
    const asset = p.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
    if (asset && existsSync(join(tools, asset[1]))) return route.fulfill({ status: 200, contentType: asset[1].endsWith('.css') ? 'text/css' : 'application/javascript', body: readFileSync(join(tools, asset[1])) });
    if (real.test(p + url.search)) {
      const answer = await fetch(h.origin + p + url.search, { method: req.method(), headers: { 'content-type': 'application/json', 'x-test-person': sub }, body: req.postData() || undefined });
      return route.fulfill({ status: answer.status, contentType: answer.headers.get('content-type') || 'application/json', body: Buffer.from(await answer.arrayBuffer()) });
    }
    const shared = p.match(/^\/shared\/ui\/(css|js)\/([\w.-]+)$/);
    if (shared && PLATFORM && existsSync(join(PLATFORM, 'src/shared/ui', shared[1], shared[2]))) return route.fulfill({ status: 200, contentType: shared[1] === 'css' ? 'text/css' : 'application/javascript', body: readFileSync(join(PLATFORM, 'src/shared/ui', shared[1], shared[2])) });
    if (/^\/(shared|cockpit|ui)\//.test(p)) return route.fulfill({ status: 200, contentType: p.endsWith('.css') ? 'text/css' : 'application/javascript', body: '' });
    if (p === '/api/apply/cards') return json({ cards: (kernel.get(sub) || []).filter((card) => !card.answered), kept: [] });
    const answered = p.match(/^\/api\/apply\/cards\/([\w-]+)\/answer$/);
    if (answered) { const card = (kernel.get(sub) || []).find((one) => one.id === answered[1]); if (!card || req.headers()['x-oshal-apply-card'] !== '1') return json({ error: 'no such card' }, 404); card.answered = JSON.parse(req.postData()); return json({ status: 200, result: { said: 'Answered.' } }); }
    if (p === '/api/auth/user') return json({ authenticated: true, sub, tenant: 'tenant-1', principal_id: sub });
    if (p === '/api/guest/session') return json({ guest: false });
    if (p === `${API}/jobs/stats`) return json({ saved: 0, byStatus: [] });
    if (p === `${API}/jobs`) return json({ jobs: [], exhausted: true, exclusions: [], home: { known: true, label: 'Springfield, IL', radiusMiles: 50, line: '', settingsUrl: `${API}/settings` } });
    if (p === `${API}/resume/state`) return json({ hasResume: true, roles: 3, indexing: false });
    if (p === '/api/apply-operator/workers') return json({ workers: [], selectionConfigured: false, available: false });
    return json({});
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}${address}`, { waitUntil: 'load' });
  return { page, context };
}
const press = (size, target) => (size === PHONE ? target.tap() : target.click());
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ').trim();
const heights = (locator) => locator.evaluateAll((list) => list.map((el) => Math.round(el.getBoundingClientRect().height)));
async function shot(page, name) { if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: true }); }

/** The page as it opens: the count, the switch's line, the written card with its draft, the plain cards, the layout. */
async function listed(page, size, label) {
  const written = page.locator('[data-ar-section="written"][data-ar-kind="written"]');
  await written.locator('textarea[readonly]').waitFor();
  assert.equal(await page.title(), 'Answers to review');
  assert.equal(await text(page.locator('#arCount')), '3', 'three questions wait');
  assert.match(await text(page.locator('#arMode')), /^Written questions wait for your review\./);
  assert.equal(await text(written.locator('.ar-q')), WRITTEN);
  assert.deepEqual((await written.locator('.ar-jobs a').evaluateAll((list) => list.map((el) => el.textContent))).map((one) => one.replace(/\s+/g, ' ').trim()).sort(),
    ['Example Freight Co · Office Manager On your computer now', 'Sample Freight 8 · Office Manager']);
  assert.equal(await written.locator('textarea').inputValue(), DRAFT, 'Career’s draft, read-only');
  assert.equal(await text(written.locator('[data-ar-from]')), 'Drawn from: Office Manager at Example Freight Co');
  assert.deepEqual(await written.locator('.ar-actions button').allInnerTexts(), ['Approve', 'Edit then Approve', 'Write my own', 'Skip']);
  const plain = page.locator('[data-ar-section="plain"]');
  assert.deepEqual((await plain.locator('.ar-q').allInnerTexts()).sort(), [CHECK, START]);
  assert.equal(await page.locator('[data-ar-section="plain"][data-ar-kind="check"] .ar-kind').innerText(), 'A check that you are a person');
  await shot(page, `answers-review-${label}`);
  const targets = await heights(page.locator('.ar-actions button, .ar-jobs a, .back a'));
  assert.ok(targets.every((height) => height >= 44), `every link and button is a 44px target: ${targets}`);
  if (size === PHONE) {
    const widths = await written.locator('.ar-actions button').evaluateAll((list) => list.map((el) => Math.round(el.getBoundingClientRect().width)));
    const inner = await written.evaluate((el) => Math.round(el.clientWidth - 28));
    assert.ok(widths.every((width) => width >= inner - 2), `full-width buttons on a phone: ${widths} of ${inner}`);
    assert.ok((await heights(written.locator('.ar-actions button'))).every((height) => height >= 48));
  }
  assert.ok(await fits(page), 'nothing is wider than the screen');
}
/** Edit then Approve on the written card: the edited words are kept, the paused job goes back, the card on the computer is answered. */
async function approvedWritten(page, size, sub, rowan) {
  const written = page.locator('[data-ar-section="written"][data-ar-kind="written"]'), edited = DRAFT + ' I also trained two new coordinators.';
  await press(size, written.getByRole('button', { name: 'Edit then Approve' }));
  const box = written.locator('textarea');
  assert.equal(await box.getAttribute('readonly'), null, 'the draft opens for editing');
  assert.deepEqual(await written.locator('.ar-actions button').allInnerTexts(), ['Approve', 'Cancel']);
  await box.fill(edited);
  await press(size, written.getByRole('button', { name: 'Approve' }));
  await written.locator('.ar-done').waitFor();
  const said = await text(written.locator('.ar-done'));
  assert.match(said, /^Saved to your Saved answers\./);
  assert.match(said, /1 job went back in Fill in several: Sample Freight 8 · Office Manager\./);
  assert.match(said, /Career gave your answer to the form waiting on your computer\./);
  const card = (kernel.get(sub) || []).find((one) => one.ask.question === WRITTEN);
  assert.deepEqual(card.answered, { answer: edited, keep: false }, 'the card on the computer is answered, without Keep');
  const saved = JSON.parse(readFileSync(join(rowan.dir, 'apply_profile.json'), 'utf8')).answers.find((item) => item.text === WRITTEN);
  assert.equal(saved.value, edited);
  assert.deepEqual(JSON.parse(readFileSync(join(rowan.dir, 'apply-batch.json'), 'utf8')).entries.map((entry) => entry.postingId), [8]);
}
/** A plain answer is kept and its job goes back; a check is skipped and reviewed again. */
async function answeredPlain(page, size) {
  const plain = page.locator('[data-ar-section="plain"]'), start = plain.filter({ hasText: START });
  await start.locator('textarea').fill('Two weeks after an offer.');
  await press(size, start.getByRole('button', { name: 'Approve' }));
  await start.locator('.ar-done').waitFor();
  assert.match(await text(start.locator('.ar-done')), /^Saved to your Saved answers\. 1 job went back in Fill in several: Sample Freight 9 · Office Manager\./);
  await press(size, plain.filter({ hasText: CHECK }).getByRole('button', { name: 'Skip' }));
  await page.locator('#skippedSection').waitFor({ state: 'visible' });
  assert.equal(await text(page.locator('#skippedSection summary')), 'Skipped (1)');
  await press(size, page.locator('#skippedSection summary'));
  await press(size, page.locator('#skipped').getByRole('button', { name: 'Review again' }));
  await plain.filter({ hasText: CHECK }).locator('textarea').waitFor();
  assert.ok(await fits(page));
}

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: Answers to review lists each question with its jobs and Career’s draft, and Approve saves it and puts the jobs back`, async () => {
    const sub = `rowan-review-${label}`, rowan = await person(sub);
    const { page, context } = await open(sub, size, `${API}/answers-to-review-ui`);
    try {
      await listed(page, size, label);
      await approvedWritten(page, size, sub, rowan);
      await answeredPlain(page, size);
    } finally { await context.close(); }
  });

  test(`${label}: Didn’t go through opens with Answers to review and its count, and the waiting job leads with Answer the question`, async () => {
    const sub = `rowan-didnt-${label}`;
    await person(sub);
    const { page, context } = await open(sub, size, `${API}/board-native?view=didnt-go-through`);
    try {
      await page.locator('.dg-review').waitFor();
      assert.equal(await text(page.locator('.dg-review-link')), 'Answers to review 3');
      assert.equal(await page.locator('.dg-review-link').getAttribute('href'), `${API}/answers-to-review-ui`);
      assert.match(await text(page.locator('.dg-review p')), /^3 questions only you can answer hold up 4 jobs\./);
      await page.waitForFunction(() => /3 to review/.test(document.querySelector('a[role=tab][data-stage="didnt-go-through"]')?.textContent || ''));
      const row = page.locator('[data-dg-row="8"]');
      await row.waitFor();
      assert.deepEqual(await row.locator('.row-actions .btn').allInnerTexts(), ['Answer the question', 'Go on', 'Open the job'], 'Answer the question leads; Go on would ask again');
      assert.match(await row.locator('.row-actions .btn').first().getAttribute('class'), /\bprimary\b/);
      assert.equal(await row.locator('.row-actions .btn.primary').count(), 1, 'one filled button');
      assert.match(await text(row.locator('.dg-next')), new RegExp('^What to do next Answer “' + WRITTEN.replace(/[.?]/g, '\\$&') + '” on Answers to review'));
      await shot(page, `didnt-go-through-${label}`);
      assert.ok((await heights(page.locator('.dg-review-link'))).every((height) => height >= 44));
      assert.ok(await fits(page));
    } finally { await context.close(); }
  });

  test(`${label}: a job's page says when the job waits on a question only the person can answer, with Answers to review`, async () => {
    const sub = `rowan-job-${label}`;
    await person(sub);
    const { page, context } = await open(sub, size, `${API}/board-native?view=queue&application=8`);
    try {
      const note = page.locator('#answersReviewNote');
      await note.waitFor({ state: 'visible' });
      assert.equal(await text(note.locator('p').first()), `This job is waiting for your answer to a question only you can answer: “${WRITTEN}”.`);
      assert.equal(await note.getByRole('link', { name: 'Answers to review' }).getAttribute('href'), `${API}/answers-to-review-ui`);
      assert.ok((await heights(note.locator('.btn'))).every((height) => height >= 44));
      assert.ok(await fits(page));
    } finally { await context.close(); }
    const other = await open(sub, size, `${API}/board-native?view=queue&application=7`);
    try {
      await other.page.locator('#answersReviewNote').waitFor({ state: 'visible' });
      const quiet = await open(`${sub}-none`, size, `${API}/board-native?view=queue&application=7`);
      try { await quiet.page.waitForTimeout(500); assert.equal(await quiet.page.locator('#answersReviewNote').isVisible(), false, 'a job waiting on nothing has no line'); }
      finally { await quiet.context.close(); }
    } finally { await other.context.close(); }
  });

  test(`${label}: Saved answers has Answer written questions without my review, off, saved on with Undo; nothing waiting reads Nothing to review`, async () => {
    const sub = `rowan-switch-${label}`;
    h.person(sub);
    const { page, context } = await open(sub, size, `${API}/saved-answers-ui`);
    try {
      const toggle = page.getByRole('switch', { name: /Answer written questions without my review/ });
      await toggle.waitFor();
      assert.equal(await toggle.isChecked(), false, 'off by default');
      await press(size, toggle);
      await page.locator('#writtenSaved', { hasText: 'Saved.' }).waitFor();
      assert.equal(await toggle.isChecked(), true);
      assert.equal(await page.locator('#writtenUndo').isVisible(), true, 'Undo');
      await shot(page, `saved-answers-${label}`);
      assert.ok(await fits(page));
      await page.goto(`${ORIGIN}${API}/answers-to-review-ui`, { waitUntil: 'load' });
      await page.locator('#empty').waitFor({ state: 'visible' });
      assert.equal(await text(page.locator('#empty h2')), 'Nothing to review');
      assert.match(await text(page.locator('#arMode')), /^Career answers written questions without your review\./);
      assert.ok(await fits(page));
    } finally { await context.close(); }
  });
}
