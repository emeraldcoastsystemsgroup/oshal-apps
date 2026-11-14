/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career Coaching 0.1.0 page proof in Chromium at 412x915 and 1280x900. A local server mounts the package router with the in-memory store, answers every request only for the person the run names and only when that person's role in authorization.yaml holds the binding's permissions (403 otherwise, as a kernel refuses an unbound permission), serves fixture Career reads for the seeker, and plays the kernel's one-use confirmation and owner decision. Drives the real buttons: Get my code; Review, Share and the Share confirmation; the coach's card with its age, end and counts; Stop sharing in one press; Cancel; a role that does not open a view; and the truthful unavailable states while coach viewing is closed. No page error, no sideways scroll at phone width, 44px buttons. Made-up people and employers only.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const Module = require('node:module');
const {STORE, PACKAGE, cast, memoryRepo, standInKernel, expressHome} = require('../support/stand-ins.cjs');

process.env.CAREER_COACHING_QUIET_LOG = '1';
const toolchain = path.dirname(path.dirname(expressHome()));
const express = require(expressHome());
const {chromium} = require(path.join(toolchain, 'node_modules/playwright'));
const yaml = require(path.join(toolchain, 'node_modules/js-yaml'));
const catalog = yaml.load(fs.readFileSync(path.join(PACKAGE, 'authorization.yaml'), 'utf8'));
const VERIFIED = {available: true, check: async () => ({ok: true})};

/** @description Career's answers for the seeker, in career-hunter's shapes. */
function careerFixtures(app) {
  app.get('/api/career-hunter/jobs/stats', (_q, r) => r.json({byStatus: [{status: 'interview', n: 2}, {status: 'rejected', n: 4}, {status: 'applied', n: 3}],
    total: 9, applied: 3, interviewing: 2, queued: 3, matches: 40, tracked: 9, saved: 12, earlierPreparation: 0}));
  app.get('/api/career-hunter/jobs/progress', (_q, r) => r.json({period: 'past7days', since: new Date(Date.now() - 7 * 86400000).toISOString(),
    asOf: new Date().toISOString(), applied: 5, goal: null}));
  app.get('/api/career-hunter/jobs', (_q, r) => r.json({jobs: [{id: 9001, title: 'Data Analyst', company: 'Example Robotics', status: 'interview',
    applied_at: '2026-11-10T09:00:00Z', url: 'https://jobs.example.test/9001', notes: 'private'}]}));
  app.get('/shared/ui/css/surface-themes.css', (_q, r) => r.type('css').send(''));
  app.get('/shared/ui/js/surface-theme.js', (_q, r) => r.type('js').send(''));
}

/** @description The permissions a binding needs for this method and path (the kernel's segment rule), or null. */
function needs(method, url) {
  const parts = url.split('?')[0].replace(/^\/api\/career-coaching/, '') || '/';
  const binding = catalog.bindings.http.find((b) => b.method === method && b.path.split('/').length === parts.split('/').length
    && b.path.split('/').every((seg, i) => seg === parts.split('/')[i] || seg.startsWith(':')));
  return binding ? binding.allOf : null;
}

/** @description A test server; `as(name)` chooses who the next requests come from. */
async function server({status, roles}) {
  const kernel = standInKernel(), repo = memoryRepo(), people = cast(), state = {who: null};
  const home = expressHome(), resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) { return resolve.call(this, request === 'express' ? home : request, ...rest); };
  let router;
  try { router = require(path.join(PACKAGE, 'routes/coaching-routes.js')).createCareerCoachingRoutes({authorization: kernel.authorization, ticketService: kernel.ticketService}, {repo, ...(status ? {participantStatus: status} : {})}); }
  finally { Module._resolveFilename = resolve; }
  const app = express();
  app.use(express.json());
  careerFixtures(app);
  app.use('/api/career-coaching', (req, res, next) => {
    const who = people[state.who], held = new Set((roles[state.who] || []).flatMap((role) => catalog.roles[role].grants.map((g) => g.permission)));
    const required = needs(req.method, req.originalUrl);
    if (!required || !required.every((p) => held.has(p))) { res.status(403).json({error: 'authorization_denied', detail: 'not permitted'}); return; }
    kernel.as(who);
    req.principal = {id: who.id, kind: who.kind, subject: who.subject, issuer: who.issuer, tenant: who.tenant, state: who.state};
    req.user = {sub: who.subject, name: who.name, email: who.email, email_verified: true};
    router(req, res, next);
  });
  app.post('/tickets/:id/application/confirmation', (req, res) => {
    try { kernel.as(people[state.who]); res.json({confirmation: kernel.confirmation(req.params.id)}); } catch (e) { res.status(404).json({detail: e.message}); }
  });
  app.post('/tickets/:id/application/decision', (req, res) => {
    try { kernel.as(people[state.who]); res.json({ticket: kernel.decide(req.params.id, req.body.outcome, req.get('x-oshal-confirm'))}); }
    catch (e) { res.status(409).json({detail: e.message}); }
  });
  const listener = http.createServer(app);
  await new Promise((done) => listener.listen(0, '127.0.0.1', done));
  return {base: `http://127.0.0.1:${listener.address().port}`, repo, kernel, people, as: (name) => { state.who = name; },
    close: () => new Promise((done) => { listener.close(done); listener.closeAllConnections(); })};
}

