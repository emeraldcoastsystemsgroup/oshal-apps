/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The suggestions on the page are the ones the engine keeps: two found two nights before the newest report, which itself suggested nothing, are listed with the date they were found, and one still takes Accept.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive source maintenance on the shipped Companies page in Chromium, through the shipped routes and library over the corpus the engine really writes: Needs you says what was tried, Archive and Keep trying are saved for the next pull exactly as the kernel takes them and the line says so, a brief is copied and downloaded whole, a suggestion takes the existing Accept, a removed employer appears on no card, employer text stays inert, and the cards fit a phone with 44px controls.
 */
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import http from 'node:http';
import {buildCorpus, loadRoutes, HOSTILE} from '../helpers/career-maintenance-corpus.mjs';

const deps = createRequire(resolve(process.env.STORE_CI_TOOLCHAIN || 'scripts/toolchain', 'package.json'));
const {chromium} = deps('playwright');
const pageHtml = readFileSync(new URL('../../tools/career-companies.html', import.meta.url), 'utf8');

let corpus, routes, server, origin, browser, override = null;

before(async () => {
  corpus = buildCorpus();
  process.env.OSHAL_EGRESS = 'kernel';
  routes = loadRoutes(corpus).registered;
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    const route = url.pathname.replace('/api/career-hunter', '');
    const handlers = url.pathname.startsWith('/api/career-hunter/') && routes.get(route);
    if (handlers) {
      const reply = {statusCode: 200, setHeader: (k, v) => res.setHeader(k, v), status(code) { reply.statusCode = code; return reply; },
        json(value) {
          const answer = override && route === '/companies-admin/list' ? {...value, ...override} : value;
          res.statusCode = reply.statusCode; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(answer));
        }};
      const request = {sub: 'fixture-admin', query: Object.fromEntries(url.searchParams), path: route, accepts: () => 'json'};
      handlers[0](request, reply, () => handlers[1](request, reply));
      return;
    }
    if (req.url.startsWith('/shared/') || req.url.startsWith('/api/')) { res.statusCode = 204; res.end(); return; }
    res.setHeader('content-type', 'text/html');
    res.end(pageHtml);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  await new Promise(done => (server ? server.close(done) : done()));
  corpus?.close();
});

async function open(viewport = {width: 1280, height: 900}) {
  const context = await browser.newContext({viewport, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write']});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/companies-admin?view=health');
  await page.waitForSelector('#rows tr', {state: 'attached'});
  return {page, context, errors};
}

const saved = target => corpus.outbox().filter(entry => entry.target === target).map(entry => entry.companyId);
const brief = () => corpus.db.prepare("SELECT brief FROM corpus.source_repair_briefs WHERE state='open'").get().brief;

test('the three cards sit above the nightly review and say what happened, with employer text inert', async () => {
  const {page, context, errors} = await open();
  const order = await page.evaluate(() => ['needsYou', 'forDeveloper', 'newSources', 'sourceReview'].map(id => document.getElementById(id).getBoundingClientRect().top));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'Needs you, For a developer, New sources found, then the review');
  assert.ok(order[0] > 0 && await page.isVisible('#sourceReview'));
  const needs = await page.innerText('#needsYou');
  assert.match(needs, /Career could not connect 2 sources\. Archive closes the employer's open jobs and stops reading it, the same as Remove, and Put back undoes it\. Keep trying leaves it listed and does not ask again for 60 days\./);
  assert.ok(needs.includes(HOSTILE), 'the name is shown as it is written');
  assert.match(needs, /Tried greenhouse:hostileboard and https:\/\/hostileboard\.example\/careers\. The nightly review checked 3 times in a row without connecting it, last on [\d/.-]+: nothing was found\./);
  assert.match(needs, /The pull has not read it 5 times in a row\. An empty response does not prove every job closed\. Jobs were last read on [\d/.-]+\. 2 open jobs are still stored\./);
  assert.equal(await page.locator('#needsYou li').count(), 2);
  assert.match(await page.innerText('#forDeveloper'), /pinpoint reader\s+This connector has no complete-feed proof yet\. 3 employers, 15 open jobs stored\./);
  const found = await page.innerText('#newSources');
  assert.match(found, /Last night Career looked for a job site for 1 employer that has none\. 2 wait for a later night\./);
  assert.match(found, /Connected \(1\)\s+Fresh Co: now reading pinpoint:careers\.freshco\.example, 3 jobs\./);
  assert.match(found, /Suggested, not connected \(2\)/, 'kept from two nights ago: last night\'s report suggested nothing');
  assert.match(found, /Other Co: greenhouse:zzholdings, 3 jobs\. Found on [\d/.-]+\. Not connected because the board's name does not look like this employer\./);
  assert.match(found, /Sub Co: pinpoint:careers\.partial0\.example, 4 jobs\. Found on [\d/.-]+\. Partial 0 Co already uses this board\./);
  assert.equal(await page.locator('#newSources button.accept').count(), 1, 'a board another employer holds cannot be accepted');
  for (const card of ['#needsYou', '#forDeveloper', '#newSources']) assert.doesNotMatch(await page.innerText(card), /Gone Co/, card);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  assert.equal(await page.locator('#needsYou img, #needsYou script').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Keep trying is saved for the next pull, the line says so, and it still says so after a reload', async () => {
  const {page, context} = await open();
  const quiet = corpus.id('Quiet Board Co');
  const line = page.locator('#needsYou li', {hasText: 'Quiet Board Co'});
  await line.locator('button.keep').click();
  await line.locator('.saved').waitFor();
  assert.equal(await line.locator('.saved').innerText(), 'Saved. From the next nightly pull, Career keeps trying Quiet Board Co and does not ask about it again for 60 days.');
  assert.equal(await line.locator('button').count(), 0);
  assert.deepEqual(saved('keep:employer'), [quiet]);
  assert.deepEqual(saved('remove:employer'), [], 'nothing was archived');
  await page.getByRole('tab', {name: 'Companies'}).click();
  assert.match(await page.innerText('#sourceChanges'), /Quiet Board Co: Keep trying\. Waiting for the next nightly pull\./);
  await page.goto(origin + '/companies-admin?view=health');
  await page.waitForSelector('#needsYou li');
  const again = page.locator('#needsYou li', {hasText: 'Quiet Board Co'});
  assert.equal(await again.locator('.saved').innerText(), 'Keep trying is saved for the next nightly pull.');
  assert.equal(await again.locator('button').count(), 0, 'not offered twice');
  await context.close();
});

test('Archive is the existing Remove, saved for the next pull, with the employer\'s name inert in what it says', async () => {
  const {page, context} = await open();
  const hostile = corpus.id(HOSTILE);
  const line = page.locator('#needsYou li').first();
  await line.locator('button.archive').click();
  await line.locator('.saved').waitFor();
  assert.equal(await line.locator('.saved').innerText(), `Saved. The next nightly pull closes the jobs of ${HOSTILE} and stops reading it.`);
  assert.deepEqual(saved('remove:employer'), [hostile]);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  await context.close();
});

test('a brief is copied whole and downloaded whole under its reader and reason', async () => {
  const {page, context} = await open();
  const line = page.locator('#forDeveloper li').first();
  await line.locator('button.copy-brief').click();
  await page.waitForFunction(() => document.querySelector('#forDeveloper li .msg').textContent === 'Copied.');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), brief());
  const [download] = await Promise.all([page.waitForEvent('download'), line.locator('a.download').click()]);
  assert.equal(download.suggestedFilename(), 'brief-pinpoint-completion_unverified.md');
  assert.equal(readFileSync(await download.path(), 'utf8'), brief());
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('refused')); document.execCommand = () => false; });
  await line.locator('button.copy-brief').click();
  await page.waitForFunction(() => document.querySelector('#forDeveloper li .msg').textContent === 'Could not copy here. Use Download.');
  await context.close();
});

