/**
 * Venture Plan — Saved-quote inbox parser, store, and HTTP route guards.
 *
 * Exercises the compiled pure parser (`routes/venture-quote-parser.js`), owner-
 * scoped store (`routes/venture-store-quote-inbox.js`), and HTTP routes
 * (`routes/venture-routes.js` + `routes/venture-routes-quote-inbox.js`) with
 * zero model calls and zero floats in money arithmetic.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial saved-quote inbox test suite: pure SHA-256 parity, text/CSV/Markdown/EML/PDF (uncompressed, FlateDecode, image-only) extraction, bounds, FX enforcement, double-promote 409, dismiss refusal, and two-owner 404 isolation.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const zlib = require('node:zlib');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const parser = require(path.join(PKG, 'routes', 'venture-quote-parser.js'));

function fakeRouter() {
  const routes = new Map();
  const reg = (m) => (p, h) => { routes.set(`${m} ${p}`, h); };
  return { routes, get: reg('get'), post: reg('post'), patch: reg('patch'), put: reg('put'), delete: reg('delete') };
}

const botCalls = [];
const STUBS = {
  express: { Router: () => fakeRouter() },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
  '@/app/routes/caller-sub': { callerSub: (req) => (req && req.oidc && req.oidc.user && req.oidc.user.sub) || null },
  '@/features/agent-management': { BotNodeClient: class { hasEndpoint() { return false; } }, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/inline-bot-execution': {
    executeBotOrInline: async (_ctx, _c, agentId) => { botCalls.push(agentId); throw new Error('quote inbox must never call a bot'); },
  },
};
const origLoad = Module._load;
Module._load = function load(req, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, req)) return STUBS[req];
  return origLoad.call(this, req, ...rest);
};
const { createVentureRoutes } = require(path.join(PKG, 'routes', 'venture-routes.js'));
Module._load = origLoad;

function makeRes() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.status = (n) => { r.statusCode = n; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.send = (o) => { r.body = o; return r; };
  r.type = () => r;
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.sendFile = () => r;
  return r;
}

function makeStatefulPool() {
  const state = {
    ventures: [{
      id: 'v1', owner_sub: 'alice', name: 'Lamp', idea_text: 'Desk lamp', spec: {},
      currency: 'USD', target_launch_date: null, stage: 'sourcing', horizon_months: 24,
      open_questions: [], created_at: new Date(0), updated_at: new Date(0),
    }],
    vendors: [{
      id: 'ven-1', venture_id: 'v1', owner_sub: 'alice', name: 'EuroMold GmbH', kind: 'component',
      country: 'DE', url: null, contact: null, moq: 500, lead_time_days: 28,
      qualification_days: 0, deposit_bps: 0, balance_net_days: 0, qualified: true,
      notes: null, status: 'active', source_kind: 'user-entered', confidence: 'high',
    }],
    fx: [{
      id: 'fx-eur-1', venture_id: 'v1', owner_sub: 'alice', source_currency: 'EUR',
      reporting_currency: 'USD', rate_nanos: '1085000000', source_kind: 'published-source',
      source_ref: 'ECB ref', observed_at: new Date('2026-11-25T00:00:00Z'),
      idempotency_key: 'eur-usd-1085', authored_by: 'user:alice', created_at: new Date(0),
    }],
    bom: [], assumptions: [], quotes: [], inbox: [], calls: [],
  };
  let seq = 1;
  const query = async (sql, params = []) => {
    const s = String(sql).trim();
    state.calls.push({ sql: s, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO venture_quote_inbox/.test(s)) {
      const owns = state.ventures.some((v) => v.id === params[0] && v.owner_sub === params[1]);
      if (!owns) return { rows: [], rowCount: 0 };
      const row = {
        id: `qi-${seq++}`, venture_id: params[0], owner_sub: params[1], filename: params[2],
        mime_type: params[3], byte_size: params[4], sha256: params[5], raw_excerpt: params[6],
        extracted_json: JSON.parse(params[7]), status: 'pending', promoted_quote_id: null,
        created_at: new Date('2026-11-25T12:00:00Z'), updated_at: new Date('2026-11-25T12:00:00Z'),
      };
      state.inbox.unshift(row);
      return { rows: [row], rowCount: 1 };
    }
    if (/SELECT \* FROM venture_quote_inbox/.test(s)) {
      if (/WHERE id = \$1/.test(s)) {
        const hit = state.inbox.find((r) => r.id === params[0] && r.venture_id === params[1] && r.owner_sub === params[2]);
        return { rows: hit ? [hit] : [], rowCount: hit ? 1 : 0 };
      }
      const rows = state.inbox.filter((r) => r.venture_id === params[0] && r.owner_sub === params[1]);
      return { rows, rowCount: rows.length };
    }
    if (/UPDATE venture_quote_inbox/.test(s)) {
      const hit = state.inbox.find((r) => r.id === params[0] && r.venture_id === params[1] && r.owner_sub === params[2] && r.status === 'pending');
      if (!hit) return { rows: [], rowCount: 0 };
      if (/status = 'dismissed'/.test(s)) hit.status = 'dismissed';
      else { hit.status = 'promoted'; hit.promoted_quote_id = params[3]; }
      hit.updated_at = new Date('2026-11-25T12:05:00Z');
      return { rows: [hit], rowCount: 1 };
    }
    if (/FROM venture_ventures/.test(s)) {
      const rows = state.ventures.filter((v) => v.id === params[0] && v.owner_sub === params[1]);
      return { rows, rowCount: rows.length };
    }
    if (/FROM venture_fx_assumptions/.test(s)) {
      const rows = state.fx.filter((f) => f.id === params[0] && f.venture_id === params[1] && f.owner_sub === params[2]);
      return { rows, rowCount: rows.length };
    }
    if (/INSERT INTO venture_vendors/.test(s)) {
      const row = {
        id: `ven-${seq++}`, venture_id: params[0], owner_sub: params[1], name: params[2],
        kind: 'component', country: null, url: null, contact: null, moq: null, lead_time_days: null,
        qualification_days: 0, deposit_bps: 0, balance_net_days: 0, qualified: false, notes: null,
        status: 'candidate', source_kind: 'vendor-quote', confidence: 'high',
      };
      state.vendors.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (/FROM venture_vendors/.test(s)) {
      const rows = /WHERE id = \$1/.test(s)
        ? state.vendors.filter((v) => v.id === params[0] && v.venture_id === params[1] && v.owner_sub === params[2])
        : state.vendors.filter((v) => v.venture_id === params[0] && v.owner_sub === params[1]);
      return { rows, rowCount: rows.length };
    }
    if (/INSERT INTO venture_quotes/.test(s)) {
      const row = {
        id: `quote-${seq++}`, venture_id: params[0], owner_sub: params[1], vendor_id: params[2],
        bom_line_id: params[3], qty_break: params[4], unit_cost_micros: params[5], currency: params[6],
        tooling_cost_micros: params[7], reporting_unit_cost_micros: params[8], reporting_currency: params[9],
        reporting_tooling_cost_micros: params[10], fx_assumption_id: params[11], incoterm: params[12],
        lead_time_days: params[13], valid_until: params[14], document_ref: params[15], notes: params[16],
        assumption_id: params[17], received_at: new Date('2026-11-25T12:04:00Z'),
      };
      state.quotes.unshift(row);
      return { rows: [row], rowCount: 1 };
    }
    if (/INSERT INTO venture_models/.test(s)) {
      return { rows: [{ id: `mod-${seq++}`, computed_at: new Date('2026-11-25T12:05:00Z') }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  return { state, pool: { query, connect: async () => ({ query, release() {} }) } };
}

async function callRoute(pool, method, pattern, req) {
  const router = createVentureRoutes({ pool, appPackageDir: PKG, orchestrator: {} });
  const handler = router.routes.get(`${method} ${pattern}`);
  assert.ok(handler, `route ${method} ${pattern} must be registered`);
  const res = makeRes();
  await handler(Object.assign({ body: {}, params: {}, query: {}, headers: {}, originalUrl: pattern }, req), res);
  return res;
}

/* ══ 1. Pure parser: SHA-256 parity, text/CSV/MD/EML/PDF, determinism ════ */

