"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial marketing-engine API (/api/marketing, oidc): campaign CRUD + sanitized import (import never arms spend/consent — series-pump rule), per-channel consent PUT (428-gated standing authorization), inline-bot drafts/research/launch-checklist via executeBotOrInline (hosted-brain aware), the consent→cap→confirm(428)→rail→run-ledger publish chain (LinkedIn/Mastodon connector actions, Bluesky fixed op, Resend email — honest 409/503 degradation), scorecard read/rebuild, experiment lifecycle, budget-proposal decisions, UTM builder. Pure gates come from ./marketing-model.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Type the pool via AppContext['pool'] instead of importing a QueryablePool that core never exported — the ambient stub compiled standalone but broke the shared whole-store framework build for every sibling package.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Split at the 800-line decomposition threshold, with no behavior change: the shared constants, helpers and lazy DDL moved to ./marketing-support, the inline-bot turn runner and prompts to ./marketing-bots, the publish rails plus the consent→cap→confirm gate and the channel consent PUT to ./marketing-publish, the campaign/content handlers to ./marketing-campaigns, and the scorecard/experiment/budget/UTM handlers to ./marketing-measure. This module is now imports plus createMarketingRoutes, registering the same twenty routes in the same order.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Project pending (`status = 'proposed'`) budget proposals as `approvals` on `GET /api/marketing/budget/proposals` for the cross-application Approvals screen (`/cockpit/?screen=approvals`).
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Wire P1 audience store routes (`/audience/contacts`, `/audience/lists`, `/audience/suppressions`, consent export, and export-first contact delete) from ./marketing-audience.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Wire P1 compliance settings, email template catalog/preview, and compliance-gated content approval routes (`/compliance`, `/templates`, `/templates/render`, `/content/:id/approve`) from ./marketing-compliance.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Wire P1 double opt-in sign-up form and confirmation routes (`/audience/signup-forms*`, `/audience/opt-in/confirm`) from ./marketing-optin.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | Wire P1 broadcast pipeline, one-click unsubscribe, and recipient preference routes (`/broadcasts*`, `/audience/unsubscribe`, `/audience/preferences/:contactId`) from ./marketing-broadcast.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | Wire P3 sequences with per-recipient state and strict per-sequence standing authorization routes (`/sequences*`) from ./marketing-sequences.
 * 10 | maintainer@emeraldcoastsystemsgroup.com  | Wire P3 launch plans, grounded retros, and unified marketing calendar routes (`/launch-plans*`, `/calendar`) from ./marketing-launch.
 * 11 | maintainer@emeraldcoastsystemsgroup.com  | 0.6.8 (P2): wire campaign-to-finance-project link, budget summary, and reallocation proposal routes (`/campaigns/:id/finance-project`, `/campaigns/:id/budget-summary`, `/campaigns/:id/reallocation-proposals`) from ./marketing-budget and format `channel_allocation` proposals cleanly on `/approvals`.
 * 12 | maintainer@emeraldcoastsystemsgroup.com  | 0.6.9 (P5): wire attribution funnel, first-touch conversion, and delivery engagement event routes (`/attribution/funnel`, `/attribution/conversions`, `/deliveries/:deliveryId/event`) from ./marketing-attribution.
 * 13 | maintainer@emeraldcoastsystemsgroup.com  | 0.6.10 (P4): wire SMS TCPA/CTIA consent opt-in, clock-controlled recipient-local quiet-hours scheduling, queue read, and STOP/HELP keyword routes (`/audience/sms-opt-in`, `/audience/sms/schedule`, `/audience/sms/queue`, `/audience/sms/keyword`) from ./marketing-sms.
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
exports.formatBudgetApprovals = formatBudgetApprovals;
exports.createMarketingRoutes = createMarketingRoutes;
const express_1 = require("express");
const path = __importStar(require("path"));
const marketing_support_1 = require("./marketing-support");
const marketing_publish_1 = require("./marketing-publish");
const marketing_campaigns_1 = require("./marketing-campaigns");
const marketing_measure_1 = require("./marketing-measure");
const marketing_audience_1 = require("./marketing-audience");
const marketing_compliance_1 = require("./marketing-compliance");
const marketing_optin_1 = require("./marketing-optin");
const marketing_broadcast_1 = require("./marketing-broadcast");
const marketing_sequences_1 = require("./marketing-sequences");
const marketing_launch_1 = require("./marketing-launch");
const marketing_budget_1 = require("./marketing-budget");
const marketing_attribution_1 = require("./marketing-attribution");
const marketing_sms_1 = require("./marketing-sms");
// ---------------------------------------------------------------------------
// Schema + factory
// ---------------------------------------------------------------------------
/** @description Map proposed budget-ledger rows into cross-application approval items. */
function formatBudgetApprovals(proposals) {
    return proposals
        .filter((row) => row && row.status === 'proposed' && row.entry_id)
        .map((row) => {
        const id = String(row.entry_id);
        const field = String(row.field || 'budget');
        const next = String(row.new_value ?? '');
        const prev = row.old_value != null && String(row.old_value) !== '' ? ` (from ${String(row.old_value)})` : '';
        const ch = row.channel ? ` · ${String(row.channel)}` : '';
        const label = field === 'budget_monthly_usd'
            ? 'Monthly budget'
            : field === 'channel_allocation'
                ? 'Channel allocation'
                : field;
        return {
            id,
            category: 'Budget proposal',
            title: `${label}: ${next}${prev}`,
            summary: `Proposed by ${String(row.proposed_by || 'analyst')}${ch}`,
            createdAt: row.created_at || null,
            openHref: '/cockpit/?app=marketing-engine',
            approve: { method: 'POST', path: `/api/marketing/budget/proposals/${encodeURIComponent(id)}/decide`, body: { decision: 'approve', confirm: true }, label: 'Approve' },
            decline: { method: 'POST', path: `/api/marketing/budget/proposals/${encodeURIComponent(id)}/decide`, body: { decision: 'reject' }, label: 'Decline' },
        };
    });
}
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
        res.json({ proposals, approvals: formatBudgetApprovals(proposals) });
    }));
    router.post('/budget/proposals/:id/decide', (0, marketing_support_1.authed)(ctx, marketing_measure_1.decideBudgetProposal));
    (0, marketing_audience_1.registerAudienceRoutes)(router, ctx);
    (0, marketing_compliance_1.registerComplianceRoutes)(router, ctx);
    (0, marketing_optin_1.registerOptInRoutes)(router, ctx);
    (0, marketing_broadcast_1.registerBroadcastRoutes)(router, ctx);
    (0, marketing_sequences_1.registerSequenceRoutes)(router, ctx);
    (0, marketing_launch_1.registerLaunchRoutes)(router, ctx);
    (0, marketing_budget_1.registerBudgetRoutes)(router, ctx);
    (0, marketing_attribution_1.registerAttributionRoutes)(router, ctx);
    (0, marketing_sms_1.registerSmsRoutes)(router, ctx);
    return router;
}
