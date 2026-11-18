/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.9 (Roger, 2026-11-16, "for the last time": every chat surface is the core Jarvis chat window, with its model menu, New conversation, Recent conversations, Files, Tap to talk and Keep trying). My résumé drew a chat of its own for a job's tailored résumé (the résumé editor: its own transcript, text box and Send, each turn sent to POST /resume/guide), and Career's Concierge button was hidden there. The shipped page, Career's frame and Career's concierge in Chromium, with the kernel's one chat window served from a kernel platform export and its stand-in kernel (scripts/one-chat-window/kernel-window.mjs), over a made-up person's tailored résumé and cover letter. At 1440x900 Career's Concierge opens the window docked beside the résumé; at 412x915 with touch Edit with AI opens it between Career's bars, and Career's Concierge is not offered a second time there; with Career's frame off, Edit with AI mounts Career's concierge and opens it. In each the window shows its model menu, Files, Tap to talk, Keep trying and its conversations; a model picked rides on the turn; the turn reaches career-concierge with this résumé on its context (the posting id as recordId, its title, master false, its revision and the tools that read and change it) in this résumé's own conversation; an edit not yet saved is saved before the turn; the concierge's approval card (career_resume_save) changes this résumé and the page shows the change; the page draws no transcript, text box or Send of its own and sends nothing to /resume/guide; nothing runs sideways off the screen; no page error; nothing leaves the loopback.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chatWindow, kernelPlatform, mountWindow, pickModel, sendInWindow, toolchain, windowControls, windowKernel } from '../../scripts/one-chat-window/kernel-window.mjs';

const tools = path.resolve(import.meta.dirname, '../tools');
const POSTING = 7, DOOR = '/api/swarm/bots/career-concierge/ask';
const TITLE = 'Tailored résumé — Warehouse Supervisor at Sample Logistics';
const FIRST = 'Made-up summary for a made-up person.', TIGHTER = 'Runs a made-up dock crew of six that ships on time.', HEADLINE = 'Dock supervisor';
const DESKTOP = { viewport: { width: 1440, height: 900 } }, PHONE = { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true };
const click = (locator) => locator.click(), tap = (locator) => locator.tap();
/** A picture of the page for the record, when CAREER_CONCIERGE_SCREENSHOTS names a folder. */
const picture = (page, name) => (process.env.CAREER_CONCIERGE_SCREENSHOTS ? page.screenshot({ path: path.join(process.env.CAREER_CONCIERGE_SCREENSHOTS, `resume-one-chat-window-${name}.png`) }) : null);
/** The pages a made-up job seeker may open, as the kernel's profile answer lists them. */
const ribbon = [['home', 'Home', 'home'], ['search', 'Find jobs', 'search-ui'], ['board', 'My jobs', 'board-native'], ['resume-studio', 'My résumé', 'resume-studio'],
  ['work-history', 'Work history', 'work-history'], ['experience-library', 'Other experience', 'experience-library'], ['strengthen', 'Improve my résumé', 'strengthen-ui']]
  .map(([id, label, view]) => ({ id: 'tool-career-' + id, label, section: 'top', toolUi: { iframeUrl: '/api/career-hunter/' + view, visibilityToolName: 'career-' + id } }));
/** The job's tailored résumé and cover letter as Career keeps them (GET /resume/doc?id=7). */
const packet = () => ({
  resume: { headline: 'Warehouse supervisor', summary: FIRST, competencies: ['Shift scheduling'], skills: ['Forklift'],
    experience: [{ title: 'Shift lead', org: 'Example Freight Co', span: '2020-2024', bullets: ['Led a made-up team of six', 'Kept the made-up dock on time'] }] },
  cover: { greeting: 'Dear hiring team,', paragraphs: ['A made-up first paragraph about the dock.'], closing: 'Olive Testperson' },
  meta: { title: 'Warehouse Supervisor', company: 'Sample Logistics', name: 'Olive Testperson', postingId: POSTING },
});
let store = packet(), proposal = null, server, origin, browser, platform;
/** Every Career request the page made, every approved card the kernel ran, and anything the fixture does not answer. */
const calls = [], executed = [], unknown = [];

