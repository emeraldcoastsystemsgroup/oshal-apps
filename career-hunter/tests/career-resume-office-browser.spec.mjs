/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger, 2026-11-06: Resume Studio opens the master resume in AI Office's Word editor. In Chromium: the person edits the headline heading, asks the Concierge to tighten a bullet, approves the card, presses Save to master resume, re-opens, and sees both changes in the document and in the career profile. A second person cannot read the first person's resume document.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 5: résumé carries its accents in the lines a person reads (the Save button, the picker, the status under the document); the expected text follows.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Page names, judge's report 2026-11-11 (tests/career-page-names.test.mjs holds them): the Save button and the status lines say main résumé.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.61.0 (Roger, 2026-11-13: the concierge "said that it couldnt change my dates"; on the phone "everything is too bunched up to use the concierge"). Career's concierge is My résumé's one assistant: AI Office's editor opens with assistant=host and shows no concierge of its own. The person types in the document, asks Career's concierge to move a job's start month, sees the change as a card, approves it, and the Word document and the profile both show it; Undo puts it back in both. On a phone (412x915 and 360x800) the page is one column with its row of controls inside the screen, the document reaches Career's bottom bar, the concierge fills the screen between Career's bars with Back to My résumé, and the conversation is still there after going back and forth.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.62.0 (Roger, 2026-11-14: "i cant use the tools to update my resume and see it in the resume tab after adding experience"). With AI Office's real editor and store: a job with two bullets approved while no document is open is in the document the next time My résumé opens, with no press; text typed in the document and saved only in the editor is saved into the main résumé and stays in the document; a third visit rewrites nothing. This is also the proof that the editor keeps the first page's id when a person types, which is where the document names the main résumé it was made from.
 *
 * Real: Career's page, its frame and concierge, tools/career-resume-office.js and career-change-bar.js; AI Office's editor
 * page and document routes over forced-RLS PostgreSQL (presentations/tests/office/fixture.mjs); the shared editor
 * foundation, assistant and approval cards from a kernel platform export; Career's own `resume base`, `base-save`,
 * `base-section`, `base-patch` and `base-undo` engine programs on an isolated made-up profile. Doubled: the model (a
 * scripted fixture concierge that proposes one career_resume_patch) and the kernel's proposal/execute relay, which runs
 * Career's real engine patch as the same person.
 *
 * Run (lane-run, like the Office fixture suites; it refuses rather than skips without its services):
 *   OSHAL_TEST_POSTGRES=postgresql://…@127.0.0.1:35689/postgres OSHAL_PLATFORM_ROOT=<kernel>/platform \
 *   NODE_PATH=scripts/toolchain/node_modules node --test career-hunter/tests/career-resume-office-browser.spec.mjs
 *   (CAREER_PROOF_SHOTS=<folder> also saves the phone run's screenshots there.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
const shots = process.env.CAREER_PROOF_SHOTS || '';

const profile = {
  profile: { name: 'Alex Fixture', credential: 'PMP', clearance: 'None stated', experience_summary: 'Seasoned platform lead.' },
  roles: [{ title: 'Platform Lead', org: 'Acme', start: '2019-01', end: null,
    deliverables: ['Led the team that shipped the platform to production', 'Cut deploy time 60%'] }],
  skills: { Cloud: { items: ['AWS'] } }, certifications: ['PMP'],
};
const ribbon = [['home', 'Home', 'home'], ['resume-studio', 'My résumé', 'resume-studio'], ['work-history', 'Work history', 'work-history'], ['search', 'Find jobs', 'search-ui']]
  .map(([id, label, view]) => ({ id: 'tool-career-' + id, label, section: 'top', toolUi: { iframeUrl: '/api/career-hunter/' + view, visibilityToolName: 'career-' + id } }));

function engine(dir, verb, doc) {
  const cli = new Module(binPath); cli.filename = binPath; cli.paths = Module._nodeModulePaths(path.dirname(binPath));
  cli._compile(`${fs.readFileSync(binPath, 'utf8')}\nmodule.exports.__engineRuns=engineRuns;`, binPath);
  const env = { ...process.env, PYTHONPATH: path.join(packageRoot, 'engine'), PYTHONIOENCODING: 'utf-8',
    JOBHUNTER_CAREER_DB: path.join(dir, 'career_db.json'), JOBHUNTER_DATA: dir,
    ...(doc ? { CH_RESUME_DOC: JSON.stringify(doc) } : {}) };
  const out = spawnSync(python, cli.exports.__engineRuns('resume', [verb])[0], { cwd: packageRoot, env, encoding: 'utf8', timeout: 20_000 });
  const value = JSON.parse(out.stdout.trim());
  assert.equal(out.status, value.ok === false ? 1 : 0, out.stderr);
  return value;
}
const saved = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'career_db.json'), 'utf8'));

