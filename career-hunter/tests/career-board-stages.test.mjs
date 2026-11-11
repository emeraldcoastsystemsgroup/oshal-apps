/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Job Board, Prepare & submit, Application status, Approvals). The real tools/career-board.html in Chromium over a synthetic fixture: one stage control (New matches · Saved · To approve · Preparing · Applied · Interviewing · More); the old addresses ?view=queue and ?view=status open Preparing and Applied, and ?view=approve opens the To approve view; switching stage in place keeps the frame; an empty stage is one empty state whose primary is Find jobs, with no "0 shown" and no bare page label; pay and fit filters leave the Preparing stage; desktop filters are an auto-fit grid with Clear filters, and a phone gets them in a Filters sheet.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 5: the shared stage control reads Getting ready (was Preparing); the expected stage names follow.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP, ORIGIN } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** An account with a résumé, two saved jobs elsewhere and nothing in the asked stage. */
function career() {
  return ({ url }) => {
    const p = url.pathname;
    if (p === '/api/career-hunter/jobs/stats') return { json: { saved: 0, byStatus: [{ status: 'interview', n: 1 }] } };
    if (p === '/api/career-hunter/applications') return { json: { applications: [{ posting_id: 7, status: 'approval_required' }] } };
    if (p === '/api/career-hunter/jobs') return { json: { jobs: [], total: 0, exhausted: true } };
    if (p === '/api/career-hunter/resume/state') return { json: { hasResume: true, scored: 3, indexing: false, building: false, ingest: { state: 'ready' } } };
    if (p === '/api/career-hunter/approvals') return { text: 'approvals view' };
    return { json: {} };
  };
}

test('phone: the stage control, old addresses and an empty stage', async () => {
  const { page, context } = await openScreen(browser, 'career-board.html', career(), PHONE, '?view=queue');
  try {
    const stages = page.getByRole('tablist', { name: 'Application stages' });
    await stages.getByRole('tab', { name: 'Getting ready' }).waitFor();
    assert.deepEqual(await stages.locator('a[role=tab]').allTextContents(), ['New matches', 'Saved', 'To approve1', 'Getting ready', 'Applied', 'Interviewing1']);
    assert.equal(await stages.getByRole('tab', { name: 'Getting ready' }).getAttribute('aria-selected'), 'true', '?view=queue is Getting ready');
    assert.equal(await page.locator('#min_pay').isVisible(), false, 'no pay filter while preparing');
    await page.getByRole('heading', { name: 'Nothing to prepare yet' }).waitFor();
    assert.equal((await page.locator('#count').innerText()).trim(), '', 'no "0 shown"');
    assert.equal((await page.locator('#boardPager').innerText()).trim(), '', 'no bare page label');
    assert.deepEqual(await page.locator('.ck-primary:visible').allInnerTexts(), ['Find jobs']);
    await stages.getByRole('tab', { name: 'Saved' }).tap();
    await page.getByRole('heading', { name: 'No saved jobs yet' }).waitFor();
    assert.match(page.url(), /status=saved/, 'the frame address names the stage');
    await page.getByRole('button', { name: 'Filters', exact: true }).tap();
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await sheet.waitFor();
    assert.equal(await sheet.getByRole('button', { name: 'Clear filters' }).isVisible(), true);
    await sheet.getByRole('button', { name: 'Done' }).tap();
  } finally { await context.close(); }
});

test('?view=status opens Applied and ?view=approve opens the To approve view', async () => {
  const status = await openScreen(browser, 'career-board.html', career(), DESKTOP, '?view=status');
  try {
    const applied = status.page.getByRole('tab', { name: 'Applied' });
    await applied.waitFor();
    assert.equal(await applied.getAttribute('aria-selected'), 'true');
  } finally { await status.context.close(); }
  const approve = await openScreen(browser, 'career-board.html', career(), DESKTOP, '?view=approve');
  try {
    await approve.page.waitForURL(`${ORIGIN}/api/career-hunter/approvals`);
  } finally { await approve.context.close(); }
});

test('desktop: filters are an auto-fit grid with Clear filters and fit the stage', async () => {
  const { page, context } = await openScreen(browser, 'career-board.html', career(), DESKTOP);
  try {
    await page.getByRole('tab', { name: 'New matches' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Filters', exact: true }).isVisible(), false, 'the sheet button is phone-only');
    const grid = await page.locator('#filterFields').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').map(parseFloat));
    assert.ok(grid.length >= 4 && grid.every((w) => w >= 160), `columns ${grid}`);
    assert.equal(await page.locator('#min_pay').isVisible(), true, 'pay filters while finding jobs');
    assert.equal(await page.getByRole('button', { name: 'Clear filters' }).isVisible(), true);
    const summary = await page.locator('#jobBoardFilters > summary').boundingBox();
    assert.ok(summary.height >= 44, `summary ${summary.height}px`);
  } finally { await context.close(); }
});