/**
 * What career-concierge answers. Asked for a change, it proposes career_resume_save for this job with the whole résumé
 * and cover letter, the summary changed (its persona: read the job's saved documents, then send both whole on a card).
 */
const kernel = windowKernel({ answer: (ask) => {
  if (ask.bot !== 'career-concierge' || ask.context?.app !== 'career-hunter') return 'Wrong application.';
  if (!/summary/i.test(ask.message)) return 'This résumé and cover letter are for Warehouse Supervisor at Sample Logistics.';
  proposal = { id: 'fixture-tailored-save', app: 'career-hunter', appName: 'Intelligent Career', toolName: 'career_resume_save', label: 'Save Resume Edits', mode: 'ask',
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    input: { postingId: String(POSTING), resume: { ...store.resume, summary: TIGHTER }, cover: store.cover } };
  return { answer: `I can make the summary shorter: "${TIGHTER}" Approve to save it and make its PDF again.`, packageToolProposal: proposal };
} });

/** A save of this job's résumé and cover letter, as POST /resume/save takes it. */
function keep(body) { if (String(body?.postingId) === String(POSTING) && body.resume && body.cover) store = { ...store, resume: body.resume, cover: body.cover }; }

function app() {
  const express = toolchain('express'), web = express();
  web.use(express.json({ limit: '1mb' }));
  web.use((req, _res, next) => { if (req.path.startsWith('/api/career-hunter/') && !req.path.startsWith('/api/career-hunter/static/')) calls.push({ method: req.method, path: req.path, query: { ...req.query }, body: req.body }); next(); });
  mountWindow(web, { platform, kernel });
  // Relative to a root: an absolute path through a dot folder (a platform pin under ~/.local) is refused by sendFile.
  web.get('/api/career-hunter/resume-studio', (_req, res) => res.sendFile('career-resume-studio.html', { root: tools }));
  web.use('/api/career-hunter/static', express.static(tools));
  web.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: ribbon } } }));
  web.get('/api/auth/user', (_req, res) => res.json({ displayName: 'Olive' }));
  web.get('/api/career-hunter/jobs/stats', (_req, res) => res.json({ saved: 1, queued: 0, tracked: 0 }));
  web.get('/api/career-hunter/jobs', (_req, res) => res.json({ jobs: [{ id: POSTING, title: 'Warehouse Supervisor', company: 'Sample Logistics', has_resume: true }] }));
  web.get('/api/career-hunter/resume/state', (_req, res) => res.json({ hasResume: true, indexing: false, ingest: { state: 'none' } }));
  web.get('/api/career-hunter/resume/doc', (req, res) => (req.query.id === String(POSTING) ? res.json(store) : res.status(404).json({ error: 'not in this fixture' })));
  web.post('/api/career-hunter/resume/save', (req, res) => { keep(req.body); res.json({ ok: true }); });
  web.post('/api/career-hunter/resume/guide', (_req, res) => res.status(500).json({ error: 'the page asked a chat of its own' }));
  web.get('/api/jarvis/package-tools/proposals/:id', (_req, res) => res.json({ proposal }));
  // Approve: the kernel runs the card's held input through the tool's own route (career_resume_save, POST /resume/save).
  web.post('/api/jarvis/package-tools/execute', (req, res) => {
    executed.push({ proposalId: req.body?.proposalId, toolName: proposal?.toolName, input: proposal?.input }); keep(proposal?.input);
    res.json({ status: 200, result: { ok: true }, expiresAt: new Date(Date.now() + 60000).toISOString() });
  });
  web.use((req, res) => { unknown.push(`${req.method} ${req.path}`); res.status(404).json({ error: 'not in this fixture' }); });
  return web;
}

