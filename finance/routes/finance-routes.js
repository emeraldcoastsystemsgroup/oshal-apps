"use strict";
/**
 * Finance routes — the read-only money-aggregation app (ADR-036/037/038).
 *
 * Split, same as kid-lens / home / the comms swarm:
 *  - **Connect + sync** (cheap, deterministic) runs here in the controller: the user links a
 *    bank/brokerage via Plaid Link (or the Sandbox demo path for local testing); we exchange
 *    the public_token for a long-lived access_token, store it AES-256-GCM-encrypted + per-user,
 *    and on /sync fold balances + investment holdings + transactions into a compact aggregate
 *    (finance-plaid.ts) stored user_sub-keyed.
 *  - **Reasoning** (the finance brief: net-worth read, portfolio drift, spend analysis, bill
 *    forecasting) ALWAYS runs on the accountable finance-analyst bot via BotNodeClient.execute,
 *    so per-call cost lands in chat_tasks under the bot's own agent_id (ADR-036). The bot is
 *    reason-only (no connector/CLI), so it runs INLINE on the api container — same path as
 *    kid-lens / deck-builder / social-writer.
 *
 * v1 scope: READ-ONLY aggregation (balances, holdings, transactions). No trade execution
 * (broker-dealer territory — a later bundle), no crypto. See swarm-apps/finance.yaml.
 *
 * Every route is requiresAuth-gated at mount (auth is opt-in per route, CLAUDE.md).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-17 23:58:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — POST /link-token + /exchange (Plaid Link), POST /link-sandbox (localhost demo connect), POST /sync (fold balances+holdings+transactions → per-user aggregate), GET /status + /summary (cheap reads), GET /brief (finance-analyst bot reasons over the aggregate, cached, ?refresh=1), DELETE /items/:itemId, GET / + /ui surfaces. Read-only; reason-only bot runs inline on the api container.
 * 2026-06-17 14:24:00 | roger.murphy@emeraldcoastsystemsgroup.com | Money movement (ADR-048 extension): GET /pay-status, POST /pay (idempotency-keyed transfer via the provider-agnostic PaymentAdapter), GET /pay/:transferId (owner-scoped status refresh), GET /payments (history). Deterministic I/O — no LLM. New owner-scoped oshal_finance_payments audit table.
 * 2026-07-05 19:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | Tier-1 RLS at the lazy-DDL chokepoint (A1.2 follow-up): ensureFinanceSchema now appends buildOwnerRlsPolicyStatements for oshal_finance_items/data/payments so a fresh database is never left policy-less between table creation and a migration-060 re-run.
 * 2026-07-17 21:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | ADR-085 carve-out into the finance store package (Wave 1 finale). Factory is the standard (ctx) shape — surface serves from this package's tools/ (ctx.appPackageDir). Core-remaining relative imports rewritten to @/app/routes aliases (inline-bot-execution, free-tier-rotation — LM pattern); finance-plaid vendors as a package sibling; @/features/payments now imports through the KERNEL-SKILL contract (pinned in core kernel-skills registry this same carve — it was anchored only by this file). The finance-analyst REAL bot-node (container/echo-registry/persona/oshal-plaid.js) stays core as the ADR-093 interim operator fragment. Logic unchanged.
 *
 * 2026-08-05 | maintainer@emeraldcoastsystemsgroup.com | SECURITY: replace the public SESSION_SECRET fallback with package-local fail-closed encryption helpers while retaining the established encrypted envelope for stored Plaid tokens.
 *
 * @module finance-routes
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
exports.ensureFinanceSchema = ensureFinanceSchema;
exports.createFinanceRoutes = createFinanceRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const database_1 = require("@/shared/services/database");
const agent_management_1 = require("@/features/agent-management");
const payments_1 = require("@/features/payments");
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const free_tier_rotation_1 = require("@/app/routes/free-tier-rotation");
const explicit_write_confirmation_1 = require("@/shared/security/explicit-write-confirmation");
const finance_plaid_1 = require("./finance-plaid");
const session_crypto_1 = require("./session-crypto");
const logger = (0, logger_1.createChildLogger)({ module: 'finance-routes' });
/** Package install dir — set by the loader on the context; env fallback for tool-style callers. */
let packageDir = process.env.OSHAL_APP_PACKAGE_DIR || '';
/** The finance-analyst bot — reason-only, runs inline on the api container (claude-code). */
const FINANCE_AGENT_ID = 'a0000000-0000-0000-0000-000000000044';
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
/** Transaction look-back used when (re)building the aggregate. */
const TXN_WINDOW_DAYS = 90;
/** Signed-in caller's OIDC sub. */
function callerSub(req) {
    const u = req.oidc?.user;
    const sub = u?.sub || u?.oid;
    return sub ? String(sub) : null;
}
/** Serve a static surface file from the package's tools dir. */
function servePage(surfaceDir, file) {
    return (_req, res) => {
        res.sendFile(path.join(surfaceDir, file), (err) => {
            if (err) {
                logger.error({ err, file }, 'serve finance surface failed');
                res.status(404).send('Not found');
            }
        });
    };
}
/** Create or validate the finance-owned stores: linked items, aggregate, and payments. */
async function ensureFinanceSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'finance routes',
        statements: [
            `CREATE TABLE IF NOT EXISTS oshal_finance_items (
        item_id TEXT PRIMARY KEY,
        user_sub TEXT NOT NULL,
        institution TEXT,
        access_token TEXT NOT NULL,
        linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
            'CREATE INDEX IF NOT EXISTS oshal_finance_items_user ON oshal_finance_items (user_sub)',
            `CREATE TABLE IF NOT EXISTS oshal_finance_data (
        user_sub TEXT PRIMARY KEY,
        aggregate JSONB,
        brief TEXT,
        synced_at TIMESTAMPTZ,
        brief_at TIMESTAMPTZ
      )`,
            `CREATE TABLE IF NOT EXISTS oshal_finance_payments (
        transfer_id TEXT PRIMARY KEY,
        user_sub TEXT NOT NULL,
        provider TEXT NOT NULL,
        amount_cents BIGINT NOT NULL,
        currency TEXT NOT NULL,
        payee TEXT,
        description TEXT,
        status TEXT NOT NULL,
        raw_status TEXT,
        test_mode BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
            'CREATE INDEX IF NOT EXISTS oshal_finance_payments_user ON oshal_finance_payments (user_sub)',
            /* ── owner-scoped RLS (A1.2): applied at the lazy-DDL chokepoint so a
               fresh database enforces isolation the moment these tables are created,
               instead of waiting for migration 060 to re-run (it skips absent tables).
               Inert while the runtime connects as a superuser role. ─────────────── */
            ...(0, database_1.buildOwnerRlsPolicyStatements)('oshal_finance_items', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('oshal_finance_data', 'user_sub'),
            ...(0, database_1.buildOwnerRlsPolicyStatements)('oshal_finance_payments', 'user_sub'),
        ],
        requirements: [
            { table: 'oshal_finance_items', columns: ['item_id', 'user_sub', 'institution', 'access_token', 'linked_at'] },
            { table: 'oshal_finance_data', columns: ['user_sub', 'aggregate', 'brief', 'synced_at', 'brief_at'] },
            {
                table: 'oshal_finance_payments',
                columns: [
                    'transfer_id',
                    'user_sub',
                    'provider',
                    'amount_cents',
                    'currency',
                    'payee',
                    'description',
                    'status',
                    'raw_status',
                    'test_mode',
                    'created_at',
                    'updated_at',
                ],
            },
        ],
    });
}
/** Persist a freshly-linked item for the caller (token encrypted at rest). */
async function storeItem(pool, sub, item) {
    await pool.query(`INSERT INTO oshal_finance_items (item_id, user_sub, institution, access_token)
       VALUES ($1, $2, $3, $4)
     ON CONFLICT (item_id) DO UPDATE SET institution = EXCLUDED.institution, access_token = EXCLUDED.access_token`, [item.itemId, sub, item.institution, (0, session_crypto_1.encryptSessionValue)(item.accessToken)]);
}
/** Load + decrypt the caller's linked items for a Plaid fetch. */
async function loadItems(pool, sub) {
    const rows = (await pool.query('SELECT institution, access_token FROM oshal_finance_items WHERE user_sub = $1', [sub])).rows;
    return rows.map((r) => ({ institution: r.institution || 'Linked institution', accessToken: (0, session_crypto_1.decryptSessionValue)(r.access_token) }));
}
/**
 * @description Builds the self-contained finance-analyst prompt. The full output contract
 * lives here (not in a loaded persona) so behavior is deterministic regardless of inline
 * prompt assembly — the proven kid-lens / deck-builder pattern. The aggregate is embedded.
 * @param agg - The compact finance aggregate.
 * @returns The prompt string handed to the finance-analyst bot.
 */
