/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.17: real-Chromium proof for direct inline editing on tailored job résumés and cover letters (?id=42&application=1, editing "2 years of Java" to "11 years of Java", plaintext paste, Save & return to application) and Intelligent Career's light/slate/teal look & feel inside the embedded Concierge iframe even against data-theme="midnight".
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.68.18: real-Chromium proof for switching from an active AI Office Main résumé to a tailored job (2782383), late-resolving office.open() race guard, #tailoredBar Direct editing pill, section quick-jump focus, and Undo/Redo snapshot persistence.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chatWindow, kernelPlatform, mountWindow, toolchain, windowKernel } from '../../scripts/one-chat-window/kernel-window.mjs';

const require = createRequire(import.meta.url);
const Office = require('../tools/career-resume-office.js');
const tools = path.resolve(import.meta.dirname, '../tools');
const POSTING = 42;
const TAILORED_ID = 2782383;
const MASTER_DOC_ID = '7d3f0c2a-5b8e-4f1a-9c6d-2e4b8a0f1c3d';
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true };

const ribbon = [
  ['home', 'Home', 'home'],
  ['search', 'Find jobs', 'search-ui'],
  ['board', 'My jobs', 'board-native'],
  ['resume-studio', 'My résumé', 'resume-studio'],
  ['work-history', 'Work history', 'work-history'],
].map(([id, label, view]) => ({
  id: 'tool-career-' + id, label, section: 'top',
  toolUi: { iframeUrl: '/api/career-hunter/' + view, visibilityToolName: 'career-' + id },
}));

const initialPacket = () => ({
  resume: {
    headline: 'Senior Software Engineer | Java & Distributed Systems',
    summary: 'Software engineer with 2 years of Java and engineering delivery across enterprise cloud platforms.',
    competencies: ['Java Architecture', 'Cloud Platforms'],
    experience: [
      {
        title: 'Senior Software Engineer',
        org: 'Northwind Systems',
        span: '2020 – Present',
        bullets: [
          'Delivered backend services with 2 years of Java experience in production.',
          'Reduced deployment lead time by 40 percent across core APIs.',
        ],
      },
    ],
    skills: ['Java', 'Kubernetes', 'PostgreSQL'],
    education: ['B.S. Computer Science'],
    certifications: ['AWS Solutions Architect'],
    clearance: 'Active Secret',
  },
  cover: {
    greeting: 'Dear Acme Hiring Team,',
    paragraphs: [
      'I bring 2 years of Java and engineering experience building resilient enterprise platforms.',
    ],
    closing: 'Sincerely, Sample Candidate',
  },
  meta: { title: 'Software Engineer', company: 'Acme', name: 'Sample Candidate', postingId: POSTING },
});

let store = initialPacket(), tailored2782383 = null, server, origin, browser, platform, holdOfficeDocs = null;
const saves = [];

const masterPacket = () => ({
  revision: 'a'.repeat(64),
  resume: {
    headline: 'Principal Systems Architect',
    summary: 'Master career summary synced with Work history.',
    competencies: ['Systems Architecture'],
    experience: [{ id: 'm1', title: 'Principal Architect', org: 'Northwind', span: '2020 – Present', bullets: ['Built enterprise services.'] }],
    skills: ['Java', 'Rust'],
  },
  cover: {},
  meta: { master: true, name: 'Sample Candidate' },
});

const savedOfficeDoc = () => {
  const m = masterPacket();
  return { id: MASTER_DOC_ID, title: Office.TITLE, kind: 'docx', revision: 3, model: Office.resumeToModel(m.resume, m.meta, m.revision) };
};

const kernel = windowKernel({
  answer: () => 'Your tailored résumé for Software Engineer at Acme is ready to review.',
});

