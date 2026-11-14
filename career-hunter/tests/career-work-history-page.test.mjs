/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.61.0, the Work history page (Roger, 2026-11-13: "we are missing the page to put in my expierence and when it is avialbe the concierge should be able to make the changes and reflct them on the screen"). The shipped page in Chromium, over Career's real résumé route module (POST /resume/master-edit and /resume/master-undo, GET /resume/doc) and its real engine programs on a made-up person's disposable profile: a job's months, employer and bullets edited, moved, added and removed and saved, Undo putting the exact earlier profile back, a job added first, moved and removed, a form that is missing its employer refused in words; at 412 and 360 px one column, 44 px controls, 16 px fields and no sideways scroll; and Career's concierge proposing a new job as an approval card whose approved change is on the page at once with Undo. Doubled: the model (a scripted concierge) and the kernel's proposal relay, which runs the real engine patch.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The store gate failed the concierge case on its kernel platform pin (~/.local/state/oshal-store-gate/kernel-platform-d43b5a8d): Express's res.sendFile refuses an absolute path with a dot-folder segment (~/.local) with 404, so the shared approval-card script never loaded ("Approval cards could not be loaded") and the card's words never appeared. Every file this fixture serves is now sent relative to its folder (the `root` option), and the files are checked before use (the page and shared assistant in before(), the card script in the concierge case), so a fixture or a platform export that cannot serve them fails at once by name: the gate's older pin (kernel-platform-99464cf9) holds only src/shared/ui, so there the concierge case names the missing src/api/jarvis-package-tools.js.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.61.2 (Roger, 2026-11-13 ~22:16Z: each new job held his whole pasted draft as one bullet that stopped mid-sentence): a pasted draft longer than 1000 characters stays whole in the bullet box (it had maxlength 1000, which a browser applies to a paste by cutting it) and Save turns it into one bullet per line.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The changed-with-Undo bar leaves after 12 seconds (it covered the Word editor's bar on a phone, seen on blue), but not while it is pointed at.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url), packageRoot = path.resolve(import.meta.dirname, '..'), repo = path.resolve(packageRoot, '..');
const express = require(require.resolve('express', { paths: [path.join(repo, 'scripts/toolchain')] }));
const { chromium } = require(require.resolve('playwright', { paths: [path.join(repo, 'scripts/toolchain')] }));
const platform = process.env.OSHAL_KERNEL_PLATFORM || process.env.OSHAL_CORE_ROOT;
const W = require('../tools/career-work-history.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-work-history-page-'));
const binPath = path.join(packageRoot, 'bin/oshal-jobhunter.js'), cli = new Module(binPath);
cli.filename = binPath; cli.paths = Module._nodeModulePaths(path.dirname(binPath));
cli._compile(fs.readFileSync(binPath, 'utf8') + '\nmodule.exports.mapping=engineRuns;', binPath);
const fixture = {
  profile: { name: 'Olive Testperson', headline: 'Systems engineer', experience_summary: 'Made-up summary.', clearance: 'None' },
  roles: [
    { id: 'r1', title: 'Principal Engineer', org: 'Example Freight Co', start: '2019-03', end: null, deliverables: ['Shipped the routing service', 'Cut deploy time 40%'] },
    { id: 'r2', title: 'Software Engineer', org: 'Sample Bank', start: '2014-06', end: '2019-02', deliverables: ['Built the payments ledger', 'Wrote the on-call runbook'] },
  ],
  skills: { Core: { items: ['Rust'] } },
};
let dir = '', server, origin, browser, proposal = null;
const file = () => path.join(dir, 'career_db.json');
const saved = () => JSON.parse(fs.readFileSync(file(), 'utf8'));
function reset(name) { dir = path.join(root, name); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file(), JSON.stringify(fixture, null, 2)); }
function engine(args, env = {}) {
  const run = cli.exports.mapping(args[0], args.slice(1))[0];
  const out = spawnSync(process.env.CAREER_TEST_PYTHON || 'python3', run, { cwd: packageRoot, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, JOBHUNTER_DATA: dir, JOBHUNTER_CAREER_DB: file(), PYTHONPATH: path.join(packageRoot, 'engine'), ...env } });
  return { ok: out.status === 0, out: out.stdout, err: out.stderr };
}
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ error() {}, warn() {}, info() {} }) };
  if (request === '@/features/agent-management') return { BotNodeClient: class {}, createRegistryEndpointResolver: () => null };
  if (request === '@/app/routes/inline-bot-execution' || request === './career-engine-runner') return {};
  if (request === './career-user-store') return { callerSub: () => 'alice', findUserPaths: () => ({ userDir: dir }), userPaths: () => ({ userDir: dir }) };
  if (request === './career-engine-dispatch') return { runCareerCliAwait: async (_pool, sub, args, env) => { assert.equal(sub, 'alice'); return engine(args, env); } };
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
  // Relative to a root: an absolute path through a dot folder (a platform pin under ~/.local) is refused by sendFile.
  web.get('/api/career-hunter/work-history', (_req, res) => res.sendFile('career-work-history.html', { root: tools }));
  web.use('/api/career-hunter/static', express.static(tools));
  web.use('/api/career-hunter', router);
  web.use('/shared/ui', express.static(path.join(platform, 'src/shared/ui')));
  web.get('/shared/ui/js/package-tool-cards.js', (_req, res) => res.type('js').sendFile('jarvis-package-tools.js', { root: path.join(platform, 'src/api') }));
  web.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: ribbon } } }));
  web.get('/api/auth/user', (_req, res) => res.json({ displayName: 'Olive' }));
  web.get('/api/career-hunter/jobs/stats', (_req, res) => res.json({ saved: 0, queued: 0, tracked: 0 }));
  web.get('/api/presentations/editor/documents', (_req, res) => res.json({ documents: [] }));
  web.post('/api/swarm/bots/career-concierge/ask', (req, res) => {
    const { revision } = JSON.parse(engine(['resume', 'base-section'], { CH_RESUME_DOC: JSON.stringify({ field: 'overview', index: 0, offset: 0, limit: 20 }) }).out);
    const at = { roleIndex: 0, roleTitle: 'Staff Engineer' };
    proposal = { id: 'fixture-add-job', app: 'career-hunter', appName: 'Intelligent Career', toolName: 'career_resume_patch', label: 'Change My Résumé or Work History', mode: 'ask',
      expiresAt: new Date(Date.now() + 300000).toISOString(), input: { revision, edits: [
        { op: 'add', field: 'role', index: 0, before: '', value: 'Staff Engineer', summary: 'Add Staff Engineer' },
        { op: 'set', field: 'role', ...at, key: 'org', before: '', value: 'Northwind Labs', summary: 'at Northwind Labs' },
        { op: 'set', field: 'role', ...at, key: 'start', before: '', value: '2026-11', summary: 'from Nov 2026' },
        { op: 'add', field: 'experience', ...at, index: 0, before: '', value: 'Leads the platform group', summary: 'with one bullet' }] } };
    assert.equal(req.body.context.surface, 'work-history');
    res.json({ reply: 'I can add Staff Engineer at Northwind Labs from November 2026. Approve to add it.', packageToolProposal: proposal.id });
  });
  web.get('/api/jarvis/package-tools/proposals/:id', (_req, res) => res.json({ proposal }));
  web.post('/api/jarvis/package-tools/execute', (_req, res) => {
    const result = JSON.parse(engine(['resume', 'base-patch'], { CH_RESUME_DOC: JSON.stringify(proposal.input) }).out);
    res.json({ status: result.ok ? 200 : 409, result, expiresAt: new Date(Date.now() + 60000).toISOString() });
  });
  return web;
}
before(async () => {
  assert.ok(platform, 'OSHAL_KERNEL_PLATFORM must name the kernel platform folder (refusing rather than skipping)');
  server = app().listen(0, '127.0.0.1'); await new Promise((done) => server.once('listening', done));
  origin = 'http://127.0.0.1:' + server.address().port; browser = await chromium.launch({ headless: true });
  for (const [address, mark] of [['/api/career-hunter/work-history', 'Work history'], ['/shared/ui/js/editor-assistant.js', 'createEditorAssistant']]) await served(address, mark);
});
after(async () => { await browser?.close(); server?.closeAllConnections(); await new Promise((done) => server ? server.close(done) : done()); fs.rmSync(root, { recursive: true, force: true }); });

