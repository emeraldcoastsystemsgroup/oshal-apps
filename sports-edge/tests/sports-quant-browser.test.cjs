/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Chromium acceptance suite for the Sports Edge collapsible Sports Quant Concierge rail (F22/F24) across 1440x900 and 412x915 in light-blue and midnight themes, verifying bottom-pinned composer geometry, independent message scrolling, real numeric quant replies, approval-card gating, >= 4.5:1 button contrast, and zero console/404 errors.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const STORE = path.resolve(PKG, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN
  ? path.resolve(process.env.STORE_CI_TOOLCHAIN)
  : path.join(STORE, 'scripts', 'toolchain');
const { chromium } = require(path.join(TOOLCHAIN, 'node_modules', 'playwright'));

function fakeRouter() {
  const routes = [];
  const add = (method) => (route, ...handlers) => {
    routes.push({ method, route, handler: handlers[handlers.length - 1] });
  };
  return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE'), use() {} };
}

const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const STUBS = {
  '@/shared/logger': { createChildLogger: () => quiet },
  '@/features/world-data': { createWorldIntelligenceService: () => null, ingestFeeds: async () => ({ newItems: 0 }) },
  '@/app/routes/trading-routes-helpers': {
    callerSub: () => 'browser-user-1',
    servePage: (dir, relPath) => (_req, res) => res.sendFile(path.join(dir, relPath)),
  },
  '@/shared/middleware/authz': { isOperator: () => false },
  express: { Router: fakeRouter },
};
const origLoad = Module._load;
Module._load = function stubbed(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return origLoad.call(this, request, ...rest);
};

const { createSportsEdgeRoutes } = require(path.join(PKG, 'routes', 'sports-routes.js'));

const THEME_CSS = `
:root, [data-surface-theme="light-blue"] {
  --bg-primary: #f8fafc; --bg-secondary: #ffffff; --bg-tertiary: #f1f5f9;
  --text-primary: #0f172a; --text-secondary: #475569; --text-muted: #64748b;
  --border-subtle: rgba(15, 23, 42, 0.12); --accent-primary: #1d4ed8;
}
[data-surface-theme="midnight"] {
  --bg-primary: #0b1120; --bg-secondary: #111827; --bg-tertiary: #1e293b;
  --text-primary: #f8fafc; --text-secondary: #cbd5e1; --text-muted: #94a3b8;
  --border-subtle: rgba(148, 163, 184, 0.22); --accent-primary: #60a5fa;
}
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg-primary); color: var(--text-primary); }
`;

const THEME_JS = `
(function(){
  var q = new URLSearchParams(location.search).get('theme') || 'light-blue';
  document.documentElement.setAttribute('data-surface-theme', q);
})();
`;

const BRIDGE_JS = `
window.__bridgeContexts = [];
export function createSurfaceBridgeClient() {
  return {
    attach() {},
    emitContext(ctx) { window.__bridgeContexts.push(ctx); }
  };
}
`;

function createFixturePool() {
  const kickIso = new Date(Date.now() + 4 * 3600000).toISOString();
  const genIso = new Date(Date.now() - 900000).toISOString();
  const preview = {
    eventId: '401888101', league: 'nfl', date: kickIso, homeTeam: 'KC', awayTeam: 'BUF', carriedOver: false,
    quote: { book: 'DraftKings', homeSpread: -3.5, homeSpreadOdds: -110, awaySpreadOdds: -110, homeMoneyline: -175, awayMoneyline: 148, total: 48.5 },
    line: { projectedMargin: 6.1, homeWinProbability: 0.675, signals: [{ name: 'elo', margin: 5.8 }], adjustments: [], availability: { homeMissingShare: 0, awayMissingShare: 0.04 } },
    ratings: { games: 140 }, context: { espnHomeWinPct: 64.2 },
    edges: [{ market: 'spread', side: 'home', selection: 'KC -3.5', price: -110, modelProbability: 0.585, marketProbability: 0.5238, edge: 0.0612, expectedValue: 0.1168, kelly: 0.032 }],
  };
  return {
    async query(sql) {
      const q = String(sql);
      if (/FROM sports_followed_teams/.test(q)) return { rows: [{ league: 'nfl', team: 'KC', team_id: '12', display_name: 'Kansas City Chiefs' }], rowCount: 1 };
      if (/FROM sports_settings/.test(q)) return { rows: [{ settings: { minEdgePoints: 2 } }], rowCount: 1 };
      if (/FROM sports_previews/.test(q)) return { rows: [{ payload: preview, generated_at: genIso }], rowCount: 1 };
      if (/FROM sports_line_history/.test(q)) {
        return { rows: [{ event_id: '401888101', league: 'nfl', book: 'DraftKings', home_spread: -3.5, home_spread_odds: -110, away_spread_odds: -110, home_moneyline: -175, away_moneyline: 148, total: 48.5, first_seen: genIso, last_seen: genIso, observations: 2 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

function matchRoute(routes, method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const names = [];
    const rx = new RegExp('^' + r.route.replace(/:([^/]+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
    const m = rx.exec(pathname);
    if (!m) continue;
    const params = {};
    names.forEach((n, idx) => { params[n] = decodeURIComponent(m[idx + 1]); });
    return { handler: r.handler, params };
  }
  return null;
}

async function invokeAppRoute(router, method, subPath, queryObj, bodyObj) {
  const hit = matchRoute(router.routes, method, subPath);
  if (!hit) return { status: 404, json: { error: 'not found' } };
  return new Promise((resolve) => {
    const out = { status: 200, json: null, file: null };
    const res = {
      status(c) { out.status = c; return res; },
      setHeader() { return res; },
      json(b) { out.json = b; resolve(out); return res; },
      sendFile(f) { out.file = f; resolve(out); return res; },
    };
    Promise.resolve(hit.handler({ params: hit.params, query: queryObj || {}, body: bodyObj || {}, oidc: { user: { sub: 'browser-user-1' } } }, res))
      .catch((err) => { out.status = 500; out.json = { error: err.message }; resolve(out); });
  });
}

function serveSharedOrStub(req, res, pathname) {
  if (pathname === '/shared/ui/css/surface-themes.css' || pathname === '/shared/ui/css/surface-glass.css') {
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
    res.end(THEME_CSS);
    return true;
  }
  if (pathname === '/shared/ui/js/surface-theme.js') {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
    res.end(THEME_JS);
    return true;
  }
  if (pathname === '/shared/ui/js/surface-bridge-client.js') {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
    res.end(BRIDGE_JS);
    return true;
  }
  if (pathname === '/api/jarvis/assets/jarvis-package-tools.js') {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
    res.end('/* standalone fallback approval card exercised */');
    return true;
  }
  if (pathname === '/api/v1/agent/schedules') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ schedules: [] }));
    return true;
  }
  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

let server;
let browser;
let baseUrl;
let executedProposals = [];

async function handleBotAsk(router, body, res) {
  if (/record/i.test(body.message || '')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      sessionId: body.sessionId || 's1',
      reply: 'Prepared forward-test pick registration for BUF @ KC (KC -3.5, +6.12% edge). Approve below to record.',
      packageToolProposals: [{ id: 'prop-se-1', tool: 'sports_edge_record_pick', description: 'Record forward-test pick KC -3.5 on event 401888101' }],
    }));
    return;
  }
  const quantAns = await invokeAppRoute(router, 'GET', '/quant/tonight', { storedOnly: '1' }, {});
  const g = quantAns.json.games[0];
  const reply = `${g.matchup}: ${g.topEdge.selection} (${g.topEdge.price}) — model ${g.topEdge.modelProbPct}% vs de-vig market ${g.topEdge.deVigMarketProbPct}% (+${g.topEdge.edgePct}% edge, ${g.topEdge.quarterKellyPct}% quarter-Kelly, ML vig ${g.bookQuote.moneylineVigPct}%).`;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ sessionId: body.sessionId || 's1', reply }));
}

async function dispatchServerRequest(router, req, res, u, body) {
  if (u.pathname === '/api/swarm/bots/sports-quant/ask' && req.method === 'POST') return handleBotAsk(router, body, res);
  if (u.pathname === '/api/jarvis/package-tools/execute' && req.method === 'POST') {
    executedProposals.push({ body, header: req.headers['x-oshal-package-tool'] });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (u.pathname.startsWith('/api/sports-edge')) {
    const subPath = u.pathname.slice('/api/sports-edge'.length) || '/';
    const ans = await invokeAppRoute(router, req.method, subPath, Object.fromEntries(u.searchParams), body);
    if (ans.file) {
      const ext = path.extname(ans.file);
      const mime = ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'text/html';
      res.writeHead(200, { 'content-type': `${mime}; charset=utf-8` });
      res.end(fs.readFileSync(ans.file));
      return;
    }
    res.writeHead(ans.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ans.json));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found', path: u.pathname }));
}

before(async () => {
  const router = createSportsEdgeRoutes({ pool: createFixturePool(), appPackageDir: PKG });
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ events: [] }) });
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (serveSharedOrStub(req, res, u.pathname)) return;
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => dispatchServerRequest(router, req, res, u, raw ? JSON.parse(raw) : {}));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

