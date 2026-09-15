"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial marketing-engine API (/api/marketing, oidc): campaign CRUD + sanitized import (import never arms spend/consent — series-pump rule), per-channel consent PUT (428-gated standing authorization), inline-bot drafts/research/launch-checklist via executeBotOrInline (hosted-brain aware), the consent→cap→confirm(428)→rail→run-ledger publish chain (LinkedIn/Mastodon connector actions, Bluesky fixed op, Resend email — honest 409/503 degradation), scorecard read/rebuild, experiment lifecycle, budget-proposal decisions, UTM builder. Pure gates come from ./marketing-model.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Type the pool via AppContext['pool'] instead of importing a QueryablePool that core never exported — the ambient stub compiled standalone but broke the shared whole-store framework build for every sibling package.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Split at the 800-line decomposition threshold, with no behavior change: the shared constants, helpers and lazy DDL moved to ./marketing-support, the inline-bot turn runner and prompts to ./marketing-bots, the publish rails plus the consent→cap→confirm gate and the channel consent PUT to ./marketing-publish, the campaign/content handlers to ./marketing-campaigns, and the scorecard/experiment/budget/UTM handlers to ./marketing-measure. This module is now imports plus createMarketingRoutes, registering the same twenty routes in the same order.
 *
 * @module marketing-routes
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
exports.createMarketingRoutes = createMarketingRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const marketing_support_1 = require("./marketing-support");
const marketing_publish_1 = require("./marketing-publish");
const marketing_campaigns_1 = require("./marketing-campaigns");
const marketing_measure_1 = require("./marketing-measure");
// ---------------------------------------------------------------------------
// Schema + factory
// ---------------------------------------------------------------------------
/**
 * @description Route factory for the marketing-engine package (mounted at /api/marketing, oidc,
 * requiresAuth). Serves the board surface at GET / and the caller-scoped JSON API around it; all
 * outward publishing runs the consent→cap→confirm→rail→run-ledger chain.
 * @param ctx - Framework app context (pool + appPackageDir).
 * @returns The Express router.
 */
function createMarketingRoutes(ctx) {
    const router = (0, express_1.Router)();
    const assetRoot = ctx.appPackageDir ? path.join(ctx.appPackageDir, 'tools') : path.join(marketing_support_1.LOAD_TIME_PACKAGE_DIR, 'tools');
    (0, marketing_support_1.ensureSchema)(ctx.pool).catch((err) => marketing_support_1.logger.error({ err }, 'Failed to ensure marketing-engine core schema'));
    router.get('/', (0, marketing_support_1.servePage)(assetRoot, 'marketing-engine.html'));
    router.get('/overview', (0, marketing_support_1.authed)(ctx, marketing_campaigns_1.getOverview));
    router.get('/utm', (0, marketing_support_1.authed)(ctx, marketing_measure_1.getUtm));
    router.post('/campaigns', (0, marketing_support_1.authed)(ctx, marketing_campaigns_1.createCampaign));
    router.post('/campaigns/import', (0, marketing_support_1.authed)(ctx, marketing_campaigns_1.importCampaign));
    router.patch('/campaigns/:id', (0, marketing_support_1.authed)(ctx, marketing_campaigns_1.patchCampaign));
    router.get('/channels', (0, marketing_support_1.authed)(ctx, async (c, sub, _req, res) => {
        const channelRows = await (0, marketing_support_1.rows)(c.pool, 'SELECT * FROM oshal_marketing_channel_authorizations WHERE user_sub = $1', [sub]);
        res.json({ channels: (0, marketing_support_1.withChannelDefaults)(sub, channelRows) });
    }));
    router.put('/channels/:channel', (0, marketing_support_1.authed)(ctx, marketing_publish_1.putChannel));
    router.post('/drafts', (0, marketing_support_1.authed)(ctx, marketing_campaigns_1.createDraft));
    router.post('/research', (0, marketing_support_1.authed)(ctx, marketing_campaigns_1.runResearch));
    router.post('/launch-checklist', (0, marketing_support_1.authed)(ctx, marketing_campaigns_1.runLaunchChecklist));
    router.get('/content', (0, marketing_support_1.authed)(ctx, marketing_campaigns_1.listContent));
    router.post('/content/:id/publish', (0, marketing_support_1.authed)(ctx, marketing_campaigns_1.publishContent));
    router.get('/scorecard', (0, marketing_support_1.authed)(ctx, marketing_measure_1.getScorecard));
    router.post('/scorecard/rebuild', (0, marketing_support_1.authed)(ctx, marketing_measure_1.rebuildScorecard));
    router.get('/experiments', (0, marketing_support_1.authed)(ctx, async (c, sub, _req, res) => {
        const experiments = await (0, marketing_support_1.rows)(c.pool, 'SELECT * FROM oshal_marketing_experiments WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 200', [sub]);
        res.json({ experiments });
    }));
    router.post('/experiments', (0, marketing_support_1.authed)(ctx, marketing_measure_1.createExperiment));
    router.patch('/experiments/:id', (0, marketing_support_1.authed)(ctx, marketing_measure_1.patchExperiment));
    router.get('/budget/proposals', (0, marketing_support_1.authed)(ctx, async (c, sub, _req, res) => {
        const proposals = await (0, marketing_support_1.rows)(c.pool, 'SELECT * FROM oshal_marketing_budget_ledger WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 100', [sub]);
        res.json({ proposals });
    }));
    router.post('/budget/proposals/:id/decide', (0, marketing_support_1.authed)(ctx, marketing_measure_1.decideBudgetProposal));
    return router;
}
