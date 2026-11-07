/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Job Board, the merged Prepare & submit / Application status / Approvals). The live Job Board is tools/career-job-lists.html (GET /board-native serves it), so the pipeline is proven there, in Chromium over a synthetic fixture: the stage control shows New matches · Saved · To approve · Preparing · Applied · Interviewing with the right stage selected for the old addresses (board-native = Saved, ?view=queue = Preparing, ?view=status = Applied), ?view=interviewing asks the feed for status=interview, ?view=approve opens the approvals view; an empty stage is one empty state whose primary is Find jobs, with no "0 shown" and no "No results · End of this view"; pay and fit filters leave the Preparing stage; Clear filters exists.
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

for (const [query, selected] of [['', 'Saved'], ['?view=queue', 'Preparing'], ['?view=status', 'Applied']]) {
  test(`board-native${query || ''} selects ${selected} in the one stage control`, async () => {
    const { page, context } = await openScreen(browser, 'career-job-lists.html', feed(), PHONE, query);
    try {
      const stages = page.getByRole('tablist', { name: 'Application stages' });
      await stages.getByRole('tab', { name: selected, exact: true }).waitFor();
      assert.deepEqual(await stages.locator('a[role=tab]').allTextContents(), ['New matches', 'Saved', 'To approve1', 'Preparing', 'Applied', 'Interviewing']);
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

test('?view=interviewing reads the interview status and ?view=approve opens the approvals view', async () => {
  const one = await openScreen(browser, 'career-job-lists.html', feed(), DESKTOP, '?view=interviewing');
  try {
    await one.page.getByRole('heading', { name: 'No interviews yet' }).waitFor();
    assert.ok(one.calls.some((c) => c.path.startsWith('/api/career-hunter/jobs?') && new URLSearchParams(c.path.split('?')[1]).get('status') === 'interview'));
  } finally { await one.context.close(); }
  const two = await openScreen(browser, 'career-job-lists.html', feed(), DESKTOP, '?view=approve');
  try { await two.page.waitForURL(`${ORIGIN}/api/career-hunter/approvals`); } finally { await two.context.close(); }
});
