/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: Kid Lens Review is merged into the Kid Lens brief. The manifest has one tab and no fixed theme; the old review address opens the brief; the brief's buttons wear the theme (no fixed pink) and Re-analyze leads only when a new export waits; Upload new export has a Cancel back to the brief; the upload view names watch-history.json while the Takeout archive service is absent (the .zip and Dropbox ways appear only when it answers) and asks once per page; brief headings meet 4.5:1 on a light theme; the three stat tiles share one row on a phone. Chromium over the shipped tools/ files with the package's JSON routes stubbed and the light-blue theme tokens as a fixture.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The Child ▾ planned control (DS-45, RP-KL-01) at the left of the header: aria-disabled, its backlog id, opacity 1, not the accent, and a press makes no request and changes nothing.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | UX audit P1 (the dead 'Your next brief' form): the review template behind the redirect, run with stub platform modules, keeps the brief hidden and draws no 'Use this evidence' when no connected action renders (or the module throws), and shows both when one does.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | RP-KL-01: replace the Child ▾ planned-control test with a live Playwright test proving the Child ▾ switcher opens, adds a child profile, switches briefs per child, and carries zero data-ds-backlog attributes.
 * -----------------------------------------------------------------------------
 *
 * Needs the store toolchain (express, js-yaml, playwright, chromium).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const yaml = require(path.join(TOOLCHAIN, 'js-yaml'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

const TOOLS = path.join(PKG, 'tools');
/** The light-blue theme's tokens (kernel platform/src/pages/cockpit/css/themes/light-blue.css), as a fixture. */
const LIGHT_BLUE = `[data-theme="light-blue"]{--text-on-accent:#111827;--bg-primary:#eaf4ff;--bg-tertiary:rgba(222,237,255,.74);
--bg-card:rgba(255,255,255,.62);--border-color:rgba(59,130,246,.1);--text-primary:#10233f;--text-secondary:#315b8a;--text-muted:#5f86b5;
--accent-primary:#3b82f6;--accent-primary-hover:#60a5fa;--status-error:#b91c1c}`;
const BRIEF = '## Top interests\n- Minecraft builds\n## Gift ideas\n- **LEGO** set\n## Talk to your kid\nAsk about the castle.';

/** @description Serve the shipped pages with stubbed reads; `opts` sets the export/brief times and the archive service. */
function serve(opts) {
  const calls = { takeout: 0 };
  const children = opts.children ? opts.children.map((c) => ({ ...c })) : [
    { childId: 'leo', name: 'Leo', hasData: true, totalWatched: 1204, hasBrief: true, brief: BRIEF, uploadedAt: opts.uploadedAt, briefAt: opts.briefAt, dateRange: { from: '2026-01-02T00:00:00Z', to: '2026-11-01T00:00:00Z' } },
  ];
  const app = express();
  app.use(express.json());
  app.get('/api/youtube-kids/', (_req, res) => res.sendFile(path.join(TOOLS, 'youtube-kids-dashboard.html')));
  app.get('/api/youtube-kids/review', (_req, res) => res.sendFile(path.join(TOOLS, 'review.html')));
  app.get('/api/youtube-kids/children', (_req, res) => res.json({ children, maxChildren: 8 }));
  app.post('/api/youtube-kids/children', (req, res) => {
    const name = String(req.body?.name || '').trim();
    const childId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const created = { childId, name, hasData: false, totalWatched: 0, hasBrief: false, brief: null, uploadedAt: null, briefAt: null, dateRange: null };
    children.push(created);
    res.status(201).json({ ok: true, child: created, children, maxChildren: 8 });
  });
  app.get('/api/youtube-kids/status', (req, res) => {
    const c = req.query.childId ? children.find((x) => x.childId === req.query.childId) : children[0];
    if (!c || !c.hasData) return res.json({ hasData: false, childId: c?.childId, childName: c?.name });
    return res.json({ hasData: true, childId: c.childId, childName: c.name, totalWatched: c.totalWatched, hasBrief: c.hasBrief, dateRange: c.dateRange, uploadedAt: c.uploadedAt, briefAt: c.briefAt });
  });
  app.get('/api/youtube-kids/brief', (req, res) => {
    const c = req.query.childId ? children.find((x) => x.childId === req.query.childId) : children[0];
    if (!c || !c.hasData) return res.json({ brief: null, hasData: false, analyzed: false });
    return res.json({ brief: c.brief, briefAt: c.briefAt, childId: c.childId, childName: c.name, hasData: true, analyzed: Boolean(c.brief), cached: true });
  });
  app.get('/api/takeout/dropbox/list', (_req, res) => { calls.takeout += 1; return opts.archive ? res.json({ candidates: [] }) : res.status(404).json({ refused: 'not_found' }); });
  app.get('/shared/ui/css/surface-themes.css', (_req, res) => res.type('css').send(LIGHT_BLUE));
  app.get('/shared/ui/js/surface-theme.js', (_req, res) => res.type('js').send("document.documentElement.dataset.theme='light-blue';"));
  app.use((req, res) => (req.method === 'GET' && /\.(css|js)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close() }));
  });
}

