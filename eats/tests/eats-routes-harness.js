/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — load the COMPILED Eats route module (the bytes the framework mounts) with every framework import stubbed, an in-memory pool that answers exactly the SQL the cart, order, history and chat routes issue, a recording Uber Eats provider over a two-restaurant curated menu, and a scripted concierge. Shared by the route suite and the browser smoke's fixture (which passes the framework's real express); not a suite itself (no .test.js name, so the package glob never runs it).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Native admission double: admittedPool applies the native host's rule (crates/packages/src/sql_transaction.rs) to every statement, so while callAdmitted runs a GET only a query or idempotent table setup reaches the pool and any other statement is refused with the host's own message; a per-request mode resolver serves the browser fixture's concurrent requests.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const ROUTE_FILE = path.join(PKG, 'routes', 'eats-routes.js');

/** A curated catalog shaped like the core Uber Eats provider's normalizeStore/normalizeItem output. */
const RESTAURANTS = [
  { storeId: 'chipotle', name: 'Chipotle Mexican Grill', cuisine: 'Mexican', items: [
    ['chp-burrito', 'Chicken Burrito', 9.95], ['chp-bowl', 'Burrito Bowl', 9.95], ['chp-tacos', 'Three Tacos', 9.45], ['chp-chips', 'Chips & Guacamole', 4.55]] },
  { storeId: 'mcdonalds', name: "McDonald's", cuisine: 'Burgers', items: [
    ['mcd-bigmac', 'Big Mac', 5.99], ['mcd-mcnuggets', '10 pc Chicken McNuggets', 5.49], ['mcd-fries', 'Large French Fries', 3.99], ['mcd-mccafe', 'McCafé Latte', 3.29]] },
  { storeId: 'sushi-house', name: 'Sushi House', cuisine: 'Japanese', items: [
    ['sh-cali', 'California Roll', 7.5], ['sh-spicytuna', 'Spicy Tuna Roll', 8.25], ['sh-ramen', 'Tonkotsu Ramen', 13.95], ['sh-edamame', 'Edamame', 4.5]] },
];

/** One restaurant as a search card. */
const storeCard = (r) => ({ retailer: 'ubereats', productId: r.storeId, title: r.name, brand: r.name, cuisine: r.cuisine, etaMinutes: 25, priceFrom: Math.min(...r.items.map((i) => i[2])), imageUrl: '' });
/** One menu item. */
const menuItem = (r, [id, title, price]) => ({ retailer: 'ubereats', productId: id, storeId: r.storeId, title, brand: r.name, price, emoji: '', imageUrl: '' });

/** An Uber Eats provider double answering search / menu / order from RESTAURANTS; every call recorded. */
function fakeProvider(overrides = {}) {
  const calls = [];
  async function run(args) {
    calls.push([...args]);
    if (overrides[args[0]]) return overrides[args[0]](args);
    if (args[0] === 'search') {
      const q = String(args[1] || '').toLowerCase();
      const hits = RESTAURANTS.filter((r) => !q || r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q) || r.items.some((i) => i[1].toLowerCase().includes(q)));
      return { source: 'catalog', items: (hits.length ? hits : RESTAURANTS).map(storeCard) };
    }
    if (args[0] === 'menu') {
      const r = RESTAURANTS.find((x) => x.storeId === args[1]);
      return r ? { source: 'catalog', storeId: r.storeId, store: r.name, items: r.items.map((i) => menuItem(r, i)) } : { source: 'catalog', storeId: args[1], items: [] };
    }
    if (args[0] === 'order') return { source: 'ubereats', checkoutUrl: `https://www.ubereats.com/store/${args[1]}` };
    return {};
  }
  return { calls, run };
}

