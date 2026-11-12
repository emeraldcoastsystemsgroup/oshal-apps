/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roles named for people and shown in the product (judge's report 2026-11-11, change 11), in Chromium over the shipped pages, frame and stylesheet. The profile each person gets is built from the shipped manifest's own tiles, with the Companies page left out for a person the server would not admit to it. A job seeker and a job source administrator, at 1440 by 900 and at 412 by 915: the bar says the role beside the name as one pill on a computer, and under the name in the top bar's menu on a phone; the bar still clips no label and nothing is wider than the screen; a profile that cannot be read shows a name and no role; the cockpit's framed page says the same; and the borrowed pages under Profile & contacts read Photo and Posts.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Review of 1.55.0, item 6: a tab that last drew an administrator's bar never says Job source administrator to the next person. The bar the tab remembers paints first while the fresh profile is on its way (held 1.5 s here); the role is said only from the fresh profile, and not at all when that cannot be read.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const tools = join(root, 'tools');
const deps = createRequire(resolve(process.env.STORE_CI_TOOLCHAIN || resolve(here, '../../../scripts/toolchain'), 'package.json'));
const { chromium } = deps('playwright');
const manifest = deps('js-yaml').load(readFileSync(join(root, 'oshal-app.yaml'), 'utf8'));
const ORIGIN = 'http://career.fixture.test';
const COMPUTER = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true };
const PAGES = { '/search-ui': 'career-search.html', '/profile-studio': 'career-profile-studio.html', '/settings': 'career-settings.html', '/home': 'career-home.html' };
const TYPES = { '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const ADMIN_PAGE = '/api/career-hunter/companies-admin';
const [SEEKER, ADMINISTRATOR] = manifest.authorization.roleTemplates.map((template) => template.label);

/**
 * A person's profile as the kernel answers it: the shipped manifest's tiles, member-prefixed for the front door, with the
 * front door's two borrowed Social pages, and without the Companies page unless the server would admit the person to it.
 */
function profileFor(name, administrator) {
  const group = name === 'intelligent-career';
  const items = manifest.ui.static.filter((tile) => administrator || tile.iframeUrl !== ADMIN_PAGE).map((tile) => {
    const foreign = !tile.iframeUrl.startsWith('/api/career-hunter/');
    const id = group ? (foreign ? 'tool-portrait-studio--portrait-studio' : `tool-career-hunter--${tile.toolName}`) : `tool-${tile.toolName}`;
    return { id, label: tile.label, group: tile.group || null, section: tile.section, toolUi: { iframeUrl: tile.iframeUrl, visibilityToolName: group && foreign ? 'portrait-studio' : tile.toolName } };
  });
  if (group) items.push({ id: 'tool-social--social-workspace', label: 'Workspace', group: 'Presence', section: 'top', toolUi: { iframeUrl: '/api/social/workspace', visibilityToolName: 'social-workspace' } });
  return { name, profile: { name, ribbon: { items } } };
}
const COCKPIT = `<!doctype html><html data-theme="midnight"><head><title>Cockpit</title><style>html,body{margin:0;height:100%}.header-bar{height:48px}.cockpit-body{height:calc(100vh - 48px)}.main-content{height:100%}</style></head>
<body><header class="header-bar">Cockpit header</header><main class="cockpit-body"><div class="main-content"><div class="tool-view-container" style="display:flex;flex-direction:column;height:100%;width:100%"><iframe src="/api/career-hunter/search-ui" style="flex:1;border:0;width:100%;height:100%"></iframe></div></div></main></body></html>`;

let browser;
const state = { administrator: false, profile: true, profileDelay: 0, before: null };

function answer(url) {
  const path = url.pathname;
  if (path === '/api/ui/profile') return state.profile ? { json: profileFor(url.searchParams.get('name'), state.administrator) } : { status: 403, json: { refused: 'deny' } };
  if (path === '/api/auth/user') return { json: { displayName: 'Ada Lovelace', user_sub: 'ada' } };
  if (path === '/api/career-hunter/jobs/stats') return { json: { saved: 7, interviewing: 0 } };
  if (path === ADMIN_PAGE) return state.administrator ? { json: {} } : { status: 403, json: { error: 'forbidden' } };
  return { json: {} };
}

async function open(path, size) {
  const context = await browser.newContext(size);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    const html = (body) => route.fulfill({ status: 200, contentType: 'text/html', body });
    if (url.pathname === '/cockpit/') return html(COCKPIT);
    const asset = url.pathname.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
    if (asset && existsSync(join(tools, asset[1]))) return route.fulfill({ status: 200, contentType: TYPES[asset[1].slice(asset[1].lastIndexOf('.'))] || 'text/plain', body: readFileSync(join(tools, asset[1])) });
    const page = PAGES[url.pathname.replace('/api/career-hunter', '')];
    if (url.pathname.startsWith('/api/career-hunter/') && page) return html(readFileSync(join(tools, page)));
    if (/^\/(shared|cockpit|ui)\//.test(url.pathname)) return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript', body: '' });
    const out = answer(url);
    if (url.pathname === '/api/ui/profile' && state.profileDelay) await new Promise((done) => setTimeout(done, state.profileDelay));
    return route.fulfill({ status: out.status || 200, contentType: 'application/json', body: JSON.stringify(out.json) });
  });
  if (state.before) await context.addInitScript(state.before.script, state.before.arg);
  const page = await context.newPage();
  await page.goto(ORIGIN + path, { waitUntil: 'load' });
  return { page, context };
}
const ready = (target) => target.waitForSelector('.cf-topbar[data-cf-ready]');
const texts = (target, selector) => target.locator(selector).evaluateAll((nodes) => nodes.map((node) => node.textContent.trim() + (node.getAttribute('aria-current') ? '*' : '')));
/** The pill as a person reads it: the name, the dot the stylesheet draws between, and the role. */
const pill = (target) => target.locator('.cf-who').evaluate((who) => [...who.children].map((part) => {
  const dot = getComputedStyle(part, '::before').content;
  return (dot && dot !== 'none' ? dot.replace(/"/g, '') + ' ' : '') + part.textContent;
}).join(' '));
/** Whether every label in the bar is whole: the sections fit their row and no part of the bar is past the window's edge. */
const whole = (target) => target.evaluate(() => {
  const nav = document.querySelector('.cf-topbar nav'), side = document.querySelector('.cf-side').getBoundingClientRect();
  const role = document.querySelector('.cf-who .cf-role');
  return nav.scrollWidth <= nav.clientWidth + 1 && side.right <= window.innerWidth + 1 && (!role || role.scrollWidth <= role.clientWidth + 1);
});

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

for (const [administrator, role] of [[false, SEEKER], [true, ADMINISTRATOR]]) {
  test(`on a computer the bar says ${role} beside the person's name`, async () => {
    state.administrator = administrator;
    const { page, context } = await open('/api/career-hunter/search-ui', COMPUTER);
    try {
      await ready(page);
      assert.equal(role, administrator ? 'Job source administrator' : 'Job seeker', 'the word is the role template\'s label');
      assert.equal(await page.locator('.cf-who').isVisible(), true);
      assert.equal((await page.textContent('.cf-pill')).trim(), 'Ada');
      assert.equal((await page.textContent('.cf-role')).trim(), role);
      assert.equal(await pill(page), `Ada · ${role}`);
      assert.equal(await page.locator('.cf-who .cf-role').isVisible(), true);
      const [who, name, word, bar] = await Promise.all(['.cf-who', '.cf-pill', '.cf-who .cf-role', '.cf-topbar'].map((selector) => page.locator(selector).boundingBox()));
      assert.ok(name.x >= who.x && word.x + word.width <= who.x + who.width + 1 && name.x + name.width <= word.x + 1, 'the name and the role are one pill, name first');
      assert.ok(who.y >= bar.y && who.y + who.height <= bar.y + bar.height && bar.height === 60, 'inside the 60px bar');
      assert.equal(await whole(page), true, 'no label in the bar is clipped');
      assert.deepEqual(await texts(page, '.cf-topbar nav a'), ['Home', 'Find jobs*', 'My jobs', 'Applications', 'Résumé', 'Profile & contacts']);
      await page.click('.cf-more-desk > summary');
      const more = await texts(page, '.cf-more-desk .cf-menu a');
      assert.equal(more.includes('Companies'), administrator, 'the Companies page is offered to the administrator only');
      for (const entry of ['Career Review', 'Job market', 'Download my data', 'Settings', 'My résumé', 'Other experience', 'Improve it', 'LinkedIn profile', 'Photo', 'Posts', 'Recruiters']) assert.ok(more.includes(entry), `${entry} is under More: ${more.join(' | ')}`);
      for (const retired of ['Portrait Studio', 'Workspace', 'Insights', 'Master record', 'Career Settings', 'Resume Studio', 'Strengthen', 'Profile Studio']) assert.equal(more.includes(retired), false, `${retired} is not a name in the bar`);
    } finally { await context.close(); }
  });

  test(`on a phone the top bar's menu says ${role} under the person's name`, async () => {
    state.administrator = administrator;
    const { page, context } = await open('/api/career-hunter/search-ui', PHONE);
    try {
      await ready(page);
      assert.equal(await page.locator('.cf-who').isVisible(), false, 'the pill gives its place to the menu on a phone');
      assert.equal((await page.locator('.cf-topbar').boundingBox()).height, 56);
      await page.tap('.cf-more-phone > summary');
      const menu = page.locator('.cf-more-phone .cf-menu');
      assert.equal(await menu.locator('.cf-menu-label').innerText(), 'ADA', 'the name, in the label\'s capitals');
      assert.equal((await menu.locator('.cf-menu-label').textContent()).trim(), 'Ada');
      assert.equal(await menu.locator('.cf-role').isVisible(), true);
      assert.equal(await menu.locator('.cf-role').innerText(), role);
      assert.deepEqual(await menu.evaluate((node) => [...node.children].map((child) => child.className)), ['cf-menu-label', 'cf-role', 'cf-all-applications'], 'name, role, then the way back');
      const box = await menu.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 412, 'the menu is inside the screen');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 412), 'no sideways scroll');
    } finally { await context.close(); }
  });
}