test('pure sha256Hex matches node:crypto across empty, UTF-8, and binary vectors', () => {
  for (const buf of [Buffer.alloc(0), Buffer.from('abc'), Buffer.from('€12.50 FOB Shenzhen'), Buffer.from([0, 1, 255, 128, 64, 42])]) {
    const expected = crypto.createHash('sha256').update(buf).digest('hex');
    assert.equal(parser.sha256Hex(new Uint8Array(buf)), expected);
  }
});

test('extracts EML EUR quote with exact micros, week-to-day lead time, incoterm, MOQ, and ref', () => {
  const eml = [
    'From: EuroMold GmbH <quotes@euromold.de>',
    'Subject: Die-cast Aluminum Housing HSG-01',
    'Quote #: RFQ-EU-2026-42',
    'Unit Price: €12.50 EUR',
    'MOQ: 500 pcs',
    'Lead Time: 4 weeks',
    'Incoterm: FOB Hamburg',
  ].join('\n');
  const first = parser.parseQuoteDocument({ filename: 'euromold.eml', mimeType: 'message/rfc822', textContent: eml });
  const second = parser.parseQuoteDocument({ filename: 'euromold.eml', mimeType: 'message/rfc822', textContent: eml });
  assert.equal(JSON.stringify(first), JSON.stringify(second), 'byte-identical determinism');
  assert.equal(first.sha256, crypto.createHash('sha256').update(Buffer.from(eml, 'utf8')).digest('hex'));
  assert.equal(first.extracted.vendorName, 'EuroMold GmbH');
  assert.equal(first.extracted.itemLabel, 'Die-cast Aluminum Housing HSG-01');
  assert.equal(first.extracted.unitPriceMicros, 12_500_000);
  assert.equal(first.extracted.currency, 'EUR');
  assert.equal(first.extracted.moq, 500);
  assert.equal(first.extracted.leadTimeDays, 28);
  assert.equal(first.extracted.incoterm, 'FOB');
  assert.equal(first.extracted.quoteRef, 'RFQ-EU-2026-42');
});

