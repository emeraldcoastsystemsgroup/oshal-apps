/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Verify caller-authenticated /overview and /home-summary contracts (401 unauthenticated, 200 authenticated with bounded string tiles and Cache-Control: no-store) and render /api/futures-research/app in headless Chromium at 412x915 and 1440x900 verifying Light Blue theme, opaque cards, >=44px controls, zero horizontal scroll, and honest empty and populated states.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

delete process.env.DISPLAY;
delete process.env.WAYLAND_DISPLAY;

const PKG_ROOT = path.resolve(__dirname, '..');
const STORE_ROOT = path.resolve(PKG_ROOT, '..');
const CANDIDATES = [
  process.env.STORE_CI_TOOLCHAIN,
  process.env.OSHAL_FRAMEWORK,
  process.env.OSHAL_CORE_ROOT,
  path.join(STORE_ROOT, 'scripts/toolchain'),
  '/app',
].filter(Boolean);
const DEPS_ROOT = CANDIDATES.map(dir => path.resolve(dir)).find(dir => fs.existsSync(path.join(dir, 'node_modules/express')));
assert.ok(DEPS_ROOT, 'Missing express/playwright toolchain root');
const depsRequire = Module.createRequire(path.join(DEPS_ROOT, 'package.json'));
const express = depsRequire('express');
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'express') return express;
  return originalLoad.call(this, request, parent, isMain);
};
const { chromium } = depsRequire('playwright');

const THEME_CSS = `
html[data-theme="light-blue"] {
  --bg-primary: rgb(244, 248, 252);
  --bg-secondary: rgb(234, 241, 248);
  --bg-card: rgb(255, 255, 255);
  --border-color: rgb(214, 226, 240);
  --text-primary: rgb(15, 23, 42);
  --text-secondary: rgb(51, 65, 85);
  --text-muted: rgb(71, 85, 105);
  --accent-primary: rgb(37, 99, 235);
  --text-on-accent: rgb(255, 255, 255);
  --status-success: rgb(21, 128, 61);
  --status-warning: rgb(180, 83, 9);
  --status-error: rgb(185, 28, 28);
}
`;
const DESIGN_TOKENS_CSS = `
:where(:root, [data-theme]) {
  --ds-page: var(--bg-primary);
  --ds-surface: var(--bg-card);
  --ds-surface-2: var(--bg-secondary);
  --ds-edge: var(--border-color);
  --ds-ink: var(--text-primary);
  --ds-ink-2: var(--text-secondary);
  --ds-radius-s: 6px; --ds-radius-m: 10px; --ds-radius-l: 14px;
  --ds-target: 44px;
}
`;
const THEME_BOOTSTRAP_JS = `
(() => {
  try {
    const saved = localStorage.getItem('cockpit-theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  } catch (_) {}
})();
`;

function loadRoutes() {
  const routePath = path.join(PKG_ROOT, 'routes/futures-research-routes.js');
  assert.equal(fs.existsSync(routePath), true, 'routes/futures-research-routes.js must exist');
  delete require.cache[require.resolve(routePath)];
  return require(routePath);
}

function buildFixtureServer(state) {
  const { createFuturesResearchRoutes } = loadRoutes();
  const app = express();
  app.use((req, _res, next) => {
    const sub = req.headers['x-test-sub'];
    req.oidc = typeof sub === 'string' && sub.trim()
      ? { isAuthenticated: () => true, user: { sub: sub.trim() } }
      : { isAuthenticated: () => false };
    next();
  });
  app.get('/shared/ui/css/surface-themes.css', (_req, res) => res.type('text/css').send(THEME_CSS));
  app.get('/shared/ui/css/design-tokens.css', (_req, res) => res.type('text/css').send(DESIGN_TOKENS_CSS));
  app.get('/shared/ui/js/surface-theme.js', (_req, res) => res.type('text/javascript').send(THEME_BOOTSTRAP_JS));
  app.use('/api/futures-research', createFuturesResearchRoutes({
    appPackageDir: PKG_ROOT,
    ticketService: { listTickets: async () => state.tickets },
  }));
  app.get('/api/tickets', (req, res) => {
    if (!req.oidc.isAuthenticated()) return res.status(401).json({ error: 'not_authenticated' });
    return res.json({ tickets: state.tickets });
  });
  app.get('/api/trading/autopilot/futures', (req, res) => {
    if (!req.oidc.isAuthenticated()) return res.status(401).json({ error: 'not_authenticated' });
    if (!state.tradingAdmitted) return res.status(403).json({ error: 'application_not_admitted' });
    return res.json(state.futures);
  });
  app.get('/api/trading/autopilot/futures/predictions', (req, res) => {
    if (!req.oidc.isAuthenticated()) return res.status(401).json({ error: 'not_authenticated' });
    if (!state.tradingAdmitted) return res.status(403).json({ error: 'application_not_admitted' });
    return res.json({ predictions: state.predictions });
  });
  return app;
}

