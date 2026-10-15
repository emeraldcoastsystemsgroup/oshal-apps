/**
 * Venture Plan - the plan computes with the channel and freight terms the analysts registered, in the units they
 * mean, and the console grades the ledger it shows.
 *
 * Live (2026-10-12 sweep 8, a clip-on reading light, 412x915): after bom, market and ops ran, publish was refused
 * with financials:break-even "Contribution is -33238730 micros per unit" at a $19.99 shelf price and a $20.53
 * landed cost, while the ledger held channel.dtc.terms = $12 per order. The default direct channel charged its
 * itemised stack ($20 acquisition, $9 shipping, $2 pick-pack, 2.9% + $0.30, 6% refunds, returns handling) whatever
 * was registered: 19,990,000 - 33,319,110 - 0.97 x 20,525,381 = -33,238,730, the live figure to the micro. The
 * landed cost carried $14 of freight and port charges on a $6.30 factory cost because every product shipped the
 * default 400 units of 0.05 CBM per container (a reproduction's ops analyst had registered its own
 * logistics.unitsPerContainer 2500 and logistics.cbPerUnit 0.0015, which nothing read). The ledger also held
 * channel.amazon.fulfillment-pct as 550000 "usd_micros" and compliance.fcc.cost as 3000 "usd": the analyst prompts
 * asked for "micros" in one line and plain dollars in the next, and the parser stored the unit as written.
 * The Assumptions tab said "0 of 36 registered assumptions are an estimate or an outright placeholder" beside
 * "model guess 34": the page tallied the engine ladder (quoted .. guessed) over rows carrying low/medium/high, and
 * its editor offered that ladder too, which PATCH refused ("unknown confidence", 400, live).
 * With the plan publishing, the Documents tab still listed all 17 stored documents as "not generated yet".
 *
 * Real: the compiled compose, channel engine, model, contract parser and routes, and the page's own functions
 * extracted from tools/venture.html. Doubles: the logger, the framework seams the route module imports, and a pool
 * that answers the venture and assumption rows (no database boundary is claimed here; the store's own SQL is proven
 * against PostgreSQL in venture-run-evidence-slots).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The registered cost per direct order is the waterfall's per-order charge (live -$33.24 contribution reproduced on the parent shape), the registered container fill is what the freight ships, analyst units are converted or refused, GET /assumptions answers each row's grade, and the console tallies and edits in the vocabulary the server speaks. A stored document is listed generated and openable: live after this fix the plan published and 17 documents were stored while the Documents tab showed every one "not generated yet" and disabled, because the catalogue GET /documents answers is keyed `key` and the list matched `docKey`.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const STUBS = {
  express: { Router: () => fakeRouter() },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) },
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
  '@/app/routes/caller-sub': { callerSub: (req) => (req && req.oidc && req.oidc.user && req.oidc.user.sub) || null },
  '@/features/agent-management': { BotNodeClient: class { hasEndpoint() { return false; } }, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => { throw new Error('no model call in this suite'); } },
};
const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};
const routesDir = path.join(PKG, 'routes');
const compose = require(path.join(routesDir, 'venture-store-compose.js'));
const channels = require(path.join(routesDir, 'venture-channels.js'));
const { buildVentureModel, withAssumption } = require(path.join(routesDir, 'venture-model.js'));
const { landedLeg } = require(path.join(routesDir, 'venture-landed.js'));
const contracts = require(path.join(routesDir, 'venture-bot-contracts.js'));
const types = require(path.join(routesDir, 'venture-types.js'));
const { createVentureRoutes } = require(path.join(routesDir, 'venture-routes.js'));

/** A router that records its registrations. */
function fakeRouter() {
  const routes = new Map();
  const reg = (m) => (p, h) => { routes.set(`${m} ${p}`, h); };
  return { routes, get: reg('get'), post: reg('post'), patch: reg('patch'), put: reg('put'), delete: reg('delete') };
}

const ON_DATE = '2026-10-12';
let seq = 0;
/** A stored assumption row as liveAssumptions returns it. */
function row(key, unit, valueNum, extra) {
  seq += 1;
  return { id: `a${seq}`, ventureId: 'v1', key, domain: 'channel', label: key, unit, valueNum, valueText: null,
    lowNum: valueNum, highNum: valueNum, sourceKind: 'model-estimate', sourceDetail: null, sourceUrl: null,
    confidence: 'medium', authoredBy: 'market-bot', runId: 'r1', supersededBy: null,
    createdAt: '2026-10-12T00:00:00.000Z', provenance: 'assumed', ...extra };
}

