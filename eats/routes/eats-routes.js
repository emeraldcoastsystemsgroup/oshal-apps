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
 * 2026-09-26 | maintainer@emeraldcoastsystemsgroup.com | Commerce surfaces (backlog "Consumer commerce native surfaces"): (1) POST /cart/items no longer trusts the browser's price, title, store name or image — it reads the restaurant's menu (the provider 'menu' operation for storeId) and prices the line from the item whose productId matches exactly (menuItemFor), refusing an item the menu does not list with 422 unknown_item. (2) Every total (/cart, the order record, the chat proposal) is summed in integer cents by ./cart-totals; the cart responses keep items/total and add totalCents + unpricedLines. (3) A chat "checkout" no longer calls buildOrder (which wrote eats_orders) in the same request: it returns a `proposal` the surface shows as a confirm card, and only the diner's confirm calls POST /order. `checkout` stays in the reply (always null) for older surfaces.
 * 2026-10-08 | maintainer@emeraldcoastsystemsgroup.com | GET /cart is a pure read. loadCart created the diner's cart (INSERT INTO eats_carts) when none existed; the native host admits a GET read-only and refuses any SQL write, so every first visit answered 500 'SQL mutation requires original writer admission'. readCart answers the unchanged shape with cartId, storeId and storeName null and no lines when there is no active cart; POST /cart/items (and the other write routes) still create it through getOrCreateCart.
 * 2026-10-11 | maintainer@emeraldcoastsystemsgroup.com | No Uber Eats rail is said, not refused before the concierge speaks. The chat turn probes the runtime's Uber Eats `status` first; where it answers mode not_connected (the native kernel has no Uber Eats connector, and calling search or menu there refuses 503 and fails the whole call) the turn skips the catalog and the concierge answers with that fact. /config carries `rail` and the sentence. Guard: tests/eats-no-rail.test.js.
 * 2026-10-12 | maintainer@emeraldcoastsystemsgroup.com | Saved notes are not this request. Sweeps 5 and 6: asked for something vegetarian, the concierge answered 'vegetarian and spicy'; the diner's saved notes held 'wants spicy food' five times (one earlier 'something spicy for dinner', then re-saved every turn). The prompt now calls them SAVED PREFERENCES from earlier conversations that are never restated as the current request, "remember" takes only a new preference stated in this message, and newNotes() drops a note already saved. Guard: tests/eats-saved-notes.test.js.
 * 2026-10-12 | maintainer@emeraldcoastsystemsgroup.com | Live re-drive still folded "spicy food desire" into the reply: a note saved many times is now shown once in the prompt (newNotes over the loaded notes), and a saved preference is asked about as its own question, never folded into the summary of the request. Guard: tests/eats-saved-notes.test.js.
 * 2026-10-12 | maintainer@emeraldcoastsystemsgroup.com | A search that never ran is not reported as empty. With no Uber Eats rail the chat skips the catalog, yet the prompt still headed CANDIDATES 'real, from search' over '(no results for this message ... or that nothing matched)', and the concierge told the diner there were no vegetarian restaurants in the search results. With no rail the block now says no search ran and forbids calling it an empty result. Guard: tests/eats-no-rail.test.js.
 *
 * 2026-10-12 | maintainer@emeraldcoastsystemsgroup.com | Sweep 8: the concierge's reply was shown as the raw object ('{ "say": ... "remember": [...] }') because the model left out the commas between fields and the parse fallback returned the whole text. parseEnvelope repairs missing field commas and, for an envelope still unparsable, shows only its "say" text. A remember entry is saved only when it shares a word with the diner's message (statedNotes): the turn had remembered 'spicy preference', 'address: pending' and 'not on boarded' for a vegetarian request. Guard: tests/eats-envelope.test.js.
 * 2026-10-12 | maintainer@emeraldcoastsystemsgroup.com | A stated allergy is always saved. statedNotes matched whole words, so for "I'm allergic to peanuts, hold the onion, I eat vegan" it kept only 'vegan' and dropped 'peanut allergy' and 'no onions'. Words now match by stem ("allergic"/"allergy", "peanuts"/"peanut"), short food words such as egg, soy and nut count, and an allergy, intolerance or diet note is kept whenever the message states one. A "say" holding a raw newline is parsed instead of falling back to the route's default text, and that default names options only when cards are shown with it. A parsed envelope with an empty say gets that default too: the say fell back to the whole raw text, and the native kernel's cleanConciergeReply returns its fallback unchanged, so the diner saw the object. Guard: tests/eats-stated-notes.test.js.
 * 2026-10-12 | maintainer@emeraldcoastsystemsgroup.com | Sweep 9: GET /profile also answers "remembered", the concierge's saved notes once each and marked when they record an allergy, an intolerance or a diet, so the Dietary preferences card shows a remembered allergy (it read "No diet set") and the page lists what is remembered; POST /notes/forget removes every saved copy of one of the caller's notes (the concierge kept using "wants spicy food", invented and saved before the remember filter, and nothing could remove it). See remembered-notes.ts.
 * 2026-10-13 | maintainer@emeraldcoastsystemsgroup.com | Sweep 12: the in-app concierge bubble showed '1. **Mushroom Risotto** ...' with its asterisks (the surface writes the reply as text). plainProse() takes chat bold/italic and heading marks out of the reply before it is saved and returned; the words and list lines stay. Guard: tests/eats-plain-reply.test.js.
 * 2026-10-13 | maintainer@emeraldcoastsystemsgroup.com | Demo sweep 2: after "I have noted your peanut allergy" the concierge suggested a Vegetarian Pad Thai (usually made with peanuts) with no warning. allergyGuard() reads the diner's restrictions from the message, the saved notes and the profile's dietary list (./allergen-check); a search dish that names an allergen or is usually made with it is held back from the prompt, the cards and the cart, the prompt states the restrictions and the held dishes as facts, and a dish the reply names that usually carries one, in a sentence that does not name the risk, gets its own allergy-check line (response `allergy.check`, saved with the reply). The bot dispatch moved to askConcierge(). Guard: tests/eats-allergens.test.js.
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
exports.EATS_NO_RAIL = void 0;
exports.ensureEatsSchema = ensureEatsSchema;
exports.menuItemFor = menuItemFor;
exports.orderProposal = orderProposal;
exports.newNotes = newNotes;
exports.parseEnvelope = parseEnvelope;
exports.plainProse = plainProse;
exports.statedNotes = statedNotes;
exports.allergyGuard = allergyGuard;
exports.createEatsRoutes = createEatsRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const cart_totals_1 = require("./cart-totals");
const logger_1 = require("@/shared/logger");
const database_1 = require("@/shared/services/database");
const authz_1 = require("@/shared/middleware/authz");
const connector_token_broker_1 = require("@/app/routes/connector-token-broker");
const provider_operation_clients_1 = require("@/app/routes/provider-operation-clients");
const concierge_store_1 = require("@/app/routes/concierge-store");
const concierge_reply_1 = require("@/app/routes/concierge-reply");
const remembered_notes_1 = require("./remembered-notes");
const allergen_check_1 = require("./allergen-check");
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
/** What a diner is told where the installation has no Uber Eats rail at all. */
exports.EATS_NO_RAIL = 'This installation has no Uber Eats rail (no Uber Eats connector exists here), so restaurants, menus and checkout links cannot be searched or opened from here.';
/**
 * @description Whether the runtime has an Uber Eats rail. The native kernel's `status` answers mode
 * not_connected and refuses every other operation with 503 (failing the whole call), so a route that
 * only wants to know must ask `status`, never search.
 * @param pool - The package pool.
 * @param sub - The caller.
 * @returns absent=true where there is no rail, with the runtime's reason.
 */
