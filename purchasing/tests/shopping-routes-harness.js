/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — load the COMPILED Shopping route module (the bytes the framework mounts) with every framework import stubbed, an in-memory pool that answers exactly the SQL the cart, list, checkout and chat routes issue, and a recording Walmart provider. Shared by the route suite and the browser smoke's fixture (which passes the framework's real express so the same compiled router serves real HTTP); not a suite itself (no .test.js name, so the package glob never runs it).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Native admission double: admittedPool applies the native host's rule (crates/packages/src/sql_transaction.rs) to every statement, so while callAdmitted runs a GET only a query or idempotent table setup reaches the pool and any other statement is refused with the host's own message. The in-memory pool also answers the remaining GET reads (lists, list items, the latest conversation) and POST /lists, so a suite can walk every GET route a fresh shopper can open.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const ROUTE_FILE = path.join(PKG, 'routes', 'purchasing-routes.js');

/** Catalog rows shaped like the core Walmart provider's normalize() output. */
const CATALOG = [
  { retailer: 'walmart', productId: '10450115', title: 'Great Value 2% Reduced Fat Milk, 1 Gallon', brand: 'Great Value', price: 2.78, imageUrl: '', productUrl: 'https://www.walmart.com/ip/10450115' },
  { retailer: 'walmart', productId: '44390948', title: 'Fresh Bananas, each', brand: 'Fresh', price: 0.24, imageUrl: '', productUrl: 'https://www.walmart.com/ip/44390948' },
  { retailer: 'walmart', productId: '15206353', title: 'Folgers Classic Roast Ground Coffee, 25.9 oz', brand: 'Folgers', price: 8.98, imageUrl: '', productUrl: 'https://www.walmart.com/ip/15206353' },
];

/** An in-memory pool answering the Shopping route SQL; every statement is recorded. */
function fakePool(seed = {}) {
  const t = { lists: [...(seed.lists || [])], items: [...(seed.items || [])], history: [], messages: [], conversations: [], feedback: [], prefs: [] };
  const sql = [];
  let n = 0;
  const id = (p) => `${p}-${++n}`;
  const rows = (r) => ({ rows: r, rowCount: r.length });
  const handlers = [
    [/^SELECT 1 FROM shop_lists WHERE list_id = \$1 AND user_sub = \$2/, (p) => rows(t.lists.filter((l) => l.list_id === p[0] && l.user_sub === p[1]).map(() => ({ '?column?': 1 })))],
    [/^SELECT list_id FROM shop_lists WHERE user_sub = \$1 AND status = 'active'/, (p) => rows(t.lists.filter((l) => l.user_sub === p[0] && l.status === 'active').slice(0, 1))],
    [/^INSERT INTO shop_lists \(user_sub, name\) VALUES \(\$1, 'My List'\)/, (p) => { const l = { list_id: id('list'), user_sub: p[0], status: 'active' }; t.lists.push(l); return rows([l]); }],
    [/^INSERT INTO shop_lists \(user_sub, name\) VALUES \(\$1, \$2\)/, (p) => { const l = { list_id: id('list'), user_sub: p[0], name: p[1], status: 'active' }; t.lists.push(l); return rows([l]); }],
    [/^SELECT l\.list_id, l\.name, l\.status, l\.created_at,/, (p) => rows(t.lists.filter((l) => l.user_sub === p[0]).map((l) => ({ ...l, item_count: String(t.items.filter((i) => i.list_id === l.list_id && i.status === 'pending').length) })))],
    [/^SELECT \* FROM shop_list_items WHERE list_id = \$1 AND user_sub = \$2 AND status != 'removed'/, (p) => rows(t.items.filter((i) => i.list_id === p[0] && i.user_sub === p[1] && i.status !== 'removed'))],
    [/^SELECT conversation_id FROM shop_conversations WHERE user_sub = \$1 ORDER BY updated_at DESC/, (p) => rows(t.conversations.filter((c) => c.user_sub === p[0]).slice(0, 1))],
    [/^INSERT INTO shop_list_items/, (p) => { const r = { item_id: id('item'), list_id: p[0], user_sub: p[1], retailer: p[2], product_id: p[3], title: p[4], brand: p[5], image_url: p[6], product_url: p[7], quantity: p[8], unit_price: p[9] === null ? null : Number(p[9]).toFixed(2), reason: p[10], status: 'pending' }; t.items.push(r); return rows([r]); }],
    [/^INSERT INTO shop_preferences/, (p) => { t.prefs.push(p); return rows([]); }],
    [/^SELECT \* FROM shop_list_items WHERE list_id = \$1 AND user_sub = \$2 AND status = 'pending'/, (p) => rows(t.items.filter((i) => i.list_id === p[0] && i.user_sub === p[1] && i.status === 'pending'))],
    [/^SELECT product_id, title, quantity, unit_price FROM shop_list_items/, (p) => rows(t.items.filter((i) => i.list_id === p[0] && i.user_sub === p[1] && i.status === 'pending'))],
    [/^INSERT INTO shop_purchase_history/, (p) => { t.history.push({ user_sub: p[0], order_ref: p[1], items: p[2], total: p[3], handoff_url: p[4] }); return rows([]); }],
    [/^SELECT 1 FROM shop_conversations/, () => rows([])],
    [/^INSERT INTO shop_conversations/, (p) => { const c = { conversation_id: id('conv'), user_sub: p[0] }; t.conversations.push(c); return rows([c]); }],
    [/^INSERT INTO shop_messages/, (p) => { t.messages.push({ conversation_id: p[0], role: /'assistant'/.test(sql[sql.length - 1].text) ? 'assistant' : 'user', content: p[2] }); return rows([]); }],
    [/^SELECT role, content FROM shop_messages/, () => rows([])],
    [/^SELECT item_key, title, brand, retailer, last_unit_price, buy_count\s+FROM shop_preferences/, () => rows([])],
    [/^SELECT note FROM shop_feedback/, () => rows([])],
    [/^INSERT INTO shop_feedback/, (p) => { t.feedback.push(p[1]); return rows([]); }],
    [/^SELECT \* FROM shop_profile/, () => rows([])],
    [/^SELECT item_key, title, brand, retailer, product_id, last_unit_price, buy_count, updated_at/, () => rows([])],
    [/^UPDATE shop_conversations SET updated_at/, () => rows([])],
    [/^SELECT 1 FROM oshal_connections WHERE provider='walmart'/, () => rows([])],
    [/^SELECT item_key, retailer, product_id, title, brand, last_quantity/, () => rows([])],
  ];
  return {
    tables: t, sql,
    async query(text, params = []) {
      const s = String(text).trim();
      sql.push({ text: s, params });
      const hit = handlers.find(([re]) => re.test(s));
      if (!hit) throw new Error(`fake pool cannot answer: ${s.slice(0, 90)}`);
      return hit[1](params);
    },
  };
}

