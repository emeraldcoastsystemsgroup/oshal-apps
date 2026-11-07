/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Mobile, grade D). The tile left Career's menu (the route stays), and the real tools/career-mobile.html in Chromium: the viewport no longer locks zoom; an empty deck says "No matches yet" with one Find jobs and hides the four swipe buttons; Ready reads GET /api/career-hunter/submission-queue (never /api/apply-operator/queue, which the native kernel does not serve), and a failed queue read shows an alert with Retry instead of an empty "Nothing here yet".
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openScreen, playwright, PHONE, tools } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

test('Mobile is off the menu and its page no longer locks zoom', () => {
  const manifest = readFileSync(new URL('../oshal-app.yaml', import.meta.url), 'utf8');
  assert.doesNotMatch(manifest, /toolName: career-mobile\b/);
  assert.match(manifest, /mountPath: \/api\/career-hunter/);
  assert.doesNotMatch(readFileSync(`${tools}/career-mobile.html`, 'utf8').match(/<meta name="viewport"[^>]*>/)[0], /maximum-scale/);
});

function api(state) {
  return ({ url }) => {
    const p = url.pathname;
    if (p === '/api/career-hunter/applications') return { json: { applications: [] } };
    if (p === '/api/career-hunter/enqueue-drafts') return { json: { created: 0 } };
    if (p === '/api/career-hunter/jobs') return { json: { jobs: [] } };
    if (p === '/api/career-hunter/submission-queue') return state.queueFails ? { status: 503, json: { error: 'unavailable' } } : { json: { items: [] } };
    return { json: {} };
  };
}

test('an empty deck is No matches yet with one Find jobs and no swipe buttons', async () => {
  const { page, context } = await openScreen(browser, 'career-mobile.html', api({ queueFails: false }), PHONE);
  try {
    await page.getByText('No matches yet').waitFor();
    assert.equal(await page.locator('.deck-actions').isVisible(), false);
    assert.equal(await page.getByRole('link', { name: 'Find jobs' }).count(), 1);
    assert.doesNotMatch(await page.locator('body').innerText(), /All caught up/);
  } finally { await context.close(); }
});

test('Ready reads the caller’s submission records, and a failed read is an alert with Retry', async () => {
  const state = { queueFails: true };
  const { page, context, calls } = await openScreen(browser, 'career-mobile.html', api(state), PHONE);
  try {
    await page.evaluate(() => { show('ready'); return loadReady(); });
    const alert = page.getByRole('alert');
    await alert.waitFor();
    assert.match(await alert.innerText(), /Couldn.t load your submission queue/);
    assert.ok(calls.some((c) => c.path === '/api/career-hunter/submission-queue'));
    assert.equal(calls.some((c) => c.path.startsWith('/api/apply-operator/')), false);
    state.queueFails = false;
    await alert.getByRole('button', { name: 'Retry' }).tap();
    await page.waitForFunction(() => !document.querySelector('#readyList [role=alert]'));
  } finally { await context.close(); }
});
