/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.4 (Roger, 2026-11-16 20:45Z: "i can not find where to see my expanded experience.. it doesnt show anywhere ... it covers like 20 different companies over a 4 year span when i was consulting in the field"). The shipped Work history page in Chromium, over Career's real résumé route module (GET /resume/doc, POST /resume/master-edit and /resume/master-undo) and its real engine programs on a made-up field consultant's disposable profile (20 client engagements over four years, client account groups): at 1440 the summary line and Expanded experience list every engagement and account whole; Place all 20 under the field job puts them on that job's card, and Undo puts the exact profile back; an engagement opens as a form whose months, length, technology, job, marked not public and bullets (a pasted block becomes one bullet per line) save exactly, moves and is removed after confirming; a new engagement lands on the job it was done under; a month with no year is refused in the form, nothing sent; account groups are edited, added and removed; at 412 and 360 the section and an open form are one column with 44 px controls, 16 px fields and nothing sideways.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { CLIENTS, consultantProfile } from './helpers/career-engagements-fixture.mjs';

const require = createRequire(import.meta.url), packageRoot = path.resolve(import.meta.dirname, '..'), repo = path.resolve(packageRoot, '..');
const express = require(require.resolve('express', { paths: [path.join(repo, 'scripts/toolchain')] }));
const { chromium } = require(require.resolve('playwright', { paths: [path.join(repo, 'scripts/toolchain')] }));
const platform = process.env.OSHAL_KERNEL_PLATFORM || process.env.OSHAL_CORE_ROOT;
const shots = process.env.CAREER_ENGAGEMENTS_SHOTS || '';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-engagements-page-'));
const binPath = path.join(packageRoot, 'bin/oshal-jobhunter.js'), cli = new Module(binPath);
cli.filename = binPath; cli.paths = Module._nodeModulePaths(path.dirname(binPath));
cli._compile(fs.readFileSync(binPath, 'utf8') + '\nmodule.exports.mapping=engineRuns;', binPath);
let dir = '', server, origin, browser;
const file = () => path.join(dir, 'career_db.json');
const saved = () => JSON.parse(fs.readFileSync(file(), 'utf8'));
function reset(name) { dir = path.join(root, name); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file(), JSON.stringify(consultantProfile(), null, 2)); }
function engine(args, env = {}) {
  const run = cli.exports.mapping(args[0], args.slice(1))[0];
  const out = spawnSync(process.env.CAREER_TEST_PYTHON || 'python3', run, { cwd: packageRoot, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, JOBHUNTER_DATA: dir, JOBHUNTER_CAREER_DB: file(), PYTHONPATH: path.join(packageRoot, 'engine'), ...env } });
  return { ok: out.status === 0, out: out.stdout, err: out.stderr };
}
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ error() {}, warn() {}, info() {} }) };
  if (request === '@/features/agent-management') return { BotNodeClient: class {}, createRegistryEndpointResolver: () => null };
  if (request === '@/app/routes/inline-bot-execution' || request === './career-engine-runner') return {};
  if (request === './career-user-store') return { callerSub: () => 'casey', findUserPaths: () => ({ userDir: dir }), userPaths: () => ({ userDir: dir }) };
  if (request === './career-engine-dispatch') return { runCareerCliAwait: async (_pool, sub, args, env) => { assert.equal(sub, 'casey'); return engine(args, env); } };
  return originalLoad.call(this, request, ...rest);
};
const studio = require('../routes/career-resume-studio-routes.js');
Module._load = originalLoad;
const ribbon = [['home', 'Home', 'home'], ['resume-studio', 'My résumé', 'resume-studio'], ['work-history', 'Work history', 'work-history']]
  .map(([id, label, view]) => ({ id: 'tool-career-' + id, label, section: 'top', toolUi: { iframeUrl: '/api/career-hunter/' + view, visibilityToolName: 'career-' + id } }));

