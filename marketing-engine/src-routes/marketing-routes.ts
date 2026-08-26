/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial marketing-engine API (/api/marketing, oidc): campaign CRUD + sanitized import (import never arms spend/consent — series-pump rule), per-channel consent PUT (428-gated standing authorization), inline-bot drafts/research/launch-checklist via executeBotOrInline (hosted-brain aware), the consent→cap→confirm(428)→rail→run-ledger publish chain (LinkedIn/Mastodon connector actions, Bluesky fixed op, Resend email — honest 409/503 degradation), scorecard read/rebuild, experiment lifecycle, budget-proposal decisions, UTM builder. Pure gates come from ./marketing-model.
 *
 * @module marketing-routes
 */

import { Router, type Request, type Response, type RequestHandler } from 'express';
import * as path from 'path';
import { createChildLogger } from '@/shared/logger';
import type { AppContext, QueryablePool } from '@/app/composition/app-context';
import { runRuntimeSchemaBootstrap, buildOwnerRlsPolicyStatements } from '@/shared/services/database';
import { hasExplicitWriteConfirmation, confirmationRequiredPayload } from '@/shared/security/explicit-write-confirmation';
import { executeBotOrInline } from '@/app/routes/inline-bot-execution';
import { BotNodeClient, createRegistryEndpointResolver } from '@/features/agent-management';
import { getValidAccessToken } from '@/app/routes/connectors-routes';
import { resolveConnectionRow } from '@/app/routes/connector-tenancy';
import {
  loadConnectorSpec, resolveConnectorActionCreds, runConnectorAction,
  type ConnectorActionAuditPool, type ConnectorSpec,
} from '@/app/connectors/runtime';
import { postToBluesky } from './marketing-bluesky-operation';
import {
  publishDecision, sanitizeCampaignImport, buildUtmUrl, scorecardRollup, weekStartOf,
} from './marketing-model';

/** Load-time-only fallback for frameworks predating ctx.appPackageDir. */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

const logger = createChildLogger({ module: 'marketing-routes' });

/** Inline concierge bots declared by this package's manifest (oshal-app.yaml bots[]). */
const CAMPAIGN_DIRECTOR_ID = 'cadf0000-0000-4000-8000-000000000001';
const MARKET_ANALYST_ID = 'cadf0000-0000-4000-8000-000000000002';
const LAUNCH_COORDINATOR_ID = 'cadf0000-0000-4000-8000-000000000004';
const botClient = new BotNodeClient(createRegistryEndpointResolver());

/** The only channels this app can publish to; 'launch' items are human-posted, never publishable. */
const CHANNELS = ['linkedin', 'mastodon', 'bluesky', 'email'] as const;
const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Legal experiment status transitions (proposed→running→extended|killed|scaled; extended→killed|scaled). */
const EXPERIMENT_TRANSITIONS: Record<string, string[]> = {
  proposed: ['running'],
  running: ['extended', 'killed', 'scaled'],
  extended: ['killed', 'scaled'],
  killed: [],
  scaled: [],
};

/** Per-channel drafting constraints woven into the bot prompt. */
const CHANNEL_CONSTRAINTS: Record<string, string> = {
  linkedin: 'LinkedIn member post: professional tone, 700-1200 characters, at most 3 hashtags.',
  mastodon: 'Mastodon status: at most 500 characters, conversational, at most 2 hashtags.',
  bluesky: 'Bluesky post: at most 300 characters, plain text, no hashtag spam.',
  email: 'Email: first line is the subject, then a blank line, then a short plain-text body under 200 words.',
};

const HONESTY_RULES = 'Rules: use ONLY the data provided above — never invent metrics, quotes, customer names, or reviews. '
  + 'No competitive absolutes ("only", "no one else", "unique"). The product name is lowercase "oshal".';

/** JSONB campaign columns (patched values are stringified + cast). */
const JSONB_COLS = new Set(['icp', 'message_map', 'channels']);

