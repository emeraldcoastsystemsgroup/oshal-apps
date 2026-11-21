/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.69.0 (career-hunter backlog, "The Discover swipe deck as the Job Board's phone layout"): the shipped My jobs page in Chromium, served by Career's real compiled surface routes and reading and writing through its real compiled board routes over a real SQLite corpus and store (tests/helpers/career-match-deck-fixture.mjs), as a made-up person. At 412x915 with touch, New matches is the deck: one card with the employer, the title, the place, pay only when the posting states it and the fit; Pass and Save by button and by swipe write what the board's own buttons write; Undo reverses the last action in the store and leaves a job that has moved on alone; More opens the job's details and writes nothing; the buttons are 44px targets above the bottom bar, keep keyboard focus and are the only tab stops of the deck besides the lead card's title; the wait for the list, a list that cannot be read, a Pass that cannot be sent, a Save that cannot be confirmed or that Career refuses while it is working, a stage with no matches and the end of the deck each say what happened and what to do; a deck longer than one page shows every job once. /api/career-hunter/mobile opens the deck. At 1440x900 the stage is the list it was, with Save and Not interested on each row, and /mobile opens that list. (CAREER_DECK_SHOTS=<folder> also keeps a picture of each state; the gate leaves it unset.)
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';
import { deckHarness, inventedJobs, packageRoot, PERSON } from './helpers/career-match-deck-fixture.mjs';

const SHOTS = process.env.CAREER_DECK_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, name + '.png') }) : null);
const MATCHES = '/api/career-hunter/board-native?view=matches';

let browser, career;
before(async () => { career = await deckHarness({ page: true }); browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await career?.stop(); });
beforeEach(() => { career.state.failJobs = false; career.state.holdJobs = null; career.seed(inventedJobs(6)); });

