/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Campaign and content handlers for the marketing-engine API, moved verbatim out of marketing-routes.ts at the 800-line decomposition threshold: the board overview, campaign create/sanitized-import/patch with its applied budget-ledger rows, the three inline-bot surfaces (draft, ICP research, launch checklist), the content list, and the publish handler that runs the consent→cap→confirm→rail→run-ledger chain. Every query, gate order, status code and payload is unchanged.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 0.6.2: render email drafts through built-in HTML/plain-text templates (announcement, newsletter, launch) with mandatory compliance footer and persist template_id/html_body/text_body; record skipped_compliance ledger outcomes on compliance-refused email publishes.
 *
 * @module marketing-campaigns
 */

import type { Request, Response } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { sanitizeCampaignImport } from './marketing-model';
import {
  MARKETING_TEMPLATE_IDS, parseEmailDraftCopy, renderMarketingTemplate,
  type MarketingTemplateId,
} from './marketing-templates';
import { loadComplianceSettings } from './marketing-compliance';
import {
  CAMPAIGN_DIRECTOR_ID, CAMPAIGN_STATUSES, CHANNELS, JSONB_COLS, LAUNCH_COORDINATOR_ID,
  MARKET_ANALYST_ID, UUID_RE, loadCampaign, recordRun, rows, safeRows, slugify, tooLarge,
  withChannelDefaults, type QueryablePool,
} from './marketing-support';
import {
  draftPrompt, extractJsonObject, launchPrompt, researchPrompt, respondWithBot, runMarketingBot,
} from './marketing-bots';
import { gatePublish, runPublishRail } from './marketing-publish';

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * @description GET /overview — the one board payload.
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param _req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
export async function getOverview(ctx: AppContext, sub: string, _req: Request, res: Response): Promise<void> {
  const pool = ctx.pool;
  const [campaigns, channelRows, scorecard, pendingProposals, experiments, recentRuns] = await Promise.all([
    rows(pool, 'SELECT * FROM oshal_marketing_campaigns WHERE user_sub = $1 ORDER BY updated_at DESC', [sub]),
    rows(pool, 'SELECT * FROM oshal_marketing_channel_authorizations WHERE user_sub = $1', [sub]),
    safeRows(pool, 'SELECT * FROM oshal_marketing_scorecard_weeks WHERE user_sub = $1 ORDER BY week_start DESC LIMIT 2', [sub]),
    rows(pool, "SELECT * FROM oshal_marketing_budget_ledger WHERE user_sub = $1 AND status = 'proposed' ORDER BY created_at DESC", [sub]),
    rows(pool, "SELECT * FROM oshal_marketing_experiments WHERE user_sub = $1 AND status IN ('proposed','running','extended') ORDER BY created_at DESC", [sub]),
    safeRows(pool, 'SELECT * FROM oshal_marketing_run_ledger WHERE user_sub = $1 ORDER BY ts DESC LIMIT 20', [sub]),
  ]);
  res.json({
    campaigns,
    channels: withChannelDefaults(sub, channelRows),
    scorecard,
    pendingProposals,
    experiments,
    recentRuns,
  });
}

/** Insert one campaign row; 23505 (per-user slug collision) → conflict. */
async function insertCampaign(
  pool: QueryablePool, sub: string,
  c: { product: string; name: string; slug: string; motion: string; icp: unknown; messageMap: unknown; channels: unknown },
): Promise<{ row?: any; conflict?: boolean }> {
  try {
    const r = await rows(
      pool,
      `INSERT INTO oshal_marketing_campaigns (user_sub, product, name, slug, motion, icp, message_map, channels)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) RETURNING *`,
      [sub, c.product, c.name, c.slug, c.motion, JSON.stringify(c.icp ?? {}), JSON.stringify(c.messageMap ?? {}), JSON.stringify(Array.isArray(c.channels) ? c.channels : [])],
    );
    return { row: r[0] };
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return { conflict: true };
    throw err;
  }
}

