/**
 * Purchasing Routes — Shopping Concierge surface API
 *
 * Backs the Shop surface at /cockpit?app=purchasing. The framework way:
 *  - PRODUCTS come from the core Walmart provider helper. The controller resolves the operator's
 *    credential for one fixed server operation and passes it as a request-scoped function argument;
 *    no child environment or model dispatch carries it.
 *  - The BRAIN runs on the shopping-concierge bot via ctx.orchestrator (the caller's
 *    configured provider/model, cost captured), NOT a hardcoded LLM call here.
 *  - Cart / preferences / feedback persist per-shopper in the DB and feed the bot's memory.
 *  - ORDER is a deep link the shopper opens in a new window and completes on their own
 *    Walmart login — we never take payment or hold shopper credentials.
 *
 * Per-user isolation: every row is scoped by the OIDC `sub`.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * 2026-06-18 | roger.murphy@agenticfederal.us | Initial creation
 * 2026-06-18 | roger.murphy@agenticfederal.us | Reworked to the connector + orchestrator
 *            | pattern: products via the Walmart connector CLI (broker cred), brain via
 *            | the bot orchestrator (configured provider), deep-link checkout.
 * 2026-07-18 13:10:00 | roger.murphy@emeraldcoastsystemsgroup.com | ADR-085 carve-out into the
 *            | purchasing store package (Wave 2 #5). Standard (ctx) factory; the two surfaces +
 *            | purchasing.css serve from this package tools/ (ctx.appPackageDir); core-remaining
 *            | relative imports rewritten to @/app/routes aliases (concierge-reply is SHARED —
 *            | nothing vendors). ensurePurchasingSchema now appends buildOwnerRlsPolicyStatements
 *            | per user-owned table (A1.2 chokepoint). oshal-walmart.js stays core in the image
 *            | (shop-concierge bot + this route both shell it). The shop-concierge REAL bot-node
 *            | (purchasing container / registries / personas / walmart*.js + purchasingTools.js)
 *            | stays core per ADR-093 interim. Logic unchanged.
 * ---------------------------------------------------------------------------
 * 2026-08-06 10:15:00 | maintainer@emeraldcoastsystemsgroup.com | SECURITY: remove Walmart credentials from generic orchestrator dispatch. Catalog access resolves a fixed-server-operation credential only inside the deterministic CLI helper; the model receives bounded product records and never a credential map.
 * 2026-08-06 | maintainer@emeraldcoastsystemsgroup.com | SECURITY: remove the final credential-bearing subprocess boundary. Walmart catalog/deep-link work now calls the import-safe core provider helper with one explicit request-scoped credential value.
 *
 * @module purchasing-routes
 */

import { Router, type Request, type Response, type RequestHandler } from 'express';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createChildLogger } from '@/shared/logger';
import { buildOwnerRlsPolicyStatements, runRuntimeSchemaBootstrap } from '@/shared/services/database';
import type { AppContext } from '@/app/composition/app-context';
import type { Pool } from 'pg';
import { getTrustedServiceUserSub } from '@/shared/middleware/authz';
import { resolveServerOperationCreds } from '@/app/routes/connector-token-broker';
import { runWalmartProviderOperation } from '@/app/routes/provider-operation-clients';
import { cleanConciergeReply } from '@/app/routes/concierge-reply';

const logger = createChildLogger({ module: 'purchasing-routes' });

/** The shopping-concierge agent (seeded by migration 036; inline bot run via the orchestrator). */
const CONCIERGE_AGENT_ID = 'b0070000-0000-0000-0000-000000000001';

/** Serve a static surface file from the package tools dir (ctx.appPackageDir — D10). */
function serveFile(surfaceDir: string, fileName: string): RequestHandler {
  return (_req: Request, res: Response) => {
    const filePath = path.join(surfaceDir, fileName);
    res.sendFile(filePath, (err: unknown) => {
      if (err) {
        logger.error({ err, fileName }, `Failed to serve ${fileName}`);
        res.status(404).send(`Page not found: ${fileName}`);
      }
    });
  };
}

/** The authenticated shopper, resolved from the OIDC session (never client-supplied). */
function resolveShopperSub(req: Request): string {
  const trustedSub = getTrustedServiceUserSub(req);
  if (trustedSub) return trustedSub;
  const oidc = (req as any).oidc;
  if (oidc && typeof oidc.isAuthenticated === 'function' && oidc.isAuthenticated()) {
    const u = oidc.user || {};
    const sub = u.sub || u.oid;
    if (sub) return String(sub);
  }
  if (process.env.MOCK_OIDC === 'true') return 'demo-shopper';
  throw Object.assign(new Error('Not authenticated'), { status: 401 });
}

/** Normalize a free-text intent into a stable preference key. */
function itemKey(intent: string): string {
  return String(intent || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 160);
}

