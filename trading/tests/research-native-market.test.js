/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the SHIPPED research routes on a host with no market-data rail (the native kernel's bridge: a rail whose configured() is false and whose reads reject with TradingError 503 market_data_not_connected). GET /research/NVDA prices the quote from the World archive (prices.latest through ctx.intent) and labels it a stored price with its own time, keeps the SEC filings it can read, and names the reason for each unavailable section; a ticker the archive does not track says so; the watchlist carries archive prices; GET /status carries the host's broker and market-data reasons; and no shipped surface tells the person to set Alpaca keys. The page's Major events card shows the 8-K events the filings read decoded instead of always "unavailable". Red on the previous sources (quote null with no reason, bare "unavailable", set-the-keys advice, events never shown).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');

const NO_MD = 'No market-data source is connected on this installation: oshal has no Alpaca connector, and the native runtime does not read quotes, bars, fundamentals or news through the Schwab connection.';
const NO_BROKER = 'No broker rail is connected on this installation: oshal has no Alpaca connector.';
const silent = { info() {}, warn() {}, error() {}, debug() {}, child() { return silent; } };

/** The platform route error, as the native bridge now serves it. */
class TradingError extends Error {
  constructor(httpStatus, code, message) { super(message); this.httpStatus = httpStatus; this.code = code; }
}
const refuse = () => Promise.reject(new TradingError(503, 'market_data_not_connected', NO_MD));
/** A not-connected rail shaped like the bridge's (trading_market.js). */
const rail = (reason) => ({ kind: 'none', configured: () => false, notConnectedReason: reason, latestTrade: refuse, latestPrice: refuse, dailyCloses: refuse, getAccount: refuse, getPositions: refuse });

const STAND_INS = {
  '@/shared/logger': { createChildLogger: () => silent },
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => undefined },
  '@/app/routes/trading-routes-helpers': { callerSub: (req) => req.oshalCallerSub || null, resolveBook: async () => ({ kind: 'paper', ref: 'paper', bookId: 'b1', enabled: true }),
    resolveMode: () => 'paper', guardrails: () => ({}), servePage: () => () => undefined, TradingError },
  '@/features/trading': { getMarketData: () => rail(NO_MD), getBrokerReader: () => rail(NO_BROKER), fundamentalsSummary: refuse, recentNews: refuse,
    searchSymbols: refuse, marketDataConfigured: () => false, liveTradingEnabled: () => false, DEFAULT_UNIVERSE: ['NVDA'] },
  '@/features/world-data': { createWorldIntelligenceService: () => null },
  '@/app/trading-schema': { ensureTradingSchema: async () => undefined },
};
const standIn = (request) => new Proxy(STAND_INS[request] || {}, {
  get: (target, key) => (key in target ? target[key] : key === '__esModule' ? true : () => undefined),
});

/**
 * @description Load the shipped research routes with the platform imports stood in.
 * @param {object} ctx - Route context.
 * @returns {Map<string, Function>} GET path → handler.
 */
function shippedResearch(ctx, tradingOverride) {
  const original = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === '@/features/trading' && tradingOverride) return {...STAND_INS[request],...tradingOverride};
    return request.startsWith('@/') ? standIn(request) : original.call(this, request, ...rest);
  };
  try {
    const dir = path.join(__dirname, '..', 'routes');
    for (const key of Object.keys(require.cache)) if (key.startsWith(dir)) delete require.cache[key];
    const routes = new Map();
    const router = { get: (p, fn) => routes.set(p, fn), post() {}, patch() {}, delete() {}, use() {} };
    require('../routes/trading-research-routes').registerTradingResearchRoutes(router, ctx);
    return routes;
  } finally {
    Module._load = original;
  }
}

/** Call one handler like the runner's simulated request. */
async function call(routes, p, params = {}, query = {}) {
  const out = { code: 200, body: null };
  const res = { status(c) { out.code = c; return res; }, json(b) { out.body = b; return res; } };
  await routes.get(p)({ oshalCallerSub: 'research-alice', params, query, headers: {}, body: {} }, res);
  return out;
}

/** The kernel's prices.latest: NVDA stored Friday's close; anything else is missing. */
const archive = async (name, input) => {
  assert.equal(name, 'prices.latest');
  const prices = input.symbols.includes('NVDA') ? [{ symbol: 'NVDA', at: '2026-10-09T20:00:00Z', price: 191.25, volume: 1 }] : [];
  return { prices, missing: input.symbols.filter((s) => s !== 'NVDA'), readAt: '2026-10-11T12:00:00Z' };
};

/** EDGAR over the egress: the ticker table and NVIDIA's submissions. */
function edgar(t) {
  const original = global.fetch;
  global.fetch = async (url) => {
    const body = /company_tickers/.test(url) ? { 0: { cik_str: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' } }
      : { cik: '1045810', filings: { recent: { form: ['10-Q', '8-K'], filingDate: ['2026-08-27', '2026-08-27'], reportDate: ['2026-07-27', ''],
        accessionNumber: ['0001045810-26-000100', '0001045810-26-000099'], primaryDocument: ['nvda-q2.htm', 'nvda-8k.htm'], items: ['', '2.02,9.01'] } } };
    return { ok: true, status: 200, json: async () => body };
  };
  t.after(() => { global.fetch = original; });
}

test('research prices from the archive, keeps the filings, and names each unavailable section\'s reason', async (t) => {
  edgar(t);
  const routes = shippedResearch({ pool: { query: async () => ({ rows: [] }) }, intent: archive });
  const r = await call(routes, '/research/:symbol', { symbol: 'NVDA' });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.sections.quote, r.body.quote.price, r.body.quote.asOf, r.body.quote.source], ['ok', 191.25, '2026-10-09T20:00:00.000Z', 'world-archive']);
  assert.match(r.body.quote.note, /not a live quote/);
  assert.equal(r.body.sections.filings, 'ok');
  assert.equal(r.body.filings.latest10Q.form, '10-Q');
  for (const name of ['fundamentals', 'news']) {
    assert.equal(r.body.sections[name], 'unavailable');
    assert.equal(r.body.reasons[name], NO_MD);
  }
});

