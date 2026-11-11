/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Submission activity, grade C). The real tools/career-submissions.html in Chromium over a synthetic fixture: one status row "No computer connected · last seen 30 days ago" with one Connect a computer (no picker row, no repeated "no worker" lines, no hour count); the lanes are 44px role=tab chips that filter the list; an empty queue is "Nothing sent yet" with one primary Open Job Board; Job Apply's counters are one row computed from these records and each row names its portal; Connect a computer opens the kit sheet with a primary, a tertiary Cancel and an X close, and never a browser dialog.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Guard trial guest behavior: withhold Connect a computer when /api/guest/session reports an active guest visitor.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 5: the lanes read Needs your answer and Removed (were Needs you and Dismissed); the expected lane names follow.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const lastSeen = Date.now() - 30 * 86400000 - 3600000;
function api(state) {
  return ({ url }) => {
    const p = url.pathname;
    if (p === '/api/guest/session') return { json: { guest: Boolean(state.guest), active: Boolean(state.guest) } };
    if (p === '/api/apply-operator/workers') return { json: { workers: [], available: false, observedBrowserNodes: [{ lastSeen }] } };
    if (p === '/api/career-hunter/submission-queue') return { json: { items: state.items } };
    if (p === '/api/career-hunter/applications') return { json: { applications: [] } };
    if (p === '/api/career-hunter/jobs') return { json: { jobs: [] } };
    return { json: {} };
  };
}

test('phone: one status row, chips for lanes and an empty queue with Open Job Board', async () => {
  const { page, context } = await openScreen(browser, 'career-submissions.html', api({ items: [] }), PHONE);
  try {
    await page.getByRole('heading', { name: 'Nothing sent yet' }).waitFor();
    const status = await page.locator('#worker').innerText();
    assert.match(status, /No computer connected · last seen 30 days ago/);
    assert.doesNotMatch(await page.locator('body').innerText(), /\d{3}h \d+m/);
    assert.equal(await page.locator('#nodeSel').isVisible(), false, 'no picker row');
    assert.deepEqual(await page.locator('.ck-primary:visible').allInnerTexts(), ['Open Job Board']);
    const chips = page.getByRole('tablist', { name: 'Submission lanes' }).getByRole('tab');
    assert.deepEqual((await chips.allTextContents()).map((t) => t.replace(/\d+$/, '')), ['All', 'Queued', 'Submitting', 'Completed', 'Needs your answer', 'Failed', 'Removed']);
    for (const chip of await chips.all()) assert.ok((await chip.boundingBox()).height >= 44);
    assert.equal(await page.getByRole('link', { name: /Application status/ }).isVisible().catch(() => false), false);
  } finally { await context.close(); }
});

test('desktop: counters row, portal on each row, chips filter, and the connect sheet', async () => {
  const now = new Date().toISOString();
  const items = [
    { id: 's1', postingId: 1, title: 'Platform Engineer', company: 'Example Co', status: 'submitted', updatedAt: now, url: 'https://boards.greenhouse.io/example/jobs/1', confirmationFile: 'c.png' },
    { id: 's2', postingId: 2, title: 'SRE', company: 'Other Co', status: 'failed', updatedAt: now, url: 'https://jobs.lever.co/other/2' },
    { id: 's3', postingId: 3, title: 'Architect', company: 'Third Co', status: 'queued', updatedAt: now, nativeTicketId: 't3', nativeWorkId: 'w3' },
  ];
  const { page, context, calls } = await openScreen(browser, 'career-submissions.html', api({ items }), DESKTOP);
  try {
    await page.locator('.activity-row').nth(2).waitFor();
    assert.equal((await page.locator('#applyCounters').innerText()).replace(/\s+/g, ' ').trim(), '1 active 1 failed or unknown 0 marked manually 1 verified in 24 h 1 verified in 5 days');
    assert.match(await page.locator('.activity-row').first().innerText(), /Example Co · boards\.greenhouse\.io/);
    await page.getByRole('tab', { name: /^Failed/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('.activity-row').length === 1);
    await page.getByRole('button', { name: 'Connect a computer' }).click();
    const sheet = page.getByRole('dialog', { name: 'Connect your Career browser worker' });
    await sheet.waitFor();
    assert.match(await sheet.getByRole('button', { name: 'Create and connect worker' }).getAttribute('class'), /ck-primary/);
    assert.match(await sheet.getByRole('button', { name: 'Cancel' }).getAttribute('class'), /ck-tertiary/);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await page.waitForFunction(() => !document.querySelector('dialog.ck-sheet'));
    assert.equal(calls.filter((c) => c.method === 'DIALOG').length, 0);
  } finally { await context.close(); }
});

test('guest visitor: Connect a computer is withheld', async () => {
  const { page, context } = await openScreen(browser, 'career-submissions.html', api({ items: [], guest: true }), PHONE);
  try {
    await page.getByRole('heading', { name: 'Nothing sent yet' }).waitFor();
    assert.match(await page.locator('#worker').innerText(), /No computer connected/);
    assert.equal(await page.locator('#connectComputer').count(), 0);
  } finally { await context.close(); }
});