async function uberEatsRail(pool, sub) {
    const st = await uberEatsProviderOperation(pool, sub, ['status']);
    const absent = !!st && st.mode === 'not_connected';
    return { absent, reason: absent ? String(st.reason || exports.EATS_NO_RAIL) : null };
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
/**
 * @description The diner's one active cart, or null when they have none yet. A pure read, so a GET
 * (which the native host admits read-only) never has to create anything.
 * @param pool - The package pool.
 * @param sub - The authenticated diner.
 * @returns The cart row, or null.
 */
async function findActiveCart(pool, sub) {
    const found = await pool.query(`SELECT * FROM eats_carts WHERE user_sub = $1 AND status = 'active' ORDER BY created_at LIMIT 1`, [sub]);
    return found.rows[0] || null;
}
/** Get the diner's one active cart, creating it on first use. Write requests only. */
async function getOrCreateCart(pool, sub) {
    const found = await findActiveCart(pool, sub);
    if (found)
        return found;
    const created = await pool.query(`INSERT INTO eats_carts (user_sub) VALUES ($1) RETURNING *`, [sub]);
    return created.rows[0];
}
/** One cart's pending items + the total, summed in integer cents. */
async function cartLines(pool, cart) {
    const items = (await pool.query(`SELECT * FROM eats_cart_items WHERE cart_id = $1 AND status = 'pending' ORDER BY created_at`, [cart.cart_id])).rows;
    const { totalCents, unpricedLines } = (0, cart_totals_1.cartTotalCents)(items);
    return { cart, items, total: (0, cart_totals_1.centsToDollars)(totalCents), totalCents, unpricedLines };
}
/** Load the active cart + its pending items + the total, creating the cart on first use (writes only). */
async function loadCart(pool, sub) {
    return cartLines(pool, await getOrCreateCart(pool, sub));
}
/** The cart fields every cart-returning response carries (items/total unchanged; cents added). */
function cartBody(loaded) {
    return { items: loaded.items, total: loaded.total, totalCents: loaded.totalCents, unpricedLines: loaded.unpricedLines };
}
/**
 * @description The GET /cart body, read without writing: the active cart's ids, store and lines, or
 * the same shape with cartId, storeId and storeName null and no lines when the diner has no cart yet.
 * The first write (POST /cart/items, the chat turn) creates the cart.
 * @param pool - The package pool.
 * @param sub - The authenticated diner.
 * @returns The cart view.
 */
async function readCart(pool, sub) {
    const cart = await findActiveCart(pool, sub);
    if (!cart)
        return { cartId: null, storeId: null, storeName: null, items: [], total: 0, totalCents: 0, unpricedLines: 0 };
    return { cartId: cart.cart_id, storeId: cart.store_id, storeName: cart.store_name, ...cartBody(await cartLines(pool, cart)) };
}
/** A store id as the provider's menu operation accepts it. */
const STORE_ID = /^[A-Za-z0-9-]{1,128}$/;
/** A menu item id (the curated catalog uses short slugs). */
const ITEM_ID = /^[A-Za-z0-9._-]{1,64}$/;
/**
 * @description Find ONE menu item by exact id in the named restaurant's menu, for pricing a cart
 * line on the server. The menu is the provider's deterministic catalog, so the price, title and
 * store come from it; anything the browser sent is ignored.
 * @param run - The request-scoped provider call (`uberEatsProviderOperation` bound to the caller).
 * @param storeId - The restaurant the line is from.
 * @param productId - The menu item id.
 * @returns The menu item with its store name, or null when the menu does not list it.
 */
async function menuItemFor(run, storeId, productId) {
    if (!STORE_ID.test(storeId) || !ITEM_ID.test(productId))
        return null;
    const menu = await run(['menu', storeId]);
    const item = (menu?.items || []).find((row) => String(row?.productId) === productId && String(row?.storeId) === String(menu.storeId));
    return item ? { ...item, storeName: menu.store || item.brand || null } : null;
}
/**
 * @description Describe the order the diner would be handing off to Uber Eats, WITHOUT building
 * the deep link or recording anything. Only the diner's confirm (POST /order) does that.
 * @param loaded - The active cart with its pending items and totals.
 * @returns The proposal, or null for an empty cart or a cart with no restaurant.
 */
function orderProposal(loaded) {
    if (!loaded.items.length || !loaded.cart?.store_id)
        return null;
    const units = loaded.items.reduce((sum, line) => sum + (0, cart_totals_1.lineQuantity)(line.quantity), 0);
    const store = loaded.cart.store_name || null;
    const partial = loaded.unpricedLines ? ` (${loaded.unpricedLines} line${loaded.unpricedLines === 1 ? '' : 's'} without a price)` : '';
    return {
        actionId: 'place_order', store, lines: loaded.items.length, totalCents: loaded.totalCents,
        total: loaded.total, unpricedLines: loaded.unpricedLines,
        summary: `Open Uber Eats for ${units} item${units === 1 ? '' : 's'}${store ? ` from ${store}` : ''} totalling $${(0, cart_totals_1.formatCents)(loaded.totalCents)}${partial}? You confirm the address and pay in Uber Eats; nothing is charged here.`,
    };
}
/**
 * Add an item to the active cart. Uber Eats orders ONE restaurant, so adding from a
 * different store switches the cart to that store (clearing the old items). Returns the
 * inserted row + whether a store switch happened.
 */
async function addToCart(pool, sub, prod, qty) {
    const q = (0, cart_totals_1.lineQuantity)(qty);
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
    const { cart, items, total, totalCents } = await loadCart(pool, sub);
    if (!items.length || !cart.store_id)
        return { checkoutUrl: null, total: 0, totalCents: 0, store: null };
    const r = await uberEatsProviderOperation(pool, sub, ['order', String(cart.store_id)]);
    const url = r.checkoutUrl || null;
    await pool.query(`INSERT INTO eats_orders (user_sub, store_id, store_name, items, total, handoff_url)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6)`, [sub, cart.store_id, cart.store_name, JSON.stringify(items), (0, cart_totals_1.formatCents)(totalCents), url]);
    return { checkoutUrl: url, total, totalCents, store: cart.store_name };
}
/** Up to 12 dishes from the first three restaurants' menus (the concierge's only addable items). */
async function menuCandidates(run, restaurants) {
    const menus = await Promise.all(restaurants.slice(0, 3).map(async (restaurant) => {
        if (!restaurant?.productId)
            return [];
        const menu = await run(['menu', String(restaurant.productId)]);
        return menu.items || [];
    }));
    return menus.flat().slice(0, 12);
}
/**
 * @description The concierge's "remember" entries worth saving: trimmed, non-empty, not already saved and not repeated
 * in the same turn (case and spacing ignored). The concierge re-saved "wants spicy food" on every turn after one
 * earlier "something spicy for dinner", and the growing notes then read as part of each new request.
 * @param remember - The envelope's remember list.
 * @param saved - The diner's saved notes.
 * @returns The notes to save, in order.
 */
function newNotes(remember, saved) {
    const key = (n) => String(n ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    const seen = new Set((saved || []).map(key));
    const out = [];
    for (const note of remember || []) {
        const k = key(note);
        if (!k || seen.has(k))
            continue;
        seen.add(k);
        out.push(String(note).trim());
    }
    return out;
}
/** With no rail no search ran: the concierge must not report an empty result for a search that never happened. */
const NO_SEARCH_CANDIDATES = '(no search ran: this installation has no Uber Eats rail, so there are no restaurants or dishes to offer. Never say a search came back empty, found nothing, or that nothing matched.)';
function buildConciergePrompt(o) {
    const p = o.profile || {};
    const profileLine = p.onboarded
        ? `diet:${(p.dietary || []).join(',') || 'none'} | cuisines:${(p.favorite_cuisines || []).join(',') || 'any'} | address:${p.default_address || 'ask'} | budget:${p.budget_per_order ? '$' + p.budget_per_order : 'n/a'}`
        : 'NOT ONBOARDED — warmly ask one or two questions first (dietary needs, favorite cuisines, delivery address, per-order budget), then save the profile.';
    const prods = (o.candidates || [])
        .map((c) => `- id:${c.productId} | ${c.title}${c.cuisine ? ` (${c.cuisine})` : ''}${typeof c.price === 'number' ? ` | $${c.price.toFixed(2)}` : c.priceFrom != null ? ` | from $${Number(c.priceFrom).toFixed(2)}` : ''}${c.etaMinutes ? ` | ~${c.etaMinutes}min` : ''}`)
        .join('\n') || (o.railNote ? NO_SEARCH_CANDIDATES : '(no results for this message — ask what they\'re hungry for, or that nothing matched)');
    const cart = (o.cart || []).map((c) => `- ${c.title} ×${c.quantity}${c.store_name ? ` @ ${c.store_name}` : ''}`).join('\n') || '(empty)';
    const notes = newNotes(o.notes || [], []).map((n) => `- ${n}`).join('\n') || '(none yet)';
    const convo = (o.history || []).map((h) => `${h.role === 'assistant' ? 'You' : 'Diner'}: ${h.content}`).join('\n');
    return [
        'You are the Eats Concierge — a warm, fast food-ordering assistant on Uber Eats. Help the diner find a restaurant + dishes, build ONE order, then hand off a checkout. Never take payment, never invent a restaurant/dish/price.',
        'Be conversational and brief. Ask ONE good question when it helps (cuisine? budget? how many?). Only show or add items from CANDIDATES below, by id. Keep ONE restaurant per order; if they pick another, confirm it\'s a new order. Set "checkout": true only when they ask to order.',
        '"remember" only a NEW food preference the diner states in THIS message: not one already under SAVED PREFERENCES, not a guess, and never a status such as onboarding or a missing address.',
        '',
        o.railNote ? `CANDIDATES (none: search is not available on this installation):\n${prods}` : `CANDIDATES (real, from search — the ONLY items you may show or add):\n${prods}`,
        o.railNote ? `THIS INSTALLATION: ${o.railNote} Say so plainly when the diner wants a restaurant, a menu or an order, and help with what to eat, dietary needs and saved preferences instead. Never tell the diner to connect Uber Eats or add an Uber Eats connection: there is no Uber Eats connector to add here.` : '',
        '',
        `DINER PROFILE: ${profileLine}`,
        o.restrictions || '',
        `CURRENT ORDER:\n${cart}`,
        `SAVED PREFERENCES (from earlier conversations, NOT part of this request: never fold one into your summary of what the diner asked; if one matters, ask about it as its own question, e.g. "Last time you wanted spicy food. Still want that?"):\n${notes}`,
        '',
        convo ? `CONVERSATION SO FAR:\n${convo}` : '',
        '',
        `DINER: ${o.message}`,
        '',
        'Reply with ONLY a JSON object, nothing around it:',
        '{ "say": "your reply (ask a question when useful)", "show": ["candidate id", ...], "add": [{"productId":"id","quantity":1,"reason":"why"}], "remember": ["a preference to save"], "checkout": false }',
    ].filter(Boolean).join('\n');
}
/**
 * @description Repair the one malformation a local model was seen to emit: an object whose fields are not separated by
 * commas (a value's closing quote, bracket or literal, a newline, then the next "key"). Only that shape is touched.
 * @param s - The candidate object text.
 * @returns The text with the missing field commas inserted.
 */
function insertMissingFieldCommas(s) {
    return s.replace(/("|\]|\}|true|false|null|\d)(\s*\n\s*)("[A-Za-z_]+"\s*:)/g, '$1,$2$3');
}
/**
 * @description The "say" string of an envelope whose JSON cannot be parsed even after repair, read as a JSON string literal.
 * @param s - The candidate object text.
 * @returns The decoded say text, or '' when none is present.
 */
function sayFromBrokenEnvelope(s) {
    const m = s.match(/"say"\s*:\s*("(?:[^"\\]|\\.)*")/);
    if (!m)
        return '';
    try {
        return String(JSON.parse(escapeRawControls(m[1])));
    }
    catch {
        return '';
    }
}
/**
 * @description Escape the raw control characters (a newline, a tab) a model writes inside a JSON string literal, which
 * JSON.parse refuses. Round 8: a reply whose "say" held a raw newline lost its whole text and the diner saw the route's
 * fallback instead. Only characters inside string literals are touched; the layout between fields is left as it is.
 * @param s - The candidate object (or string literal) text.
 * @returns The same text with every control character inside a string literal written as its JSON escape.
 */
function escapeRawControls(s) {
    let out = '';
    let inString = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inString && c === '\\') {
            out += c + (s[i + 1] ?? '');
            i++;
            continue;
        }
        if (c === '"')
            inString = !inString;
        const code = c.charCodeAt(0);
        out += inString && code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : c;
    }
    return out;
}
function envelopeFrom(o, fallbackSay) {
    return {
        say: (0, concierge_reply_1.cleanConciergeReply)(o.say, fallbackSay),
        show: Array.isArray(o.show) ? o.show.map(String) : [],
        add: Array.isArray(o.add)
            ? o.add.filter((a) => a && a.productId).map((a) => ({ productId: String(a.productId), quantity: Number(a.quantity) || 1, reason: a.reason ? String(a.reason) : undefined }))
            : [],
        remember: Array.isArray(o.remember) ? o.remember.map(String).filter(Boolean) : [],
        checkout: !!o.checkout,
    };
}
/**
 * @description The concierge's reply envelope. Sweep 8: the model answered an object with no commas between its fields,
 * JSON.parse failed and the whole raw object was shown to the diner as the reply. A missing-comma object is repaired;
 * anything still unparsable that is shaped like the envelope shows only its "say" text (nothing is added, saved or
 * checked out), and never the raw object. Plain prose with no object is still the reply.
 * @param text - The concierge's raw answer.
 * @returns The envelope to act on.
 */
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
    const body = s.slice(start, end + 1);
    for (const candidate of [body, insertMissingFieldCommas(body), insertMissingFieldCommas(escapeRawControls(body))]) {
        // A parsed envelope's empty say stays empty (the route then answers its own default), never the raw object.
        try {
            return envelopeFrom(JSON.parse(candidate), '');
        }
        catch { /* try the next form */ }
    }
    if (!/"say"\s*:/.test(body))
        return fallback;
    return { say: sayFromBrokenEnvelope(body), show: [], add: [], remember: [], checkout: false };
}
/**
 * @description The concierge's words without chat Markdown marks. The in-app bubble shows text as written, so
 * "1. **Mushroom Risotto**" reached the diner with its asterisks (sweep 12). Bold and italic marks around words and
 * heading marks at a line start are taken out; the words, numbers and list lines stay.
 * @param text - The reply text.
 * @returns The same words with those marks left out.
 */
function plainProse(text) {
    return String(text || '')
        .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, '$2')
        .replace(/(^|[\s(])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?=[\s).,!?;:]|$)/gm, '$1$2')
        .replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
}
const NOTE_FILLER = new Set(['want', 'wants', 'wanted', 'like', 'likes', 'food', 'foods', 'meal', 'meals', 'something', 'prefer', 'prefers', 'preference', 'preferences', 'please', 'would', 'some', 'order', 'orders', 'with', 'that', 'this', 'from', 'have', 'just'].map(stemWord));
/** Food words under four letters that still name what a person eats or must not eat. */
const SHORT_FOOD = new Set(['egg', 'soy', 'nut', 'oat', 'rye', 'pea', 'fig', 'ham', 'yam', 'tea', 'gum']);
/** A note that records an allergy, an intolerance or a diet: one the diner states is never dropped. */
const RESTRICTION_NOTE = /allerg|intoleran|celiac|coeliac|anaphyla|vegan|vegetarian|pescatarian|halal|kosher|gluten|dairy|lactose/;
/** A message that states an allergy, an intolerance, a diet or a food the person cannot eat. */
const RESTRICTION_SAID = /allerg|intoleran|celiac|coeliac|anaphyla|epi-?pen|can'?t (?:eat|have)|cannot (?:eat|have)|don'?t eat|do not eat|avoid|sensitiv|vegan|vegetarian|pescatarian|halal|kosher|gluten|dairy|lactose/;
/**
 * @description A word's stem, so a paraphrase still matches: "allergic", "allergy" and "allergies" are all "allerg";
 * "peanuts" is "peanut"; "onions" is "onion"; "spicy" and "spice" are "spic". Deliberately light: one suffix removed.
 * @param word - One lower-case word.
 * @returns The stem.
 */
