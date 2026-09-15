/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive the real Portrait page against actual policy and HTTP with disposable Chromium users.
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createPortraitFixture, IDS } from './authorization.fixture';
let fixture: Awaited<ReturnType<typeof createPortraitFixture>>, browser: Browser;
beforeEach(async () => { fixture = await createPortraitFixture(); browser = await chromium.launch({ headless: true }); });
afterEach(async () => { await browser?.close(); await fixture?.close(); });
async function open(user: string): Promise<Page> {
  const context = await browser.newContext(); await context.addCookies([{ name: 'fixture-user', value: user, url: fixture.base }]);
  const page = await context.newPage(); await page.goto(fixture.base + '/api/portrait-studio/app'); return page;
}

it('reader UI shows owned portraits and hides create/change/delete/export controls', async () => {
  await fixture.change('reader'); await fixture.change('reader', 'bob');
  const alice = await open('alice'), bob = await open('bob');
  await alice.waitForSelector('#galleryGrid .g-item'); await bob.waitForSelector('#galleryGrid .g-item');
  expect(await alice.locator('#studioComposer').isVisible()).toBe(false);
  expect(await alice.locator('#galleryGrid [data-del], #galleryGrid [data-change], #galleryGrid a[download]').count()).toBe(0);
  expect(await alice.locator('#galleryGrid').innerText()).toContain('alice');
  expect(await bob.locator('#galleryGrid').innerText()).toContain('bob');
  expect(await bob.locator('#galleryGrid').innerText()).not.toContain('alice');
  const status = await alice.evaluate(async id => (await fetch('/api/portrait-studio/portraits/' + id, { method: 'DELETE' })).status, IDS.alice);
  expect(status).toBe(403);
});
it('editor can rename from the real page without gaining create or delete', async () => {
  await fixture.change('editor'); const page = await open('alice');
  await page.waitForSelector('[data-change]');
  page.once('dialog', dialog => { void dialog.accept('<b>Portrait title</b>'); });
  await page.locator('[data-change]').click();
  await page.waitForFunction(() => document.querySelector('#galleryGrid')?.textContent?.includes('<b>Portrait title</b>'));
  expect(await page.locator('#galleryGrid .lbl b').count()).toBe(0);
  expect(await page.locator('[data-del]').count()).toBe(0);
  expect(await page.locator('#studioComposer').isVisible()).toBe(false);
});
it('creator page reflects revocation and viewer permissions never fetch saved data', async () => {
  await fixture.change('creator'); const page = await open('alice');
  await page.waitForFunction(() => !document.querySelector<HTMLElement>('#studioComposer')?.hidden);
  await fixture.change('creator', 'alice', 'revoke'); await fixture.change('viewer');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => document.querySelector<HTMLElement>('#studioComposer')?.hidden === true);
  expect(await page.locator('#gallery').isVisible()).toBe(false);
  expect(await page.locator('#galleryGrid .g-item').count()).toBe(0);
  expect(await page.locator('#accessBanner').innerText()).toContain('Reading saved portraits requires');
});