function buildBriefPrompt(agg) {
    return [
        'You are a personal finance analyst. You are handed a READ-ONLY aggregate of one person\'s',
        'linked bank + brokerage accounts: balances, investment holdings, and recent transactions.',
        'Produce a concise, practical money brief. Ground EVERY figure in the data below — never',
        'invent accounts, holdings, or numbers. You do NOT give regulated investment advice and you',
        'do NOT place trades; you observe and explain. Use Markdown with these sections:',
        '',
        '## Where you stand',
        'Net worth (assets minus liabilities) and the one-line story behind it.',
        '## Accounts',
        'A tight rundown of the accounts and balances that matter.',
        '## Portfolio',
        'Holdings by value; flag concentration (e.g. overweight a single position/sector) and any',
        'obvious drift. Skip if there are no investment holdings.',
        '## Spending',
        'Top categories and the month-over-month trend; call out anything notable.',
        '## Watch-outs',
        'Bills/liabilities, low buffers, or anything worth a glance. Non-alarmist, specific.',
        '',
        'Be concise — short sentences, tight bullets, no preamble, no sign-off. Currency: ' + agg.currency + '.',
        '',
        'FINANCE AGGREGATE (JSON):',
        JSON.stringify(agg),
    ].join('\n');
}
/** Run the finance-analyst bot over the aggregate. direct+agenticMode → cost auto-recorded.
 *  If the caller has a Bring-Your-Own-LLM connection configured, the analyst's reasoning
 *  runs on THEIR endpoint+key+model (cost tracked under provider 'byo-llm'). */
