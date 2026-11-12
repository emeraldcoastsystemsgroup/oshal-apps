/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Recommended for you (New matches), reported from a phone 2026-11-11. The shipped tools/career-job-lists.html in Chromium over fixture answers, at 1440x900 and 412x915 (the List layout): a match the person has not saved does not say "Saved" anywhere and has one filled Save; a saved match's button reads Saved, is pressed no more and is not filled; pressing Save writes the favourite and the row then reads the same as a saved match. New matches asks for its jobs by date posted, newest first, and its Sort shows Date posted; Saved still asks by Best AI fit; a sort remembered from an earlier visit that the person never chose is not put back, and one they chose is.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP, ORIGIN } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const at = (size) => ({ ...size, locale: 'en-US', timezoneId: 'UTC' });
const job = (id, extra = {}) => ({ id, title: `Program Manager ${id}`, company: 'Example Co', location: 'Remote', remote: 1, status: 'new', favorite: false, active: 1, ai_fit_score: 60 + id, posted_date: `2026-11-0${id}`, ...extra });
const HAS = { hasResume: true, roles: 4, name: 'Ada', indexing: false, scored: 12 };
const IDENTITY = { authenticated: true, tenant: 't-1', principal_id: 'p-1' };

/**
 * @description Fixture answers for the job lists with a résumé.
 * @param {{jobs: object[], writes: object[], identity?: object}} state - The jobs every list read answers, where writes are
 *   recorded, and what /api/auth/user answers (signed out when absent).
 * @returns {(req: {method: string, url: URL, body: any}) => object|null} The handler openScreen takes.
 */
function lists(state) {
  return ({ method, url, body }) => {
    const p = url.pathname;
    if (p === '/api/career-hunter/resume/state') return { json: HAS };
    if (p === '/api/career-hunter/jobs/stats') return { json: { saved: 0, byStatus: [] } };
    if (p === '/api/career-hunter/applications') return { json: { applications: [] } };
    if (p === '/api/career-hunter/jobs') return { json: { jobs: state.jobs, exhausted: true, exclusions: [] } };
    if (/^\/api\/career-hunter\/jobs\/\d+\/(status|generate)$/.test(p) && method === 'POST') { state.writes.push({ path: p, body }); return { json: { ok: true } }; }
    if (p === '/api/auth/user') return { json: state.identity || { authenticated: false } };
    return { json: {} };
  };
}
const filledIn = (row) => row.locator(':is(.ck-primary, .btn.primary)').allInnerTexts();
const sortsAsked = (calls) => calls.filter((c) => c.path.startsWith('/api/career-hunter/jobs?')).map((c) => new URLSearchParams(c.path.split('?')[1]).get('sort'));

/**
 * @description Show the matches as a list: a phone opens them as cards, the list is one tab away.
 * @param {import('playwright').Page} page - The open page.
 * @param {object} size - The viewport it was opened at.
 * @returns {Promise<void>}
 */