/** An in-memory pool answering the Eats route SQL; every statement is recorded. */
function fakePool(seed = {}) {
  const t = { carts: [...(seed.carts || [])], items: [...(seed.items || [])], orders: [] };
  const sql = [];
  let n = 0;
  const id = (p) => `${p}-${++n}`;
  const rows = (r) => ({ rows: r, rowCount: r.length });
  const handlers = [
    [/^SELECT \* FROM eats_carts WHERE user_sub = \$1 AND status = 'active'/, (p) => rows(t.carts.filter((c) => c.user_sub === p[0] && c.status === 'active').slice(0, 1))],
    [/^INSERT INTO eats_carts \(user_sub\) VALUES \(\$1\)/, (p) => { const c = { cart_id: id('cart'), user_sub: p[0], store_id: null, store_name: null, status: 'active' }; t.carts.push(c); return rows([c]); }],
    [/^SELECT \* FROM eats_cart_items WHERE cart_id = \$1 AND status = 'pending'/, (p) => rows(t.items.filter((i) => i.cart_id === p[0] && i.status === 'pending'))],
    [/^UPDATE eats_cart_items SET status = 'removed' WHERE cart_id = \$1 AND status = 'pending'/, (p) => { const hit = t.items.filter((i) => i.cart_id === p[0] && i.status === 'pending'); hit.forEach((i) => { i.status = 'removed'; }); return rows(hit); }],
    [/^UPDATE eats_carts SET store_id = \$2, store_name = \$3/, (p) => { const hit = t.carts.filter((c) => c.cart_id === p[0]); hit.forEach((c) => { c.store_id = p[1]; c.store_name = p[2]; }); return rows(hit); }],
    [/^INSERT INTO eats_cart_items/, (p) => { const r = { row_id: id('row'), cart_id: p[0], user_sub: p[1], store_id: p[2], store_name: p[3], item_id: p[4], title: p[5], price: p[6] === null ? null : Number(p[6]).toFixed(2), quantity: p[7], emoji: p[8], image_url: p[9], status: 'pending' }; t.items.push(r); return rows([r]); }],
    [/^UPDATE eats_cart_items SET status = 'removed' WHERE row_id = \$1 AND user_sub = \$2/, (p) => { const hit = t.items.filter((i) => i.row_id === p[0] && i.user_sub === p[1]); hit.forEach((i) => { i.status = 'removed'; }); return rows(hit); }],
    [/^INSERT INTO eats_orders/, (p) => { t.orders.push({ user_sub: p[0], store_id: p[1], store_name: p[2], items: p[3], total: p[4], handoff_url: p[5] }); return rows([]); }],
    [/^SELECT store_name, total, handoff_url, created_at\s+FROM eats_orders/, (p) => rows(t.orders.filter((o) => o.user_sub === p[0]))],
    [/^SELECT 1 FROM oshal_connections WHERE provider='uber'/, () => rows([])],
    [/^SELECT \* FROM eats_profile WHERE user_sub = \$1/, () => rows([])],
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

/** The shared conversation store the route uses, as an in-memory double. */
class FakeConciergeStore {
  constructor() { this.messages = []; this.notes = []; }
  async ensureConversation() { return 'conv-1'; }
  async addMessage(conversationId, sub, role, content) { this.messages.push({ conversationId, sub, role, content }); }
  async loadHistory() { return []; }
  async loadNotes() { return []; }
  async saveNote(_sub, note) { this.notes.push(note); }
  async touch() {}
  async resume() { return { conversationId: null, messages: [] }; }
}

/**
 * @description Load the compiled route module with stubbed framework imports and return its handlers.
 * @param {{ pool?: object, provider?: object, reply?: object|Function, express?: object }} opts - `express`:
 *   a real express module (the browser fixture's); `reply`: the concierge's JSON envelope, or a
 *   function of the prompt returning one.
 * @returns {{ handlers: object, pool: object, provider: object, prompts: string[], router: object }}
 */
function loadRoutes(opts = {}) {
  const handlers = { get: new Map(), post: new Map(), delete: new Map() };
  const pool = opts.pool || fakePool();
  const provider = opts.provider || fakeProvider();
  const prompts = [];
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
    '@/app/routes/connector-token-broker': { resolveServerOperationCreds: async () => ({ OSHAL_CRED_UBER: undefined }) },
    '@/app/routes/provider-operation-clients': { runUberEatsProviderOperation: async (_cred, args) => provider.run(args) },
    '@/app/routes/concierge-store': { ConciergeStore: FakeConciergeStore },
    '@/app/routes/concierge-reply': { cleanConciergeReply: (t, fb) => (typeof t === 'string' && t.trim() ? t : (fb || '')) },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => undefined },
    '@/app/routes/inline-bot-execution': {
      executeBotOrInline: async (_ctx, _client, _agent, input) => {
        prompts.push(input.text);
        const reply = typeof opts.reply === 'function' ? opts.reply(input.text) : opts.reply;
        return { response: JSON.stringify(reply || { say: 'ok' }) };
      },
    },
  };
  const shimRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    throw new Error(`unexpected require in eats route module: ${request}`);
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', fs.readFileSync(ROUTE_FILE, 'utf8'))(
    shimRequire, mod, mod.exports, ROUTE_FILE, path.dirname(ROUTE_FILE));
  const mounted = mod.exports.createEatsRoutes({ pool, appPackageDir: PKG });
  return { handlers, pool, provider, prompts, exports: mod.exports, router: mounted };
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

/** A signed-in diner request. */
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

module.exports = { RESTAURANTS, WRITER_REFUSAL, fakePool, fakeProvider, admittedPool, callAdmitted, loadRoutes, authed, anon, call };