/**
 * Run one deterministic Walmart operation with the caller's request-scoped credential.
 * The import-safe core helper receives the credential directly and cannot consult a child
 * environment. Demo JSON retains its bounded fallbackReason/providerError diagnostic.
 */
async function walmartProviderOperation(pool: Pool, sub: string, args: string[]): Promise<any> {
  const creds = await resolveServerOperationCreds(
    pool as unknown as never,
    sub,
    ['walmart'],
    'fixed-server-operation',
  );
  return runWalmartProviderOperation(creds.OSHAL_CRED_WALMART, args);
}

// ── Conversational concierge helpers ─────────────────────────────────────────

interface WalmartProviderDiagnostic {
  code: 'http_error' | 'request_failed';
  status?: number;
  message: string;
}

interface WalmartFallbackMetadata {
  fallbackReason?: 'not_connected' | 'provider_error';
  providerError?: WalmartProviderDiagnostic;
}

/** Keep the provider diagnostic bounded even if a malformed helper result crosses the boundary. */
export function walmartFallbackMetadata(value: unknown): WalmartFallbackMetadata {
  if (!value || typeof value !== 'object') return {};
  const input = value as Record<string, unknown>;
  if (input.fallbackReason === 'not_connected') return { fallbackReason: 'not_connected' };
  if (input.fallbackReason !== 'provider_error') return {};
  const raw = input.providerError && typeof input.providerError === 'object'
    ? input.providerError as Record<string, unknown>
    : {};
  const status = Number(raw.status);
  const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
  const code = raw.code === 'http_error' && safeStatus ? 'http_error' : 'request_failed';
  const fallbackMessage = safeStatus
    ? `Walmart provider returned HTTP ${safeStatus}.`
    : 'Walmart provider request could not be completed.';
  return {
    fallbackReason: 'provider_error',
    providerError: { code, ...(safeStatus ? { status: safeStatus } : {}), message: fallbackMessage.slice(0, 160) },
  };
}

/** Only a clean live-Walmart response may cause product/cart mutations in the chat workflow. */
export function walmartCatalogAllowsActions(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return input.source === 'walmart'
    && !Object.prototype.hasOwnProperty.call(input, 'fallbackReason')
    && !Object.prototype.hasOwnProperty.call(input, 'providerError')
    && !Object.prototype.hasOwnProperty.call(input, 'error');
}

interface ChatEnvelope {
  say: string;
  show: string[];
  add: Array<{ productId: string; quantity: number; reason?: string }>;
  remember: string[];
  checkout: boolean;
}

/** Clear model-requested cart actions whenever the catalog rows are not trusted live products. */
export function enforceWalmartCatalogActionPolicy(
  envelope: Pick<ChatEnvelope, 'say' | 'add' | 'checkout'>,
  catalogResponse: unknown,
): boolean {
  if (walmartCatalogAllowsActions(catalogResponse) || (!envelope.add.length && !envelope.checkout)) return false;
  const diagnostic = walmartFallbackMetadata(catalogResponse);
  envelope.add = [];
  envelope.checkout = false;
  envelope.say = diagnostic.fallbackReason === 'provider_error'
    ? 'Walmart is connected, but its provider request failed. The cards are demo examples, so I did not add anything or start checkout.'
    : diagnostic.fallbackReason === 'not_connected'
      ? 'Walmart is not connected. The cards are demo examples, so I did not add anything or start checkout.'
      : 'The Walmart catalog is unavailable. I did not add anything or start checkout.';
  return true;
}

