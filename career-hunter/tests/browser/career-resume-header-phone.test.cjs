/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.67.2 (Roger, 2026-11-16, from his phone: "Half of this page on mobile is taken by the header"). My résumé in Chromium at 412x915, 390x844 and 360x780 (touch) and at 1440x900, 1024x768 and 768x1024: on a phone the résumé page starts in the top quarter of the screen, the section tabs are one row that scrolls sideways, the document has one bar of at most 56 px, and once the person scrolls into the résumé it has nearly the whole screen; every control of the two bars it replaces is still there, at most one tap deeper. A tablet and a computer keep both bars as before.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.68.14: More holds Career's six items on desktop/tablet and phone (adding Professional résumé (Word / PDF)… inside More without adding a separate main Download bar).
 *
 * Real: Career's page, frame, concierge entry and document host (tools/career-resume-studio.html, career-frame.js and .css,
 * career-resume-office.js), AI Office's editor page and its modules (presentations/tools/office), and the shared editor
 * foundation from a kernel platform folder. Doubled: the HTTP answers, read-only and made up (a sample résumé for a sample
 * person and its AI Office document); every write is refused and recorded, and nothing leaves the browser.
 *
 * Run (the store toolchain's Playwright and Chromium; refuses rather than skips without a kernel platform):
 *   OSHAL_KERNEL_PLATFORM=<kernel>/platform node --test career-hunter/tests/browser/career-resume-header-phone.test.cjs
 *   (CAREER_PROOF_SHOTS=<folder> also saves a screenshot of each size there.)
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STORE = path.resolve(__dirname, '../../..');
const CAREER = path.join(STORE, 'career-hunter/tools');
const OFFICE = path.join(STORE, 'presentations/tools/office');
const PLATFORM = process.env.OSHAL_KERNEL_PLATFORM || process.env.OSHAL_PLATFORM_ROOT || '';
const SHOTS = process.env.CAREER_PROOF_SHOTS || '';
const ORIGIN = 'http://localhost:47991'; // a secure context, as https is in production: AI Office's editor needs crypto.randomUUID
assert.ok(PLATFORM && fs.existsSync(path.join(PLATFORM, 'src/shared/ui/js/editor-foundation.js')),
  'OSHAL_KERNEL_PLATFORM must name a kernel platform folder with src/shared/ui (refusing rather than skipping)');

/** @description Load Playwright from the store toolchain. @returns {object} The playwright module. */
function playwright() {
  const roots = [process.env.STORE_CI_TOOLCHAIN && path.join(process.env.STORE_CI_TOOLCHAIN, 'node_modules'),
    path.join(STORE, 'scripts/toolchain/node_modules')].filter(Boolean);
  for (const root of roots) if (fs.existsSync(path.join(root, 'playwright'))) return require(path.join(root, 'playwright'));
  throw new Error(`BLOCKED: playwright not found (npm ci --prefix scripts/toolchain). Tried ${roots.join(', ')}`);
}

// A made-up person and résumé; nothing here is anyone's real data.
const REVISION = '5a3c1e9d7b2f4a6c8e0d1b3f5a7c9e1d3b5f7a9c1e3d5b7f9a1c3e5d7b9f1a3c';
const RESUME = {
  headline: 'Platform engineering lead',
  summary: 'Builds and runs cloud platforms that teams ship on every day.\n\nLeads small teams through migrations without downtime.',
  competencies: ['Cloud platforms', 'Delivery pipelines', 'Team leadership'],
  skills: ['AWS', 'Kubernetes', 'Terraform', 'Python'],
  // As long as a real two-page résumé, so the person has somewhere to scroll on the tallest phone.
  experience: [
    { title: 'Platform Lead', org: 'Sample Cloud Co', span: '2021-03–present', bullets: ['Led the team that moved 40 services onto one platform without a missed release', 'Cut deploy time from 50 to 9 minutes by rebuilding the delivery pipeline', 'Set up on-call, the incident review and a runbook for every service', 'Hired and coached six engineers, two of them now team leads'] },
    { title: 'Senior Engineer', org: 'Example Freight', span: '2017-06–2021-02', bullets: ['Built the shipment tracking pipeline that answers 2 million updates a day', 'Moved the tracking store to a managed database with no downtime', 'Mentored four engineers through their first on-call rotations', 'Wrote the team\'s guide to safe schema changes'] },
    { title: 'Engineer', org: 'Demo Retail', span: '2013-01–2017-05', bullets: ['Wrote the store inventory service used by 300 stores', 'Added the nightly stock reconciliation and its alerts', 'Ported the checkout service to the new payments provider'] },
    { title: 'Junior Developer', org: 'Placeholder Media', span: '2011-06–2012-12', bullets: ['Built internal tools for the newsroom', 'Kept the content site fast during election nights'] },
    { title: 'Intern', org: 'Made-up Labs', span: '2010-06–2010-09', bullets: ['Wrote tests for the billing service', 'Documented the release steps'] },
  ],
  education: ['B.S. Computer Science, Sample State University'],
  certifications: ['AWS Solutions Architect'],
  clearance: '',
};
const META = { name: 'Alex Sample' };
const { resumeToModel, TITLE } = require(path.join(CAREER, 'career-resume-office.js'));
const DOCUMENT_ID = '7d3f0c2a-5b8e-4f1a-9c6d-2e4b8a0f1c3d';
const MODEL = resumeToModel(RESUME, META, REVISION);
const OFFICE_DOC = { id: DOCUMENT_ID, title: TITLE, kind: 'docx', revision: 7, currentRevision: 7, updatedAt: '2026-11-16T12:00:00Z',
  sha256: 'f'.repeat(64), model: MODEL, original: null, accessRole: 'owner', ownerSub: 'sample-person', canEdit: true, canComment: true, canShare: true };
const RIBBON = [
  ['career-home', 'Home', 'home'], ['career-search', 'Find jobs', 'search-ui'], ['career-board', 'My jobs', 'board-native'],
  ['career-resume-studio', 'My résumé', 'resume-studio'], ['career-work-history', 'Work history', 'work-history'],
  ['career-experience-library', 'Other experience', 'experience-library'], ['career-strengthen', 'Improve my résumé', 'strengthen-ui'],
  ['career-profile-studio', 'Profile & contacts', 'profile-studio'],
].map(([tool, label, view]) => ({ id: 'tool-career-hunter--' + tool, label, section: 'top', toolUi: { iframeUrl: '/api/career-hunter/' + view, visibilityToolName: tool } }));
const READS = {
  '/api/career-hunter/resume/doc': { resume: RESUME, meta: META, cover: {}, revision: REVISION },
  '/api/career-hunter/resume/state': { hasResume: true, indexing: false },
  '/api/career-hunter/jobs': { jobs: [] },
  '/api/career-hunter/jobs/stats': { saved: 3, queued: 0, tracked: 2, applied: 2 },
  '/api/ui/profile': { profile: { ribbon: { items: RIBBON } } },
  '/api/auth/user': { displayName: 'Alex Sample' },
  '/api/presentations/editor/permissions': { permissions: { view: true, read: true, create: true, change: true, delete: true, export: true, legacyAccess: false }, actorSub: 'sample-person' },
  '/api/presentations/editor/documents': { documents: [{ id: DOCUMENT_ID, title: TITLE, kind: 'docx', revision: 7, updatedAt: '2026-11-16T12:00:00Z', shared: false, accessRole: 'owner', ownerSub: 'sample-person' }] },
  ['/api/presentations/editor/documents/' + DOCUMENT_ID]: { document: OFFICE_DOC, history: [{ revision: 7 }, { revision: 6 }] },
};

/** @description The file a path is served from: Career's and AI Office's own files, and the kernel's shared UI. */
function fileFor(pathname) {
  const inside = (root, rest) => { const full = path.resolve(root, rest); return full.startsWith(root + path.sep) && fs.existsSync(full) && fs.statSync(full).isFile() ? full : null; };
  if (pathname === '/api/career-hunter/resume-studio') return path.join(CAREER, 'career-resume-studio.html');
  if (pathname.startsWith('/api/career-hunter/static/')) return inside(CAREER, path.basename(pathname));
  if (pathname === '/api/presentations/editor/app') return path.join(OFFICE, 'editor.html');
  if (pathname.startsWith('/api/presentations/editor/assets/')) return inside(OFFICE, path.basename(pathname));
  if (pathname.startsWith('/shared/')) return inside(path.join(PLATFORM, 'src/shared'), pathname.slice('/shared/'.length));
  if (pathname.startsWith('/cockpit/')) return inside(path.join(PLATFORM, 'src/pages/cockpit'), pathname.slice('/cockpit/'.length));
  return null;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const typeOf = (file) => TYPES[path.extname(file)] || 'text/javascript; charset=utf-8';

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

/**
 * @description Open My résumé at one size with only the made-up answers above.
 * @param {{width:number,height:number,phone?:boolean}} size The window.
 * @returns {Promise<{page:object,context:object,writes:string[],errors:string[]}>} The page and what it tried to write.
 */
async function open(size) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: Boolean(size.phone), hasTouch: Boolean(size.phone), deviceScaleFactor: size.phone ? 2.625 : 1 });
  const writes = [], errors = [], missing = [];
  await context.route('**/*', (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== ORIGIN) return route.abort();
    if (!['GET', 'HEAD'].includes(request.method())) { writes.push(`${request.method()} ${url.pathname}`); return route.fulfill({ status: 405, json: { error: 'read-only fixture' } }); }
    const file = fileFor(url.pathname);
    if (file) return route.fulfill({ status: 200, path: file, contentType: typeOf(file) });
    if (Object.prototype.hasOwnProperty.call(READS, url.pathname)) return route.fulfill({ status: 200, json: READS[url.pathname] });
    missing.push(url.pathname);
    return route.fulfill({ status: 404, json: { error: 'not in this fixture' } });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.dismiss());
  await page.goto(ORIGIN + '/api/career-hunter/resume-studio', { waitUntil: 'load' });
  try {
    await page.locator('.cf-topbar[data-cf-ready]').waitFor({ timeout: 20000 });
    const office = page.frameLocator('#officeFrame');
    await office.locator('html[data-office-ready=true]').waitFor({ state: 'attached', timeout: 30000 });
    await office.locator('.office-word-page').first().waitFor({ timeout: 30000 });
    await page.waitForFunction(() => /Matches your main résumé/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
  } catch (error) {
    const said = await page.evaluate(() => ({ status: document.getElementById('status')?.textContent || '', view: document.body.dataset.view || '',
      frame: document.getElementById('officeFrame')?.getAttribute('src') || '', log: [...document.querySelectorAll('#log .msg')].map((n) => n.textContent) })).catch(() => ({}));
    throw new Error(`${error.message.split('\n')[0]}; page: ${JSON.stringify(said)}; errors: ${JSON.stringify(errors)}; not served: ${JSON.stringify([...new Set(missing)])}`);
  }
  await page.waitForTimeout(400);
  return { page, context, writes, errors, missing };
}