/**
 * @description POST /campaigns — create from an explicit operator request.
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
export async function createCampaign(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const product = typeof b.product === 'string' ? b.product.trim().slice(0, 200) : '';
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 200) : '';
  if (!product || !name) { res.status(400).json({ error: 'product_and_name_required' }); return; }
  const motion = b.motion === 'revenue' ? 'revenue' : 'adoption';
  const slug = slugify(name);
  if (!slug) { res.status(400).json({ error: 'name_not_sluggable' }); return; }
  const icp = typeof b.icp === 'object' && b.icp ? b.icp : {};
  const messageMap = typeof b.messageMap === 'object' && b.messageMap ? b.messageMap : {};
  if (tooLarge(icp, 100_000) || tooLarge(messageMap, 100_000)) { res.status(400).json({ error: 'payload_too_large' }); return; }
  const created = await insertCampaign(ctx.pool, sub, {
    product, name, slug, motion, icp, messageMap,
    channels: Array.isArray(b.channels) ? b.channels.filter((c) => typeof c === 'string').slice(0, 12) : [],
  });
  if (created.conflict) { res.status(409).json({ error: 'slug_exists', slug }); return; }
  res.status(201).json({ campaign: created.row });
}

/**
 * @description POST /campaigns/import — sanitized import (NEVER consent/budget/stage — the series-pump rule).
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
export async function importCampaign(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const raw = (req.body as { campaign?: unknown } | null)?.campaign;
  if (!raw || typeof raw !== 'object') { res.status(400).json({ error: 'campaign_required' }); return; }
  const clean = sanitizeCampaignImport(raw as Record<string, unknown>) as Record<string, unknown>;
  const product = typeof clean.product === 'string' ? clean.product.trim().slice(0, 200) : '';
  const name = typeof clean.name === 'string' ? clean.name.trim().slice(0, 200) : '';
  if (!product || !name) { res.status(400).json({ error: 'import_missing_fields', hint: 'campaign.product and campaign.name are required' }); return; }
  const slug = slugify(typeof clean.slug === 'string' && clean.slug.trim() ? clean.slug : name);
  if (!slug) { res.status(400).json({ error: 'name_not_sluggable' }); return; }
  const messageMapRaw = clean.message_map ?? clean.messageMap;
  const icp = typeof clean.icp === 'object' && clean.icp ? clean.icp : {};
  const messageMap = typeof messageMapRaw === 'object' && messageMapRaw ? messageMapRaw : {};
  if (tooLarge(icp, 100_000) || tooLarge(messageMap, 100_000)) { res.status(400).json({ error: 'payload_too_large' }); return; }
  const created = await insertCampaign(ctx.pool, sub, {
    product, name, slug,
    motion: clean.motion === 'revenue' ? 'revenue' : 'adoption',
    icp, messageMap,
    channels: Array.isArray(clean.channels) ? clean.channels : [],
  });
  if (created.conflict) { res.status(409).json({ error: 'slug_exists', slug }); return; }
  res.status(201).json({ campaign: created.row, imported: true });
}

/** Whitelist + validate a campaign PATCH body into column→value pairs. */
function parseCampaignPatch(body: Record<string, unknown>): { fields: Record<string, unknown>; error?: string } {
  const fields: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
    if (!name) return { fields, error: 'name must be a non-empty string' };
    fields.name = name;
  }
  if (body.status !== undefined) {
    if (!(CAMPAIGN_STATUSES as readonly string[]).includes(String(body.status))) return { fields, error: 'invalid status' };
    fields.status = body.status;
  }
  if (body.stage !== undefined) {
    const stage = Number(body.stage);
    if (!Number.isInteger(stage) || stage < 0 || stage > 3) return { fields, error: 'stage must be an integer 0-3' };
    fields.stage = stage;
  }
  if (body.icp !== undefined) {
    if (typeof body.icp !== 'object' || !body.icp || Array.isArray(body.icp)) return { fields, error: 'icp must be an object' };
    fields.icp = body.icp;
  }
  const messageMap = body.messageMap ?? body.message_map;
  if (messageMap !== undefined) {
    if (typeof messageMap !== 'object' || !messageMap || Array.isArray(messageMap)) return { fields, error: 'messageMap must be an object' };
    fields.message_map = messageMap;
  }
  if (body.channels !== undefined) {
    if (!Array.isArray(body.channels)) return { fields, error: 'channels must be an array' };
    fields.channels = body.channels.filter((c) => typeof c === 'string').slice(0, 12);
  }
  const budget = body.budgetMonthlyUsd ?? body.budget_monthly_usd;
  if (budget !== undefined) {
    const n = Number(budget);
    if (!Number.isFinite(n) || n < 0) return { fields, error: 'budgetMonthlyUsd must be a number >= 0' };
    fields.budget_monthly_usd = n;
  }
  const targetCpa = body.targetCpaUsd ?? body.target_cpa_usd;
  if (targetCpa !== undefined) {
    if (targetCpa !== null) {
      const n = Number(targetCpa);
      if (!Number.isFinite(n) || n <= 0) return { fields, error: 'targetCpaUsd must be a positive number or null' };
      fields.target_cpa_usd = n;
    } else {
      fields.target_cpa_usd = null;
    }
  }
  return { fields };
}

