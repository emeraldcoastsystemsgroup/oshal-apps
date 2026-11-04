/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 2.14.0 resume: with nothing asked of the studio and nothing typed,
 *     |                                             | the shipped page lands on the newest saved file from My files (its
 *     |                                             | outline rides the list record) instead of an empty editor; ?kind=
 *     |                                             | narrows to that format and an empty list leaves the studio as it
 *     |                                             | was (Roger, 2026-11-02, on the demo: the first app he pressed
 *     |                                             | opened an empty editor beside three saved pieces).
 *     |                                             | Run: node --test tests/presentations-resume-latest.test.mjs
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | 2.15.0 landing shape (Roger, 2026-11-03, on the demo): the phantom
 *     |                                             | empty "making" bar must stay hidden (.making's display:flex had
 *     |                                             | defeated the hidden attribute, so every landing showed a bare box
 *     |                                             | with one Change button), the AI-partner message box takes the
 *     |                                             | rail's width with Dictate and Send under it, and the slide design
 *     |                                             | row is on the canvas.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | 2.16.0 document mode: a resumed .docx with an embedded image shows
 *     |                                             | its design row (Replace/Remove image — deliberately NO caption
 *     |                                             | knob, the .docx exporter does not render #caption:) and a preview
 *     |                                             | figure, the section textarea holds prose only (never the data
 *     |                                             | URI), and editing the prose keeps the design directives in the
 *     |                                             | outline model.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | 2.17.0 phone + paper (Roger, 2026-11-03, phone screenshot: "its
 *     |                                             | impossible to see or read or use... look at mobile word... update
 *     |                                             | the default background color"): at 412x915 the header is static
 *     |                                             | (the sticky translucent block covered the content as doubled
 *     |                                             | text), the blurb hides, nothing scrolls sideways, file commands
 *     |                                             | are a one-line ribbon, and a standalone open with nothing saved
 *     |                                             | wears the declared light-blue (light body, not a dark canvas).
 * -----------------------------------------------------------------------------
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameworkFixture } from './framework-fixture.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const frameworkRoot = frameworkFixture();
const { chromium } = require(path.join(frameworkRoot, 'node_modules', 'playwright'));

const THEME = {
  id: 'executive', name: 'Executive', blurb: 'Clear and focused', mood: 'clear', cover: 'wash', decor: 'bar', darkCanvas: true,
  fonts: { heading: 'Aptos Display', body: 'Aptos' },
  colors: { deep: '17202b', deepInk: 'ffffff', deepInkSoft: 'c7d2df', accent: '4cc9f0', accent2: 'f72585', canvas: 'ffffff', canvasAlt: 'eef4f8', ink: '17202b', inkSoft: '52606d', line: 'cbd5e1' },
};
// Alphabetically first and older than SAVED: the resume must pick the NEWEST, not the list's first row
// (the server's list is name-ordered, not recency-ordered).
const OLDER = {
  fileName: 'Autumn notes.pptx', title: 'Autumn notes', format: 'pptx', theme: 'executive', provider: 'oshal-local',
  createdAt: new Date(Date.now() - 86400000).toISOString(), slides: 1, outlineComplete: true,
  outline: [{ title: 'Old page', bullets: ['Stale'] }],
};
const SAVED = {
  fileName: 'Q4 plan.pptx', title: 'Q4 plan', format: 'pptx', theme: 'executive', provider: 'oshal-local',
  createdAt: new Date().toISOString(), slides: 2, outlineComplete: true,
  outline: [
    { title: 'Where we are', bullets: ['Revenue is on plan', 'Hiring is one role behind'] },
    { title: 'What we will do', bullets: ['Ship the bracket redesign', 'Close the audit items'] },
  ],
};

const DOC = {
  fileName: 'Field report.docx', title: 'Field report', format: 'docx', theme: 'executive', provider: 'oshal-local',
  createdAt: new Date().toISOString(), slides: 1, outlineComplete: true,
  outline: [{ title: 'Findings', bullets: ['#image: data:image/png;base64,' + 'A'.repeat(120), '#caption: The site', 'The pump is worn'] }],
};

function json(res, status, body) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }
async function serveStatic(res, file, contentType) {
  try { const body = await fs.readFile(file); res.writeHead(200, { 'content-type': contentType }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}

async function fixture(decks) {
  const html = path.join(packageRoot, 'tools', 'presentations.html');
  const core = path.join(frameworkRoot, 'src', 'shared', 'ui');
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && /^\/api\/presentations\/sections\/assets\/(office-workspace\.css|office-assistant\.mjs|slide-workspace\.(mjs|css)|sheet-workspace\.(mjs|css))$/.test(url.pathname)) return serveStatic(res, path.join(packageRoot, 'tools', path.basename(url.pathname)), url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
    if (req.method === 'GET' && url.pathname === '/api/presentations/sections/ui') return serveStatic(res, html, 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/presentations/sections/themes') return json(res, 200, { themes: [THEME], layouts: [], defaultTheme: THEME.id });
    if (req.method === 'GET' && url.pathname === '/api/presentations/sections/starters') return json(res, 200, { kinds: [{ id: 'pptx', groups: [] }], starters: [] });
    if (req.method === 'GET' && url.pathname === '/api/presentations/sections/destination') return json(res, 200, { provider: 'oshal-local', folder: 'files', subfolder: 'oshal', isDefault: true });
    if (req.method === 'GET' && url.pathname === '/api/presentations/sections/list') return json(res, 200, { decks });
    if (req.method === 'GET' && url.pathname === '/api/create/brand-kit') return json(res, 404, { error: 'not_available' });
    if (url.pathname === '/shared/ui/css/surface-themes.css') return serveStatic(res, path.join(core, 'css', 'surface-themes.css'), 'text/css');
    if (/^\/cockpit\/css\/themes\/[a-z-]+\.css$/.test(url.pathname)) return serveStatic(res, path.join(frameworkRoot, 'src', 'api', 'cockpit', 'css', 'themes', path.basename(url.pathname)), 'text/css');
    if (url.pathname === '/shared/ui/css/surface-glass.css') return serveStatic(res, path.join(core, 'css', 'surface-glass.css'), 'text/css');
    if (url.pathname === '/shared/ui/js/surface-theme.js') return serveStatic(res, path.join(core, 'js', 'surface-theme.js'), 'text/javascript');
    if (url.pathname === '/shared/ui/js/surface-bridge-client.js') return serveStatic(res, path.join(core, 'js', 'surface-bridge-client.js'), 'text/javascript');
    if (url.pathname.endsWith('.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(''); return; }
    if (url.pathname.endsWith('.css')) { res.writeHead(200, { 'content-type': 'text/css' }); res.end(''); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function open(app, context, query) {
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto(`${app.origin}/api/presentations/sections/ui${query}`, { waitUntil: 'domcontentloaded' });
  return page;
}

test('the studio resumes the newest saved file, narrows by ?kind=, and leaves an empty list alone', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => (new URL(route.request().url()).port ? route.continue() : route.abort('blockedbyclient')));
  const app = await fixture([OLDER, SAVED]);
  const empty = await fixture([]);
  try {
    const resumed = await open(app, context, '');
    await resumed.waitForFunction(() => document.querySelector('#title')?.value === 'Q4 plan');
    assert.match(await resumed.locator('#outline').inputValue(), /Revenue is on plan/);

    const otherKind = await open(app, context, '?kind=xlsx&workspace=1');
    await otherKind.waitForTimeout(1200); // give a wrong resume time to happen
    assert.equal(await otherKind.locator('#title').inputValue(), '', 'an xlsx studio never resumes a pptx');

    const nothing = await open(empty, context, '');
    await nothing.waitForTimeout(1200);
    assert.equal(await nothing.locator('#title').inputValue(), '', 'an empty list leaves the studio as it was');
  } finally {
    await browser.close();
    app.server.close(); empty.server.close();
  }
});

test('the landing shows no phantom making bar, a full-width AI-partner box with its buttons under it, and the slide design row', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => (new URL(route.request().url()).port ? route.continue() : route.abort('blockedbyclient')));
  const app = await fixture([SAVED]);
  try {
    const page = await open(app, context, '');
    await page.waitForFunction(() => document.querySelector('#title')?.value === 'Q4 plan');
    // The bar is for focus mode only; hidden means hidden (it rendered empty on every demo landing).
    assert.equal(await page.locator('#makingBar').evaluate((node) => node.hidden && getComputedStyle(node).display === 'none'), true,
      'the hidden making bar must not paint (display:flex defeated the hidden attribute)');
    // The message box owns the rail's width; Dictate and Send sit on their own row beneath it.
    const shape = await page.evaluate(() => {
      const bar = document.querySelector('.chatbar').getBoundingClientRect();
      const box = document.getElementById('chatIn').getBoundingClientRect();
      const mic = document.getElementById('micChat').getBoundingClientRect();
      const send = document.getElementById('chatSend').getBoundingClientRect();
      return { barW: bar.width, boxW: box.width, boxBottom: box.bottom, micTop: mic.top, sendTop: send.top };
    });
    assert.ok(shape.boxW >= shape.barW * 0.95, `the box takes the rail (${shape.boxW} of ${shape.barW})`);
    assert.ok(shape.micTop >= shape.boxBottom && shape.sendTop >= shape.boxBottom, 'Dictate and Send sit under the box, not beside it');
    // The design row rides the slide canvas with the renderer-honoured controls.
    assert.equal(await page.locator('.office-slide-design .office-slide-layout-select').count(), 1);
    assert.equal(await page.locator('.office-slide-design button', { hasText: 'Add image' }).count(), 1);
  } finally {
    await browser.close();
    app.server.close();
  }
});

test('a phone shows a readable, Office-light studio: no sticky wall, no sideways scroll, paper by default', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  await context.route('**/*', (route) => (new URL(route.request().url()).port ? route.continue() : route.abort('blockedbyclient')));
  const app = await fixture([SAVED]);
  try {
    const page = await open(app, context, '');
    await page.waitForFunction(() => document.querySelector('#title')?.value === 'Q4 plan');
    const shape = await page.evaluate(() => {
      const bg = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g).map(Number);
      const top = document.querySelector('.top');
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        luminance: (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255,
        topPosition: getComputedStyle(top).position,
        subShown: getComputedStyle(document.querySelector('.top .sub')).display !== 'none',
        pageScrollsSideways: document.scrollingElement.scrollWidth > innerWidth + 1,
        actionsWrap: getComputedStyle(document.querySelector('.office-file-actions')).flexWrap,
      };
    });
    assert.equal(shape.theme, 'light-blue', 'standalone with nothing saved, Office wears its declared light look');
    assert.ok(shape.luminance > 0.6, `paper, not a dark canvas (luminance ${shape.luminance})`);
    assert.equal(shape.topPosition, 'static', 'the phone header scrolls away — a sticky translucent wall covered the content (Roger, 2026-11-03)');
    assert.equal(shape.subShown, false, 'the blurb yields the phone to the document');
    assert.equal(shape.pageScrollsSideways, false, 'no sideways page scroll');
    assert.equal(shape.actionsWrap, 'nowrap', 'file commands are a one-line ribbon that scrolls, not a tall block');
  } finally {
    await browser.close();
    app.server.close();
  }
});

test('document mode hides the image bytes behind its design row and previews the embedded image', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => (new URL(route.request().url()).port ? route.continue() : route.abort('blockedbyclient')));
  const app = await fixture([DOC]);
  try {
    const page = await open(app, context, '?kind=docx&workspace=1');
    await page.waitForFunction(() => document.querySelector('#title')?.value === 'Field report');
    await page.waitForSelector('#documentWorkspace .office-page');
    const body = await page.locator('#documentWorkspace textarea[aria-label="Section content"]').inputValue();
    assert.ok(!body.includes('data:image'), 'the section textarea shows prose, never image bytes');
    assert.match(body, /The pump is worn/);
    assert.equal(await page.locator('#documentWorkspace .office-slide-design button', { hasText: 'Replace image' }).count(), 1);
    assert.equal(await page.locator('#documentWorkspace .office-slide-design button', { hasText: 'Remove image' }).count(), 1);
    assert.equal(await page.locator('#documentWorkspace .office-slide-caption-input').count(), 0,
      'no caption control in document mode — the .docx exporter does not render #caption:, and a knob the file ignores is a fake control');
    assert.equal(await page.locator('#documentWorkspace figure.pvImg img').count(), 1, 'the embedded image previews on the page');
    // Editing the prose keeps the person's design in the one outline model.
    await page.locator('#documentWorkspace textarea[aria-label="Section content"]').fill('The pump is worn out');
    await page.waitForFunction(() => document.getElementById('outline')?.value.includes('worn out'));
    const outline = await page.locator('#outline').inputValue();
    assert.ok(outline.includes('#image: data:image/png;base64,'), 'editing prose keeps the image directive');
    assert.ok(outline.includes('#caption: The site'), 'editing prose keeps the caption');
  } finally {
    await browser.close();
    app.server.close();
  }
});
