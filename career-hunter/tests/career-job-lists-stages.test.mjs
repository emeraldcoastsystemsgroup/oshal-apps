/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Job Board, the merged Prepare & submit / Application status / Approvals). The live Job Board is tools/career-job-lists.html (GET /board-native serves it), so the pipeline is proven there, in Chromium over a synthetic fixture: the stage control shows New matches · Saved · To approve · Preparing · Applied · Interviewing with the right stage selected for the old addresses (board-native = Saved, ?view=queue = Preparing, ?view=status = Applied), ?view=interviewing asks the feed for status=interview, ?view=approve opens the approvals view; an empty stage is one empty state whose primary is Find jobs, with no "0 shown" and no "No results · End of this view"; pay and fit filters leave the Preparing stage; Clear filters exists.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 5: the stage reads Getting ready (was Preparing); the expected stage names follow.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 6 and 9: the row is the stages of the bar section the page is on (My jobs: New matches, Saved, Getting ready, Removed; Applications: Applied, Interviewing, Offer, Closed), To approve is in neither, ?view=approve stays on the page (Saved), and ?view=offer, ?view=closed and ?view=dismissed ask the feed for their own status where each used to open Saved.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP, ORIGIN } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

function feed() {
  return ({ url }) => {
    const p = url.pathname;
    if (p === '/api/career-hunter/jobs/stats') return { json: { saved: 0, byStatus: [] } };
    if (p === '/api/career-hunter/applications') return { json: { applications: [{ posting_id: 9, status: 'approval_required' }] } };
    if (p === '/api/career-hunter/jobs') return { json: { jobs: [], exhausted: true } };
    if (p === '/api/career-hunter/approvals') return { text: 'approvals view' };
    return { json: {} };
  };
}

const JOBS = ['New matches', 'Saved', 'Getting ready', 'Removed'], APPLICATIONS = ['Applied', 'Interviewing', 'Offer', 'Closed'];
for (const [query, selected, row] of [['', 'Saved', JOBS], ['?view=queue', 'Getting ready', JOBS], ['?view=status', 'Applied', APPLICATIONS]]) {
  test(`board-native${query || ''} selects ${selected} in the one stage control`, async () => {
    const { page, context } = await openScreen(browser, 'career-job-lists.html', feed(), PHONE, query);
    try {
      const stages = page.getByRole('tablist', { name: 'Application stages' });
      await stages.getByRole('tab', { name: selected, exact: true }).waitFor();
      assert.deepEqual(await stages.locator('a[role=tab]').allTextContents(), row, 'the row of the section this stage is in');
      assert.equal(await page.getByRole('button', { name: /More/ }).count(), 0, 'no More menu of stages');
      assert.equal(await stages.getByRole('tab', { name: selected, exact: true }).getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('nav.journey-nav').isVisible(), false, 'the old four-link nav is gone');
    } finally { await context.close(); }
  });
}

test('an empty stage is one empty state with Find jobs; the preparing stage drops pay and fit filters', async () => {
  const { page, context } = await openScreen(browser, 'career-job-lists.html', feed(), DESKTOP, '?view=queue');
  try {
    await page.getByRole('heading', { name: 'Nothing to prepare yet' }).waitFor();
    assert.deepEqual(await page.locator('.ck-primary:visible').allInnerTexts(), ['Find jobs']);
    assert.equal((await page.locator('#requestState').innerText()).trim(), '', 'no "0 shown"');
    assert.equal((await page.locator('#pager').innerText()).trim(), '', 'no "No results · End of this view"');
    await page.locator('#filters > summary').click();
    assert.equal(await page.locator('#min_pay').isVisible(), false);
    assert.equal(await page.getByRole('button', { name: 'Clear filters' }).isVisible(), true);
  } finally { await context.close(); }
});

test('?view=interviewing reads the interview status and ?view=approve stays on the page, on Saved', async () => {
  const one = await openScreen(browser, 'career-job-lists.html', feed(), DESKTOP, '?view=interviewing');
  try {
    await one.page.getByRole('heading', { name: 'No interviews yet' }).waitFor();
    assert.ok(one.calls.some((c) => c.path.startsWith('/api/career-hunter/jobs?') && new URLSearchParams(c.path.split('?')[1]).get('status') === 'interview'));
  } finally { await one.context.close(); }
  const two = await openScreen(browser, 'career-job-lists.html', feed(), DESKTOP, '?view=approve');
  try {
    await two.page.getByRole('heading', { name: 'No saved jobs yet' }).waitFor();
    assert.equal(await two.page.getByRole('tab', { name: 'Saved', exact: true }).getAttribute('aria-selected'), 'true');
    assert.ok(!two.calls.some((c) => c.path === '/api/career-hunter/approvals'), 'the retired approvals page is not opened');
  } finally { await two.context.close(); }
});

for (const [view, selected, status, empty] of [['offer', 'Offer', 'offer', 'No offers yet'], ['closed', 'Closed', 'rejected', 'Nothing closed'], ['dismissed', 'Removed', 'dismissed', 'Nothing removed']]) {
  test(`?view=${view} opens ${selected} and asks the feed for ${status}`, async () => {
    const { page, context, calls } = await openScreen(browser, 'career-job-lists.html', feed(), PHONE, `?view=${view}`);
    try {
      await page.getByRole('heading', { name: empty }).waitFor();
      assert.equal(await page.getByRole('tab', { name: selected, exact: true }).getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('#pageTitle').textContent(), selected);
      assert.ok(calls.some((c) => c.path.startsWith('/api/career-hunter/jobs?') && new URLSearchParams(c.path.split('?')[1]).get('status') === status), 'the feed was asked for that stage, not for Saved');
      assert.equal(new URL(page.url()).searchParams.get('view'), view, 'the address keeps the stage');
    } finally { await context.close(); }
  });
}

test('a job in Removed is called removed, not saved, and can be brought back by preparing it', async () => {
  const removed = { id: 5, title: 'Dispatcher', company: 'Example Co', location: 'Austin, TX', status: 'dismissed', favorite: false, active: 1 };
  const answers = feed();
  const { page, context } = await openScreen(browser, 'career-job-lists.html', (req) => (req.url.pathname === '/api/career-hunter/jobs' ? { json: { jobs: [removed], exhausted: true } } : answers(req)), DESKTOP, '?view=dismissed');
  try {
    await page.locator('.job-row[data-job-id="5"]').waitFor();
    assert.equal(await page.locator('.job-row[data-job-id="5"] .status').innerText(), 'Removed');
    assert.deepEqual(await page.locator('.job-row[data-job-id="5"] .row-actions button').allTextContents(), ['Prepare application']);
  } finally { await context.close(); }
});
