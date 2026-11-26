/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Marketing Engine 0.6.7 P3 launch plan and
 *     unified marketing calendar routes under /api/marketing: GET/POST /launch-plans,
 *     GET/PATCH /launch-plans/:id, POST /launch-plans/:id/retro (strictly grounded from
 *     recorded DB rows only, emitting NO DATA where unrecorded), and GET /calendar
 *     (deduplicated read-only timeline combining engine scheduled content, launch plan
 *     milestones, broadcasts, and optional Switchboard scheduled posts). Mirrors migration
 *     008-marketing-launch-plans.sql at the lazy-DDL chokepoint.
 *
 * @module marketing-launch
 */

import type { Request, Response, Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { runRuntimeSchemaBootstrap, buildOwnerRlsPolicyStatements } from '@/shared/services/database';
import {
  buildCampaignRetro,
  buildUnifiedCalendar,
  isIsoCalendarDate,
  normalizeLaunchPlan,
  normalizeLaunchPlanPatch,
} from './marketing-launch-model';
import {
  UUID_RE, authed, loadCampaign, logger, rows, safeRows, type QueryablePool,
} from './marketing-support';

/** Lazy-DDL mirror of migrations/008-marketing-launch-plans.sql. */
const LAUNCH_PLAN_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS oshal_marketing_launch_plans (
    plan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub TEXT NOT NULL,
    campaign_id UUID NOT NULL REFERENCES oshal_marketing_campaigns (campaign_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    launch_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','ready','launched','retro_complete')),
    milestones JSONB NOT NULL DEFAULT '[]',
    checklist JSONB NOT NULL DEFAULT '[]',
    retro_markdown TEXT,
    retro_facts JSONB,
    retro_generated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner_sub, campaign_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_oshal_marketing_launch_plans_owner_date
    ON oshal_marketing_launch_plans (owner_sub, launch_date DESC)`,
  'ALTER TABLE oshal_marketing_content ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ',
];

/**
 * @description Ensure the 008-marketing-launch-plans table, exact-owner FORCE RLS policy,
 * and oshal_marketing_content.scheduled_for column at the lazy-DDL chokepoint.
 */
export async function ensureLaunchPlanSchema(pool: AppContext['pool']): Promise<void> {
  await runRuntimeSchemaBootstrap({
    pool,
    moduleName: 'marketing-launch',
    statements: [
      ...LAUNCH_PLAN_DDL,
      ...buildOwnerRlsPolicyStatements('oshal_marketing_launch_plans', 'owner_sub'),
    ],
    requirements: [
      {
        table: 'oshal_marketing_launch_plans',
        columns: ['plan_id', 'owner_sub', 'campaign_id', 'title', 'launch_date', 'status', 'milestones', 'checklist'],
      },
      { table: 'oshal_marketing_content', columns: ['scheduled_for'] },
    ],
  });
}

/** Format a launch plan DB row with normalized YYYY-MM-DD launch_date. */
function formatPlanRow(row: Record<string, unknown>): Record<string, unknown> {
  const ld = row.launch_date instanceof Date
    ? row.launch_date.toISOString().slice(0, 10)
    : String(row.launch_date || '').slice(0, 10);
  return {
    ...row,
    launch_date: ld,
    milestones: Array.isArray(row.milestones) ? row.milestones : [],
    checklist: Array.isArray(row.checklist) ? row.checklist : [],
  };
}

/** Load one caller-owned launch plan row (null for invalid UUID or foreign owner). */
async function loadLaunchPlan(pool: QueryablePool, sub: string, planId: string): Promise<Record<string, unknown> | null> {
  if (!UUID_RE.test(planId)) return null;
  const found = await rows(
    pool,
    `SELECT lp.*, c.name AS campaign_name, c.slug AS campaign_slug
       FROM oshal_marketing_launch_plans lp
       LEFT JOIN oshal_marketing_campaigns c
         ON c.campaign_id = lp.campaign_id AND c.user_sub = lp.owner_sub
      WHERE lp.plan_id = $1 AND lp.owner_sub = $2`,
    [planId, sub],
  );
  return found[0] ? formatPlanRow(found[0]) : null;
}

/**
 * @description GET /launch-plans — list caller's launch plans, newest launch date first (read-only).
 */
export async function listLaunchPlans(ctx: AppContext, sub: string, _req: Request, res: Response): Promise<void> {
  const found = await rows(
    ctx.pool,
    `SELECT lp.*, c.name AS campaign_name, c.slug AS campaign_slug
       FROM oshal_marketing_launch_plans lp
       LEFT JOIN oshal_marketing_campaigns c
         ON c.campaign_id = lp.campaign_id AND c.user_sub = lp.owner_sub
      WHERE lp.owner_sub = $1
      ORDER BY lp.launch_date DESC, lp.updated_at DESC LIMIT 200`,
    [sub],
  );
  res.json({ plans: found.map(formatPlanRow) });
}

/**
 * @description POST /launch-plans — create or replace a launch plan for a caller-owned campaign.
 */
export async function createLaunchPlan(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const checked = normalizeLaunchPlan(req.body ?? {});
  if (!checked.ok) {
    res.status(400).json({ error: checked.error, message: checked.message });
    return;
  }
  const p = checked.plan;
  const campaign = await loadCampaign(ctx.pool, sub, p.campaignId);
  if (!campaign) {
    res.status(404).json({ error: 'campaign_not_found' });
    return;
  }
  const saved = (await rows(
    ctx.pool,
    `INSERT INTO oshal_marketing_launch_plans
       (owner_sub, campaign_id, title, launch_date, status, milestones, checklist, updated_at)
     VALUES ($1,$2,$3,$4::date,$5,$6::jsonb,$7::jsonb,now())
     ON CONFLICT (owner_sub, campaign_id) DO UPDATE SET
       title = EXCLUDED.title,
       launch_date = EXCLUDED.launch_date,
       status = EXCLUDED.status,
       milestones = EXCLUDED.milestones,
       checklist = EXCLUDED.checklist,
       updated_at = now()
     RETURNING *`,
    [sub, p.campaignId, p.title, p.launchDate, p.status, JSON.stringify(p.milestones), JSON.stringify(p.checklist)],
  ))[0];
  res.status(201).json({
    plan: formatPlanRow({ ...saved, campaign_name: campaign.name, campaign_slug: campaign.slug }),
  });
}

/**
 * @description GET /launch-plans/:id — return one caller-owned launch plan (read-only; foreign 404).
 */
export async function getLaunchPlan(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const plan = await loadLaunchPlan(ctx.pool, sub, String(req.params.id || ''));
  if (!plan) {
    res.status(404).json({ error: 'launch_plan_not_found' });
    return;
  }
  res.json({ plan });
}

/**
 * @description PATCH /launch-plans/:id — update launch plan status, milestones, or checklist items.
 */
export async function patchLaunchPlan(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const planId = String(req.params.id || '');
  const existing = await loadLaunchPlan(ctx.pool, sub, planId);
  if (!existing) {
    res.status(404).json({ error: 'launch_plan_not_found' });
    return;
  }
  const checked = normalizeLaunchPlanPatch(req.body ?? {});
  if (!checked.ok) {
    res.status(400).json({ error: checked.error, message: checked.message });
    return;
  }
  const p = checked.patch;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (p.title !== undefined) { vals.push(p.title); sets.push(`title = $${vals.length}`); }
  if (p.launchDate !== undefined) { vals.push(p.launchDate); sets.push(`launch_date = $${vals.length}::date`); }
  if (p.status !== undefined) { vals.push(p.status); sets.push(`status = $${vals.length}`); }
  if (p.milestones !== undefined) { vals.push(JSON.stringify(p.milestones)); sets.push(`milestones = $${vals.length}::jsonb`); }
  if (p.checklist !== undefined) { vals.push(JSON.stringify(p.checklist)); sets.push(`checklist = $${vals.length}::jsonb`); }
  vals.push(planId, sub);
  const updated = (await rows(
    ctx.pool,
    `UPDATE oshal_marketing_launch_plans
        SET ${sets.join(', ')}, updated_at = now()
      WHERE plan_id = $${vals.length - 1} AND owner_sub = $${vals.length}
      RETURNING *`,
    vals,
  ))[0];
  res.json({
    plan: formatPlanRow({ ...updated, campaign_name: existing.campaign_name, campaign_slug: existing.campaign_slug }),
  });
}

/** Load caller's recorded campaign metrics, run ledger, broadcast deliveries, and experiments. */
async function loadCampaignRetroInputs(pool: QueryablePool, sub: string, campaignId: string, slug: string) {
  const [metricsRows, runLedgerRows, broadcastDeliveryRows, experiments] = await Promise.all([
    safeRows(pool, 'SELECT source, event, value, ts FROM oshal_marketing_events WHERE user_sub = $1 AND campaign_slug = $2', [sub, slug]),
    safeRows(pool, "SELECT channel, action, outcome, detail, ts FROM oshal_marketing_run_ledger WHERE user_sub = $1 AND detail->>'campaignId' = $2", [sub, campaignId]),
    safeRows(
      pool,
      `SELECT d.status, d.gate_reason, d.created_at
         FROM oshal_marketing_deliveries d
         JOIN oshal_marketing_messages m
           ON m.message_id = d.message_id AND m.owner_sub = d.owner_sub
        WHERE d.owner_sub = $1 AND m.campaign_id = $2`,
      [sub, campaignId],
    ),
    safeRows(pool, 'SELECT experiment_id, status, verdict FROM oshal_marketing_experiments WHERE user_sub = $1 AND campaign_id = $2', [sub, campaignId]),
  ]);
  return { metricsRows, runLedgerRows, broadcastDeliveryRows, experiments };
}

/**
 * @description POST /launch-plans/:id/retro — compute and persist a strictly grounded campaign
 * retrospective citing ONLY the caller's recorded DB rows (emitting NO DATA where unrecorded).
 */
export async function generateLaunchRetro(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const planId = String(req.params.id || '');
  const plan = await loadLaunchPlan(ctx.pool, sub, planId);
  if (!plan) { res.status(404).json({ error: 'launch_plan_not_found' }); return; }
  const campaignId = String(plan.campaign_id || '');
  const campaign = await loadCampaign(ctx.pool, sub, campaignId);
  if (!campaign) { res.status(404).json({ error: 'campaign_not_found' }); return; }
  const recorded = await loadCampaignRetroInputs(ctx.pool, sub, campaignId, String(campaign.slug || ''));
  const retro = buildCampaignRetro({
    campaign,
    plan: {
      launchDate: String(plan.launch_date || ''),
      milestones: Array.isArray(plan.milestones) ? plan.milestones : [],
      checklist: Array.isArray(plan.checklist) ? plan.checklist : [],
    },
    ...recorded,
  });
  const updated = (await rows(
    ctx.pool,
    `UPDATE oshal_marketing_launch_plans
        SET status = 'retro_complete', retro_markdown = $1, retro_facts = $2::jsonb,
            retro_generated_at = now(), updated_at = now()
      WHERE plan_id = $3 AND owner_sub = $4
      RETURNING *`,
    [retro.markdown, JSON.stringify(retro), planId, sub],
  ))[0];
  res.json({
    plan: formatPlanRow({ ...updated, campaign_name: campaign.name, campaign_slug: campaign.slug }),
    retro,
  });
}

/** Read owner-scoped Switchboard scheduled posts if the table is installed and readable; degrade cleanly otherwise. */
async function readOptionalSwitchboardPosts(
  pool: QueryablePool,
  sub: string,
): Promise<{ available: boolean; posts: Record<string, unknown>[] }> {
  try {
    const found = await rows(
      pool,
      `SELECT post_id, platform, body, scheduled_at, status, created_at
         FROM oshal_switchboard_scheduled_posts
        WHERE user_sub = $1
        ORDER BY scheduled_at ASC LIMIT 500`,
      [sub],
    );
    return { available: true, posts: found };
  } catch {
    return { available: false, posts: [] };
  }
}

/** Flatten launch plan JSONB milestones into calendar milestone inputs. */
function flattenPlanMilestones(plans: Record<string, unknown>[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const plan of plans) {
    const list = Array.isArray(plan.milestones) ? plan.milestones : [];
    for (const ms of list) {
      if (!ms || typeof ms !== 'object') continue;
      out.push({
        ...(ms as Record<string, unknown>),
        planId: plan.plan_id,
        planTitle: plan.title,
        campaignId: plan.campaign_id,
      });
    }
  }
  return out;
}

/**
 * @description GET /calendar — unified read-only marketing calendar combining scheduled engine
 * content, launch plan dated milestones, broadcasts, and optional Switchboard scheduled posts.
 */
export async function getUnifiedCalendar(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const fromRaw = typeof req.query.from === 'string' ? req.query.from.trim() : '';
  const toRaw = typeof req.query.to === 'string' ? req.query.to.trim() : '';
  if (fromRaw && !isIsoCalendarDate(fromRaw)) {
    res.status(400).json({ error: 'invalid_from_date', message: 'from must be YYYY-MM-DD.' });
    return;
  }
  if (toRaw && !isIsoCalendarDate(toRaw)) {
    res.status(400).json({ error: 'invalid_to_date', message: 'to must be YYYY-MM-DD.' });
    return;
  }
  if (fromRaw && toRaw && fromRaw > toRaw) {
    res.status(400).json({ error: 'invalid_date_range', message: 'from date cannot be after to date.' });
    return;
  }
  const [contentItems, plans, broadcasts, sb] = await Promise.all([
    safeRows(ctx.pool, 'SELECT item_id, campaign_id, channel, title, status, scheduled_for, created_at FROM oshal_marketing_content WHERE user_sub = $1 ORDER BY COALESCE(scheduled_for, created_at) ASC LIMIT 500', [sub]),
    safeRows(ctx.pool, 'SELECT plan_id, campaign_id, title, launch_date, status, milestones FROM oshal_marketing_launch_plans WHERE owner_sub = $1 ORDER BY launch_date ASC LIMIT 200', [sub]),
    safeRows(ctx.pool, 'SELECT message_id, campaign_id, subject, status, created_at FROM oshal_marketing_messages WHERE owner_sub = $1 ORDER BY created_at ASC LIMIT 200', [sub]),
    readOptionalSwitchboardPosts(ctx.pool, sub),
  ]);
  const calendar = buildUnifiedCalendar({
    contentItems,
    milestones: flattenPlanMilestones(plans),
    broadcasts,
    switchboardPosts: sb.posts,
    switchboardAvailable: sb.available,
    fromDate: fromRaw || null,
    toDate: toRaw || null,
  });
  res.json(calendar);
}

/**
 * @description Register P3 launch plan and unified marketing calendar routes under /api/marketing.
 */
export function registerLaunchRoutes(router: Router, ctx: AppContext): void {
  ensureLaunchPlanSchema(ctx.pool).catch((err) => logger.error({ err }, 'Failed to ensure marketing-engine launch plans schema'));
  router.get('/launch-plans', authed(ctx, listLaunchPlans));
  router.post('/launch-plans', authed(ctx, createLaunchPlan));
  router.get('/launch-plans/:id', authed(ctx, getLaunchPlan));
  router.patch('/launch-plans/:id', authed(ctx, patchLaunchPlan));
  router.post('/launch-plans/:id/retro', authed(ctx, generateLaunchRetro));
  router.get('/calendar', authed(ctx, getUnifiedCalendar));
}
