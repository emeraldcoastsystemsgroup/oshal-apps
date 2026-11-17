/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.7 (Roger, 2026-11-17: "i had oshal and agentic federal but now we have oswarm.ai and the product changed ... agenticfederal.us needs to be updated with our profile and the bullets for oshal now should be oswarm and updated"). The saved portfolio (`oss_portfolio`, Other experience's saved-portfolio entry, which job scoring reads) had no way to be changed: Career's own form only copied it into the Other experience file, which job scoring never reads. Over Career's real résumé route module (GET /resume/master-section, POST /resume/master-edit and /resume/master-undo), the real engine programs and the shipped Other experience library, on a made-up person whose portfolio is "Lantern": (1) the portfolio reads whole with the main résumé's exact revision; (2) a save of the whole form changes exactly those fields, keeps keys the form does not show, backs up the exact earlier file and audits each changed field, and the Other experience list, the Download my data record and job scoring all read the new version; (3) Undo puts back the exact earlier bytes; (4) a save on a moved main résumé, one bad field among good ones, too many bullets or a form missing a field changes nothing and says why; (5) a save that would grow the main résumé past what job scoring reads is refused; with no portfolio saved, an empty form writes nothing and a filled one writes one the list offers; (6) the list's own form no longer copies the portfolio, while a copy saved before 1.68.7 is still edited there and the portfolio form refuses to leave the two apart; (7) the shipped page in Chromium at 1440x900 and 412x915: opening the entry shows the portfolio form filled, Save portfolio saves and the list's title follows, Undo puts it back, another entry keeps its own form, and on a phone the form is one column with 44 px controls, 16 px fields and nothing sideways. Red on store main 6467ca6d (field portfolio is refused, the page has no portfolio form).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url), packageRoot = path.resolve(import.meta.dirname, '..'), repo = path.resolve(packageRoot, '..');
const express = require(require.resolve('express', { paths: [path.join(repo, 'scripts/toolchain')] }));
const { chromium } = require(require.resolve('playwright', { paths: [path.join(repo, 'scripts/toolchain')] }));
const platform = process.env.OSHAL_KERNEL_PLATFORM || process.env.OSHAL_CORE_ROOT;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-portfolio-edit-'));
const binPath = path.join(packageRoot, 'bin/oshal-jobhunter.js'), cli = new Module(binPath);
cli.filename = binPath; cli.paths = Module._nodeModulePaths(path.dirname(binPath));
cli._compile(fs.readFileSync(binPath, 'utf8') + '\nmodule.exports.mapping=engineRuns;', binPath);
let dir = '', server, origin, browser;
const file = () => path.join(dir, 'career_db.json');
const text = () => fs.readFileSync(file(), 'utf8');
const saved = () => JSON.parse(text());
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const backups = () => (fs.existsSync(path.join(dir, 'backups')) ? fs.readdirSync(path.join(dir, 'backups')) : []);
const python = process.env.CAREER_TEST_PYTHON || 'python3';
const env = () => ({ ...process.env, JOBHUNTER_DATA: dir, JOBHUNTER_CAREER_DB: file(), PYTHONPATH: path.join(packageRoot, 'engine') });

