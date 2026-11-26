/**
 * Venture Plan — real Chromium browser contract for the Compare tab.
 *
 * Serves the real `tools/venture.html` surface and delegates `/api/venture/*`
 * requests to the real compiled `routes/venture-routes.js` over a local Node
 * loopback server (zero external network, zero model calls). Proves at both
 * `1440x900` (desktop) and `412x915` (mobile):
 * - Empty state when fewer than 2 scenarios exist.
 * - Multi-scenario selection (3 scenarios, uncheck/re-check), baseline toggle,
 *   delta sign flip, provenance badges, and differing-assumptions table.
 * - XSS-safe rendering via textContent (hostile `<img onerror=...>` in scenario
 *   name never executes or injects elements).
 * - Zero horizontal overflow (`scrollWidth <= clientWidth`) and zero pageErrors.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial Chromium browser contract for 1.5.5 side-by-side scenario compare at 1440x900 and 412x915.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(__dirname, '..');
const REPO = path.resolve(PKG, '..');
const require = createRequire(import.meta.url);

function loadPlaywright() {
  const roots = [
    process.env.STORE_CI_TOOLCHAIN ? path.join(process.env.STORE_CI_TOOLCHAIN, 'node_modules') : '',
    path.join(REPO, 'scripts', 'toolchain', 'node_modules'),
    '/home/oshal-maintainer/Documents/projects/oshal-apps/scripts/toolchain/node_modules',
  ].filter(Boolean);
  for (const root of roots) {
    if (fs.existsSync(path.join(root, 'playwright'))) return require(path.join(root, 'playwright'));
  }
  throw new Error(`BLOCKED: playwright not found. Tried: ${roots.join(', ')}`);
}

const D = (n) => Math.round(n * 1_000_000);

function buildCompiledRouter() {
  function fakeRouter() {
    const routes = [];
    const reg = (method) => (pattern, handler) => routes.push({ method, pattern, handler });
    return { routes, get: reg('GET'), post: reg('POST'), patch: reg('PATCH'), put: reg('PUT'), delete: reg('DELETE') };
  }
  const stubs = {
    express: { Router: () => fakeRouter() },
    '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
    '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
    '@/app/routes/caller-sub': { callerSub: (req) => (req && req.oidc && req.oidc.user && req.oidc.user.sub) || null },
    '@/features/agent-management': { BotNodeClient: class { hasEndpoint() { return false; } }, createRegistryEndpointResolver: () => ({}) },
    '@/app/routes/inline-bot-execution': {
      executeBotOrInline: async () => { throw new Error('browser compare test must never call a bot'); },
    },
  };
  const orig = Module._load;
  Module._load = function load(req, ...rest) {
    if (Object.prototype.hasOwnProperty.call(stubs, req)) return stubs[req];
    return orig.call(this, req, ...rest);
  };
  try {
    delete require.cache[require.resolve(path.join(PKG, 'routes', 'venture-routes.js'))];
    const { createVentureRoutes } = require(path.join(PKG, 'routes', 'venture-routes.js'));
    return createVentureRoutes;
  } finally {
    Module._load = orig;
  }
}

function matchRoute(routes, method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const keys = [];
    const re = new RegExp('^' + r.pattern.replace(/:([A-Za-z0-9_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    const m = re.exec(pathname);
    if (!m) continue;
    const params = {};
    keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return { handler: r.handler, params };
  }
  return null;
}

function createFixturePool(state) {
  const assumptions = [
    { id: 'a1', venture_id: 'v1', owner_sub: 'alice', key: 'bom.final-assembly.cost', domain: 'manufacturing', label: 'Final assembly', unit: 'micros', value_num: D(12), value_text: null, low_num: D(10), high_num: D(15), source_kind: 'user-entered', source_detail: 'Quote', source_url: null, confidence: 'high', authored_by: 'user:alice', run_id: null, superseded_by: null, created_at: new Date(0) },
    { id: 'a2', venture_id: 'v1', owner_sub: 'alice', key: 'landed.freight.container-rate', domain: 'logistics', label: 'Container freight', unit: 'micros', value_num: D(4000), value_text: null, low_num: D(3000), high_num: D(6000), source_kind: 'published-source', source_detail: 'Index', source_url: null, confidence: 'medium', authored_by: 'user:alice', run_id: null, superseded_by: null, created_at: new Date(0) },
    { id: 'a3', venture_id: 'v1', owner_sub: 'alice', key: 'landed.freight.units-per-container', domain: 'logistics', label: 'Units per container', unit: 'units', value_num: 500, value_text: null, low_num: 400, high_num: 600, source_kind: 'user-entered', source_detail: 'Packout', source_url: null, confidence: 'high', authored_by: 'user:alice', run_id: null, superseded_by: null, created_at: new Date(0) },
    { id: 'a4', venture_id: 'v1', owner_sub: 'alice', key: 'landed.freight.cbm-per-unit', domain: 'logistics', label: 'CBM per unit', unit: 'cbm', value_num: 0.04, value_text: null, low_num: 0.03, high_num: 0.05, source_kind: 'user-entered', source_detail: 'Packout', source_url: null, confidence: 'high', authored_by: 'user:alice', run_id: null, superseded_by: null, created_at: new Date(0) },
    { id: 'a5', venture_id: 'v1', owner_sub: 'alice', key: 'landed.duty.hts-rate', domain: 'logistics', label: 'HTS duty rate', unit: 'bps', value_num: 500, value_text: null, low_num: 200, high_num: 1500, source_kind: 'published-source', source_detail: 'USITC', source_url: null, confidence: 'medium', authored_by: 'user:alice', run_id: null, superseded_by: null, created_at: new Date(0) },
    { id: 'a6', venture_id: 'v1', owner_sub: 'alice', key: 'channel.dtc.terms', domain: 'channel', label: 'DTC order cost', unit: 'micros', value_num: D(14), value_text: null, low_num: D(10), high_num: D(18), source_kind: 'model-estimate', source_detail: 'Estimate', source_url: null, confidence: 'medium', authored_by: 'b7000000-0000-0000-0000-000000000003', run_id: null, superseded_by: null, created_at: new Date(0) },
    { id: 'a7', venture_id: 'v1', owner_sub: 'alice', key: 'channel.retail-price', domain: 'channel', label: 'Retail price', unit: 'micros', value_num: D(79), value_text: null, low_num: D(69), high_num: D(99), source_kind: 'user-entered', source_detail: 'Target', source_url: null, confidence: 'high', authored_by: 'user:alice', run_id: null, superseded_by: null, created_at: new Date(0) },
    { id: 'a8', venture_id: 'v1', owner_sub: 'alice', key: 'market.demand.base-units', domain: 'market', label: 'Base demand', unit: 'units', value_num: 3000, value_text: null, low_num: 1500, high_num: 5000, source_kind: 'model-estimate', source_detail: 'Estimate', source_url: null, confidence: 'medium', authored_by: 'b7000000-0000-0000-0000-000000000003', run_id: null, superseded_by: null, created_at: new Date(0) },
    { id: 'a9', venture_id: 'v1', owner_sub: 'alice', key: 'season.sell-through', domain: 'schedule', label: 'Season sell-through', unit: 'ratio', value_num: 0.9, value_text: null, low_num: 0.7, high_num: 1.0, source_kind: 'model-estimate', source_detail: 'Estimate', source_url: null, confidence: 'medium', authored_by: 'b7000000-0000-0000-0000-000000000003', run_id: null, superseded_by: null, created_at: new Date(0) },
  ];
  const ventures = [
    { id: 'v1', owner_sub: 'alice', name: 'Maker Desk Lamp', idea_text: 'An aluminum desk lamp for makers.', spec: {}, currency: 'USD', target_launch_date: null, stage: 'modelled', horizon_months: 24, open_questions: [], created_at: new Date(0), updated_at: new Date(0) },
  ];
  const query = async (sql, params = []) => {
    const s = String(sql);
    if (/FROM venture_ventures/.test(s)) return params.includes('alice') ? { rows: ventures, rowCount: 1 } : { rows: [], rowCount: 0 };
    if (/FROM venture_scenarios/.test(s)) return params.includes('alice') ? { rows: state.scenarios, rowCount: state.scenarios.length } : { rows: [], rowCount: 0 };
    if (/FROM venture_assumptions/.test(s)) return params.includes('alice') ? { rows: assumptions, rowCount: assumptions.length } : { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  };
  return { query, connect: async () => ({ query, release() {} }) };
}

function startTestServer(state) {
  const createVentureRoutes = buildCompiledRouter();
  const pool = createFixturePool(state);
  const router = createVentureRoutes({ pool, appPackageDir: PKG, orchestrator: {} });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/shared/') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/cockpit/') || url.pathname.startsWith('/api/artifacts/')) {
      res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript' });
      res.end(url.pathname.endsWith('.js') && url.pathname.includes('cockpit') ? 'export function receiveHandoff(){} export function mountConnectedActions(){}' : '');
      return;
    }
    if (!url.pathname.startsWith('/api/venture')) { res.writeHead(404); res.end('not found'); return; }
    const rel = url.pathname.slice('/api/venture'.length) || '/';
    const hit = matchRoute(router.routes, req.method, rel);
    if (!hit) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'no route' })); return; }
    const queryObj = Object.fromEntries(url.searchParams.entries());
    const fakeRes = {
      statusCode: 200,
      headers: {},
      status(n) { this.statusCode = n; return this; },
      setHeader(k, v) { this.headers[k] = v; },
      type(t) { this.headers['Content-Type'] = t; return this; },
      json(o) { res.writeHead(this.statusCode, { ...this.headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); },
      send(b) { res.writeHead(this.statusCode, this.headers); res.end(b); },
      sendFile(file) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(file)); },
    };
    await hit.handler({ method: req.method, params: hit.params, query: queryObj, body: {}, headers: req.headers, oidc: { user: { sub: 'alice' } } }, fakeRes);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ server, url: `http://127.0.0.1:${port}/api/venture/` });
  }));
}

test('Compare tab renders empty state, multi-scenario matrix, baseline toggle, diffs, XSS safety, and zero overflow at 1440x900 and 412x915', async () => {
  const { chromium } = loadPlaywright();
  const state = {
    scenarios: [
      { id: 'sc-1', venture_id: 'v1', owner_sub: 'alice', name: 'Base ($79)', overrides: {}, volume_units: 3000, retail_price_micros: D(79), channel_mix: {}, is_base: true, created_at: new Date(0) },
    ],
  };
  const { server, url } = await startTestServer(state);
  const browser = await chromium.launch({ headless: true });
  try {
    const pageErrors = [];
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    // 1. Empty state when < 2 scenarios exist.
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click('[data-view="compare"]');
    await page.waitForSelector('#cmpEmptyCard');
    const emptyText = await page.textContent('#cmpEmptyCard');
    assert.match(emptyText, /at least 2 scenarios/i);

    // 2. Now seed 3 scenarios including an XSS payload in a scenario name and reload.
    state.scenarios = [
      { id: 'sc-1', venture_id: 'v1', owner_sub: 'alice', name: 'Base ($79)', overrides: {}, volume_units: 3000, retail_price_micros: D(79), channel_mix: {}, is_base: true, created_at: new Date(0) },
      { id: 'sc-2', venture_id: 'v1', owner_sub: 'alice', name: 'Premium ($95) <img src=x onerror="window.__xss=1">', overrides: { 'landed.duty.hts-rate': 1500 }, volume_units: 3000, retail_price_micros: D(95), channel_mix: {}, is_base: false, created_at: new Date(1000) },
      { id: 'sc-3', venture_id: 'v1', owner_sub: 'alice', name: 'Scale (5,000 units)', overrides: {}, volume_units: 5000, retail_price_micros: D(79), channel_mix: {}, is_base: false, created_at: new Date(2000) },
    ];
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click('[data-view="compare"]');
    await page.waitForSelector('#cmpMetricsTable');
    await page.waitForSelector('#cmpDiffsTable');

    // XSS payload must stay literal text and never execute.
    assert.equal(await page.evaluate(() => Boolean(window.__xss)), false);
    assert.equal(await page.locator('#view-compare img').count(), 0);
    assert.match(await page.textContent('#cmpMetricsTable'), /Premium \(\$95\)/);
    assert.match(await page.textContent('#cmpMetricsTable'), /Publishable|Blocked/);
    assert.match(await page.textContent('#cmpMetricsTable'), /\+\$16\.00/);
    assert.match(await page.textContent('#cmpDiffsTable'), /landed\.duty\.hts-rate/);
    assert.match(await page.textContent('#cmpDiffsTable'), /@scenario\.runQtyUnits/);

    // Switch baseline to sc-2 and confirm deltas flip sign (Base is now -$16.00 vs Premium).
    await page.selectOption('#cmpBaseline', 'sc-2');
    await page.waitForFunction(() => {
      const tbl = document.getElementById('cmpMetricsTable');
      return tbl && tbl.textContent.includes('\u2212$16.00');
    });

    // Uncheck sc-3 -> table drops to 2 scenario columns (Metric + 2 scenarios = 3 header cells).
    await page.uncheck('input[data-cmp-scenario="sc-3"]');
    await page.waitForFunction(() => document.querySelectorAll('#cmpMetricsTable thead th').length === 3);

    // Desktop 1440x900 overflow check.
    const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(desktopOverflow, false, 'zero horizontal overflow at 1440x900');

    // Mobile 412x915 overflow check (with all 3 scenarios checked).
    await page.check('input[data-cmp-scenario="sc-3"]');
    await page.waitForFunction(() => document.querySelectorAll('#cmpMetricsTable thead th').length === 4);
    await page.setViewportSize({ width: 412, height: 915 });
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(mobileOverflow, false, 'zero horizontal overflow at 412x915');

    assert.deepEqual(pageErrors, [], 'zero pageErrors in Chromium');
  } finally {
    await browser.close();
    server.close();
  }
});