/** Append the human-decided 'applied' budget-ledger row for a direct campaign edit. */
async function appendAppliedLedger(
  pool: QueryablePool, sub: string, campaignId: string, field: string, oldValue: unknown, newValue: unknown,
): Promise<void> {
  await pool.query(
    `INSERT INTO oshal_marketing_budget_ledger
       (user_sub, campaign_id, field, old_value, new_value, status, proposed_by, decided_by, decided_at)
     VALUES ($1,$2,$3,$4,$5,'applied','human',$6,now())`,
    [sub, campaignId, field, oldValue === null || oldValue === undefined ? null : String(oldValue), String(newValue), sub],
  );
}

/**
 * @description PATCH /campaigns/:id — whitelisted update; budget/stage edits also land in the budget ledger.
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
export async function patchCampaign(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const id = String(req.params.id || '');
  const existing = await loadCampaign(ctx.pool, sub, id);
  if (!existing) { res.status(404).json({ error: 'campaign_not_found' }); return; }
  const { fields, error } = parseCampaignPatch((req.body ?? {}) as Record<string, unknown>);
  if (error) { res.status(400).json({ error }); return; }
  if (Object.keys(fields).length === 0) { res.status(400).json({ error: 'no_updatable_fields' }); return; }
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [col, val] of Object.entries(fields)) {
    vals.push(JSONB_COLS.has(col) ? JSON.stringify(val) : val);
    sets.push(`${col} = $${vals.length}${JSONB_COLS.has(col) ? '::jsonb' : ''}`);
  }
  vals.push(id, sub);
  const updated = (await rows(
    ctx.pool,
    `UPDATE oshal_marketing_campaigns SET ${sets.join(', ')}, updated_at = now()
     WHERE campaign_id = $${vals.length - 1} AND user_sub = $${vals.length} RETURNING *`,
    vals,
  ))[0];
  if ('budget_monthly_usd' in fields && Number(existing.budget_monthly_usd) !== Number(fields.budget_monthly_usd)) {
    await appendAppliedLedger(ctx.pool, sub, id, 'budget_monthly_usd', existing.budget_monthly_usd, fields.budget_monthly_usd);
  }
  if ('stage' in fields && Number(existing.stage) !== Number(fields.stage)) {
    await appendAppliedLedger(ctx.pool, sub, id, 'stage', existing.stage, fields.stage);
  }
  res.json({ campaign: updated });
}

/** Insert one content item as a reviewable draft (with optional multipart email template columns). */
async function insertContent(
  pool: QueryablePool, sub: string,
  c: {
    campaignId: string | null;
    channel: string;
    title: string;
    body: string;
    templateId?: string | null;
    htmlBody?: string | null;
    textBody?: string | null;
  },
): Promise<any> {
  if (c.templateId !== undefined || c.htmlBody !== undefined || c.textBody !== undefined) {
    return (await rows(
      pool,
      `INSERT INTO oshal_marketing_content (user_sub, campaign_id, channel, title, body, status, template_id, html_body, text_body)
       VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8) RETURNING *`,
      [sub, c.campaignId, c.channel, c.title, c.body, c.templateId ?? null, c.htmlBody ?? null, c.textBody ?? null],
    ))[0];
  }
  return (await rows(
    pool,
    `INSERT INTO oshal_marketing_content (user_sub, campaign_id, channel, title, body, status)
     VALUES ($1,$2,$3,$4,$5,'draft') RETURNING *`,
    [sub, c.campaignId, c.channel, c.title, c.body],
  ))[0];
}

/** Validate optional email template id (defaults to 'announcement'). */
function resolveEmailTemplateId(raw: unknown): MarketingTemplateId | null {
  if (raw === undefined || raw === null || raw === '') return 'announcement';
  const id = String(raw).trim();
  return (MARKETING_TEMPLATE_IDS as readonly string[]).includes(id) ? (id as MarketingTemplateId) : null;
}