function stemWord(word) {
    const w = String(word || '').toLowerCase().replace(/'s$/, '');
    if (w.length > 4 && w.endsWith('ies'))
        return w.slice(0, -3);
    for (const suffix of ['ically', 'ical', 'ic', 'es', 's', 'y', 'e']) {
        if (w.length - suffix.length >= 3 && w.endsWith(suffix))
            return w.slice(0, -suffix.length);
    }
    return w;
}
function noteWords(text) {
    return String(text || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").split(/[^a-z0-9']+/)
        .map((w) => w.replace(/^'+|'+$/g, ''))
        .filter((w) => /^\d+$/.test(w) || w.length >= 4 || SHORT_FOOD.has(stemWord(w)))
        .map(stemWord)
        .filter((w) => w && !NOTE_FILLER.has(w));
}
/**
 * @description The remember entries the diner actually stated in THIS message: each must share a word stem with the
 * message (filler such as "food" or "want" does not count), and an allergy, intolerance or diet note is always kept when
 * the message states one. Sweep 8: asked "something vegetarian for two people under 30 dollars", the concierge's
 * remember list held "spicy preference", "address: pending", "budget: cheap" and "not on boarded" - none of which the
 * diner said - and the prompt rule alone did not stop it. Round 8 review: matching whole words dropped "peanut allergy"
 * and "no onions" for "I'm allergic to peanuts, hold the onion", so a stated allergy was never saved.
 * @param remember - The envelope's remember list.
 * @param message - The diner's message this turn.
 * @returns The entries grounded in the message, in order.
 */
function statedNotes(remember, message) {
    const said = new Set(noteWords(message));
    const restrictionSaid = RESTRICTION_SAID.test(String(message || '').toLowerCase().replace(/[\u2018\u2019]/g, "'"));
    return (remember || []).filter((note) => noteWords(note).some((w) => said.has(w)) || (restrictionSaid && RESTRICTION_NOTE.test(String(note || '').toLowerCase())));
}
async function loadProfile(pool, sub) {
    const r = await pool.query(`SELECT * FROM eats_profile WHERE user_sub = $1`, [sub]);
    return r.rows[0] || { user_sub: sub, onboarded: false, dietary: [], favorite_cuisines: [] };
}
/**
 * @description Check this turn's dishes against the diner's allergies and diet before the concierge sees them. Demo
 * sweep 2: after "I have noted your peanut allergy" the concierge suggested a Vegetarian Pad Thai with no warning. The
 * restrictions come from the message, the saved notes and the profile's dietary list; a dish that names an allergen or
 * is usually made with it is held back (never offered, shown or added), and the prompt states the restrictions as facts.
 * @param message - The diner's message.
 * @param notes - The saved concierge notes.
 * @param profile - The diner's profile row.
 * @param candidates - The menu dishes search returned.
 * @returns The restrictions, the safe and held dishes, and the prompt block.
 */
function allergyGuard(message, notes, profile, candidates) {
    const restrictions = (0, allergen_check_1.dinerRestrictions)([message, ...(notes || []), ...((profile && profile.dietary) || [])]);
    const { safe, held } = (0, allergen_check_1.holdConflicting)(candidates, restrictions);
    return { restrictions, safe, held, block: (0, allergen_check_1.restrictionPrompt)(restrictions, held) };
}
/**
 * @description One concierge reasoning turn through the accountable bot (cost and audit stay on eats-concierge).
 * @param ctx - The app context.
 * @param sub - The verified diner.
 * @param prompt - The assembled prompt.
 * @returns The concierge's raw text, or '' when the dispatch failed (logged).
 */
async function askConcierge(ctx, sub, prompt) {
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
        return String(result?.response || '').trim();
    }
    catch (e) {
        logger.error({ e }, 'eats concierge dispatch failed');
        return '';
    }
}
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
        const rail = await uberEatsRail(pool, sub);
        if (rail.absent) {
            res.json({ uberConnected: false, rail: 'absent', railNote: exports.EATS_NO_RAIL });
            return;
        }
        const r = await pool.query(`SELECT 1 FROM oshal_connections WHERE provider='uber' AND (user_sub=$1 OR tenant_id IS NOT NULL) LIMIT 1`, [sub]);
        res.json({ uberConnected: !!r.rowCount, rail: 'provider' });
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
    // A read never creates the cart: with none yet, the ids and store are null (see readCart).
    router.get('/cart', diner(async (_req, res, sub) => {
        res.json(await readCart(pool, sub));
    }));
    // The line is priced by the SERVER from the restaurant's menu: the body names storeId and
    // productId, and price, title, store name and image come from the menu item that matches both.
    // A client-sent price is ignored and an item the menu does not list is refused.
    router.post('/cart/items', diner(async (req, res, sub) => {
        const b = req.body || {};
        const storeId = String(b.storeId || '').trim();
        const productId = String(b.productId || b.itemId || '').trim();
        if (!STORE_ID.test(storeId) || !ITEM_ID.test(productId)) {
            res.status(400).json({ error: 'storeId and productId are required' });
            return;
        }
        const item = await menuItemFor((args) => uberEatsProviderOperation(pool, sub, args), storeId, productId);
        if (!item) {
            res.status(422).json({ error: 'unknown_item', message: 'That dish is not on the restaurant\'s menu, so it was not added.' });
            return;
        }
        const { row, storeSwitched } = await addToCart(pool, sub, item, Number(b.quantity) || 1);
        const loaded = await loadCart(pool, sub);
        res.json({ item: row, storeSwitched, storeName: loaded.cart.store_name, ...cartBody(loaded) });
    }));
    router.delete('/cart/items/:rowId', diner(async (req, res, sub) => {
        await pool.query(`UPDATE eats_cart_items SET status = 'removed' WHERE row_id = $1 AND user_sub = $2`, [req.params.rowId, sub]);
        const loaded = await loadCart(pool, sub);
        res.json({ ok: true, storeName: loaded.cart.store_name, ...cartBody(loaded) });
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
        res.json({ checkoutUrl: r.checkoutUrl, total: r.total, totalCents: r.totalCents, store: r.store,
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
    router.get('/profile', diner(async (_req, res, sub) => {
        res.json({ profile: await loadProfile(pool, sub), remembered: (0, remembered_notes_1.rememberedList)(await store.loadNotes(sub, 100)) });
    }));
    // Forget one remembered note, every saved copy of it. Body: { note }.
    router.post('/notes/forget', diner(async (req, res, sub) => {
        const note = String(req.body?.note || '').trim();
        if (!note || note.length > 2000) {
            res.status(400).json({ error: 'note is required' });
            return;
        }
        const forgotten = await (0, remembered_notes_1.forgetNote)(pool, store, sub, note);
        if (!forgotten) {
            res.status(404).json({ error: 'Nothing remembered matches that note.' });
            return;
        }
        res.json({ ok: true, note, forgotten });
    }));
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
        const rail = await uberEatsRail(pool, sub);
        const searchRes = rail.absent ? { items: [], source: 'unavailable' } : await uberEatsProviderOperation(pool, sub, ['search', message, '6']);
        const candidates = await menuCandidates((args) => uberEatsProviderOperation(pool, sub, args), searchRes.items || []);
        // Every dish is checked against the diner's allergies and diet first: a held dish is never offered, shown or added.
        const allergy = allergyGuard(message, notes, profile, candidates);
        const candById = new Map(allergy.safe.map((item) => [String(item.productId), item]));
        const prompt = buildConciergePrompt({ message, history, candidates: allergy.safe, cart: currentCart.items, profile, notes, railNote: rail.absent ? exports.EATS_NO_RAIL : '', restrictions: allergy.block });
        const env = parseEnvelope(await askConcierge(ctx, sub, prompt));
        env.say = plainProse(env.say);
        const shown = env.show.length
            ? env.show.map((id) => candById.get(id)).filter(Boolean)
            : allergy.safe.slice(0, 6);
        // The fallback names options only when cards really go out with it (round 8: it claimed options that the
        // diner never saw).
        if (!env.say)
            env.say = shown.length
                ? 'I found a few options. Pick one or tell me what to add.'
                : "I'm having trouble reaching my assistant right now — give me a moment and try again.";
        const added = [];
        for (const request of env.add) {
            const product = candById.get(request.productId);
            if (!product)
                continue;
            const { row } = await addToCart(pool, sub, product, request.quantity);
            added.push({ ...product, rowId: row.row_id, quantity: (0, cart_totals_1.lineQuantity)(request.quantity), reason: request.reason });
        }
        const remembered = newNotes(statedNotes(env.remember, message), notes);
        for (const note of remembered)
            await store.saveNote(sub, note);
        const nextCart = await loadCart(pool, sub);
        // The concierge may decide the diner wants to order; it may not hand off on its own. A
        // proposal is returned for the surface's confirm card and NOTHING outward-facing happens
        // (no deep link, no eats_orders row) until the diner confirms, which calls POST /order.
        const proposal = env.checkout ? orderProposal(nextCart) : null;
        // A dish the reply names that usually carries one of the diner's restrictions, in a sentence that does not name the
        // risk, gets its own allergy-check line; the concierge's words stay as written.
        const check = (0, allergen_check_1.allergyCheckLine)((0, allergen_check_1.unwarnedMentions)(env.say, allergy.restrictions));
        await store.addMessage(conversationId, sub, 'assistant', check ? `${env.say}\n${check}` : env.say);
        await store.touch(conversationId);
        res.json({
            conversationId,
            reply: env.say,
            cards: shown,
            added,
            remembered,
            allergy: { restrictions: allergy.restrictions.map((r) => r.label), heldBack: allergy.held, check },
            // `checkout` is kept for response-shape compatibility and is always null now: a hand-off is
            // created only by the diner's confirm (POST /order), never by the chat turn.
            checkout: null,
            proposal,
            cart: { cartId: nextCart.cart.cart_id, storeId: nextCart.cart.store_id, storeName: nextCart.cart.store_name, ...cartBody(nextCart) },
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