/** @description A page that records its errors. */
async function open(browser, size, url) {
  const context = await browser.newContext({viewport: size});
  context.setDefaultTimeout(10000);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  return {page, errors, context};
}

/** @description Press Get my code and wait until the published code is shown. @returns {Promise<string>} The code. */
async function getCode(page) {
  await page.getByRole('button', {name: 'Get my code'}).click();
  await page.waitForFunction(() => /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(document.querySelector('#code-value').textContent.trim()));
  await page.getByRole('button', {name: 'New code'}).waitFor();
  return (await page.locator('#code-value').textContent()).trim();
}

/** @description Save a full-page picture when CAREER_COACHING_SHOTS names a folder (evidence only; never asserted). */
async function shot(page, name, size) {
  if (!process.env.CAREER_COACHING_SHOTS) return;
  fs.mkdirSync(process.env.CAREER_COACHING_SHOTS, {recursive: true});
  await page.screenshot({path: path.join(process.env.CAREER_COACHING_SHOTS, `${name}-${size.width}.png`), fullPage: true});
}

/** @description No sideways scroll and 44px targets for the visible buttons. */
async function fits(page) {
  const wide = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
  assert.ok(wide <= 0, `sideways scroll of ${wide}px`);
  for (const box of await page.locator('button:visible').evaluateAll((b) => b.map((n) => n.getBoundingClientRect().height))) assert.ok(box >= 43.5, `button ${box}px`);
}

let browser;
test.before(async () => { browser = await chromium.launch({headless: true}); });
test.after(async () => { await browser.close(); });

/** @description The seeker reviews a share with applications for the coach's code and checks what the review shows. */
async function seekerReviews(seeker, size, code) {
  const page = seeker.page;
  await page.getByText('You haven’t shared with a coach.').waitFor();
  await fits(page);
  assert.equal(await page.locator('#alias').inputValue(), 'Sam Rivera');
  assert.equal(await page.locator('#days').inputValue(), '7');
  await page.locator('#coach-code').fill(code);
  await page.getByLabel('Include my applications').check();
  await page.getByRole('button', {name: 'Review'}).click();
  await page.getByRole('heading', {name: 'What Jordan Lee will see'}).waitFor();
  await page.getByText('jordan-coach@example.test').waitFor();
  await page.getByText('In your organization').waitFor();
  await page.locator('#review-snapshot').getByText('Example Robotics').waitFor();
  assert.match(await page.locator('#review-terms').textContent(), /Access ends 7 days after you share/);
  assert.ok(!(await page.content()).includes('jobs.example.test'), 'no job address reaches the preview');
  await fits(page);
  await shot(page, 'seeker-review', size);
}

/** @description Share, then the Share confirmation; People with access lists the coach and the form is reset. */
async function seekerConfirms(seeker, size) {
  const page = seeker.page;
  await page.locator('#review-share').click();
  await page.getByRole('heading', {name: 'Share with Jordan Lee?'}).waitFor();
  await page.locator('#confirm-share').click();
  await page.getByText(/Shared with Jordan Lee\. Ends /).waitFor();
  const row = page.locator('#share-list li');
  await row.getByText('Jordan Lee').waitFor();
  await row.getByRole('button', {name: 'Stop sharing'}).waitFor();
  assert.equal(await page.locator('#days').inputValue(), '7', 'the form returns to 7 days');
  assert.equal(await page.locator('#steps').isVisible(), false, 'next steps stay hidden until chosen');
  await shot(page, 'seeker-shared', size);
}

