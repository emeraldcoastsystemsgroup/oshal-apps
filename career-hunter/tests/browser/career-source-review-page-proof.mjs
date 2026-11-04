/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the shipped Companies page in Chromium with the nightly source review: employer text stays inert, a missing or unreadable report never hides the table, and the card fits a phone.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import http from 'node:http';

const deps = createRequire(resolve(process.env.STORE_CI_TOOLCHAIN || 'scripts/toolchain', 'package.json'));
const {chromium} = deps('playwright');
const pageHtml = readFileSync(new URL('../../tools/career-companies.html', import.meta.url), 'utf8');
const hostile = '<img src=x onerror="window.__injected=1">Hostile & Co';
const companies = [{id: 1, name: 'Local College', ats_type: 'greenhouse', ats_token: 'local', active_jobs: 3, discover_status: 'found',
  careers_url: 'https://careers.example/', pull_health: {status: 'ok', new_count: 1, changed_count: 0, unchanged_count: 2, closed_count: 0}}];
const report = {
  version: 1, finishedAt: '2026-11-04T09:00:00+00:00', seconds: 600,
  sources: {whole: 520, unverified: 370, empty: 150, failed: 60, noFeed: 190}, previousSources: {whole: 513},
  delta: {read: 468503, new: 15846, changed: 9452, unchanged: 444395, closed: 3748, notModified: 44},
  review: {checked: 60, waiting: 370, outcomes: {repaired: 2, suggested: 1, blocked: 4},
    repaired: [{company: hostile, from: 'greenhouse:old', to: 'greenhouse:new', jobs: 12}],
    suggested: [{company: 'Maybe Co', options: ['lever:maybeco'], jobs: 5, reason: 'name match only'}],
    duplicates: [{company: 'Sub Co', board: 'lever:parent', owner: 'Parent Co'}]},
  massClosed: [{company: 'Big Closer', ats: 'workday', closed: 6262, kept: 2000}],
  stuck: [{company: 'Stuck Feed', ats: 'phenom', jobs: 8000}],
  stillBroken: [{company: 'Dead Feed', ats: 'web', code: 'browser_navigation_failed', pulls: 9}],
};
let answer, server, origin, browser;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/api/career-hunter/companies-admin/list') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(answer));
      return;
    }
    if (req.url.startsWith('/shared/')) { res.statusCode = 204; res.end(); return; }
    res.setHeader('content-type', 'text/html');
    res.end(pageHtml);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise(done => server.close(done));
});

async function open(sourceReview, viewport = {width: 1280, height: 800}) {
  answer = {companies, sourceHealth: {available: true}, sourceReview};
  const page = await browser.newPage({viewport});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/');
  await page.waitForSelector('#rows tr');
  return {page, errors};
}

test('the report says what happened, and employer text stays inert', async () => {
  const {page, errors} = await open(report);
  const card = page.locator('#sourceReview');
  assert.equal(await card.isVisible(), true);
  const text = await card.innerText();
  for (const expected of ['Nightly source review', 'Checked 60 sources', '370 waiting', 'Repaired', 'Refused us', 'Verified whole: 520 (was 513)',
    'read 468,503 jobs', '15,846 new', '44 sources answered not modified']) assert.ok(text.includes(expected), expected);
  await page.locator('#sourceReview summary').first().click();
  assert.ok((await card.innerText()).includes('<img src=x'), 'the employer name shows as text');
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.equal(await card.locator('img').count(), 0);
  assert.equal(await card.locator('details').count(), 6);
  assert.deepEqual(errors, []);
  await page.close();
});

test('before the first report the card is absent and the companies still load', async () => {
  const {page, errors} = await open(null);
  assert.equal(await page.locator('#sourceReview').isVisible(), false);
  assert.ok((await page.locator('#rows').innerText()).includes('Local College'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('an unreadable or partial report says so and the companies still load', async () => {
  const shape = {sources: {}, delta: {}};
  for (const broken of [{unreadable: true}, {version: 2, review: {}}, {...shape, review: {outcomes: {}, repaired: 'not a list'}},
    {...shape, review: {outcomes: {}, repaired: [null, {company: 'Only Name'}], suggested: [{company: 'No Options'}]}}]) {
    const {page, errors} = await open(broken);
    assert.equal(await page.locator('#sourceReview').isVisible(), true);
    assert.ok((await page.locator('#rows').innerText()).includes('Local College'));
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test('the card fits a phone', async () => {
  const {page} = await open(report, {width: 412, height: 915});
  const box = await page.locator('#sourceReview').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 412, JSON.stringify(box));
  await page.close();
});