test('a ticker the archive does not track, and a host without the archive, say so', async (t) => {
  edgar(t);
  const routes = shippedResearch({ pool: { query: async () => ({ rows: [] }) }, intent: archive });
  const missing = await call(routes, '/research/:symbol', { symbol: 'ZZZZ' });
  assert.equal(missing.body.sections.quote, 'unavailable');
  assert.match(missing.body.reasons.quote, /World price archive has no stored price for ZZZZ/);
  const bare = shippedResearch({ pool: { query: async () => ({ rows: [] }) } });
  const none = await call(bare, '/research/:symbol', { symbol: 'NVDA' });
  assert.deepEqual([none.body.sections.quote, none.body.reasons.quote], ['unavailable', NO_MD]);
});

test('the watchlist carries the archive\'s stored price, labelled', async () => {
  const pool = { query: async (text) => ({ rows: /FROM oshal_trading_watchlist/.test(text) ? [{ symbol: 'NVDA', note: null, added_at: '2026-10-01T00:00:00Z' }] : [] }) };
  const routes = shippedResearch({ pool, intent: archive });
  const w = await call(routes, '/watchlist');
  assert.equal(w.code, 200, JSON.stringify(w.body));
  assert.deepEqual([w.body.items[0].quote.price, w.body.items[0].quote.source], [191.25, 'world-archive']);
});

test('no shipped Trading surface tells the person to set Alpaca keys this installation cannot hold', () => {
  const root = path.join(__dirname, '..');
  const files = ['tools/ui/view-account.js', 'routes/trading-charts-routes.js', 'src-routes/trading-charts-routes.ts'];
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /Set the Alpaca paper keys/, f);
  assert.match(fs.readFileSync(path.join(root, 'tools/ui/view-account.js'), 'utf8'), /STATUS\.brokerReason/);
  const research = fs.readFileSync(path.join(root, 'tools/ui/view-research.js'), 'utf8');
  assert.match(research, /j\.reasons\[name\]/, 'each unavailable section prints its reason');
  assert.match(fs.readFileSync(path.join(root, 'tools/ui/symbol-search.js'), 'utf8'), /function ssNotice/, 'a failed search says why');
});

test('the page prints a section\'s reason, and Major events follow the filings read they come from', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'ui', 'view-research.js'), 'utf8');
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ctx = vm.createContext({ esc, fmtDate: String, money: (n) => '$' + n, pct: String, st: () => '', bookLabel: String, DISP: 'Paper', Date });
  vm.runInContext(src + '\nthis.page = { researchEventsHtml, researchNewsHtml, researchTopHtml };', ctx);
  const report = { symbol: 'NVDA', sections: { filings: 'ok', news: 'unavailable', quote: 'unavailable' }, reasons: { news: NO_MD, quote: NO_MD },
    events: [{ date: '2026-08-26', kind: 'earnings', label: 'Results of operations (earnings)', url: 'https://www.sec.gov/x.htm' }] };
  assert.match(ctx.page.researchEventsHtml(report), /Results of operations \(earnings\)/);
  assert.match(ctx.page.researchNewsHtml(report), /unavailable &mdash; No market-data source is connected/);
  assert.match(ctx.page.researchTopHtml(report), /quote unavailable &mdash; No market-data source/);
});


test('connected native research and watchlists retain Schwab timestamps, delay and prior-close changes',async t => {
  edgar(t);
  const stamp='2026-10-14T15:00:00Z';
  const q={symbol:'NVDA',price:125,priorClose:100,tradeAt:stamp,quoteAt:stamp,delayed:true};
  const md={kind:'schwab',configured:()=>true,quoteDetails:async()=>q,quotes:async()=>[q],latestTrade:async()=>{throw Error('native quote metadata must be preserved');}};
  const ctx={pool:{query:async text => ({rows:/FROM oshal_trading_watchlist/.test(text) ? [{symbol:'NVDA',note:null,added_at:stamp}] : []})},intent:async()=>{throw Error('connected reads must not fall back to the World archive');}};
  const routes=shippedResearch(ctx,{getMarketData:()=>md,nativeSchwabReads:true});
  const research=await call(routes,'/research/:symbol',{symbol:'NVDA'});
  assert.equal(research.code,200,JSON.stringify(research.body));
  assert.deepEqual(research.body.quote,{price:125,asOf:stamp,source:'schwab',note:'Delayed Schwab quote.'});
  const watchlist=await call(routes,'/watchlist');
  assert.equal(watchlist.body.items[0].quote.dayChangePct,25);
  assert.equal(watchlist.body.items[0].quote.asOf,stamp);
  assert.equal(watchlist.body.items[0].quote.source,'schwab');
  const src=fs.readFileSync(path.join(__dirname,'../tools/ui/view-research.js'),'utf8');
  const esc=v=>String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const ui=vm.createContext({esc,fmtDate:String,money:String,bookLabel:String,DISP:'Paper'});
  vm.runInContext(src+'\nthis.render=researchTopHtml;',ui);
  assert.match(ui.render(research.body),/Delayed Schwab quote/);
});
