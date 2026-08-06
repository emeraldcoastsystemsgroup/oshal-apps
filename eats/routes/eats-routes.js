"use strict";
/**
 * Eats Routes — Uber Eats Concierge surface API
 *
 * Backs the Eats surface at /cockpit?app=eats. The framework way:
 *  - RESTAURANTS/DISHES come from the core Uber Eats provider helper. The controller resolves
 *    the operator's OPTIONAL config for one fixed server operation and passes it as an explicit
 *    request-scoped argument; no child environment or model sees it. Uber has no consumer
 *    search/order API, so the catalog is curated
 *    and ORDERING is a DEEP-LINK HANDOFF the diner completes on their own Uber login + payment.
 *  - The BRAIN runs on the eats-concierge bot via ctx.orchestrator (the caller's configured
 *    provider/model), NOT a hardcoded LLM call here.
 *  - Cart / profile / chat persist per-diner in the DB.
 *
 * Per-user isolation: every row is scoped by the OIDC `sub`. One active cart per diner,
 * scoped to ONE restaurant (Uber Eats checks out a single store per order).
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * 2026-06-19 | roger.murphy@emeraldcoastsystemsgroup.com | Initial creation — Uber Eats
 *            | concierge: catalog via the uber connector CLI, brain via the orchestrator,
 *            | deep-link order handoff. Mirrors the purchasing app, food-shaped.
 * 2026-07-18 12:10:00 | roger.murphy@emeraldcoastsystemsgroup.com | ADR-085 carve-out into the
 *            | eats store package (Wave 2 #4). Standard (ctx) factory; surface serves from this
 *            | package tools/ (ctx.appPackageDir); core-remaining relative imports rewritten to
 *            | @/app/routes aliases (concierge-reply/store/inline-bot-execution are SHARED —
 *            | nothing vendors). ensureEatsSchema now appends buildOwnerRlsPolicyStatements per
 *            | table (A1.2 chokepoint). oshal-uber.js stays core in the image (eats-bot + this
 *            | route both shell it). The eats-concierge REAL bot-node (eats-bot container /
 *            | registries / personas / uberToolKit.js) stays core per ADR-093 interim. Logic unchanged.
 * ---------------------------------------------------------------------------
 * 2026-08-06 10:15:00 | maintainer@emeraldcoastsystemsgroup.com | SECURITY: remove Uber Eats credentials from generic bot dispatch. Catalog/deep-link access resolves a fixed-server-operation credential only inside the deterministic CLI helper; the model receives bounded menu records and never a credential map.
 * 2026-08-06 | maintainer@emeraldcoastsystemsgroup.com | SECURITY: remove the final credential-bearing subprocess. Catalog/menu/handoff calls now use the import-safe core helper with the current request's explicit credential value.
 *
 * @module eats-routes
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureEatsSchema = ensureEatsSchema;
exports.createEatsRoutes = createEatsRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const logger_1 = require("@/shared/logger");
const database_1 = require("@/shared/services/database");
const authz_1 = require("@/shared/middleware/authz");
const connector_token_broker_1 = require("@/app/routes/connector-token-broker");
const provider_operation_clients_1 = require("@/app/routes/provider-operation-clients");
const concierge_store_1 = require("@/app/routes/concierge-store");
const concierge_reply_1 = require("@/app/routes/concierge-reply");
const agent_management_1 = require("@/features/agent-management");
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const logger = (0, logger_1.createChildLogger)({ module: 'eats-routes' });
/** The eats-concierge reasoning agent. Reached through BotNodeClient so cost/audit remain attributable;
 *  provider tools are disabled here and the controller performs bounded catalog/deep-link operations. */
const CONCIERGE_AGENT_ID = 'b0080000-0000-0000-0000-000000000001';
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
/** Serve a static surface file from the package tools dir (ctx.appPackageDir — D10). */
function serveFile(surfaceDir, fileName) {
    return (_req, res) => {
        const filePath = path.join(surfaceDir, fileName);
        res.sendFile(filePath, (err) => {
            if (err) {
                logger.error({ err, fileName }, `Failed to serve ${fileName}`);
                res.status(404).send(`Page not found: ${fileName}`);
            }
        });
    };
}
/** The authenticated diner, resolved from the OIDC session (never client-supplied). */
function resolveDinerSub(req) {
    const trustedSub = (0, authz_1.getTrustedServiceUserSub)(req);
    if (trustedSub)
        return trustedSub;
    const oidc = req.oidc;
    if (oidc && typeof oidc.isAuthenticated === 'function' && oidc.isAuthenticated()) {
        const u = oidc.user || {};
        const sub = u.sub || u.oid;
        if (sub)
            return String(sub);
    }
    if (process.env.MOCK_OIDC === 'true')
        return 'demo-diner';
    throw Object.assign(new Error('Not authenticated'), { status: 401 });
}
/**
 * Run one deterministic Uber Eats operation with the caller's request-scoped credential.
 * The import-safe helper receives the value directly and cannot read a child environment.
 */
