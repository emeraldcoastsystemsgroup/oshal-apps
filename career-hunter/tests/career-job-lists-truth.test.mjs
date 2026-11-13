/**
 * CHANGE LOG
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Saved Remove writes a durable dismissal and keeps drafts and application history.
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Job Board tells the truth without a résumé, shows the inbox's newest reply on a job's row, and uses one word for saving (judge's report 2026-11-11, changes 3 and 5). The shipped tools/career-job-lists.html in Chromium over fixture answers, at 1440x900 and 412x915: with no résumé New matches says "Add your résumé to get matches" with that one filled button, lists none of the person's saved jobs and asks for no jobs, and the button opens Resume Studio; a saved job with no fit carries the link "Add your résumé to see your fit" (44px on a phone) where it said "AI assessment pending"; while a first résumé is being read the stage says so; with a résumé, or with no answer about one, the page is as it was. A job's newest reply reads "Interview reply · Nov 8", "Offer · Nov 9", "Application received · Nov 2" or "Not selected · Nov 5", is at least 44px tall, carries no text from the message, and opens that job's application. The saved list offers Unsave, New matches offers Save, and no star or "shortlist" is left.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | On a phone the fit link has its own line under a job's facts: it sat beside the place and pushed the posted date out of line.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 9: a move is said in one line that names the job, so Unsave reads "Unsaved: Office Manager 1 at Example Co."
 * 4 | maintainer@emeraldcoastsystemsgroup.com | An unscored job says Not scored yet while retaining résumé guidance, saved controls and truthful replies.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP, ORIGIN } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** One clock and one language for the dates a row shows. */
const at = (size) => ({ ...size, locale: 'en-US', timezoneId: 'UTC' });
const hostile = '<img src=x onerror="window.__injected=1">';
const job = (id, extra = {}) => ({ id, title: `Office Manager ${id}`, company: 'Example Co', location: 'Austin, TX', status: 'new', favorite: true, active: 1, ...extra });
const reply = (kind, date, extra = {}) => ({ messageId: `m-${kind}-${date}`, threadId: `t-${kind}`, subject: `${hostile} Re: your application`, date, kind, needsReview: false, ...extra });

/**
 * @description Fixture answers for the Job Board.
 * @param {{resume?: object|number, jobs?: object[], writes?: object[]}} state - What /resume/state answers (an object, or
 *   a status code for a failed read), the jobs every list read answers, and where writes are recorded.
 * @returns {(req: {method: string, url: URL, body: any}) => object|null} The handler openScreen takes.
 */