/** The fixture serves this address with the expected file, or the case fails here by name (never a later timeout). */
async function served(address, mark) {
  const answer = await fetch(origin + address);
  assert.equal(answer.status, 200, `the fixture serves ${address} from ${platform}`);
  assert.ok((await answer.text()).includes(mark), `${address} is the expected file`);
}
async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600 });
  const page = await context.newPage(), errors = [], outside = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : (outside.push(route.request().url()), route.abort())));
  await page.goto(origin + '/api/career-hunter/work-history');
  await page.locator('.wh-job').first().waitFor({ timeout: 15000 });
  await page.locator('.cf-topbar[data-cf-ready]').waitFor({ timeout: 15000 });
  return { page, context, errors, outside };
}
const card = (page, title) => page.locator('.wh-job', { has: page.getByRole('heading', { name: title, exact: true }) });

test('the form\'s bullets become edits the real engine applies exactly, in every order a person can make', () => {
  reset('pure');
  const saved0 = ['A one', 'B two', 'C three', 'D four'];
  for (const rows of [
    [{ orig: 3, text: 'D four' }, { orig: 0, text: 'A one, sharper' }, { orig: null, text: 'New first-class bullet' }, { orig: 2, text: 'C three' }],
    [{ orig: null, text: 'Only new' }],
    [{ orig: 1, text: 'B two' }, { orig: 0, text: 'A one' }, { orig: 2, text: '   ' }, { orig: 3, text: 'D four' }, { orig: null, text: 'E five' }],
  ]) {
    fs.writeFileSync(file(), JSON.stringify({ ...fixture, roles: [{ ...fixture.roles[0], deliverables: saved0 }] }));
    const revision = JSON.parse(engine(['resume', 'base']).out).revision;
    const answer = JSON.parse(engine(['resume', 'base-patch'], { CH_RESUME_DOC: JSON.stringify({ revision, edits: W.bulletEdits(0, 'Principal Engineer', saved0, rows) }) }).out);
    assert.equal(answer.ok, true, JSON.stringify(answer));
    assert.deepEqual(saved().roles[0].deliverables, rows.filter((row) => row.text.trim()).map((row) => row.text.trim()));
  }
  assert.deepEqual([W.monthLabel('2019-03'), W.monthLabel('2019'), W.spanLabel('2014-06', ''), W.composeMonth('2013', '09'), W.composeMonth('2013', '')], ['Mar 2019', '2019', 'Jun 2014 – Present', '2013-09', '2013']);
  assert.ok(W.chunks(Array.from({ length: 45 }, (_, n) => ({ op: 'add', value: 'x' + n }))).every((part) => part.length <= 20));
});