function contrastRatioCss() {
  return () => {
    function parseRgb(s) {
      const m = s.match(/[\d.]+/g).map(Number);
      return m.slice(0, 3);
    }
    function lum([r, g, b]) {
      const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }
    const btn = document.getElementById('conciergeSend');
    const cs = getComputedStyle(btn);
    const l1 = lum(parseRgb(cs.backgroundColor));
    const l2 = lum(parseRgb(cs.color));
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
}

async function verifyDesktopTheme(theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const status404 = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() === 404) status404.push(r.url()); });

  await page.goto(`${baseUrl}/api/sports-edge/ui?theme=${theme}`, { waitUntil: 'networkidle' });
  assert.equal(await page.getAttribute('body', 'data-concierge'), 'open');
  const geom = await page.evaluate(() => {
    const rail = document.getElementById('conciergeRail');
    const log = document.getElementById('conciergeLog');
    const form = document.getElementById('conciergeForm');
    return {
      railOverflow: getComputedStyle(rail).overflow,
      logOverflowY: getComputedStyle(log).overflowY,
      outerScroll: rail.scrollHeight - rail.clientHeight,
      bottomGap: rail.getBoundingClientRect().bottom - form.getBoundingClientRect().bottom,
    };
  });
  assert.equal(geom.railOverflow, 'hidden');
  assert.equal(geom.logOverflowY, 'auto');
  assert.ok(geom.outerScroll <= 1);
  assert.ok(geom.bottomGap >= 0 && geom.bottomGap <= 20);
  assert.ok((await page.evaluate(contrastRatioCss())) >= 4.5);

  await page.click('[data-concierge-prompt="Which games have edge tonight?"]');
  await page.waitForSelector('#conciergeLog .concierge-reply:nth-of-type(2)');
  assert.match(await page.textContent('#conciergeLog'), /\+6\.12% edge/);

  await page.click('#conciergeClose');
  assert.equal(await page.getAttribute('body', 'data-concierge'), 'closed');
  await page.click('#conciergeToggle');
  assert.equal(await page.getAttribute('body', 'data-concierge'), 'open');
  assert.deepEqual(errors, []);
  assert.deepEqual(status404, []);
  await context.close();
}

