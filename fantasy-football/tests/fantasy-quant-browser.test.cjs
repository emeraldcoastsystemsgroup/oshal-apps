/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Chromium acceptance suite for the Fantasy Football collapsible Fantasy Quant Concierge rail (F22/F24) across 1440x900 and 412x915 in light-blue and midnight themes, verifying bottom-pinned composer geometry, real numeric FLEX start-sit reply, approval-card lineup mutation gating, >= 4.5:1 contrast, and zero console/404 errors.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { drive, loadRouter, memPool } = require('./fantasy-routes-harness.js');
const { SEASON, manualLeague, publicOnlyEspn } = require('./fantasy-manual-fixture.js');

const PKG = path.resolve(__dirname, '..');
const STORE = path.resolve(PKG, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN
  ? path.resolve(process.env.STORE_CI_TOOLCHAIN)
  : path.join(STORE, 'scripts', 'toolchain');
const { chromium } = require(path.join(TOOLCHAIN, 'node_modules', 'playwright'));

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

const APP_VIEW_JS = `window.AppView = { boot() {}, active() { return false; } };`;

const BRIDGE_JS = `
window.__bridgeContexts = [];
export function createSurfaceBridgeClient() {
  return {
    attach() {},
    emitContext(ctx) { window.__bridgeContexts.push(ctx); }
  };
}
`;

function serveSharedAsset(res, pathname) {
  if (pathname === '/shared/ui/css/surface-themes.css' || pathname === '/shared/ui/css/surface-glass.css' || pathname === '/shared/ui/css/app-view.css') {
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
    res.end(THEME_CSS);
    return true;
  }
  if (pathname === '/shared/ui/js/surface-theme.js') {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
    res.end(THEME_JS);
    return true;
  }
  if (pathname === '/shared/ui/js/app-view.js') {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
    res.end(APP_VIEW_JS);
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
  return false;
}

function matchRegistered(router, method, subPath) {
  for (const [key, handler] of router.routes.entries()) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const names = [];
    const rx = new RegExp('^' + pattern.replace(/:([^/]+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
    const hit = rx.exec(subPath);
    if (!hit) continue;
    const params = {};
    names.forEach((n, idx) => { params[n] = decodeURIComponent(hit[idx + 1]); });
    return { key, params };
  }
  return null;
}

let server;
let browser;
let baseUrl;
let executedProposals = [];
let manualId;

async function handleFantasyBotAsk(router, body, res) {
  if (/set lineup|apply|swap/i.test(body.message || '')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      sessionId: body.sessionId || 'ff-s1',
      reply: 'Prepared FLEX lineup update: start Mine Bench Back (11.0 pts) over Mine Back Two (4.0 pts). Approve below to apply.',
      packageToolProposals: [{ id: 'prop-ff-1', tool: 'fantasy_quant_set_lineup', description: 'Start Mine Bench Back (#13) over Mine Back Two (#12) in Browser Flex League' }],
    }));
    return;
  }
  const quantRes = await drive(
    router, 'GET /quant/start-sit',
    { query: { slot: 'FLEX', manualId: String(manualId), season: String(SEASON) } },
    publicOnlyEspn(4, []),
  );
  const pick = quantRes.body.recommendedPick;
  const reply = `Start ${pick.name} (${pick.position}, ${pick.proTeam}, ${pick.injuryStatus}) at ${pick.recommendedSlot}: ${pick.projectedPoints} proj pts (floor ${pick.floor10} – ceiling ${pick.ceiling90}), P(win) ${quantRes.body.matchup.winProbabilityPct}% (${quantRes.body.matchup.posture}).`;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ sessionId: body.sessionId || 'ff-s1', reply }));
}

