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
    res.json({ proposals });
  }));
  router.post('/budget/proposals/:id/decide', authed(ctx, decideBudgetProposal));

  return router;
}
