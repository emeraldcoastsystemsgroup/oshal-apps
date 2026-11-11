/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger, 2026-11-06: Resume Studio opens the master resume in AI Office's Word editor. In Chromium: the person edits the headline heading, asks the Concierge to tighten a bullet, approves the card, presses Save to master resume, re-opens, and sees both changes in the document and in the career profile. A second person cannot read the first person's resume document.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 5: résumé carries its accents in the lines a person reads (the Save button, the picker, the status under the document); the expected text follows.
 *
 * Real: Career's page and tools/career-resume-office.js, AI Office's editor page and document routes over
 * forced-RLS PostgreSQL (presentations/tests/office/fixture.mjs), the shared editor foundation, standard
 * Concierge and approval cards from a kernel platform export, and Career's own `resume base` /
 * `resume base-save` engine programs on an isolated profile. Doubled: the model (a scripted fixture
 * concierge that proposes one office-apply-edits batch) and the kernel's proposal/execute relay, which
 * calls AI Office's real edits route as the same person.
 *
 * Run (lane-run, like the Office fixture suites; it refuses rather than skips without its services):
 *   OSHAL_TEST_POSTGRES=postgresql://…@127.0.0.1:35689/postgres OSHAL_PLATFORM_ROOT=<kernel>/platform \
 *   NODE_PATH=scripts/toolchain/node_modules node --test career-hunter/tests/career-resume-office-browser.spec.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

assert.ok(process.env.OSHAL_PLATFORM_ROOT, 'OSHAL_PLATFORM_ROOT must name a kernel platform export (refusing rather than skipping)');
const { fixture } = await import('../../presentations/tests/office/fixture.mjs');
const { chromium } = createRequire(import.meta.url)('playwright');
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tools = path.join(packageRoot, 'tools');
const binPath = path.join(packageRoot, 'bin', 'oshal-jobhunter.js');
const python = process.env.JOBHUNTER_PYTHON || 'python3';

const profile = {
  profile: { name: 'Alex Fixture', credential: 'PMP', clearance: 'None stated', experience_summary: 'Seasoned platform lead.' },
  roles: [{ title: 'Platform Lead', org: 'Acme', start: '2019-01', end: null,
    deliverables: ['Led the team that shipped the platform to production', 'Cut deploy time 60%'] }],
  skills: { Cloud: { items: ['AWS'] } }, certifications: ['PMP'],
};

function engine(dir, verb, doc) {
  const cli = new Module(binPath); cli.filename = binPath; cli.paths = Module._nodeModulePaths(path.dirname(binPath));
  cli._compile(`${fs.readFileSync(binPath, 'utf8')}\nmodule.exports.__engineRuns=engineRuns;`, binPath);
  const env = { ...process.env, PYTHONPATH: path.join(packageRoot, 'engine'), PYTHONIOENCODING: 'utf-8',
    JOBHUNTER_CAREER_DB: path.join(dir, 'career_db.json'), JOBHUNTER_DATA: path.join(dir, 'data'),
    ...(doc ? { CH_RESUME_DOC: JSON.stringify(doc) } : {}) };
  const out = spawnSync(python, cli.exports.__engineRuns('resume', [verb])[0], { cwd: packageRoot, env, encoding: 'utf8', timeout: 20_000 });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout.trim());
}