/** A made-up person: one job, one volunteer entry elsewhere, and an open-source project saved as their portfolio. */
function profile(extra = {}) {
  return {
    profile: { name: 'Robin Sample', experience_summary: 'Recorded platform engineering.' },
    roles: [{ id: 'r1', title: 'Platform Engineer', org: 'Sample Freight', start: '2019-03', end: '', deliverables: ['Ran the build farm.'] }],
    skills: { Core: { items: ['Python'] } },
    oss_portfolio: {
      _note: 'Lantern notes kept private.', label: 'Lantern work', _kept: 'a key the form does not show',
      entry: { title: 'Founder', org: 'Lantern (open-source)', person_url: 'https://robin.example.test/', platform_url: 'https://lantern.example.test/',
        product_url: 'https://old-lantern.example.test/', span: '2024 to Present', bullets: ['Wrote the Lantern scheduler.', 'Kept 12 plugins working.'],
        tech: ['Go', 'Redis'], applications: ['Ledger', 'Atlas'], kept_too: 'also kept' },
      skills: ['Go', 'Scheduling'], scoring_blurb: 'Lantern: a job scheduler written in Go.' },
    ...extra,
  };
}
/** The whole form, as the page sends it after the person rewrote the entry. */
const form = (over = {}) => ({
  label: 'Lantern Cloud', note: '', title: 'Founder / Principal Engineer', org: 'Lantern Cloud (lantern.example.test) | independent product',
  span: '2024 to Present', person_url: 'https://robin.example.test/', platform_url: 'https://lantern-cloud.example.test/', product_url: '',
  scoring_blurb: 'Lantern Cloud: a self-hosted scheduler platform in Rust; 30+ plugins; blue/green releases.',
  bullets: ['Rebuilt Lantern as Lantern Cloud in Rust.', 'Ship 30+ plugins with their own test catalogs.', 'Run blue/green releases with local gates.'],
  tech: ['Rust', 'PostgreSQL', 'Kubernetes (k3s)'], applications: ['Ledger', 'Atlas', 'Beacon'], skills: ['Rust', 'Release engineering, blue/green'], ...over,
});
function reset(name, data = profile()) {
  dir = path.join(root, name); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(data, null, 2));
}
function engine(args, extraEnv = {}) {
  const run = cli.exports.mapping(args[0], args.slice(1))[0];
  const out = spawnSync(python, run, { cwd: packageRoot, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, env: { ...env(), ...extraEnv } });
  return { ok: out.status === 0, out: out.stdout, err: out.stderr };
}
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ error() {}, warn() {}, info() {} }) };
  if (request === '@/features/agent-management') return { BotNodeClient: class {}, createRegistryEndpointResolver: () => null };
  if (request === '@/app/routes/inline-bot-execution' || request === './career-engine-runner') return {};
  if (request === './career-user-store') return { callerSub: () => 'robin', findUserPaths: () => ({ userDir: dir }), userPaths: () => ({ userDir: dir }) };
  if (request === './career-engine-dispatch') return { runCareerCliAwait: async (_pool, sub, args, extraEnv) => { assert.equal(sub, 'robin'); return engine(args, extraEnv); } };
  // The record reads no owner database here (no userDb is given), as tests/career-master-record-routes.test.mjs.
  if (request === 'better-sqlite3') return class { constructor() { throw new Error('no owner database in this fixture'); } };
  return originalLoad.call(this, request, ...rest);
};
const studio = require('../routes/career-resume-studio-routes.js');
const bank = require('../lib/career-experience-bank.js');
const { readMasterRecord } = require('../lib/career-master-record.js');
Module._load = originalLoad;
const ribbon = [['home', 'Home', 'home'], ['experience-library', 'Other experience', 'experience-library']]
  .map(([id, label, view]) => ({ id: 'tool-career-' + id, label, section: 'top', toolUi: { iframeUrl: '/api/career-hunter/' + view, visibilityToolName: 'career-' + id } }));