/** @description WCAG contrast ratio of two `rgb(r, g, b)` strings. */
function contrast(a, b) {
  const lum = (rgb) => rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => v / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/**
 * @description A planned control (DS-45) is greyed, opaque, not the accent, names its backlog id, and a press changes
 * nothing: no request, no navigation, the same DOM a second later.
 * @param {object} page A Playwright page that has finished loading.
 * @param {string} selector The planned control.
 * @param {string} backlog Its expected data-ds-backlog id.
 * @param {string} accentVar The page's accent custom property, to prove the control does not wear it.
 * @returns {Promise<void>}
 */
async function probePlanned(page, selector, backlog, accentVar) {
  const el = page.locator(selector);
  assert.equal(await el.getAttribute('aria-disabled'), 'true');
  assert.equal(await el.getAttribute('data-ds-backlog'), backlog);
  assert.equal(await el.evaluate((e) => e.hasAttribute('data-ds-not-yet')), true);
  assert.match(await el.getAttribute('aria-label'), /, not available yet$/);
  assert.equal(await el.getAttribute('title'), 'Not available yet');
  const look = await el.evaluate((e, v) => {
    const probe = document.createElement('span'); probe.style.color = `var(${v})`; document.body.append(probe);
    const accent = getComputedStyle(probe).color; probe.remove();
    const cs = getComputedStyle(e); return { opacity: cs.opacity, color: cs.color, background: cs.backgroundColor, accent };
  }, accentVar);
  assert.equal(look.opacity, '1', 'painted at full opacity');
  assert.notEqual(look.color, look.accent, 'the ink is not the accent');
  assert.notEqual(look.background, look.accent, 'the fill is not the accent');
  await page.waitForLoadState('networkidle');
  const snap = () => page.evaluate(() => ({ html: document.body.innerHTML, url: location.href }));
  const before = await snap();
  const requests = [];
  const onRequest = (r) => requests.push(r.url());
  page.on('request', onRequest);
  await el.click({ force: true }); // aria-disabled is not 'enabled' to Playwright; force still sends a real pointer press
  await page.waitForTimeout(1000);
  page.off('request', onRequest);
  const after = await snap();
  assert.deepEqual(requests, [], 'a press makes no request');
  assert.equal(after.url, before.url, 'a press does not navigate');
  assert.equal(after.html, before.html, 'a press changes nothing on the page');
}

/** @description Run `fn(page, server)` in one browser page at a phone width. */
async function withPage(opts, fn) {
  const server = await serve(opts);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
    await fn(page, server);
  } finally {
    await browser.close();
    server.close();
  }
}

test('the manifest has one Kid Lens tab, no fixed theme, and still mounts the review address', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
  assert.deepEqual(manifest.ui.static.map((tab) => [tab.toolName, tab.iframeUrl]), [['youtube-kids', '/api/youtube-kids/']]);
  assert.equal(manifest.theme, undefined, 'no sakura default');
  assert.ok(manifest.routes.some((r) => r.mountPath === '/api/youtube-kids/review'), 'the old address still answers');
});