/** Compose the reading light from its ledger rows. */
function composeLight(rows) {
  return compose.composeModelInput({
    venture: { id: 'v1', ownerSub: 'alice', name: 'Reading light', ideaText: 'idea', spec: {}, currency: 'USD', horizonMonths: 36 },
    assumptions: rows, bomLines: [], vendors: [], headcount: [], scenario: null, onDate: ON_DATE,
  }).input;
}

const LIVE_LANDED_MICROS = 20_525_381;
const LEDGER = () => [
  row('channel.retail-price', 'micros', 19_990_000, { sourceKind: 'published-source', sourceUrl: 'https://example.com/listing' }),
  row('channel.dtc.terms', 'micros', 12_000_000, { lowNum: 9_000_000, highNum: 16_000_000 }),
];

/** The direct channel's waterfall at the live shelf price and landed cost. */
function liveWaterfall(channel) {
  return channels.forwardWaterfall({
    channel, landedUnitMicros: LIVE_LANDED_MICROS, pricing: { kind: 'fixed-shelf', shelfPriceMicros: 19_990_000 }, onDate: ON_DATE,
  });
}

test('the parent shape reproduces the live refusal: the itemised default stack, not the registered $12, gives -33,238,730', () => {
  const input = composeLight(LEDGER());
  const parent = JSON.parse(JSON.stringify(input.channels[0]));
  delete parent.economics.orderCostMicros;
  const w = liveWaterfall(parent);
  assert.equal(w.totalFeeMicros, 33_319_110);
  assert.equal(w.contributionPerUnitMicros, -33_238_730, 'the micros the live publish refusal named');
});

test('the registered cost per direct order is the one per-order charge the waterfall makes, and the sweep moves it', () => {
  const input = composeLight(LEDGER());
  const w = liveWaterfall(input.channels[0]);
  assert.deepEqual(w.steps.map((s) => [s.key, s.amountMicros]), [
    ['shelf-price', 19_990_000], ['returns-refund', -1_199_400], ['order-cost', -12_000_000], ['returns-handling', -240_000],
    ['landed-cost', -19_909_620],
  ]);
  // 19,990,000 - 13,439,400 - roundHalfUp(0.97 x 20,525,381) = -13,359,020: the price still does not cover the
  // landed cost here, which is a finding the plan states rather than a fee stack it invented.
  assert.equal(w.contributionPerUnitMicros, -13_359_020);
  assert.ok(w.marketingMicros === 0, 'the order cost is a channel charge, not marketing');
  const moved = withAssumption(input, 'channel.dtc.terms', 9_000_000);
  assert.equal(moved.channels[0].economics.orderCostMicros, 9_000_000, 'channel.dtc.terms is bound to the channel');
  assert.equal(channels.validateChannel(input.channels[0]).length, 0, 'orderCostMicros is a known economics field');
});

test('without a registered order cost the default channel keeps its itemised stack and names the key as missing', () => {
  const rows = LEDGER().filter((r) => r.key !== 'channel.dtc.terms');
  const out = compose.composeModelInput({
    venture: { id: 'v1', name: 'x', spec: {}, horizonMonths: 36 }, assumptions: rows, bomLines: [], vendors: [], headcount: [],
    scenario: null, onDate: ON_DATE,
  });
  assert.equal(out.input.channels[0].economics.orderCostMicros, undefined);
  assert.ok(out.missingAssumptionKeys.includes('channel.dtc.terms'));
  assert.equal(out.input.bindings.some((b) => b.assumptionId === 'channel.dtc.terms'), false);
});

