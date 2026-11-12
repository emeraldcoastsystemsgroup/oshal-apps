/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Strengthen, grade C). The real tools/career-strengthen.html in Chromium over a synthetic fixture: with no gaps the page is one empty state whose one primary is the step that makes gaps (Upload your résumé without an indexed résumé, Score jobs on the Job Board with one), the mic line is hidden, and Rescan gaps is a 44px secondary; with open and answered gaps the mic line shows and Open · Answered switches the list.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Page names, judge's report 2026-11-11 (tests/career-page-names.test.mjs holds them): the empty state's button says Score jobs in My jobs.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

function gaps(state) {
  return ({ url }) => {
    const p = url.pathname;
    if (p === '/api/career-hunter/strengthen') return { json: { themes: state.themes, total: state.themes.length } };
    if (p === '/api/career-hunter/resume/state') return { json: { hasResume: state.hasResume } };
    if (p.startsWith('/api/career-hunter/stories')) return { json: { roles: [], stories: [] } };
    return { json: {} };
  };
}

for (const [hasResume, label] of [[false, 'Upload your résumé'], [true, 'Score jobs in My jobs']]) {
  test(`no gaps (${hasResume ? 'résumé indexed' : 'no résumé'}): one empty state whose primary is ${label}`, async () => {
    const { page, context } = await openScreen(browser, 'career-strengthen.html', gaps({ themes: [], hasResume }), PHONE);
    try {
      await page.getByRole('heading', { name: 'No gaps to work on yet' }).waitFor();
      assert.deepEqual(await page.locator('.ck-primary:visible').allInnerTexts(), [label]);
      assert.equal(await page.locator('#micHint').isVisible(), false, 'no mic instruction without boxes');
      const rescan = await page.locator('#rescanBtn').boundingBox();
      assert.ok(rescan.height >= 44, `Rescan is ${rescan.height}px`);
      assert.doesNotMatch(await page.locator('body').innerText(), /Try ↻ Rescan after scoring more jobs/);
    } finally { await context.close(); }
  });
}

test('open and answered gaps: the mic line shows and Open · Answered switches the list', async () => {
  const themes = [
    { key: 'scale', title: 'Scaling systems', addressable: true, n_jobs: 4, status: 'open', prompt: 'Tell me about scale.' },
    { key: 'lead', title: 'Leading teams', addressable: true, n_jobs: 2, status: 'answered', response: 'Led a team of six.' },
  ];
  const { page, context } = await openScreen(browser, 'career-strengthen.html', gaps({ themes, hasResume: true }), DESKTOP);
  try {
    await page.locator('#ta-scale').waitFor();
    assert.equal(await page.locator('#micHint').isVisible(), true);
    await page.getByRole('tab', { name: /Answered/ }).click();
    await page.getByText(/Leading teams/).waitFor();
    assert.equal(await page.locator('#ta-scale').count(), 0, 'the answered view shows answered stories only');
    assert.equal(await page.locator('#micHint').isVisible(), false);
  } finally { await context.close(); }
});
