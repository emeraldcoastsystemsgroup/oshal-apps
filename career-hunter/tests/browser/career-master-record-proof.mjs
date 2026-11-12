/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Master record page (tools/career-master-record.html, 1.51.0) in Chromium at 412x915 and 1280x900, its data answered by the REAL compiled route and reader over a made-up person's store: every bullet and every history date is on screen, Download saves one .md holding every bullet, skill and history record (and none of Career's private writing notes), Print or save as PDF is in More and calls the browser's print, Download is the one primary, and nothing scrolls sideways. Screenshots go to CAREER_PROOF_SHOTS when it names a folder.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Page names, judge's report 2026-11-11 (tests/career-page-names.test.mjs holds them): the file the page saves is named career-data and the date.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openScreen, playwright } from '../helpers/ux-page.mjs';
import { loadCompiledModules } from '../helpers/career-route-harness.mjs';
import { madeUpProfile, sqliteAdapter, writeStore } from '../helpers/career-master-record-fixture.mjs';

const SIZES = {
  phone: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 900 } },
};
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-master-record-proof-'));
const priorRoot = process.env.JOBHUNTER_STORE_ROOT;
process.env.JOBHUNTER_STORE_ROOT = root;
writeStore(path.join(root, 'default', 'alex'), { mark: 'ALEX' });
const profile = madeUpProfile('ALEX');
const { modules } = loadCompiledModules({ routes: 'routes/career-master-record-routes.js' }, { 'better-sqlite3': sqliteAdapter() });

/** The real route's answer for the signed-in made-up person, as the page fetches it. */
function career({ url }) {
  if (url.pathname !== '/api/career-hunter/master-record') return null;
  let status = 200, json;
  const res = { status(code) { status = code; return res; }, json(value) { json = value; return res; }, setHeader() { return res; } };
  modules.routes.serveMasterRecord({ query: Object.fromEntries(url.searchParams), headers: {}, oidc: { user: { sub: 'alex' } } }, res);
  return { status, json };
}

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => {
  await browser?.close();
  if (priorRoot === undefined) delete process.env.JOBHUNTER_STORE_ROOT; else process.env.JOBHUNTER_STORE_ROOT = priorRoot;
  fs.rmSync(root, { recursive: true, force: true });
});

const bullets = profile.roles.flatMap((role) => role.deliverables);
const skills = Object.values(profile.skills).flatMap((group) => group.items);
const historyDates = ['2026-11-09 02:35:36', '2026-06-15 09:00:00', '2026-06-05 10:15:00'];

for (const [name, size] of Object.entries(SIZES)) {
  test(`${name} ${size.viewport.width}x${size.viewport.height}: every bullet and date on screen, Download, Print, no sideways scroll`, async () => {
    const { page, context } = await openScreen(browser, 'career-master-record.html', career, size);
    try {
      await page.locator('#counts').waitFor();
      for (const bullet of bullets) assert.equal(await page.getByText(bullet, { exact: true }).first().isVisible(), true, bullet);
      for (const date of historyDates) assert.equal(await page.getByRole('heading', { name: new RegExp(`^${date}`) }).isVisible(), true, date);
      assert.deepEqual(await page.locator('.ck-primary').allInnerTexts(), ['Download'], 'Download is the one primary');
      const sideways = await page.evaluate(() => [document.documentElement.scrollWidth, document.body.scrollWidth, window.innerWidth]);
      assert.ok(sideways[0] <= sideways[2] && sideways[1] <= sideways[2], `no sideways scroll (${sideways.join(' / ')})`);
      if (process.env.CAREER_PROOF_SHOTS) await page.screenshot({ path: path.join(process.env.CAREER_PROOF_SHOTS, `master-record-${name}.png`), fullPage: true });

      const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
      assert.match(file.suggestedFilename(), /^career-data-\d{4}-\d{2}-\d{2}\.md$/);
      const markdown = fs.readFileSync(await file.path(), 'utf8');
      for (const item of [...bullets, ...skills, ...historyDates, 'ALEX-WORDS second fact', 'ALEX-ANSWER ran Kubernetes at scale']) {
        assert.ok(markdown.includes(item), `the download holds ${item}`);
      }
      for (const kept of ['ALEX-NOTE', 'ALEX-GAP', 'ALEX-LOCKED']) assert.equal(markdown.includes(kept), false, `${kept} stays on screen only`);
      assert.equal(await page.getByText('ALEX-NOTE frame the platform as a product').isVisible(), true, 'the notes are on screen');

      await page.evaluate(() => { window.printed = 0; window.print = () => { window.printed += 1; }; });
      await page.getByRole('button', { name: 'More' }).click();
      const print = page.getByRole('menuitem', { name: 'Print or save as PDF' });
      assert.equal(await print.isVisible(), true);
      await print.click();
      assert.equal(await page.evaluate(() => window.printed), 1);
    } finally { await context.close(); }
  });
}