/** @description Where everything a person sees sits, in the window's own pixels. */
function measure(page) {
  return page.evaluate(() => {
    const visible = (el) => Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const box = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), height: Math.round(r.height), width: Math.round(r.width) }; };
    const frame = document.getElementById('officeFrame'), inner = frame.contentDocument, f = frame.getBoundingClientRect();
    const paper = inner.querySelector('.office-word-page').getBoundingClientRect();
    const sub = document.querySelector('.cf-subnav'), tabs = [...sub.querySelectorAll('a')];
    const officeRow = inner.querySelector('#office-header');
    const docbar = document.getElementById('docbar');
    const bottom = document.querySelector('.cf-bottombar');
    return {
      vw: innerWidth, vh: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      paperTop: Math.round(f.top + paper.top), frame: box(frame),
      bar: box(document.querySelector('.cf-topbar')),
      tabs: { box: box(sub), lines: new Set(tabs.map((a) => Math.round(a.getBoundingClientRect().top))).size, count: tabs.length,
        wrap: getComputedStyle(sub).flexWrap, overflowX: getComputedStyle(sub).overflowX, scrollWidth: sub.scrollWidth, clientWidth: sub.clientWidth,
        heights: tabs.map((a) => Math.round(a.getBoundingClientRect().height)), current: (sub.querySelector('a[aria-current="page"]') || {}).textContent || '' },
      docbar: visible(docbar) ? box(docbar) : null,
      officeRow: visible(officeRow) ? { top: Math.round(f.top + officeRow.getBoundingClientRect().top), height: Math.round(officeRow.getBoundingClientRect().height) } : null,
      identity: visible(document.getElementById('docIdentity')) ? box(document.getElementById('docIdentity')) : null,
      status: visible(document.getElementById('status')) ? box(document.getElementById('status')) : null,
      bottomTop: visible(bottom) ? Math.round(bottom.getBoundingClientRect().top) : innerHeight,
    };
  });
}