test('a narrower computer keeps the role and clips no label; the last sections move into More', async () => {
  state.administrator = true;
  const { page, context } = await open('/api/career-hunter/search-ui', { viewport: { width: 1024, height: 800 } });
  try {
    await ready(page);
    assert.equal((await page.textContent('.cf-role')).trim(), ADMINISTRATOR);
    assert.equal(await whole(page), true);
    const inBar = await texts(page, '.cf-topbar nav a'), spilled = await texts(page, '.cf-more-desk .cf-spill a');
    assert.equal(inBar.length + spilled.length, 6);
    assert.equal(inBar[0], 'Home');
  } finally { await context.close(); }
});

test('under Profile & contacts the borrowed pages read Photo and Posts beside Career\'s own', async () => {
  state.administrator = false;
  const { page, context } = await open('/api/career-hunter/profile-studio', COMPUTER);
  try {
    await ready(page);
    assert.deepEqual(await texts(page, '.cf-subnav a'), ['LinkedIn profile*', 'Photo', 'Posts', 'Recruiters']);
    assert.equal(await page.locator('.cf-subnav a', { hasText: 'Photo' }).getAttribute('href'), '/api/career-hunter/home?open=portrait-studio', 'the page it opens is unchanged');
  } finally { await context.close(); }
});