async function dispatchFantasyRequest(router, req, res, u, body) {
  if (u.pathname === '/api/swarm/bots/fantasy-quant/ask' && req.method === 'POST') return handleFantasyBotAsk(router, body, res);
  if (u.pathname === '/api/jarvis/package-tools/execute' && req.method === 'POST') {
    executedProposals.push({ body, header: req.headers['x-oshal-package-tool'] });
    await drive(router, 'POST /quant/set-lineup', { body: { manualId, season: SEASON, startPlayerId: 13, sitPlayerId: 12 } }, publicOnlyEspn(4, []));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (u.pathname === '/api/fantasy-football/ui' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(PKG, 'tools', 'fantasy-football.html')));
    return;
  }
  if (u.pathname.startsWith('/api/fantasy-football/')) {
    const hit = matchRegistered(router, req.method, u.pathname.slice('/api/fantasy-football'.length));
    if (hit) {
      const ans = await drive(router, hit.key, { params: hit.params, query: Object.fromEntries(u.searchParams), body }, publicOnlyEspn(4, []));
      if (ans.body && ans.body.file) {
        res.writeHead(200, { 'content-type': `${ans.body.file.endsWith('.css') ? 'text/css' : 'application/javascript'}; charset=utf-8` });
        res.end(fs.readFileSync(ans.body.file));
        return;
      }
      res.writeHead(ans.code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(ans.body));
      return;
    }
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found', path: u.pathname }));
}

before(async () => {
  const { router } = loadRouter({ sub: 'browser-ff-1', secret: null }, memPool());
  const created = await drive(router, 'POST /manual-leagues', {
    body: manualLeague({ name: 'Browser Flex League', slots: [{ slotId: 2, count: 1 }, { slotId: 4, count: 1 }, { slotId: 23, count: 1 }] }),
  });
  manualId = created.body.id;
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (serveSharedAsset(res, u.pathname)) return;
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => dispatchFantasyRequest(router, req, res, u, raw ? JSON.parse(raw) : {}));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

function contrastRatioFn() {
  return () => {
    function parseRgb(s) { return s.match(/[\d.]+/g).map(Number).slice(0, 3); }
    function lum([r, g, b]) {
      const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }
    const cs = getComputedStyle(document.getElementById('conciergeSend'));
    const l1 = lum(parseRgb(cs.backgroundColor));
    const l2 = lum(parseRgb(cs.color));
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
}

async function verifyFantasyDesktopTheme(theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const status404 = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() === 404) status404.push(r.url()); });

  await page.goto(`${baseUrl}/api/fantasy-football/ui?theme=${theme}`, { waitUntil: 'networkidle' });
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
  assert.ok((await page.evaluate(contrastRatioFn())) >= 4.5);

  await page.click('[data-concierge-prompt="Who should I start at flex?"]');
  await page.waitForSelector('#conciergeLog .concierge-reply:nth-of-type(2)');
  assert.match(await page.textContent('#conciergeLog'), /Mine Bench Back/);
  assert.match(await page.textContent('#conciergeLog'), /11 proj pts/);

  await page.click('#conciergeClose');
  assert.equal(await page.getAttribute('body', 'data-concierge'), 'closed');
  await page.click('#conciergeToggle');
  assert.equal(await page.getAttribute('body', 'data-concierge'), 'open');
  assert.deepEqual(errors, []);
  assert.deepEqual(status404, []);
  await context.close();
}

test('desktop 1440x900 light-blue & midnight: collapsible rail, bottom-pinned composer, and numeric FLEX reply', async () => {
  await verifyFantasyDesktopTheme('light-blue');
  await verifyFantasyDesktopTheme('midnight');
});

test('approval card gates FLEX lineup mutation until Approve is clicked', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  executedProposals = [];
  await page.goto(`${baseUrl}/api/fantasy-football/ui?theme=light-blue`, { waitUntil: 'networkidle' });
  await page.fill('#conciergeInput', 'Set lineup swapping Mine Bench Back into FLEX');
  await page.click('#conciergeSend');
  await page.waitForSelector('.concierge-approval-card .concierge-approve-btn');
  assert.equal(executedProposals.length, 0);
  await page.click('.concierge-approve-btn');
  await page.waitForFunction(() => document.querySelector('.concierge-approval-card')?.textContent?.includes('Approved and applied.'));
  assert.equal(executedProposals.length, 1);
  assert.equal(executedProposals[0].header, '1');
  await context.close();
});

test('mobile 412x915 starts closed with zero horizontal overflow and opens bottom-pinned Fantasy Quant sheet', async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${baseUrl}/api/fantasy-football/ui?theme=light-blue`, { waitUntil: 'networkidle' });
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