test('the registered container fill is what the freight ships: 5,000 units at 2,500 a container is two containers', () => {
  const rows = [...LEDGER(),
    row('landed.freight.container-rate', 'micros', 3_500_000_000, { domain: 'logistics' }),
    row('landed.freight.units-per-container', 'units', 2500, { domain: 'logistics', lowNum: 2000, highNum: 3000 }),
    row('landed.freight.cbm-per-unit', 'cbm', 0.0015, { domain: 'logistics', lowNum: 0.001, highNum: 0.002 }),
  ];
  const input = composeLight(rows);
  assert.equal(input.runQtyUnits, 5000);
  const model = buildVentureModel(input);
  assert.equal(model.landed.containers, 2);
  assert.equal(landedLeg(model.landed, 'oceanFreight').totalMicros, 7_000_000_000);
  assert.ok(model.landed.assumptionRefs.includes('landed.freight.units-per-container'));
  // The parent shape: the default fill ships 13 containers for the same run.
  const parent = composeLight(rows.filter((r) => !r.key.startsWith('landed.freight.units') && !r.key.startsWith('landed.freight.cbm')));
  assert.equal(buildVentureModel(parent).landed.containers, 13);
  assert.ok(compose.missingKeys(parent).includes('landed.freight.units-per-container'), 'an unregistered fill is named, not assumed');
});

test('an analyst\'s unit is converted to the ledger unit, and a percentage is never stored as money', () => {
  const reply = JSON.stringify({ assumptions: [
    { key: 'compliance.fcc.cost', domain: 'compliance', label: 'FCC test', unit: 'usd', valueNum: 3000, lowNum: 2000, highNum: 5000,
      sourceKind: 'model-estimate', sourceDetail: 'lab rate card', sourceUrl: null, confidence: 'low' },
    { key: 'channel.amazon.referral-pct', domain: 'channel', label: 'Referral', unit: 'pct', valueNum: 15, lowNum: 8, highNum: 15,
      sourceKind: 'model-estimate', sourceDetail: 'fee schedule', sourceUrl: null, confidence: 'medium' },
    { key: 'channel.amazon.fulfillment-pct', domain: 'channel', label: 'FBA', unit: 'usd_micros', valueNum: 550000, lowNum: 400000, highNum: 700000,
      sourceKind: 'model-estimate', sourceDetail: 'as live', sourceUrl: null, confidence: 'medium' },
    { key: 'logistics.distance', domain: 'channel', label: 'odd', unit: 'furlongs', valueNum: 3, lowNum: 2, highNum: 4,
      sourceKind: 'model-estimate', sourceDetail: 'x', sourceUrl: null, confidence: 'low' },
    { key: 'channel.amazon.returns', domain: 'channel', label: 'Returns', unit: 'ratio', valueNum: 0.05, lowNum: 0.03, highNum: 0.08,
      sourceKind: 'model-estimate', sourceDetail: 'category', sourceUrl: null, confidence: 'medium' },
  ] });
  const out = contracts.parseAssumptionOutput(reply);
  assert.equal(out.ok, true);
  const byKey = Object.fromEntries(out.rows.map((r) => [r.key, r]));
  assert.deepEqual([byKey['compliance.fcc.cost'].unit, byKey['compliance.fcc.cost'].valueNum, byKey['compliance.fcc.cost'].lowNum],
    ['micros', 3_000_000_000, 2_000_000_000]);
  assert.deepEqual([byKey['channel.amazon.referral-pct'].unit, byKey['channel.amazon.referral-pct'].valueNum], ['bps', 1500]);
  assert.deepEqual([byKey['channel.amazon.returns'].unit, byKey['channel.amazon.returns'].valueNum], ['ratio', 0.05]);
  assert.equal(byKey['channel.amazon.fulfillment-pct'], undefined);
  assert.equal(byKey['logistics.distance'], undefined);
  assert.deepEqual(out.rejected, [
    'key channel.amazon.fulfillment-pct: names a percentage but is stated in "usd_micros"',
    'key logistics.distance: unknown unit "furlongs"',
  ]);
});

