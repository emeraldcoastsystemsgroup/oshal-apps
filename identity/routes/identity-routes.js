"use strict";
/**
 * Identity Hub routes — the click-to-access launcher over the caller's connected
 * accounts (ADR-036/038).
 *
 * The Identity Hub is a VIEW over data that already exists: the provider catalog and
 * the caller's connection state come from the existing GET /api/connect/list (the
 * single source of truth — and the only place that knows which OAuth clients are
 * configured), so this module never re-derives the catalog and never touches a token.
 * The surface adds three actions per account — Open (deep-link into the provider),
 * Reconnect, and Connect — all of which reuse /api/connect/:provider/start. No secret
 * is ever shown, copied, or handed back: this launches accounts the user already
 * authorized; it does not change the security posture.
 *
 * The ONLY reasoning here is an optional "access review": the accountable
 * identity-advisor bot reads the caller's connection METADATA (provider, account
 * label, personal/shared, default flag, token expiry — NEVER the tokens themselves)
 * and flags what needs attention (expired logins, duplicates, recommended-but-missing
 * connectors). It is reason-only, so it runs INLINE on the api container (claude-code)
 * like finance-analyst / kid-lens, and its cost lands in chat_tasks under its agent_id.
 *
 * Every route is requiresAuth-gated at mount (auth is opt-in per route, CLAUDE.md).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-17 18:40:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — Identity Hub launcher: GET / + /ui (surface), GET /advice (identity-advisor reasons over the caller's connection METADATA inventory; reason-only bot runs inline on the api container). Catalog + connection state reused from /api/connect/list; no token ever exposed.
 * 2026-07-19 19:05:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into the identity app package (ADR-085 Wave 3, "skill with a surface"). Standard (ctx) factory; the surface serves from ctx.appPackageDir/tools (load-time env fallback, D10). Shared core helpers import via @/ aliases: connector-tenancy's accessibleConnections + inline-bot-execution's executeBotOrInline. The identity-advisor inline node (BOTH swarm-bot-registry blocks), the connector hub (/api/connect/*), and /utilities stay framework-resident (ADR-093).
 *
 * @module identity-routes
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
exports.createIdentityRoutes = createIdentityRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const logger_1 = require("@/shared/logger");
const agent_management_1 = require("@/features/agent-management");
const connector_tenancy_1 = require("@/app/routes/connector-tenancy");
const inline_bot_execution_1 = require("@/app/routes/inline-bot-execution");
const logger = (0, logger_1.createChildLogger)({ module: 'identity-routes' });
/** The identity-advisor bot — reason-only, runs inline on the api container (claude-code). */
const IDENTITY_AGENT_ID = 'a0000000-0000-0000-0000-000000000045';
const botClient = new agent_management_1.BotNodeClient((0, agent_management_1.createRegistryEndpointResolver)());
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
/**
 * Resolve the Identity Hub page from the package's tools/ dir (ctx.appPackageDir,
 * captured at factory time per D10), with the load-time env fallback and a final
 * __dirname fallback into this package's own tree.
 */
function identityHtml(appPackageDir) {
    const candidates = [
        appPackageDir ? path.join(appPackageDir, 'tools', 'identity.html') : '',
        LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools', 'identity.html') : '',
        path.resolve(__dirname, '../tools/identity.html'),
    ].filter(Boolean);
    return candidates.find((p) => fs.existsSync(p)) || candidates[candidates.length - 1];
}
/** Signed-in caller's OIDC sub. */
function callerSub(req) {
    const u = req.oidc?.user;
    const sub = u?.sub || u?.oid;
    return sub ? String(sub) : null;
}
/** Serve the packaged surface file. */
function servePage(file) {
    return (_req, res) => {
        res.sendFile(file, (err) => {
            if (err) {
                logger.error({ err, file }, 'serve identity surface failed');
                res.status(404).send('Not found');
            }
        });
    };
}
/**
 * @description Maps the caller's accessible connections to a metadata-only inventory.
 * Tokens are deliberately dropped — the advisor only ever reasons over metadata.
 * @param pool - Postgres pool.
 * @param sub - the signed-in caller's OIDC sub.
 * @returns one InventoryItem per accessible connection (personal ∪ shared).
 */
