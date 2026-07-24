"use strict";
/**
 * Payments routes — take payments through a connected merchant account.
 *
 * The merchant connects their own Square / PayPal account on /utilities (the
 * 'payments' connector category); this app charges ON THEIR BEHALF using their
 * per-user brokered token (getValidAccessToken — the controller decrypts, the bot
 * never sees the key). Provider-agnostic: the route reads the picked provider,
 * resolves its `MerchantPaymentAdapter`, and charges. Adding "whatever" rail next =
 * a connector + an adapter, no route change.
 *
 * Deterministic I/O — no LLM. Each charge is idempotency-keyed on `user_sub:requestId`
 * so a retry never takes a second payment. Every charge is recorded owner-scoped in
 * `oshal_merchant_payments`. All routes are requiresAuth-gated at mount.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-17 15:10:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — GET /providers (configured + connected per rail), POST /charge (take a payment via the merchant's brokered token, idempotency-keyed), GET /charge/:id (owner-scoped status refresh), GET /history, GET / + /ui surfaces. Square + PayPal rails.
 * 2026-07-05 19:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | Tier-1 RLS at the lazy-DDL chokepoint (A1.2 follow-up): ensurePaymentsSchema now appends buildOwnerRlsPolicyStatements for oshal_merchant_payments (tier-1 owner_or_operator shape per migration 060) so a fresh database is never left policy-less between table creation and a 060 re-run.
 * 2026-07-17 20:20:00 | roger.murphy@emeraldcoastsystemsgroup.com | ADR-085 carve-out into the payments store package. Factory is the standard (ctx) shape — the surface serves from this package's tools/ (ctx.appPackageDir, portrait-studio pattern). Core-remaining relative imports rewritten to @/app/routes aliases (connectors-routes, connector-tenancy — the LM pattern); @/features/payments stays a CORE import (kernel skill: finance imports its Stripe half, this app its merchant half). Logic unchanged.
 *
 * @module payments-routes
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
exports.ensurePaymentsSchema = ensurePaymentsSchema;
exports.createPaymentsRoutes = createPaymentsRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const database_1 = require("@/shared/services/database");
const payments_1 = require("@/features/payments");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const connector_tenancy_1 = require("@/app/routes/connector-tenancy");
const explicit_write_confirmation_1 = require("@/shared/security/explicit-write-confirmation");
const logger = (0, logger_1.createChildLogger)({ module: 'payments-routes' });
/** Package install dir — set by the loader on the context; env fallback for tool-style callers. */
let packageDir = process.env.OSHAL_APP_PACKAGE_DIR || '';
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
                logger.error({ err, file }, 'serve payments surface failed');
                res.status(404).send('Not found');
            }
        });
    };
}
/** Create the owner-scoped merchant-payments audit table if absent. */
async function ensurePaymentsSchema(pool) {
    await (0, database_1.runRuntimeSchemaBootstrap)({
        pool,
        moduleName: 'payments routes',
        statements: [
            `CREATE TABLE IF NOT EXISTS oshal_merchant_payments (
        charge_id TEXT NOT NULL,
        user_sub TEXT NOT NULL,
        provider TEXT NOT NULL,
        amount_cents BIGINT NOT NULL,
        currency TEXT NOT NULL,
        note TEXT,
        status TEXT NOT NULL,
        raw_status TEXT,
        payer_url TEXT,
        test_mode BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (provider, charge_id)
      )`,
            'CREATE INDEX IF NOT EXISTS oshal_merchant_payments_user ON oshal_merchant_payments (user_sub)',
            /* ── owner-scoped RLS (A1.2): applied at the lazy-DDL chokepoint so a
               fresh database enforces isolation the moment this table is created,
               instead of waiting for migration 060 to re-run (it skips absent tables).
               Inert while the runtime connects as a superuser role. ─────────────── */
            ...(0, database_1.buildOwnerRlsPolicyStatements)('oshal_merchant_payments', 'user_sub'),
        ],
        requirements: [
            {
                table: 'oshal_merchant_payments',
                columns: [
                    'charge_id',
                    'user_sub',
                    'provider',
                    'amount_cents',
                    'currency',
                    'note',
                    'status',
                    'raw_status',
                    'payer_url',
                    'test_mode',
                    'created_at',
                    'updated_at',
                ],
            },
        ],
    });
}
/** Upsert a charge row for the caller's audit trail. */
async function recordCharge(pool, sub, r, note, testMode) {
    await pool.query(`INSERT INTO oshal_merchant_payments
       (charge_id, user_sub, provider, amount_cents, currency, note, status, raw_status, payer_url, test_mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (provider, charge_id) DO UPDATE SET status = EXCLUDED.status, raw_status = EXCLUDED.raw_status, payer_url = EXCLUDED.payer_url, updated_at = now()`, [r.id, sub, r.provider, r.amountCents, r.currency, note || null, r.status, r.rawStatus || null, r.payerActionUrl || null, testMode]);
}
/**
 * @description Builds the payments router (mounted at /api/payments behind OIDC by the
 * app loader). The surface HTML serves from this package's tools/ dir.
 * @param ctx - App context (Postgres pool for the connector tokens + charge store + appPackageDir).
 * @returns Express router.
 */