test('extracts CSV RMB->CNY quote and Markdown sub-cent USD quote with zero float error', () => {
  const csv = 'Vendor,Part,Unit Price,Currency,MOQ,Lead Time,Incoterm,Quote Ref\n"Shenzhen Optics Co","Lens L-9",18.25,RMB,"1,000",3 weeks,EXW,SZ-8801';
  const rCsv = parser.parseQuoteDocument({ filename: 'optics.csv', mimeType: 'text/csv', textContent: csv });
  assert.equal(rCsv.extracted.vendorName, 'Shenzhen Optics Co');
  assert.equal(rCsv.extracted.unitPriceMicros, 18_250_000);
  assert.equal(rCsv.extracted.currency, 'CNY');
  assert.equal(rCsv.extracted.moq, 1000);
  assert.equal(rCsv.extracted.leadTimeDays, 21);
  assert.equal(rCsv.extracted.incoterm, 'EXW');

  const md = 'Vendor: Fastener Works\nPart: M3 Screw\nUnit Price: $0.0034\nMOQ: 10,000\nLead Time: 10 days\nIncoterm: DDP';
  const rMd = parser.parseQuoteDocument({ filename: 'screw.md', mimeType: 'text/markdown', textContent: md });
  assert.equal(rMd.extracted.unitPriceMicros, 3400, 'sub-cent $0.0034 stays exact 3400 micros');
  assert.equal(rMd.extracted.currency, 'USD');
  assert.equal(rMd.extracted.moq, 10000);
  assert.equal(rMd.extracted.leadTimeDays, 10);
  assert.equal(rMd.extracted.incoterm, 'DDP');
});

