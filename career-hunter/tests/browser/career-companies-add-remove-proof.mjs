/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive Add employer, Remove and Put back on the shipped Companies page in Chromium, through the shipped routes and library into a real outbox folder over a real SQLite corpus: what is saved is exactly what the kernel takes, refusals are said in the form, removed employers sit only under Removed, outcomes are words with employer text inert, Needs attention ignores hand-set boards and partial reads that have jobs, and the form fits a phone.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The shipped routes are handed the whole source-health library, as they are in the package: the list now also reads source maintenance through it.
 */
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import http from 'node:http';

const require = createRequire(import.meta.url);
const deps = createRequire(resolve(process.env.STORE_CI_TOOLCHAIN || 'scripts/toolchain', 'package.json'));
const {chromium} = deps('playwright');
const sourceRequests = require('../../lib/career-source-requests');
const pageHtml = readFileSync(new URL('../../tools/career-companies.html', import.meta.url), 'utf8');
const hostile = '<img src=x onerror="window.__injected=1">Hostile & Co';

let server, origin, browser, db, owner, routes, override = null;

function outbox() {
  try { return readdirSync(join(owner, '.source-request-outbox')).map(name => JSON.parse(readFileSync(join(owner, '.source-request-outbox', name), 'utf8'))); }
  catch { return []; }
}

/** The shipped routes file with its kernel-side dependencies as plain doubles; its library, corpus reads and outbox are real. */
function loadRoutes() {
  const registered = new Map();
  const module = {exports: {}};
  const leaves = {
    '@/shared/logger': {createChildLogger: () => ({info(){}, warn(){}, error(){}})},
    '@/shared/middleware/authz': {isOperator: () => false},
    './career-user-store': {callerSub: () => 'fixture-admin', userPaths: () => ({userDir: owner}),
      openCorpusDb: () => ({prepare: sql => db.prepare(sql), close(){}}), openUserDb: () => { throw new Error('not used'); }},
    './career-engine-dispatch': {runCareerCliAwait: async () => { throw new Error('no engine on the native kernel'); }},
    './career-engine-response': {},
    './career-surface-routes': {createCareerToolFileHandler: () => () => {}},
    '../lib/career-source-health': require('../../lib/career-source-health'),
    '../lib/career-source-requests': sourceRequests,
  };
  process.env.CAREER_HUNTER_ADMIN_SUBS = 'fixture-admin';
  new Function('require', 'module', 'exports', readFileSync(new URL('../../routes/career-company-routes.js', import.meta.url), 'utf8'))(
    id => leaves[id], module, module.exports);
  const keep = (url, ...handlers) => registered.set(url, handlers);
  module.exports.registerCareerCompanyRoutes({get: keep, post: keep}, {});
  return registered;
}

before(async () => {
  owner = mkdtempSync(join(tmpdir(), 'career-add-remove-page-'));
  db = new DatabaseSync(':memory:');
  db.exec("ATTACH DATABASE ':memory:' AS corpus");
  db.exec(`CREATE TABLE corpus.companies(id INTEGER PRIMARY KEY,name TEXT,ats_type TEXT,ats_token TEXT,careers_url TEXT,discover_status TEXT,source_lists TEXT);
    CREATE TABLE corpus.postings_corpus(company_id INTEGER,active INTEGER);
    INSERT INTO corpus.companies VALUES(1,'Local College','greenhouse','local','https://careers.example/','found','[]');
    INSERT INTO corpus.companies VALUES(2,'Gone Industries',NULL,NULL,'https://gone.example/jobs','removed','[]');
    INSERT INTO corpus.postings_corpus VALUES(1,1),(1,1),(1,1);`);
  db.exec('PRAGMA query_only=ON');
  process.env.OSHAL_EGRESS = 'kernel';
  routes = loadRoutes();
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    const route = url.pathname.replace('/api/career-hunter', '');
    if (override && route === '/companies-admin/list') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(override)); return; }
    const handlers = url.pathname.startsWith('/api/career-hunter/') && routes.get(route);
    if (handlers) {
      const reply = {statusCode: 200, setHeader: (k, v) => res.setHeader(k, v), status(code) { reply.statusCode = code; return reply; },
        json(value) { res.statusCode = reply.statusCode; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); }};
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
  await new Promise(done => server ? server.close(done) : done());
  db?.close();
  rmSync(owner, {recursive: true, force: true});
});

async function open(viewport = {width: 1280, height: 900}) {
  const page = await browser.newPage({viewport});
  await page.goto(origin + '/companies-admin');
  await page.waitForSelector('#rows tr');
  return page;
}

test('Add employer saves the name and link for the next pull, and refuses a listed name or a missing link in the form', async () => {
  const page = await open();
  assert.equal(await page.isVisible('#addForm'), false);
  await page.click('#addEmployer');
  await page.fill('#addName', 'Acme Robotics');
  await page.click('#addSave');
  assert.match(await page.textContent('#addMsg'), /careers page or job board link/);
  await page.fill('#addLink', 'https://jobs.acme.example/search?team=a|b');
  await page.click('#addSave');
  await page.waitForFunction(() => /adds Acme Robotics/.test(document.querySelector('#addMsg').textContent));
  const saved = outbox().filter(entry => entry.target.startsWith('add:'));
  assert.deepEqual(saved.map(entry => [entry.companyId, entry.target]),
    [[sourceRequests.NEW_EMPLOYER, 'add:Acme%20Robotics|https%3A%2F%2Fjobs.acme.example%2Fsearch%3Fteam%3Da%7Cb']]);
  assert.match(await page.textContent('#sourceChanges'), /Acme Robotics: Add with https:\/\/jobs\.acme\.example\/search\?team=a\|b\. Waiting for the next nightly pull\./);
  await page.fill('#addName', 'local college');
  await page.fill('#addLink', 'https://other.example/');
  await page.click('#addSave');
  await page.waitForFunction(() => /already listed/.test(document.querySelector('#addMsg').textContent));
  assert.equal(await page.textContent('#addMsg'), 'Local College is already listed.');
  assert.equal(outbox().filter(entry => entry.target.startsWith('add:')).length, 1);
  await page.close();
});

