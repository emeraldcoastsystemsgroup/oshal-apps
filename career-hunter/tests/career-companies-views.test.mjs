/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Companies, grade C). The real tools/career-companies.html in Chromium over a synthetic administrator list: the Companies view shows search, chips and the table at once with no nightly review or pull telemetry between them; Source health shows the review and the failed/partial line without the table and is addressable as ?view=health; Jobs sorts descending then ascending; the in-page Job Board and Cockpit links are gone; chips and the attention checkbox are 44px.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.52.6: the Removed chip shows only when an employer is removed, so the 44px check measures the chips on screen, and there are four of them here.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const companies = [
  { id: 1, name: 'Alpha', active_jobs: 3, ats_type: 'greenhouse', pull_health: { status: 'ok', last_attempt_at: '2026-11-05T01:00:00Z' } },
  { id: 2, name: 'Beta', active_jobs: 40, ats_type: 'workday', pull_health: { status: 'failed', last_attempt_at: '2026-11-05T02:00:00Z' } },
  { id: 3, name: 'Gamma', active_jobs: 12, ats_type: 'lever', pull_health: { status: 'partial', last_attempt_at: '2026-11-05T03:00:00Z' } },
];
const sourceReview = { finishedAt: '2026-11-05T05:00:00Z', repaired: [], suggested: [], stillBroken: [], summary: { checked: 3 } };
const api = ({ url }) => (url.pathname === '/api/career-hunter/companies-admin/list'
  ? { json: { companies, admin: true, sourceHealth: { available: true }, sourceReview, sourceChanges: [] } } : null);

test('desktop: the Companies view is search, chips, then the table; Jobs sorts', async () => {
  const { page, context } = await openScreen(browser, 'career-companies.html', api, DESKTOP);
  try {
    await page.locator('#rows tr').nth(2).waitFor();
    assert.equal(await page.locator('#healthSummary').isVisible(), false, 'no telemetry between search and table');
    assert.equal(await page.locator('#sourceReview').isVisible(), false);
    assert.equal(await page.getByRole('link', { name: /Job Board|Cockpit/ }).count(), 0);
    await page.getByRole('button', { name: 'Jobs', exact: true }).click();
    assert.deepEqual(await page.locator('#rows td.name').allInnerTexts(), ['Beta', 'Gamma', 'Alpha']);
    await page.getByRole('button', { name: 'Jobs', exact: true }).click();
    assert.deepEqual(await page.locator('#rows td.name').allInnerTexts(), ['Alpha', 'Gamma', 'Beta']);
    await page.getByRole('tab', { name: 'Source health' }).click();
    assert.match(page.url(), /view=health/);
    assert.equal(await page.locator('table').isVisible(), false);
    assert.match(await page.locator('#healthSummary').innerText(), /1 failed · 1 partial/);
  } finally { await context.close(); }
});

test('phone: ?view=health opens Source health; chips and the attention checkbox are 44px', async () => {
  const { page, context } = await openScreen(browser, 'career-companies.html', api, PHONE, '?view=health');
  try {
    await page.locator('#healthSummary').waitFor();
    assert.equal(await page.getByRole('tab', { name: 'Source health' }).getAttribute('aria-selected'), 'true');
    await page.getByRole('tab', { name: 'Companies' }).tap();
    const chips = await page.locator('button.flt:visible').all();
    assert.equal(chips.length, 4, 'All, Active ATS, Needs URL, Unconfirmed pulls; Removed only when one is removed');
    for (const chip of chips) assert.ok((await chip.boundingBox()).height >= 44);
    assert.ok((await page.locator('label.chk').boundingBox()).height >= 44);
  } finally { await context.close(); }
});