function buildApp() {
  const express = toolchain('express'), web = express();
  web.use(express.json({ limit: '1mb' }));
  mountWindow(web, { platform, kernel });
  web.get('/api/career-hunter/resume-studio', (_req, res) => res.sendFile('career-resume-studio.html', { root: tools }));
  web.get('/api/career-hunter/board-native', (_req, res) => res.type('html').send('<!doctype html><html><body><h1 id="returnedApp">Application documents</h1></body></html>'));
  web.use('/api/career-hunter/static', express.static(tools));
  web.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: ribbon } } }));
  web.get('/api/auth/user', (_req, res) => res.json({ displayName: 'Sample' }));
  web.get('/api/career-hunter/jobs/stats', (_req, res) => res.json({ saved: 2, queued: 1, tracked: 0 }));
  web.get('/api/career-hunter/jobs', (_req, res) => res.json({
    jobs: [
      { id: POSTING, title: 'Software Engineer', company: 'Acme', has_resume: true },
      { id: TAILORED_ID, title: 'Principal Engineer', company: 'Apex Federal', has_resume: true },
    ],
  }));
  web.get('/api/career-hunter/resume/state', (_req, res) => res.json({ hasResume: true, indexing: false, ingest: { state: 'none' } }));
  web.get('/api/career-hunter/resume/doc', (req, res) => {
    if (req.query.id === 'master') return res.json(masterPacket());
    if (req.query.id === String(POSTING)) return res.json(store);
    if (req.query.id === String(TAILORED_ID)) return res.json(tailored2782383);
    return res.status(404).json({ error: 'missing' });
  });
  web.get('/api/presentations/editor/documents', async (_req, res) => {
    if (holdOfficeDocs) await holdOfficeDocs.promise;
    res.json({ documents: [savedOfficeDoc()] });
  });
  web.get('/api/presentations/editor/documents/' + MASTER_DOC_ID, (_req, res) => res.json({ document: savedOfficeDoc() }));
  web.get('/api/presentations/editor/app', (_req, res) => res.type('html').send('<!doctype html><html><body><div id="officeApp">AI Office Editor</div></body></html>'));
  web.post('/api/career-hunter/resume/save', (req, res) => {
    saves.push(JSON.parse(JSON.stringify(req.body)));
    if (String(req.body.postingId) === String(TAILORED_ID)) tailored2782383 = { ...tailored2782383, resume: req.body.resume, cover: req.body.cover };
    else store = { ...store, resume: req.body.resume, cover: req.body.cover };
    res.json({ ok: true });
  });
  return web;
}

before(async () => {
  platform = kernelPlatform(process.env.OSHAL_CORE_ROOT);
  server = buildApp().listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await toolchain('playwright').chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  await new Promise((done) => (server ? server.close(done) : done()));
});

async function openTailored(size, query = `?id=${POSTING}&application=1`) {
  store = initialPacket();
  saves.length = 0;
  const context = await browser.newContext(size);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
  await page.goto(`${origin}/api/career-hunter/resume-studio${query}`);
  await page.locator('#sheet h1').waitFor({ timeout: 15000 });
  await page.locator('#sheet .summary[contenteditable="true"]').waitFor({ timeout: 10000 });
  return { context, page, errors };
}

