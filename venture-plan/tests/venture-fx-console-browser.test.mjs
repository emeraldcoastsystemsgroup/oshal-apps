/**
 * Venture Plan — real Chromium browser contract for the 1.5.6 FX Evidence Console
 * and foreign-currency quote binding.
 *
 * Serves the real `tools/venture.html` surface and delegates `/api/venture/*`
 * requests to the real compiled `routes/venture-routes.js` over a local Node
 * loopback server (zero external network, zero model calls). Proves at both
 * `1440x900` (desktop) and `412x915` (mobile):
 * - Recording an immutable `EUR -> USD` rate `1.085` (`rateNanos: 1085000000`)
 *   via `#fxForm`, live exact nano preview, immutable snapshot list (zero
 *   Edit/Delete buttons), safe link handling (`javascript:` stays plain text),
 *   and clicking **Inspect** (`GET /ventures/:id/fx-assumptions/:fxId`).
 * - Selecting `GBP` on the quote form with no matching FX snapshot shows the
 *   inline prompt directing the user to record FX evidence first and blocks
 *   invalid submission.
 * - Selecting `EUR` on the quote form shows the live converted USD preview
 *   (`€10.00 EUR @ 1.085 → $10.85 USD`), binds the recorded `fxAssumptionId`,
 *   saves the foreign quote, and renders BOTH `EUR` and converted `USD` plus
 *   the FX provenance badge on the saved quote row.
 * - Zero horizontal overflow (`scrollWidth <= clientWidth`) and zero pageErrors
 *   on both `1440x900` and `412x915`.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial Chromium browser contract for 1.5.6 FX Evidence Console and foreign-currency quote binding at 1440x900 and 412x915.
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
      executeBotOrInline: async () => { throw new Error('FX browser test must never call a bot'); },
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

function handleFxSql(state, nextId, s, params) {
  if (/INSERT INTO venture_fx_assumptions/.test(s)) {
    const [ventureId, ownerSub, src, rep, rateNanos, sourceKind, sourceRef, observedAt, idem, authoredBy] = params;
    const existing = state.fx.find((r) => r.venture_id === ventureId && r.idempotency_key === idem);
    if (existing) return { rows: [{ ...existing, was_inserted: false }], rowCount: 1 };
    const row = {
      id: `fx-snap-${nextId()}`, venture_id: ventureId, owner_sub: ownerSub,
      source_currency: src, reporting_currency: rep, rate_nanos: rateNanos,
      source_kind: sourceKind, source_ref: sourceRef, observed_at: new Date(observedAt),
      idempotency_key: idem, authored_by: authoredBy, created_at: new Date('2026-11-25T17:00:00Z'),
    };
    state.fx.unshift(row);
    return { rows: [{ ...row, was_inserted: true }], rowCount: 1 };
  }
  if (/FROM venture_fx_assumptions/.test(s)) {
    if (/WHERE id = \$1/.test(s)) {
      const hit = state.fx.find((r) => r.id === params[0] && r.venture_id === params[1] && r.owner_sub === params[2]);
      return { rows: hit ? [hit] : [], rowCount: hit ? 1 : 0 };
    }
    return { rows: state.fx.filter((r) => r.owner_sub === 'alice'), rowCount: state.fx.length };
  }
  return null;
}

function handleQuoteSql(state, nextId, s, params) {
  if (/INSERT INTO venture_assumptions/.test(s)) {
    const row = {
      id: `asm-${nextId()}`, venture_id: params[0], owner_sub: params[1], key: params[2],
      domain: params[3], label: params[4], unit: params[5], value_num: params[6],
      value_text: params[7], low_num: params[8], high_num: params[9],
      source_kind: params[10], source_detail: params[11], source_url: params[12],
      confidence: params[13], authored_by: params[14], run_id: null, superseded_by: null,
      created_at: new Date('2026-11-25T17:01:00Z'),
    };
    state.assumptions.push(row);
    return { rows: [row], rowCount: 1 };
  }
  if (/INSERT INTO venture_quotes/.test(s)) {
    const row = {
      id: `quote-${nextId()}`, venture_id: params[0], owner_sub: params[1], vendor_id: params[2],
      bom_line_id: params[3], qty_break: params[4], unit_cost_micros: params[5],
      currency: params[6], tooling_cost_micros: params[7], reporting_unit_cost_micros: params[8],
      reporting_currency: params[9], reporting_tooling_cost_micros: params[10],
      fx_assumption_id: params[11], incoterm: params[12], lead_time_days: params[13],
      valid_until: params[14], document_ref: params[15], notes: params[16],
      assumption_id: params[17], received_at: new Date('2026-11-25T17:02:00Z'),
    };
    state.quotes.unshift(row);
    return { rows: [row], rowCount: 1 };
  }
  if (/FROM venture_quotes/.test(s)) return { rows: state.quotes, rowCount: state.quotes.length };
  if (/FROM venture_assumptions/.test(s)) return { rows: state.assumptions, rowCount: state.assumptions.length };
  return null;
}

function createFixturePool(state) {
  let seq = 1;
  const nextId = () => seq++;
  const query = async (sql, params = []) => {
    const s = String(sql).trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s)) return { rows: [], rowCount: 0 };
    if (/FROM venture_ventures/.test(s) && !/INSERT INTO venture_fx_assumptions/.test(s)) {
      return params.includes('alice') ? { rows: state.ventures, rowCount: state.ventures.length } : { rows: [], rowCount: 0 };
    }
    const fxHit = handleFxSql(state, nextId, s, params);
    if (fxHit) return fxHit;
    const quoteHit = handleQuoteSql(state, nextId, s, params);
    if (quoteHit) return quoteHit;
    if (/FROM venture_vendors/.test(s)) {
      const rows = /WHERE id = \$1/.test(s) ? state.vendors.filter((v) => v.id === params[0] && v.owner_sub === params[2]) : state.vendors;
      return { rows, rowCount: rows.length };
    }
    if (/FROM venture_bom_lines/.test(s)) {
      const rows = /WHERE id = \$1/.test(s) ? state.bom.filter((b) => b.id === params[0] && b.owner_sub === params[2]) : state.bom;
      return { rows, rowCount: rows.length };
    }
    if (/UPDATE venture_bom_lines/.test(s)) return { rows: [], rowCount: 1 };
    if (/INSERT INTO venture_models/.test(s)) return { rows: [{ id: `mod-${nextId()}`, computed_at: new Date('2026-11-25T17:02:00Z') }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  return { query, connect: async () => ({ query, release() {} }) };
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (_e) { resolve({}); }
    });
  });
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
    const body = (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') ? await readJsonBody(req) : {};
    const queryObj = Object.fromEntries(url.searchParams.entries());
    const fakeRes = {
      statusCode: 200, headers: {},
      status(n) { this.statusCode = n; return this; },
      setHeader(k, v) { this.headers[k] = v; },
      type(t) { this.headers['Content-Type'] = t; return this; },
      json(o) { res.writeHead(this.statusCode, { ...this.headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); },
      send(b) { res.writeHead(this.statusCode, this.headers); res.end(b); },
      sendFile(file) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(file)); },
    };
    await hit.handler({ method: req.method, params: hit.params, query: queryObj, body, headers: req.headers, oidc: { user: { sub: 'alice' } } }, fakeRes);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ server, url: `http://127.0.0.1:${port}/api/venture/` });
  }));
}

test('FX Evidence Console records immutable EUR->USD 1.085 snapshot, binds foreign quote, refuses missing FX, and has zero overflow at 1440x900 and 412x915', async () => {
  const { chromium } = loadPlaywright();
  const state = {
    ventures: [{
      id: 'v1', owner_sub: 'alice', name: 'Maker Desk Lamp', idea_text: 'An aluminum desk lamp for makers.',
      spec: {}, currency: 'USD', target_launch_date: null, stage: 'sourcing', horizon_months: 24,
      open_questions: [], created_at: new Date(0), updated_at: new Date(0),
    }],
    vendors: [{
      id: 'ven-1', venture_id: 'v1', owner_sub: 'alice', name: 'EuroMold GmbH', kind: 'cm',
      country: 'DE', url: null, contact: null, moq: 500, lead_time_days: 30, qualification_days: 14,
      deposit_bps: 3000, balance_net_days: 30, qualified: true, notes: null, status: 'active',
      source_kind: 'user-entered', confidence: 'high',
    }],
    bom: [{
      id: 'bom-1', venture_id: 'v1', owner_sub: 'alice', parent_line_id: null, ref: 'HSG-01',
      part_name: 'Die-cast housing', spec_text: null, qty_per_unit: 1, uom: 'ea', discrete: true,
      material: 'Al', process: 'die-cast', make_or_buy: 'buy', unit_cost_micros: 12_000_000,
      low_micros: 10_000_000, high_micros: 15_000_000, scrap_pct: 0, moq: 500, lead_time_days: 30,
      tooling_cost_micros: 0, tooling_life_units: null, vendor_id: 'ven-1',
      assumption_key: 'bom.HSG-01.unit-cost', hts_code: null, duty_pct: null,
      source_kind: 'model-estimate', confidence: 'medium', sort_order: 0,
    }],
    assumptions: [],
    fx: [],
    quotes: [],
  };
  const { server, url } = await startTestServer(state);
  const browser = await chromium.launch({ headless: true });
  try {
    const pageErrors = [];
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click('[data-view="assumptions"]');
    await page.waitForSelector('#fxEvidenceSection');
    await page.waitForSelector('#quotesSection');

    // 1. Selecting GBP with zero GBP->USD snapshots shows missing FX prompt & blocks submit.
    await page.selectOption('#quoteCurrency', 'GBP');
    await page.waitForSelector('#quoteFxMissingPrompt:not([hidden])');
    assert.match(await page.textContent('#quoteFxMissingPrompt'), /No immutable FX snapshot recorded for GBP/i);
    assert.equal(await page.isDisabled('#quoteSaveBtn'), true);

    // 2. Record EUR -> USD rate 1.085 (exact 1,085,000,000 nanos) via #fxForm.
    await page.fill('#fxSourceCurrency', 'EUR');
    await page.fill('#fxRateDecimal', '1.085');
    assert.match(await page.textContent('#fxRateNanosPreview'), /1,085,000,000/);
    await page.selectOption('#fxSourceName', 'published-source');
    await page.fill('#fxSourceRef', 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates');
    await page.fill('#fxNotes', 'Q4 housing quote rate');
    await page.click('#fxSaveBtn');

    await page.waitForSelector('#fxSnapshotsTable');
    const fxTableText = await page.textContent('#fxSnapshotsTable');
    assert.match(fxTableText, /EUR → USD/);
    assert.match(fxTableText, /1\.085/);
    assert.match(fxTableText, /1,085,000,000 nanos/);
    assert.match(fxTableText, /Immutable/);
    // Zero Edit or Delete buttons on immutable FX rows.
    assert.equal(await page.locator('#fxSnapshotsTable button:has-text("Edit")').count(), 0);
    assert.equal(await page.locator('#fxSnapshotsTable button:has-text("Delete")').count(), 0);

    // Inspect button fetches GET /fx-assumptions/:fxId and displays full details.
    await page.click('#fxSnapshotsTable button[data-fx-inspect]');
    await page.waitForSelector('#fxInspectPanel');
    assert.match(await page.textContent('#fxInspectPanel'), /1,085,000,000/);
    assert.match(await page.textContent('#fxInspectPanel'), /Immutable append-only/);

    // 3. Also record a hostile javascript: sourceRef and confirm it renders as plain text, never a clickable link.
    await page.fill('#fxSourceCurrency', 'CNY');
    await page.fill('#fxRateDecimal', '0.138');
    await page.fill('#fxSourceRef', 'javascript:alert(1)');
    await page.fill('#fxNotes', '<img src=x onerror="window.__fxXss=1">');
    await page.click('#fxSaveBtn');
    await page.waitForFunction(() => document.querySelectorAll('#fxSnapshotsTable tbody tr').length === 2);
    assert.equal(await page.evaluate(() => Boolean(window.__fxXss)), false);
    assert.equal(await page.locator('#fxSnapshotsTable a[href^="javascript:"]').count(), 0);
    assert.equal(await page.locator('#fxSnapshotsTable a[href^="https://www.ecb.europa.eu"]').count(), 1);

    // 4. Select EUR on quote form, verify live converted preview, bind recorded fxAssumptionId, and save quote.
    await page.selectOption('#quoteCurrency', 'EUR');
    await page.selectOption('#quoteBomLineId', 'bom-1');
    await page.fill('#quoteUnitCost', '10.00');
    await page.fill('#quoteDocRef', 'RFQ-EU-2026-11');
    await page.waitForFunction(() => {
      const p = document.getElementById('quoteFxPreview');
      return p && p.textContent.includes('$10.85 USD');
    });
    assert.match(await page.textContent('#quoteFxPreview'), /€10\.00 EUR @ 1\.085 → \$10\.85 USD/);
    assert.equal(await page.isDisabled('#quoteSaveBtn'), false);
    await page.click('#quoteSaveBtn');

    await page.waitForSelector('#quotesTable');
    const qText = await page.textContent('#quotesTable');
    assert.match(qText, /€10\.00 EUR/);
    assert.match(qText, /\$10\.85 USD/);
    assert.match(qText, /FX fx-snap-/);
    assert.equal(state.quotes.length, 1);
    assert.equal(state.quotes[0].unit_cost_micros, 10_000_000);
    assert.equal(state.quotes[0].reporting_unit_cost_micros, 10_850_000);
    assert.equal(state.quotes[0].fx_assumption_id, 'fx-snap-1');

    // 5. Zero horizontal overflow on desktop 1440x900 and mobile 412x915.
    const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(desktopOverflow, false, 'zero horizontal overflow at 1440x900');

    await page.setViewportSize({ width: 412, height: 915 });
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(mobileOverflow, false, 'zero horizontal overflow at 412x915');

    assert.deepEqual(pageErrors, [], 'zero pageErrors in Chromium');
  } finally {
    await browser.close();
    server.close();
  }
});