async function asList(page, size) {
  if (size !== PHONE) return;
  await page.getByRole('tab', { name: 'List' }).tap();
}

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: a match the person has not saved does not say Saved, and a saved one does not offer Save`, async () => {
    const state = { jobs: [job(1, { favorite: true }), job(2)], writes: [] };
    const { page, context } = await openScreen(browser, 'career-job-lists.html', lists(state), at(size), '?view=matches');
    try {
      await asList(page, size);
      const saved = page.locator('.job-row[data-job-id="1"]'), unsaved = page.locator('.job-row[data-job-id="2"]');
      await unsaved.waitFor();
      assert.doesNotMatch(await unsaved.innerText(), /Saved/, 'nothing on an unsaved match calls it saved');
      assert.deepEqual(await unsaved.locator('.row-actions button').allInnerTexts(), ['Save', 'Not interested']);
      assert.deepEqual(await filledIn(unsaved), ['Save'], 'Save is the filled button');
      assert.deepEqual(await saved.locator('.row-actions button').allInnerTexts(), ['Saved', 'Not interested']);
      assert.equal(await saved.getByRole('button', { name: 'Saved' }).isDisabled(), true, 'a saved match cannot be saved again');
      assert.deepEqual(await filledIn(saved), [], 'and nothing on it is filled: there is nothing left to do there');
      assert.equal((await saved.innerText()).match(/Saved/g).length, 1, 'it says Saved once, on its button');

      const save = unsaved.getByRole('button', { name: 'Save', exact: true });
      if (size === PHONE) await save.tap(); else await save.click();
      await unsaved.getByRole('button', { name: 'Saved' }).waitFor();
      assert.deepEqual(state.writes[0], { path: '/api/career-hunter/jobs/2/status', body: { favorite: true } }, 'Save writes the favourite');
      assert.equal(await unsaved.getByRole('button', { name: 'Saved' }).isDisabled(), true);
      assert.deepEqual(await filledIn(unsaved), [], 'once saved the row reads the same as a saved match');
      assert.equal((await unsaved.innerText()).match(/Saved/g).length, 1);
    } finally { await context.close(); }
  });
}

test('New matches is ordered by date posted, newest first; Saved stays by Best AI fit', async () => {
  const matches = await openScreen(browser, 'career-job-lists.html', lists({ jobs: [job(3), job(2)], writes: [] }), at(DESKTOP), '?view=matches');
  try {
    await matches.page.locator('.job-row[data-job-id="3"]').waitFor();
    assert.deepEqual(sortsAsked(matches.calls), ['posted'], 'the list is asked for by date posted');
    assert.equal(await matches.page.locator('#sort option:checked').textContent(), 'Date posted');
    assert.deepEqual(await matches.page.locator('.job-row').evaluateAll((rows) => rows.map((row) => Number(row.dataset.jobId))), [3, 2], 'drawn in the order the server answered');
  } finally { await matches.context.close(); }
  const saved = await openScreen(browser, 'career-job-lists.html', lists({ jobs: [job(1, { favorite: true })], writes: [] }), at(DESKTOP));
  try {
    await saved.page.locator('.job-row[data-job-id="1"]').waitFor();
    assert.deepEqual(sortsAsked(saved.calls), ['ai']);
  } finally { await saved.context.close(); }
});

for (const [name, memory, expected] of [
  ['a sort remembered from before that the person never chose is not put back', { filters: { sort: 'ai', per: '50' }, page: 1 }, 'posted'],
  ['a sort the person chose is put back', { filters: { sort: 'salary', per: '50' }, page: 1, sortChosen: true }, 'salary'],
]) {
  test(`New matches: ${name}`, async () => {
    const { page, context, calls } = await openScreen(browser, 'career-job-lists.html', lists({ jobs: [job(1)], writes: [], identity: IDENTITY }), at(DESKTOP), '?view=matches');
    try {
      await page.locator('.job-row[data-job-id="1"]').waitFor();
      // The next visit in this tab finds the memory as an earlier visit left it.
      await context.addInitScript((stored) => { if (!sessionStorage.getItem('fixture-seeded')) { sessionStorage.setItem('career-journey:t-1:p-1:matches', JSON.stringify(stored)); sessionStorage.setItem('fixture-seeded', '1'); } }, memory);
      calls.length = 0;
      await page.goto(`${ORIGIN}/screen?view=matches`, { waitUntil: 'load' });
      await page.locator('.job-row[data-job-id="1"]').waitFor();
      await page.waitForFunction(() => document.getElementById('list').getAttribute('aria-busy') === 'false');
      assert.equal(sortsAsked(calls).at(-1), expected);
      assert.equal(await page.locator('#sort').inputValue(), expected);
    } finally { await context.close(); }
  });
}

test('a sort the person picks is remembered as theirs', async () => {
  const { page, context } = await openScreen(browser, 'career-job-lists.html', lists({ jobs: [job(1)], writes: [], identity: IDENTITY }), at(DESKTOP), '?view=matches');
  try {
    await page.locator('.job-row[data-job-id="1"]').waitFor();
    await page.waitForFunction(() => document.getElementById('list').getAttribute('aria-busy') === 'false');
    await page.getByText('Sort and filter').click();
    await page.locator('#sort').selectOption('salary');
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('career-journey:t-1:p-1:matches') || '{}').filters?.sort === 'salary');
    assert.equal(JSON.parse(await page.evaluate(() => sessionStorage.getItem('career-journey:t-1:p-1:matches'))).sortChosen, true);
  } finally { await context.close(); }
});