/** Open an address of Career as the made-up person. */
async function open(size, address = MATCHES) {
  const context = await browser.newContext({ ...size, locale: 'en-US', timezoneId: 'UTC' });
  await context.addCookies([{ name: 'who', value: PERSON, url: career.origin }]);
  const page = await context.newPage(), errors = [], writes = [];
  page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (request.method() === 'POST') writes.push(new URL(request.url()).pathname + ' ' + request.postData()); });
  await page.goto(career.origin + address, { waitUntil: 'load' });
  return { page, context, errors, writes };
}
const lead = (page) => page.locator('.match-card.lead');
const leadId = async (page) => Number(await lead(page).getAttribute('data-deck-id'));
const said = (page, words) => page.locator('#actionState').getByText(words).waitFor();
const press = (page, name) => page.getByRole('button', { name, exact: true }).click();
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
/** One finger across the lead card, through the browser's own touch input. */
async function swipe(page, context, dx) {
  const wire = await context.newCDPSession(page), box = await lead(page).locator('.meta').boundingBox();
  const from = [dx > 0 ? box.x + 30 : box.x + box.width - 30, box.y + box.height / 2];
  await wire.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1] }] });
  for (let i = 1; i <= 12; i++) { await wire.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from[0] + dx * i / 12, y: from[1] }] }); await page.waitForTimeout(12); }
  await wire.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('412: New matches is the deck: one card with employer, title, place, pay when stated and fit, over four reachable buttons', { timeout: 40000 }, async () => {
  const { page, context, errors, writes } = await open(PHONE);
  try {
    await page.locator('.cf-bottombar:not([hidden])').waitFor(); await lead(page).waitFor();
    assert.equal(await leadId(page), 101, 'the newest match leads');
    const card = lead(page), words = await card.innerText();
    assert.match(words, /Invented Employer 01/); assert.match(words, /Staff Site Reliability Engineer, Developer Infrastructure and Tooling/);
    assert.match(words, /Remote - US/); assert.match(words, /\$120,000–\$150,000 \/ year/); assert.match(words, /AI fit 95/);
    assert.match(words, /A made-up reason job 101 fits\./);
    assert.equal(await page.locator('.match-card.lead').count(), 1, 'one job at a time');
    assert.equal(await page.locator('.job-row').count(), 0, 'and no list under it');
    const bar = await page.locator('.cf-bottombar').boundingBox(), view = page.viewportSize();
    for (const name of ['Undo', 'Pass', 'Save', 'More']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      assert.ok(box.height >= 44 && box.width >= 44, `${name} is a 44px target (${box.width}x${box.height})`);
      assert.ok(box.x >= 0 && box.x + box.width <= view.width && box.y >= 0 && box.y + box.height <= bar.y, `${name} is on the screen above the bottom bar`);
    }
    const pass = await page.getByRole('button', { name: 'Pass', exact: true }).boundingBox(), save = await page.getByRole('button', { name: 'Save', exact: true }).boundingBox();
    assert.ok(pass.width >= 96 && save.width >= 96, 'Pass and Save are the two wide buttons');
    assert.ok((await card.locator('.job-title').boundingBox()).height >= 44, 'the title is a 44px target');
    assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true, 'nothing to undo yet');
    const cardBox = await card.boundingBox();
    assert.ok(cardBox.x >= 0 && cardBox.x + cardBox.width <= view.width, 'the card is inside the screen');
    assert.ok(await noSideways(page), 'nothing is wider than the screen');
    await shot(page, 'deck-412-card');
    // The second job states no pay: the card says nothing about pay rather than that an estimate is unavailable.
    await press(page, 'Pass'); await said(page, /^Removed: /);
    assert.equal(await leadId(page), 102);
    const second = await lead(page).innerText();
    assert.match(second, /Office Manager/); assert.match(second, /Bend, OR/);
    assert.doesNotMatch(second, /Pay estimate unavailable|\$/);
    assert.ok(await noSideways(page));
    assert.deepEqual(writes, ['/api/career-hunter/jobs/101/status {"status":"dismissed"}']);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('412: Pass and Save write what the board writes, and Undo puts each job back in the store and on top', { timeout: 40000 }, async () => {
  const { page, context, errors, writes } = await open(PHONE);
  try {
    await lead(page).waitFor();
    await press(page, 'Pass'); await said(page, 'Removed: Staff Site Reliability Engineer, Developer Infrastructure and Tooling at Invented Employer 01.');
    assert.equal(career.signals()[101], 'dismissed'); assert.equal(await leadId(page), 102);
    await page.locator('#careerStages [data-stage="matches"] .n').getByText('5', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).isEnabled(), true, 'Undo is there after an action');
    await press(page, 'Undo'); await said(page, 'Brought back: Staff Site Reliability Engineer, Developer Infrastructure and Tooling at Invented Employer 01.');
    assert.equal(career.signals()[101], 'new', 'the store has the job as a new match again'); assert.equal(await leadId(page), 101);
    await page.locator('#careerStages [data-stage="matches"] .n').getByText('6', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true, 'one action, one undo');

    await press(page, 'Save'); await said(page, /^Saved: Staff Site Reliability Engineer/);
    assert.deepEqual(career.favorites(), [101]); assert.equal(career.signals()[101], 'new'); assert.equal(await leadId(page), 102);
    await page.locator('#careerStages [data-stage="saved"] .n').getByText('1', { exact: true }).waitFor();
    await shot(page, 'deck-412-saved');
    await press(page, 'Undo'); await said(page, /^Unsaved: Staff Site Reliability Engineer/);
    assert.deepEqual(career.favorites(), [], 'the store no longer has it saved'); assert.equal(await leadId(page), 101);
    assert.deepEqual(writes, [
      '/api/career-hunter/jobs/101/status {"status":"dismissed"}', '/api/career-hunter/jobs/101/status {"status":"new"}',
      '/api/career-hunter/jobs/101/status {"favorite":true}', '/api/career-hunter/jobs/101/status {"favorite":false}',
    ], 'four writes, all to the board\'s own route');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('412: a swipe does what its button does: right saves, left passes, and Undo reverses the swipe', { timeout: 40000 }, async () => {
  const { page, context, errors } = await open(PHONE);
  try {
    await lead(page).waitFor();
    await swipe(page, context, 230); await said(page, /^Saved: /);
    assert.deepEqual(career.favorites(), [101]); assert.equal(await leadId(page), 102);
    await swipe(page, context, -230); await said(page, /^Removed: Office Manager/);
    assert.equal(career.signals()[102], 'dismissed'); assert.equal(await leadId(page), 103);
    await press(page, 'Undo'); await said(page, /^Brought back: Office Manager/);
    assert.equal(career.signals()[102], 'new'); assert.equal(await leadId(page), 102);
    await press(page, 'Undo'); await said(page, /^Unsaved: /);
    assert.deepEqual(career.favorites(), []); assert.equal(await leadId(page), 101);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('412: More opens the job\'s details and changes nothing; closing it returns to the same card', { timeout: 40000 }, async () => {
  const { page, context, errors, writes } = await open(PHONE);
  try {
    await lead(page).waitFor();
    await press(page, 'More');
    const sheet = page.locator('dialog[open]');
    await sheet.getByRole('heading', { name: 'Staff Site Reliability Engineer, Developer Infrastructure and Tooling' }).waitFor();
    await sheet.getByRole('heading', { name: 'Fit assessment' }).waitFor();
    assert.match(await sheet.innerText(), /The made-up description of job 101\./);
    assert.match(await sheet.innerText(), /Invented Employer 01/);
    const close = sheet.getByRole('button', { name: 'Close posting' });
    assert.ok((await close.boundingBox()).height >= 44);
    assert.ok(await noSideways(page));
    await shot(page, 'deck-412-more');
    await close.click();
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    assert.equal(await leadId(page), 101);
    assert.deepEqual(writes, [], 'reading a job writes nothing');
    assert.deepEqual(career.signals()[101], 'new'); assert.deepEqual(career.favorites(), []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('412: the buttons work from the keyboard and keep their focus; the card under the lead one is not a tab stop', { timeout: 40000 }, async () => {
  const { page, context, errors } = await open(PHONE);
  try {
    await lead(page).waitFor();
    const focused = () => page.evaluate(() => document.activeElement?.dataset.deckAct || document.activeElement?.dataset.posting || document.activeElement?.tagName);
    await page.getByRole('button', { name: 'Save', exact: true }).focus();
    await page.keyboard.press('Enter'); await said(page, /^Saved: Staff Site/);
    assert.equal(await focused(), 'save', 'Save still has the focus after it acted');
    await page.keyboard.press('Enter'); await said(page, /^Saved: Office Manager/);
    assert.deepEqual(career.favorites(), [101, 102]);
    await page.keyboard.press('Shift+Tab'); assert.equal(await focused(), 'pass');
    await page.keyboard.press('Space'); await said(page, /^Removed: Platform Engineer/);
    assert.equal(career.signals()[103], 'dismissed'); assert.equal(await focused(), 'pass');
    await page.keyboard.press('Shift+Tab'); assert.equal(await focused(), 'undo');
    await page.keyboard.press('Enter'); await said(page, /^Brought back: Platform Engineer/);
    assert.equal(career.signals()[103], 'new');
    // From the hint down, the tab stops are the lead card's title and the four buttons: never the title of the card beneath.
    const stops = await page.evaluate(() => [...document.querySelectorAll('.match-deck button, #deckActionButtons button')].filter((el) => !el.closest('[inert]')).map((el) => el.dataset.posting || el.dataset.deckAct));
    assert.deepEqual(stops, ['103', 'undo', 'pass', 'save', 'more']);
    assert.equal(await page.locator('.match-card.peek').getAttribute('aria-hidden'), 'true');
    assert.equal(await lead(page).getAttribute('aria-label'), 'Platform Engineer at Invented Employer 03');
    assert.equal(await page.locator('#actionState').getAttribute('role'), 'status');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('412: the end of the deck says what was done and what to do next, and Undo is still there', { timeout: 40000 }, async () => {
  career.seed(inventedJobs(3));
  const { page, context, errors } = await open(PHONE);
  try {
    await lead(page).waitFor();
    await press(page, 'Save'); await said(page, /^Saved: /);
    await press(page, 'Pass'); await said(page, /^Removed: Office Manager/);
    await press(page, 'Pass'); await said(page, /^Removed: Platform Engineer/);
    const end = page.locator('[data-deck-state="end"]'); await end.waitFor();
    await end.getByRole('heading', { name: 'That is every match for now' }).waitFor();
    assert.match(await end.innerText(), /You saved 1 and passed on 2\. Your saved jobs are in Saved, where you prepare an application\. New matches appear here as Career finds them\. Undo brings back the last one\./);
    const saved = end.getByRole('link', { name: 'Open Saved' });
    assert.equal(await saved.getAttribute('href'), '/api/career-hunter/board-native?view=saved');
    for (const target of [saved, end.getByRole('link', { name: 'Find jobs' }), page.getByRole('button', { name: 'Undo', exact: true })]) assert.ok((await target.boundingBox()).height >= 44);
    assert.equal(await page.getByRole('heading', { name: 'No matches yet' }).count(), 0, 'a finished deck is not an empty one');
    for (const name of ['Pass', 'Save', 'More']) assert.equal(await page.getByRole('button', { name, exact: true }).isDisabled(), true, name + ' has no job to act on');
    assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).isEnabled(), true);
    assert.ok(await noSideways(page));
    await shot(page, 'deck-412-end');
    await press(page, 'Undo'); await said(page, /^Brought back: Platform Engineer/);
    assert.equal(await leadId(page), 103); assert.equal(career.signals()[103], 'new');
    assert.equal(await end.count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('412: Undo leaves a job that has moved on where it is, and says where that is', { timeout: 40000 }, async () => {
  const { page, context, errors, writes } = await open(PHONE);
  try {
    await lead(page).waitFor();
    await press(page, 'Save'); await said(page, /^Saved: /);
    career.mark(101, 'promoted'); // prepared from another screen since
    await press(page, 'Undo');
    await said(page, 'Not undone: Staff Site Reliability Engineer, Developer Infrastructure and Tooling at Invented Employer 01 is in Getting ready now, so it was left there.');
    assert.equal(career.signals()[101], 'promoted'); assert.deepEqual(career.favorites(), [101], 'still saved and still being prepared');
    assert.equal(await leadId(page), 102, 'and it did not come back to the deck');
    assert.deepEqual(writes, ['/api/career-hunter/jobs/101/status {"favorite":true}'], 'Undo read the job and wrote nothing');
    assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('412: a Pass that cannot be sent comes back; a Save that cannot be confirmed stays away until Undo checks it', { timeout: 40000 }, async () => {
  const { page, context, writes } = await open(PHONE);
  try {
    await lead(page).waitFor();
    await page.route('**/api/career-hunter/jobs/101/status', (route) => route.abort());
    await press(page, 'Pass');
    await said(page, 'Not passed: Career could not be reached. Staff Site Reliability Engineer, Developer Infrastructure and Tooling at Invented Employer 01 is back on top.');
    assert.equal(await leadId(page), 101); assert.equal(career.signals()[101], 'new');
    assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true, 'a Pass that never left has nothing to undo');
    // No answer came back, so Career cannot say whether the job was saved: the card stays away and Undo is how to find out.
    await press(page, 'Save');
    await said(page, 'Could not confirm the save: Career could not be reached. Press Undo to check it.');
    assert.equal(await leadId(page), 102); assert.deepEqual(career.favorites(), []);
    assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).isEnabled(), true);
    await page.unroute('**/api/career-hunter/jobs/101/status');
    const sent = writes.length;
    await press(page, 'Undo');
    await said(page, 'Brought back: Staff Site Reliability Engineer, Developer Infrastructure and Tooling at Invented Employer 01. It had not been saved.');
    assert.equal(await leadId(page), 101); assert.equal(writes.length, sent, 'Undo read the job and wrote nothing');
    await press(page, 'Save'); await said(page, /^Saved: /);
    assert.deepEqual(career.favorites(), [101], 'the same press works once Career can be reached');
  } finally { await context.close(); }
});

test('412: Career\'s busy refusal of a Save brings the card back, and one that arrives after the list was replaced does not', { timeout: 40000 }, async () => {
  const { page, context } = await open(PHONE);
  try {
    await lead(page).waitFor();
    let release; const held = new Promise((done) => { release = done; });
    await page.route('**/api/career-hunter/jobs/101/status', async (route) => { await held; await route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"career_run_in_progress"}' }); });
    await press(page, 'Save');
    await page.waitForFunction(() => document.querySelector('.match-card.lead')?.dataset.deckId === '102');
    release();
    await said(page, 'Not saved: Career is working on your account. Try saving again when it finishes. Staff Site Reliability Engineer, Developer Infrastructure and Tooling at Invented Employer 01 is back on top.');
    assert.equal(await leadId(page), 101); assert.deepEqual(career.favorites(), []);
    assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true);
    // The same refusal, arriving after the person searched: the job is not put into the searched list.
    let later; const waiting = new Promise((done) => { later = done; });
    await page.unroute('**/api/career-hunter/jobs/101/status');
    await page.route('**/api/career-hunter/jobs/101/status', async (route) => { await waiting; await route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"career_run_in_progress"}' }); });
    await press(page, 'Save');
    await page.waitForFunction(() => document.querySelector('.match-card.lead')?.dataset.deckId === '102');
    await press(page, 'Filters'); await page.locator('#q').fill('Operations Lead');
    await page.locator('#keywordSearch button[type="submit"]').click(); await press(page, 'Done');
    await page.waitForFunction(() => document.querySelector('.match-card.lead')?.dataset.deckId === '104');
    later();
    await said(page, /^Not saved: Career is working on your account\. Try saving again when it finishes\.$/);
    await page.waitForFunction(() => document.querySelector('.match-card.lead')?.dataset.deckId === '104');
    assert.equal(await page.locator('.match-card[data-deck-id="101"]').count(), 0, 'the refused job is not in the searched list');
    assert.deepEqual(career.favorites(), []);
  } finally { await context.close(); }
});

test('412: while the list is read the deck says so, and a list that cannot be read says so with Try again', { timeout: 40000 }, async () => {
  let release;
  career.state.holdJobs = new Promise((done) => { release = done; });
  const waiting = await open(PHONE);
  try {
    const loading = waiting.page.locator('[data-deck-state="loading"]'); await loading.waitFor();
    assert.match(await loading.innerText(), /Loading your matches…/);
    assert.equal(await waiting.page.locator('#requestState').innerText(), 'Loading jobs…', 'the status line says it for a screen reader');
    assert.equal(await waiting.page.getByRole('heading', { name: 'No matches yet' }).count(), 0, 'an unanswered read is not an empty list');
    await shot(waiting.page, 'deck-412-loading');
    release(); career.state.holdJobs = null;
    await lead(waiting.page).waitFor(); assert.equal(await loading.count(), 0);
  } finally { release?.(); await waiting.context.close(); }

  career.state.failJobs = true;
  const { page, context, errors } = await open(PHONE);
  try {
    const alert = page.getByRole('alert'); await alert.waitFor();
    assert.match(await alert.innerText(), /Couldn’t load your matches\s+Career could not read your matches just now\. Nothing you saved or passed is lost\. Try again in a moment\./);
    const again = alert.getByRole('button', { name: 'Try again' });
    assert.ok((await again.boundingBox()).height >= 44);
    assert.equal(await page.locator('.match-card.lead').count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'No matches yet' }).count(), 0, 'a failed read is not an empty list');
    assert.ok(await noSideways(page));
    await shot(page, 'deck-412-error');
    career.state.failJobs = false;
    await again.click();
    await lead(page).waitFor(); assert.equal(await leadId(page), 101);
    assert.equal(await alert.count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('412: with no matches at all the stage says so and offers Find jobs, with no card and no buttons', { timeout: 40000 }, async () => {
  career.seed([]);
  const { page, context, errors } = await open(PHONE);
  try {
    const empty = page.locator('#list .ck-empty'); await empty.waitFor();
    await empty.getByRole('heading', { name: 'No matches yet' }).waitFor();
    assert.match(await empty.innerText(), /Matches against your résumé appear here\./);
    const find = empty.getByRole('link', { name: 'Find jobs' });
    assert.equal(await find.getAttribute('href'), '/api/career-hunter/search-ui'); assert.ok((await find.boundingBox()).height >= 44);
    assert.equal(await page.locator('.match-card, [data-deck-state], [data-deck-act]').count(), 0, 'an empty stage is not a finished deck');
    assert.equal(await page.locator('#matchActionDock').getAttribute('data-deck-active'), null);
    assert.ok(await noSideways(page));
    await shot(page, 'deck-412-empty');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('412: a deck longer than one page shows every job once and then ends', { timeout: 90000 }, async () => {
  const jobs = inventedJobs(30); career.seed(jobs);
  const { page, context, errors } = await open(PHONE, MATCHES + '&per=25');
  try {
    await lead(page).waitFor();
    const seen = [];
    for (let i = 0; i < jobs.length; i++) {
      const id = await leadId(page); seen.push(id);
      await press(page, i % 3 ? 'Pass' : 'Save');
      await page.waitForFunction((was) => document.querySelector('.match-card.lead')?.dataset.deckId !== String(was) || document.querySelector('[data-deck-state="end"]'), id);
      if (i < jobs.length - 1) await lead(page).waitFor();
    }
    assert.equal(new Set(seen).size, 30, 'no job was shown twice');
    assert.deepEqual([...seen].sort((a, b) => a - b), jobs.map((job) => job.id), 'and none was skipped');
    await page.locator('[data-deck-state="end"]').getByText('You saved 10 and passed on 20.').waitFor();
    assert.equal(career.favorites().length, 10);
    assert.equal(Object.values(career.signals()).filter((status) => status === 'dismissed').length, 20);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('412: /api/career-hunter/mobile opens the deck on New matches', { timeout: 40000 }, async () => {
  const { page, context, errors } = await open(PHONE, '/api/career-hunter/mobile');
  try {
    await page.waitForURL(/\/api\/career-hunter\/board-native\?.*view=matches/);
    await lead(page).waitFor(); assert.equal(await leadId(page), 101);
    assert.equal(await page.locator('#careerStages [aria-selected="true"]').innerText().then((text) => text.replace(/\s*\d+$/, '')), 'New matches');
    await page.getByRole('button', { name: 'Save', exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('1440: New matches is the list it was, with Save and Not interested on every row and no deck', { timeout: 40000 }, async () => {
  const { page, context, errors, writes } = await open(DESKTOP);
  try {
    await page.locator('.job-row[data-job-id="101"]').waitFor();
    assert.deepEqual(await page.locator('.job-row').evaluateAll((rows) => rows.map((row) => Number(row.dataset.jobId))), [101, 102, 103, 104, 105, 106]);
    assert.equal(await page.locator('.match-card, .match-deck, [data-deck-state]').count(), 0, 'no card');
    assert.equal(await page.locator('[data-deck-act]').count(), 0, 'no deck buttons');
    assert.equal(await page.locator('#matchActionDock').getAttribute('data-deck-active'), null);
    for (const row of await page.locator('.job-row').all()) {
      assert.deepEqual(await row.locator('.row-actions button').allInnerTexts(), ['Save', 'Not interested']);
    }
    const first = page.locator('.job-row[data-job-id="101"]');
    assert.match(await first.innerText(), /Staff Site Reliability Engineer, Developer Infrastructure and Tooling\s+Invented Employer 01\s+\$120,000–\$150,000 \/ year/);
    assert.match(await first.innerText(), /AI fit 95/); assert.match(await first.innerText(), /Posted 2026-11-28/);
    assert.match(await page.locator('.job-row[data-job-id="102"]').innerText(), /Pay estimate unavailable/, 'the list says what it said');
    for (const id of ['keywordSearch', 'searchModes', 'filters']) assert.equal(await page.locator('#' + id).isVisible(), true, id);
    assert.equal(await page.locator('#requestState').innerText(), '6 shown');
    assert.match(await page.locator('#pager').innerText(), /Showing 1–6 · End of this view/);
    await shot(page, 'matches-1440-list');
    await first.getByRole('button', { name: 'Save', exact: true }).click();
    await first.getByRole('button', { name: 'Saved', exact: true }).waitFor();
    assert.deepEqual(career.favorites(), [101]);
    assert.deepEqual(writes, ['/api/career-hunter/jobs/101/status {"favorite":true}']);
    assert.ok(await noSideways(page));
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('1440: /api/career-hunter/mobile opens the same list, and a phone-width window turns it into the deck and back', { timeout: 40000 }, async () => {
  const { page, context, errors } = await open(DESKTOP, '/api/career-hunter/mobile');
  try {
    await page.waitForURL(/\/api\/career-hunter\/board-native\?.*view=matches/);
    await page.locator('.job-row[data-job-id="101"]').waitFor();
    assert.equal(await page.locator('.match-card').count(), 0);
    await page.setViewportSize({ width: 412, height: 915 });
    await lead(page).waitFor(); assert.equal(await page.locator('.job-row').count(), 0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.job-row[data-job-id="101"]').waitFor();
    assert.equal(await page.locator('.match-card, [data-deck-act]').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('a link that names the old Mobile screen opens the Job Board on New matches', () => {
  const sent = [], frame = { location: { href: 'http://career.fixture.test/api/career-hunter/home', origin: 'http://career.fixture.test' }, sessionStorage: { getItem: () => null }, addEventListener() {}, removeEventListener() {} };
  frame.parent = { document: { querySelectorAll: () => [{ getAttribute: () => 'tool-career-board' }] }, location: { search: '' }, postMessage: (message, origin) => sent.push({ message, origin }) };
  vm.runInNewContext(readFileSync(path.join(packageRoot, 'tools/career-job-actions.js'), 'utf8'), { window: frame, URL, URLSearchParams, fetch: () => { throw Error('no request is made'); }, setTimeout, clearTimeout });
  frame.CareerJobActions.navigate('career-mobile', '/api/career-hunter/mobile');
  // The message is made in the page's own realm; compare what it carries.
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ message: { type: 'app-navigate', tool: 'career-board', query: 'view=matches' }, origin: 'http://career.fixture.test' }]);
  // On its own, outside a frame, the address itself is opened, and the route hands it on.
  const top = { location: { href: 'http://career.fixture.test/api/career-hunter/home', origin: 'http://career.fixture.test' } }; top.parent = top;
  vm.runInNewContext(readFileSync(path.join(packageRoot, 'tools/career-job-actions.js'), 'utf8'), { window: top, URL, URLSearchParams });
  top.CareerJobActions.navigate('career-mobile', '/api/career-hunter/mobile');
  assert.equal(top.location.href, '/api/career-hunter/mobile');
});