/** Persist a rendered email draft using one of the built-in compliance templates. */
async function saveTemplatedEmailDraft(
  pool: QueryablePool,
  sub: string,
  campaignId: string,
  templateId: MarketingTemplateId,
  input: Record<string, unknown>,
  rawBody: string,
): Promise<{ item: any; compliance: unknown; canApprove: boolean }> {
  const { settings } = await loadComplianceSettings(pool, sub);
  const rendered = renderMarketingTemplate({ ...input, templateId }, settings);
  const item = await insertContent(pool, sub, {
    campaignId,
    channel: 'email',
    title: rendered.subject.slice(0, 200),
    body: rawBody,
    templateId: rendered.templateId,
    htmlBody: rendered.html,
    textBody: rendered.text,
  });
  return { item, compliance: rendered.compliance, canApprove: rendered.canApprove };
}

/**
 * @description POST /drafts — campaign-director writes one channel draft (or stores an operator-authored
 * templated email draft); email drafts always render through a built-in compliance template.
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
export async function createDraft(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const channel = String(b.channel || '');
  if (!(CHANNELS as readonly string[]).includes(channel)) { res.status(400).json({ error: 'unknown_channel' }); return; }
  const templateId = channel === 'email' ? resolveEmailTemplateId(b.templateId) : null;
  if (channel === 'email' && !templateId) { res.status(400).json({ error: 'invalid_template_id' }); return; }
  const campaign = await loadCampaign(ctx.pool, sub, String(b.campaignId || ''));
  if (!campaign) { res.status(404).json({ error: 'campaign_not_found' }); return; }

  const directBody = typeof b.body === 'string' ? b.body.trim().slice(0, 8000) : '';
  if (channel === 'email' && directBody) {
    try {
      const saved = await saveTemplatedEmailDraft(ctx.pool, sub, String(campaign.campaign_id), templateId!, {
        subject: b.subject ?? b.title ?? b.brief,
        headline: b.headline ?? b.subject ?? b.title,
        intro: b.intro,
        body: directBody,
        sections: b.sections,
        highlights: b.highlights,
        ctaLabel: b.ctaLabel,
        ctaUrl: b.ctaUrl,
        unsubscribeUrl: b.unsubscribeUrl,
      }, directBody);
      res.status(201).json(saved);
    } catch (err) {
      const e = err as Error & { code?: string };
      res.status(400).json({ error: e.code || 'invalid_template_input', message: e.message });
    }
    return;
  }

  const brief = typeof b.brief === 'string' ? b.brief.trim().slice(0, 2000) : '';
  if (!brief) { res.status(400).json({ error: 'brief_required' }); return; }
  await respondWithBot(res, async () => {
    const text = await runMarketingBot(ctx, CAMPAIGN_DIRECTOR_ID, 'draft', String(campaign.slug), sub, draftPrompt(campaign, channel, brief, templateId ?? undefined));
    if (channel === 'email' && templateId) {
      const parsed = parseEmailDraftCopy(text, brief.slice(0, 120));
      const saved = await saveTemplatedEmailDraft(ctx.pool, sub, String(campaign.campaign_id), templateId, {
        subject: parsed.subject, headline: parsed.headline, intro: parsed.intro, body: parsed.body,
        ctaLabel: b.ctaLabel, ctaUrl: b.ctaUrl, unsubscribeUrl: b.unsubscribeUrl,
      }, text);
      res.status(201).json(saved);
      return;
    }
    const item = await insertContent(ctx.pool, sub, {
      campaignId: String(campaign.campaign_id), channel, title: brief.slice(0, 120), body: text,
    });
    res.status(201).json({ item });
  });
}

/**
 * @description POST /research — market-analyst refines the campaign ICP (raw text preserved on parse failure).
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
export async function runResearch(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const campaign = await loadCampaign(ctx.pool, sub, String((req.body as { campaignId?: unknown } | null)?.campaignId || ''));
  if (!campaign) { res.status(404).json({ error: 'campaign_not_found' }); return; }
  await respondWithBot(res, async () => {
    const text = await runMarketingBot(ctx, MARKET_ANALYST_ID, 'research', String(campaign.slug), sub, researchPrompt(campaign));
    const parsed = extractJsonObject(text);
    const baseIcp = (typeof campaign.icp === 'object' && campaign.icp) ? campaign.icp as Record<string, unknown> : {};
    const merged = parsed ? { ...baseIcp, ...parsed } : null;
    const icp = merged && !tooLarge(merged, 200_000) ? merged : { ...baseIcp, rawNotes: text.slice(0, 8000) };
    const updated = (await rows(
      ctx.pool,
      'UPDATE oshal_marketing_campaigns SET icp = $1::jsonb, updated_at = now() WHERE campaign_id = $2 AND user_sub = $3 RETURNING *',
      [JSON.stringify(icp), String(campaign.campaign_id), sub],
    ))[0];
    res.json({ campaign: updated, parsed: merged !== null && icp === merged });
  });
}

/**
 * @description POST /launch-checklist — launch-coordinator emits a checklist item (channel 'launch', human-posted).
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
export async function runLaunchChecklist(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const campaign = await loadCampaign(ctx.pool, sub, String((req.body as { campaignId?: unknown } | null)?.campaignId || ''));
  if (!campaign) { res.status(404).json({ error: 'campaign_not_found' }); return; }
  await respondWithBot(res, async () => {
    const text = await runMarketingBot(ctx, LAUNCH_COORDINATOR_ID, 'launch', String(campaign.slug), sub, launchPrompt(campaign));
    const item = await insertContent(ctx.pool, sub, {
      campaignId: String(campaign.campaign_id), channel: 'launch',
      title: `Launch checklist — ${String(campaign.name)}`.slice(0, 200), body: text,
    });
    res.status(201).json({ item });
  });
}

/**
 * @description GET /content — the caller's content items (board fodder), optional campaign filter.
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
export async function listContent(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const campaignId = String(req.query.campaignId || '');
  const params: unknown[] = [sub];
  let where = 'user_sub = $1';
  if (campaignId) {
    if (!UUID_RE.test(campaignId)) { res.status(400).json({ error: 'invalid_campaign_id' }); return; }
    params.push(campaignId);
    where += ` AND campaign_id = $${params.length}`;
  }
  const items = await rows(
    ctx.pool,
    `SELECT * FROM oshal_marketing_content WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
    params,
  );
  res.json({ items });
}

/**
 * @description POST /content/:id/publish — the full consent→cap→confirm→rail→ledger chain.
 * @param ctx - Framework app context.
 * @param sub - The caller's OIDC subject.
 * @param req - The Express request.
 * @param res - The Express response.
 * @returns Resolves when the response is sent.
 */