/** A pool that owns venture v1 for alice and answers its assumption rows. */
function poolWith(assumptionRows) {
  return {
    query: async (sql, params) => {
      if (/FROM venture_ventures/.test(sql)) {
        return params.includes('alice') ? { rows: [{ id: 'v1', owner_sub: 'alice', name: 'Light', idea_text: 'an idea about a light', spec: {},
          currency: 'USD', target_launch_date: null, stage: 'scoped', horizon_months: 36, open_questions: [], created_at: new Date(0),
          updated_at: new Date(0) }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (/FROM venture_assumptions/.test(sql)) return { rows: assumptionRows, rowCount: assumptionRows.length };
      return { rows: [], rowCount: 0 };
    },
    connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
  };
}
/** A stored row as the table holds it. */
function dbRow(key, sourceKind, confidence, authoredBy) {
  return { id: `id-${key}`, venture_id: 'v1', key, domain: 'channel', label: key, unit: 'micros', value_num: '1000000', value_text: null,
    low_num: null, high_num: null, source_kind: sourceKind, source_detail: null, source_url: null, confidence,
    authored_by: authoredBy, run_id: null, superseded_by: null, created_at: new Date(0) };
}
/** Call one registered route handler. */
async function call(pool, method, route, req) {
  const handler = createVentureRoutes({ pool, appPackageDir: PKG, orchestrator: {} }).routes.get(`${method} ${route}`);
  assert.ok(handler, `${method} ${route} is registered`);
  const res = { statusCode: 200, body: null };
  res.status = (n) => { res.statusCode = n; return res; };
  res.json = (o) => { res.body = o; return res; };
  await handler({ body: {}, query: {}, originalUrl: route, oidc: { user: { sub: 'alice' } }, ...req }, res);
  return res;
}

const STORED = [
  dbRow('a.guess', 'model-estimate', 'low', 'market-bot'), dbRow('b.estimate', 'model-estimate', 'medium', 'market-bot'),
  dbRow('c.published', 'published-source', 'high', 'market-bot'), dbRow('d.quote', 'vendor-quote', 'high', 'user:alice'),
  dbRow('e.mine', 'user-entered', 'high', 'user:alice'),
];

test('GET /assumptions and the history answer each row\'s grade on the engine ladder', async () => {
  const res = await call(poolWith(STORED), 'get', '/ventures/:id/assumptions', { params: { id: 'v1' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.assumptions.map((a) => [a.key, a.confidence, a.grade]), [
    ['a.guess', 'low', 'guessed'], ['b.estimate', 'medium', 'estimated'], ['c.published', 'high', 'benchmarked'],
    ['d.quote', 'high', 'quoted'], ['e.mine', 'high', 'observed'],
  ]);
  const hist = await call(poolWith([STORED[0]]), 'get', '/ventures/:id/assumptions/:key/history', { params: { id: 'v1', key: 'a.guess' } });
  assert.equal(hist.body.revisions[0].grade, 'guessed');
});

/* ── the page's own functions ─────────────────────────────────────────────── */
const html = fs.readFileSync(path.join(PKG, 'tools', 'venture.html'), 'utf8');
/** The source of one `function name(...) { ... }` in the page, matched by braces. */
function fnSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `venture.html defines ${name}`);
  let depth = 0;
  for (let i = html.indexOf('{', start); i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    else if (html[i] === '}') { depth -= 1; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(`unbalanced ${name}`);
}
/** The page's `var NAME = ...;` declaration, up to its closing semicolon at depth zero. */
function varSource(name) {
  const start = html.indexOf(`var ${name} =`);
  assert.ok(start >= 0, `venture.html declares ${name}`);
  let depth = 0;
  for (let i = start; i < html.length; i += 1) {
    const c = html[i];
    if (c === '[' || c === '{' || c === '(') depth += 1;
    else if (c === ']' || c === '}' || c === ')') depth -= 1;
    else if (c === ';' && depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}
const PAGE_VARS = ['CONFIDENCE', 'CONFIDENCE_NOTE', 'SOURCE_KINDS', 'EDIT_SOURCE_KINDS', 'STORE_CONFIDENCE', 'STORE_CONFIDENCE_NOTE', 'SOURCE_LABEL'];
const PAGE_FNS = ['esc', 'isNum', 'normAssumption', 'gradeOf', 'domainOf', 'sourceDetailOf', 'ledgerTallies', 'ledgerSummaryHtml',
  'confVar', 'assumptionEditorHtml', 'drawerHead'];
/** The page's functions over a state object. */
function page(S) {
  const body = `${PAGE_VARS.map(varSource).join('\n')}\n${PAGE_FNS.map(fnSource).join('\n')}
    return { normAssumption, ledgerTallies, ledgerSummaryHtml, assumptionEditorHtml };`;
  return new Function('S', body)(S);
}

test('the ledger banner counts the model guesses the server grades, not zero', async () => {
  const res = await call(poolWith(STORED), 'get', '/ventures/:id/assumptions', { params: { id: 'v1' } });
  const S = { assumptions: [] };
  const p = page(S);
  S.assumptions = res.body.assumptions.map(p.normAssumption);
  const t = p.ledgerTallies();
  assert.equal(t.soft, 2, 'one guessed and one estimated');
  assert.deepEqual([t.byConf.quoted, t.byConf.observed, t.byConf.benchmarked, t.byConf.estimated, t.byConf.guessed], [1, 1, 1, 1, 1]);
  const banner = p.ledgerSummaryHtml();
  assert.match(banner, /<b>2 of 5<\/b> registered assumptions are an estimate or an outright placeholder/);
  assert.match(banner, /banner warn/);
  assert.match(banner, /published 1/);
  assert.match(banner, /you 1/);
  // The parent shape: rows without a grade and only low/medium/high counted nothing soft.
  const parent = res.body.assumptions.map((a) => ({ ...a, grade: undefined }));
  S.assumptions = parent.map(p.normAssumption);
  assert.equal(p.ledgerTallies().soft, 5, 'a row the page cannot grade is shown as a guess, never as evidence');
});

test('the assumption editor writes the confidence and source the server accepts', async () => {
  const res = await call(poolWith(STORED), 'get', '/ventures/:id/assumptions', { params: { id: 'v1' } });
  const S = { assumptions: [] };
  const p = page(S);
  const guess = p.normAssumption(res.body.assumptions[1]);
  const editor = p.assumptionEditorHtml(guess, { label: 'US dollars', note: '.', toUi: (v) => v / 1e6 });
  const options = (id) => {
    const select = editor.slice(editor.indexOf(`<select id="${id}">`), editor.indexOf('</select>', editor.indexOf(`<select id="${id}">`)));
    return [...select.matchAll(/<option value="([^"]+)"( selected)?/g)].map((m) => [m[1], Boolean(m[2])]);
  };
  const conf = options('a_conf');
  assert.deepEqual(conf.map(([v]) => v), ['high', 'medium', 'low']);
  assert.ok(conf.every(([v]) => types.isConfidence(v)), 'every confidence the editor offers is one PATCH accepts');
  assert.deepEqual(conf.filter(([, s]) => s).map(([v]) => v), ['medium'], 'the row\'s own confidence is preselected');
  const kinds = options('a_kind');
  assert.deepEqual(kinds.map(([v]) => v), ['user-entered', 'published-source']);
  assert.ok(kinds.every(([v]) => types.isSourceKind(v)));
});

/** A stored document row as venture_documents holds it. */
function docRow(docKey, version) {
  return { id: `doc-${docKey}`, venture_id: 'v1', doc_key: docKey, version, model_id: 'm1', title: docKey, body_md: '# x',
    sections: [], prose_run_id: null, prose_status: 'none', unverified_numbers: [], assumptions_cited: [], estimate_pct: 90,
    created_at: new Date('2026-10-12T17:40:00Z') };
}

test('a stored document is listed as generated and can be opened, from the catalogue GET /documents answers', async () => {
  const pool = poolWith([]);
  const inner = pool.query;
  pool.query = async (sql, params) => (/FROM venture_documents/.test(sql)
    ? { rows: [docRow('executive-summary', 2), docRow('bill-of-materials', 1)], rowCount: 2 } : inner(sql, params));
  const res = await call(pool, 'get', '/ventures/:id/documents', { params: { id: 'v1' } });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.catalog.length >= 17);
  const S = { documents: res.body.documents, catalog: [], doc: null };
  const fns = new Function('S', `${['esc', 'normCatalogEntry', 'docListHtml'].map(fnSource).join('\n')}
    return { normCatalogEntry, docListHtml };`)(S);
  S.catalog = res.body.catalog.map(fns.normCatalogEntry);
  const items = [...fns.docListHtml().matchAll(/<button class="docitem[^"]*" type="button" data-doc="([^"]*)"( disabled)?><b>([^<]*)<\/b><span class="meta">([^<]*)</g)]
    .map((m) => ({ key: m[1], disabled: Boolean(m[2]), title: m[3], meta: m[4] }));
  assert.equal(items.length, res.body.catalog.length);
  const exec = items.find((i) => i.key === 'executive-summary');
  assert.deepEqual([exec.disabled, exec.meta], [false, 'v2 · 2026-10-12'], 'a stored document opens and names its version and date');
  assert.equal(items.find((i) => i.key === 'bill-of-materials').disabled, false);
  assert.equal(items.filter((i) => !i.disabled).length, 2);
  assert.equal(items.find((i) => i.key === 'funding-ask').meta, 'not generated yet');
});