test('a suggestion takes the existing Accept: the board is saved for the next pull', async () => {
  const {page, context} = await open();
  const line = page.locator('#newSources li', {hasText: 'Other Co'});
  await line.locator('button.accept').click();
  await page.waitForFunction(() => /Saved\. Waiting for the next pull\./.test(document.querySelector('#newSources').textContent));
  assert.deepEqual(saved('greenhouse:zzholdings'), [corpus.id('Other Co')]);
  assert.equal(await line.locator('button.accept').count(), 0);
  await context.close();
});

test('on a phone the cards stay inside the screen and every control is at least 44px high', async () => {
  override = {sourceChanges: []}; // As before anything was pressed, so every control is on the page.
  try {
    const {page, context} = await open({width: 412, height: 915});
    await page.waitForSelector('#forDeveloper li');
    const widths = await page.evaluate(() => [document.documentElement.scrollWidth, ...['needsYou', 'forDeveloper', 'newSources'].map(id => document.getElementById(id).getBoundingClientRect().right)]);
    assert.ok(widths.every(width => width <= 412), `nothing runs off the screen: ${widths}`);
    const controls = await page.locator('#needsYou button:visible, #forDeveloper button:visible, #forDeveloper a.download:visible, #newSources button:visible').all();
    assert.deepEqual((await Promise.all(controls.map(control => control.innerText()))).sort(),
      ['Accept greenhouse:zzholdings', 'Archive', 'Archive', 'Copy brief', 'Download', 'Keep trying', 'Keep trying']);
    for (const control of controls) assert.ok((await control.boundingBox()).height >= 44, await control.innerText());
    await context.close();
  } finally { override = null; }
});

test('a refusal is said on the line, and with no maintenance yet or an unreadable one the companies still load', async () => {
  const fresh = corpus.id('Fresh Co');
  override = {sourceMaintenance: {report: null, briefs: [], actionCount: 1, keepTryingDays: 60,
    actions: [{id: 99, companyId: fresh, company: 'Fresh Co', openedAt: '2026-11-10T09:00:00+00:00', evidence: {board: 'pinpoint:x', reviews: [], openJobs: 3}}]}};
  try {
    let {page, context} = await open();
    const line = page.locator('#needsYou li').first();
    await line.locator('button.keep').click();
    await page.waitForFunction(() => /no decision waiting/.test(document.querySelector('#needsYou li .msg').textContent));
    assert.equal(await line.locator('.msg').innerText(), 'Fresh Co has no decision waiting.');
    assert.equal(await line.locator('button.keep').isEnabled(), true);
    assert.deepEqual(saved('keep:employer').filter(id => id === fresh), []);
    await context.close();
    override = {sourceMaintenance: null};
    ({page, context} = await open());
    assert.deepEqual(await Promise.all(['#needsYou', '#forDeveloper', '#newSources'].map(card => page.isVisible(card))), [false, false, false]);
    assert.ok(await page.locator('#rows tr').count() > 0);
    await context.close();
    override = {sourceMaintenance: {unreadable: true}};
    ({page, context} = await open());
    assert.match(await page.innerText('#needsYou'), /Source maintenance could not be read\./);
    assert.ok(await page.locator('#rows tr').count() > 0);
    await context.close();
    override = {sourceChangeMode: 'now', sourceChanges: []};
    ({page, context} = await open());
    await page.waitForSelector('#needsYou li');
    assert.equal(await page.locator('#needsYou button').count(), 0, 'no Archive or Keep trying where no nightly pull applies them');
    await context.close();
  } finally { override = null; }
});