const PHONES = [{ width: 412, height: 915, phone: true }, { width: 390, height: 844, phone: true }, { width: 360, height: 780, phone: true }];

for (const size of PHONES) {
  test(`phone ${size.width}x${size.height}: the résumé starts in the top quarter, the tabs are one row, one document bar`, async (t) => {
    const { page, context, writes, errors } = await open(size);
    t.after(() => context.close());
    const m = await measure(page);
    t.diagnostic(`opened ${size.width}x${size.height}: ${JSON.stringify({ paperTop: m.paperTop, quarter: Math.round(size.height / 4), bar: m.bar.height, tabs: m.tabs.box.height, tabLines: m.tabs.lines, docbar: m.docbar && m.docbar.height, officeRow: m.officeRow && m.officeRow.height, identity: m.identity && m.identity.height, frameTop: m.frame.top })}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${size.width}x${size.height}-open.png`) });
    assert.ok(m.scrollWidth <= size.width, `no sideways page scroll (${m.scrollWidth})`);
    assert.ok(m.paperTop <= size.height * 0.25, `the résumé page starts in the top quarter: ${m.paperTop}px of ${size.height}px`);
    assert.equal(m.tabs.lines, 1, `the section tabs are one row (${m.tabs.lines} rows)`);
    assert.equal(m.tabs.wrap, 'nowrap', 'the tab row never wraps');
    assert.ok(['auto', 'scroll'].includes(m.tabs.overflowX), `the tab row scrolls sideways (${m.tabs.overflowX})`);
    assert.ok(m.tabs.heights.every((h) => h >= 44), `every tab is a 44 px target (${m.tabs.heights})`);
    assert.equal(m.officeRow, null, "AI Office's own app row is folded into the page's one document bar");
    assert.ok(m.docbar && m.docbar.height <= 56, `one document bar of at most 56 px (${m.docbar && m.docbar.height})`);
    assert.equal(m.identity, null, "the banner's words are in More, not a card over the page");
    const bar = await page.evaluate(() => {
      const shown = [...document.querySelectorAll('#docbar :is(button, select)')].filter((n) => n.offsetParent);
      const sub = document.querySelector('.cf-subnav'), last = sub.querySelector('a:last-of-type');
      sub.scrollLeft = sub.scrollWidth;
      return { controls: shown.map((n) => ({ id: n.id, h: Math.round(n.getBoundingClientRect().height), right: Math.round(n.getBoundingClientRect().right) })),
        primaries: [...document.querySelectorAll('.ck-primary')].filter((n) => n.offsetParent).map((n) => n.textContent),
        names: shown.map((n) => n.id === 'pick' ? n.selectedOptions[0].textContent : n.textContent.trim()),
        note: document.getElementById('status').textContent, lastTab: { text: last.textContent, right: Math.round(last.getBoundingClientRect().right) } };
    });
    t.diagnostic(`bar ${size.width}: ${JSON.stringify(bar.names)} / ${bar.note}`);
    assert.deepEqual(bar.names, ['⭐ Main résumé', 'Edit', 'Save', '⋯'], 'the bar: the résumé, Edit, Save and More');
    assert.deepEqual(bar.primaries, ['Save'], 'one main action');
    assert.ok(bar.controls.every((c) => c.h >= 44 && c.right <= size.width), `every control is a 44 px target inside the screen: ${JSON.stringify(bar.controls)}`);
    assert.equal(bar.note, 'Matches your main résumé', 'its save state under its name');
    assert.ok(bar.lastTab.right <= size.width, `the last tab (${bar.lastTab.text}) is one swipe away (${bar.lastTab.right})`);
    assert.deepEqual(writes, [], 'opening the page writes nothing');
    assert.deepEqual(errors, []);
  });
}