test('tailored job résumé and cover letter are directly editable in place and Save & return to application persists edits', async () => {
  const { context, page, errors } = await openTailored(DESKTOP);
  try {
    assert.equal(await page.locator('#docIdentityBadge').textContent(), 'Tailored résumé');
    assert.match(await page.locator('#docIdentityDetail').textContent(), /For Software Engineer · Acme — click any text below to edit directly/);
    assert.match(await page.locator('#docIdentityDetail').textContent(), /not your main résumé/);

    const saveBtn = page.locator('#save');
    assert.equal(await saveBtn.textContent(), 'Save & return to application');
    assert.equal(await saveBtn.isDisabled(), true, 'Save starts disabled before edits');
    assert.match(await saveBtn.getAttribute('class'), /ck-btn/);

    // Edit summary directly in place: "2 years of Java" -> "11 years of Java"
    const summary = page.locator('#sheet .summary');
    await summary.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Software engineer with 11 years of Java and engineering delivery across enterprise cloud platforms.');

    assert.equal(await saveBtn.isDisabled(), false, 'first inline edit immediately enables Save & return to application');
    assert.match(await saveBtn.getAttribute('class'), /ck-primary/, 'dirty Save button promotes to primary teal style');
    assert.match(await page.locator('#status').textContent(), /Unsaved edits/);

    // Edit first experience bullet in place
    const firstBullet = page.locator('#sheet .exp [data-edit-field="role-bullet"]').first();
    await firstBullet.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Delivered backend services with 11 years of Java experience in production.');

    // Verify plaintext-safe paste strips HTML tags on role headline
    const headline = page.locator('#sheet .headline');
    await headline.click();
    await headline.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const dt = new DataTransfer();
      dt.setData('text/html', '<b style="color:red">Principal Java Engineer</b>');
      dt.setData('text/plain', 'Principal Java Engineer');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    assert.equal(await headline.locator('b').count(), 0, 'paste never injects HTML markup');
    assert.equal((await headline.textContent()).trim(), 'Principal Java Engineer');

    // Edit cover letter paragraph directly in place
    const coverPara = page.locator('#sheet .cover-preview [data-edit-field="cover-paragraph"]').first();
    await coverPara.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('I bring 11 years of Java and engineering experience building resilient enterprise platforms.');

    // Click Save & return to application and verify full payload + return navigation
    await Promise.all([
      page.waitForURL(/\/api\/career-hunter\/board-native\?.*application=42.*step=documents/, { timeout: 15000 }),
      saveBtn.click(),
    ]);
    await page.locator('#returnedApp').waitFor({ timeout: 10000 });

    assert.equal(saves.length, 1, 'POST /resume/save called once');
    assert.equal(saves[0].postingId, POSTING);
    assert.match(saves[0].resume.summary, /11 years of Java and engineering/);
    assert.equal(saves[0].resume.headline, 'Principal Java Engineer');
    assert.match(saves[0].resume.experience[0].bullets[0], /11 years of Java/);
    assert.match(saves[0].cover.paragraphs[0], /11 years of Java and engineering/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

for (const [label, size] of [['desktop', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: Intelligent Career Concierge iframe wears Career light/slate/teal look even with data-theme="midnight"`, async () => {
    const { context, page, errors } = await openTailored(size, `?id=${POSTING}`);
    try {
      await page.locator('.cf-topbar[data-cf-ready]').waitFor({ timeout: 15000 });
      if (label === 'desktop') {
        await page.locator('.cf-topbar .cf-concierge-toggle').click();
      } else {
        await page.getByRole('button', { name: 'Edit with AI' }).tap();
      }
      const pane = page.locator('.cf-concierge');
      await pane.waitFor({ state: 'visible', timeout: 10000 });
      const chat = await chatWindow(pane);

      // Force data-theme="midnight" inside the concierge iframe to prove Career's skin always wins over Midnight.
      const skinState = await page.evaluate(async () => {
        const iframe = document.querySelector('.cf-concierge iframe.jarvis-chat-frame');
        const fdoc = iframe.contentDocument;
        const link = fdoc.getElementById('career-concierge-skin');
        if (link && !link.sheet) {
          await new Promise((resolve) => { link.addEventListener('load', resolve, { once: true }); setTimeout(resolve, 1500); });
        }
        fdoc.documentElement.setAttribute('data-theme', 'midnight');
        const csBody = fdoc.defaultView.getComputedStyle(fdoc.body);
        const sendBtn = fdoc.querySelector('.typer button[type=submit]') || fdoc.querySelector('.typer button');
        const csSend = sendBtn ? fdoc.defaultView.getComputedStyle(sendBtn) : null;
        const composer = fdoc.querySelector('.jc-composer');
        const csComposer = composer ? fdoc.defaultView.getComputedStyle(composer) : null;
        return {
          frameAttr: fdoc.documentElement.getAttribute('data-career-frame'),
          hasLink: Boolean(link),
          bodyBg: csBody.backgroundColor,
          bodyInk: csBody.color,
          sendBg: csSend ? csSend.backgroundColor : null,
          sendInk: csSend ? csSend.color : null,
          composerBg: csComposer ? csComposer.backgroundColor : null,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });

      assert.equal(skinState.frameAttr, 'concierge', 'concierge iframe carries data-career-frame="concierge"');
      assert.equal(skinState.hasLink, true, 'concierge iframe loads career-frame.css');
      assert.equal(skinState.bodyBg, 'rgb(243, 245, 248)', 'concierge canvas uses Career #f3f5f8 light background');
      assert.equal(skinState.bodyInk, 'rgb(15, 27, 45)', 'concierge primary ink uses Career #0f1b2d slate ink');
      assert.equal(skinState.sendBg, 'rgb(15, 95, 115)', 'concierge Send button uses Career #0f5f73 teal accent');
      assert.equal(skinState.sendInk, 'rgb(255, 255, 255)', 'concierge Send button uses crisp #ffffff ink');
      assert.equal(skinState.composerBg, 'rgb(255, 255, 255)', 'concierge composer card uses crisp #ffffff surface');
      assert.equal(skinState.overflow, false, 'zero horizontal overflow');
      assert.ok(await chat.locator('.jc-composer').isVisible());
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

test('switching from active AI Office Main résumé to a tailored job hides officeHost, shows Direct editing toolbar, Undo/Redo, quick-jumps, and saves', async () => {
  holdOfficeDocs = null;
  tailored2782383 = { ...initialPacket(), meta: { title: 'Principal Engineer', company: 'Apex Federal', name: 'Sample Candidate', postingId: TAILORED_ID } };
  saves.length = 0;
  const context = await browser.newContext(DESKTOP);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  try {
    await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
    await page.goto(`${origin}/api/career-hunter/resume-studio?id=master`);
    await page.waitForFunction(() => document.body.dataset.view === 'office' && Boolean(document.getElementById('officeFrame')));
    assert.equal(await page.locator('#officeHost').isVisible(), true, 'AI Office host is genuinely active on master');
    assert.equal(await page.locator('#tailoredBar').isVisible().catch(() => false), false, 'tailored toolbar is hidden in Office view');

    await page.waitForFunction((id) => [...document.getElementById('pick').options].some((o) => o.value === String(id)), TAILORED_ID);
    await page.locator('#pick').selectOption(String(TAILORED_ID));

    await page.locator('#sheet .summary[contenteditable="true"]').waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await page.evaluate(() => document.body.dataset.view || ''), '', 'office view attribute cleared on tailored switch');
    assert.equal(await page.locator('#officeHost').isVisible(), false, 'officeHost hidden on tailored switch');
    assert.equal(await page.locator('#tailoredBar').isVisible(), true, 'Direct editing toolbar visible');
    assert.match(await page.locator('#tailoredBar [data-editor-mode="direct"]').textContent(), /Direct editing/);

    // Verify quick-jump buttons exist and focus their section editable targets
    assert.deepEqual(await page.locator('#tailoredBar [data-editor-jump]').allTextContents(), ['Summary', 'Experience', 'Skills', 'Cover letter']);
    await page.locator('#tailoredBar [data-editor-jump="skills"]').click();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-edit-field')), 'skills');
    await page.locator('#tailoredBar [data-editor-jump="summary"]').click();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-edit-field')), 'summary');

    // Type edit, verify Undo restores prior text and Redo brings back the edit
    const summary = page.locator('#sheet .summary');
    await summary.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Software engineer with 11 years of Java and distributed systems delivery.');
    assert.equal(await page.locator('#save').isDisabled(), false);
    assert.equal(await page.locator('#tailoredBar [data-editor-action="undo"]').isDisabled(), false, 'Undo enables immediately after edit');

    await page.locator('#tailoredBar [data-editor-action="undo"]').click();
    assert.match(await page.locator('#sheet .summary').textContent(), /2 years of Java/, 'Undo restores prior summary text');
    assert.equal(await page.locator('#tailoredBar [data-editor-action="redo"]').isDisabled(), false, 'Redo enables after Undo');

    await page.locator('#tailoredBar [data-editor-action="redo"]').click();
    assert.match(await page.locator('#sheet .summary').textContent(), /11 years of Java/, 'Redo reapplies edited summary text');

    await page.locator('#save').click();
    await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('Saved'));
    assert.equal(saves.length, 1);
    assert.equal(saves[0].postingId, TAILORED_ID);
    assert.match(saves[0].resume.summary, /11 years of Java/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('late-resolving master office.open() never hides or overrides a tailored job selected mid-flight', async () => {
  let releaseOffice;
  holdOfficeDocs = { promise: new Promise((resolve) => { releaseOffice = resolve; }) };
  tailored2782383 = { ...initialPacket(), meta: { title: 'Principal Engineer', company: 'Apex Federal', name: 'Sample Candidate', postingId: TAILORED_ID } };
  saves.length = 0;
  const context = await browser.newContext(DESKTOP);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  try {
    await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
    await page.goto(`${origin}/api/career-hunter/resume-studio?id=master`);
    await page.waitForFunction((id) => [...document.getElementById('pick').options].some((o) => o.value === String(id)), TAILORED_ID);

    // Switch to tailored job while master's AI Office open() is still pending
    await page.locator('#pick').selectOption(String(TAILORED_ID));
    await page.locator('#sheet .summary[contenteditable="true"]').waitFor({ state: 'visible', timeout: 10000 });

    // Now release the stale master office.open() request and wait for it to settle
    releaseOffice();
    await page.waitForTimeout(300);

    assert.equal(await page.evaluate(() => document.body.dataset.view || ''), '', 'stale office.open() never flips body back to office view');
    assert.equal(await page.locator('#officeHost').isVisible(), false, 'stale office.open() never unhides officeHost');
    assert.equal(await page.locator('#sheet').isVisible(), true, 'tailored #sheet remains visible');
    assert.equal(await page.locator('#tailoredBar').isVisible(), true, 'Direct editing toolbar remains visible');
    assert.equal(await page.locator('#docIdentityBadge').textContent(), 'Tailored résumé');

    const summary = page.locator('#sheet .summary');
    await summary.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Verified editable after late master office resolution: 11 years of Java.');
    assert.equal(await page.locator('#save').isDisabled(), false);
    assert.deepEqual(errors, []);
  } finally {
    holdOfficeDocs = null;
    await context.close();
  }
});
