/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | brand-graphics 1.4.0 live proof (open-work audit 2026-11-10, RP-BRG-01..07) on a loopback kernel (blue, :38798) as a throwaway test person holding Brand Graphics, Vids, Create, Video, AI Office, Switchboard and Jarvis, in a real Chromium at 412x915 (touch) and 1440x900. The kernel still serves 1.3.2, so this checkout's review.html and source-project-editor.mjs are served in the proof's own browser context only (nothing on the kernel changes). It records: no greyed control; Templates opens a brief; Brand kit reads the person's real Create kit (none at first: Make a brand kit; then a kit the person saves through Create's own PUT: Use my brand kit writes it into the brief); the Comments sheet opens (posting needs the 1.4.0 routes, proven by tests/source-projects-browser.test.mjs over real SQL); Download is not drawn with no finished file; Resize 9:16 and a scene's Edit on canvas hand off through the kernel's own shell to Video Studio and AI Office; Schedule or post is refused by the kernel until 1.4.0's prepare-post offer is loaded. The person's kit is deleted and their sessions and assignments removed at the end. Receipt and screenshots go to --out.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STORE = path.resolve(__dirname, '..', '..', '..');
const live = require(path.join(STORE, 'scripts', 'live-proof-person.cjs'));
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
const BASE = args.base || 'http://127.0.0.1:38798';
const PRODUCTION = args.production || '';
const OUT = args.out;
const PACKAGE = path.join(STORE, 'brand-graphics');
const KIT = { version: 1, name: 'Proof Brand', colors: { primary: '#1d4ed8', secondary: '#f59e0b', accent: '#ef4444', dark: '#111827', light: '#ffffff' },
  extras: [], fonts: { heading: 'Georgia', body: 'Calibri' }, voice: 'Warm and plain', logo: null };
const receipt = { base: BASE, startedAt: new Date().toISOString(), served: [], widths: {}, cleanup: [], problems: [] };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
if (!OUT || !args.env) throw new Error('usage: --env=<oshald.env> --out=<dir> [--base=] [--production=]');
fs.mkdirSync(OUT, { recursive: true });

/** @description The Brand Graphics frame inside the cockpit, once its editor has mounted. @param {object} page Page. @returns {Promise<object>} Frame. */
async function brandFrame(page) {
  for (let i = 0; i < 160; i += 1) {
    const frame = page.frames().find((f) => f.url().includes('/api/brand-graphics/review'));
    if (frame && await frame.locator('.source-project-actions').count().catch(() => 0)) { await sleep(1200); return frame; }
    await sleep(250);
  }
  throw new Error('the Brand Graphics editor never mounted');
}

/** @description Open Brand Graphics with this checkout's page files. @param {object} context Context. @returns {Promise<{page:object,frame:object,errors:string[]}>} The page. */
async function open(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error.message || error).slice(0, 200)));
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  await page.goto(`${BASE}/cockpit/?app=brand-graphics`, { waitUntil: 'domcontentloaded' });
  return { page, frame: await brandFrame(page), errors };
}

/** @description Wait for the cockpit to show another application's frame. @param {object} page Page. @param {RegExp} url Its address. @returns {Promise<object|null>} The frame. */
async function landed(page, url) {
  for (let i = 0; i < 80; i += 1) { const frame = page.frames().find((f) => url.test(f.url())); if (frame) return frame; await sleep(250); }
  return null;
}