async function withServer(state, fn) {
  const app = buildFixtureServer(state);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
}

test('overview and home-summary enforce 401 when unauthenticated and return bounded no-store payloads when authenticated', async () => {
  const state = {
    tradingAdmitted: false,
    tickets: [
      { ticketId: 't-101', ticketType: 'futures-research', status: 'awaiting_approval', position: { name: 'work' }, createdAt: '2026-11-16T10:00:00Z' },
      { ticketId: 't-102', ticketType: 'futures-research', status: 'done', createdAt: '2026-11-15T10:00:00Z' },
      { ticketId: 't-other', ticketType: 'build', status: 'running', createdAt: '2026-11-16T11:00:00Z' },
    ],
    futures: { ok: true, schedule: null, runs: [] },
    predictions: [],
  };
  await withServer(state, async base => {
    for (const ep of ['/api/futures-research/overview', '/api/futures-research/home-summary', '/api/futures-research/app']) {
      const unauth = await fetch(base + ep);
      assert.equal(unauth.status, 401, `${ep} rejects unauthenticated request`);
      assert.equal(unauth.headers.get('cache-control'), 'no-store');
    }
    const ovRes = await fetch(base + '/api/futures-research/overview', { headers: { 'x-test-sub': 'alice' } });
    assert.equal(ovRes.status, 200);
    assert.equal(ovRes.headers.get('cache-control'), 'no-store');
    const ov = await ovRes.json();
    assert.equal(ov.executionAuthorized, false);
    assert.equal(ov.counts.total, 2, 'foreign ticketType is excluded');
    assert.equal(ov.counts.awaitingReview, 1);

    const sumRes = await fetch(base + '/api/futures-research/home-summary', { headers: { 'x-test-sub': 'alice' } });
    assert.equal(sumRes.status, 200);
    assert.equal(sumRes.headers.get('cache-control'), 'no-store');
    const sum = await sumRes.json();
    assert.equal(sum.partial, false);
    assert.ok(Array.isArray(sum.tiles) && sum.tiles.length > 0 && sum.tiles.length <= 4);
    assert.ok(sum.tiles.every(t => typeof t.value === 'string' && t.value.length <= 16));
    assert.ok(Array.isArray(sum.items) && sum.items.length <= 5);
  });
});

async function inspectSurfacePage(page, base) {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  const res = await page.goto(base + '/api/futures-research/app', { waitUntil: 'networkidle' });
  assert.equal(res.status(), 200);
  const metrics = await page.evaluate(() => {
    const css = el => getComputedStyle(el);
    const boxes = [...document.querySelectorAll('div,section,article,aside,li,form,fieldset,details,dialog,nav,header,footer,figure')]
      .filter(el => el.offsetParent !== null && el.offsetWidth >= 48 && el.offsetHeight >= 32)
      .map(el => ({ el, s: css(el) }))
      .filter(x => parseFloat(x.s.borderTopLeftRadius) >= 4 && x.s.backgroundColor !== 'rgba(0, 0, 0, 0)' && x.s.backgroundColor !== 'transparent');
    const glass = boxes.filter(x => x.el.hasAttribute('data-oshal-glass') || /blur\(/.test(x.s.backdropFilter || x.s.webkitBackdropFilter || '')).length;
    const seeThrough = boxes.filter(x => {
      const m = /rgba?\(([^)]+)\)/.exec(x.s.backgroundColor);
      const p = m ? m[1].split(/[\s,/]+/).filter(Boolean).map(Number) : [];
      return p.length > 3 && p[3] < 1;
    }).length;
    const glow = [css(document.documentElement).backgroundImage, css(document.body).backgroundImage, getComputedStyle(document.body, '::before').backgroundImage]
      .some(v => /radial-gradient/.test(v));
    const controls = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => b.getBoundingClientRect().height);
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      bootstrap: [...document.scripts].some(s => /surface-theme\.js/.test(s.src)),
      themeSheet: [...document.styleSheets].some(s => s.href && /surface-themes\.css/.test(s.href)),
      glass, seeThrough, glow, controls,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      text: document.body.innerText,
    };
  });
  assert.deepEqual(errors, []);
  return metrics;
}