/** A Walmart provider double: `search` answers from CATALOG (or an override), `cart` builds a link. */
function fakeProvider(overrides = {}) {
  const calls = [];
  async function run(args) {
    calls.push([...args]);
    if (overrides[args[0]]) return overrides[args[0]](args);
    if (args[0] === 'search') {
      const q = String(args[1]).toLowerCase();
      const hits = CATALOG.filter((c) => c.productId === args[1] || c.title.toLowerCase().includes(q));
      return { source: 'walmart', items: hits };
    }
    if (args[0] === 'cart') return { source: 'walmart', checkoutUrl: `https://affil.walmart.com/cart/addToCart?items=${encodeURIComponent(args[1])}` };
    return {};
  }
  return { calls, run };
}

/**
 * @description Load the compiled route module with stubbed framework imports and return its handlers.
 * @param {{ pool?: object, provider?: object, reply?: object|Function, express?: object }} opts - `express`:
 *   a real express module (the browser fixture's), so the compiled router is a real Router; `reply`:
 *   the concierge's JSON envelope, or a function of the prompt returning one.
 * @returns {{ handlers: object, pool: object, provider: object, orchestratorCalls: string[], router: object }}
 */
function loadRoutes(opts = {}) {
  const handlers = { get: new Map(), post: new Map(), delete: new Map() };
  const pool = opts.pool || fakePool();
  const provider = opts.provider || fakeProvider();
  const orchestratorCalls = [];
  const router = {
    get(p, h) { handlers.get.set(p, h); return this; },
    post(p, h) { handlers.post.set(p, h); return this; },
    delete(p, h) { handlers.delete.set(p, h); return this; },
    use() { return this; },
  };
  const stubs = {
    express: opts.express || { Router: () => router },
    path,
    crypto: { randomUUID: () => 'test-uuid' },
    './cart-totals': require(path.join(PKG, 'routes', 'cart-totals.js')),
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
    '@/shared/middleware/authz': { getTrustedServiceUserSub: () => undefined },
    '@/app/routes/connector-token-broker': { resolveServerOperationCreds: async () => ({ OSHAL_CRED_WALMART: 'request-credential' }) },
    '@/app/routes/provider-operation-clients': { runWalmartProviderOperation: async (_cred, args) => provider.run(args) },
    '@/app/routes/concierge-reply': { cleanConciergeReply: (t, fb) => (typeof t === 'string' && t.trim() ? t : (fb || '')) },
  };
  const shimRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    throw new Error(`unexpected require in purchasing route module: ${request}`);
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', fs.readFileSync(ROUTE_FILE, 'utf8'))(
    shimRequire, mod, mod.exports, ROUTE_FILE, path.dirname(ROUTE_FILE));
  const orchestrator = {
    async processMessage(_id, prompt) {
      orchestratorCalls.push(prompt);
      const reply = typeof opts.reply === 'function' ? opts.reply(prompt) : opts.reply;
      return { response: JSON.stringify(reply || { say: 'ok' }) };
    },
  };
  const mounted = mod.exports.createPurchasingRoutes({ pool, appPackageDir: PKG, orchestrator });
  return { handlers, pool, provider, orchestratorCalls, exports: mod.exports, router: mounted };
}