/** @description One width's walk. @param {object} browser Chromium. @param {object} person Person. @param {'phone'|'desktop'} width Width. @param {boolean} withKit Whether the person has saved a kit. @returns {Promise<object>} Record. */
async function walk(browser, person, width, withKit) {
  const record = { width, steps: {} };
  const shot = async (page, name) => { const file = path.join(OUT, `${width}-${name}.png`); await page.screenshot({ path: file }); return file; };
  const context = await live.personContext(browser, BASE, person, width);
  receipt.served = await live.substitute(context, BASE, [
    { route: '/api/brand-graphics/review', file: path.join(PACKAGE, 'tools', 'review.html') },
    { route: '/api/brand-graphics/source-project-editor.mjs', file: path.join(PACKAGE, 'tools', 'source-project-editor.mjs') },
  ]);
  try {
    let { page, frame, errors } = await open(context);
    record.steps.greyed = await frame.locator('[data-ds-not-yet]').count();
    record.steps.notAvailableText = await frame.getByText('Not available yet').count();
    record.steps.opened = await shot(page, '1-opened');
    // Templates (RP-BRG-01).
    await frame.getByRole('button', { name: 'Templates', exact: true }).click();
    await frame.locator('dialog.brand-templates').waitFor();
    record.steps.templates = { count: await frame.locator('dialog.brand-templates .brand-template').count(), shot: await shot(page, '2-templates') };
    await frame.locator('dialog.brand-templates [data-template="launch"]').click();
    await frame.locator('#status').filter({ hasText: 'Product launch intro' }).waitFor({ timeout: 8000 });
    record.steps.templateOpened = { title: await frame.locator('#title').inputValue(), scenes: await frame.locator('.source-scene').count() };
    // Brand kit (RP-BRG-03), read from Create as this person.
    const kit = frame.locator('#brandKit');
    await kit.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    record.steps.brandKit = { visible: await kit.isVisible(), label: (await kit.textContent().catch(() => '')).trim() };
    if (withKit && record.steps.brandKit.label === 'Use my brand kit') {
      await kit.click();
      record.steps.brandKit.briefLine = (await frame.locator('#notes').inputValue()).split('\n').find((line) => line.startsWith('Brand kit:')) || null;
    }
    record.steps.brandKit.shot = await shot(page, '3-brand-kit');
    // Comments (RP-BRG-06): the sheet opens; posting is proven against the 1.4.0 routes in the SQL browser test.
    if (width === 'phone') { await frame.getByRole('button', { name: 'More', exact: true }).click(); await frame.getByRole('menuitem', { name: 'Comments', exact: true }).click(); }
    else await frame.locator('.source-project-actions').getByRole('button', { name: 'Comments', exact: true }).click();
    const sheet = frame.locator('dialog.source-comments');
    await sheet.waitFor();
    record.steps.comments = { scope: await sheet.locator('.source-comment-scope').innerText(), shot: await shot(page, '4-comments') };
    await sheet.getByRole('button', { name: 'Close', exact: true }).click();
    // Download (RP-BRG-04): this person has no finished build, so no Download is drawn.
    record.steps.download = { appRowVisible: await frame.locator('.source-project-actions a.source-download').isVisible(), rowLinks: await frame.locator('#records a.brand-download').count() };
    // Resize (RP-BRG-02): 9:16 goes to Video Studio through the kernel's own hand-off.
    await frame.getByRole('button', { name: 'More', exact: true }).click();
    await frame.getByRole('menuitem', { name: 'Resize for other formats', exact: true }).click();
    await frame.locator('dialog.brand-resize').waitFor();
    record.steps.resize = { choices: await frame.locator('dialog.brand-resize .brand-resize-list button').allInnerTexts(), shot: await shot(page, '5-resize') };
    await frame.locator('dialog.brand-resize button').filter({ hasText: '9:16 vertical' }).click();
    const video = await landed(page, /\/api\/video\//);
    record.steps.resize.landed = video ? new URL(video.url()).pathname : null;
    if (video) { await sleep(3000); record.steps.resize.idea = (await video.locator('#idea').inputValue().catch(() => '')).slice(0, 160); }
    record.steps.resize.after = await shot(page, '6-resize-video-studio');
    await page.close();
    // Edit on canvas (RP-BRG-07): a scene to AI Office's canvas.
    ({ page, frame } = await open(context));
    await frame.locator('#title').fill('Proof launch');
    await frame.locator('#notes').fill('An intro for the proof launch');
    await frame.getByRole('button', { name: 'Add scene', exact: true }).click();
    await frame.getByRole('button', { name: 'Scene 1 actions', exact: true }).click();
    await frame.getByRole('menuitem', { name: 'Edit on canvas', exact: true }).click();
    const office = await landed(page, /\/api\/presentations\//);
    record.steps.canvas = { landed: office ? new URL(office.url()).pathname : null };
    await sleep(3000);
    record.steps.canvas.shot = await shot(page, '7-canvas-ai-office');
    await page.close();
    // Schedule or post (RP-BRG-05): the kernel answers from the LOADED manifest, which gains prepare-post only with 1.4.0.
    ({ page, frame } = await open(context));
    await frame.locator('#title').fill('Proof launch');
    await frame.locator('#notes').fill('An intro for the proof launch');
    await frame.getByRole('button', { name: 'More', exact: true }).click();
    await frame.getByRole('menuitem', { name: 'Schedule or post', exact: true }).click();
    const compose = await landed(page, /\/api\/switchboard\//);
    record.steps.schedule = { landed: compose ? new URL(compose.url()).pathname : null, status: compose ? null : (await frame.locator('#status').innerText().catch(() => '')).slice(0, 200) };
    record.steps.schedule.shot = await shot(page, '8-schedule');
    record.pageErrors = errors;
  } finally { await context.close(); }
  return record;
}

/** @description Judge the walk. @param {object} record One width's record. @returns {string[]} Problems. */
function judge(record) {
  const s = record.steps, problems = [];
  if (s.greyed || s.notAvailableText) problems.push(`${s.greyed} greyed control(s) remain`);
  if (s.templates?.count !== 6 || s.templateOpened?.title !== 'Product launch intro' || s.templateOpened?.scenes !== 3) problems.push('Templates did not open the launch brief with 3 scenes');
  if (!s.brandKit?.visible) problems.push('Brand kit is not drawn although Create answers this person');
  if (s.resize?.landed === null) problems.push('Resize 9:16 did not open Video Studio');
  if (s.canvas?.landed === null) problems.push('Edit on canvas did not open AI Office');
  if (s.download?.appRowVisible || s.download?.rowLinks) problems.push('a Download was drawn with no finished file');
  return problems.map((line) => `${record.width}: ${line}`);
}

(async () => {
  let person, browser;
  try {
    person = await live.makePerson({ base: BASE, env: args.env, apps: ['brand-graphics', 'vids', 'create', 'video', 'presentations', 'switchboard', 'jarvis'], label: 'brand-controls-proof' });
    receipt.person = person.run;
    browser = await live.chromium.launch();
    receipt.kitBefore = (await live.call(BASE, person.session, 'GET', '/api/create/brand-kit')).json?.kit ?? null;
    receipt.widths.phone = await walk(browser, person, 'phone', false);
    const saved = await live.call(BASE, person.session, 'PUT', '/api/create/brand-kit', { baseRevision: 0, kit: KIT });
    receipt.kitSaved = saved.status;
    receipt.widths.desktop = await walk(browser, person, 'desktop', saved.status === 200);
    for (const record of Object.values(receipt.widths)) receipt.problems.push(...judge(record));
  } catch (error) {
    receipt.problems.push(`proof stopped: ${String(error.message || error).slice(0, 240)}`);
  } finally {
    if (browser) await browser.close();
    if (person) {
      const kit = await live.call(BASE, person.session, 'GET', '/api/create/brand-kit');
      if (kit.json?.kit) receipt.cleanup.push(`delete brand kit: ${(await live.call(BASE, person.session, 'DELETE', '/api/create/brand-kit', { baseRevision: kit.json.revision })).status}`);
      receipt.cleanup.push(...await live.cleanUp(BASE, person, PRODUCTION));
    }
    receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(OUT, 'receipt.json'), JSON.stringify(receipt, null, 2));
    process.stdout.write(`${JSON.stringify({ problems: receipt.problems, cleanup: receipt.cleanup, receipt: path.join(OUT, 'receipt.json') })}\n`);
    process.exitCode = receipt.problems.length ? 1 : 0;
  }
})();