test('a profile that cannot be read shows the name and no role', async () => {
  state.administrator = false; state.profile = false;
  try {
    const { page, context } = await open('/api/career-hunter/search-ui', COMPUTER);
    try {
      await ready(page);
      assert.equal((await page.textContent('.cf-pill')).trim(), 'Ada');
      assert.equal(await page.locator('.cf-role').count(), 0, 'nothing is said about a role the server did not tell');
      assert.equal(await pill(page), 'Ada');
    } finally { await context.close(); }
  } finally { state.profile = true; }
});

test('inside the cockpit the framed page says the same role', async () => {
  state.administrator = false;
  const { page, context } = await open('/cockpit/?app=intelligent-career', COMPUTER);
  try {
    let frame = null;
    for (let attempt = 0; attempt < 200 && !frame; attempt++) { frame = page.frames().find((candidate) => candidate !== page.mainFrame() && candidate.url().includes('/api/career-hunter/')) || null; if (!frame) await page.waitForTimeout(50); }
    assert.ok(frame, 'the cockpit shows a Career page');
    await ready(frame);
    assert.equal(await pill(frame), `Ada · ${SEEKER}`);
  } finally { await context.close(); }
});

test('Settings and the bar tell the same person the same thing', async () => {
  for (const [administrator, role] of [[false, SEEKER], [true, ADMINISTRATOR]]) {
    state.administrator = administrator;
    const { page, context } = await open('/api/career-hunter/settings#refresh', COMPUTER);
    try {
      await ready(page);
      assert.equal((await page.textContent('.cf-role')).trim(), role);
      await page.waitForFunction((on) => document.documentElement.hasAttribute('data-career-administrator') === on, administrator);
      assert.equal(await page.locator('#sourceConfiguration').isVisible(), administrator, 'the job-source controls follow the same answer');
    } finally { await context.close(); }
  }
});