/** The fixture serves this address with the expected file, or the case fails here by name (never a later timeout). */
async function served(address, mark) {
  const answer = await fetch(origin + address);
  assert.equal(answer.status, 200, `the fixture serves ${address} from ${platform}`);
  assert.ok((await answer.text()).includes(mark), `${address} is the expected file`);
}
before(async () => {
  platform = kernelPlatform(process.env.OSHAL_CORE_ROOT);
  server = app().listen(0, '127.0.0.1'); await new Promise((done) => server.once('listening', done));
  origin = 'http://127.0.0.1:' + server.address().port;
  for (const [address, mark] of [['/api/career-hunter/resume-studio', 'My résumé'], ['/shared/ui/js/editor-assistant.js', 'createEditorAssistant'],
    ['/shared/ui/js/jarvis-chat-frame.js', 'mountJarvisChat'], ['/shared/ui/js/package-tool-cards.js', 'oshal-package-tool-done']]) await served(address, mark);
  browser = await toolchain('playwright').chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); server?.closeAllConnections(); await new Promise((done) => (server ? server.close(done) : done())); });

/** Open My résumé on this job's tailored résumé, as a person does from My jobs. */
async function open(size, query = `?id=${POSTING}`) {
  store = packet(); proposal = null; calls.length = 0; executed.length = 0; unknown.length = 0;
  const context = await browser.newContext(size), page = await context.newPage(), errors = [], outside = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : (outside.push(route.request().url()), route.abort())));
  await page.goto(`${origin}/api/career-hunter/resume-studio${query}`);
  await page.locator('#sheet h1').waitFor({ timeout: 15000 });
  await page.locator('#sheet .summary', { hasText: FIRST }).waitFor();
  return { page, context, errors, outside };
}

/** The page draws no chat of its own: no transcript, text box, Send or Close the editor. */
async function noChatOfItsOwn(page) {
  const own = await page.evaluate(() => ['.chat', '#log', '#msg', '#send', '.composer', '#aiClose'].filter((selector) => document.querySelector(selector)));
  assert.deepEqual(own, [], 'the page draws no chat of its own');
}

/** The turn as career-concierge's door got it: the person's words alone, Career's context with this résumé, in its own conversation. */
function thisResume(ask, words) {
  assert.deepEqual([ask.door, ask.bot, ask.message], [DOOR, 'career-concierge', words], 'the person\'s words reach Career\'s concierge');
  assert.equal(ask.prefer, 'respond-async, wait=0');
  const sent = ask.context;
  assert.deepEqual([sent.app, sent.surface, sent.recordId, sent.title], ['career-hunter', 'resume-studio', String(POSTING), TITLE], 'this tailored résumé is the turn\'s document');
  assert.deepEqual([sent.fields.master, sent.fields.readOnly], [false, false]);
  assert.match(String(sent.fields.revision), /^[0-9a-f]{16}$/, 'the saved résumé\'s revision');
  assert.match(String(sent.fields.tools), /\bcareer_documents\b/, 'the tool that reads this résumé and its cover letter');
  assert.match(String(sent.fields.tools), /\bcareer_resume_save\b/, 'the tool that changes them, on a card');
  assert.equal(ask.sessionId, `doc:career-hunter:${POSTING}`, 'the conversation is this résumé\'s own');
}

/** Nothing the page sends goes to the résumé editor's own chat route. */
function noGuide() {
  assert.deepEqual(calls.filter((call) => call.path === '/api/career-hunter/resume/guide'), [], 'nothing goes to POST /resume/guide');
}

/** Where the concierge, the résumé and Career's bars are, and whether the page runs sideways. */
function places(page) {
  return page.evaluate(() => {
    const box = (selector) => {
      const node = document.querySelector(selector);
      if (!node || getComputedStyle(node).display === 'none' || !node.getClientRects().length) return null;
      const r = node.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
    };
    return { width: innerWidth, height: innerHeight, sideways: document.documentElement.scrollWidth > innerWidth + 1, scrolls: document.scrollingElement.scrollHeight > innerHeight + 1,
      pane: box('.cf-concierge'), sheet: box('#sheet'), bars: box('.cf-subnav') || box('.cf-topbar'), nav: box('.cf-bottombar'), bar: box('#aiBar') };
  });
}