async function runAnalyst(ctx, sub, agg) {
    const byoLlmConnection = await (0, free_tier_rotation_1.resolveUserLlmConnection)(ctx.pool, sub);
    const result = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, FINANCE_AGENT_ID, {
        text: buildBriefPrompt(agg), taskId: `finance-${sub}`, workspaceFolderId: `finance-${sub}`,
        agentId: FINANCE_AGENT_ID, agenticMode: true, direct: true, userSub: sub, byoLlmConnection,
    });
    return String(result.response || '').trim();
}
/** Fetch fresh data for the caller and persist the aggregate; clears the stale brief. */
async function syncAggregate(pool, sub) {
    const items = await loadItems(pool, sub);
    const agg = await (0, finance_plaid_1.fetchFinanceAggregate)(items, TXN_WINDOW_DAYS);
    await pool.query(`INSERT INTO oshal_finance_data (user_sub, aggregate, brief, synced_at, brief_at)
       VALUES ($1, $2, NULL, now(), NULL)
     ON CONFLICT (user_sub) DO UPDATE SET aggregate = EXCLUDED.aggregate, brief = NULL, synced_at = now(), brief_at = NULL`, [sub, JSON.stringify(agg)]);
    return agg;
}
/** Persist (insert or update) a transfer row for the caller's audit trail. */
async function recordPayment(pool, sub, r, meta) {
    await pool.query(`INSERT INTO oshal_finance_payments
       (transfer_id, user_sub, provider, amount_cents, currency, payee, description, status, raw_status, test_mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (transfer_id) DO UPDATE SET status = EXCLUDED.status, raw_status = EXCLUDED.raw_status, updated_at = now()`, [r.id, sub, r.provider, r.amountCents, r.currency, meta.payee || null, meta.description || null, r.status, r.rawStatus || null, meta.testMode]);
}
/**
 * @description Builds the finance router (mount at /api/finance behind requiresAuth).
 * @param ctx - App context (Postgres pool for the per-user stores).
 * @param apiDir - Directory holding the HTML surface.
 * @returns Express router.
 */