/** A recording response. */
function fakeRes() {
  return {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
    sendFile(b) { this.body = b; return this; },
  };
}

/** A signed-in shopper request. */
const authed = (sub, extra = {}) => ({ oidc: { isAuthenticated: () => true, user: { sub } }, query: {}, body: {}, params: {}, path: '/', ...extra });
/** An anonymous request. */
const anon = (extra = {}) => ({ oidc: { isAuthenticated: () => false }, query: {}, body: {}, params: {}, path: '/', ...extra });

/** Run one registered handler and return the recording response. */
async function call(handlers, method, route, req) {
  const handler = handlers[method].get(route);
  if (!handler) throw new Error(`no ${method.toUpperCase()} ${route} registered`);
  const res = fakeRes();
  await handler(req, res);
  return res;
}

/** A statement the native host runs under read admission: a query. */
const READ_STATEMENT = /^\s*(?:SELECT|WITH|VALUES|TABLE)\b/i;
/** Idempotent table setup, which read admission also allows (a reader's lazy declaration). */
const IDEMPOTENT_DDL = /^\s*CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\b/i;
/** The native host's refusal, verbatim (crates/packages/src/sql_transaction.rs). */
const WRITER_REFUSAL = 'SQL mutation requires original writer admission';

/**
 * @description Wrap a pool in the native host's admission rule. In 'read' mode (a GET) a statement that is
 * not a query or idempotent table setup is refused before it reaches the pool, exactly as the native
 * package host refuses it, and is recorded in `refused`; in 'write' mode every statement passes.
 * @param {object} pool - The pool the routes would otherwise use.
 * @param {() => (string|undefined)} [modeOf] - Per-request mode for a server that runs requests concurrently
 *   (the browser fixture resolves it from AsyncLocalStorage); falls back to `mode`.
 * @returns {object} A pool with `mode`, `refused`, `tables` and `sql`.
 */
function admittedPool(pool, modeOf = () => undefined) {
  const admitted = {
    mode: 'write', refused: [], tables: pool.tables, sql: pool.sql,
    async query(text, params) {
      const statement = String(text && typeof text === 'object' ? text.text : text);
      const mode = modeOf() || admitted.mode;
      if (mode === 'read' && !READ_STATEMENT.test(statement) && !IDEMPOTENT_DDL.test(statement)) {
        admitted.refused.push(statement.trim().replace(/\s+/g, ' ').slice(0, 120));
        throw new Error(`refused: ${WRITER_REFUSAL}`);
      }
      return pool.query(text, params);
    },
  };
  return admitted;
}

/**
 * @description Run one handler the way the native host admits it: a GET read-only, every other method
 * as a writer.
 * @param {object} handlers - From loadRoutes.
 * @param {object} pool - An admittedPool the routes were loaded with.
 * @param {string} method - 'get' | 'post' | 'delete'.
 * @param {string} route - The registered route path.
 * @param {object} req - The request.
 * @returns {Promise<object>} The recording response.
 */
async function callAdmitted(handlers, pool, method, route, req) {
  pool.mode = method === 'get' ? 'read' : 'write';
  try { return await call(handlers, method, route, req); } finally { pool.mode = 'write'; }
}

module.exports = { CATALOG, WRITER_REFUSAL, fakePool, fakeProvider, admittedPool, callAdmitted, loadRoutes, authed, anon, call };
