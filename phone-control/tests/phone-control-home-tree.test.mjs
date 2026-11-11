/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.6.0 (Roger, 2026-11-10: "a tree list on the left, tables on the right ... we should be able to rename connections ... on the add a device screen there are buttons that the text doesnt fit"). The real page in Chromium over the stand-in server, at desktop and phone size: computers with their phones and TVs under them, rows that start at the left, a details pane beside the tree (under the row on a phone) with a Connection table, a rename that calls the save route, and no button in Add a device that cuts its words.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(resolve(here, '../../scripts/toolchain/noop.js'))('playwright');
const port = 4900 + Math.floor(Math.random() * 90);
let server, browser;
before(async () => {
  server = spawn(process.execPath, [join(here, 'support', 'standin-server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.kill(); });

async function open(viewport) {
  const page = await browser.newPage({ viewport });
  page.errors = []; page.on('pageerror', (error) => page.errors.push(String(error.message)));
  page.saves = []; page.on('request', (request) => { if (request.method() === 'POST' && /\/api\/phone-control\/devices\/[^/]+$/.test(new URL(request.url()).pathname)) page.saves.push(request.postDataJSON()); });
  for (let i = 0; i < 40; i += 1) { try { await page.goto(`http://127.0.0.1:${port}/api/phone-control/ui`, { waitUntil: 'networkidle' }); break; } catch { await new Promise((done) => setTimeout(done, 250)); } }
  await page.locator('#computerRail .pc-rail-item').first().waitFor();
  return page;
}
const names = (list) => list.locator(':scope > li > .pc-row-line .pc-rail-name').evaluateAll((els) => els.map((el) => el.firstChild.textContent));

for (const viewport of [{ width: 1280, height: 900 }, { width: 412, height: 915 }]) {
  test(`${viewport.width} px: computers with their phones and TVs under them; details in tables; rows start at the left`, { timeout: 60000 }, async () => {
    const page = await open(viewport);
    try {
      assert.equal(await page.locator('#pageLede').innerText(), '9 phones and TVs · 3 computers.');
      assert.deepEqual(await names(page.locator('#computerRail')), ['my-computer', 'spark-f255', 'old-laptop'], 'connected computers first');
      const spark = page.locator('#computerRail > li', { hasText: 'spark-f255' });
      assert.deepEqual(await names(spark.locator('.pc-children')), ['Fire TV', 'Pixel 9', 'Living Room TV'], 'what connects through the Spark is under it');
      assert.equal(await page.locator('#phoneRailTitle').innerText(), 'NOT ATTACHED TO A COMPUTER ON THIS LIST');
      assert.deepEqual(await names(page.locator('#phoneRail')), ['Office Amazon TV', 'Galaxy S25', 'Kitchen tablet']);
      const leftGaps = await page.locator('.pc-rail-item').evaluateAll((rows) => rows.map((row) => Math.round(row.querySelector('.pc-rail-name').getBoundingClientRect().left - row.getBoundingClientRect().left)));
      assert.ok(leftGaps.every((gap) => gap <= 60), `every name starts at the left of its row: ${leftGaps}`);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.equal(over, 0, 'no sideways scroll');
      const inside = await page.locator('.pc-rail .pc-row-details').evaluateAll((buttons) => { const card = document.querySelector('.pc-rail').getBoundingClientRect(); return buttons.every((b) => b.getBoundingClientRect().right <= card.right + 0.5); });
      assert.equal(inside, true, 'every Details button is inside the card');

      const toggle = spark.locator(':scope > .pc-row-line .pc-tree-toggle');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await toggle.click();
      assert.equal(await page.locator('#computerRail > li', { hasText: 'spark-f255' }).locator('.pc-children').count(), 0, '− hides what is under it');
      await page.locator('#computerRail > li', { hasText: 'spark-f255' }).locator(':scope > .pc-row-line .pc-tree-toggle').click();

      const fireTv = (await page.locator('li[data-entry]', { hasText: 'Fire TV' }).last().getAttribute('data-entry')).split(':')[1];
      await page.locator('li[data-entry]', { hasText: 'Fire TV' }).last().getByRole('button', { name: 'Details of Fire TV' }).click();
      const details = page.locator('.pc-details');
      assert.equal(await details.locator('.pc-details-name').innerText(), 'Fire TV');
      const rows = Object.fromEntries(await details.locator('.pc-detail-table tr').evaluateAll((trs) => trs.map((tr) => [tr.querySelector('th').textContent, tr.querySelector('td').textContent])));
      assert.deepEqual(Object.keys(rows), ['How it connects', 'Through', 'State', 'Control', 'Address']);
      assert.equal(rows['Through'], 'spark-f255');
      assert.ok(Object.values(rows).every((value) => value.trim().length > 0), JSON.stringify(rows));
      const tree = await page.locator('.pc-rail').boundingBox(), panel = await details.boundingBox();
      if (viewport.width >= 900) {
        assert.ok(panel.x >= tree.x + tree.width - 1, 'the details stand beside the tree');
        assert.ok(tree.width + (await page.locator('#deviceDetails').boundingBox()).width >= viewport.width * 0.9, 'together they fill the page');
      } else {
        const row = await page.locator('li[data-entry]', { hasText: 'Fire TV' }).last().locator(':scope > .pc-row-line').boundingBox();
        assert.ok(panel.y >= row.y + row.height - 1 && panel.x >= tree.x, 'the details open under their row');
        assert.equal(await page.locator('#deviceDetails').isVisible(), false);
      }

      await details.getByRole('button', { name: 'Rename' }).click();
      await details.getByLabel('New name').fill('Office Amazon TV 2');
      await details.getByRole('button', { name: 'Save' }).click();
      await page.waitForFunction(() => window.performance.getEntriesByType('resource').length > 0);
      await assert.doesNotReject(async () => { for (let i = 0; i < 40 && !page.saves.length; i += 1) await page.waitForTimeout(50); });
      assert.deepEqual(page.saves, [{ name: 'Office Amazon TV 2' }], 'Rename saves the new name through the device route');
      await page.locator('li[data-entry]', { hasText: 'Office Amazon TV 2' }).first().waitFor();
      // The stand-in keeps what it is told, as the real route does: put the name back for the next run.
      await page.request.post(`http://127.0.0.1:${port}/api/phone-control/devices/${fireTv}`, { data: { name: 'Fire TV' } });

      const computer = page.locator('#computerRail > li', { hasText: 'spark-f255' });
      await computer.locator(':scope > .pc-row-line').getByRole('button', { name: 'Details of spark-f255' }).click();
      const headings = await page.locator('.pc-details .pc-detail-heading').allInnerTexts();
      assert.deepEqual(headings.map((text) => text.toUpperCase()), ['CONNECTION', 'WHAT IT CAN DO'], 'a computer also lists what it can do');
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });
}

test('Add a device: every button shows all of its words at phone and desktop size', { timeout: 60000 }, async () => {
  for (const viewport of [{ width: 412, height: 915 }, { width: 1280, height: 900 }]) {
    const page = await open(viewport);
    try {
      await page.getByRole('button', { name: 'Add a device' }).click();
      await page.locator('#connectSheet').waitFor({ state: 'visible' });
      await page.waitForTimeout(500);
      const cut = await page.locator('#connectSheet button:visible').evaluateAll((buttons) => buttons.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim()));
      assert.deepEqual(cut, [], `no button cuts its words at ${viewport.width} px`);
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  }
});