function app() {
  const web = express(), router = express.Router(), tools = path.join(packageRoot, 'tools');
  web.use(express.json());
  studio.registerCareerResumeStudio(router, { pool: {} });
  web.get('/api/career-hunter/work-history', (_req, res) => res.sendFile('career-work-history.html', { root: tools }));
  web.use('/api/career-hunter/static', express.static(tools));
  web.use('/api/career-hunter', router);
  web.use('/shared/ui', express.static(path.join(platform, 'src/shared/ui')));
  web.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: ribbon } } }));
  web.get('/api/auth/user', (_req, res) => res.json({ displayName: 'Casey' }));
  web.get('/api/career-hunter/jobs/stats', (_req, res) => res.json({ saved: 0, queued: 0, tracked: 0 }));
  web.get('/api/presentations/editor/documents', (_req, res) => res.json({ documents: [] }));
  return web;
}
before(async () => {
  assert.ok(platform, 'OSHAL_KERNEL_PLATFORM must name the kernel platform folder (refusing rather than skipping)');
  server = app().listen(0, '127.0.0.1'); await new Promise((done) => server.once('listening', done));
  origin = 'http://127.0.0.1:' + server.address().port; browser = await chromium.launch({ headless: true });
  const page = await fetch(origin + '/api/career-hunter/static/career-work-history-engagements.js');
  assert.equal(page.status, 200, 'the fixture serves the Expanded experience script');
});
after(async () => { await browser?.close(); server?.closeAllConnections(); await new Promise((done) => server ? server.close(done) : done()); fs.rmSync(root, { recursive: true, force: true }); });

async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600 });
  const page = await context.newPage(), errors = [], outside = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : (outside.push(route.request().url()), route.abort())));
  await page.goto(origin + '/api/career-hunter/work-history');
  await page.locator('#whLoose .wh-eng, .wh-eng-group .wh-eng').first().waitFor({ timeout: 15000 });
  await page.locator('.cf-topbar[data-cf-ready]').waitFor({ timeout: 15000 });
  return { page, context, errors, outside };
}
const job = (page, title) => page.locator('.wh-job', { has: page.getByRole('heading', { name: title, exact: true }) });
const engagement = (page, name) => page.locator('.wh-eng', { has: page.getByRole('heading', { name, exact: true }) });
async function shot(page, name) { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name), fullPage: true }); } }

test('1440: the summary and Expanded experience list every client engagement and account whole; Place all under the field job puts them on its card; Undo puts it back', async () => {
  reset('place'); const preimage = fs.readFileSync(file(), 'utf8'), fixture = consultantProfile();
  const { page, context, errors, outside } = await open(1440, 900);
  try {
    assert.deepEqual(await Promise.all(['#whSumJobs', '#whSumEng', '#whSumAcc'].map((id) => page.locator(id).innerText())), ['3 jobs', '20 client engagements', '17 client accounts']);
    assert.match(await page.locator('#whSummary').textContent(), /Expanded experience:/);
    assert.equal(await page.locator('#whLooseHead').innerText(), 'Not placed under a job yet (20)');
    assert.deepEqual(await page.locator('#whLoose .wh-eng h4').allInnerTexts(), fixture.project_ledger.map((e) => e.project));
    const first = engagement(page, 'Contoso Freight warehouse rollout');
    assert.equal(await first.locator('.wh-meta').first().innerText(), 'Solution architect · Logistics · Feb 2018 – Apr 2018 (1 month)');
    assert.deepEqual(await first.locator('.wh-bullets li').allInnerTexts(), fixture.project_ledger[0].bullets);
    assert.equal(await first.locator('.wh-eng-detail').first().innerText(), 'Technology: SQL, Python, Tool 1');
    assert.equal(await engagement(page, 'Woodgrove Bank ledger close').locator('.wh-tag').innerText(), 'Marked not public');
    assert.match(await engagement(page, 'Margie Travel booking engine').innerText(), /Notes: Weekend cutover crew/);
    assert.equal(await engagement(page, 'Alpine Ski House rental system').locator('.wh-meta').first().innerText(), 'Implementation consultant · Leisure · 1 week');
    assert.deepEqual(await page.locator('#whGroups .wh-group h4').allInnerTexts(), ['Field clients (12)', 'Federal agencies (3)', 'Channel partners (2)']);
    assert.deepEqual(await page.locator('#whGroups .wh-group').first().locator('.wh-names li').allInnerTexts(), CLIENTS.slice(0, 12).map(([client]) => client));
    assert.equal(await page.locator('#whAddendumLink').getAttribute('href'), 'https://example.test/casey-detailed-work-addendum.pdf');
    await shot(page, 'work-history-1440-before.png');
    await page.locator('#whPlaceJob').selectOption({ label: 'Field Implementation Consultant · Example Systems Group' });
    await page.getByRole('button', { name: 'Place them', exact: true }).click();
    await page.locator('#careerChangeBar').getByText('Placed 20 engagements under Field Implementation Consultant at Example Systems Group.').waitFor({ timeout: 20000 });
    assert.deepEqual(saved().project_ledger.map((e) => e.job), Array(20).fill('r2'));
    const field = job(page, 'Field Implementation Consultant');
    assert.equal(await field.locator('.wh-eng-head').innerText(), 'Client engagements (20)');
    assert.deepEqual(await field.locator('.wh-eng h4').allInnerTexts(), fixture.project_ledger.map((e) => e.project));
    assert.equal(await page.locator('#whLooseHead').isVisible(), false);
    assert.match(await page.locator('#whEngIntro').innerText(), /20 of them show on the card of the job you did them in/);
    await shot(page, 'work-history-1440-placed.png');
    await page.locator('#careerChangeBar').getByRole('button', { name: 'Undo', exact: true }).click();
    await page.locator('#careerChangeBar').getByText('Put back. Your work history is as it was.').waitFor({ timeout: 15000 });
    assert.equal(fs.readFileSync(file(), 'utf8'), preimage, 'the exact earlier profile');
    assert.equal(await page.locator('#whLooseHead').innerText(), 'Not placed under a job yet (20)');
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.deepEqual([sideways, errors, outside], [false, [], []]);
  } finally { await context.close(); }
});