/** Career's routes for this screen, answered by its real engine programs on an isolated profile. */
async function routeCareer(page, dir, platform) {
  const file = (route, name, type) => route.fulfill({ body: fs.readFileSync(name), contentType: type });
  await page.route('**/api/career-hunter/resume-studio*', (route) => file(route, path.join(tools, 'career-resume-studio.html'), 'text/html'));
  await page.route('**/api/career-hunter/static/*', (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    return file(route, path.join(tools, name), name.endsWith('.css') ? 'text/css' : 'text/javascript');
  });
  await page.route('**/api/career-hunter/resume/doc?id=master', (route) => route.fulfill({ json: engine(dir, 'base') }));
  await page.route('**/api/career-hunter/resume/save', (route) => {
    const body = route.request().postDataJSON();
    assert.equal(body.postingId, 'master');
    return route.fulfill({ json: engine(dir, 'base-save', { resume: body.resume }) });
  });
  await page.route('**/api/career-hunter/jobs?*', (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route('**/api/career-hunter/resume/state', (route) => route.fulfill({ json: { hasResume: true, indexing: false } }));
  await page.route('**/shared/ui/js/package-tool-cards.js*', (route) => file(route, path.join(platform, 'src/api/jarvis-package-tools.js'), 'text/javascript'));
}

/** Scripted fixture concierge (no model): proposes tightening the first Acme bullet as one office-apply-edits batch. */
async function routeConcierge(page, origin) {
  let proposal = null;
  const office = (url, init) => fetch(origin + '/api/presentations/editor' + url, { ...init,
    headers: { 'Content-Type': 'application/json', 'x-office-test-owner': 'alice' } }).then((r) => r.json());
  await page.route('**/api/swarm/bots/deck-builder/ask', async (route) => {
    const { context } = route.request().postDataJSON();
    const { document } = await office('/documents/' + context.recordId);
    const page0 = document.model.pages[0], bullet = page0.blocks.find((b) => b.runs.map((r) => r.text).join('') === profile.roles[0].deliverables[0]);
    const operations = [{ op: 'text-range', page: page0.id, id: bullet.id, start: 0, end: profile.roles[0].deliverables[0].length, text: 'Shipped the platform' }];
    proposal = { id: 'fixture-tighten-bullet', app: 'presentations', toolName: 'office-apply-edits', label: 'Edit saved Office document', mode: 'ask',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      input: { id: document.id, baseRevision: document.revision, requestKey: randomUUID(), operationsJson: JSON.stringify(operations) } };
    return route.fulfill({ json: { reply: 'Tightened the first Acme bullet. Approve to apply it.', packageToolProposal: proposal.id } });
  });
  await page.route('**/api/jarvis/package-tools/proposals/*', (route) => route.fulfill({ json: { proposal } }));
  await page.route('**/api/jarvis/package-tools/execute', async (route) => {
    const { id, ...edit } = proposal.input;
    const result = await office(`/documents/${id}/edits`, { method: 'POST', body: JSON.stringify(edit) });
    return route.fulfill({ json: { status: result.document ? 200 : 409, result, expiresAt: new Date(Date.now() + 60000).toISOString() } });
  });
}

const frameOf = (page) => page.frameLocator('#officeFrame');
async function openStudio(page, origin) {
  await page.goto(origin + '/api/career-hunter/resume-studio');
  await frameOf(page).locator('html[data-office-ready=true]').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Save to master résumé' }).waitFor();
}
const paragraphText = (page, text) => frameOf(page).locator('.office-word-page [contenteditable=true]', { hasText: text }).first();

test('Resume Studio edits the master resume as a Word document with the standard Concierge, and saves it back', async (t) => {
  const f = await fixture({ http: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-resume-office-browser-'));
  fs.writeFileSync(path.join(dir, 'career_db.json'), JSON.stringify(profile, null, 2));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await f.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await routeCareer(page, dir, process.env.OSHAL_PLATFORM_ROOT);
  await routeConcierge(page, f.origin);
  await openStudio(page, f.origin);
  assert.equal(await page.locator('.chat').isVisible(), false, "Career's own resume editor panel is gone");
  assert.match(await page.locator('#status').innerText(), /Matches your master résumé/);

  const headline = paragraphText(page, 'PMP');
  await headline.fill('Principal Platform Engineering Leader');
  // AI Office's own layout: on a desktop Format | Concierge is one docked pane; Concierge is its second tab.
  await frameOf(page).locator('.office-pane-tabs [data-pane=concierge]').click();
  const concierge = frameOf(page).locator('.ef-concierge');
  await concierge.locator('textarea').fill('Tighten the first Acme bullet');
  await concierge.getByRole('button', { name: 'Send', exact: true }).click();
  await concierge.getByRole('button', { name: 'Approve', exact: true }).click();
  await paragraphText(page, 'Shipped the platform').waitFor({ timeout: 15000 });

  await page.getByRole('button', { name: 'Save to master résumé' }).click();
  await page.locator('#status', { hasText: 'Saved to your master résumé' }).waitFor({ timeout: 15000 });
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'career_db.json'), 'utf8'));
  assert.equal(saved.profile.headline, 'Principal Platform Engineering Leader');
  assert.deepEqual(saved.roles[0].deliverables, ['Shipped the platform', 'Cut deploy time 60%']);
  assert.equal(saved.roles[0].title, 'Platform Lead', 'the profile stays valid: the role and its title are intact');

  await page.reload();
  await openStudio(page, f.origin);
  await paragraphText(page, 'Principal Platform Engineering Leader').waitFor();
  await paragraphText(page, 'Shipped the platform').waitFor();
  assert.match(await page.locator('#status').innerText(), /Matches your master résumé/);
  const documentId = await page.locator('#officeFrame').evaluate((frame) => new URL(frame.src).searchParams.get('document'));

  // Refusal: another person can neither list nor read this person's resume document.
  const asBob = (url) => fetch(f.origin + '/api/presentations/editor' + url, { headers: { 'x-office-test-owner': 'bob' } });
  const bobRead = await asBob('/documents/' + documentId);
  assert.equal(bobRead.status, 404, 'another person cannot open this resume document');
  assert.deepEqual((await (await asBob('/documents')).json()).documents, [], "bob's list holds none of alice's documents");
  assert.deepEqual(errors, []);
});

test('on a phone (412x743) the document comes first, one main button, and the Concierge is a sheet', async (t) => {
  const f = await fixture({ http: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-resume-office-phone-'));
  fs.writeFileSync(path.join(dir, 'career_db.json'), JSON.stringify(profile, null, 2));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await f.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const page = await browser.newPage({ viewport: { width: 412, height: 743 }, hasTouch: true, isMobile: true }), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await routeCareer(page, dir, process.env.OSHAL_PLATFORM_ROOT);
  await openStudio(page, f.origin);
  const layout = await page.evaluate(() => {
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    return { scroll: document.documentElement.scrollWidth, save: box('#save'), pick: box('#pick'), frame: box('#officeFrame'),
      primaries: [...document.querySelectorAll('.ck-primary')].filter((n) => n.offsetParent).length, chat: !!document.querySelector('.chat').offsetParent };
  });
  assert.ok(layout.scroll <= 412, `no sideways scroll (${layout.scroll})`);
  assert.equal(layout.primaries, 1, 'one main button');
  assert.ok(layout.save.right <= 412 && layout.save.top === layout.pick.top, 'the app row is one row inside the screen');
  assert.ok(layout.frame.height >= 560, `the document fills the screen (${layout.frame.height}px)`);
  assert.equal(layout.chat, false, "Career's resume editor panel is gone");
  // AI Office opens an existing document to read on a phone with one Edit; then its bottom bar holds Concierge.
  await frameOf(page).getByRole('button', { name: 'Edit', exact: true }).tap();
  await frameOf(page).locator('.office-bottom-bar').getByRole('button', { name: 'Concierge', exact: true }).tap();
  await frameOf(page).locator('dialog.ds-layer[open] textarea').waitFor();
  assert.deepEqual(errors, []);
});