test('the review address opens the brief; buttons wear the theme and Re-analyze is secondary with nothing new to analyze', async () => {
  await withPage({ uploadedAt: '2026-11-01T10:00:00Z', briefAt: '2026-11-01T10:01:00Z' }, async (page, server) => {
    await page.goto(server.base + '/api/youtube-kids/review');
    await page.waitForURL(/\/api\/youtube-kids\/$/);
    await page.locator('.brief h2').first().waitFor();
    const look = await page.evaluate(() => {
      const css = (el, k) => getComputedStyle(el)[k];
      const all = [...document.querySelectorAll('*')].flatMap((el) => [css(el, 'backgroundColor'), css(el, 'color')]);
      const tiles = [...document.querySelectorAll('.stat')].map((t) => Math.round(t.getBoundingClientRect().top));
      return { reanalyze: document.getElementById('reanalyze').className, pink: all.filter((c) => /255, 11[12], 16[56]/.test(c)),
        h2: [...document.querySelectorAll('.brief h2')].map((h) => css(h, 'color')), bg: css(document.body, 'backgroundColor'),
        tiles, wide: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(look.reanalyze, 'btn ghost');
    assert.deepEqual(look.pink, [], 'no hard-coded pink');
    for (const color of look.h2) assert.ok(contrast(color, look.bg) >= 4.5, `heading ${color} on ${look.bg}`);
    assert.equal(new Set(look.tiles).size, 1, 'three stat tiles in one row');
    assert.equal(look.wide, false);
  });
});

test('Re-analyze is the primary, in the theme accent, when a newer export waits', async () => {
  await withPage({ uploadedAt: '2026-11-02T10:00:00Z', briefAt: '2026-11-01T10:00:00Z' }, async (page, server) => {
    await page.goto(server.base + '/api/youtube-kids/');
    await page.locator('.brief h2').first().waitFor();
    const btn = await page.locator('#reanalyze').evaluate((b) => ({ cls: b.className, bg: getComputedStyle(b).backgroundColor }));
    assert.deepEqual(btn, { cls: 'btn primary', bg: 'rgb(59, 130, 246)' });
  });
});

test('Upload new export has a Cancel back to the brief and names watch-history.json without the archive service, asking once', async () => {
  await withPage({ uploadedAt: '2026-11-01T10:00:00Z', briefAt: '2026-11-01T10:01:00Z' }, async (page, server) => {
    await page.goto(server.base + '/api/youtube-kids/');
    await page.locator('.brief h2').first().waitFor();
    for (let i = 0; i < 2; i++) {
      await page.locator('#reupload').click();
      await page.locator('#dropHead').waitFor();
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('#dropHead').textContent(), '2 · Choose watch-history.json');
      assert.equal(await page.locator('#dbxBtn').count(), 0, 'no Dropbox button without the service');
      await page.locator('#cancelUpload').click();
      await page.locator('.brief h2').first().waitFor();
    }
    assert.equal(server.calls.takeout, 1, 'the readiness read runs once per page');
  });
});

test('with the Takeout archive service the upload view offers the .zip and the Dropbox pickup', async () => {
  await withPage({ archive: true, uploadedAt: '2026-11-01T10:00:00Z', briefAt: '2026-11-01T10:01:00Z' }, async (page, server) => {
    await page.goto(server.base + '/api/youtube-kids/');
    await page.locator('.brief h2').first().waitFor();
    await page.locator('#reupload').click();
    await page.locator('#dbxBtn').waitFor();
    assert.match(await page.locator('#dropHead').textContent(), /Takeout zip/u);
    assert.match(await page.locator('#dropLabel').textContent(), /Choose your Takeout \.zip/u);
  });
});

test('Child ▾ is a live household profile switcher at the left of the header with no backlog placeholder (RP-KL-01)', async () => {
  await withPage({
    uploadedAt: '2026-11-01T00:00:00Z',
    briefAt: '2026-11-02T00:00:00Z',
    children: [
      { childId: 'leo', name: 'Leo', hasData: true, totalWatched: 1204, hasBrief: true, brief: '## Top interests\n- Space rockets', uploadedAt: '2026-11-01T00:00:00Z', briefAt: '2026-11-02T00:00:00Z', dateRange: { from: '2026-01-02T00:00:00Z', to: '2026-11-01T00:00:00Z' } },
      { childId: 'maya', name: 'Maya', hasData: true, totalWatched: 840, hasBrief: true, brief: '## Top interests\n- Watercolor painting', uploadedAt: '2026-11-01T00:00:00Z', briefAt: '2026-11-02T00:00:00Z', dateRange: { from: '2026-02-01T00:00:00Z', to: '2026-11-01T00:00:00Z' } },
    ],
  }, async (page, server) => {
    await page.goto(server.base + '/api/youtube-kids/');
    await page.locator('.brief').waitFor();
    assert.equal(await page.locator('[data-ds-backlog], [data-ds-not-yet]').count(), 0, 'no planned placeholder remains');
    assert.equal(await page.$eval('.head', (h) => h.firstElementChild.id), 'childPicker', 'Child ▾ sits first in the header');
    assert.match(await page.textContent('#childPickerBtn'), /Leo ▾/);
    assert.match(await page.textContent('.brief'), /Space rockets/);

    await page.locator('#childPickerBtn').click();
    await page.locator('#childSel_1').click();
    await page.waitForFunction(() => document.querySelector('.brief')?.textContent?.includes('Watercolor painting'));
    assert.match(await page.textContent('#childPickerBtn'), /Maya ▾/);

    await page.locator('#childPickerBtn').click();
    await page.locator('#newChildName').fill('Sam');
    await page.locator('#addChildBtn').click();
    await page.locator('#dropHead').waitFor();
    assert.match(await page.textContent('#childPickerBtn'), /Sam ▾/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  });
});

/**
 * @description Run the review template's module script (the part below the redirect) against stub elements and stub platform
 * modules, the way sports-edge/tests/review-page.test.js does. @param {'none'|'one'|'throws'} actions What the workflow module renders.
 * @returns {Promise<{brief:object, records:object}>} The brief panel and the records host after the script ran.
 */
async function runReview(actions) {
  const html = fs.readFileSync(path.join(TOOLS, 'review.html'), 'utf8');
  const els = new Map();
  const el = (sel) => {
    if (!els.has(sel)) els.set(sel, { hidden: sel === '#briefPanel', value: '', textContent: '', children: [], listeners: {},
      append(...n) { this.children.push(...n); }, replaceChildren(...n) { this.children = n; }, addEventListener(t, f) { this.listeners[t] = f; },
      querySelector() { return actions === 'one' ? {} : null; }, setAttribute() {}, createTHead() { return { insertRow: () => ({ append() {} }) }; },
      createTBody() { return { insertRow: () => ({ insertCell: () => el(Symbol('cell')) }) }; }, classList: { toggle() {} } });
    return els.get(sel);
  };
  const module = html.slice(html.lastIndexOf('<script type="module">') + 22, html.lastIndexOf('</script>'));
  const fn = new (Object.getPrototypeOf(async function () {}).constructor)('document', 'fetch', 'receiveHandoff', 'mountConnectedActions', module.replace(/^import .*$/gm, ''));
  const document = { querySelector: el, createElement: () => el(Symbol('x')) };
  const fetch = async () => ({ ok: true, json: async () => ({ metrics: [], items: [{ text: 'Minecraft builds', detail: 'from the brief', actions: [{ context: { notes: 'x' } }] }] }) });
  const mount = actions === 'throws' ? async () => { throw new Error('no target'); } : async () => {};
  await fn(document, fetch, () => {}, mount);
  return { brief: el('#briefPanel'), buttons: [...els.values()].filter((e) => e.textContent === 'Use this evidence') };
}

test('the review template behind the redirect shows "Your next brief" only when a connected action renders', async () => {
  for (const [mode, shown] of [['none', false], ['throws', false], ['one', true]]) {
    const { brief, buttons } = await runReview(mode);
    assert.equal(brief.hidden, !shown, `${mode}: brief hidden`);
    assert.equal(buttons.length, shown ? 1 : 0, `${mode}: Use this evidence buttons`);
  }
});