test('desktop: edit a job\'s months, employer and bullets, Save, then Undo puts the exact earlier profile back', async () => {
  reset('edit'); const preimage = saved();
  const { page, context, errors, outside } = await open(1280, 900);
  try {
    assert.deepEqual(await page.locator('.wh-job h2').allInnerTexts(), ['Principal Engineer', 'Software Engineer']);
    assert.match(await card(page, 'Software Engineer').locator('.wh-meta').first().innerText(), /Sample Bank · Jun 2014 – Feb 2019/);
    await card(page, 'Software Engineer').getByRole('button', { name: 'Edit Software Engineer' }).click();
    const form = page.locator('.wh-form');
    await form.getByLabel('Employer').fill('Sample Bank N.A.');
    await form.getByLabel('Start month').selectOption('09'); await form.getByLabel('Start year').fill('2013');
    await form.getByRole('textbox', { name: 'Bullet' }).first().fill('Built the payments ledger used by 3 teams');
    await form.getByRole('button', { name: 'Move bullet up' }).nth(1).click();
    await form.getByRole('button', { name: 'Add a bullet' }).click();
    await form.getByRole('textbox', { name: 'Bullet' }).last().fill('Mentored two new engineers');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('#careerChangeBar').getByText('Saved Software Engineer at Sample Bank N.A.').waitFor({ timeout: 15000 });
    const role = saved().roles[1];
    assert.deepEqual([role.org, role.start, role.end, role.deliverables], ['Sample Bank N.A.', '2013-09', '2019-02', ['Wrote the on-call runbook', 'Built the payments ledger used by 3 teams', 'Mentored two new engineers']]);
    assert.match(await card(page, 'Software Engineer').locator('.wh-meta').first().innerText(), /Sample Bank N\.A\. · Sep 2013 – Feb 2019/);
    await page.locator('#careerChangeBar').getByRole('button', { name: 'Undo', exact: true }).click();
    await page.locator('#careerChangeBar').getByText('Put back. Your work history is as it was.').waitFor({ timeout: 15000 });
    assert.deepEqual(saved(), preimage);
    assert.match(await card(page, 'Software Engineer').locator('.wh-meta').first().innerText(), /Sample Bank · Jun 2014 – Feb 2019/);
    assert.deepEqual([errors, outside], [[], []]);
  } finally { await context.close(); }
});