function app() {
  const web = express(), router = express.Router(), tools = path.join(packageRoot, 'tools');
  web.use(express.json());
  studio.registerCareerResumeStudio(router, { pool: {} });
  // The board route's two lines for the list (src-routes/career-board-routes.ts), over the same library.
  router.get('/experience-bank', (req, res) => { try { const read = bank.read(dir); res.json(req.query.summary === '1' ? { ...read, entries: read.entries.map(({ facts, ...entry }) => entry) } : read); } catch (error) { res.status(error.status || 503).json({ error: error.message }); } });
  router.post('/experience-bank', (req, res) => { try { res.json({ ok: true, ...bank.update(dir, req.body) }); } catch (error) { res.status(error.status || 503).json({ error: error.message }); } });
  web.get('/api/career-hunter/experience-library', (_req, res) => res.sendFile('career-experience-bank.html', { root: tools }));
  web.use('/api/career-hunter/static', express.static(tools));
  web.use('/api/career-hunter', router);
  web.use('/shared/ui', express.static(path.join(platform, 'src/shared/ui')));
  web.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: ribbon } } }));
  web.get('/api/auth/user', (_req, res) => res.json({ displayName: 'Robin' }));
  web.get('/api/career-hunter/jobs/stats', (_req, res) => res.json({ saved: 0, queued: 0, tracked: 0 }));
  web.get('/api/presentations/editor/documents', (_req, res) => res.json({ documents: [] }));
  return web;
}
async function call(method, route, body) {
  const response = await fetch(origin + '/api/career-hunter' + route, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { code: response.status, body: await response.json() };
}
const read = () => call('GET', '/resume/master-section?field=portfolio');
const save = (revision, value) => call('POST', '/resume/master-edit', { revision, edits: [{ op: 'set', field: 'portfolio', value, summary: 'Saved portfolio edited on Other experience' }] });

before(async () => {
  assert.ok(platform, 'OSHAL_KERNEL_PLATFORM must name the kernel platform folder (refusing rather than skipping)');
  server = app().listen(0, '127.0.0.1'); await new Promise((done) => server.once('listening', done));
  origin = 'http://127.0.0.1:' + server.address().port; browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); server?.closeAllConnections(); await new Promise((done) => (server ? server.close(done) : done())); fs.rmSync(root, { recursive: true, force: true }); });

test('the portfolio reads whole, with the exact revision of the main résumé it sits in', async () => {
  reset('read');
  const { code, body } = await read();
  assert.equal(code, 200, JSON.stringify(body));
  assert.equal(body.revision, digest(text()), 'the revision is the main résumé as saved');
  assert.deepEqual([body.present, body.copy], [true, false]);
  assert.deepEqual(body.portfolio, { label: 'Lantern work', note: 'Lantern notes kept private.', title: 'Founder', org: 'Lantern (open-source)', span: '2024 to Present',
    person_url: 'https://robin.example.test/', platform_url: 'https://lantern.example.test/', product_url: 'https://old-lantern.example.test/',
    scoring_blurb: 'Lantern: a job scheduler written in Go.', bullets: ['Wrote the Lantern scheduler.', 'Kept 12 plugins working.'], tech: ['Go', 'Redis'],
    applications: ['Ledger', 'Atlas'], skills: ['Go', 'Scheduling'] });
  assert.equal(body.limits.lists.bullets.items, 20, 'the form and the engine keep one rule');
});