function createFinanceRoutes(ctx) {
    if (ctx.appPackageDir)
        packageDir = ctx.appPackageDir;
    const surfaceDir = packageDir ? path.join(packageDir, 'tools') : path.resolve(process.cwd(), 'tools');
    const router = (0, express_1.Router)();
    router.get('/', servePage(surfaceDir, 'finance.html'));
    router.get('/ui', servePage(surfaceDir, 'finance.html'));
    /** GET /status — connected item count, sync/brief state, and Plaid config/env. Drives the surface. */
    router.get('/status', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await ensureFinanceSchema(ctx.pool);
            const items = (await ctx.pool.query('SELECT institution FROM oshal_finance_items WHERE user_sub = $1', [sub])).rows;
            const row = (await ctx.pool.query('SELECT (aggregate IS NOT NULL) AS has_data, (brief IS NOT NULL) AS has_brief, synced_at, brief_at FROM oshal_finance_data WHERE user_sub = $1', [sub])).rows[0];
            res.json({
                configured: (0, finance_plaid_1.plaidConfigured)(), env: (0, finance_plaid_1.plaidEnv)(),
                institutions: items.map((r) => r.institution),
                connected: items.length, hasData: Boolean(row?.has_data), hasBrief: Boolean(row?.has_brief),
                syncedAt: row?.synced_at || null, briefAt: row?.brief_at || null,
            });
        }
        catch (err) {
            logger.error({ err }, 'finance status failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /link-token — mint a Plaid Link token for the surface's Link widget. */
    router.post('/link-token', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        if (!(0, finance_plaid_1.plaidConfigured)()) {
            res.status(503).json({ error: 'plaid_not_configured', message: 'Set PLAID_CLIENT_ID and PLAID_SECRET to enable bank linking.' });
            return;
        }
        try {
            res.json({ linkToken: await (0, finance_plaid_1.createLinkToken)(sub) });
        }
        catch (err) {
            logger.error({ err }, 'finance link-token failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /exchange — { publicToken } from Plaid Link → store the linked item for the caller. */
    router.post('/exchange', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const publicToken = String(req.body?.publicToken || '').trim();
        if (!publicToken) {
            res.status(400).json({ error: 'publicToken required' });
            return;
        }
        try {
            await ensureFinanceSchema(ctx.pool);
            const item = await (0, finance_plaid_1.exchangePublicToken)(publicToken);
            await storeItem(ctx.pool, sub, item);
            res.json({ ok: true, institution: item.institution });
        }
        catch (err) {
            logger.error({ err }, 'finance exchange failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /link-sandbox — localhost demo connect: mint + exchange a Plaid Sandbox item so the
     *  flow is testable without the Link JS widget or real bank creds. Sandbox env only. */
    router.post('/link-sandbox', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        if ((0, finance_plaid_1.plaidEnv)() !== 'sandbox') {
            res.status(409).json({ error: 'not_sandbox', message: 'Demo connect is only available when PLAID_ENV=sandbox.' });
            return;
        }
        if (!(0, finance_plaid_1.plaidConfigured)()) {
            res.status(503).json({ error: 'plaid_not_configured', message: 'Set PLAID_CLIENT_ID and PLAID_SECRET (Sandbox keys) first.' });
            return;
        }
        try {
            await ensureFinanceSchema(ctx.pool);
            const institutionId = String(req.body?.institutionId || '').trim() || undefined;
            const item = await (0, finance_plaid_1.createSandboxItem)(institutionId);
            await storeItem(ctx.pool, sub, item);
            res.json({ ok: true, institution: item.institution });
        }
        catch (err) {
            logger.error({ err }, 'finance sandbox link failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /sync — refetch balances/holdings/transactions for all linked items, rebuild aggregate. */
    router.post('/sync', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await ensureFinanceSchema(ctx.pool);
            const count = (await ctx.pool.query('SELECT COUNT(*)::int AS n FROM oshal_finance_items WHERE user_sub = $1', [sub])).rows[0]?.n || 0;
            if (!count) {
                res.status(409).json({ error: 'no_accounts', message: 'Link a bank or brokerage first.' });
                return;
            }
            const agg = await syncAggregate(ctx.pool, sub);
            res.json({ ok: true, netWorth: agg.netWorth, accounts: agg.accounts.length, holdings: agg.holdings.length, notes: agg.notes });
        }
        catch (err) {
            logger.error({ err }, 'finance sync failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /summary — the cached aggregate (cheap read, no LLM). 404 until first /sync. */
    router.get('/summary', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await ensureFinanceSchema(ctx.pool);
            const row = (await ctx.pool.query('SELECT aggregate, synced_at FROM oshal_finance_data WHERE user_sub = $1', [sub])).rows[0];
            if (!row || !row.aggregate) {
                res.status(404).json({ error: 'no_data', message: 'Sync your accounts first.' });
                return;
            }
            res.json({ aggregate: row.aggregate, syncedAt: row.synced_at });
        }
        catch (err) {
            logger.error({ err }, 'finance summary failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /brief — the finance brief. Cached after first run; ?refresh=1 regenerates. */
    router.get('/brief', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await ensureFinanceSchema(ctx.pool);
            const row = (await ctx.pool.query('SELECT aggregate, brief FROM oshal_finance_data WHERE user_sub = $1', [sub])).rows[0];
            if (!row || !row.aggregate) {
                res.status(404).json({ error: 'no_data', message: 'Link accounts and sync first.' });
                return;
            }
            const refresh = String(req.query.refresh || '') === '1';
            if (row.brief && !refresh) {
                res.json({ brief: row.brief, cached: true });
                return;
            }
            const brief = await runAnalyst(ctx, sub, row.aggregate);
            if (!brief) {
                res.status(502).json({ error: 'empty_brief', message: 'The analyst returned nothing — try again.' });
                return;
            }
            await ctx.pool.query('UPDATE oshal_finance_data SET brief = $2, brief_at = now() WHERE user_sub = $1', [sub, brief]);
            res.json({ brief, cached: false });
        }
        catch (err) {
            logger.error({ err }, 'finance brief failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /pay-status — is a money-movement rail configured, and is it in test mode? Drives the Pay panel. */
    router.get('/pay-status', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const adapter = (0, payments_1.getPaymentAdapter)();
            res.json({ provider: adapter.provider, configured: adapter.configured(), testMode: adapter.isTestMode() });
        }
        catch (err) {
            // An unimplemented/unknown PAYMENT_PROVIDER → report not-configured, not a 500.
            res.json({ provider: process.env.PAYMENT_PROVIDER || 'stripe', configured: false, testMode: true, message: err.message });
        }
    });
    /** POST /pay — move money out of the caller's account. Body: { amountCents, currency?, source, payeeLabel?, description?, requestId }.
     *  Deterministic I/O (no LLM); idempotency-keyed on user_sub + requestId so a retry never double-pays. */
    router.post('/pay', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const b = (req.body || {});
        const amountCents = Math.trunc(Number(b.amountCents));
        if (!Number.isInteger(amountCents) || amountCents <= 0) {
            res.status(400).json({ error: 'bad_amount', message: 'amountCents must be a positive integer (cents).' });
            return;
        }
        if (!b.source) {
            res.status(400).json({ error: 'source_required', message: 'A funding source (bank account / payment method id) is required.' });
            return;
        }
        if (!b.requestId) {
            res.status(400).json({ error: 'request_id_required', message: 'A client requestId is required for idempotency.' });
            return;
        }
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(b)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('no-charge', 'Moving money'));
            return;
        }
        try {
            await ensureFinanceSchema(ctx.pool);
            const adapter = (0, payments_1.getPaymentAdapter)();
            if (!adapter.configured()) {
                res.status(503).json({ error: 'payments_not_configured', message: `Set credentials for the ${adapter.provider} rail (e.g. STRIPE_SECRET_KEY).` });
                return;
            }
            const result = await adapter.createTransfer({
                userSub: sub, amountCents, currency: b.currency || 'usd',
                source: { id: String(b.source) }, payeeLabel: b.payeeLabel, description: b.description,
                idempotencyKey: `${sub}:${b.requestId}`,
            });
            await recordPayment(ctx.pool, sub, result, { payee: b.payeeLabel, description: b.description, testMode: adapter.isTestMode() });
            res.json({ ok: true, transfer: result });
        }
        catch (err) {
            logger.error({ err }, 'finance pay failed');
            res.status(502).json({ error: 'transfer_failed', message: err.message });
        }
    });
    /** GET /pay/:transferId — refresh one transfer's status from the rail (ownership-checked) and persist it. */
    router.get('/pay/:transferId', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const owned = (await ctx.pool.query('SELECT 1 FROM oshal_finance_payments WHERE transfer_id = $1 AND user_sub = $2', [String(req.params.transferId), sub])).rowCount;
            if (!owned) {
                res.status(404).json({ error: 'not_found' });
                return;
            }
            const adapter = (0, payments_1.getPaymentAdapter)();
            const result = await adapter.getTransfer(String(req.params.transferId));
            await ctx.pool.query('UPDATE oshal_finance_payments SET status = $2, raw_status = $3, updated_at = now() WHERE transfer_id = $1', [result.id, result.status, result.rawStatus || null]);
            res.json({ transfer: result });
        }
        catch (err) {
            logger.error({ err }, 'finance pay-status fetch failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /payments — the caller's transfer history (cheap read, owner-scoped). */
    router.get('/payments', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await ensureFinanceSchema(ctx.pool);
            const rows = (await ctx.pool.query(`SELECT transfer_id, provider, amount_cents, currency, payee, description, status, test_mode, created_at
           FROM oshal_finance_payments WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 50`, [sub])).rows;
            res.json({ payments: rows });
        }
        catch (err) {
            logger.error({ err }, 'finance payments list failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** DELETE /items/:itemId — unlink one of the caller's institutions (ownership-checked). */
    router.delete('/items/:itemId', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const r = await ctx.pool.query('DELETE FROM oshal_finance_items WHERE item_id = $1 AND user_sub = $2', [String(req.params.itemId), sub]);
            res.json({ ok: true, removed: r.rowCount || 0 });
        }
        catch (err) {
            logger.error({ err }, 'finance unlink failed');
            res.status(500).json({ error: err.message });
        }
    });
    return router;
}
//# sourceMappingURL=finance-routes.js.map