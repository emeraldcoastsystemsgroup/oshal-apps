/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 9: the concierge kept saying "you want spicy food", a note invented and saved in sweep 8
 *   before the remember filter, and nothing could remove it; and after it remembered "allergic to peanuts" the Dietary preferences
 *   card still read "No diet set". Through the COMPILED routes over the native kernel's REAL concierge store
 *   (crates/host-process/bridge/concierge_store.js, its person-scoped documents) on an in-memory documents pool: GET /profile
 *   answers each remembered note once, marked when it records an allergy, an intolerance or a diet; POST /notes/forget removes every
 *   saved copy of that note for the caller only (another diner's copy stays), a note nobody saved answers 404, and the store's
 *   loadNotes (what the chat route puts under SAVED PREFERENCES) no longer returns it. The page shows remembered restrictions on
 *   the Dietary card and lists every note with Forget, which asks first. Needs the kernel checkout (OSHAL_KERNEL_ROOT, default ~/Documents/projects/oshal-kernel).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: the Per-order budget card read "Budget open" while the list held "budget: cheap". GET /profile marks a
 *   remembered spending note (budget, cheap, a dollar cap) and the card shows it while no dollar cap is set; the page's own loadProfile is run
 *   over the route's answer (the cheap note shows, a set cap wins, no spending note reads "Budget open").
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The route module now requires ./allergen-check (every dish checked against the diner's allergies and diet); the loader serves the compiled module.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const KERNEL = process.env.OSHAL_KERNEL_ROOT || path.join(os.homedir(), 'Documents', 'projects', 'oshal-kernel');
const BRIDGE = path.join(KERNEL, 'crates', 'host-process', 'bridge', 'concierge_store.js');

/** Person-scoped documents as the native host keeps them: one table per collection, every statement under one caller. */
function documentsPool() {
  const tables = new Map(), sql = [];
  const table = (name) => { if (!tables.has(name)) tables.set(name, []); return tables.get(name); };
  const answer = (text, v) => {
    let m;
    if (/^CREATE TABLE IF NOT EXISTS/.test(text)) return { rows: [] };
    if ((m = /^INSERT INTO (\w+) \(id, user_sub, revision, body\)/.exec(text))) {
      table(m[1]).push({ id: v[0], user_sub: v[1], revision: v[2], body: v[3] });
      return { rowCount: 1, rows: [{ id: v[0] }] };
    }
    if ((m = /^SELECT (?:\*|id, body) FROM (\w+) WHERE user_sub = \$1$/.exec(text))) return { rows: table(m[1]).filter((r) => r.user_sub === v[0]) };
    if ((m = /^DELETE FROM (\w+) WHERE user_sub = \$1 AND id = \$2$/.exec(text))) {
      const rows = table(m[1]), at = rows.findIndex((r) => r.user_sub === v[0] && r.id === v[1]);
      if (at >= 0) rows.splice(at, 1);
      return { rowCount: at >= 0 ? 1 : 0, rows: [] };
    }
    if (/^SELECT \* FROM eats_profile WHERE user_sub = \$1/.test(text)) return { rows: [] };
    if (/^\s*CREATE |^\s*ALTER |^\s*DO |eats_carts|eats_cart_items|eats_orders/.test(text)) return { rows: [] };
    throw new Error('documents pool cannot answer: ' + text.slice(0, 90));
  };
  return { tables, sql, async query(q, values) { const text = typeof q === 'string' ? q : q.text; sql.push(text); return answer(text.trim(), typeof q === 'string' ? values : q.values); } };
}

/** The compiled Eats routes with the kernel's real concierge store and only the framework imports stubbed. */
function loadRoutes(pool, reply = { say: 'ok', show: [], remember: [], order: null }) {
  assert.ok(fs.existsSync(BRIDGE), `the kernel checkout must be present to use its concierge store (set OSHAL_KERNEL_ROOT); missing ${BRIDGE}`);
  const { ConciergeStore } = require(BRIDGE);
  const handlers = { get: new Map(), post: new Map(), delete: new Map() };
  const router = { get(p, h) { handlers.get.set(p, h); return this; }, post(p, h) { handlers.post.set(p, h); return this; }, delete(p, h) { handlers.delete.set(p, h); return this; }, use() { return this; } };
  const stubs = {
    express: { Router: () => router }, path, crypto: require('node:crypto'),
    './remembered-notes': require(path.join(PKG, 'routes', 'remembered-notes.js')),
    './allergen-check': require(path.join(PKG, 'routes', 'allergen-check.js')),
    './places': require(path.join(PKG, 'routes', 'places.js')),
    './uber-link': require(path.join(PKG, 'routes', 'uber-link.js')),
    './place-cache': require(path.join(PKG, 'routes', 'place-cache.js')),
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
    '@/shared/middleware/authz': { getTrustedServiceUserSub: () => undefined },
    '@/app/routes/concierge-store': { ConciergeStore },
    '@/app/routes/concierge-reply': { cleanConciergeReply: (t, fb) => (typeof t === 'string' && t.trim() ? t : (fb || '')) },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => undefined },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: JSON.stringify(reply) }) },
  };
  const file = path.join(PKG, 'routes', 'eats-routes.js'), mod = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', fs.readFileSync(file, 'utf8'))((r) => {
    if (Object.prototype.hasOwnProperty.call(stubs, r)) return stubs[r];
    throw new Error(`unexpected require in eats route module: ${r}`);
  }, mod, mod.exports, file, path.dirname(file));
  mod.exports.createEatsRoutes({ pool, appPackageDir: PKG });
  return { handlers, store: new ConciergeStore(pool, 'eats') };
}