/** In the page, before it runs: this tab last drew an administrator's bar, and every role the page ever shows is recorded. */
function seedAdministratorBar({ key, cached }) {
  try { sessionStorage.setItem(key, JSON.stringify(cached)); } catch (_) { /* a blocked store has nothing to replay */ }
  window.__rolesSeen = [];
  new MutationObserver(() => {
    for (const node of document.querySelectorAll('.cf-role')) if (!window.__rolesSeen.includes(node.textContent.trim())) window.__rolesSeen.push(node.textContent.trim());
  }).observe(document, { subtree: true, childList: true, characterData: true });
}

for (const [label, fresh] of [['a job seeker\'s fresh profile', true], ['a fresh profile that cannot be read', false]]) {
  test(`a tab that last showed an administrator's bar never says ${ADMINISTRATOR} before ${label}`, async () => {
    const administratorProfile = profileFor('career-hunter', true).profile;
    const entries = createRequire(import.meta.url)('../../tools/career-frame.js').navEntries(administratorProfile);
    assert.ok(entries.some((entry) => entry.href === ADMIN_PAGE), 'the remembered bar is an administrator\'s');
    state.administrator = false; state.profile = fresh; state.profileDelay = 1500;
    state.before = { script: seedAdministratorBar, arg: { key: 'career-frame-v2', cached: { app: 'career-hunter', entries, name: 'Grace' } } };
    try {
      const { page, context } = await open('/api/career-hunter/search-ui', COMPUTER);
      try {
        await page.waitForSelector('.cf-topbar a');
        await page.waitForTimeout(600);
        assert.ok(!(await page.locator('.cf-topbar[data-cf-ready]').count()), 'the remembered bar is on screen while the fresh profile is on its way');
        await ready(page);
        const seen = await page.evaluate(() => window.__rolesSeen);
        assert.equal(seen.includes(ADMINISTRATOR), false, `seen: ${JSON.stringify(seen)}`);
        assert.deepEqual(seen, fresh ? [SEEKER] : [], 'the only role ever shown is the one the fresh profile gives');
      } finally { await context.close(); }
    } finally { state.profile = true; state.profileDelay = 0; state.before = null; }
  });
}