test('1440: an engagement opens as a form; months, length, technology, job, marked not public and bullets save exactly; it moves and is removed after confirming', async () => {
  reset('edit');
  const { page, context, errors } = await open(1440, 900);
  try {
    await engagement(page, 'Tailspin Air crew scheduling').getByRole('button', { name: 'Edit Tailspin Air crew scheduling' }).click();
    const form = page.locator('.wh-eng-form');
    await form.getByLabel('Engagement start month').selectOption('08'); await form.getByLabel('Engagement start year').fill('2018');
    await form.getByLabel('Engagement end month').selectOption('11'); await form.getByLabel('Engagement end year').fill('2018');
    await form.getByLabel('Length in months').fill('3.5');
    await form.getByLabel('Technology (separate with commas)').fill('SQL, Kafka , Crew rules engine');
    await form.getByLabel('Done under').selectOption({ label: 'Field Implementation Consultant · Example Systems Group · 2018–2021' });
    await form.getByLabel('Marked not public').check();
    await form.getByRole('button', { name: 'Add a bullet' }).click();
    await form.getByRole('textbox', { name: 'Engagement bullet' }).last().evaluate((box, text) => { box.focus(); document.execCommand('insertText', false, text); },
      '• Rebuilt crew pairing for 400 pilots\n• Cut overnight solver runs from 6 hours to 40 minutes');
    await form.getByRole('button', { name: 'Save engagement' }).click();
    await page.locator('#careerChangeBar').getByText('Saved Tailspin Air crew scheduling.').waitFor({ timeout: 20000 });
    assert.deepEqual(saved().project_ledger[2], { project: 'Tailspin Air crew scheduling', role: 'Implementation consultant', industry: 'Aviation',
      duration_months: 3.5, tech: ['SQL', 'Kafka', 'Crew rules engine'], start: '2018-08', end: '2018-11', job: 'r2', public: false,
      bullets: ['Rebuilt crew pairing for 400 pilots', 'Cut overnight solver runs from 6 hours to 40 minutes'] });
    const placed = job(page, 'Field Implementation Consultant').locator('.wh-eng');
    assert.equal(await placed.locator('.wh-meta').first().innerText(), 'Implementation consultant · Aviation · Aug 2018 – Nov 2018 (3.5 months)');
    assert.deepEqual(await placed.locator('.wh-bullets li').allInnerTexts(), ['Rebuilt crew pairing for 400 pilots', 'Cut overnight solver runs from 6 hours to 40 minutes']);
    // A second one under the same job, then Move up and Remove.
    await engagement(page, 'Contoso Freight warehouse rollout').getByRole('button', { name: 'Edit Contoso Freight warehouse rollout' }).click();
    await page.locator('.wh-eng-form').getByLabel('Done under').selectOption({ index: 2 });
    await page.locator('.wh-eng-form').getByRole('button', { name: 'Save engagement' }).click();
    await page.locator('#careerChangeBar').getByText('Saved Contoso Freight warehouse rollout.').waitFor({ timeout: 20000 });
    const field = job(page, 'Field Implementation Consultant');
    assert.deepEqual(await field.locator('.wh-eng h4').allInnerTexts(), ['Contoso Freight warehouse rollout', 'Tailspin Air crew scheduling']);
    await engagement(page, 'Tailspin Air crew scheduling').getByRole('button', { name: 'Edit Tailspin Air crew scheduling' }).click();
    await page.locator('.wh-eng-form').getByRole('button', { name: 'Move up' }).click();
    await page.locator('#careerChangeBar').getByText('Moved Tailspin Air crew scheduling.').waitFor({ timeout: 20000 });
    assert.deepEqual(await field.locator('.wh-eng h4').allInnerTexts(), ['Tailspin Air crew scheduling', 'Contoso Freight warehouse rollout']);
    assert.equal(saved().project_ledger[0].project, 'Tailspin Air crew scheduling');
    await engagement(page, 'Tailspin Air crew scheduling').getByRole('button', { name: 'Edit Tailspin Air crew scheduling' }).click();
    await page.locator('.wh-eng-form').getByRole('button', { name: 'Remove this engagement' }).click();
    await page.locator('#whConfirm').getByText('Remove Tailspin Air crew scheduling and its bullets from your expanded experience? Undo puts it back.').waitFor();
    await page.locator('#whConfirm').getByRole('button', { name: 'Remove', exact: true }).click();
    await page.locator('#careerChangeBar').getByText('Removed Tailspin Air crew scheduling.').waitFor({ timeout: 20000 });
    assert.equal(saved().project_ledger.length, 19);
    assert.equal(saved().project_ledger.some((e) => e.project === 'Tailspin Air crew scheduling'), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('1440: a new engagement lands on the job it was done under; a month with no year is refused in the form and nothing is sent', async () => {
  reset('add');
  const { page, context, errors } = await open(1440, 900);
  try {
    await page.locator('#whEngagements').getByRole('button', { name: 'Add an engagement', exact: true }).click();
    const form = page.locator('.wh-eng-form');
    await form.getByLabel('Client or project').fill('Sample Rail signalling upgrade');
    await form.getByLabel('Your role').fill('Lead consultant');
    await form.getByLabel('Engagement start month').selectOption('03');
    await form.getByRole('button', { name: 'Add this engagement' }).click();
    assert.equal(await form.getByRole('alert').innerText(), 'Enter the year as well as the month.');
    assert.equal(saved().project_ledger.length, 20, 'nothing was sent');
    await form.getByLabel('Engagement start year').fill('2021');
    await form.getByLabel('Done under').selectOption({ label: 'Principal Consultant · Northwind Advisory · 2022–now' });
    await form.getByRole('textbox', { name: 'Engagement bullet' }).first().fill('Set up the rail client\'s signalling data model');
    await form.getByRole('button', { name: 'Add this engagement' }).click();
    await page.locator('#careerChangeBar').getByText('Added Sample Rail signalling upgrade.').waitFor({ timeout: 20000 });
    assert.deepEqual(saved().project_ledger[20], { project: 'Sample Rail signalling upgrade', role: 'Lead consultant', start: '2021-03', job: 'r1',
      bullets: ['Set up the rail client\'s signalling data model'] });
    const principal = job(page, 'Principal Consultant');
    assert.deepEqual(await principal.locator('.wh-eng h4').allInnerTexts(), ['Sample Rail signalling upgrade']);
    assert.equal(await principal.locator('.wh-eng .wh-meta').first().innerText(), 'Lead consultant · From Mar 2021');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('1440: client account groups are edited one name per line, added and removed', async () => {
  reset('accounts');
  const { page, context, errors } = await open(1440, 900);
  try {
    await page.getByRole('button', { name: 'Edit Channel partners', exact: true }).click();
    await page.locator('.wh-eng-form').getByLabel('Names, one per line').fill('Partner One\n\nPartner Three\n');
    await page.locator('.wh-eng-form').getByRole('button', { name: 'Save group' }).click();
    await page.locator('#careerChangeBar').getByText('Saved Channel partners.').waitFor({ timeout: 20000 });
    assert.deepEqual(saved().named_accounts.channel_partners, ['Partner One', 'Partner Three']);
    await page.getByRole('button', { name: 'Add a group', exact: true }).click();
    await page.locator('.wh-eng-form').getByLabel('Group name').fill('Rail clients');
    await page.locator('.wh-eng-form').getByLabel('Names, one per line').fill('Sample Rail\nExample Transit');
    await page.locator('.wh-eng-form').getByRole('button', { name: 'Add this group' }).click();
    await page.locator('#careerChangeBar').getByText('Added Rail clients.').waitFor({ timeout: 20000 });
    assert.deepEqual(saved().named_accounts['Rail clients'], ['Sample Rail', 'Example Transit']);
    await page.getByRole('button', { name: 'Edit Federal agencies', exact: true }).click();
    await page.locator('.wh-eng-form').getByRole('button', { name: 'Remove this group' }).click();
    await page.locator('#whConfirm').getByRole('button', { name: 'Remove', exact: true }).click();
    await page.locator('#careerChangeBar').getByText('Removed Federal agencies.').waitFor({ timeout: 20000 });
    assert.equal('federal_agencies' in saved().named_accounts, false);
    assert.deepEqual(await page.locator('#whGroups .wh-group h4').allInnerTexts(), ['Field clients (12)', 'Channel partners (2)', 'Rail clients (2)']);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

for (const [width, height] of [[412, 915], [360, 800]]) {
  test(`phone ${width}x${height}: Expanded experience and an open engagement form are one column, 44 px controls, 16 px fields, nothing sideways`, async () => {
    reset('phone-' + width);
    const { page, context, errors } = await open(width, height);
    try {
      assert.equal(await page.locator('#whSummary').isVisible(), true);
      await page.locator('#whSumEng').click();
      await page.locator('#whLooseHead').waitFor();
      assert.equal(await engagement(page, 'Contoso Freight warehouse rollout').isVisible(), true);
      if (width === 412) await shot(page, 'work-history-412-expanded.png');
      await engagement(page, 'Contoso Freight warehouse rollout').getByRole('button', { name: 'Edit Contoso Freight warehouse rollout' }).click();
      const m = await page.evaluate(() => {
        const shown = (n) => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
        const small = [...document.querySelectorAll('#whExpanded :is(button, input, select, textarea, a[href]), #whSummary a[href]')].filter(shown)
          .map((n) => { const box = (n.type === 'checkbox' ? n.closest('label') : n).getBoundingClientRect(); return { name: n.getAttribute('aria-label') || n.textContent.trim() || n.name, h: box.height, w: box.width, right: box.right }; })
          .filter((c) => c.h < 44 || c.w < 22 || c.right > innerWidth);
        const form = document.querySelector('.wh-eng-form'), start = form.querySelector('.wh-dates fieldset:first-child').getBoundingClientRect(), end = form.querySelector('.wh-dates fieldset:last-child').getBoundingClientRect();
        return { small, sideways: document.documentElement.scrollWidth > innerWidth, stacked: end.top >= start.bottom, font: getComputedStyle(form.querySelector('input[name=project]')).fontSize };
      });
      assert.deepEqual(m.small, [], 'every control is at least 44 px tall and inside the screen');
      assert.equal(m.sideways, false); assert.equal(m.stacked, true, 'start above end, one column'); assert.equal(m.font, '16px');
      if (width === 412) await shot(page, 'work-history-412-form.png');
      await page.locator('.wh-eng-form').getByLabel('Your role').fill('Lead implementation consultant');
      await page.locator('.wh-eng-form').getByRole('button', { name: 'Save engagement' }).click();
      await page.locator('#careerChangeBar').getByText('Saved Contoso Freight warehouse rollout.').waitFor({ timeout: 20000 });
      assert.equal(saved().project_ledger[0].role, 'Lead implementation consultant');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
