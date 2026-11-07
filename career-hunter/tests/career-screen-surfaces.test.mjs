/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Additional experience, grade D): career-theme.css scopes every Career colour to :root[data-career-surface], and the experience library was the one screen that loaded it without that attribute, so its primary was invisible and its fields had no edge. Every Career screen that loads career-theme.css must carry data-career-surface on its <html>; the Additional experience screen is checked by name too, so losing the attribute there goes red. Then the real page in Chromium: its fields draw an edge, Add experience is the one filled primary, and while an entry is written Save experience takes over.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openScreen, playwright, tools, DESKTOP, PHONE } from './helpers/ux-page.mjs';

test('every Career screen that loads career-theme.css carries data-career-surface on <html>', () => {
  const pages = readdirSync(tools).filter((f) => f.endsWith('.html'));
  const themed = pages.filter((f) => readFileSync(join(tools, f), 'utf8').includes('career-theme.css'));
  assert.ok(themed.includes('career-experience-bank.html'), 'the experience library loads the Career theme');
  const missing = themed.filter((f) => !/<html\b[^>]*\bdata-career-surface=/.test(readFileSync(join(tools, f), 'utf8')));
  assert.deepEqual(missing, []);
});

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const bank = { version: 1, revision: 'r1', entries: [{ id: 'e1', title: 'Owned product', kind: 'project', organization: 'Home lab', period: '', facts: 'Built it.', skills: ['Python'] }] };
const api = ({ url }) => (url.pathname === '/api/career-hunter/experience-bank' ? { json: bank } : null);

for (const [name, size] of [['desktop', DESKTOP], ['phone', PHONE]]) {
  test(`${name}: fields have an edge and one primary at a time`, async () => {
    const { page, context } = await openScreen(browser, 'career-experience-bank.html', api, size);
    try {
      await page.locator('.entry').first().waitFor();
      const edge = await page.locator('#title').evaluate((el) => getComputedStyle(el).borderTopColor);
      const page_ = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert.notEqual(edge, page_, 'the field edge differs from the page');
      assert.notEqual(edge, 'rgba(0, 0, 0, 0)');
      assert.deepEqual(await page.locator('.ck-primary').allInnerTexts(), ['Add experience']);
      await page.locator('#title').fill('Volunteer coach');
      assert.deepEqual(await page.locator('.ck-primary').allInnerTexts(), ['Save experience']);
      assert.equal(await page.locator('h1').count(), 0, 'the shell names the screen');
      assert.equal(await page.locator('#facts').getAttribute('rows'), '6');
      const save = await page.locator('#save').boundingBox();
      if (name === 'desktop') assert.ok(save.y + save.height <= 900, `Save is on screen at 1440x900 (y=${save.y})`);
    } finally { await context.close(); }
  });
}