async function uberEatsProviderOperation(pool, sub, args) {
    const creds = await (0, connector_token_broker_1.resolveServerOperationCreds)(pool, sub, ['uber'], 'fixed-server-operation');
    return (0, provider_operation_clients_1.runUberEatsProviderOperation)(creds.OSHAL_CRED_UBER, args);
}
// ── Schema ───────────────────────────────────────────────────────────────────
/** Create tables if a fresh deploy hasn't run the migrations yet. Idempotent. */
async function ensureEatsSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'eats routes',
        statements: [`
    CREATE TABLE IF NOT EXISTS eats_profile (
      user_sub VARCHAR(255) PRIMARY KEY,
      tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000c001',
      display_name TEXT, dietary TEXT[] NOT NULL DEFAULT '{}',
      favorite_cuisines TEXT[] NOT NULL DEFAULT '{}', default_address TEXT,
      budget_per_order NUMERIC(10,2), notes TEXT, onboarded BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS eats_carts (
      cart_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, store_id VARCHAR(64), store_name TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS eats_cart_items (
      row_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cart_id UUID NOT NULL REFERENCES eats_carts(cart_id) ON DELETE CASCADE,
      user_sub VARCHAR(255) NOT NULL, store_id VARCHAR(64), store_name TEXT,
      item_id VARCHAR(64), title TEXT, price NUMERIC(10,2), quantity INT NOT NULL DEFAULT 1,
      emoji TEXT, image_url TEXT, status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS eats_orders (
      order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, store_id VARCHAR(64), store_name TEXT,
      items JSONB NOT NULL DEFAULT '[]'::jsonb, total NUMERIC(10,2), handoff_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS eats_conversations (
      conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, title TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS eats_messages (
      message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES eats_conversations(conversation_id) ON DELETE CASCADE,
      user_sub VARCHAR(255) NOT NULL, role VARCHAR(16) NOT NULL, content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS eats_feedback (
      feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, note TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE UNIQUE INDEX IF NOT EXISTS uq_eats_feedback_user_note ON eats_feedback (user_sub, lower(note));
  `,
            ...(0, database_1.buildOwnerRlsPolicyStatements)('eats_profile', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('eats_carts', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('eats_cart_items', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('eats_orders', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('eats_conversations', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('eats_messages', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('eats_feedback', 'user_sub'),
        ],
        requirements: [
            { table: 'eats_profile', columns: ['user_sub', 'tenant_id', 'display_name', 'dietary', 'favorite_cuisines', 'onboarded', 'created_at', 'updated_at'] },
            { table: 'eats_carts', columns: ['cart_id', 'user_sub', 'store_id', 'store_name', 'status', 'created_at', 'updated_at'] },
            { table: 'eats_cart_items', columns: ['row_id', 'cart_id', 'user_sub', 'store_id', 'item_id', 'title', 'price', 'quantity', 'status', 'created_at'] },
            { table: 'eats_orders', columns: ['order_id', 'user_sub', 'store_id', 'store_name', 'items', 'total', 'handoff_url', 'created_at'] },
            { table: 'eats_conversations', columns: ['conversation_id', 'user_sub', 'title', 'created_at', 'updated_at'] },
            { table: 'eats_messages', columns: ['message_id', 'conversation_id', 'user_sub', 'role', 'content', 'created_at'] },
            { table: 'eats_feedback', columns: ['feedback_id', 'user_sub', 'note', 'created_at'] },
        ],
    });
}
// ── Cart helpers ───────────────────────────────────────────────────────────--
/** Get the diner's one active cart, creating it on first use. */
async function getOrCreateCart(pool, sub) {
    const found = await pool.query(`SELECT * FROM eats_carts WHERE user_sub = $1 AND status = 'active' ORDER BY created_at LIMIT 1`, [sub]);
    if (found.rows[0])
        return found.rows[0];
    const created = await pool.query(`INSERT INTO eats_carts (user_sub) VALUES ($1) RETURNING *`, [sub]);
    return created.rows[0];
}
/** Load the active cart + its pending items + total. */
async function loadCart(pool, sub) {
    const cart = await getOrCreateCart(pool, sub);
    const items = (await pool.query(`SELECT * FROM eats_cart_items WHERE cart_id = $1 AND status = 'pending' ORDER BY created_at`, [cart.cart_id])).rows;
    const total = items.reduce((s, i) => s + (Number(i.price) || 0) * (i.quantity || 1), 0);
    return { cart, items, total: Number(total.toFixed(2)) };
}
/**
 * Add an item to the active cart. Uber Eats orders ONE restaurant, so adding from a
 * different store switches the cart to that store (clearing the old items). Returns the
 * inserted row + whether a store switch happened.
 */
async function addToCart(pool, sub, prod, qty) {
    const q = Math.max(1, Math.min(20, qty || 1));
    let cart = await getOrCreateCart(pool, sub);
    let storeSwitched = false;
    const newStore = String(prod.storeId || '');
    if (cart.store_id && newStore && cart.store_id !== newStore) {
        await pool.query(`UPDATE eats_cart_items SET status = 'removed' WHERE cart_id = $1 AND status = 'pending'`, [cart.cart_id]);
        storeSwitched = true;
    }
    if (newStore && cart.store_id !== newStore) {
        await pool.query(`UPDATE eats_carts SET store_id = $2, store_name = $3, updated_at = NOW() WHERE cart_id = $1`, [cart.cart_id, newStore, prod.storeName || prod.brand || null]);
        cart = { ...cart, store_id: newStore, store_name: prod.storeName || prod.brand || null };
    }
    const ins = await pool.query(`INSERT INTO eats_cart_items (cart_id, user_sub, store_id, store_name, item_id, title, price, quantity, emoji, image_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [cart.cart_id, sub, newStore || null, prod.storeName || prod.brand || null, prod.productId || prod.itemId || null,
        prod.title || null, prod.price ?? null, q, prod.emoji || null, prod.imageUrl || null]);
    return { row: ins.rows[0], storeSwitched };
}
/** Build the Uber Eats order deep link for the active cart's store + record the handoff. */
async function buildOrder(pool, sub) {
    const { cart, items, total } = await loadCart(pool, sub);
    if (!items.length || !cart.store_id)
        return { checkoutUrl: null, total: 0, store: null };
    const r = await uberEatsProviderOperation(pool, sub, ['order', String(cart.store_id)]);
    const url = r.checkoutUrl || null;
    await pool.query(`INSERT INTO eats_orders (user_sub, store_id, store_name, items, total, handoff_url)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6)`, [sub, cart.store_id, cart.store_name, JSON.stringify(items), total.toFixed(2), url]);
    return { checkoutUrl: url, total, store: cart.store_name };
}
function buildConciergePrompt(o) {
    const p = o.profile || {};
    const profileLine = p.onboarded
        ? `diet:${(p.dietary || []).join(',') || 'none'} | cuisines:${(p.favorite_cuisines || []).join(',') || 'any'} | address:${p.default_address || 'ask'} | budget:${p.budget_per_order ? '$' + p.budget_per_order : 'n/a'}`
        : 'NOT ONBOARDED — warmly ask one or two questions first (dietary needs, favorite cuisines, delivery address, per-order budget), then save the profile.';
    const prods = (o.candidates || [])
        .map((c) => `- id:${c.productId} | ${c.title}${c.cuisine ? ` (${c.cuisine})` : ''}${typeof c.price === 'number' ? ` | $${c.price.toFixed(2)}` : c.priceFrom != null ? ` | from $${Number(c.priceFrom).toFixed(2)}` : ''}${c.etaMinutes ? ` | ~${c.etaMinutes}min` : ''}`)
        .join('\n') || '(no results for this message — ask what they\'re hungry for, or that nothing matched)';
    const cart = (o.cart || []).map((c) => `- ${c.title} ×${c.quantity}${c.store_name ? ` @ ${c.store_name}` : ''}`).join('\n') || '(empty)';
    const notes = (o.notes || []).map((n) => `- ${n}`).join('\n') || '(none yet)';
    const convo = (o.history || []).map((h) => `${h.role === 'assistant' ? 'You' : 'Diner'}: ${h.content}`).join('\n');
    return [
        'You are the Eats Concierge — a warm, fast food-ordering assistant on Uber Eats. Help the diner find a restaurant + dishes, build ONE order, then hand off a checkout. Never take payment, never invent a restaurant/dish/price.',
        'Be conversational and brief. Ask ONE good question when it helps (cuisine? budget? how many?). Only show or add items from CANDIDATES below, by id. Keep ONE restaurant per order; if they pick another, confirm it\'s a new order. Set "checkout": true only when they ask to order.',
        '',
        `CANDIDATES (real, from search — the ONLY items you may show or add):\n${prods}`,
        '',
        `DINER PROFILE: ${profileLine}`,
        `CURRENT ORDER:\n${cart}`,
        `THINGS THE DINER TAUGHT YOU:\n${notes}`,
        '',
        convo ? `CONVERSATION SO FAR:\n${convo}` : '',
        '',
        `DINER: ${o.message}`,
        '',
        'Reply with ONLY a JSON object, nothing around it:',
        '{ "say": "your reply (ask a question when useful)", "show": ["candidate id", ...], "add": [{"productId":"id","quantity":1,"reason":"why"}], "remember": ["a preference to save"], "checkout": false }',
    ].filter(Boolean).join('\n');
}
function parseEnvelope(text) {
    const fallback = { say: (0, concierge_reply_1.cleanConciergeReply)(text), show: [], add: [], remember: [], checkout: false };
    if (!text)
        return fallback;
    let s = text.trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence)
        s = fence[1].trim();
    const start = s.indexOf('{'), end = s.lastIndexOf('}');
    if (start === -1 || end === -1)
        return fallback;
    try {
        const o = JSON.parse(s.slice(start, end + 1));
        return {
            say: (0, concierge_reply_1.cleanConciergeReply)(o.say, fallback.say),
            show: Array.isArray(o.show) ? o.show.map(String) : [],
            add: Array.isArray(o.add)
                ? o.add.filter((a) => a && a.productId).map((a) => ({ productId: String(a.productId), quantity: Number(a.quantity) || 1, reason: a.reason ? String(a.reason) : undefined }))
                : [],
            remember: Array.isArray(o.remember) ? o.remember.map(String).filter(Boolean) : [],
            checkout: !!o.checkout,
        };
    }
    catch {
        return fallback;
    }
}
async function loadProfile(pool, sub) {
    const r = await pool.query(`SELECT * FROM eats_profile WHERE user_sub = $1`, [sub]);
    return r.rows[0] || { user_sub: sub, onboarded: false, dietary: [], favorite_cuisines: [] };
}
// ── Router ─────────────────────────────────────────────────────────────────--
function createEatsRoutes(ctx) {
    const router = (0, express_1.Router)();
    const pool = ctx.pool;
    const store = new concierge_store_1.ConciergeStore(pool, 'eats');
    const surfaceDir = ctx.appPackageDir ? path.join(ctx.appPackageDir, 'tools') : path.resolve(process.cwd(), 'tools');
    ensureEatsSchema(pool).catch((err) => logger.warn({ err }, 'Eats schema bootstrap deferred — tables may not exist yet'));
    const diner = (fn) => async (req, res) => {
        let sub;
        try {
            sub = resolveDinerSub(req);
        }
        catch (e) {
            res.status(e.status || 401).json({ error: e.message });
            return;
        }
        try {
            await fn(req, res, sub);
        }
        catch (err) {
            logger.error({ err, path: req.path }, 'eats route error');
            res.status(500).json({ error: err.message || 'internal error' });
        }
    };
    // ── Surface ────────────────────────────────────────────────────────────────
    router.get('/app', serveFile(surfaceDir, 'eats-app.html'));
    router.get('/chat', serveFile(surfaceDir, 'eats-app.html')); // alias (parity with purchasing's /chat surface)
    router.get('/config', diner(async (_req, res, sub) => {
        const r = await pool.query(`SELECT 1 FROM oshal_connections WHERE provider='uber' AND (user_sub=$1 OR tenant_id IS NOT NULL) LIMIT 1`, [sub]);
        res.json({ uberConnected: !!r.rowCount });
    }));
    // ── Catalog (via the request-scoped provider helper) ────────────────────────
    router.get('/search', diner(async (req, res, sub) => {
        const q = String(req.query.q || req.query.query || '');
        const r = await uberEatsProviderOperation(pool, sub, ['search', q, String(Number(req.query.limit) || 8)]);
        res.json({ items: r.items || [], source: r.source || (r.error ? 'error' : 'catalog'), error: r.error });
    }));
    router.get('/menu', diner(async (req, res, sub) => {
        const storeId = String(req.query.storeId || req.query.store || '');
        if (!storeId) {
            res.status(400).json({ error: 'storeId is required' });
            return;
        }
        const r = await uberEatsProviderOperation(pool, sub, ['menu', storeId]);
        res.json({ store: r.store || null, storeId, items: r.items || [], error: r.error });
    }));
    // ── Cart ─────────────────────────────────────────────────────────────────--
    router.get('/cart', diner(async (_req, res, sub) => {
        const { cart, items, total } = await loadCart(pool, sub);
        res.json({ cartId: cart.cart_id, storeId: cart.store_id, storeName: cart.store_name, items, total });
    }));
    router.post('/cart/items', diner(async (req, res, sub) => {
        const b = req.body || {};
        if (!b.title) {
            res.status(400).json({ error: 'title is required' });
            return;
        }
        const { row, storeSwitched } = await addToCart(pool, sub, {
            storeId: b.storeId, storeName: b.storeName, productId: b.productId || b.itemId,
            title: b.title, brand: b.brand, price: b.price != null ? Number(b.price) : null,
            emoji: b.emoji, imageUrl: b.imageUrl,
        }, Number(b.quantity) || 1);
        const { items, total } = await loadCart(pool, sub);
        res.json({ item: row, storeSwitched, items, total });
    }));
    router.delete('/cart/items/:rowId', diner(async (req, res, sub) => {
        await pool.query(`UPDATE eats_cart_items SET status = 'removed' WHERE row_id = $1 AND user_sub = $2`, [req.params.rowId, sub]);
        const { items, total } = await loadCart(pool, sub);
        res.json({ ok: true, items, total });
    }));
    router.post('/cart/clear', diner(async (_req, res, sub) => {
        const cart = await getOrCreateCart(pool, sub);
        await pool.query(`UPDATE eats_cart_items SET status = 'removed' WHERE cart_id = $1 AND status = 'pending'`, [cart.cart_id]);
        await pool.query(`UPDATE eats_carts SET store_id = NULL, store_name = NULL, updated_at = NOW() WHERE cart_id = $1`, [cart.cart_id]);
        res.json({ ok: true });
    }));
    // ── Order handoff (deep link) ───────────────────────────────────────────────
    router.post('/order', diner(async (_req, res, sub) => {
        const r = await buildOrder(pool, sub);
        if (!r.checkoutUrl) {
            res.status(400).json({ error: 'nothing to order (add items first)' });
            return;
        }
        res.json({ checkoutUrl: r.checkoutUrl, total: r.total, store: r.store,
            note: 'Opens at Uber Eats — sign in, confirm your address, and place the order. This is a handoff, not an in-app charge.' });
    }));
    router.get('/orders/history', diner(async (_req, res, sub) => {
        const r = await pool.query(`SELECT store_name, total, handoff_url, created_at
         FROM eats_orders
        WHERE user_sub = $1
        ORDER BY created_at DESC
        LIMIT 20`, [sub]);
        res.json({ orders: r.rows });
    }));
    // ── Profile ────────────────────────────────────────────────────────────────
    router.get('/profile', diner(async (_req, res, sub) => { res.json({ profile: await loadProfile(pool, sub) }); }));
    router.post('/profile', diner(async (req, res, sub) => {
        const b = req.body || {};
        const r = await pool.query(`INSERT INTO eats_profile (user_sub, display_name, dietary, favorite_cuisines, default_address, budget_per_order, notes, onboarded, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,false),NOW())
       ON CONFLICT (user_sub) DO UPDATE SET
         display_name=COALESCE(EXCLUDED.display_name, eats_profile.display_name),
         dietary=COALESCE(EXCLUDED.dietary, eats_profile.dietary),
         favorite_cuisines=COALESCE(EXCLUDED.favorite_cuisines, eats_profile.favorite_cuisines),
         default_address=COALESCE(EXCLUDED.default_address, eats_profile.default_address),
         budget_per_order=COALESCE(EXCLUDED.budget_per_order, eats_profile.budget_per_order),
         notes=COALESCE(EXCLUDED.notes, eats_profile.notes),
         onboarded=(EXCLUDED.onboarded OR eats_profile.onboarded), updated_at=NOW()
       RETURNING *`, [sub, b.displayName ?? null, b.dietary ?? null, b.favoriteCuisines ?? null, b.defaultAddress ?? null,
            b.budgetPerOrder ?? null, b.notes ?? null, b.onboarded ?? null]);
        res.json({ profile: r.rows[0] });
    }));
    // ── Conversational concierge (brain runs on the bot via the orchestrator) ──
    router.post('/chat', diner(async (req, res, sub) => {
        const message = String(req.body?.message || '').trim();
        if (!message) {
            res.status(400).json({ error: 'message is required' });
            return;
        }
        // Conversation + message + feedback persistence (durable resume, IDOR guard) is shared — ConciergeStore.
        const conversationId = await store.ensureConversation(sub, req.body?.conversationId || undefined, message);
        await store.addMessage(conversationId, sub, 'user', message);
        const history = await store.loadHistory(conversationId);
        const [profile, notes, currentCart] = await Promise.all([loadProfile(pool, sub), store.loadNotes(sub), loadCart(pool, sub)]);
        const searchRes = await uberEatsProviderOperation(pool, sub, ['search', message, '6']);
        const restaurants = searchRes.items || [];
        const menus = await Promise.all(restaurants.slice(0, 3).map(async (restaurant) => {
            if (!restaurant?.productId)
                return [];
            const menu = await uberEatsProviderOperation(pool, sub, ['menu', String(restaurant.productId)]);
            return menu.items || [];
        }));
        const candidates = menus.flat().slice(0, 12);
        const candById = new Map(candidates.map((item) => [String(item.productId), item]));
        const prompt = buildConciergePrompt({ message, history, candidates, cart: currentCart.items, profile, notes });
        let raw = '';
        try {
            const result = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, CONCIERGE_AGENT_ID, {
                text: prompt,
                taskId: `eats-${sub}-${(0, crypto_1.randomUUID)()}`,
                workspaceFolderId: `eats-${sub}`,
                agentId: CONCIERGE_AGENT_ID,
                agenticMode: false,
                direct: true,
                userSub: sub,
            });
            raw = String(result?.response || '').trim();
        }
        catch (e) {
            logger.error({ e }, 'eats concierge dispatch failed');
        }
        const env = parseEnvelope(raw);
        if (!env.say)
            env.say = candidates.length
                ? 'I found a few options. Pick one or tell me what to add.'
                : "I'm having trouble reaching my assistant right now — give me a moment and try again.";
        const added = [];
        for (const request of env.add) {
            const product = candById.get(request.productId);
            if (!product)
                continue;
            const { row } = await addToCart(pool, sub, product, request.quantity);
            added.push({ ...product, rowId: row.row_id, quantity: request.quantity, reason: request.reason });
        }
        for (const note of env.remember)
            await store.saveNote(sub, note);
        let checkout = null;
        if (env.checkout) {
            const handoff = await buildOrder(pool, sub);
            if (handoff.checkoutUrl) {
                checkout = { checkoutUrl: handoff.checkoutUrl, total: handoff.total, store: handoff.store };
            }
        }
        const nextCart = await loadCart(pool, sub);
        const shown = env.show.length
            ? env.show.map((id) => candById.get(id)).filter(Boolean)
            : candidates.slice(0, 6);
        await store.addMessage(conversationId, sub, 'assistant', env.say);
        await store.touch(conversationId);
        res.json({
            conversationId,
            reply: env.say,
            cards: shown,
            added,
            remembered: env.remember,
            checkout,
            cart: { cartId: nextCart.cart.cart_id, storeId: nextCart.cart.store_id, storeName: nextCart.cart.store_name, items: nextCart.items, total: nextCart.total },
            source: searchRes.source || 'uber',
        });
    }));
    router.get('/conversation', diner(async (req, res, sub) => {
        // Durable resume by id (else latest), user-scoped — shared ConciergeStore.
        res.json(await store.resume(sub, String(req.query.id || '')));
    }));
    return router;
}
//# sourceMappingURL=eats-routes.js.map