function board(state) {
  return ({ method, url, body }) => {
    const p = url.pathname;
    if (p === '/api/career-hunter/resume/state') return typeof state.resume === 'number' ? { status: state.resume, json: { error: 'unavailable' } } : { json: state.resume };
    if (p === '/api/career-hunter/jobs/stats') return { json: { saved: state.jobs.length, byStatus: [] } };
    if (p === '/api/career-hunter/applications') return { json: { applications: [] } };
    if (p === '/api/career-hunter/jobs') return { json: { jobs: state.jobs, exhausted: true, exclusions: [] } };
    if (/^\/api\/career-hunter\/jobs\/\d+\/status$/.test(p) && method === 'POST') { state.writes.push({ path: p, body }); return { json: { ok: true } }; }
    if (p === '/api/career-hunter/resume-studio') return { text: 'resume studio' };
    if (p === '/api/career-hunter/board-native') return { text: 'one application' };
    if (p === '/api/auth/user') return { json: { authenticated: false } };
    return { json: {} };
  };
}
const NONE = { hasResume: false, roles: 0, name: '', indexing: false, scored: 0 };
const HAS = { hasResume: true, roles: 4, name: 'Ada', indexing: false, scored: 12 };
const jobReads = (calls) => calls.filter((c) => c.path.startsWith('/api/career-hunter/jobs?'));
const filled = (page) => page.locator(':is(.ck-primary, .btn.primary):visible').allInnerTexts();

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: with no résumé New matches asks for it with one button and lists no saved job`, async () => {
    const state = { resume: NONE, jobs: [job(1), job(2), job(3)], writes: [] };
    const { page, context, calls } = await openScreen(browser, 'career-job-lists.html', board(state), at(size), '?view=matches');
    try {
      await page.getByRole('heading', { name: 'Add your résumé to get matches' }).waitFor();
      assert.match(await page.locator('#list').innerText(), /Career compares each job with your résumé\. Add it and the jobs that fit you appear here\./);
      assert.equal(await page.locator('.job-row, .match-card').count(), 0, 'no saved job is shown as a match');
      assert.deepEqual(jobReads(calls), [], 'and the page asked for none');
      assert.deepEqual(await filled(page), ['Add your résumé'], 'one filled button');
      assert.equal(await page.locator('#keywordSearch').isVisible(), false, 'nothing to search yet');
      const add = page.getByRole('link', { name: 'Add your résumé', exact: true });
      if (size === PHONE) await add.tap(); else await add.click();
      await page.waitForURL(`${ORIGIN}/api/career-hunter/resume-studio`);
    } finally { await context.close(); }
  });

  test(`${label}: with no résumé a saved job says how to see its fit`, async () => {
    const state = { resume: NONE, jobs: [job(1), job(2, { ai_fit_score: 81 })], writes: [] };
    const { page, context } = await openScreen(browser, 'career-job-lists.html', board(state), at(size));
    try {
      const link = page.locator('.job-row[data-job-id="1"]').getByRole('link', { name: 'Add your résumé to see your fit' });
      await link.waitFor();
      assert.doesNotMatch(await page.locator('#list').innerText(), /AI assessment pending/);
      assert.match(await page.locator('.job-row[data-job-id="2"]').innerText(), /AI fit 81/, 'a job that has a fit keeps it');
      assert.equal(await page.locator('.job-row').count(), 2, 'the saved jobs are still listed in Saved');
      if (size === PHONE) assert.ok((await link.boundingBox()).height >= 44, 'a 44px target on a phone');
      if (size === PHONE) {
        const row = await page.locator('.job-row[data-job-id="1"] .meta').boundingBox(), box = await link.boundingBox();
        assert.ok(box.width >= row.width - 2, 'the link has its own line across the row; no fact sits beside it');
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing is wider than the screen');
      if (size === PHONE) await link.tap(); else await link.click();
      await page.waitForURL(`${ORIGIN}/api/career-hunter/resume-studio`);
    } finally { await context.close(); }
  });
}

test('while a first résumé is being read New matches says so and offers nothing to press', async () => {
  const state = { resume: { ...NONE, indexing: true }, jobs: [job(1)], writes: [] };
  const { page, context, calls } = await openScreen(browser, 'career-job-lists.html', board(state), at(PHONE), '?view=matches');
  try {
    await page.getByRole('heading', { name: 'Reading your résumé' }).waitFor();
    assert.deepEqual(await filled(page), []);
    assert.equal(await page.locator('.job-row, .match-card').count(), 0);
    assert.deepEqual(jobReads(calls), []);
    assert.equal(await page.getByText('Add your résumé').count(), 0, 'it was already added');
  } finally { await context.close(); }
});

for (const [name, resume] of [['a résumé', HAS], ['no answer about a résumé', 503]]) {
  test(`with ${name} the page is as it was: matches are listed and an unscored job reads Not scored yet`, async () => {
    const state = { resume, jobs: [job(1, { favorite: false }), job(2, { favorite: false, ai_fit_score: 77 })], writes: [] };
    const matches = await openScreen(browser, 'career-job-lists.html', board(state), at(DESKTOP), '?view=matches');
    try {
      await matches.page.locator('.job-row[data-job-id="2"]').waitFor();
      assert.equal(await matches.page.locator('.job-row').count(), 2);
      assert.equal(await matches.page.getByText('Add your résumé').count(), 0);
      assert.match(await matches.page.locator('.job-row[data-job-id="1"]').innerText(), /Not scored yet/);
      assert.equal(await matches.page.locator('#keywordSearch').isVisible(), true);
      assert.deepEqual(await matches.page.locator('.job-row[data-job-id="1"] .row-actions button').allInnerTexts(), ['Save', 'Not interested']);
    } finally { await matches.context.close(); }
    const saved = await openScreen(browser, 'career-job-lists.html', board({ ...state, jobs: [job(1)] }), at(DESKTOP));
    try {
      await saved.page.locator('.job-row[data-job-id="1"]').waitFor();
      await saved.page.waitForFunction(() => performance.getEntriesByType('resource').some((r) => r.name.endsWith('/api/career-hunter/resume/state') && r.responseEnd > 0));
      await saved.page.getByRole('button', { name: 'Remove' }).waitFor();
      assert.match(await saved.page.locator('.job-row[data-job-id="1"]').innerText(), /Not scored yet/);
      assert.equal(await saved.page.getByText('Add your résumé').count(), 0);
    } finally { await saved.context.close(); }
  });
}

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: a job's newest reply from the inbox is one line on its row and opens its application`, async () => {
    const jobs = [
      job(1, { status: 'interview', emailUpdates: [reply('acknowledged', '2026-11-02T15:00:00.000Z'), reply('interview', '2026-11-08T15:00:00.000Z')] }),
      job(2, { status: 'offer', emailUpdates: [reply('offer', '2026-11-09T09:30:00.000Z')] }),
      job(3, { status: 'applied', emailUpdates: [reply('acknowledged', '2026-11-02T15:00:00.000Z')] }),
      job(4, { status: 'rejected', emailUpdates: [reply('interview', '2026-11-03T10:00:00.000Z'), reply('rejected', '2026-11-05T18:45:00.000Z')] }),
      job(5, { status: 'applied', emailUpdates: [reply(hostile, '2026-11-06T12:00:00.000Z')] }),
      job(6, { status: 'applied', emailUpdates: [] }),
      job(7, { status: 'applied', emailUpdates: [reply('interview', hostile)] }),
    ];
    const state = { resume: HAS, jobs, writes: [] };
    const { page, context } = await openScreen(browser, 'career-job-lists.html', board(state), at(size), '?view=status');
    try {
      await page.locator('.job-row[data-job-id="7"]').waitFor();
      const lines = await page.locator('.job-row').evaluateAll((rows) => rows.map((row) => [Number(row.dataset.jobId), row.querySelector('.reply-line')?.textContent ?? null]));
      assert.deepEqual(lines, [[1, 'Interview reply · Nov 8'], [2, 'Offer · Nov 9'], [3, 'Application received · Nov 2'], [4, 'Not selected · Nov 5'], [5, null], [6, null], [7, 'Interview reply']]);
      assert.equal(await page.evaluate(() => window.__injected), undefined, 'nothing from a message runs as markup');
      assert.equal(await page.locator('#list img').count(), 0);
      for (const line of await page.locator('.reply-line').all()) assert.ok((await line.boundingBox()).height >= 44, 'each line is a 44px target');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing is wider than the screen');
      const first = page.locator('.job-row[data-job-id="1"] .reply-line');
      if (size === PHONE) await first.tap(); else await first.click();
      await page.waitForURL((url) => url.pathname === '/api/career-hunter/board-native' && url.searchParams.get('application') === '1' && url.searchParams.get('view') === 'status');
    } finally { await context.close(); }
  });
}

test('one word for saving: Remove on the saved list, no star and no shortlist anywhere', async () => {
  const state = { resume: HAS, jobs: [job(1, { ai_fit_score: 70 }), job(2)], writes: [] };
  const { page, context } = await openScreen(browser, 'career-job-lists.html', board(state), at(DESKTOP));
  try {
    await page.locator('.job-row[data-job-id="2"]').waitFor();
    assert.match(await page.locator('#pageDescription').innerText(), /^Your saved jobs\./);
    assert.doesNotMatch(await page.locator('body').innerText(), /★|\bstar\b|shortlist|Save to Job Board/i);
    await page.locator('.job-row[data-job-id="1"]').getByRole('button', { name: 'Remove', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.job-row').length === 1);
    assert.deepEqual(state.writes, [{ path: '/api/career-hunter/jobs/1/status', body: { status: 'dismissed', favorite: false } }]);
    assert.equal(await page.locator('#actionState').innerText(), 'Removed: Office Manager 1 at Example Co.');
  } finally { await context.close(); }
});