/** Build the single prompt the concierge bot reasons over: rules + memory + real candidates + turn. */
function buildConciergePrompt(o: {
  message: string; history: Array<{ role: string; content: string }>;
  candidates: any[]; cart: any[]; prefs: any[]; notes: string[];
  profile?: any; suggestions?: any[];
  catalog?: { source?: string } & WalmartFallbackMetadata;
}): string {
  const p = o.profile || {};
  const profileLine = p.onboarded
    ? `household:${p.household_size ?? '?'} | diet:${(p.dietary || []).join(',') || 'none'} | store:${p.preferred_store || 'any'} | budget:${p.budget_monthly ? '$' + p.budget_monthly : 'n/a'}${p.notes ? ` | notes:${p.notes}` : ''}`
    : 'NOT ONBOARDED — run the short intro (household size, dietary needs, preferred store, monthly budget) before deep shopping, one or two questions at a time, and save via the profile.';
  const sugg = (o.suggestions || []).map((s) => `- ${s.title || s.item_key}${s.buy_count > 1 ? ` (bought ${s.buy_count}×)` : ''}`).join('\n') || '(none yet)';
  const prods = (o.candidates || [])
    .map((c) => `- id:${c.productId} | ${c.title} | $${typeof c.price === 'number' ? c.price.toFixed(2) : '?'} | ${c.retailer}${c.onSale ? ' | ROLLBACK' : ''}`)
    .join('\n') || '(no products retrieved for this message — ask what to search, or that nothing matched)';
  const cart = (o.cart || []).map((c) => `- ${c.title} ×${c.quantity}`).join('\n') || '(empty)';
  const prefs = (o.prefs || [])
    .map((p) => `- ${p.item_key}: usually ${p.title}${p.brand ? ` (${p.brand})` : ''}${p.buy_count > 1 ? ` ×${p.buy_count}` : ''}`)
    .join('\n') || '(none yet)';
  const notes = (o.notes || []).map((n) => `- ${n}`).join('\n') || '(none yet)';
  const convo = (o.history || []).map((h) => `${h.role === 'assistant' ? 'You' : 'Shopper'}: ${h.content}`).join('\n');
  const catalogStatus = o.catalog?.fallbackReason === 'provider_error'
    ? `DEMO FALLBACK — a Walmart credential was present, but the provider request failed${o.catalog.providerError?.status ? ` with HTTP ${o.catalog.providerError.status}` : ''}. Do not describe Walmart as disconnected. These rows are reference-only; return add:[] and checkout:false.`
    : o.catalog?.fallbackReason === 'not_connected'
      ? 'DEMO FALLBACK — Walmart is not connected. These rows are reference-only; return add:[] and checkout:false.'
      : o.catalog?.source === 'walmart' ? 'LIVE WALMART RESULTS.' : 'UNKNOWN CATALOG SOURCE.';
  return [
    'You are the Shopping Concierge — a warm, sharp procurement assistant. Help the shopper look up, review, and pick products, then hand off a checkout. Never take payment, never invent a product or price. Call products live/real only when CATALOG STATUS says LIVE.',
    'Be conversational and brief. Ask ONE good clarifying question when it helps (size? brand? budget? quantity?). Only recommend or add products from CANDIDATES below, by id. Respect the shopper\'s usual brands + remembered preferences; when they teach you a new one ("I like organic", "the big size", "avoid X"), capture it in "remember". Add to cart when they clearly want an item; set "checkout": true only when they ask to order.',
    '',
    `CATALOG STATUS: ${catalogStatus}`,
    `CANDIDATES (the ONLY products you may show or add):\n${prods}`,
    '',
    `SHOPPER PROFILE: ${profileLine}`,
    `CART (the shopper's ONE open cart — keep it organized + deduped):\n${cart}`,
    `LIKELY REORDERS (from history — suggest gently when relevant):\n${sugg}`,
    `MEMORY — usual items:\n${prefs}`,
    `MEMORY — preferences the shopper taught you:\n${notes}`,
    '',
    convo ? `CONVERSATION SO FAR:\n${convo}` : '',
    '',
    `SHOPPER: ${o.message}`,
    '',
    'Reply with ONLY a JSON object, nothing around it:',
    '{ "say": "your reply (ask a question when useful)", "show": ["candidate id", ...], "add": [{"productId":"id","quantity":1,"reason":"why"}], "remember": ["a preference to save"], "checkout": false }',
  ].filter(Boolean).join('\n');
}

/** Parse the concierge's JSON envelope, tolerating code fences / stray prose. */
function parseEnvelope(text: string): ChatEnvelope {
  const fallback: ChatEnvelope = { say: cleanConciergeReply(text), show: [], add: [], remember: [], checkout: false };
  if (!text) return fallback;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start === -1 || end === -1) return fallback;
  try {
    const o = JSON.parse(s.slice(start, end + 1));
    return {
      say: cleanConciergeReply(o.say, fallback.say),
      show: Array.isArray(o.show) ? o.show.map(String) : [],
      add: Array.isArray(o.add)
        ? o.add.filter((a: any) => a && a.productId).map((a: any) => ({
            productId: String(a.productId), quantity: Number(a.quantity) || 1,
            reason: a.reason ? String(a.reason) : undefined,
          }))
        : [],
      remember: Array.isArray(o.remember) ? o.remember.map(String).filter(Boolean) : [],
      checkout: !!o.checkout,
    };
  } catch { return fallback; }
}

/** Load the shopper's durable memory: usual SKUs + free-form remembered preferences. */
async function loadMemory(pool: Pool, sub: string): Promise<{ prefs: any[]; notes: string[] }> {
  const prefs = (await pool.query(
    `SELECT item_key, title, brand, retailer, last_unit_price, buy_count
     FROM shop_preferences WHERE user_sub = $1 ORDER BY buy_count DESC, updated_at DESC LIMIT 20`, [sub])).rows;
  const notes = (await pool.query(
    `SELECT note FROM shop_feedback WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 25`, [sub])).rows.map((r) => r.note);
  return { prefs, notes };
}