/** @description How much of the window the résumé has, and what is at the top of the window. */
function share(page) {
  return page.evaluate(() => {
    const f = document.getElementById('officeFrame').getBoundingClientRect(), bottom = document.querySelector('.cf-bottombar').getBoundingClientRect().top;
    const top = document.elementFromPoint(innerWidth / 2, 6);
    return { area: Math.round(Math.min(f.bottom, bottom) - Math.max(f.top, 0)), frameTop: Math.round(f.top), frameBottom: Math.round(f.bottom), bottom: Math.round(bottom),
      atTop: top && top.closest('#docbar') ? 'document bar' : top && top.closest('.cf-topbar') ? 'Career bar' : (top && top.tagName) || '',
      full: document.documentElement.hasAttribute('data-resume-full') };
  });
}

for (const size of PHONES) {
  test(`phone ${size.width}x${size.height}: once the person scrolls into the résumé it has nearly the whole screen, and scrolling up brings the bars back`, async (t) => {
    const { page, context, errors } = await open(size);
    t.after(() => context.close());
    const before = await share(page);
    // The person's finger moves the document a little at a time; each step is one scroll of AI Office's canvas.
    const canvas = page.frameLocator('#officeFrame').locator('#document-canvas');
    const scroll = async (dy, steps) => { for (let i = 0; i < steps; i++) { await canvas.evaluate((node, by) => node.scrollBy(0, by), dy); await page.waitForTimeout(80); } };
    await scroll(160, 4);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-resume-full'), null, { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(450);
    const into = await share(page);
    assert.ok(await canvas.evaluate((n) => n.scrollTop) > 200, 'the person scrolled into the résumé');
    t.diagnostic(`scrolled ${size.width}x${size.height}: ${JSON.stringify({ before: before.area, into: into.area, share: Math.round(100 * into.area / size.height) + '%', atTop: into.atTop })}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${size.width}x${size.height}-scrolled.png`) });
    assert.ok(into.area >= size.height * 0.85, `the résumé has nearly the whole screen: ${into.area}px of ${size.height}px`);
    assert.equal(into.atTop, 'document bar', 'its own bar stays at the top with Save and More');
    assert.ok(Math.abs(into.frameBottom - into.bottom) <= 2, `the document still reaches the bottom bar (${into.frameBottom} vs ${into.bottom})`);
    await scroll(-120, 2);
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-resume-full'), null, { timeout: 5000 });
    await page.waitForTimeout(450);
    const back = await share(page);
    assert.equal(back.atTop, 'Career bar', 'scrolling up brings Career\'s bar back');
    assert.ok(Math.abs(back.frameTop - before.frameTop) <= 1 && Math.abs(back.frameBottom - before.bottom) <= 2, `and the page is as it opened (${JSON.stringify(back)})`);
    assert.deepEqual(errors, []);
  });
}