test('desktop 1440: Career\'s Concierge is the tailored résumé\'s one chat window; its card changes this résumé and the page shows it', async () => {
  const { page, context, errors, outside } = await open(DESKTOP);
  try {
    await page.locator('.cf-topbar[data-cf-ready]').waitFor({ timeout: 15000 });
    const toggle = page.locator('.cf-topbar .cf-concierge-toggle');
    assert.equal(await toggle.isVisible(), true, 'Career\'s Concierge, in its bar, is how a computer reaches the concierge on a tailored résumé');
    // An edit not yet saved (the floating Jarvis's draft edit): it is saved before the concierge reads the résumé.
    await page.evaluate((text) => document.dispatchEvent(new CustomEvent('surface-bridge:custom', { detail: { name: 'resume_action', data: { actions: [{ op: 'set_headline', text }] } } })), HEADLINE);
    assert.equal(await page.locator('#save').isDisabled(), false, 'the edit is on the page, not yet saved');
    await click(toggle);
    const pane = page.locator('.cf-concierge');
    await pane.waitFor({ state: 'visible', timeout: 10000 });
    const chat = await chatWindow(pane);
    await windowControls(chat);
    await noChatOfItsOwn(page);
    assert.match(await pane.locator('iframe.jarvis-chat-frame').getAttribute('src'), /^\/api\/jarvis\/\?concierge=career-hunter&bot=career-concierge&/);
    assert.match(await chat.locator('.jc-concierge-help').textContent(), /cover letter/, 'the help line speaks of this job\'s résumé and cover letter');
    assert.equal(await pickModel(chat, click), 'Picked model', 'the model picked for this request is on the control');
    const words = 'Tighten the summary of this résumé';
    const { ask, answer } = await sendInWindow(chat, words, click, kernel);
    thisResume(ask, words);
    assert.deepEqual([ask.context.provider, ask.context.model], ['picked', 'picked-model'], 'the pick rides on that request');
    const before = calls.filter((call) => call.method === 'POST' && call.path === '/api/career-hunter/resume/save');
    assert.equal(before.length, 1, 'the edit not yet saved was saved once, before the turn');
    assert.deepEqual([before[0].body.postingId, before[0].body.resume.headline, before[0].body.cover.closing], [POSTING, HEADLINE, 'Olive Testperson'], 'this job\'s whole résumé and cover letter');
    await answer.getByText(/make the summary shorter/).waitFor();
    // The card: Approve runs career_resume_save once with this job's posting id; the page reads the saved résumé again.
    await click(chat.getByRole('button', { name: 'Approve', exact: true }));
    await page.locator('#sheet .summary', { hasText: TIGHTER }).waitFor({ timeout: 15000 });
    assert.deepEqual(executed.map((run) => [run.proposalId, run.toolName, run.input.postingId]), [['fixture-tailored-save', 'career_resume_save', String(POSTING)]]);
    assert.equal(await page.locator('#sheet .headline').textContent(), HEADLINE, 'the saved edit is kept');
    assert.equal(await page.locator('#save').isDisabled(), true, 'nothing is left unsaved');
    assert.match(await page.locator('#status').textContent(), /assistant/, 'the page says the change came from the assistant');
    await picture(page, '1440');
    const at = await places(page), composer = await chat.locator('.jc-composer').boundingBox();
    assert.equal(at.sideways, false, 'nothing runs sideways off the screen');
    assert.equal(at.scrolls, false, 'the page itself is no taller than the window: the résumé and the window each scroll inside it');
    assert.ok(at.pane.right <= at.width + 1 && at.pane.left >= at.width - 360 && at.pane.top >= 0 && at.pane.bottom <= at.height + 1, `the concierge is docked at the right: ${JSON.stringify(at)}`);
    assert.ok(at.sheet.left >= 0 && at.sheet.right <= at.pane.left + 1, `the résumé stays in sight beside it: ${JSON.stringify(at)}`);
    assert.ok(composer.x >= at.pane.left - 1 && composer.x + composer.width <= at.pane.right + 1 && composer.y + composer.height <= at.pane.bottom + 1, 'the window\'s message box sits inside the concierge');
    noGuide();
    assert.deepEqual(errors, []); assert.deepEqual(outside, []);
  } finally { await context.close(); }
});