/** @description The coach's card shows the client's snapshot and nothing of the seeker's account. */
async function coachReads(coach, size) {
  await coach.page.reload();
  const card = coach.page.locator('#client-list li');
  await card.getByRole('heading', {name: 'Sam Rivera'}).waitFor();
  await card.getByText('Seeker-shared snapshot').waitFor();
  await card.getByText(/As of (just now|.* ago) · shared (just now|.* ago) · Ends /).waitFor();
  await card.getByText('Example Robotics').waitFor();
  assert.equal(await card.locator('.cc-tile').first().locator('b').textContent(), '12');
  assert.ok(!(await coach.page.content()).includes('sam-seeker'), 'no seeker account id reaches the coach');
  await fits(coach.page);
  await shot(coach.page, 'coach-shared-with-me', size);
}

for (const size of [{width: 412, height: 915}, {width: 1280, height: 900}]) {
  test(`share, read and stop sharing through the real page at ${size.width}x${size.height}`, async () => {
    const s = await server({status: VERIFIED, roles: {sam: ['seeker'], jordan: ['coach']}});
    try {
      s.as('jordan');
      const coach = await open(browser, size, s.base + '/api/career-coaching/?view=coach');
      const code = await getCode(coach.page);
      await coach.page.getByText('Nothing has been shared with you yet.').waitFor();
      s.as('sam');
      const seeker = await open(browser, size, s.base + '/api/career-coaching/?view=share');
      await seekerReviews(seeker, size, code);
      await seekerConfirms(seeker, size);
      s.as('jordan');
      await coachReads(coach, size);
      s.as('sam');
      await seeker.page.reload();
      await seeker.page.locator('#share-list li').getByRole('button', {name: 'Stop sharing'}).click();
      await seeker.page.getByText('Stopped sharing. Your coach can no longer see your summary.').waitFor();
      await seeker.page.locator('#share-list li .cc-chip').getByText('Stopped').waitFor();
      s.as('jordan');
      await coach.page.reload();
      await coach.page.getByText('Nothing has been shared with you yet.').waitFor();
      assert.deepEqual([...seeker.errors, ...coach.errors], []);
      await seeker.context.close(); await coach.context.close();
    } finally { await s.close(); }
  });
}

test('Cancel in the Share confirmation shares nothing', async () => {
  const s = await server({status: VERIFIED, roles: {sam: ['seeker'], jordan: ['coach']}});
  try {
    s.as('jordan');
    const coach = await open(browser, {width: 412, height: 915}, s.base + '/api/career-coaching/?view=coach');
    const code = await getCode(coach.page);
    s.as('sam');
    const seeker = await open(browser, {width: 412, height: 915}, s.base + '/api/career-coaching/?view=share');
    await seeker.page.locator('#coach-code').fill(code);
    await seeker.page.getByRole('button', {name: 'Review'}).click();
    await seeker.page.getByRole('heading', {name: 'What Jordan Lee will see'}).waitFor();
    await seeker.page.locator('#review-share').click();
    await seeker.page.locator('#confirm-cancel').click();
    await seeker.page.getByText('Nothing was shared.').waitFor();
    assert.equal(s.repo.tables().cc_links.length, 0);
    assert.equal(s.kernel.ticketService.created, 0, 'no approval was even opened');
    await seeker.context.close(); await coach.context.close();
  } finally { await s.close(); }
});

test('closed coach viewing and a missing role are said plainly', async () => {
  const s = await server({status: null, roles: {sam: ['seeker'], jordan: ['coach'], avery: []}});
  try {
    s.as('jordan');
    const coach = await open(browser, {width: 412, height: 915}, s.base + '/api/career-coaching/?view=coach');
    await coach.page.getByText(/Shared snapshots can’t be shown yet/).waitFor();
    await shot(coach.page, 'coach-unavailable', {width: 412});
    assert.equal(await coach.page.locator('#client-list li').count(), 0);
    s.as('sam');
    const seeker = await open(browser, {width: 412, height: 915}, s.base + '/api/career-coaching/?view=share');
    await seeker.page.getByText('Your coach can’t open shared snapshots on this installation yet.').waitFor();
    s.as('sam');
    await seeker.page.goto(s.base + '/api/career-coaching/?view=coach');
    await seeker.page.getByText('This page is for career coaches. Ask your administrator for the Career coach role.').waitFor();
    assert.equal(await seeker.page.locator('#code-card').isVisible(), false);
    await seeker.context.close(); await coach.context.close();
  } finally { await s.close(); }
});