/** Lazy-DDL mirror of migrations/001-marketing-core.sql (the ops module mirrors 002). */
const CORE_TABLE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS oshal_marketing_campaigns (
    campaign_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_sub TEXT NOT NULL,
    product TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    motion TEXT NOT NULL DEFAULT 'adoption' CHECK (motion IN ('adoption','revenue')),
    stage INT NOT NULL DEFAULT 0 CHECK (stage BETWEEN 0 AND 3),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
    icp JSONB NOT NULL DEFAULT '{}',
    message_map JSONB NOT NULL DEFAULT '{}',
    channels JSONB NOT NULL DEFAULT '[]',
    budget_monthly_usd NUMERIC NOT NULL DEFAULT 0,
    target_cpa_usd NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_sub, slug)
  )`,
  `CREATE TABLE IF NOT EXISTS oshal_marketing_channel_authorizations (
    user_sub TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('linkedin','mastodon','bluesky','email')),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    standing_authorization BOOLEAN NOT NULL DEFAULT FALSE,
    daily_cap INT NOT NULL DEFAULT 0,
    paused_reason TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_sub, channel)
  )`,
  `CREATE TABLE IF NOT EXISTS oshal_marketing_content (
    item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_sub TEXT NOT NULL,
    campaign_id UUID REFERENCES oshal_marketing_campaigns(campaign_id) ON DELETE SET NULL,
    channel TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','published','rejected')),
    utm_url TEXT,
    published_ref TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS oshal_marketing_experiments (
    experiment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_sub TEXT NOT NULL,
    campaign_id UUID,
    hypothesis TEXT NOT NULL,
    variable TEXT NOT NULL,
    ice_impact INT NOT NULL CHECK (ice_impact BETWEEN 1 AND 10),
    ice_confidence INT NOT NULL CHECK (ice_confidence BETWEEN 1 AND 10),
    ice_ease INT NOT NULL CHECK (ice_ease BETWEEN 1 AND 10),
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','running','extended','killed','scaled')),
    window_start DATE,
    window_end DATE,
    verdict TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS oshal_marketing_budget_ledger (
    entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_sub TEXT NOT NULL,
    campaign_id UUID,
    channel TEXT,
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','applied')),
    proposed_by TEXT NOT NULL DEFAULT 'bot',
    decided_by TEXT,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_marketing_content_owner_time
    ON oshal_marketing_content (user_sub, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_marketing_budget_owner_time
    ON oshal_marketing_budget_ledger (user_sub, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_marketing_experiments_owner_time
    ON oshal_marketing_experiments (user_sub, created_at DESC)`,
];

const CORE_RLS_TABLES = [
  'oshal_marketing_campaigns',
  'oshal_marketing_channel_authorizations',
  'oshal_marketing_content',
  'oshal_marketing_experiments',
  'oshal_marketing_budget_ledger',
];

/** Unified publish-rail result (honest degradation: 409 not_connected, 503 unavailable). */
interface RailResult {
  ok: boolean;
  status: number;
  ref?: string;
  error?: string;
  hint?: string;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The signed-in user's OIDC subject, or null if unauthenticated. */
function callerSub(req: Request): string | null {
  const u = (req as { oidc?: { user?: { sub?: string } } }).oidc?.user;
  return u?.sub ? String(u.sub) : null;
}

/** Serve a static HTML surface from the package tools directory. */
function servePage(dir: string, file: string): RequestHandler {
  return (_req, res) => {
    res.sendFile(path.join(dir, file), (err) => {
      if (err) { logger.error({ err, file }, 'Failed to serve marketing surface'); res.status(404).send('Page not found'); }
    });
  };
}

/**
 * Wrap a handler with the auth gate + logged entry/exit/duration + the error boundary.
 * Every endpoint answers 401 not_authenticated without a session sub; every throw is logged.
 */
function authed(
  ctx: AppContext,
  fn: (ctx: AppContext, sub: string, req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const started = Date.now();
    const route = `${req.method} ${req.path}`;
    logger.info({ route }, 'marketing route start');
    try {
      await fn(ctx, sub, req, res);
      logger.info({ route, durationMs: Date.now() - started }, 'marketing route done');
    } catch (err) {
      logger.error({ err, route, durationMs: Date.now() - started }, 'marketing route failed');
      if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
    }
  };
}

/** Run a query and return its rows. */
async function rows(pool: QueryablePool, sql: string, params: unknown[]): Promise<any[]> {
  return (await pool.query(sql, params)).rows;
}

/** Rows for tables owned by the ops module (002): a missing table degrades to [] (logged). */
async function safeRows(pool: QueryablePool, sql: string, params: unknown[]): Promise<any[]> {
  try {
    return await rows(pool, sql, params);
  } catch (err) {
    logger.error({ err }, 'marketing metrics-tier query failed (degrading to empty)');
    return [];
  }
}

/** Bounded JSON rendering for prompts (never throws; slices to max chars). */
function boundJson(value: unknown, max: number): string {
  try { return JSON.stringify(value ?? {}).slice(0, max); } catch (err) {
    logger.error({ err }, 'boundJson serialization failed');
    return '{}';
  }
}

/** URL-safe slug from a campaign name. */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

/** Serialized-size guard for jsonb writes (truncating JSON would corrupt it — reject instead). */
function tooLarge(value: unknown, maxChars: number): boolean {
  return JSON.stringify(value ?? {}).length > maxChars;
}

/** Load a connector spec from the deployed spec dir; null (logged) when missing/invalid. */
function loadSpecSafe(provider: string): ConnectorSpec | null {
  try {
    const dir = process.env.OSHAL_CONNECTOR_SPEC_DIR || '/app/swarm-apps/connectors';
    return loadConnectorSpec(path.join(dir, `${provider}.yaml`));
  } catch (err) {
    logger.error({ err, provider }, 'connector spec load failed');
    return null;
  }
}

/** Does a loaded spec declare the named write action? */
function specHasAction(spec: ConnectorSpec | null, actionName: string): boolean {
  const actions = (spec as { actions?: Array<{ name?: string }> } | null)?.actions;
  return Array.isArray(actions) && actions.some((a) => a?.name === actionName);
}

/** Load the caller's own campaign row (invalid/foreign id → null). */
async function loadCampaign(pool: QueryablePool, sub: string, campaignId: string): Promise<any | null> {
  if (!UUID_RE.test(campaignId)) return null;
  const r = await rows(pool, 'SELECT * FROM oshal_marketing_campaigns WHERE campaign_id = $1 AND user_sub = $2', [campaignId, sub]);
  return r[0] ?? null;
}

/** All four channel rows with default-OFF placeholders where no row exists. */
function withChannelDefaults(sub: string, channelRows: any[]): any[] {
  return CHANNELS.map((channel) => channelRows.find((r) => r.channel === channel) ?? {
    user_sub: sub, channel, enabled: false, standing_authorization: false,
    daily_cap: 0, paused_reason: null, updated_at: null,
  });
}

// ---------------------------------------------------------------------------
// Run ledger (002 table, ensured by the ops module; written by every publish path)
// ---------------------------------------------------------------------------

/** ALWAYS-write outcome ledger row (published|skipped_consent|skipped_cap|skipped_confirm|error). */
async function recordRun(
  pool: QueryablePool, sub: string, channel: string, action: string,
  outcome: string, detail: Record<string, unknown>,
): Promise<void> {
  try {
    await pool.query(
      'INSERT INTO oshal_marketing_run_ledger (user_sub, channel, action, outcome, detail) VALUES ($1,$2,$3,$4,$5::jsonb)',
      [sub, channel, action, outcome, JSON.stringify(detail ?? {})],
    );
  } catch (err) {
    logger.error({ err, channel, action, outcome }, 'marketing run-ledger write failed');
  }
}

/** Today's non-skip run count for (caller, channel) — the daily-cap denominator (series-pump semantics). */
async function countLedgerToday(pool: QueryablePool, sub: string, channel: string): Promise<number> {
  const r = await rows(
    pool,
    `SELECT COUNT(*)::int AS n FROM oshal_marketing_run_ledger
     WHERE user_sub = $1 AND channel = $2 AND outcome NOT LIKE 'skipped%' AND ts >= date_trunc('day', now())`,
    [sub, channel],
  );
  return Number(r[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Inline bot execution (ADR-036/ADR-127 — reasoning never happens in this controller)
// ---------------------------------------------------------------------------

/** NoHostedBrainError-shaped failure (code or wrapped message) → the honest 503. */
function isNoHostedBrain(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === 'NO_HOSTED_BRAIN' || /NO_HOSTED_BRAIN|hosted brain|AI Providers/i.test(String(e?.message || ''));
}

/**
 * Run one bounded prompt on a package inline bot, cost-attributed to the caller.
 * Reads result.success explicitly — the orchestrator swallows provider errors as
 * {success:false} instead of throwing (the ADR-127 result-shape landmine).
 */
async function runMarketingBot(
  ctx: AppContext, agentId: string, kind: string, scopeKey: string, sub: string, prompt: string,
): Promise<string> {
  const result = await executeBotOrInline(ctx, botClient, agentId, {
    text: prompt,
    taskId: `marketing-${kind}-${scopeKey}`,
    workspaceFolderId: `marketing-${sub}`,
    agentId,
    agenticMode: false,
    direct: true,
    userSub: sub,
  });
  if (!result || result.success === false) {
    throw new Error(`marketing bot turn failed: ${String((result as { error?: unknown } | null)?.error ?? 'unknown')}`);
  }
  return String(result.response ?? '');
}

/** Bounded campaign summary shared by every bot prompt. */
function campaignSummary(campaign: any): string {
  return [
    `Campaign: ${campaign.name} (product: ${campaign.product}, motion: ${campaign.motion}, stage ${campaign.stage})`,
    `ICP: ${boundJson(campaign.icp, 1500)}`,
    `Message map: ${boundJson(campaign.message_map, 1500)}`,
  ].join('\n');
}

/** Prompt for one channel draft (campaign-director). */
function draftPrompt(campaign: any, channel: string, brief: string): string {
  return [
    'You are drafting ONE marketing post. A human reviews and publishes it — you never publish.',
    campaignSummary(campaign),
    `Brief: ${brief}`,
    `Channel constraints: ${CHANNEL_CONSTRAINTS[channel]}`,
    HONESTY_RULES,
    'Return ONLY the post text (for email: subject line first, blank line, then the body). No preamble, no markdown fences.',
  ].join('\n\n');
}

/** Prompt for ICP research (market-analyst). */
function researchPrompt(campaign: any): string {
  return [
    'You are refining the ideal-customer-profile (ICP) for this campaign. You research and propose — you never publish or spend.',
    campaignSummary(campaign),
    'Return ONLY a JSON object (no fences, no preamble) with keys such as segments (array of {name, pains, gains, watering_holes}), personas, objections, positioning. Extend the existing ICP; do not drop existing keys.',
    HONESTY_RULES,
  ].join('\n\n');
}

/** Prompt for the launch checklist + human-posted community drafts (launch-coordinator). */
function launchPrompt(campaign: any): string {
  return [
    'You are preparing a launch checklist plus plain-text community post drafts a HUMAN will post manually (community norms: bots never post to HN/Reddit/Product Hunt).',
    campaignSummary(campaign),
    'Return a markdown checklist (pre-launch, launch-day, post-launch) followed by one clearly-labeled plain-text draft per community, each honest and norm-following.',
    HONESTY_RULES,
  ].join('\n\n');
}

/** Extract a JSON object from bot output (direct, fenced, or embedded); null when unparseable. */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const candidates = [cleaned];
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch (err) {
      logger.debug({ err: String(err) }, 'ICP JSON candidate did not parse');
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Publish rails (called only AFTER the consent→cap→confirm gates pass)
// ---------------------------------------------------------------------------

/** LinkedIn member share via the audited connector write action (linkedin.yaml create-post). */
async function publishLinkedIn(ctx: AppContext, sub: string, text: string): Promise<RailResult> {
  const spec = loadSpecSafe('linkedin');
  if (!spec || !specHasAction(spec, 'create-post')) {
    return { ok: false, status: 503, error: 'channel_unavailable', hint: 'core connector spec missing create-post' };
  }
  const conn = await resolveConnectionRow(ctx.pool, sub, 'linkedin');
  if (!conn || !conn.account_id) return { ok: false, status: 409, error: 'not_connected' };
  const params = {
    author: `urn:li:person:${conn.account_id}`,
    lifecycleState: 'PUBLISHED',
    specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text }, shareMediaCategory: 'NONE' } },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };
  return runSpecAction(ctx, sub, spec, 'create-post', params, 'linkedin_rejected');
}

/** Mastodon status via the connector write action (mastodon.yaml create-status, added by core). */
async function publishMastodon(ctx: AppContext, sub: string, text: string): Promise<RailResult> {
  const spec = loadSpecSafe('mastodon');
  if (!spec || !specHasAction(spec, 'create-status')) {
    return { ok: false, status: 503, error: 'channel_unavailable', hint: 'core connector spec missing create-status' };
  }
  return runSpecAction(ctx, sub, spec, 'create-status', { status: text }, 'mastodon_rejected');
}

/** Bluesky via the fixed in-process server operation (no declarative rail can do the exchange). */
async function publishBlueskyRail(ctx: AppContext, sub: string, text: string): Promise<RailResult> {
  const result = await postToBluesky(ctx.pool, sub, text);
  if (result.posted) return { ok: true, status: 200, ref: result.uri };
  if (result.error === 'bluesky_connection_unavailable') return { ok: false, status: 409, error: 'not_connected' };
  if (result.error === 'bluesky_text_too_long' || result.error === 'bluesky_text_required') {
    return { ok: false, status: 400, error: result.error };
  }
  return { ok: false, status: 502, error: result.error || 'bluesky_failed' };
}

/** One email via the Resend connector write action; from is deployment config, to is explicit. */
async function publishEmail(ctx: AppContext, sub: string, item: any, body: Record<string, unknown>): Promise<RailResult> {
  const from = (process.env.MARKETING_EMAIL_FROM || '').trim();
  if (!from) {
    return { ok: false, status: 503, error: 'email_from_unconfigured', hint: 'Set MARKETING_EMAIL_FROM to a verified sender address.' };
  }
  const to = typeof body.to === 'string' ? body.to.trim() : '';
  if (!EMAIL_RE.test(to)) return { ok: false, status: 400, error: 'invalid_recipient', hint: 'Pass a single valid email address as "to".' };
  const spec = loadSpecSafe('resend');
  if (!spec || !specHasAction(spec, 'send-email')) {
    return { ok: false, status: 503, error: 'channel_unavailable', hint: 'core connector spec missing send-email' };
  }
  const subject = String(item.title || '').trim() || 'oshal update';
  return runSpecAction(ctx, sub, spec, 'send-email', { from, to, subject, text: String(item.body) }, 'email_rejected');
}

/** Shared connector-action invocation → RailResult (confirm:true only ever passed post-gate). */
async function runSpecAction(
  ctx: AppContext, sub: string, spec: ConnectorSpec, actionName: string,
  params: Record<string, unknown>, rejectionError: string,
): Promise<RailResult> {
  const result = await runConnectorAction({
    pool: ctx.pool as unknown as ConnectorActionAuditPool,
    spec,
    resolveCreds: () => resolveConnectorActionCreds(spec, ctx.pool, sub, getValidAccessToken),
    userSub: sub,
    actionName,
    params,
    requestBody: { confirm: true },
  });
  const body = result.body as { ok?: boolean; code?: string; error?: string; data?: { id?: unknown; url?: unknown } };
  if (result.status === 200 && body.ok) {
    const ref = String(body.data?.id ?? body.data?.url ?? '').trim();
    return { ok: true, status: 200, ref: ref || undefined };
  }
  if (body.code === 'not_connected') return { ok: false, status: 409, error: 'not_connected' };
  return { ok: false, status: result.status >= 400 ? result.status : 502, error: body.error || rejectionError };
}

/** Dispatch to the channel rail. */
async function runPublishRail(ctx: AppContext, sub: string, item: any, body: Record<string, unknown>): Promise<RailResult> {
  switch (item.channel) {
    case 'linkedin': return publishLinkedIn(ctx, sub, String(item.body));
    case 'mastodon': return publishMastodon(ctx, sub, String(item.body));
    case 'bluesky': return publishBlueskyRail(ctx, sub, String(item.body));
    case 'email': return publishEmail(ctx, sub, item, body);
    default: return { ok: false, status: 400, error: 'channel_not_publishable' };
  }
}

/** Gate outcome for the run ledger from the model's denial reason (verbatim when canonical). */
function skipOutcomeFor(reason: string): string {
  if (reason === 'skipped_cap' || reason === 'skipped_consent') return reason;
  return /cap/i.test(reason) ? 'skipped_cap' : 'skipped_consent';
}

/**
 * The consent→cap→confirm gate (Non-negotiables order). Returns null when publishing may
 * proceed, else the refusal to send + the ledger outcome to record.
 */
async function gatePublish(
  ctx: AppContext, sub: string, channel: string, body: unknown,
): Promise<{ status: number; payload: unknown; outcome: string; reason: string } | null> {
  const row = (await rows(
    ctx.pool,
    'SELECT * FROM oshal_marketing_channel_authorizations WHERE user_sub = $1 AND channel = $2',
    [sub, channel],
  ))[0] ?? null;
  const todayCount = await countLedgerToday(ctx.pool, sub, channel);
  const decision = publishDecision(row, todayCount);
  if (!decision.allowed) {
    const outcome = skipOutcomeFor(decision.reason);
    const reason = String((decision as { detail?: unknown }).detail ?? decision.reason);
    return { status: 403, payload: { error: outcome, reason }, outcome, reason };
  }
  if (!hasExplicitWriteConfirmation(body)) {
    return {
      status: 428,
      payload: confirmationRequiredPayload('marketing-publish', `${channel}.publish`),
      outcome: 'skipped_confirm',
      reason: 'confirmation_required',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** GET /overview — the one board payload. */
async function getOverview(ctx: AppContext, sub: string, _req: Request, res: Response): Promise<void> {
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

/** POST /campaigns — create from an explicit operator request. */
async function createCampaign(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
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

/** POST /campaigns/import — sanitized import (NEVER consent/budget/stage — the series-pump rule). */
async function importCampaign(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
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

/** PATCH /campaigns/:id — whitelisted update; budget/stage edits also land in the budget ledger. */
async function patchCampaign(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
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

/** Validate + normalize a PUT /channels/:channel body (explicit booleans only). */
function parseChannelBody(body: Record<string, unknown>): { error?: string; enabled?: boolean; standing?: boolean; dailyCap?: number } {
  const out: { error?: string; enabled?: boolean; standing?: boolean; dailyCap?: number } = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return { error: 'enabled must be a boolean' };
    out.enabled = body.enabled === true;
  }
  if (body.standingAuthorization !== undefined) {
    if (typeof body.standingAuthorization !== 'boolean') return { error: 'standingAuthorization must be a boolean' };
    out.standing = body.standingAuthorization === true;
  }
  if (body.dailyCap !== undefined) {
    const n = Number(body.dailyCap);
    if (!Number.isInteger(n) || n < 0 || n > 1000) return { error: 'dailyCap must be an integer 0-1000' };
    out.dailyCap = n;
  }
  return out;
}

/** PUT /channels/:channel — upsert the caller's own consent row (standing enable is 428-gated). */
async function putChannel(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const channel = String(req.params.channel || '');
  if (!(CHANNELS as readonly string[]).includes(channel)) { res.status(404).json({ error: 'unknown_channel' }); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = parseChannelBody(body);
  if (parsed.error) { res.status(400).json({ error: parsed.error }); return; }
  const cur = (await rows(
    ctx.pool, 'SELECT * FROM oshal_marketing_channel_authorizations WHERE user_sub = $1 AND channel = $2', [sub, channel],
  ))[0] ?? { enabled: false, standing_authorization: false, daily_cap: 0 };
  const nextEnabled = parsed.enabled ?? (cur.enabled === true);
  const nextStanding = parsed.standing ?? (cur.standing_authorization === true);
  const nextCap = parsed.dailyCap ?? Number(cur.daily_cap ?? 0);
  if (parsed.standing === true) {
    if (!hasExplicitWriteConfirmation(body)) {
      res.status(428).json(confirmationRequiredPayload('marketing-channels', `${channel}.standing-authorization`));
      return;
    }
    if (nextCap < 1) {
      res.status(400).json({ error: 'daily_cap_required', hint: 'Standing authorization requires dailyCap >= 1.' });
      return;
    }
  }
  const row = (await rows(
    ctx.pool,
    `INSERT INTO oshal_marketing_channel_authorizations (user_sub, channel, enabled, standing_authorization, daily_cap, updated_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (user_sub, channel) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       standing_authorization = EXCLUDED.standing_authorization,
       daily_cap = EXCLUDED.daily_cap,
       updated_at = now()
     RETURNING *`,
    [sub, channel, nextEnabled, nextStanding, nextCap],
  ))[0];
  res.json({ channel: row });
}

/** Insert one content item as a reviewable draft. */
async function insertContent(
  pool: QueryablePool, sub: string,
  c: { campaignId: string | null; channel: string; title: string; body: string },
): Promise<any> {
  return (await rows(
    pool,
    `INSERT INTO oshal_marketing_content (user_sub, campaign_id, channel, title, body, status)
     VALUES ($1,$2,$3,$4,$5,'draft') RETURNING *`,
    [sub, c.campaignId, c.channel, c.title, c.body],
  ))[0];
}

/** Run a bot handler and translate a missing hosted brain into the honest 503. */
async function respondWithBot(res: Response, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (isNoHostedBrain(err)) {
      res.status(503).json({ error: 'no_hosted_brain', hint: 'Add an AI provider under Settings → AI Providers, then retry.' });
      return;
    }
    throw err;
  }
}

/** POST /drafts — campaign-director writes one channel draft; stored for human review. */
async function createDraft(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const channel = String(b.channel || '');
  if (!(CHANNELS as readonly string[]).includes(channel)) { res.status(400).json({ error: 'unknown_channel' }); return; }
  const brief = typeof b.brief === 'string' ? b.brief.trim().slice(0, 2000) : '';
  if (!brief) { res.status(400).json({ error: 'brief_required' }); return; }
  const campaign = await loadCampaign(ctx.pool, sub, String(b.campaignId || ''));
  if (!campaign) { res.status(404).json({ error: 'campaign_not_found' }); return; }
  await respondWithBot(res, async () => {
    const text = await runMarketingBot(ctx, CAMPAIGN_DIRECTOR_ID, 'draft', String(campaign.slug), sub, draftPrompt(campaign, channel, brief));
    const item = await insertContent(ctx.pool, sub, {
      campaignId: String(campaign.campaign_id), channel, title: brief.slice(0, 120), body: text,
    });
    res.status(201).json({ item });
  });
}

/** POST /research — market-analyst refines the campaign ICP (raw text preserved on parse failure). */
async function runResearch(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
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

/** POST /launch-checklist — launch-coordinator emits a checklist item (channel 'launch', human-posted). */
async function runLaunchChecklist(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
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

/** GET /content — the caller's content items (board fodder), optional campaign filter. */
async function listContent(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
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

/** POST /content/:id/publish — the full consent→cap→confirm→rail→ledger chain. */
async function publishContent(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
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
    await recordRun(ctx.pool, sub, channel, 'publish', 'error', { ...detailBase, error: rail.error ?? 'unknown' });
    res.status(rail.status).json({ error: rail.error, ...(rail.hint ? { hint: rail.hint } : {}) });
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

/** GET /scorecard?weeks=8 — the caller's stored weekly scorecards, newest first. */
async function getScorecard(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const weeksRaw = Number(req.query.weeks ?? 8);
  const weeks = Number.isInteger(weeksRaw) && weeksRaw >= 1 && weeksRaw <= 52 ? weeksRaw : 8;
  const weekRows = await safeRows(
    ctx.pool,
    'SELECT * FROM oshal_marketing_scorecard_weeks WHERE user_sub = $1 ORDER BY week_start DESC LIMIT ' + weeks,
    [sub],
  );
  res.json({ weeks: weekRows });
}

/** POST /scorecard/rebuild — recompute + upsert the CURRENT week from the caller's own events. */
async function rebuildScorecard(ctx: AppContext, sub: string, _req: Request, res: Response): Promise<void> {
  const weekStart = weekStartOf(new Date().toISOString());
  const events = await safeRows(
    ctx.pool,
    `SELECT ts, source, campaign_slug, medium, event, value, meta FROM oshal_marketing_events
     WHERE user_sub = $1 AND ts >= $2::date AND ts < $2::date + INTERVAL '7 days' ORDER BY ts ASC`,
    [sub, weekStart],
  );
  const normalized = events.map((e) => ({
    ...e,
    ts: e.ts instanceof Date ? e.ts.toISOString() : String(e.ts),
    value: Number(e.value),
  }));
  const rollup = scorecardRollup(normalized, weekStart);
  const week = (await rows(
    ctx.pool,
    `INSERT INTO oshal_marketing_scorecard_weeks (user_sub, week_start, data, sources, computed_at)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,now())
     ON CONFLICT (user_sub, week_start) DO UPDATE SET data = EXCLUDED.data, sources = EXCLUDED.sources, computed_at = now()
     RETURNING *`,
    [sub, weekStart, JSON.stringify(rollup.data ?? {}), JSON.stringify(rollup.sources ?? {})],
  ))[0];
  res.json({ week });
}

/** POST /experiments — register a proposed experiment (ICE 1-10 each). */
async function createExperiment(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const hypothesis = typeof b.hypothesis === 'string' ? b.hypothesis.trim().slice(0, 1000) : '';
  const variable = typeof b.variable === 'string' ? b.variable.trim().slice(0, 200) : '';
  if (!hypothesis || !variable) { res.status(400).json({ error: 'hypothesis_and_variable_required' }); return; }
  const ice = ['iceImpact', 'iceConfidence', 'iceEase'].map((k, i) => Number(b[k] ?? b[['ice_impact', 'ice_confidence', 'ice_ease'][i]]));
  if (ice.some((n) => !Number.isInteger(n) || n < 1 || n > 10)) {
    res.status(400).json({ error: 'ice_scores_must_be_integers_1_10' });
    return;
  }
  const campaignId = typeof b.campaignId === 'string' && UUID_RE.test(b.campaignId) ? b.campaignId : null;
  const row = (await rows(
    ctx.pool,
    `INSERT INTO oshal_marketing_experiments (user_sub, campaign_id, hypothesis, variable, ice_impact, ice_confidence, ice_ease)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [sub, campaignId, hypothesis, variable, ice[0], ice[1], ice[2]],
  ))[0];
  res.status(201).json({ experiment: row });
}

/** PATCH /experiments/:id — status transition (legal graph enforced) + verdict/window edits. */
async function patchExperiment(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const id = String(req.params.id || '');
  if (!UUID_RE.test(id)) { res.status(404).json({ error: 'experiment_not_found' }); return; }
  const existing = (await rows(
    ctx.pool, 'SELECT * FROM oshal_marketing_experiments WHERE experiment_id = $1 AND user_sub = $2', [id, sub],
  ))[0];
  if (!existing) { res.status(404).json({ error: 'experiment_not_found' }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const next = String(b.status || '');
  if (!(next in EXPERIMENT_TRANSITIONS)) { res.status(400).json({ error: 'invalid_status' }); return; }
  if (!(EXPERIMENT_TRANSITIONS[String(existing.status)] ?? []).includes(next)) {
    res.status(409).json({ error: 'illegal_transition', from: existing.status, to: next });
    return;
  }
  const verdict = typeof b.verdict === 'string' ? b.verdict.trim().slice(0, 2000) : null;
  const windowStart = typeof b.windowStart === 'string' && DATE_RE.test(b.windowStart) ? b.windowStart : null;
  const windowEnd = typeof b.windowEnd === 'string' && DATE_RE.test(b.windowEnd) ? b.windowEnd : null;
  const row = (await rows(
    ctx.pool,
    `UPDATE oshal_marketing_experiments SET
       status = $1,
       verdict = COALESCE($2, verdict),
       window_start = COALESCE($3::date, window_start),
       window_end = COALESCE($4::date, window_end),
       updated_at = now()
     WHERE experiment_id = $5 AND user_sub = $6 RETURNING *`,
    [next, verdict, windowStart, windowEnd, id, sub],
  ))[0];
  res.json({ experiment: row });
}

/** Apply an approved proposal to its campaign (whitelisted fields only). */
async function applyBudgetProposal(
  pool: QueryablePool, sub: string, row: any,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!row.campaign_id) return { ok: false, status: 422, error: 'proposal_has_no_campaign' };
  if (row.field === 'budget_monthly_usd') {
    const value = Number(row.new_value);
    if (!Number.isFinite(value) || value < 0) return { ok: false, status: 422, error: 'invalid_value' };
    const r = await pool.query(
      'UPDATE oshal_marketing_campaigns SET budget_monthly_usd = $1, updated_at = now() WHERE campaign_id = $2 AND user_sub = $3',
      [value, row.campaign_id, sub],
    );
    if (!r.rowCount) return { ok: false, status: 409, error: 'campaign_not_found' };
    return { ok: true };
  }
  if (row.field === 'channels') {
    let channels: unknown;
    try {
      channels = JSON.parse(String(row.new_value));
    } catch (err) {
      logger.error({ err, entryId: row.entry_id }, 'budget proposal channels value is not JSON');
      channels = null;
    }
    if (!Array.isArray(channels)) return { ok: false, status: 422, error: 'invalid_value' };
    const r = await pool.query(
      'UPDATE oshal_marketing_campaigns SET channels = $1::jsonb, updated_at = now() WHERE campaign_id = $2 AND user_sub = $3',
      [JSON.stringify(channels), row.campaign_id, sub],
    );
    if (!r.rowCount) return { ok: false, status: 409, error: 'campaign_not_found' };
    return { ok: true };
  }
  return { ok: false, status: 422, error: 'unsupported_field' };
}

/** POST /budget/proposals/:id/decide — approve (428-gated, then applied) or reject. */
async function decideBudgetProposal(ctx: AppContext, sub: string, req: Request, res: Response): Promise<void> {
  const id = String(req.params.id || '');
  if (!UUID_RE.test(id)) { res.status(404).json({ error: 'proposal_not_found' }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const decision = String(b.decision || '');
  if (decision !== 'approve' && decision !== 'reject') { res.status(400).json({ error: 'decision_must_be_approve_or_reject' }); return; }
  const row = (await rows(
    ctx.pool, 'SELECT * FROM oshal_marketing_budget_ledger WHERE entry_id = $1 AND user_sub = $2', [id, sub],
  ))[0];
  if (!row) { res.status(404).json({ error: 'proposal_not_found' }); return; }
  if (row.status !== 'proposed') { res.status(409).json({ error: 'already_decided', status: row.status }); return; }
  if (decision === 'reject') {
    const rejected = (await rows(
      ctx.pool,
      `UPDATE oshal_marketing_budget_ledger SET status = 'rejected', decided_by = $1, decided_at = now()
       WHERE entry_id = $2 AND user_sub = $3 AND status = 'proposed' RETURNING *`,
      [sub, id, sub],
    ))[0];
    res.json({ proposal: rejected ?? row });
    return;
  }
  if (!hasExplicitWriteConfirmation(b)) {
    res.status(428).json(confirmationRequiredPayload('marketing-budget', 'budget.apply'));
    return;
  }
  const approved = (await rows(
    ctx.pool,
    `UPDATE oshal_marketing_budget_ledger SET status = 'approved', decided_by = $1, decided_at = now()
     WHERE entry_id = $2 AND user_sub = $3 AND status = 'proposed' RETURNING *`,
    [sub, id, sub],
  ))[0];
  if (!approved) { res.status(409).json({ error: 'already_decided' }); return; }
  const applied = await applyBudgetProposal(ctx.pool, sub, approved);
  if (!applied.ok) {
    res.status(applied.status).json({ error: applied.error, proposal: approved });
    return;
  }
  const final = (await rows(
    ctx.pool,
    `UPDATE oshal_marketing_budget_ledger SET status = 'applied' WHERE entry_id = $1 AND user_sub = $2 RETURNING *`,
    [id, sub],
  ))[0];
  res.json({ proposal: final ?? approved });
}

/** GET /utm — deterministic UTM-tagged link from the pure model builder. */
async function getUtm(_ctx: AppContext, _sub: string, req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, unknown>;
  const url = String(q.url || '');
  const source = String(q.source || '');
  const medium = String(q.medium || '');
  const campaign = String(q.campaign || '');
  const content = String(q.content || '');
  if (!url || !source || !medium || !campaign) {
    res.status(400).json({ error: 'url_source_medium_campaign_required' });
    return;
  }
  try {
    const utmUrl = buildUtmUrl({ url, source, medium, campaign, content: content || undefined });
    if (typeof utmUrl !== 'string' || !utmUrl) { res.status(400).json({ error: 'invalid_url' }); return; }
    res.json({ utmUrl });
  } catch (err) {
    logger.error({ err }, 'UTM build rejected input');
    res.status(400).json({ error: 'invalid_url' });
  }
}

// ---------------------------------------------------------------------------
// Schema + factory
// ---------------------------------------------------------------------------

/**
 * @description Ensure the 001-marketing-core tables + owner FORCE-RLS at the lazy-DDL chokepoint
 * (mirrored by migrations/001-marketing-core.sql; the ops module mirrors 002).
 * @param pool - Postgres pool.
 * @returns Resolves when the schema is ensured.
 */
async function ensureSchema(pool: AppContext['pool']): Promise<void> {
  await runRuntimeSchemaBootstrap({
    pool,
    moduleName: 'marketing-engine',
    statements: [
      ...CORE_TABLE_DDL,
      ...CORE_RLS_TABLES.flatMap((table) => buildOwnerRlsPolicyStatements(table, 'user_sub')),
    ],
    requirements: [
      { table: 'oshal_marketing_campaigns', columns: ['campaign_id', 'user_sub', 'slug', 'budget_monthly_usd'] },
      { table: 'oshal_marketing_channel_authorizations', columns: ['user_sub', 'channel', 'enabled', 'standing_authorization', 'daily_cap'] },
      { table: 'oshal_marketing_content', columns: ['item_id', 'user_sub', 'channel', 'status'] },
    ],
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
    res.json({ proposals });
  }));
  router.post('/budget/proposals/:id/decide', authed(ctx, decideBudgetProposal));

  return router;
}
