/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Search Jobs, grade C). The real tools/career-search.html in Chromium over a synthetic browse feed: on a phone the first job card starts right under the search row (it sat about 1,700px down), the rail and the Advanced fields open in a Filters sheet with Done and Clear all, and the page opens on the list; on desktop the list (480px) sits beside the map; the title and the repeated "Search jobs" are gone, the button reads Search, and the view links, pills and Clear all are 44px targets.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 7: the page now opens under Career's own frame, which hides the strip of view links (the frame's bar goes to those places), so the 44px view-link check runs with the frame off, where the strip still shows; the phone's first job is held to 320px under the frame by tests/career-search-words.test.mjs.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const jobs = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, title: `Platform Engineer ${i + 1}`, company: 'Example Co', location: 'Austin, TX', lat: 30.27, lon: -97.74, posted_date: '2026-11-01' }));
const feed = ({ url }) => {
  if (url.pathname === '/api/career-hunter/browse') return { json: { jobs, browse: true, page: 1, per: 50, exhausted: true } };
  if (url.pathname === '/api/auth/user') return { json: { authenticated: false } };
  return null;
};

test('phone: results start under the search row and the filters live in one sheet', async () => {
  const { page, context } = await openScreen(browser, 'career-search.html', feed, PHONE);
  try {
    const first = page.locator('#list .job').first();
    await first.waitFor();
    const top = (await first.boundingBox()).y;
    assert.ok(top < 520, `first job card at ${top}px`);
    assert.equal(await page.locator('#mapPanel').isVisible(), false, 'the phone opens on the list');
    assert.equal(await page.locator('h1').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Search', exact: true }).count(), 1);
    assert.equal(await page.locator('#near').isVisible(), false, 'the rail waits in the sheet');
    await page.getByRole('button', { name: 'Filters', exact: true }).tap();
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await sheet.waitFor();
    assert.equal(await sheet.locator('#near').isVisible(), true);
    await sheet.getByText('Advanced: job title, description, company').tap();
    assert.equal(await sheet.locator('#title').isVisible(), true);
    assert.equal(await sheet.getByRole('button', { name: 'Clear all' }).first().isVisible(), true);
    for (const pill of await sheet.locator('.pill').all()) assert.ok((await pill.boundingBox()).height >= 44);
    await sheet.getByRole('button', { name: 'Done' }).tap();
    await page.waitForFunction(() => !document.getElementById('searchSheet').open && document.querySelector('.cols > #rail'));
    assert.equal(await page.locator('#searchSheet #rail').count(), 0, 'the rail went back home');
  } finally { await context.close(); }
});

test('desktop: the list sits beside the map and the view links are 44px', async () => {
  const { page, context } = await openScreen(browser, 'career-search.html', feed, DESKTOP, '?view=map&frame=off');
  try {
    await page.locator('#list .job').first().waitFor();
    const list = await page.locator('#list').boundingBox(), map = await page.locator('#mapPanel').boundingBox();
    assert.ok(Math.abs(list.width - 480) <= 1, `list ${list.width}px`);
    assert.ok(map.x > list.x + list.width, 'map beside the list');
    assert.equal(await page.locator('.career-view-nav > :is(a, span)').count(), 3, 'without the frame the strip of view links shows');
    for (const item of await page.locator('.career-view-nav > :is(a, span)').all()) assert.ok((await item.boundingBox()).height >= 44);
    assert.ok((await page.locator('#clear').boundingBox()).height >= 44);
    assert.equal(await page.getByRole('button', { name: 'About pay estimates' }).count(), 1);
  } finally { await context.close(); }
});
