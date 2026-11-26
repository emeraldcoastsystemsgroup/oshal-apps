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

import { Router } from 'express';
import * as path from 'path';
import type { AppContext } from '@/app/composition/app-context';
import {
  LOAD_TIME_PACKAGE_DIR, authed, ensureSchema, logger, rows, servePage, withChannelDefaults,
} from './marketing-support';
import { putChannel } from './marketing-publish';
import {
  createCampaign, createDraft, getOverview, importCampaign, listContent, patchCampaign,
  publishContent, runLaunchChecklist, runResearch,
} from './marketing-campaigns';
import {
  createExperiment, decideBudgetProposal, getScorecard, getUtm, patchExperiment, rebuildScorecard,
} from './marketing-measure';
import { registerAudienceRoutes } from './marketing-audience';
import { registerComplianceRoutes } from './marketing-compliance';
import { registerOptInRoutes } from './marketing-optin';
import { registerBroadcastRoutes } from './marketing-broadcast';
import { registerSequenceRoutes } from './marketing-sequences';
import { registerLaunchRoutes } from './marketing-launch';
import { registerBudgetRoutes } from './marketing-budget';
import { registerAttributionRoutes } from './marketing-attribution';
import { registerSmsRoutes } from './marketing-sms';

// ---------------------------------------------------------------------------
// Schema + factory
// ---------------------------------------------------------------------------

/** @description Map proposed budget-ledger rows into cross-application approval items. */
export function formatBudgetApprovals(proposals: Record<string, unknown>[]): Record<string, unknown>[] {
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
export function createMarketingRoutes(ctx: AppContext): Router {
  const router = Router();
  const assetRoot = ctx.appPackageDir ? path.join(ctx.appPackageDir, 'tools') : path.join(LOAD_TIME_PACKAGE_DIR, 'tools');
  ensureSchema(ctx.pool).catch((err) => logger.error({ err }, 'Failed to ensure marketing-engine core schema'));

  router.get('/', servePage(assetRoot, 'marketing-engine.html'));
  router.get('/overview', authed(ctx, getOverview));
  router.get('/utm', authed(ctx, getUtm));

  router.post('/campaigns', authed(ctx, createCampaign));
  router.post('/campaigns/import', authed(ctx, importCampaign));
  router.patch('/campaigns/:id', authed(ctx, patchCampaign));

  router.get('/channels', authed(ctx, async (c, sub, _req, res) => {
    const channelRows = await rows(c.pool, 'SELECT * FROM oshal_marketing_channel_authorizations WHERE user_sub = $1', [sub]);
    res.json({ channels: withChannelDefaults(sub, channelRows) });
  }));
  router.put('/channels/:channel', authed(ctx, putChannel));

  router.post('/drafts', authed(ctx, createDraft));
  router.post('/research', authed(ctx, runResearch));
  router.post('/launch-checklist', authed(ctx, runLaunchChecklist));
  router.get('/content', authed(ctx, listContent));
  router.post('/content/:id/publish', authed(ctx, publishContent));

  router.get('/scorecard', authed(ctx, getScorecard));
  router.post('/scorecard/rebuild', authed(ctx, rebuildScorecard));

  router.get('/experiments', authed(ctx, async (c, sub, _req, res) => {
    const experiments = await rows(c.pool, 'SELECT * FROM oshal_marketing_experiments WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 200', [sub]);
    res.json({ experiments });
  }));
  router.post('/experiments', authed(ctx, createExperiment));
  router.patch('/experiments/:id', authed(ctx, patchExperiment));

  router.get('/budget/proposals', authed(ctx, async (c, sub, _req, res) => {
    const proposals = await rows(c.pool, 'SELECT * FROM oshal_marketing_budget_ledger WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 100', [sub]);
    res.json({ proposals, approvals: formatBudgetApprovals(proposals) });
  }));
  router.post('/budget/proposals/:id/decide', authed(ctx, decideBudgetProposal));

  registerAudienceRoutes(router, ctx);
  registerComplianceRoutes(router, ctx);
  registerOptInRoutes(router, ctx);
  registerBroadcastRoutes(router, ctx);
  registerSequenceRoutes(router, ctx);
  registerLaunchRoutes(router, ctx);
  registerBudgetRoutes(router, ctx);
  registerAttributionRoutes(router, ctx);
  registerSmsRoutes(router, ctx);

  return router;
}