const authed = (sub, extra = {}) => ({ oidc: { isAuthenticated: () => true, user: { sub } }, query: {}, body: {}, params: {}, path: '/', ...extra });
async function call(handlers, method, route, req) {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }, setHeader() {} };
  await handlers[method].get(route)(req, res);
  return res;
}

test('the profile lists each remembered note once, marking allergies and diets', async () => {
  const pool = documentsPool(), { handlers, store } = loadRoutes(pool);
  for (const note of ['wants spicy food', 'allergic to peanuts', 'Wants  spicy food', 'vegetarian']) await store.saveNote('diner-a', note);
  const res = await call(handlers, 'get', '/profile', authed('diner-a'));
  assert.equal(res.statusCode, 200);
  const notes = res.body.remembered.map((r) => [r.note.toLowerCase(), r.restriction]).sort();
  assert.deepEqual(notes, [['allergic to peanuts', true], ['vegetarian', true], ['wants spicy food', false]]);
});

test('forget removes every saved copy of the caller\'s note, so the notes the chat prompt reads no longer carry it', async () => {
  const pool = documentsPool(), { handlers, store } = loadRoutes(pool);
  for (const note of ['wants spicy food', 'allergic to peanuts', 'Wants spicy food']) await store.saveNote('diner-a', note);
  await store.saveNote('diner-b', 'wants spicy food');
  const gone = await call(handlers, 'post', '/notes/forget', authed('diner-a', { body: { note: 'wants  SPICY food' } }));
  assert.deepEqual([gone.statusCode, gone.body.forgotten], [200, 2]);
  assert.deepEqual((await store.loadNotes('diner-a')).sort(), ['allergic to peanuts']);
  assert.deepEqual(await store.loadNotes('diner-b'), ['wants spicy food'], 'another diner keeps their own note');
  assert.ok(pool.sql.filter((s) => /^DELETE/.test(s.trim())).length === 2, 'one statement per saved copy, each pinned to the caller');
  assert.equal((await call(handlers, 'post', '/notes/forget', authed('diner-a', { body: { note: 'wants spicy food' } }))).statusCode, 404);
  assert.equal((await call(handlers, 'post', '/notes/forget', authed('diner-a', { body: {} }))).statusCode, 400);
});

test('the page shows remembered restrictions on the Dietary card and lists every note with Forget, asking first', () => {
  const html = fs.readFileSync(path.join(PKG, 'tools', 'eats-app.html'), 'utf8');
  assert.match(html, /remembered\.filter\(\(r\) => r\.restriction\)\.map\(\(r\) => r\.note\)/, 'the Dietary card adds remembered allergies and diets');
  assert.match(html, /<details class="remembered" id="rememberedBox" hidden>/);
  assert.match(html, /window\.confirm\(`Forget "\$\{note\}"\? The concierge will stop using it\.`\)/);
  assert.match(html, /postJson\(`\$\{API\}\/notes\/forget`, \{ note \}\)/);
  const strip = html.slice(html.indexOf('<section class="personal-strip">'), html.indexOf('</section>', html.indexOf('<section class="personal-strip">')));
  assert.match(strip, /id="rememberedBox"/, 'the list sits inside the strip, so the main grid keeps its rows');
});

test('a remembered spending note is marked budget, and the Per-order budget card shows it while no dollar cap is set', async () => {
  const pool = documentsPool(), { handlers, store } = loadRoutes(pool);
  for (const note of ['budget: cheap', 'allergic to peanuts', 'under $30 for two']) await store.saveNote('diner-a', note);
  const res = await call(handlers, 'get', '/profile', authed('diner-a'));
  const marked = Object.fromEntries(res.body.remembered.map((r) => [r.note, r.budget]));
  assert.deepEqual(marked, { 'budget: cheap': true, 'allergic to peanuts': false, 'under $30 for two': true });

  // The page's own loadProfile, run over that answer with the page's element ids.
  const html = fs.readFileSync(path.join(PKG, 'tools', 'eats-app.html'), 'utf8');
  const start = html.indexOf('async function loadProfile()'), end = html.indexOf('\n}\n', start) + 3;
  const source = html.slice(start, end);
  const paint = async (profile) => {
    const els = {}, $ = (sel) => (els[sel] = els[sel] || { value: '', textContent: '' });
    const run = new Function('$', 'getJson', 'API', 'state', 'showRemembered', `${source}; return loadProfile();`);
    await run($, async () => ({ profile, remembered: res.body.remembered }), '/api/eats', {}, () => {});
    return els['#prefBudget'].textContent;
  };
  assert.equal(await paint({}), 'under $30 for two, cheap (remembered)', 'newest first, as the list shows them');
  assert.equal(await paint({ budget_per_order: 40 }), '$40', 'a dollar cap the diner set wins');
  const none = await call(handlers, 'get', '/profile', authed('diner-b'));
  assert.deepEqual(none.body.remembered, []);
});