test('phone 412: Edit with AI opens Career\'s concierge, the one chat window, between Career\'s bars, on this résumé', async () => {
  const { page, context, errors, outside } = await open(PHONE);
  try {
    await page.locator('.cf-topbar[data-cf-ready]').waitFor({ timeout: 15000 });
    const opener = page.getByRole('button', { name: 'Edit with AI' });
    assert.equal(await page.locator('.cf-topbar .cf-concierge-toggle').isVisible(), false, 'on a phone Edit with AI is this résumé\'s one way to the concierge');
    await tap(opener);
    const pane = page.locator('.cf-concierge');
    await pane.waitFor({ state: 'visible', timeout: 10000 });
    const chat = await chatWindow(pane);
    await windowControls(chat);
    await noChatOfItsOwn(page);
    assert.match(await pane.locator('iframe.jarvis-chat-frame').getAttribute('src'), /^\/api\/jarvis\/\?concierge=career-hunter&bot=career-concierge&/);
    assert.equal(await opener.isVisible(), false, 'the Edit with AI bar is away while the concierge is open');
    assert.equal(await pickModel(chat, tap), 'Picked model');
    const words = 'Which job is this résumé for?';
    const { ask } = await sendInWindow(chat, words, tap, kernel);
    thisResume(ask, words);
    assert.deepEqual([ask.context.provider, ask.context.model], ['picked', 'picked-model']);
    await picture(page, '412');
    const at = await places(page), composer = await chat.locator('.jc-composer').boundingBox(), convo = await chat.locator('#convo').boundingBox();
    assert.equal(at.sideways, false, 'nothing runs sideways off the screen');
    assert.ok(at.pane.top >= at.bars.bottom - 1 && at.pane.bottom <= at.nav.top + 1, `the concierge is between Career's bars: ${JSON.stringify(at)}`);
    assert.ok(at.pane.left >= 0 && at.pane.right <= at.width, `and inside the screen's width: ${JSON.stringify(at)}`);
    assert.ok(composer.y >= convo.y && composer.y + composer.height <= at.nav.top + 1, 'the window\'s message box is under its conversation and above Career\'s bottom bar');
    // The window's own Close (its one header) takes the person back to the résumé and to Edit with AI.
    await tap(chat.locator('.jc-header .jc-panel-close'));
    await pane.waitFor({ state: 'hidden', timeout: 5000 });
    assert.equal(await opener.isVisible(), true);
    assert.equal(await opener.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'aiOpen', 'the focus is back on Edit with AI');
    assert.equal(await page.locator('#sheet h1').isVisible(), true, 'the résumé is in sight again');
    noGuide();
    assert.deepEqual(errors, []); assert.deepEqual(outside, []);
  } finally { await context.close(); }
});

test('phone 412, Career\'s frame off: Edit with AI mounts Career\'s concierge and opens the one chat window on this résumé', async () => {
  const { page, context, errors, outside } = await open(PHONE, `?id=${POSTING}&frame=off`);
  try {
    assert.equal(await page.locator('.cf-topbar').count(), 0, 'no Career bar here');
    assert.equal(await page.locator('.cf-concierge').count(), 0, 'and no concierge until it is asked for');
    await tap(page.getByRole('button', { name: 'Edit with AI' }));
    const pane = page.locator('.cf-concierge');
    await pane.waitFor({ state: 'visible', timeout: 10000 });
    const chat = await chatWindow(pane);
    await windowControls(chat);
    await noChatOfItsOwn(page);
    assert.match(await pane.locator('iframe.jarvis-chat-frame').getAttribute('src'), /^\/api\/jarvis\/\?concierge=career-hunter&bot=career-concierge&/);
    const words = 'Which job is this résumé for?';
    const { ask } = await sendInWindow(chat, words, tap, kernel);
    thisResume(ask, words);
    const at = await places(page);
    assert.equal(at.sideways, false, 'nothing runs sideways off the screen');
    assert.ok(at.pane.top >= 0 && at.pane.bottom <= at.height + 1 && at.pane.left >= 0 && at.pane.right <= at.width, `the concierge fills the screen: ${JSON.stringify(at)}`);
    noGuide();
    assert.deepEqual(errors, []); assert.deepEqual(outside, []);
  } finally { await context.close(); }
});