test('Remove asks once in the row, Cancel leaves it, and Yes saves the removal under the employer\'s id', async () => {
  const page = await open();
  const row = page.locator('#rows tr', {hasText: 'Local College'});
  await row.locator('button.remove').click();
  assert.match(await row.textContent(), /Remove Local College\? The next pull closes its 3 open jobs and stops reading it\. Put back undoes it\./);
  await row.locator('button.cancel').click();
  await row.locator('button.remove').click();
  await row.locator('button.confirm').click();
  await page.waitForFunction(() => /closes the jobs of Local College/.test(document.querySelector('#rows').textContent));
  assert.deepEqual(outbox().filter(entry => entry.target === 'remove:employer').map(entry => entry.companyId), [1]);
  await page.close();
});

test('a removed employer is only under Removed, with Put back, and out of every other count', async () => {
  const page = await open();
  assert.equal(await page.locator('#rows tr', {hasText: 'Gone Industries'}).count(), 0);
  assert.equal(await page.textContent('#cntAll'), '(1)');
  assert.equal(await page.textContent('#cntNeeds'), '(0)');
  await page.click('#fltRemoved');
  assert.equal(await page.textContent('#fltRemoved'), 'Removed (1)');
  const row = page.locator('#rows tr', {hasText: 'Gone Industries'});
  await row.locator('button.restore').click();
  await page.waitForFunction(() => /lists Gone Industries again/.test(document.querySelector('#rows').textContent));
  assert.deepEqual(outbox().filter(entry => entry.target === 'restore:employer').map(entry => entry.companyId), [2]);
  await page.close();
});

test('what the pull did is said in words, employer text stays inert, and Needs attention skips hand-set boards and partial reads with jobs', async () => {
  const health = (status, code) => ({status, last_error_code: code || null});
  override = {sourceChangeMode: 'next-pull', sourceHealth: {available: true}, companies: [
    {id: 1, name: 'Local College', ats_type: 'greenhouse', active_jobs: 3, discover_status: 'found', pull_health: health('ok')},
    {id: 3, name: 'Hand Set', ats_type: 'jibe', active_jobs: 40, discover_status: 'manual', pull_health: health('ok')},
    {id: 4, name: 'Long List', ats_type: 'web', active_jobs: 25, discover_status: 'found', pull_health: health('partial', 'page_limit_reached')},
    {id: 5, name: 'Refused Co', ats_type: 'web', active_jobs: 0, discover_status: 'found', pull_health: health('failed', 'browser_refused')},
    {id: 9, name: hostile, ats_type: 'lever', active_jobs: 2, discover_status: 'manual', pull_health: health('ok')}],
    sourceChanges: [
      {id: 'a', companyId: 9, target: 'add:x|https%3A%2F%2Fh.example%2F', state: 'added', detail: {board: 'lever:hostile', jobs: 2, new: 2, name: hostile, companyId: 9}},
      {id: 'b', companyId: 2147483647, target: 'add:Dup%20Co|https%3A%2F%2Fd.example%2F', state: 'duplicate', detail: {owner: hostile, name: 'Dup Co'}},
      {id: 'c', companyId: 1, target: 'remove:employer', state: 'removed', detail: {closed: 1204, name: 'Local College'}},
      {id: 'd', companyId: 1, target: 'restore:employer', state: 'restored', detail: {name: 'Local College'}}]};
  try {
    const page = await open();
    const changes = await page.textContent('#sourceChanges');
    assert.match(changes, /Added: now reading lever:hostile, 2 jobs, 2 new\./);
    assert.match(changes, /Dup Co: Add with https:\/\/d\.example\/\. Not added: <img src=x onerror="window\.__injected=1">Hostile & Co is already listed\./);
    assert.match(changes, /Local College: Remove\. Removed: 1,204 open jobs closed\. The pull no longer reads it\./);
    assert.match(changes, /Local College: Put back\. Put back: the pull reads it again\./);
    assert.equal(await page.evaluate(() => window.__injected), undefined);
    assert.equal(await page.textContent('#cntNeeds'), '(1)', 'only Refused Co');
    assert.match(await page.locator('#rows tr', {hasText: 'Refused Co'}).textContent(), /The site refused the reader\./);
    await page.close();
  } finally { override = null; }
});

test('where changes apply at once there is no Add employer and no Remove, and the form fits a phone where they exist', async () => {
  override = {sourceChangeMode: 'now', companies: [{id: 1, name: 'Local College', ats_type: 'greenhouse', active_jobs: 3, discover_status: 'found'}]};
  try {
    const page = await open();
    assert.equal(await page.isVisible('#addEmployer'), false);
    assert.equal(await page.locator('button.remove').count(), 0);
    await page.close();
  } finally { override = null; }
  const phone = await open({width: 412, height: 915});
  await phone.click('#addEmployer');
  const widths = await phone.evaluate(() => [document.documentElement.scrollWidth, document.querySelector('#addForm').getBoundingClientRect().right]);
  assert.ok(widths[1] <= 412, `the form ends inside the screen: ${widths}`);
  for (const id of ['#addName', '#addLink', '#addSave', '#addEmployer']) {
    assert.ok((await phone.locator(id).boundingBox()).height >= 44, id);
  }
  await phone.close();
});
