"use strict";
/**
 * Switchboard Stage Routes — the broadcast fan-out composer (mounted under the Switchboard
 * app router at /stage → /api/switchboard/stage, requiresAuth).
 *
 * Stage is "write once, send everywhere": the caller composes one message, picks the target
 * channels from their connected set (the surface reads Compose's own /targets — one list,
 * one truth), tailors per-channel text (on the comms bot via Compose's /variants, or as-is),
 * and fans the approved texts out in ONE action:
 *
 *   • GET  /            — serve the Stage surface (tools/switchboard-stage.html).
 *   • POST /broadcast   — { posts:[{platform,text}], workspaceId?, confirm } → publish each
 *                         channel's EXACT approved text through the SAME publishTo path
 *                         Compose and the calendar scheduled-post executor use (never a
 *                         parallel rail). Per-channel isolation: one failed channel records
 *                         its error and the rest still send.
 *
 * Nothing here posts without an explicit per-send user action (operator automation
 * directive): /broadcast is gated by the no-post explicit-write confirmation, exactly like
 * Compose's /publish — no confirm, no send, 428. There is no scheduler in this module;
 * scheduled sends remain the Calendar executor's job behind its own opt-in flag.
 *
 * Controller/bot split (ADR-036): this module calls NO LLM (per-channel tailoring is
 * Compose's /variants, on the bot). The fan-out is deterministic over approved bytes.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 18:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Initial Stage module: GET / (surface) + POST /broadcast (confirm-gated fan-out of exact approved per-channel texts through Compose's exported publishTo — one compose, N channel submissions, per-channel failure isolation, workspace-scope guard). Validation + fan-out mechanics live in the pure switchboard-stage-fanout module so store-CI tests the compiled bytes.
 *
 * @module switchboard-stage-routes
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
exports.createStageRoutes = createStageRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const explicit_write_confirmation_1 = require("@/shared/security/explicit-write-confirmation");
const switchboard_compose_routes_1 = require("./switchboard-compose-routes");
const switchboard_stage_fanout_1 = require("./switchboard-stage-fanout");
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
const logger = (0, logger_1.createChildLogger)({ module: 'switchboard-stage-routes' });
/** The signed-in user's OIDC subject, or null if unauthenticated. */
function callerSub(req) {
    const u = req.oidc?.user;
    return u?.sub ? String(u.sub) : null;
}
/** Serve a static HTML surface from the package tools directory. */
function servePage(dir, file) {
    return (_req, res) => {
        res.sendFile(path.join(dir, file), (err) => {
            if (err) {
                logger.error({ err, file }, 'Failed to serve switchboard stage surface');
                res.status(404).send('Page not found');
            }
        });
    };
}
/**
 * @description Resolve the connector providers that belong to a workspace (its member
 * accounts) — the same read Compose does over the PARENT-owned workspace tables (this module
 * never DDLs them; SELECT only, always scoped to the caller's own sub).
 * @param pool - Postgres pool. @param sub - Caller sub. @param workspaceId - Workspace id, or null for "all".
 * @returns The provider set for that workspace, or null when no workspace is scoped (= all accounts).
 */
async function workspaceProviders(pool, sub, workspaceId) {
    if (!workspaceId)
        return null;
    const rows = (await pool.query(`SELECT c.provider FROM oshal_switchboard_workspace_accounts a
       JOIN oshal_connections c ON c.connection_id = a.connection_id AND c.user_sub = a.user_sub
      WHERE a.user_sub = $1 AND a.workspace_id = $2`, [sub, workspaceId])).rows;
    return new Set(rows.map((r) => String(r.provider)));
}
/** Per-platform char limits derived from Compose's spec (one truth, never re-typed here). */
function platformLimits() {
    const limits = {};
    for (const [key, spec] of Object.entries(switchboard_compose_routes_1.PLATFORMS))
        limits[key] = spec.limit;
    return limits;
}
/**
 * @description Builds the Stage sub-router. The parent mounts it at /api/switchboard/stage
 * (auth-gated at the package mount), so routes here are relative ('/', '/broadcast').
 * Surfaces serve from the package tools/ dir (D10 load-time fallback). No LLM in this path.
 * @param ctx - App context (pool for the workspace guard + connector tokens via publishTo, appPackageDir for the surface).
 * @returns Express router to mount under /stage in the parent Switchboard router.
 */
function createStageRoutes(ctx) {
    const router = (0, express_1.Router)();
    const assetRoot = ctx.appPackageDir ? path.join(ctx.appPackageDir, 'tools') : path.join(LOAD_TIME_PACKAGE_DIR, 'tools');
    // Surface: the broadcast composer.
    router.get('/', servePage(assetRoot, 'switchboard-stage.html'));
    /** POST /broadcast { posts:[{platform,text}], workspaceId?, confirm } — fan out the exact approved texts. */
    router.post('/broadcast', async (req, res) => {
        const sub = callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const body = (req.body || {});
        const plan = (0, switchboard_stage_fanout_1.normalizeBroadcast)(body, switchboard_compose_routes_1.PUBLISHABLE, platformLimits());
        if (plan.error) {
            res.status(400).json({ error: plan.error });
            return;
        }
        // The no-post gate — the SAME explicit-write confirmation Compose's /publish enforces.
        // Checked before any channel is touched: no confirm, no send, nothing partial.
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(body)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('no-post', `Broadcasting to ${plan.posts.length} channel(s)`));
            return;
        }
        try {
            const ws = await workspaceProviders(ctx.pool, sub, String(body.workspaceId || '').trim() || null);
            if (ws && ws.size) {
                const outside = plan.posts.filter((p) => !(0, switchboard_compose_routes_1.platformProviders)(p.platform).some((prov) => ws.has(prov)));
                if (outside.length) {
                    res.status(403).json({
                        error: 'workspace_mismatch',
                        message: `Not in this workspace's accounts: ${outside.map((p) => switchboard_compose_routes_1.PLATFORMS[p.platform]?.label || p.platform).join(', ')}. Nothing was sent.`,
                    });
                    return;
                }
            }
            const { results, summary } = await (0, switchboard_stage_fanout_1.runFanout)(plan.posts, (platform, text) => (0, switchboard_compose_routes_1.publishTo)(ctx, sub, platform, text));
            logger.info({ sub, summary }, 'Stage broadcast fan-out completed');
            res.status(summary.sent > 0 ? 200 : 502).json({ results, summary });
        }
        catch (err) {
            logger.error({ err }, 'Stage broadcast failed');
            res.status(502).json({ error: err.message });
        }
    });
    return router;
}
//# sourceMappingURL=switchboard-stage-routes.js.map