test('phone 412x915: every control of the two bars it replaces is still there, at most one tap deeper', async (t) => {
  const { page, context, writes, errors } = await open(PHONES[0]);
  t.after(() => context.close());
  const office = page.frameLocator('#officeFrame');
  // More: what the banner said, then Career's own items and AI Office's Export, document menu and Your documents.
  await page.locator('#moreBtn').tap();
  const menu = page.locator('#moreMenu');
  await menu.waitFor();
  assert.equal(await page.locator('#docFacts:visible').count(), 1, 'More opens with what the banner said about this résumé');
  const facts = await page.locator('#docFacts').innerText();
  assert.match(facts, /Main résumé/); assert.match(facts, /Synced with Work history/); assert.match(facts, /revision 5a3c1e9d/);
  const items = await menu.locator('[role=menuitem]:visible').allInnerTexts();
  t.diagnostic(`More: ${JSON.stringify(items)}`);
  for (const name of ['Download my data (everything saved)', 'Other experience', 'Prepare & submit', 'Add career materials…', 'Replace with the saved main résumé',
    'Export this document…', 'Professional résumé (Word / PDF)…', 'Version history, rename, more…', 'Your AI Office documents']) assert.ok(items.includes(name), `More holds ${name}`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '412x915-more.png') });
  // AI Office's document menu (its name's menu in its own row), one tap further: Version history and the rest.
  await menu.getByRole('menuitem', { name: 'Version history, rename, more…' }).tap();
  const documentMenu = office.locator('dialog.ds-menu[open]');
  await documentMenu.waitFor({ timeout: 5000 });
  for (const name of ['New…', 'Open…', 'Rename…', 'Duplicate', 'Export…', 'Version history…', 'Delete']) await documentMenu.getByRole('menuitem', { name, exact: true }).waitFor();
  await documentMenu.getByRole('button', { name: 'Done' }).click();
  await documentMenu.waitFor({ state: 'detached' });
  // AI Office's Export, one tap further.
  await page.locator('#moreBtn').tap();
  await menu.getByRole('menuitem', { name: 'Export this document…' }).tap();
  const exportSheet = office.locator('dialog.ds-sheet[open]');
  await exportSheet.getByText('PDF (.pdf)').waitFor({ timeout: 5000 });
  await exportSheet.getByRole('button', { name: 'Done' }).click();
  await exportSheet.waitFor({ state: 'detached' });
  // Edit: the document opens for typing; Undo and Redo take its place in the bar, and what is typed shows as unsaved.
  await page.locator('#docEdit').tap();
  await office.locator('html:not([data-office-reading])').waitFor({ state: 'attached', timeout: 5000 });
  await page.locator('#docUndo').waitFor();
  assert.equal(await page.locator('#docEdit').isVisible(), false, 'Edit gives way to Undo and Redo');
  assert.equal(await page.locator('#docUndo').isDisabled(), true, 'nothing to undo yet');
  await office.locator('.office-word-page [contenteditable=true]', { hasText: 'Platform engineering lead' }).first().fill('Platform engineering lead and mentor');
  await office.locator('.office-word-page [contenteditable=true]', { hasText: 'Builds and runs' }).first().click();
  await page.locator('#docState').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('#docState').innerText(), 'Unsaved changes');
  await page.waitForFunction(() => !document.getElementById('docUndo').disabled, null, { timeout: 5000 });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '412x915-editing.png') });
  await page.locator('#docUndo').tap();
  await office.locator('.office-word-page [contenteditable=true]', { hasText: /^Platform engineering lead$/ }).first().waitFor({ timeout: 5000 });
  await page.locator('#docState').waitFor({ state: 'hidden', timeout: 5000 });
  assert.equal(await page.locator('#docRedo').isDisabled(), false, 'Redo is there for what Undo took back');
  // Your documents (AI Office's Back), one tap further.
  await page.locator('#moreBtn').tap();
  await menu.getByRole('menuitem', { name: 'Your AI Office documents' }).tap();
  await office.locator('#office-home:not([hidden])').waitFor({ timeout: 5000 });
  assert.deepEqual(writes, [], 'none of this wrote anything');
  assert.deepEqual(errors, []);
});