test('extracts FlateDecode PDF text streams and honestly notes image-only PDFs', () => {
  const pdfStreamContent = 'BT (Vendor: Nordic Castings) Tj (Unit Price: EUR 9.75) Tj (MOQ: 250) Tj (Lead Time: 2 weeks) Tj (Incoterm: CIF) Tj ET';
  const compressed = zlib.deflateSync(Buffer.from(pdfStreamContent, 'latin1'));
  const pdfBuf = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode /Length ' + compressed.length + ' >>\nstream\n', 'latin1'),
    compressed,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
  const parsed = parser.parseQuoteDocument({
    filename: 'nordic-quote.pdf',
    mimeType: 'application/pdf',
    base64Bytes: pdfBuf.toString('base64'),
  });
  assert.equal(parsed.sha256, crypto.createHash('sha256').update(pdfBuf).digest('hex'));
  assert.equal(parsed.extracted.vendorName, 'Nordic Castings');
  assert.equal(parsed.extracted.unitPriceMicros, 9_750_000);
  assert.equal(parsed.extracted.currency, 'EUR');
  assert.equal(parsed.extracted.moq, 250);
  assert.equal(parsed.extracted.leadTimeDays, 14);
  assert.equal(parsed.extracted.incoterm, 'CIF');

  const imageOnlyPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Subtype /Image /Width 100 /Height 100 >>\nstream\n\x89PNG\r\n\x00\x01\nendstream\nendobj\n%%EOF', 'latin1');
  const scanned = parser.parseQuoteDocument({
    filename: 'scanned-fax.pdf',
    mimeType: 'application/pdf',
    base64Bytes: imageOnlyPdf.toString('base64'),
  });
  assert.equal(scanned.extracted.unitPriceMicros, null);
  assert.ok(scanned.extracted.extractionNotes.includes(parser.PDF_NO_TEXT_NOTE));
});

test('parser refuses empty payload, missing filename, invalid base64, and oversized documents', () => {
  assert.throws(() => parser.parseQuoteDocument({ filename: '', textContent: 'hi' }), { code: 'quote_filename_required' });
  assert.throws(() => parser.parseQuoteDocument({ filename: 'a.txt', textContent: '   ' }), { code: 'quote_document_empty' });
  assert.throws(() => parser.parseQuoteDocument({ filename: 'a.txt', base64Bytes: 'not!base64!' }), { code: 'quote_document_invalid_base64' });
  const bigText = 'x'.repeat(parser.MAX_QUOTE_TEXT_BYTES + 1);
  assert.throws(() => parser.parseQuoteDocument({ filename: 'big.txt', textContent: bigText }), { code: 'quote_document_too_large' });
});

/* ══ 2. HTTP routes: attach, FX enforcement, promote, double-promote 409, dismiss, two-owner 404 ══ */