test('a save changes exactly the form, is backed up and audited, every reader sees it, and Undo puts the exact bytes back', async () => {
  reset('save');
  const before = text(), { body: opened } = await read();
  const { code, body } = await save(opened.revision, form());
  assert.equal(code, 200, JSON.stringify(body));
  assert.equal(body.changed, true);
  assert.equal(body.revision, digest(text()));
  const portfolio = saved().oss_portfolio;
  assert.deepEqual(portfolio, { label: 'Lantern Cloud', _kept: 'a key the form does not show',
    entry: { title: 'Founder / Principal Engineer', org: 'Lantern Cloud (lantern.example.test) | independent product', person_url: 'https://robin.example.test/',
      platform_url: 'https://lantern-cloud.example.test/', span: '2024 to Present', bullets: form().bullets, tech: form().tech, applications: form().applications, kept_too: 'also kept' },
    skills: form().skills, scoring_blurb: form().scoring_blurb }, 'an empty note and an empty link remove their keys; keys the form does not show stay');
  assert.deepEqual(saved().roles, profile().roles, 'the jobs are untouched');
  const kept = backups();
  assert.equal(kept.length, 1, 'one backup');
  assert.equal(fs.readFileSync(path.join(dir, 'backups', kept[0]), 'utf8'), before, 'the backup is the exact earlier file');
  const audit = fs.readFileSync(path.join(dir, 'enrichment_log.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)).at(-1);
  assert.ok(audit.changelog.includes('saved portfolio: organization or product changed') && audit.changelog.includes('saved portfolio: bullets changed'), JSON.stringify(audit));
  assert.ok(!audit.changelog.some((line) => /dates|your site/.test(line)), 'unchanged fields are not logged');
  const listed = bank.read(dir).entries.find((entry) => entry.id === 'saved-portfolio');
  assert.equal(listed.title, 'Lantern Cloud (lantern.example.test) | independent product', 'Other experience names it by the saved organization');
  assert.ok(listed.facts.includes('Rebuilt Lantern as Lantern Cloud in Rust.') && !listed.facts.includes('Wrote the Lantern scheduler.'), 'a résumé that ticks it reads the new bullets');
  const record = readMasterRecord({ userDir: dir }).additional.find((entry) => entry.id === 'saved-portfolio');
  assert.deepEqual([record.organization, record.bullets, record.links], [form().org, form().bullets, ['https://robin.example.test/', 'https://lantern-cloud.example.test/']]);
  const scoring = spawnSync(python, ['-c', 'from jobhunter import profile\nprint(profile.summary(include_oshal=True))'], { cwd: packageRoot, encoding: 'utf8', env: env() });
  assert.equal(scoring.status, 0, scoring.stderr);
  assert.ok(scoring.stdout.includes(form().scoring_blurb) && scoring.stdout.includes('Release engineering, blue/green'), 'job scoring reads the new summary and skills');
  assert.ok(!scoring.stdout.includes('a job scheduler written in Go'), 'and not the old one');
  const undone = await call('POST', '/resume/master-undo', { revision: body.revision, restore: opened.revision });
  assert.equal(undone.code, 200, JSON.stringify(undone.body));
  assert.equal(text(), before, 'Undo puts back the exact earlier file');
});

test('a moved main résumé, one bad field, too many bullets or a partial form changes nothing and says why', async () => {
  reset('refusals');
  const { body: opened } = await read();
  const first = await save(opened.revision, form());
  assert.equal(first.code, 200);
  const after = text(), kept = backups().length;
  const stale = await save(opened.revision, form({ org: 'Somewhere else' }));
  assert.equal(stale.code, 409);
  assert.match(stale.body.error, /changed after this form was opened/);
  const refusals = [
    [form({ org: 'Changed too', product_url: 'javascript:alert(1)' }), /product link must be a full web address/],
    [form({ bullets: Array.from({ length: 21 }, (_, n) => `Bullet ${n + 1}.`) }), /Keep at most 20 bullets; this has 21/],
    [form({ tech: ['x'.repeat(101)] }), /Item 1 of the technology is longer than 100 characters/],
    [form({ scoring_blurb: 'Bad\u0007bell' }), /summary for job scoring holds a character/],
    [(({ note, ...rest }) => rest)(form()), /Save the whole portfolio form/],
    [{ ...form(), extra: 'x' }, /Save the whole portfolio form/],
  ];
  for (const [value, words] of refusals) {
    const { code, body } = await save(first.body.revision, value);
    assert.equal(code, 422, JSON.stringify(body));
    assert.match(body.error, words);
    assert.match(body.error, /Nothing was saved\.$/);
  }
  assert.equal(text(), after, 'no refused save changed a byte');
  assert.equal(backups().length, kept, 'and none took a backup');
});

test('a save that would grow the main résumé past what job scoring reads is refused in words', async () => {
  const roles = Array.from({ length: 25 }, (_, n) => ({ id: `r${n}`, title: `Engineer ${n}`, org: `Sample ${n}`, start: '2010-01', end: '2011-01',
    deliverables: Array.from({ length: 5 }, (_, m) => `Role ${n} bullet ${m}: ` + 'recorded work '.repeat(70)) }));
  reset('budget', profile({ roles }));
  const before = text(), { body: opened } = await read();
  const { code, body } = await save(opened.revision, form({ bullets: Array.from({ length: 8 }, (_, n) => `Long bullet ${n}: ` + 'measured outcome '.repeat(80)) }));
  assert.equal(code, 422, JSON.stringify(body));
  assert.match(body.error, /can be at most 128 KB; with this portfolio it would be \d+ KB/);
  assert.equal(text(), before);
});

test('with no saved portfolio the read says so, an empty form writes nothing, and the same edit writes one the list then offers', async () => {
  const { oss_portfolio: _none, ...without } = profile();
  reset('first', without);
  const { body: opened } = await read();
  assert.deepEqual([opened.present, opened.portfolio], [false, null]);
  const before = text(), empty = Object.fromEntries(Object.entries(form()).map(([key, value]) => [key, Array.isArray(value) ? [] : '']));
  const nothing = await save(opened.revision, empty);
  assert.deepEqual([nothing.code, nothing.body.changed], [200, false]);
  assert.equal(text(), before, 'an empty form writes nothing');
  assert.equal(bank.read(dir).entries.length, 0);
  const made = await save(opened.revision, form());
  assert.deepEqual([made.code, made.body.changed], [200, true], JSON.stringify(made.body));
  assert.equal(made.body.changelog[0], 'saved portfolio: created');
  assert.deepEqual(Object.keys(saved().oss_portfolio).sort(), ['entry', 'label', 'scoring_blurb', 'skills'], 'only what the form held is written');
  assert.equal(bank.read(dir).entries[0].title, form().org, 'the list offers it');
});

test('an approved draft in the stored shape applies exactly through the same edit (scripts/portfolio-apply.mjs)', async () => {
  const { toForm, changes } = await import('../scripts/portfolio-apply.mjs');
  reset('draft');
  const draft = { _note: 'Approved draft.', label: 'Lantern Cloud', entry: { title: 'Founder / Principal Engineer', org: 'Lantern Cloud | independent product',
    person_url: 'https://robin.example.test/', platform_url: 'https://lantern-cloud.example.test/', product_url: 'https://try.lantern-cloud.example.test/', span: '2024 to Present',
    bullets: ['Rebuilt Lantern in Rust.'], tech: ['Rust'], applications: ['Ledger'] }, skills: ['Rust'], scoring_blurb: 'Lantern Cloud, in Rust.' };
  const { body: opened } = await read(), value = toForm(draft);
  assert.deepEqual(changes(opened.portfolio, value).map((change) => change.field).sort(),
    ['applications', 'bullets', 'label', 'note', 'org', 'platform_url', 'product_url', 'scoring_blurb', 'skills', 'tech', 'title']);
  const { code, body } = await save(opened.revision, value);
  assert.equal(code, 200, JSON.stringify(body));
  const { _kept, ...stored } = saved().oss_portfolio, { kept_too, ...entry } = stored.entry;
  assert.deepEqual({ ...stored, entry }, draft, 'the saved portfolio is the draft, plus only the keys the form does not show');
  assert.throws(() => toForm({ ...draft, name: 'x' }), /fields the form cannot save: name/);
  assert.throws(() => toForm({ ...draft, entry: { ...draft.entry, site: 'x' } }), /entry.site/);
});

test('the list no longer copies the portfolio; a copy saved before 1.68.7 keeps its own form and the portfolio form refuses to split them', async () => {
  reset('copies');
  const library = bank.read(dir);
  const copied = await call('POST', '/experience-bank', { operation: 'save', id: 'saved-portfolio', expectedRevision: library.revision,
    entry: { title: 'Lantern', kind: 'project', organization: 'Lantern', period: '', facts: 'Edited copy.', skills: [] } });
  assert.equal(copied.code, 409);
  assert.match(copied.body.error, /has its own Edit form on this page/);
  assert.equal(fs.existsSync(path.join(dir, 'experience-bank.json')), false, 'no copy was written');
  fs.writeFileSync(path.join(dir, 'experience-bank.json'), JSON.stringify({ version: 1, entries: [{ id: 'saved-portfolio', title: 'Lantern (my copy)', kind: 'project',
    organization: 'Lantern', period: '', facts: 'A copy saved on Other experience before 1.68.7.', skills: [], archived: false, source: 'Saved career portfolio' }] }));
  const { body: opened } = await read();
  assert.equal(opened.copy, true);
  const before = text(), refused = await save(opened.revision, form());
  assert.equal(refused.code, 422);
  assert.match(refused.body.error, /keeps its own copy of this entry/);
  assert.equal(text(), before);
  const again = bank.read(dir), edited = await call('POST', '/experience-bank', { operation: 'save', id: 'saved-portfolio', expectedRevision: again.revision,
    entry: { title: 'Lantern (my copy)', kind: 'project', organization: 'Lantern', period: '', facts: 'Edited copy.', skills: [] } });
  assert.equal(edited.code, 200, 'the copy is edited on the list as before');
});

async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600 });
  const page = await context.newPage(), errors = [], outside = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : (outside.push(route.request().url()), route.abort())));
  await page.goto(origin + '/api/career-hunter/experience-library');
  await page.locator('#entries .entry').first().waitFor({ timeout: 15000 });
  return { page, context, errors, outside };
}

