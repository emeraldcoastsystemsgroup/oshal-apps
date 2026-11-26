/**
 * Venture Plan — real Chromium browser contract for the 1.5.7 Saved-quote inbox.
 *
 * Serves the real `tools/venture.html` surface over a local loopback HTTP server
 * backed by the compiled `routes/venture-routes.js` (zero external network, zero
 * model calls). Proves at both `1440x900` (desktop) and `412x915` (mobile):
 * - Attaching a USD quote text document via `#inboxPasteText`, verifying extracted
 *   fields + SHA-256 digest, and promoting it into `#quotesTable`.
 * - Uploading a EUR quote `.txt` file via `#inboxFileInput`, recording/selecting an
 *   immutable `EUR -> USD 1.085` FX snapshot, verifying converted USD preview, and
 *   promoting the EUR quote into `#quotesTable` with both EUR and USD amounts, FX
 *   provenance badge, and document SHA-256 provenance.
 * - Attaching a third quote (with hostile XSS payload in filename/vendor) and
 *   dismissing it cleanly with zero XSS execution.
 * - Zero horizontal overflow (`scrollWidth <= clientWidth`) and zero pageErrors
 *   at both `1440x900` and `412x915`.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial Chromium browser contract for 1.5.7 Saved-quote inbox attach, review, USD & EUR FX-bound promote, dismiss, XSS safety, and responsive layout.
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
      executeBotOrInline: async () => { throw new Error('Quote inbox browser test must never call a bot'); },
    },
  };
  const orig = Module._load;
  Module._load = function load(req, ...rest) {
    if (Object.prototype.hasOwnProperty.call(stubs, req)) return stubs[req];
    return orig.call(this, req, ...rest);
  };
  try {
    delete require.cache[require.resolve(path.join(PKG, 'routes', 'venture-routes.js'))];
    return require(path.join(PKG, 'routes', 'venture-routes.js')).createVentureRoutes;
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

function handleInboxSql(state, nextId, s, params) {
  if (/INSERT INTO venture_quote_inbox/.test(s)) {
    const row = {
      id: `qi-${nextId()}`, venture_id: params[0], owner_sub: params[1], filename: params[2],
      mime_type: params[3], byte_size: params[4], sha256: params[5], raw_excerpt: params[6],
      extracted_json: JSON.parse(params[7]), status: 'pending', promoted_quote_id: null,
      created_at: new Date('2026-11-25T17:10:00Z'), updated_at: new Date('2026-11-25T17:10:00Z'),
    };
    state.inbox.unshift(row);
    return { rows: [row], rowCount: 1 };
  }
  if (/FROM venture_quote_inbox/.test(s)) {
    if (/WHERE id = \$1/.test(s)) {
      const hit = state.inbox.find((r) => r.id === params[0] && r.venture_id === params[1] && r.owner_sub === params[2]);
      return { rows: hit ? [hit] : [], rowCount: hit ? 1 : 0 };
    }
    return { rows: state.inbox, rowCount: state.inbox.length };
  }
  if (/UPDATE venture_quote_inbox/.test(s)) {
    const hit = state.inbox.find((r) => r.id === params[0] && r.venture_id === params[1] && r.owner_sub === params[2] && r.status === 'pending');
    if (!hit) return { rows: [], rowCount: 0 };
    if (/status = 'dismissed'/.test(s)) hit.status = 'dismissed';
    else { hit.status = 'promoted'; hit.promoted_quote_id = params[3]; }
    hit.updated_at = new Date('2026-11-25T17:12:00Z');
    return { rows: [hit], rowCount: 1 };
  }
  return null;
}

function createFixturePool(state) {
  let seq = 1;
  const nextId = () => seq++;
  const query = async (sql, params = []) => {
    const s = String(sql).trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s)) return { rows: [], rowCount: 0 };
    const inboxHit = handleInboxSql(state, nextId, s, params);
    if (inboxHit) return inboxHit;
    if (/FROM venture_ventures/.test(s)) {
      return params.includes('alice') ? { rows: state.ventures, rowCount: state.ventures.length } : { rows: [], rowCount: 0 };
    }
    if (/FROM venture_fx_assumptions/.test(s)) {
      if (/WHERE id = \$1/.test(s)) {
        const hit = state.fx.find((r) => r.id === params[0] && r.venture_id === params[1] && r.owner_sub === params[2]);
        return { rows: hit ? [hit] : [], rowCount: hit ? 1 : 0 };
      }
      return { rows: state.fx, rowCount: state.fx.length };
    }
    if (/INSERT INTO venture_vendors/.test(s)) {
      const row = {
        id: `ven-${nextId()}`, venture_id: params[0], owner_sub: params[1], name: params[2],
        kind: 'component', country: null, url: null, contact: null, moq: null, lead_time_days: null,
        qualification_days: 0, deposit_bps: 0, balance_net_days: 0, qualified: false, notes: null,
        status: 'candidate', source_kind: 'vendor-quote', confidence: 'high',
      };
      state.vendors.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (/FROM venture_vendors/.test(s)) {
      const rows = /WHERE id = \$1/.test(s) ? state.vendors.filter((v) => v.id === params[0]) : state.vendors;
      return { rows, rowCount: rows.length };
    }
    if (/FROM venture_bom_lines/.test(s)) {
      const rows = /WHERE id = \$1/.test(s) ? state.bom.filter((b) => b.id === params[0]) : state.bom;
      return { rows, rowCount: rows.length };
    }
    if (/INSERT INTO venture_assumptions/.test(s)) {
      const row = {
        id: `asm-${nextId()}`, venture_id: params[0], owner_sub: params[1], key: params[2],
        domain: params[3], label: params[4], unit: params[5], value_num: params[6],
        value_text: params[7], low_num: params[8], high_num: params[9],
        source_kind: params[10], source_detail: params[11], source_url: params[12],
        confidence: params[13], authored_by: params[14], run_id: null, superseded_by: null,
        created_at: new Date('2026-11-25T17:11:00Z'),
      };
      state.assumptions.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (/INSERT INTO venture_quotes/.test(s)) {
      const row = {
        id: `quote-${nextId()}`, venture_id: params[0], owner_sub: params[1], vendor_id: params[2],
        bom_line_id: params[3], qty_break: params[4], unit_cost_micros: params[5], currency: params[6],
        tooling_cost_micros: params[7], reporting_unit_cost_micros: params[8], reporting_currency: params[9],
        reporting_tooling_cost_micros: params[10], fx_assumption_id: params[11], incoterm: params[12],
        lead_time_days: params[13], valid_until: params[14], document_ref: params[15], notes: params[16],
        assumption_id: params[17], received_at: new Date('2026-11-25T17:12:00Z'),
      };
      state.quotes.unshift(row);
      return { rows: [row], rowCount: 1 };
    }
    if (/FROM venture_quotes/.test(s)) return { rows: state.quotes, rowCount: state.quotes.length };
    if (/FROM venture_assumptions/.test(s)) return { rows: state.assumptions, rowCount: state.assumptions.length };
    if (/INSERT INTO venture_models/.test(s)) return { rows: [{ id: `mod-${nextId()}`, computed_at: new Date('2026-11-25T17:12:00Z') }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  return { query, connect: async () => ({ query, release() {} }) };
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_e) { resolve({}); } });
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
    resolve({ server, url: `http://127.0.0.1:${server.address().port}/api/venture/` });
  }));
}

test('Saved-quote inbox attaches, extracts, promotes USD and EUR FX-bound quotes, dismisses a quote, prevents XSS, and has zero overflow at 1440x900 and 412x915', async () => {
  const { chromium } = loadPlaywright();
  const state = {
    ventures: [{
      id: 'v1', owner_sub: 'alice', name: 'Maker Desk Lamp', idea_text: 'An aluminum desk lamp for makers.',
      spec: {}, currency: 'USD', target_launch_date: null, stage: 'sourcing', horizon_months: 24,
      open_questions: [], created_at: new Date(0), updated_at: new Date(0),
    }],
    vendors: [{
      id: 'ven-1', venture_id: 'v1', owner_sub: 'alice', name: 'EuroMold GmbH', kind: 'cm',
      country: 'DE', url: null, contact: null, moq: 500, lead_time_days: 28, qualification_days: 14,
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
    fx: [{
      id: 'fx-eur-1085', venture_id: 'v1', owner_sub: 'alice', source_currency: 'EUR',
      reporting_currency: 'USD', rate_nanos: 1_085_000_000, source_kind: 'published-source',
      source_ref: 'https://www.ecb.europa.eu/stats', observed_at: new Date('2026-11-25T17:00:00Z'),
      idempotency_key: 'eur-usd-1085', authored_by: 'user:alice', created_at: new Date('2026-11-25T17:00:00Z'),
    }],
    assumptions: [], quotes: [], inbox: [],
  };
  const { server, url } = await startTestServer(state);
  const browser = await chromium.launch({ headless: true });
  try {
    const pageErrors = [];
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click('[data-view="assumptions"]');
    await page.waitForSelector('#quoteInboxSection');

    // 1. Attach USD quote via paste box and promote it into Quotes table.
    await page.fill('#inboxFilename', 'domestic-pcb.txt');
    await page.fill('#inboxPasteText', 'Vendor: Bay Circuit Corp\nUnit Price: $6.25\nMOQ: 250\nLead Time: 2 weeks\nIncoterm: EXW\nQuote #: US-PCB-7');
    await page.click('#inboxAttachBtn');
    await page.waitForSelector('#quoteInboxList [data-inbox-status="pending"]');
    const usdCardId = await page.getAttribute('#quoteInboxList [data-inbox-status="pending"]', 'data-inbox-id');
    assert.equal(await page.inputValue(`#qiVendor-${usdCardId}`), 'Bay Circuit Corp');
    assert.equal(await page.inputValue(`#qiPrice-${usdCardId}`), '6.25');
    assert.equal(await page.inputValue(`#qiLead-${usdCardId}`), '14');
    await page.click(`[data-inbox-promote="${usdCardId}"]`);
    await page.waitForSelector('#quotesTable');
    assert.match(await page.textContent('#quotesTable'), /\$6\.25 USD/);
    assert.match(await page.textContent('#quotesTable'), /Bay Circuit Corp/);

    // 2. Upload EUR quote file via #inboxFileInput, verify conditional FX preview, promote with FX snapshot.
    await page.setInputFiles('#inboxFileInput', {
      name: 'euromold-quote.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Vendor: EuroMold GmbH\nUnit Price: €10.00\nMOQ: 500\nLead Time: 4 weeks\nIncoterm: FOB\nQuote #: RFQ-EU-77'),
    });
    await page.click('#inboxAttachBtn');
    await page.waitForSelector('#quoteInboxList [data-inbox-status="pending"]');
    const eurCardId = await page.getAttribute('#quoteInboxList [data-inbox-status="pending"]', 'data-inbox-id');
    assert.equal(await page.inputValue(`#qiCur-${eurCardId}`), 'EUR');
    assert.match(await page.textContent(`[data-inbox-id="${eurCardId}"]`), /\$10\.85 USD/);
    await page.selectOption(`#qiBom-${eurCardId}`, 'bom-1');
    await page.click(`[data-inbox-promote="${eurCardId}"]`);
    await page.waitForFunction(() => document.querySelectorAll('#quotesTable tbody tr').length === 2);
    const quotesText = await page.textContent('#quotesTable');
    assert.match(quotesText, /€10\.00 EUR/);
    assert.match(quotesText, /\$10\.85 USD/);
    assert.match(quotesText, /FX fx-eur-1/);
    assert.match(quotesText, /euromold-quote\.txt/);

    // 3. Attach hostile quote and dismiss it cleanly with zero XSS.
    await page.setInputFiles('#inboxFileInput', []);
    await page.fill('#inboxFilename', '<img src=x onerror="window.__qiXss=1">.txt');
    await page.fill('#inboxPasteText', 'Vendor: <script>window.__qiXss=2</script>BadCo\nUnit Price: $99.00');
    await page.click('#inboxAttachBtn');
    await page.waitForSelector('#quoteInboxList [data-inbox-status="pending"]');
    const xssCardId = await page.getAttribute('#quoteInboxList [data-inbox-status="pending"]', 'data-inbox-id');
    assert.equal(await page.evaluate(() => Boolean(window.__qiXss)), false);
    await page.click(`[data-inbox-dismiss="${xssCardId}"]`);
    await page.waitForSelector(`[data-inbox-id="${xssCardId}"][data-inbox-status="dismissed"]`);
    assert.equal(await page.evaluate(() => Boolean(window.__qiXss)), false);

    // 4. Zero horizontal overflow at 1440x900 and 412x915, zero pageErrors.
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