async function buildInventory(pool, sub) {
    const rows = await (0, connector_tenancy_1.accessibleConnections)(pool, sub);
    const now = Date.now();
    return rows.map((r) => ({
        provider: r.provider,
        label: r.label || r.account_email || null,
        account: r.account_email || null,
        shared: Boolean(r.tenant_id),
        isDefault: Boolean(r.is_default),
        expiry: r.expiry ? new Date(r.expiry).toISOString() : null,
        expired: r.expiry ? new Date(r.expiry).getTime() < now : false,
    }));
}
/** Build the access-review prompt over the metadata inventory (no secrets present). */
function buildAdvicePrompt(inventory) {
    return [
        'You are an access-health advisor. Below is a READ-ONLY inventory of one person\'s',
        'connected accounts — METADATA ONLY (no passwords, tokens, or secrets are present or',
        'available to you). Produce a short, practical "state of your logins" review in Markdown',
        'with these sections (omit a section if it has nothing to say):',
        '',
        '## Needs attention now',
        'Expired authorizations that should be reconnected — name the provider and account.',
        '## Housekeeping',
        'Duplicate accounts for one provider, a provider with no default set, or stale-looking accounts.',
        '## Worth adding',
        'Recommended-but-missing connectors that would genuinely round out their setup (only if useful).',
        '',
        'Be concise — short sentences, tight bullets, no preamble, no sign-off. You OBSERVE and',
        'RECOMMEND only; you never connect, reconnect, or revoke anything (those are one-click',
        'actions the person takes themselves). Ground every statement in the inventory below.',
        '',
        'CONNECTION INVENTORY (JSON, metadata only):',
        JSON.stringify(inventory, null, 2),
    ].join('\n');
}
/** Run the identity-advisor bot over the metadata inventory; returns its Markdown review. */
async function runAdvisor(ctx, sub, inventory) {
    const result = await (0, inline_bot_execution_1.executeBotOrInline)(ctx, botClient, IDENTITY_AGENT_ID, {
        text: buildAdvicePrompt(inventory), taskId: `identity-${sub}`, workspaceFolderId: `identity-${sub}`,
        agentId: IDENTITY_AGENT_ID, agenticMode: true, direct: true, userSub: sub,
    });
    return String(result.response || '').trim();
}
/**
 * @description Builds the Identity Hub router (mounted at /api/identity behind
 * requiresAuth by the manifest route mounter — auth: oidc, what core server.ts mounted).
 * @param ctx - App context (Postgres pool for the connection store + appPackageDir).
 * @returns Express router.
 */
function createIdentityRoutes(ctx) {
    const router = (0, express_1.Router)();
    const surface = identityHtml(ctx.appPackageDir);
    router.get('/', servePage(surface));
    router.get('/ui', servePage(surface));
    /** GET /advice — the access review. The identity-advisor bot reasons over the
     *  caller's connection METADATA inventory (never tokens). Skips the LLM when there
     *  is nothing connected yet, so an empty hub costs nothing. */
    router.get('/advice', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const inventory = await buildInventory(ctx.pool, sub);
            if (inventory.length === 0) {
                res.json({ advice: 'You haven\'t connected any accounts yet. Connect the ones you use most — email, calendar, and your main social or storage account — and they\'ll show up here for one-click access.', count: 0, empty: true });
                return;
            }
            const advice = await runAdvisor(ctx, sub, inventory);
            if (!advice) {
                res.status(502).json({ error: 'empty_review', message: 'The advisor returned nothing — try again.' });
                return;
            }
            res.json({ advice, count: inventory.length, empty: false });
        }
        catch (err) {
            logger.error({ err }, 'identity advice failed');
            res.status(502).json({ error: err.message });
        }
    });
    return router;
}
//# sourceMappingURL=identity-routes.js.map