for (const [width, height] of [[1440, 900], [412, 915]]) {
  test(`the shipped page edits the portfolio with Undo at ${width}x${height}`, async () => {
    reset(`page-${width}`);
    fs.writeFileSync(path.join(dir, 'experience-bank.json'), JSON.stringify({ version: 1, entries: [{ id: 'volunteer-teaching-01', title: 'Volunteer maths tutor', kind: 'volunteer',
      organization: 'Sample Library', period: '2022', facts: 'Tutored on Saturdays.', skills: [], archived: false, source: 'Your recorded work' }] }));
    const before = text(), { page, context, errors, outside } = await open(width, height);
    const entry = page.locator('#entries .entry', { hasText: 'Lantern (open-source)' });
    await entry.click();
    await assert.doesNotReject(page.locator('#portfolioForm').waitFor({ state: 'visible' }));
    assert.equal(await page.locator('#editor').isHidden(), true, 'the list\'s own form is not shown for the portfolio');
    assert.equal(await page.locator('#pfOrg').inputValue(), 'Lantern (open-source)');
    assert.equal(await page.locator('#pfBullets').inputValue(), 'Wrote the Lantern scheduler.\nKept 12 plugins working.');
    if (width < 600) {
      const fit = await page.evaluate(() => {
        const form = document.getElementById('portfolioForm'), box = form.getBoundingClientRect();
        const controls = [...form.querySelectorAll('input, textarea, button:not([hidden])')].filter((el) => el.offsetParent);
        return { sideways: document.scrollingElement.scrollWidth - innerWidth, inside: box.right <= innerWidth + 0.5,
          short: controls.filter((el) => el.getBoundingClientRect().height < 44).map((el) => el.id),
          small: controls.filter((el) => el.tagName !== 'BUTTON' && parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => el.id),
          columns: new Set(controls.filter((el) => el.tagName !== 'BUTTON').map((el) => Math.round(el.getBoundingClientRect().left))).size };
      });
      assert.deepEqual(fit, { sideways: 0, inside: true, short: [], small: [], columns: 1 }, 'one column, 44 px controls, 16 px fields, nothing sideways');
    }
    await page.locator('#pfOrg').fill('Lantern Cloud | independent product');
    await page.locator('#pfBullets').fill('Rebuilt Lantern as Lantern Cloud in Rust.\n\nShip 30+ plugins.');
    await page.locator('#pfProduct').fill('');
    await page.getByRole('button', { name: 'Save portfolio' }).click();
    await page.locator('#pfNotice', { hasText: 'Saved.' }).waitFor();
    const portfolio = saved().oss_portfolio;
    assert.deepEqual([portfolio.entry.org, portfolio.entry.bullets, 'product_url' in portfolio.entry], ['Lantern Cloud | independent product', ['Rebuilt Lantern as Lantern Cloud in Rust.', 'Ship 30+ plugins.'], false]);
    await page.locator('#entries .entry', { hasText: 'Lantern Cloud | independent product' }).waitFor();
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.locator('#pfNotice', { hasText: 'Undone.' }).waitFor();
    assert.equal(text(), before, 'Undo from the page puts back the exact earlier file');
    assert.equal(await page.locator('#pfOrg').inputValue(), 'Lantern (open-source)');
    await page.locator('#entries .entry', { hasText: 'Volunteer maths tutor' }).click();
    assert.equal(await page.locator('#portfolioForm').isHidden(), true, 'another entry keeps the list\'s own form');
    assert.equal(await page.locator('#title').inputValue(), 'Volunteer maths tutor');
    assert.deepEqual([errors, outside], [[], []]);
    await context.close();
  });
}