const WIDE = [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024, phone: true }];
for (const size of WIDE) {
  test(`${size.width}x${size.height}: a computer or tablet keeps the page as it was`, async (t) => {
    const { page, context, errors } = await open(size);
    t.after(() => context.close());
    const m = await measure(page);
    const row = await page.evaluate(() => ({ save: document.getElementById('save').textContent, more: [...document.querySelectorAll('#moreMenu [role=menuitem]')].filter((n) => !n.hidden).length,
      folded: ['docEdit', 'docUndo', 'docRedo', 'docState', 'docFacts', 'docExport', 'docMenu', 'docList'].filter((id) => document.getElementById(id) && !document.getElementById(id).hidden) }));
    t.diagnostic(`opened ${size.width}x${size.height}: ${JSON.stringify({ paperTop: m.paperTop, tabs: m.tabs.box.height, tabLines: m.tabs.lines, docbar: m.docbar && m.docbar.height, officeRow: m.officeRow && m.officeRow.height, identity: m.identity && m.identity.height })}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${size.width}x${size.height}-open.png`) });
    assert.ok(m.officeRow && m.officeRow.height >= 44, "AI Office's own app row is there");
    assert.ok(m.identity, 'the banner is there');
    assert.ok(m.status, 'the save state is there');
    assert.equal(row.save, 'Save to main résumé', 'Save keeps its whole name');
    assert.deepEqual(row.folded, [], 'nothing of the phone bar shows');
    assert.equal(row.more, 6, "More holds Career's six items");
    assert.equal(m.tabs.lines, 1);
    assert.ok(m.scrollWidth <= size.width);
    assert.deepEqual(errors, []);
  });
}