test('surface renders honest empty states at 412x915 and 1440x900 with Light Blue theme, opaque cards, and zero horizontal scroll', async () => {
  const state = { tradingAdmitted: false, tickets: [], futures: { ok: true, schedule: null, runs: [] }, predictions: [] };
  await withServer(state, async base => {
    const browser = await chromium.launch({ headless: true });
    try {
      for (const [width, height] of [[412, 915], [1440, 900]]) {
        const context = await browser.newContext({
          viewport: { width, height },
          isMobile: width < 600,
          hasTouch: width < 600,
          extraHTTPHeaders: { 'x-test-sub': 'alice' },
        });
        const page = await context.newPage();
        const metrics = await inspectSurfacePage(page, base);
        assert.equal(metrics.theme, 'light-blue');
        assert.equal(metrics.bootstrap, true);
        assert.equal(metrics.themeSheet, true);
        assert.equal(metrics.glass, 0, 'zero glass cards');
        assert.equal(metrics.seeThrough, 0, 'all cards opaque');
        assert.equal(metrics.glow, false, 'zero radial glow');
        assert.ok(metrics.scrollWidth <= metrics.clientWidth, `no horizontal overflow at ${width}x${height}`);
        assert.ok(metrics.controls.every(h => h >= 44), `buttons >= 44px at ${width}x${height}`);
        assert.match(metrics.text, /zero live order placement/i);
        assert.match(metrics.text, /\/MES/);
        assert.match(metrics.text, /not connected in this session/i);
        assert.match(metrics.text, /No Futures Research review items/i);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
});

test('surface renders populated studies, review queue citations, and forward calls at 412x915 and 1440x900 without overflow', async () => {
  const state = {
    tradingAdmitted: true,
    tickets: [{ ticketId: 't-review-1', ticketType: 'futures-research', title: 'ES/CL Walk-Forward Cohort Check', status: 'done', createdAt: '2026-11-16T08:00:00Z' }],
    futures: {
      ok: true,
      schedule: { id: 'native', cron: '15 2 * * 2-6 (America/New_York)', status: 'saved', executionCount: 1 },
      runs: [{
        runId: 'run-es-01',
        status: 'completed',
        createdAt: '2026-11-16T07:30:00Z',
        markets: [{ root: 'ES', quality: { sampleStatus: 'sufficient', minOosTradesPerWindow: 12, chartLagDays: 0, ltfLagDays: 0, maxSourceLagDays: 2, referenceDate: '2026-11-16' } }],
        review: {
          status: 'completed',
          ticketId: 't-review-1',
          forwardContext: { fingerprint: 'fwd-ctx-99a1' },
          result: {
            summary: 'Opening range filter held positive expectancy only in regular-hours ES windows.',
            limitations: ['Overnight session had only 9 trades across two windows.', 'Overlapping 24h forward calls are non-independent.'],
            evidence: ['ES:sha256-88f012', 'fwd-ctx-99a1'],
            nextStudy: { rationale: 'Test regular-hours window boundary without expanding leverage.' },
          },
        },
      }],
    },
    predictions: [{
      predictionId: 'pred-01',
      contract: 'ESZ26',
      status: 'graded',
      issuedAt: '2026-11-15T14:00:00Z',
      snapshot: { horizonHours: 24, observation: { bias: 'long' } },
      outcome: { signedTicks: 6.5, correct: true },
    }],
  };
  await withServer(state, async base => {
    const browser = await chromium.launch({ headless: true });
    try {
      for (const [width, height] of [[412, 915], [1440, 900]]) {
        const context = await browser.newContext({
          viewport: { width, height },
          isMobile: width < 600,
          hasTouch: width < 600,
          extraHTTPHeaders: { 'x-test-sub': 'alice' },
        });
        const page = await context.newPage();
        const metrics = await inspectSurfacePage(page, base);
        assert.equal(metrics.glass, 0);
        assert.equal(metrics.seeThrough, 0);
        assert.ok(metrics.scrollWidth <= metrics.clientWidth, `populated view has zero horizontal scroll at ${width}x${height}`);
        assert.match(metrics.text, /Opening range filter held positive expectancy/);
        assert.match(metrics.text, /ES:sha256-88f012/);
        assert.match(metrics.text, /ESZ26/);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
});