function createPaymentsRoutes(ctx) {
    if (ctx.appPackageDir)
        packageDir = ctx.appPackageDir;
    const surfaceDir = packageDir ? path.join(packageDir, 'tools') : path.resolve(process.cwd(), 'tools');
    const router = (0, express_1.Router)();
    router.get('/', servePage(surfaceDir, 'payments.html'));
    router.get('/ui', servePage(surfaceDir, 'payments.html'));
    /** GET /providers — per merchant rail: connected? test mode? source label? Drives the surface. */
    router.get('/providers', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const out = await Promise.all((0, payments_1.listMerchantProviders)().map(async (provider) => {
                const adapter = (0, payments_1.getMerchantAdapter)(provider);
                const connected = (await (0, connector_tenancy_1.accessibleConnections)(ctx.pool, sub, provider)).length > 0;
                return { provider, connected, testMode: adapter.isTestMode(), sourceLabel: adapter.sourceLabel };
            }));
            res.json({ providers: out });
        }
        catch (err) {
            logger.error({ err }, 'payments providers failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /charge — { provider, amountCents, currency?, source, note?, requestId } take a payment. */
    router.post('/charge', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const b = (req.body || {});
        const adapter = (0, payments_1.getMerchantAdapter)(String(b.provider || ''));
        if (!adapter) {
            res.status(400).json({ error: 'unknown_provider', message: `Provider must be one of: ${(0, payments_1.listMerchantProviders)().join(', ')}.` });
            return;
        }
        const amountCents = Math.trunc(Number(b.amountCents));
        if (!Number.isInteger(amountCents) || amountCents <= 0) {
            res.status(400).json({ error: 'bad_amount', message: 'amountCents must be a positive integer (cents).' });
            return;
        }
        if (!b.source) {
            res.status(400).json({ error: 'source_required', message: `${adapter.sourceLabel} is required.` });
            return;
        }
        if (!b.requestId) {
            res.status(400).json({ error: 'request_id_required', message: 'A client requestId is required for idempotency.' });
            return;
        }
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(b)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('no-charge', 'Taking a payment'));
            return;
        }
        try {
            await ensurePaymentsSchema(ctx.pool);
            const token = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, adapter.provider);
            if (!token) {
                res.status(409).json({ error: 'not_connected', message: `Connect your ${adapter.provider} account first (Utilities → Payments).` });
                return;
            }
            const result = await adapter.charge(token, {
                userSub: sub, amountCents, currency: b.currency || 'USD', source: String(b.source),
                note: b.note, idempotencyKey: `${sub}:${b.requestId}`,
            });
            await recordCharge(ctx.pool, sub, result, b.note, adapter.isTestMode());
            res.json({ ok: true, charge: result });
        }
        catch (err) {
            logger.error({ err, provider: adapter.provider }, 'payments charge failed');
            res.status(502).json({ error: 'charge_failed', message: err.message });
        }
    });
    /** GET /charge/:provider/:chargeId — refresh one charge's status from the rail (owner-scoped). */
    router.get('/charge/:provider/:chargeId', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const adapter = (0, payments_1.getMerchantAdapter)(String(req.params.provider));
        if (!adapter) {
            res.status(400).json({ error: 'unknown_provider' });
            return;
        }
        try {
            const owned = (await ctx.pool.query('SELECT 1 FROM oshal_merchant_payments WHERE provider = $1 AND charge_id = $2 AND user_sub = $3', [adapter.provider, String(req.params.chargeId), sub])).rowCount;
            if (!owned) {
                res.status(404).json({ error: 'not_found' });
                return;
            }
            const token = await (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, adapter.provider);
            if (!token) {
                res.status(409).json({ error: 'not_connected' });
                return;
            }
            const result = await adapter.getCharge(token, String(req.params.chargeId));
            await recordCharge(ctx.pool, sub, result, undefined, adapter.isTestMode());
            res.json({ charge: result });
        }
        catch (err) {
            logger.error({ err }, 'payments charge status failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /history — the caller's charge history (cheap read, owner-scoped). */
    router.get('/history', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await ensurePaymentsSchema(ctx.pool);
            const rows = (await ctx.pool.query(`SELECT charge_id, provider, amount_cents, currency, note, status, payer_url, test_mode, created_at
           FROM oshal_merchant_payments WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 50`, [sub])).rows;
            res.json({ charges: rows });
        }
        catch (err) {
            logger.error({ err }, 'payments history failed');
            res.status(500).json({ error: err.message });
        }
    });
    return router;
}
//# sourceMappingURL=payments-routes.js.map