export async function publishContent(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const itemId = String(req.params.id || '');
  if (!UUID_RE.test(itemId)) { res.status(404).json({ error: 'content_not_found' }); return; }
  const item = (await rows(
    ctx.pool, 'SELECT * FROM oshal_marketing_content WHERE item_id = $1 AND user_sub = $2', [itemId, sub],
  ))[0];
  if (!item) { res.status(404).json({ error: 'content_not_found' }); return; }
  if (!(CHANNELS as readonly string[]).includes(String(item.channel))) {
    res.status(400).json({ error: 'channel_not_publishable', hint: 'launch items are posted by a human, never by this endpoint.' });
    return;
  }
  if (item.status === 'published') { res.status(409).json({ error: 'already_published', ref: item.published_ref ?? null }); return; }
  if (item.status === 'rejected') { res.status(409).json({ error: 'content_rejected' }); return; }
  const channel = String(item.channel);
  const detailBase = { itemId, campaignId: item.campaign_id ?? null };
  const refusal = await gatePublish(ctx, sub, channel, req.body);
  if (refusal) {
    await recordRun(ctx.pool, sub, channel, 'publish', refusal.outcome, { ...detailBase, reason: refusal.reason });
    res.status(refusal.status).json(refusal.payload);
    return;
  }
  const rail = await runPublishRail(ctx, sub, item, (req.body ?? {}) as Record<string, unknown>);
  if (!rail.ok) {
    const outcome = rail.outcome || 'error';
    await recordRun(ctx.pool, sub, channel, 'publish', outcome, {
      ...detailBase,
      error: rail.error ?? 'unknown',
      ...(rail.hint ? { reason: rail.hint } : {}),
    });
    res.status(rail.status).json({
      error: rail.error,
      ...(rail.hint ? { hint: rail.hint } : {}),
      ...(rail.reasons ? { reasons: rail.reasons } : {}),
    });
    return;
  }
  const updated = (await rows(
    ctx.pool,
    `UPDATE oshal_marketing_content SET status = 'published', published_ref = $1, updated_at = now()
     WHERE item_id = $2 AND user_sub = $3 RETURNING *`,
    [rail.ref ?? null, itemId, sub],
  ))[0];
  await recordRun(ctx.pool, sub, channel, 'publish', 'published', { ...detailBase, ref: rail.ref ?? null });
  res.json({ item: updated, ref: rail.ref ?? null });
}