test('desktop 1440x900 light-blue & midnight: collapsible rail, bottom-pinned composer, and numeric reply', async () => {
  await verifyDesktopTheme('light-blue');
  await verifyDesktopTheme('midnight');
});

test('approval card gates forward-test pick recording until Approve is clicked', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  executedProposals = [];
  await page.goto(`${baseUrl}/api/sports-edge/ui?theme=light-blue`, { waitUntil: 'networkidle' });
  await page.fill('#conciergeInput', 'Record forward-test pick on 401888101');
  await page.click('#conciergeSend');
  await page.waitForSelector('.concierge-approval-card .concierge-approve-btn');
  assert.equal(executedProposals.length, 0);
  await page.click('.concierge-approve-btn');
  await page.waitForFunction(() => document.querySelector('.concierge-approval-card')?.textContent?.includes('Approved and recorded.'));
  assert.equal(executedProposals.length, 1);
  assert.equal(executedProposals[0].header, '1');
  await context.close();
});

test('mobile 412x915 starts closed with zero horizontal overflow and opens bottom-pinned Concierge sheet', async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${baseUrl}/api/sports-edge/ui?theme=midnight`, { waitUntil: 'networkidle' });
  assert.equal(await page.getAttribute('body', 'data-concierge'), 'closed');
  const overflowClosed = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(overflowClosed, false);

  await page.click('#conciergeToggle');
  assert.equal(await page.getAttribute('body', 'data-concierge'), 'open');
  const mobileGeom = await page.evaluate(() => {
    const rail = document.getElementById('conciergeRail');
    const form = document.getElementById('conciergeForm');
    return {
      bottomGap: rail.getBoundingClientRect().bottom - form.getBoundingClientRect().bottom,
      overflowOpen: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  assert.ok(mobileGeom.bottomGap >= 0 && mobileGeom.bottomGap <= 20);
  assert.equal(mobileGeom.overflowOpen, false);
  await page.click('#conciergeClose');
  assert.equal(await page.getAttribute('body', 'data-concierge'), 'closed');
  assert.deepEqual(errors, []);
  await context.close();
});