/** Create tables if a fresh deploy hasn't run the migrations yet. Idempotent. */
export async function ensurePurchasingSchema(pool: Pool): Promise<void> {
  await runRuntimeSchemaBootstrap({
    pool,
    moduleName: 'purchasing routes',
    statements: [`
    CREATE TABLE IF NOT EXISTS shop_lists (
      list_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000c001',
      user_sub VARCHAR(255) NOT NULL, name TEXT NOT NULL DEFAULT 'My List',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS shop_list_items (
      item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      list_id UUID NOT NULL REFERENCES shop_lists(list_id) ON DELETE CASCADE,
      user_sub VARCHAR(255) NOT NULL, retailer VARCHAR(40) NOT NULL DEFAULT 'walmart',
      product_id VARCHAR(128), title TEXT, brand TEXT, image_url TEXT, product_url TEXT,
      quantity INT NOT NULL DEFAULT 1, unit_price NUMERIC(10,2), reason TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS shop_preferences (
      pref_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000c001',
      user_sub VARCHAR(255) NOT NULL, item_key VARCHAR(160) NOT NULL,
      retailer VARCHAR(40), product_id VARCHAR(128), title TEXT, brand TEXT,
      last_quantity INT DEFAULT 1, last_unit_price NUMERIC(10,2), buy_count INT NOT NULL DEFAULT 1,
      reason TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (user_sub, item_key));
    CREATE TABLE IF NOT EXISTS shop_purchase_history (
      purchase_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, retailer VARCHAR(40), order_ref VARCHAR(255),
      items JSONB NOT NULL DEFAULT '[]'::jsonb, total NUMERIC(10,2), handoff_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS shop_feedback (
      feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000c001',
      user_sub VARCHAR(255) NOT NULL, note TEXT NOT NULL, source VARCHAR(20) NOT NULL DEFAULT 'chat',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_feedback_user_note ON shop_feedback (user_sub, lower(note));
    CREATE TABLE IF NOT EXISTS shop_conversations (
      conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) NOT NULL, title TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS shop_messages (
      message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES shop_conversations(conversation_id) ON DELETE CASCADE,
      user_sub VARCHAR(255) NOT NULL, role VARCHAR(16) NOT NULL, content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS shop_profile (
      user_sub VARCHAR(255) PRIMARY KEY,
      tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000c001',
      display_name TEXT, household_size INT, dietary TEXT[] NOT NULL DEFAULT '{}',
      brands_love TEXT[] NOT NULL DEFAULT '{}', brands_avoid TEXT[] NOT NULL DEFAULT '{}',
      preferred_retailer VARCHAR(40) NOT NULL DEFAULT 'walmart', preferred_store TEXT,
      budget_monthly NUMERIC(10,2), notes TEXT, onboarded BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `,
      ...buildOwnerRlsPolicyStatements('shop_lists', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('shop_list_items', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('shop_preferences', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('shop_purchase_history', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('shop_feedback', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('shop_conversations', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('shop_messages', 'user_sub'),
      ...buildOwnerRlsPolicyStatements('shop_profile', 'user_sub'),
    ],
    requirements: [
      { table: 'shop_lists', columns: ['list_id', 'tenant_id', 'user_sub', 'name', 'status', 'created_at', 'updated_at'] },
      { table: 'shop_list_items', columns: ['item_id', 'list_id', 'user_sub', 'retailer', 'product_id', 'title', 'quantity', 'status', 'created_at'] },
      { table: 'shop_preferences', columns: ['pref_id', 'tenant_id', 'user_sub', 'item_key', 'retailer', 'product_id', 'title', 'buy_count', 'updated_at'] },
      { table: 'shop_purchase_history', columns: ['purchase_id', 'user_sub', 'retailer', 'items', 'total', 'handoff_url', 'created_at'] },
      { table: 'shop_feedback', columns: ['feedback_id', 'tenant_id', 'user_sub', 'note', 'source', 'created_at'] },
      { table: 'shop_conversations', columns: ['conversation_id', 'user_sub', 'title', 'created_at', 'updated_at'] },
      { table: 'shop_messages', columns: ['message_id', 'conversation_id', 'user_sub', 'role', 'content', 'created_at'] },
      { table: 'shop_profile', columns: ['user_sub', 'tenant_id', 'display_name', 'household_size', 'dietary', 'preferred_retailer', 'onboarded', 'created_at', 'updated_at'] },
    ],
  });
}

/** Load the shopper's profile row (or a default un-onboarded shell). */
async function loadProfile(pool: Pool, sub: string): Promise<any> {
  const r = await pool.query(`SELECT * FROM shop_profile WHERE user_sub = $1`, [sub]);
  return r.rows[0] || { user_sub: sub, onboarded: false, dietary: [], brands_love: [], brands_avoid: [] };
}

/** Likely reorders: the shopper's most-bought items, freshest first (cadence heuristic). */
async function loadSuggestions(pool: Pool, sub: string): Promise<any[]> {
  const r = await pool.query(
    `SELECT item_key, title, brand, retailer, product_id, last_unit_price, buy_count, updated_at
     FROM shop_preferences WHERE user_sub = $1 AND buy_count >= 1
     ORDER BY buy_count DESC, updated_at ASC LIMIT 8`, [sub]);
  return r.rows;
}

/** Get the shopper's default active list, creating one on first use. */
async function getOrCreateDefaultList(pool: Pool, sub: string): Promise<string> {
  const found = await pool.query(
    `SELECT list_id FROM shop_lists WHERE user_sub = $1 AND status = 'active' ORDER BY created_at LIMIT 1`, [sub]);
  if (found.rows[0]) return found.rows[0].list_id;
  const created = await pool.query(`INSERT INTO shop_lists (user_sub, name) VALUES ($1, 'My List') RETURNING list_id`, [sub]);
  return created.rows[0].list_id;
}

/** Insert one item into a list + learn it as the shopper's usual for that intent. */
async function addItem(pool: Pool, sub: string, listId: string, prod: any, qty: number, reason: string, intentKey: string): Promise<any> {
  const q = Math.max(1, Math.min(10, qty || 1));
  const ins = await pool.query(
    `INSERT INTO shop_list_items (list_id,user_sub,retailer,product_id,title,brand,image_url,product_url,quantity,unit_price,reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [listId, sub, prod.retailer || 'walmart', prod.productId || null, prod.title || null, prod.brand || null,
     prod.imageUrl || null, prod.productUrl || null, q, prod.price ?? null, reason || null]);
  const key = itemKey(intentKey || prod.title || '');
  if (key && prod.productId) {
    await pool.query(
      `INSERT INTO shop_preferences (user_sub,item_key,retailer,product_id,title,brand,last_quantity,last_unit_price,reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (user_sub,item_key) DO UPDATE SET
         retailer=EXCLUDED.retailer, product_id=EXCLUDED.product_id, title=EXCLUDED.title, brand=EXCLUDED.brand,
         last_quantity=EXCLUDED.last_quantity, last_unit_price=EXCLUDED.last_unit_price,
         buy_count=shop_preferences.buy_count+1, updated_at=NOW()`,
      [sub, key, prod.retailer || 'walmart', prod.productId, prod.title || null, prod.brand || null, q, prod.price ?? null, reason || null]);
  }
  return ins.rows[0];
}

/** Build the order deep link for a list's pending items via the request-scoped provider helper. */
async function buildCheckout(pool: Pool, sub: string, listId: string): Promise<{ checkoutUrl: string | null; total: number; orderRef: string | null }> {
  const items = (await pool.query(
    `SELECT * FROM shop_list_items WHERE list_id = $1 AND user_sub = $2 AND status = 'pending'`, [listId, sub])).rows;
  if (!items.length) return { checkoutUrl: null, total: 0, orderRef: null };
  const spec = items.filter((i) => i.product_id).map((i) => `${i.product_id}_${i.quantity}`).join(',');
  const r = await walmartProviderOperation(pool, sub, ['cart', spec]);
  const total = items.reduce((s, i) => s + (Number(i.unit_price) || 0) * (i.quantity || 1), 0);
  await pool.query(
    `INSERT INTO shop_purchase_history (user_sub, retailer, order_ref, items, total, handoff_url)
     VALUES ($1, 'walmart', $2, $3::jsonb, $4, $5)`,
    [sub, r.orderRef || null, JSON.stringify(items), total.toFixed(2), r.checkoutUrl || null]);
  return { checkoutUrl: r.checkoutUrl || null, total: Number(total.toFixed(2)), orderRef: r.orderRef || null };
}

export function createPurchasingRoutes(ctx: AppContext): Router {
  const router = Router();
  const pool = ctx.pool;
  const surfaceDir = ctx.appPackageDir ? path.join(ctx.appPackageDir, 'tools') : path.resolve(process.cwd(), 'tools');

  ensurePurchasingSchema(pool).catch((err) =>
    logger.warn({ err }, 'Purchasing schema bootstrap deferred — tables may not exist yet'));

  const shopper =
    (fn: (req: Request, res: Response, sub: string) => Promise<void>): RequestHandler =>
    async (req, res) => {
      let sub: string;
      try { sub = resolveShopperSub(req); }
      catch (e: any) { res.status(e.status || 401).json({ error: e.message }); return; }
      try { await fn(req, res, sub); }
      catch (err: any) { logger.error({ err, path: req.path }, 'purchasing route error'); res.status(500).json({ error: err.message || 'internal error' }); }
    };

  // ── Surfaces ─────────────────────────────────────────────────────────────--
  router.get('/dashboard', serveFile(surfaceDir, 'shopping-dashboard.html'));
  router.get('/chat', serveFile(surfaceDir, 'shopping-chat.html'));
  router.get('/purchasing.css', serveFile(surfaceDir, 'purchasing.css'));

  router.get('/config', shopper(async (_req, res, sub) => {
    const r = await pool.query(
      `SELECT 1 FROM oshal_connections WHERE provider='walmart' AND (user_sub=$1 OR tenant_id IS NOT NULL) LIMIT 1`, [sub]);
    res.json({ walmartConnected: !!r.rowCount });
  }));

  // ── Live retailer reads (via the request-scoped provider helper) ───────────
  router.get('/search', shopper(async (req, res, sub) => {
    const q = String(req.query.q || req.query.query || '');
    if (!q) { res.json({ items: [] }); return; }
    const r = await walmartProviderOperation(pool, sub, ['search', q, String(Number(req.query.limit) || 8)]);
    const diagnostic = walmartFallbackMetadata(r);
    res.json({
      items: r.items || [], source: r.source || (r.error ? 'error' : 'walmart'),
      ...diagnostic,
      error: diagnostic.providerError?.message || (typeof r.error === 'string' ? r.error.slice(0, 160) : undefined),
    });
  }));

  router.get('/deals', shopper(async (req, res, sub) => {
    const r = await walmartProviderOperation(pool, sub, ['deals', String(req.query.feed || 'rollback')]);
    const diagnostic = walmartFallbackMetadata(r);
    res.json({
      items: r.items || [], feed: r.feed || 'rollback', source: r.source || (r.error ? 'error' : 'walmart'),
      ...diagnostic,
      error: diagnostic.providerError?.message || (typeof r.error === 'string' ? r.error.slice(0, 160) : undefined),
    });
  }));

  // ── Preference brain ─────────────────────────────────────────────────────--
  router.post('/resolve', shopper(async (req, res, sub) => {
    const intent = String(req.body?.item || '');
    if (!intent) { res.status(400).json({ error: 'item is required' }); return; }
    const pref = await pool.query(`SELECT * FROM shop_preferences WHERE user_sub = $1 AND item_key = $2`, [sub, itemKey(intent)]);
    if (pref.rows[0]?.product_id) {
      const p = pref.rows[0];
      res.json({ hasUsual: true, item: { retailer: p.retailer, productId: p.product_id, title: p.title, brand: p.brand, price: p.last_unit_price != null ? Number(p.last_unit_price) : null, quantity: p.last_quantity || 1 },
        reason: `Your usual ${intent} — ${p.title}${p.buy_count > 1 ? ` (bought ${p.buy_count}×)` : ''}.` });
      return;
    }
    const r = await walmartProviderOperation(pool, sub, ['search', intent, '1']);
    const diagnostic = walmartFallbackMetadata(r);
    res.json({
      hasUsual: false, item: r.items?.[0] || null,
      reason: r.items?.[0] ? `Best match for ${intent}.` : null,
      source: r.source || (r.error ? 'error' : 'walmart'), ...diagnostic,
      error: diagnostic.providerError?.message || (typeof r.error === 'string' ? r.error.slice(0, 160) : undefined),
    });
  }));

  router.get('/preferences', shopper(async (_req, res, sub) => {
    const r = await pool.query(
      `SELECT item_key, retailer, product_id, title, brand, last_quantity, last_unit_price, buy_count, updated_at
       FROM shop_preferences WHERE user_sub = $1 ORDER BY buy_count DESC, updated_at DESC`, [sub]);
    res.json({ preferences: r.rows });
  }));

  // ── Lists / cart ───────────────────────────────────────────────────────────
  router.get('/lists', shopper(async (_req, res, sub) => {
    const r = await pool.query(
      `SELECT l.list_id, l.name, l.status, l.created_at,
              COUNT(i.item_id) FILTER (WHERE i.status = 'pending') AS item_count
       FROM shop_lists l LEFT JOIN shop_list_items i ON i.list_id = l.list_id
       WHERE l.user_sub = $1 GROUP BY l.list_id ORDER BY l.created_at`, [sub]);
    res.json({ lists: r.rows });
  }));

  router.post('/lists', shopper(async (req, res, sub) => {
    const name = String(req.body?.name || 'My List').slice(0, 200);
    const r = await pool.query(`INSERT INTO shop_lists (user_sub, name) VALUES ($1, $2) RETURNING list_id, name, status, created_at`, [sub, name]);
    res.json({ list: r.rows[0] });
  }));

  router.get('/lists/:listId/items', shopper(async (req, res, sub) => {
    const r = await pool.query(
      `SELECT * FROM shop_list_items WHERE list_id = $1 AND user_sub = $2 AND status != 'removed' ORDER BY created_at`, [req.params.listId, sub]);
    res.json({ items: r.rows });
  }));

  router.post('/lists/:listId/items', shopper(async (req, res, sub) => {
    const b = req.body || {};
    const own = await pool.query(`SELECT 1 FROM shop_lists WHERE list_id = $1 AND user_sub = $2`, [req.params.listId, sub]);
    if (!own.rowCount) { res.status(403).json({ error: 'not your list' }); return; }
    const item = await addItem(pool, sub, String(req.params.listId),
      { retailer: b.retailer, productId: b.productId, title: b.title, brand: b.brand, imageUrl: b.imageUrl, productUrl: b.productUrl, price: b.price != null ? Number(b.price) : null },
      Number(b.quantity) || 1, b.reason || null, b.itemKey || b.title || '');
    res.json({ item });
  }));

  router.delete('/lists/:listId/items/:itemId', shopper(async (req, res, sub) => {
    await pool.query(`UPDATE shop_list_items SET status = 'removed' WHERE item_id = $1 AND user_sub = $2`, [req.params.itemId, sub]);
    res.json({ ok: true });
  }));

  // ── Checkout handoff (deep link) ───────────────────────────────────────────
  router.post('/checkout', shopper(async (req, res, sub) => {
    const listId = req.body?.listId || (await getOrCreateDefaultList(pool, sub));
    const r = await buildCheckout(pool, sub, listId);
    if (!r.checkoutUrl) { res.status(400).json({ error: 'nothing to check out (or Walmart not connected)' }); return; }
    res.json({ checkoutUrl: r.checkoutUrl, orderRef: r.orderRef, total: r.total,
      note: 'Opens at Walmart — sign in there and check out. This is a tracked handoff, not an in-app charge.' });
  }));

  // ── Conversational concierge (brain runs on the bot via the orchestrator) ──
  router.post('/chat', shopper(async (req, res, sub) => {
    const message = String(req.body?.message || '').trim();
    if (!message) { res.status(400).json({ error: 'message is required' }); return; }

    let conversationId: string = req.body?.conversationId || '';
    if (conversationId) {
      // IDOR guard: only honor a client-supplied conversationId if it belongs to the caller;
      // otherwise ignore it and start fresh — never read or write another user's conversation.
      const owned = await pool.query(`SELECT 1 FROM shop_conversations WHERE conversation_id = $1 AND user_sub = $2`, [conversationId, sub]);
      if (!owned.rows.length) conversationId = '';
    }
    if (!conversationId) {
      const c = await pool.query(`INSERT INTO shop_conversations (user_sub, title) VALUES ($1, $2) RETURNING conversation_id`, [sub, message.slice(0, 80)]);
      conversationId = c.rows[0].conversation_id;
    }
    await pool.query(`INSERT INTO shop_messages (conversation_id, user_sub, role, content) VALUES ($1, $2, 'user', $3)`, [conversationId, sub, message]);
    const history = (await pool.query(
      `SELECT role, content FROM shop_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 12`, [conversationId])).rows.reverse();

    // Catalog candidates from the connector (live or explicitly diagnosed demo fallback; no keys here).
    const searchRes = await walmartProviderOperation(pool, sub, ['search', message, '6']);
    const candidates: any[] = searchRes.items || [];
    const candById = new Map<string, any>(candidates.map((c: any) => [String(c.productId), c]));
    const catalogActionsAllowed = walmartCatalogAllowsActions(searchRes);
    const catalog = {
      ...(typeof searchRes.source === 'string' ? { source: searchRes.source } : {}),
      ...walmartFallbackMetadata(searchRes),
    };

    const listId = await getOrCreateDefaultList(pool, sub);
    const cart = (await pool.query(
      `SELECT product_id, title, quantity, unit_price FROM shop_list_items WHERE list_id = $1 AND user_sub = $2 AND status = 'pending'`, [listId, sub])).rows;
    const { prefs, notes } = await loadMemory(pool, sub);
    const profile = await loadProfile(pool, sub);
    const suggestions = await loadSuggestions(pool, sub);

    // The BRAIN: run the concierge bot via the orchestrator on the caller's configured provider.
    const prompt = buildConciergePrompt({ message, history, candidates, cart, prefs, notes, profile, suggestions, catalog });
    let raw = '';
    try {
      const orchestrator = (ctx as any).orchestrator;
      const result = await orchestrator.processMessage(`purchasing-${sub}-${randomUUID()}`, prompt, {
        agenticMode: false, autoApprove: false, source: 'purchasing', agentId: CONCIERGE_AGENT_ID, userSub: sub,
      });
      raw = String(result?.response || '').trim();
    } catch (e) { logger.error({ e }, 'concierge orchestrate failed'); }
    const env = parseEnvelope(raw);
    if (!env.say) env.say = "I'm having trouble reaching my assistant right now — give me a moment and try again.";
    enforceWalmartCatalogActionPolicy(env, searchRes);

    // Execute the bot's decisions against the DB.
    const added: any[] = [];
    for (const a of env.add) {
      let prod = candById.get(a.productId);
      if (!prod) {
        const lk = await walmartProviderOperation(pool, sub, ['search', a.productId, '1']);
        if (!walmartCatalogAllowsActions(lk)) continue;
        prod = lk.items?.[0];
      }
      if (!prod) continue;
      await addItem(pool, sub, listId, prod, a.quantity, a.reason || 'added in chat', message.length < 40 ? message : prod.title);
      added.push({ ...prod, quantity: Math.max(1, Math.min(10, a.quantity || 1)), reason: a.reason });
    }
    for (const note of env.remember) {
      await pool.query(`INSERT INTO shop_feedback (user_sub, note) VALUES ($1, $2) ON CONFLICT (user_sub, lower(note)) DO NOTHING`, [sub, note.slice(0, 300)]);
    }
    let checkout: { checkoutUrl: string; total: number } | null = null;
    if (env.checkout) {
      const c = await buildCheckout(pool, sub, listId);
      if (c.checkoutUrl) checkout = { checkoutUrl: c.checkoutUrl, total: c.total };
    }

    await pool.query(`INSERT INTO shop_messages (conversation_id, user_sub, role, content) VALUES ($1, $2, 'assistant', $3)`, [conversationId, sub, env.say]);
    await pool.query(`UPDATE shop_conversations SET updated_at = NOW() WHERE conversation_id = $1`, [conversationId]);

    const cards = env.show.map((id) => candById.get(id)).filter(Boolean)
      .map((card) => catalogActionsAllowed ? card : { ...card, demo: true, actionable: false });
    res.json({
      conversationId, reply: env.say, cards,
      added, remembered: env.remember, checkout, ...catalog,
      catalogActionable: catalogActionsAllowed, source: searchRes.source || 'walmart',
      error: catalog.providerError?.message || (typeof searchRes.error === 'string' ? searchRes.error.slice(0, 160) : undefined),
    });
  }));

  // ── Profile (the shopper's preferences DB) + open cart + suggestions ───────-
  router.get('/profile', shopper(async (_req, res, sub) => {
    res.json({ profile: await loadProfile(pool, sub) });
  }));

  router.post('/profile', shopper(async (req, res, sub) => {
    const b = req.body || {};
    const r = await pool.query(
      `INSERT INTO shop_profile
         (user_sub, display_name, household_size, dietary, brands_love, brands_avoid,
          preferred_retailer, preferred_store, budget_monthly, notes, onboarded, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'walmart'),$8,$9,$10,COALESCE($11,false),NOW())
       ON CONFLICT (user_sub) DO UPDATE SET
         display_name=COALESCE(EXCLUDED.display_name, shop_profile.display_name),
         household_size=COALESCE(EXCLUDED.household_size, shop_profile.household_size),
         dietary=COALESCE(EXCLUDED.dietary, shop_profile.dietary),
         brands_love=COALESCE(EXCLUDED.brands_love, shop_profile.brands_love),
         brands_avoid=COALESCE(EXCLUDED.brands_avoid, shop_profile.brands_avoid),
         preferred_retailer=COALESCE(EXCLUDED.preferred_retailer, shop_profile.preferred_retailer),
         preferred_store=COALESCE(EXCLUDED.preferred_store, shop_profile.preferred_store),
         budget_monthly=COALESCE(EXCLUDED.budget_monthly, shop_profile.budget_monthly),
         notes=COALESCE(EXCLUDED.notes, shop_profile.notes),
         onboarded=(EXCLUDED.onboarded OR shop_profile.onboarded), updated_at=NOW()
       RETURNING *`,
      [sub, b.displayName ?? null, b.householdSize ?? null, b.dietary ?? null, b.brandsLove ?? null,
       b.brandsAvoid ?? null, b.preferredRetailer ?? null, b.preferredStore ?? null,
       b.budgetMonthly ?? null, b.notes ?? null, b.onboarded ?? null]);
    res.json({ profile: r.rows[0] });
  }));

  // The shopper's ONE open cart + items — what the assistant works on.
  router.get('/cart', shopper(async (_req, res, sub) => {
    const listId = await getOrCreateDefaultList(pool, sub);
    const items = (await pool.query(
      `SELECT * FROM shop_list_items WHERE list_id=$1 AND user_sub=$2 AND status='pending' ORDER BY created_at`, [listId, sub])).rows;
    const total = items.reduce((s, i) => s + (Number(i.unit_price) || 0) * (i.quantity || 1), 0);
    res.json({ listId, items, total: Number(total.toFixed(2)) });
  }));

  router.get('/suggestions', shopper(async (_req, res, sub) => {
    res.json({ suggestions: await loadSuggestions(pool, sub) });
  }));

  // The shopper's most recent conversation + its messages — so the surface RESUMES
  // the session instead of starting over each time you switch views.
  router.get('/conversation', shopper(async (_req, res, sub) => {
    const conv = (await pool.query(
      `SELECT conversation_id FROM shop_conversations WHERE user_sub = $1 ORDER BY updated_at DESC LIMIT 1`, [sub])).rows[0];
    if (!conv) { res.json({ conversationId: null, messages: [] }); return; }
    const messages = (await pool.query(
      `SELECT role, content FROM shop_messages WHERE conversation_id = $1 ORDER BY created_at`, [conv.conversation_id])).rows;
    res.json({ conversationId: conv.conversation_id, messages });
  }));

  return router;
}