test('desktop: a pasted draft of more than 1000 characters is kept whole and saved as one bullet per line', async () => {
  reset('paste');
  // Roger, 2026-11-13 ~22:16Z: each new job held his whole pasted draft as ONE bullet, and that bullet stopped mid-sentence.
  const lines = Array.from({ length: 8 }, (_, n) => `• Led made-up project ${n + 1} for a regional clinic group, from the first interview with its staff to a release that cut their weekly billing review by ${n + 2} hours`);
  const draft = lines.join('\n');
  assert.ok(draft.length > 1000, 'longer than the old box held');
  const { page, context, errors } = await open(1280, 900);
  try {
    await card(page, 'Principal Engineer').getByRole('button', { name: 'Edit Principal Engineer' }).click();
    const form = page.locator('.wh-form');
    await form.getByRole('button', { name: 'Add a bullet' }).click();
    // A paste, as the browser inserts it (execCommand honours the box's limits the way a real paste does).
    await form.getByRole('textbox', { name: 'Bullet' }).last().evaluate((box, text) => { box.focus(); document.execCommand('insertText', false, text); }, draft);
    assert.equal(await form.getByRole('textbox', { name: 'Bullet' }).last().inputValue(), draft, 'the box keeps the whole paste');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('#careerChangeBar').getByText('Saved Principal Engineer at Example Freight Co.').waitFor({ timeout: 15000 });
    assert.deepEqual(saved().roles[0].deliverables, [...fixture.roles[0].deliverables, ...lines.map(line => line.slice(2))]);
    assert.equal(await card(page, 'Principal Engineer').locator('.wh-bullets li').count(), 10, 'one bullet per line on the page');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('desktop: a new job lands first, moves down, a job is removed after confirming, Undo brings it back, a missing employer is refused in words', async () => {
  reset('add');
  const { page, context, errors } = await open(1280, 900);
  try {
    await page.getByRole('button', { name: 'Add a job' }).click();
    const form = page.locator('.wh-form');
    await form.getByLabel('Job title').fill('Staff Engineer');
    await form.getByLabel('Start month').selectOption('11'); await form.getByLabel('Start year').fill('2026');
    await form.getByRole('button', { name: 'Add this job' }).click();
    assert.equal(await form.getByRole('alert').innerText(), 'Enter the job title and the employer.');
    assert.equal(saved().roles.length, 2, 'nothing was sent');
    await form.getByLabel('Employer').fill('Northwind Labs');
    assert.equal(await form.getByLabel('End year').isDisabled(), true, 'I work here now is ticked for a new job');
    await form.getByRole('textbox', { name: 'Bullet' }).first().fill('Leads the platform group');
    await form.getByRole('button', { name: 'Add this job' }).click();
    await page.locator('#careerChangeBar').getByText('Added Staff Engineer at Northwind Labs.').waitFor({ timeout: 15000 });
    assert.deepEqual(saved().roles.map((role) => [role.title, role.org, role.start, role.end]).slice(0, 1), [['Staff Engineer', 'Northwind Labs', '2026-11', null]]);
    await card(page, 'Staff Engineer').getByRole('button', { name: 'Edit Staff Engineer' }).click();
    await page.locator('.wh-form').getByRole('button', { name: 'Move down' }).click();
    await page.locator('#careerChangeBar').getByText('Moved Staff Engineer.').waitFor({ timeout: 15000 });
    assert.deepEqual(saved().roles.map((role) => role.title), ['Principal Engineer', 'Staff Engineer', 'Software Engineer']);
    await card(page, 'Software Engineer').getByRole('button', { name: 'Edit Software Engineer' }).click();
    await page.locator('.wh-form').getByRole('button', { name: 'Remove this job' }).click();
    await page.locator('#whConfirm').getByText('Remove Software Engineer at Sample Bank and its bullets from your work history? Undo puts it back.').waitFor();
    await page.locator('#whConfirm').getByRole('button', { name: 'Remove', exact: true }).click();
    await page.locator('#careerChangeBar').getByText('Removed Software Engineer.').waitFor({ timeout: 15000 });
    assert.deepEqual(saved().roles.map((role) => role.title), ['Principal Engineer', 'Staff Engineer']);
    await page.locator('#careerChangeBar').getByRole('button', { name: 'Undo', exact: true }).click();
    await card(page, 'Software Engineer').waitFor({ timeout: 15000 });
    assert.deepEqual(saved().roles[2].deliverables, fixture.roles[1].deliverables, 'the removed job came back with its bullets');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

for (const [width, height] of [[412, 915], [360, 800]]) {
  test(`phone ${width}x${height}: one column, 44 px controls, 16 px fields, nothing sideways`, async () => {
    reset('phone-' + width);
    const { page, context, errors } = await open(width, height);
    try {
      await card(page, 'Principal Engineer').getByRole('button', { name: 'Edit Principal Engineer' }).click();
      const m = await page.evaluate(() => {
        const shown = (n) => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
        const small = [...document.querySelectorAll('main :is(button, input, select, textarea, a[href])')].filter(shown)
          // A checkbox is pressed through its whole label, so the label is its touch target.
          .map((n) => { const box = (n.type === 'checkbox' ? n.closest('label') : n).getBoundingClientRect(); return { name: n.getAttribute('aria-label') || n.textContent.trim() || n.name, h: box.height, w: box.width, right: box.right }; })
          .filter((c) => c.h < 44 || c.w < 22 || c.right > innerWidth);
        const start = document.querySelector('.wh-dates fieldset:first-child').getBoundingClientRect(), end = document.querySelector('.wh-dates fieldset:last-child').getBoundingClientRect();
        return { small, sideways: document.documentElement.scrollWidth > innerWidth, stacked: end.top >= start.bottom, font: getComputedStyle(document.querySelector('.wh-form input[name=title]')).fontSize };
      });
      assert.deepEqual(m.small, [], 'every control is at least 44 px tall and inside the screen');
      assert.equal(m.sideways, false); assert.equal(m.stacked, true, 'start above end, one column'); assert.equal(m.font, '16px');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

test('phone: the concierge fills the screen with Back to Work history, proposes a new job as a card, and the approved job is on the page with Undo', async () => {
  reset('concierge');
  await served('/shared/ui/js/package-tool-cards.js', 'oshalPresentPackageTools'); // the kernel's src/api/jarvis-package-tools.js, which approval cards need
  const { page, context, errors } = await open(412, 915);
  try {
    await page.locator('.cf-concierge-toggle').click();
    const pane = page.locator('.cf-concierge');
    await pane.getByRole('textbox', { name: 'Message to concierge' }).fill('Add my new job: Staff Engineer at Northwind Labs since November 2026');
    await pane.getByRole('button', { name: 'Send', exact: true }).click();
    await pane.getByText('Add Staff Engineer, at Northwind Labs, from Nov 2026, with one bullet').waitFor({ timeout: 15000 });
    assert.equal(saved().roles.length, 2, 'nothing changes before the person approves');
    await pane.getByRole('button', { name: 'Approve', exact: true }).click();
    await pane.getByText(/Done/).first().waitFor({ timeout: 15000 });
    await pane.getByRole('button', { name: 'Back to Work history', exact: true }).click();
    await card(page, 'Staff Engineer').waitFor({ timeout: 15000 });
    await page.locator('#careerChangeBar').getByText('The change you approved is on the page.').waitFor();
    assert.equal(saved().roles[0].title, 'Staff Engineer');
    await page.locator('#careerChangeBar').getByRole('button', { name: 'Undo', exact: true }).click();
    await page.locator('#careerChangeBar').getByText('Put back. Your work history is as it was.').waitFor({ timeout: 15000 });
    assert.deepEqual(saved().roles.map((role) => role.title), ['Principal Engineer', 'Software Engineer']);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('the changed-with-Undo bar leaves after 12 seconds, and stays while the pointer is on it', async () => {
  reset('bar');
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } }), page = await context.newPage();
  try {
    await page.clock.install();
    await page.goto(origin + '/api/career-hunter/work-history');
    await page.locator('.wh-job').first().waitFor({ timeout: 15000 });
    const bar = page.locator('#careerChangeBar');
    await page.evaluate(() => window.CareerChangeBar.show({ text: 'Saved a job.', undo: async () => {} }));
    await page.clock.fastForward(11000); assert.equal(await bar.isVisible(), true, 'still there at 11 s');
    await page.clock.fastForward(2000); assert.equal(await bar.isVisible(), false, 'gone after 12 s');
    await page.evaluate(() => window.CareerChangeBar.show({ text: 'Saved again.', undo: async () => {} }));
    await bar.hover(); await page.clock.fastForward(30000); assert.equal(await bar.isVisible(), true, 'held while pointed at');
  } finally { await context.close(); }
});

test('the page is served at /work-history and named in the manifest, the frame and the group', () => {
  for (const source of ['src-routes/career-surface-routes.ts', 'routes/career-surface-routes.js'])
    assert.match(fs.readFileSync(path.join(packageRoot, source), 'utf8'), /router\.get\('\/work-history', createCareerToolFileHandler\('career-work-history\.html'\)\)/);
  const manifest = fs.readFileSync(path.join(packageRoot, 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /- toolName: career-work-history\n\s+label: Work history\n[\s\S]*?iframeUrl: \/api\/career-hunter\/work-history/);
  assert.match(fs.readFileSync(path.join(packageRoot, 'tools/career-frame.js'), 'utf8'), /\['Résumé', \['resume-studio', 'work-history', 'experience-library', 'strengthen'\]\]/);
  assert.match(fs.readFileSync(path.join(repo, 'intelligent-career/oshal-app.yaml'), 'utf8'), /surface: career-work-history,\s+group: Resume/);
});
