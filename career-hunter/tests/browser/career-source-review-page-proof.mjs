/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the shipped Companies page in Chromium with the nightly source review: employer text stays inert, a missing or unreadable report never hides the table, and the card fits a phone.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Where a change waits for the next pull: Resolve and Accept save it and say so, what the pull did shows in words with employer text inert, and an older answer still loads.
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
let answer, server, origin, browser, refuse = null;
const posted = [];

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/api/career-hunter/companies-admin/list') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(answer));
      return;
    }
    if (req.url.startsWith('/api/career-hunter/companies-admin/seturl')) {
      const query = new URL(req.url, 'http://fixture').searchParams;
      posted.push({companyId: query.get('companyId'), url: query.get('url'), board: query.get('board')});
      res.setHeader('content-type', 'application/json');
      res.statusCode = refuse ? refuse.status : 202;
      res.end(JSON.stringify(refuse ? refuse.body : {ok: true, queued: true, message: 'Saved. The next nightly pull applies this and reads its jobs.',
        request: {id: 'new', companyId: Number(query.get('companyId')), target: query.get('url') || query.get('board'), state: 'waiting', detail: {}}}));
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

async function open(sourceReview, viewport = {width: 1280, height: 800}, sourceChangeMode = undefined, sourceChanges = []) {
  answer = {companies, sourceHealth: {available: true}, sourceReview, sourceChangeMode, sourceChanges};
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

test('resolve saves the change and the row says it is waiting', async () => {
  const {page, errors} = await open(null, undefined, 'next-pull');
  assert.ok((await page.locator('#companiesIntro').innerText()).includes('next nightly pull'));
  await page.locator('#rows input').fill('https://boards.greenhouse.io/localcollege');
  await page.locator('#rows button', {hasText: 'Resolve'}).click();
  await page.waitForSelector('#rows .change');
  assert.equal(await page.locator('#rows .change').innerText(), 'Waiting for the next nightly pull.');
  assert.ok((await page.locator('#rows .msg').innerText()).includes('Saved.'));
  assert.deepEqual(posted.at(-1), {companyId: '1', url: 'https://boards.greenhouse.io/localcollege', board: null});
  assert.ok((await page.locator('#sourceChanges').innerText()).includes('Local College'));
  assert.equal(await page.locator('#rows button', {hasText: 'Resolve'}).isDisabled(), false, 'a second thought can be saved too');
  assert.deepEqual(errors, []);
  await page.close();
});

test('a suggestion is accepted with one press, naming the board', async () => {
  const suggested = {...report, review: {...report.review, suggested: [{id: 1, company: hostile, options: ['lever:one', 'ashby:two'], jobs: 5, reason: 'several boards'}]}};
  const {page, errors} = await open(suggested, undefined, 'next-pull');
  await page.locator('#sourceReview summary', {hasText: 'Suggested'}).click();
  assert.equal(await page.locator('button.accept').count(), 2);
  await page.locator('button.accept', {hasText: 'ashby:two'}).click();
  await page.waitForFunction(() => document.querySelector('#sourceReview').innerText.includes('Saved. Waiting'));
  assert.deepEqual(posted.at(-1), {companyId: '1', url: null, board: 'ashby:two'});
  assert.equal(await page.locator('button.accept').count(), 0, 'one answer per employer');
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a refused change says why and can be tried again', async () => {
  const suggested = {...report, review: {...report.review, suggested: [{id: 1, company: 'Maybe Co', options: ['lever:one'], reason: 'several boards'}]}};
  const {page} = await open(suggested, undefined, 'next-pull');
  refuse = {status: 400, body: {ok: false, error: 'A company and a job board link are required.'}};
  await page.locator('#sourceReview summary', {hasText: 'Suggested'}).click();
  await page.locator('button.accept').click();
  await page.waitForFunction(() => document.querySelector('#sourceReview').innerText.includes('job board link are required'));
  assert.equal(await page.locator('button.accept').isDisabled(), false);
  refuse = null;
  await page.close();
});

test('what the pull did shows in words on the row and in the list, with employer text inert', async () => {
  const changes = [
    {id: 'a', companyId: 1, target: 'greenhouse:new', state: 'applied', detail: {board: 'greenhouse:new', jobs: 1252, new: 40}},
    {id: 'b', companyId: 1, target: 'lever:x', state: 'duplicate', detail: {board: 'lever:x', owner: hostile}},
    {id: 'c', companyId: 77, target: 'https://x.example/', state: 'saved_no_jobs', detail: {}},
    {id: 'd', companyId: 1, target: 'lever:y', state: 'interrupted', detail: {}},
    {id: 'e', companyId: 1, target: hostile, state: 'something-new', detail: {}},
    null,
  ];
  const {page, errors} = await open(null, undefined, 'next-pull', changes);
  assert.equal(await page.locator('#rows .change').innerText(), 'Applied: now reading greenhouse:new, 1,252 jobs, 40 new, 0 closed.');
  const list = await page.locator('#sourceChanges').innerText();
  for (const expected of ['Local College', 'already uses lever:x', 'Company 77', 'no jobs could be read', 'stopped 3 times', 'could not read it'])
    assert.ok(list.includes(expected), expected);
  assert.ok(list.includes('<img src=x'), 'an employer name shows as text');
  assert.equal(await page.locator('#sourceChanges img').count(), 0);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.deepEqual(errors, []);
  await page.close();
});

test('an applied change can be undone with one press, and says how many jobs it closed', async () => {
  const changes = [{id: 'a', companyId: 1, target: 'greenhouse:new', state: 'applied', detail: {board: 'greenhouse:new', jobs: 9, new: 2, closed: 953, from: 'greenhouse:old'}},
    {id: 'b', companyId: 1, target: 'lever:older', state: 'applied', detail: {board: 'lever:older', jobs: 1, new: 0, closed: 0, from: 'lever:oldest'}},
    {id: 'c', companyId: 77, target: 'lever:first', state: 'applied', detail: {board: 'lever:first', jobs: 1, new: 1, closed: 0, from: 'none:'}}];
  const {page, errors} = await open(null, undefined, 'next-pull', changes);
  assert.ok((await page.locator('#sourceChanges').innerText()).includes('953 closed'));
  assert.equal(await page.locator('button.undo').count(), 1, 'only the newest for an employer, and only with something to go back to');
  await page.locator('button.undo').click();
  await page.waitForFunction(() => document.querySelector('#rows .change').innerText.startsWith('Waiting'));
  assert.deepEqual(posted.at(-1), {companyId: '1', url: null, board: 'greenhouse:old'});
  assert.equal(await page.locator('button.undo').count(), 0, 'the undo itself now waits');
  assert.deepEqual(errors, []);
  await page.close();
});

test('an installation that changes sources at once keeps resolving at once and offers no Accept', async () => {
  const suggested = {...report, review: {...report.review, suggested: [{id: 1, company: 'Maybe Co', options: ['lever:one'], reason: 'several boards'}]}};
  const {page, errors} = await open(suggested, undefined, 'now');
  await page.locator('#sourceReview summary', {hasText: 'Suggested'}).click();
  assert.equal(await page.locator('button.accept').count(), 0);
  assert.ok((await page.locator('#sourceReview').innerText()).includes('press Resolve'));
  assert.equal(await page.locator('#sourceChanges').isVisible(), false);
  assert.ok((await page.locator('#companiesIntro').innerText()).includes('scrape now'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('an answer with no change fields, from an older build, still loads', async () => {
  const {page, errors} = await open(report, undefined, undefined, undefined);
  assert.equal(await page.locator('#rows button', {hasText: 'Resolve'}).count(), 1);
  assert.equal(await page.locator('#sourceChanges').isVisible(), false);
  assert.deepEqual(errors, []);
  await page.close();
});

test('the card fits a phone', async () => {
  const {page} = await open(report, {width: 412, height: 915});
  const box = await page.locator('#sourceReview').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 412, JSON.stringify(box));
  await page.close();
});