/** Career's routes for this screen, answered by its real engine programs on an isolated profile. */
async function routeCareer(page, dir, platform) {
  const file = (route, name, type) => route.fulfill({ body: fs.readFileSync(name), contentType: type });
  const json = (route, value) => route.fulfill({ status: value.ok === false ? 409 : 200, json: value });
  await page.route('**/api/career-hunter/resume-studio*', (route) => file(route, path.join(tools, 'career-resume-studio.html'), 'text/html'));
  await page.route('**/api/career-hunter/static/*', (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    return file(route, path.join(tools, name), name.endsWith('.css') ? 'text/css' : 'text/javascript');
  });
  await page.route('**/api/career-hunter/resume/doc?id=master', (route) => route.fulfill({ json: engine(dir, 'base') }));
  // 1.62.0: the main résumé as it read earlier, for a document made from an earlier revision.
  await page.route('**/api/career-hunter/resume/doc?id=master&earlier=*', (route) => {
    const which = new URL(route.request().url()).searchParams.get('earlier');
    return route.fulfill({ json: engine(dir, 'base-earlier', which === 'recent' ? {} : { revision: which }) });
  });
  await page.route('**/api/career-hunter/resume/save', (route) => {
    const body = route.request().postDataJSON();
    assert.equal(body.postingId, 'master');
    return route.fulfill({ json: engine(dir, 'base-save', { resume: body.resume }) });
  });
  await page.route('**/api/career-hunter/resume/master-undo', (route) => json(route, engine(dir, 'base-undo', route.request().postDataJSON())));
  await page.route('**/api/career-hunter/jobs?*', (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route('**/api/career-hunter/jobs/stats', (route) => route.fulfill({ json: { saved: 0, queued: 0, tracked: 0 } }));
  await page.route('**/api/career-hunter/resume/state', (route) => route.fulfill({ json: { hasResume: true, indexing: false } }));
  await page.route('**/api/ui/profile?*', (route) => route.fulfill({ json: { profile: { ribbon: { items: ribbon } } } }));
  await page.route('**/api/auth/user', (route) => route.fulfill({ json: { displayName: 'Alex Fixture' } }));
  await page.route('**/shared/ui/js/package-tool-cards.js*', (route) => file(route, path.join(platform, 'src/api/jarvis-package-tools.js'), 'text/javascript'));
}

/** Scripted fixture concierge (no model): reads the saved revision the way its tool does and proposes moving the job's start. */
async function routeConcierge(page, dir, asked) {
  let proposal = null;
  await page.route('**/api/swarm/bots/career-concierge/ask', async (route) => {
    const { context } = route.request().postDataJSON();
    asked.push(context);
    const { revision } = engine(dir, 'base-section', { field: 'overview', index: 0, offset: 0, limit: 20 });
    proposal = { id: 'fixture-start-month', app: 'career-hunter', appName: 'Intelligent Career', toolName: 'career_resume_patch', label: 'Change My Résumé or Work History', mode: 'ask',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      input: { revision, edits: [{ op: 'set', field: 'role', roleIndex: 0, roleTitle: 'Platform Lead', key: 'start', before: '2019-01', value: '2018-11',
        summary: 'Start of Platform Lead at Acme: Jan 2019 to Nov 2018' }] } };
    return route.fulfill({ json: { reply: 'I can move the start of Platform Lead at Acme to November 2018. Approve to apply it.', packageToolProposal: proposal.id } });
  });
  await page.route('**/api/jarvis/package-tools/proposals/*', (route) => route.fulfill({ json: { proposal } }));
  await page.route('**/api/jarvis/package-tools/execute', (route) => {
    const result = engine(dir, 'base-patch', proposal.input);
    return route.fulfill({ json: { status: result.ok ? 200 : 409, result, expiresAt: new Date(Date.now() + 60000).toISOString() } });
  });
}

const frameOf = (page) => page.frameLocator('#officeFrame');
async function openStudio(page, origin) {
  await page.goto(origin + '/api/career-hunter/resume-studio');
  await frameOf(page).locator('html[data-office-ready=true]').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Save to main résumé' }).waitFor();
  await page.locator('.cf-topbar[data-cf-ready]').waitFor({ timeout: 15000 });
}
const paragraphText = (page, text) => frameOf(page).locator('.office-word-page [contenteditable=true]', { hasText: text }).first();
const shot = (page, name) => (shots ? page.screenshot({ path: path.join(shots, name) }) : null);

/** Ask, approve the card, and wait for the document to show the new month. */
async function askAndApprove(page) {
  const pane = page.locator('.cf-concierge');
  await page.locator('.cf-concierge-toggle').click();
  await pane.getByRole('textbox', { name: 'Message to concierge' }).fill('Start Platform Lead in November 2018');
  await pane.getByRole('button', { name: 'Send', exact: true }).click();
  await pane.getByText('Start of Platform Lead at Acme: Jan 2019 to Nov 2018').waitFor({ timeout: 15000 });
  return pane;
}

test('desktop: Career\'s concierge is the one assistant, changes a job\'s start month in the document and the profile, and Undo puts it back', async (t) => {
  const f = await fixture({ http: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-resume-office-browser-'));
  fs.writeFileSync(path.join(dir, 'career_db.json'), JSON.stringify(profile, null, 2));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await f.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [], asked = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await routeCareer(page, dir, process.env.OSHAL_PLATFORM_ROOT);
  await routeConcierge(page, dir, asked);
  await openStudio(page, f.origin);
  assert.equal(await page.locator('.chat').isVisible(), false, "Career's classic résumé editor panel is not shown");
  assert.match(await page.locator('#status').innerText(), /Matches your main résumé/);
  assert.equal(await frameOf(page).locator('.office-pane-tabs [data-pane=concierge]').count(), 0, "AI Office shows no concierge tab of its own here");
  assert.equal(await frameOf(page).locator('.ef-assistant').count(), 0, 'and makes no assistant');
  assert.equal(await page.locator('.cf-concierge-toggle').count(), 1, "Career's Concierge is the page's one assistant entry");

  await paragraphText(page, 'PMP').fill('Principal Platform Engineering Leader');
  const pane = await askAndApprove(page);
  await pane.getByRole('button', { name: 'Approve', exact: true }).click();
  await paragraphText(page, '2018-11–present').waitFor({ timeout: 15000 });
  assert.equal(saved(dir).roles[0].start, '2018-11', 'the profile holds the approved month');
  assert.equal(saved(dir).profile.headline, 'Principal Platform Engineering Leader', 'the typed headline was saved before the concierge read the résumé');
  assert.equal(asked.at(-1).surface, 'resume-studio'); assert.equal(asked.at(-1).recordId, 'master');
  const bar = page.locator('#careerChangeBar');
  await bar.getByText('The change you approved is in your résumé.').waitFor();

  await bar.getByRole('button', { name: 'Undo', exact: true }).click();
  await bar.getByText('Put back. Your résumé is as it was.').waitFor({ timeout: 15000 });
  await paragraphText(page, '2019-01–present').waitFor({ timeout: 15000 });
  assert.equal(saved(dir).roles[0].start, '2019-01', 'Undo put the profile back');
  assert.equal(saved(dir).profile.headline, 'Principal Platform Engineering Leader', 'Undo puts back only the approved change');

  const documentId = await page.locator('#officeFrame').evaluate((frame) => new URL(frame.src).searchParams.get('document'));
  const asBob = (url) => fetch(f.origin + '/api/presentations/editor' + url, { headers: { 'x-office-test-owner': 'bob' } });
  assert.equal((await asBob('/documents/' + documentId)).status, 404, 'another person cannot open this résumé document');
  assert.deepEqual((await (await asBob('/documents')).json()).documents, [], "bob's list holds none of alice's documents");
  assert.deepEqual(errors, []);
});

test('desktop: a job approved where no document was open is in the document when My résumé opens, and what is typed there is kept with it', async (t) => {
  const f = await fixture({ http: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-resume-office-follows-'));
  fs.writeFileSync(path.join(dir, 'career_db.json'), JSON.stringify(profile, null, 2));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await f.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), errors = [];
  const visit = async () => {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await routeCareer(page, dir, process.env.OSHAL_PLATFORM_ROOT);
    await routeConcierge(page, dir, []);
    await openStudio(page, f.origin);
    return page;
  };
  // First visit: the document is made from the main résumé. The person types a headline and presses Save in the editor only.
  let page = await visit();
  assert.match(await page.locator('#status').innerText(), /Matches your main résumé/);
  await paragraphText(page, 'PMP').fill('Platform leader, typed in the document');
  await page.evaluate(async () => { const { beginDocumentHandoff } = await import('/shared/ui/js/document-handoff.js'); await beginDocumentHandoff({ app: 'presentations' }, { win: window }); });
  assert.equal(saved(dir).profile.headline, undefined, 'typed in the document, not yet in the main résumé');
  await page.close();

  // Meanwhile, with no document open: an approved card adds a job with two bullets (the engine's own patch).
  const { revision } = engine(dir, 'base-section', { field: 'overview', index: 0, offset: 0, limit: 20 });
  const at = { roleIndex: 0, roleTitle: 'IL6 Engineer' };
  const added = engine(dir, 'base-patch', { revision, edits: [
    { op: 'add', field: 'role', index: 0, before: '', value: 'IL6 Engineer', summary: 'Add IL6 Engineer at Demo Defense Cloud' },
    { op: 'set', field: 'role', ...at, key: 'org', before: '', value: 'Demo Defense Cloud', summary: 'Employer' },
    { op: 'set', field: 'role', ...at, key: 'start', before: '', value: '2025-06', summary: 'Start' },
    { op: 'add', field: 'experience', ...at, index: 0, before: '', value: 'Stood up the IL6 enclave', summary: 'Bullet' },
    { op: 'add', field: 'experience', ...at, index: 1, before: '', value: 'Wrote the accreditation package', summary: 'Bullet' }] });
  assert.equal(added.ok, true, JSON.stringify(added));

  // Second visit: no press. The document shows the new job, and the typed headline is in it and in the main résumé.
  page = await visit();
  await paragraphText(page, 'IL6 Engineer — Demo Defense Cloud').waitFor({ timeout: 15000 });
  await paragraphText(page, 'Wrote the accreditation package').waitFor();
  await paragraphText(page, 'Platform leader, typed in the document').waitFor();
  assert.match(await page.locator('#status').innerText(), /Saved what you typed, and updated with your work history/);
  assert.equal(await page.locator('#historyNote').isVisible(), false, 'nothing for the person to decide');
  const now = saved(dir);
  assert.equal(now.profile.headline, 'Platform leader, typed in the document', 'what was typed is in the main résumé');
  assert.deepEqual(now.roles.map((role) => role.title), ['IL6 Engineer', 'Platform Lead'], 'and the approved job is still there');
  assert.deepEqual(now.roles[0].deliverables, ['Stood up the IL6 enclave', 'Wrote the accreditation package']);

  // Third visit: nothing changed, so nothing is rewritten.
  await page.close();
  page = await visit();
  assert.match(await page.locator('#status').innerText(), /Matches your main résumé/);
  assert.deepEqual(errors, []);
});

for (const [width, height] of [[412, 915], [360, 800]]) {
  test(`phone ${width}x${height}: one column, the document to the bottom bar, a full-screen concierge with Back to My résumé, the change and Undo`, async (t) => {
    const f = await fixture({ http: true });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-resume-office-phone-'));
    fs.writeFileSync(path.join(dir, 'career_db.json'), JSON.stringify(profile, null, 2));
    const browser = await chromium.launch({ headless: true });
    t.after(async () => { await browser.close(); await f.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, isMobile: true }), errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await routeCareer(page, dir, process.env.OSHAL_PLATFORM_ROOT);
    await routeConcierge(page, dir, []);
    await openStudio(page, f.origin);
    const layout = await page.evaluate(() => {
      const box = (sel) => document.querySelector(sel).getBoundingClientRect(), bottom = document.querySelector('.cf-bottombar').getBoundingClientRect();
      const controls = [...document.querySelectorAll('#docbar :is(button, select)')].filter((n) => n.offsetParent).map((n) => ({ id: n.id, h: n.getBoundingClientRect().height, right: n.getBoundingClientRect().right }));
      return { scroll: document.documentElement.scrollWidth, save: box('#save'), pick: box('#pick'), more: box('#moreBtn'), frame: box('#officeFrame'), bottomTop: bottom.top,
        saveText: document.querySelector('#save').textContent, saveName: document.querySelector('#save').getAttribute('aria-label'),
        primaries: [...document.querySelectorAll('.ck-primary')].filter((n) => n.offsetParent).length, controls, status: getComputedStyle(document.querySelector('#status')).whiteSpace };
    });
    assert.ok(layout.scroll <= width, `no sideways scroll (${layout.scroll})`);
    assert.equal(layout.primaries, 1, 'one main button');
    assert.ok(layout.save.top === layout.pick.top && layout.more.top === layout.pick.top, 'the picker, Save and More are one row');
    assert.ok(layout.controls.every((c) => c.h >= 44 && c.right <= width), `every control is 44 px and inside the screen: ${JSON.stringify(layout.controls)}`);
    assert.ok(layout.pick.width >= 120, `the résumé picker shows its name (${layout.pick.width}px)`);
    assert.deepEqual([layout.saveText, layout.saveName], ['Save', 'Save to main résumé']);
    assert.equal(layout.status, 'nowrap', 'the status is one line');
    assert.ok(Math.abs(layout.frame.bottom - layout.bottomTop) <= 2, `the document reaches the bottom bar (${layout.frame.bottom} vs ${layout.bottomTop})`);
    await shot(page, `after-${width}x${height}-1-open.png`);

    await frameOf(page).getByRole('button', { name: 'Edit', exact: true }).tap();
    assert.equal(await frameOf(page).locator('.office-bottom-bar').getByRole('button', { name: 'Concierge', exact: true }).count(), 0, "AI Office's bar has no concierge of its own");
    const pane = await askAndApprove(page);
    const geometry = await page.evaluate(() => { const r = document.querySelector('.cf-concierge').getBoundingClientRect(), top = document.querySelector('.cf-topbar').getBoundingClientRect(), bottom = document.querySelector('.cf-bottombar').getBoundingClientRect(); return { left: r.left, width: r.width, top: r.top, bottom: r.bottom, barBottom: top.bottom, bottomTop: bottom.top, scroll: document.documentElement.scrollWidth }; });
    assert.ok(geometry.left === 0 && geometry.width === width, 'the concierge is the full width');
    assert.ok(geometry.top >= geometry.barBottom - 1 && geometry.bottom <= geometry.bottomTop + 1 && geometry.bottom - geometry.top >= height * 0.6, `between Career's bars (${JSON.stringify(geometry)})`);
    const back = pane.getByRole('button', { name: 'Back to My résumé', exact: true });
    assert.ok((await back.boundingBox()).height >= 44, 'Back to My résumé is a 44 px control');
    assert.equal(await pane.getByRole('button', { name: 'Close concierge' }).isVisible(), false, 'one way back on a phone');
    await shot(page, `after-${width}x${height}-2-concierge-card.png`);
    await pane.getByRole('button', { name: 'Approve', exact: true }).click();
    await pane.getByText(/Done/).first().waitFor({ timeout: 15000 });
    await back.click();
    await pane.waitFor({ state: 'hidden' });
    await paragraphText(page, '2018-11–present').waitFor({ timeout: 15000 });
    await page.locator('#careerChangeBar').getByText('The change you approved is in your résumé.').waitFor();
    await shot(page, `after-${width}x${height}-3-back-with-change.png`);
    await page.locator('.cf-concierge-toggle').click();
    assert.equal(await pane.locator('.ef-assistant-reply').count(), 1, 'the conversation is still there');
    await back.click();
    await page.locator('#careerChangeBar').getByRole('button', { name: 'Undo', exact: true }).click();
    await paragraphText(page, '2019-01–present').waitFor({ timeout: 15000 });
    assert.equal(saved(dir).roles[0].start, '2019-01');
    await shot(page, `after-${width}x${height}-4-undone.png`);
    assert.deepEqual(errors, []);
  });
}