test('attach lands pending, foreign promote enforces FX before write, bound promote creates quote with SHA-256 provenance, and double-promote returns 409', async () => {
  const { state, pool } = makeStatefulPool();
  const alice = { oidc: { user: { sub: 'alice' } } };
  const mallory = { oidc: { user: { sub: 'mallory' } } };
  const quoteText = 'Vendor: EuroMold GmbH\nUnit Price: €10.00\nMOQ: 500\nLead Time: 4 weeks\nIncoterm: FOB\nQuote #: RFQ-EU-99';

  // 1. Attach -> 201 pending, zero quotes created.
  const attached = await callRoute(pool, 'post', '/ventures/:id/quote-inbox', Object.assign({
    params: { id: 'v1' }, body: { filename: 'euromold.txt', mimeType: 'text/plain', textContent: quoteText },
  }, alice));
  assert.equal(attached.statusCode, 201);
  assert.equal(attached.body.item.status, 'pending');
  assert.equal(attached.body.item.extracted.currency, 'EUR');
  assert.equal(attached.body.item.extracted.unitPriceMicros, 10_000_000);
  assert.equal(state.quotes.length, 0, 'attaching must never auto-commit to venture_quotes');
  const itemId = attached.body.item.id;

  // 2. Unbound foreign promote -> 400 fx_assumption_required, status stays pending, zero quotes written.
  const unbound = await callRoute(pool, 'post', '/ventures/:id/quote-inbox/:itemId/promote', Object.assign({
    params: { id: 'v1', itemId }, body: { vendorName: 'EuroMold GmbH', unitPriceMicros: 10_000_000, currency: 'EUR' },
  }, alice));
  assert.equal(unbound.statusCode, 400);
  assert.equal(unbound.body.error, 'fx_assumption_required');
  assert.equal(state.inbox[0].status, 'pending');
  assert.equal(state.quotes.length, 0);

  // 3. Foreign owner gets 404 on list, promote, dismiss.
  assert.equal((await callRoute(pool, 'get', '/ventures/:id/quote-inbox', Object.assign({ params: { id: 'v1' } }, mallory))).statusCode, 404);
  assert.equal((await callRoute(pool, 'post', '/ventures/:id/quote-inbox/:itemId/promote', Object.assign({
    params: { id: 'v1', itemId }, body: { unitPriceMicros: 10_000_000, currency: 'EUR', fxAssumptionId: 'fx-eur-1' },
  }, mallory))).statusCode, 404);
  assert.equal((await callRoute(pool, 'post', '/ventures/:id/quote-inbox/:itemId/dismiss', Object.assign({
    params: { id: 'v1', itemId },
  }, mallory))).statusCode, 404);

  // 4. Bound foreign promote -> 201, exact EUR->USD conversion, filename + sha256 in quote notes, status promoted.
  const promoted = await callRoute(pool, 'post', '/ventures/:id/quote-inbox/:itemId/promote', Object.assign({
    params: { id: 'v1', itemId },
    body: { vendorName: 'EuroMold GmbH', unitPriceMicros: 10_000_000, currency: 'EUR', fxAssumptionId: 'fx-eur-1', moq: 500, leadTimeDays: 28, incoterm: 'FOB' },
  }, alice));
  assert.equal(promoted.statusCode, 201);
  assert.equal(promoted.body.item.status, 'promoted');
  assert.equal(promoted.body.item.promotedQuoteId, promoted.body.quote.id);
  assert.equal(promoted.body.quote.unitCostMicros, 10_000_000);
  assert.equal(promoted.body.quote.reportingUnitCostMicros, 10_850_000);
  assert.match(promoted.body.quote.notes, /euromold\.txt/);
  assert.ok(promoted.body.quote.notes.includes(attached.body.item.sha256));

  // 5. Double promote -> 409; dismiss already promoted -> 409.
  const dup = await callRoute(pool, 'post', '/ventures/:id/quote-inbox/:itemId/promote', Object.assign({
    params: { id: 'v1', itemId }, body: { unitPriceMicros: 10_000_000, currency: 'EUR', fxAssumptionId: 'fx-eur-1' },
  }, alice));
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.body.error, 'quote_inbox_already_promoted');

  const disPromoted = await callRoute(pool, 'post', '/ventures/:id/quote-inbox/:itemId/dismiss', Object.assign({
    params: { id: 'v1', itemId },
  }, alice));
  assert.equal(disPromoted.statusCode, 409);
  assert.equal(disPromoted.body.error, 'quote_inbox_already_promoted');

  // 6. Attach second item, dismiss it -> 200, then promote dismissed -> 409.
  const second = await callRoute(pool, 'post', '/ventures/:id/quote-inbox', Object.assign({
    params: { id: 'v1' }, body: { filename: 'spam.txt', textContent: 'Unit Price: $99.00' },
  }, alice));
  assert.equal(second.statusCode, 201);
  const dis = await callRoute(pool, 'post', '/ventures/:id/quote-inbox/:itemId/dismiss', Object.assign({
    params: { id: 'v1', itemId: second.body.item.id },
  }, alice));
  assert.equal(dis.statusCode, 200);
  assert.equal(dis.body.item.status, 'dismissed');
  const promoteDis = await callRoute(pool, 'post', '/ventures/:id/quote-inbox/:itemId/promote', Object.assign({
    params: { id: 'v1', itemId: second.body.item.id }, body: { vendorName: 'X', unitPriceMicros: 1_000_000, currency: 'USD' },
  }, alice));
  assert.equal(promoteDis.statusCode, 409);
  assert.equal(promoteDis.body.error, 'quote_inbox_dismissed');

  // 7. Zero bot calls and every SQL query touching venture_quote_inbox carried owner_sub.
  assert.equal(botCalls.length, 0);
  const inboxSql = state.calls.filter((c) => /venture_quote_inbox/.test(c.sql));
  assert.ok(inboxSql.length >= 6);
  for (const c of inboxSql) assert.match(c.sql, /owner_sub/);
});
