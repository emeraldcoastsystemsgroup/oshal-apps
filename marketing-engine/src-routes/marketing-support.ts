/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Shared marketing-engine route support, moved verbatim out of marketing-routes.ts when that module crossed the 800-line decomposition threshold: the pool type, the shared child logger (still named marketing-routes so no log line changes), the manifest inline-bot ids, the channel/status/regex/transition/constraint constants, the lazy-DDL mirror of migrations/001-marketing-core.sql with ensureSchema, the RailResult shape, and the auth/query/prompt-bounding/spec-loading/campaign-loading helpers every marketing route module uses. Logic, SQL, gate order, status codes, log lines and messages are unchanged.
 *
 * @module marketing-support
 */

import type { Request, Response, RequestHandler } from 'express';
import * as path from 'path';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { runRuntimeSchemaBootstrap, buildOwnerRlsPolicyStatements } from '@/shared/services/database';
import { loadConnectorSpec, type ConnectorSpec } from '@/app/connectors/runtime';

/** @description Load-time-only fallback for frameworks predating ctx.appPackageDir. */
export const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

/** @description The framework pool surface, derived from AppContext so this never drifts from core. */
export type QueryablePool = AppContext['pool'];

/** @description The shared child logger for every marketing route module; the module name stays marketing-routes so no log line changes. */
export const logger = createChildLogger({ module: 'marketing-routes' });

/** @description Inline concierge bots declared by this package's manifest (oshal-app.yaml bots[]). */
export const CAMPAIGN_DIRECTOR_ID = 'cadf0000-0000-4000-8000-000000000001';

/** @description The market-analyst inline concierge declared by this package's manifest (oshal-app.yaml bots[]). */
export const MARKET_ANALYST_ID = 'cadf0000-0000-4000-8000-000000000002';

/** @description The launch-coordinator inline concierge declared by this package's manifest (oshal-app.yaml bots[]). */
export const LAUNCH_COORDINATOR_ID = 'cadf0000-0000-4000-8000-000000000004';

/** @description The only channels this app can publish to; 'launch' items are human-posted, never publishable. */
export const CHANNELS = ['linkedin', 'mastodon', 'bluesky', 'email'] as const;

/** @description The campaign lifecycle statuses a PATCH may set. */
export const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;

/** @description Canonical UUID shape for path and query identifiers. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @description Conservative email shape for an explicit publish recipient. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @description ISO calendar-date shape for experiment windows. */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** @description Legal experiment status transitions (proposed→running→extended|killed|scaled; extended→killed|scaled). */
export const EXPERIMENT_TRANSITIONS: Record<string, string[]> = {
  proposed: ['running'],
  running: ['extended', 'killed', 'scaled'],
  extended: ['killed', 'scaled'],
  killed: [],
  scaled: [],
};

/** @description Per-channel drafting constraints woven into the bot prompt. */
export const CHANNEL_CONSTRAINTS: Record<string, string> = {
  linkedin: 'LinkedIn member post: professional tone, 700-1200 characters, at most 3 hashtags.',
  mastodon: 'Mastodon status: at most 500 characters, conversational, at most 2 hashtags.',
  bluesky: 'Bluesky post: at most 300 characters, plain text, no hashtag spam.',
  email: 'Email: first line is the subject, then a blank line, then a short plain-text body under 200 words.',
};

/** @description The honesty rules appended to every bot prompt. */
export const HONESTY_RULES = 'Rules: use ONLY the data provided above — never invent metrics, quotes, customer names, or reviews. '
  + 'No competitive absolutes ("only", "no one else", "unique"). The product name is lowercase "oshal".';

/** @description JSONB campaign columns (patched values are stringified + cast). */
export const JSONB_COLS = new Set(['icp', 'message_map', 'channels']);

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

/** @description Unified publish-rail result (honest degradation: 409 not_connected, 503 unavailable). */
export interface RailResult {
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

/**
 * @description Serve a static HTML surface from the package tools directory.
 * @param dir - Absolute directory the surface file is read from.
 * @param file - File name to send.
 * @returns An Express handler that sends the file, answering 404 when the send fails.
 */
export function servePage(dir: string, file: string): RequestHandler {
  return (_req, res) => {
    res.sendFile(path.join(dir, file), (err) => {
      if (err) { logger.error({ err, file }, 'Failed to serve marketing surface'); res.status(404).send('Page not found'); }
    });
  };
}

/**
 * @description Wrap a handler with the auth gate + logged entry/exit/duration + the error boundary.
 * Every endpoint answers 401 not_authenticated without a session sub; every throw is logged.
 * @param ctx - Framework app context handed to the wrapped handler.
 * @param fn - The route handler to run once a session sub is present.
 * @returns An Express handler enforcing the gate.
 */
export function authed(
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

/**
 * @description Run a query and return its rows.
 * @param pool - Postgres pool.
 * @param sql - SQL text.
 * @param params - Bound query parameters.
 * @returns The result rows.
 */
export async function rows(pool: QueryablePool, sql: string, params: unknown[]): Promise<any[]> {
  return (await pool.query(sql, params)).rows;
}

/**
 * @description Rows for tables owned by the ops module (002): a missing table degrades to [] (logged).
 * @param pool - Postgres pool.
 * @param sql - SQL text.
 * @param params - Bound query parameters.
 * @returns The result rows, or an empty array when the query fails.
 */
export async function safeRows(pool: QueryablePool, sql: string, params: unknown[]): Promise<any[]> {
  try {
    return await rows(pool, sql, params);
  } catch (err) {
    logger.error({ err }, 'marketing metrics-tier query failed (degrading to empty)');
    return [];
  }
}

/**
 * @description Bounded JSON rendering for prompts (never throws; slices to max chars).
 * @param value - Value to render.
 * @param max - Maximum number of characters to keep.
 * @returns The bounded JSON string, or '{}' when serialization fails.
 */
export function boundJson(value: unknown, max: number): string {
  try { return JSON.stringify(value ?? {}).slice(0, max); } catch (err) {
    logger.error({ err }, 'boundJson serialization failed');
    return '{}';
  }
}

/**
 * @description URL-safe slug from a campaign name.
 * @param name - Campaign name.
 * @returns The slug, at most 64 characters.
 */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

/**
 * @description Serialized-size guard for jsonb writes (truncating JSON would corrupt it — reject instead).
 * @param value - Value to measure.
 * @param maxChars - Maximum serialized length allowed.
 * @returns True when the serialized value exceeds the limit.
 */
export function tooLarge(value: unknown, maxChars: number): boolean {
  return JSON.stringify(value ?? {}).length > maxChars;
}

/**
 * @description Load a connector spec from the deployed spec dir; null (logged) when missing/invalid.
 * @param provider - Connector id whose <provider>.yaml is loaded.
 * @returns The loaded connector spec, or null.
 */
export function loadSpecSafe(provider: string): ConnectorSpec | null {
  try {
    const dir = process.env.OSHAL_CONNECTOR_SPEC_DIR || '/app/swarm-apps/connectors';
    return loadConnectorSpec(path.join(dir, `${provider}.yaml`));
  } catch (err) {
    logger.error({ err, provider }, 'connector spec load failed');
    return null;
  }
}

/**
 * @description Does a loaded spec declare the named write action?
 * @param spec - The loaded connector spec, or null.
 * @param actionName - Action name to look for.
 * @returns True when the spec declares that action.
 */
export function specHasAction(spec: ConnectorSpec | null, actionName: string): boolean {
  const actions = (spec as { actions?: Array<{ name?: string }> } | null)?.actions;
  return Array.isArray(actions) && actions.some((a) => a?.name === actionName);
}

/**
 * @description Load the caller's own campaign row (invalid/foreign id → null).
 * @param pool - Postgres pool.
 * @param sub - The caller's OIDC subject.
 * @param campaignId - Campaign id from the request.
 * @returns The campaign row, or null.
 */
export async function loadCampaign(pool: QueryablePool, sub: string, campaignId: string): Promise<any | null> {
  if (!UUID_RE.test(campaignId)) return null;
  const r = await rows(pool, 'SELECT * FROM oshal_marketing_campaigns WHERE campaign_id = $1 AND user_sub = $2', [campaignId, sub]);
  return r[0] ?? null;
}

/**
 * @description All four channel rows with default-OFF placeholders where no row exists.
 * @param sub - The caller's OIDC subject.
 * @param channelRows - The stored channel authorization rows.
 * @returns One row per channel, with defaults filled in.
 */
export function withChannelDefaults(sub: string, channelRows: any[]): any[] {
  return CHANNELS.map((channel) => channelRows.find((r) => r.channel === channel) ?? {
    user_sub: sub, channel, enabled: false, standing_authorization: false,
    daily_cap: 0, paused_reason: null, updated_at: null,
  });
}

// ---------------------------------------------------------------------------
// Run ledger (002 table, ensured by the ops module; written by every publish path)
// ---------------------------------------------------------------------------

/**
 * @description ALWAYS-write outcome ledger row (published|skipped_consent|skipped_cap|skipped_confirm|error).
 * @param pool - Postgres pool.
 * @param sub - The caller's OIDC subject.
 * @param channel - Channel the run targeted.
 * @param action - Action name recorded on the row.
 * @param outcome - Outcome recorded on the row.
 * @param detail - JSON detail stored with the row.
 * @returns Resolves once the write has been attempted; a failure is logged, never thrown.
 */
export async function recordRun(
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

/**
 * @description Today's non-skip run count for (caller, channel) — the daily-cap denominator (series-pump semantics).
 * @param pool - Postgres pool.
 * @param sub - The caller's OIDC subject.
 * @param channel - Channel to count.
 * @returns The number of non-skipped runs recorded today.
 */
export async function countLedgerToday(pool: QueryablePool, sub: string, channel: string): Promise<number> {
  const r = await rows(
    pool,
    `SELECT COUNT(*)::int AS n FROM oshal_marketing_run_ledger
     WHERE user_sub = $1 AND channel = $2 AND outcome NOT LIKE 'skipped%' AND ts >= date_trunc('day', now())`,
    [sub, channel],
  );
  return Number(r[0]?.n ?? 0);
}

/**
 * @description Ensure the 001-marketing-core tables + owner FORCE-RLS at the lazy-DDL chokepoint
 * (mirrored by migrations/001-marketing-core.sql; the ops module mirrors 002).
 * @param pool - Postgres pool.
 * @returns Resolves when the schema is ensured.
 */
export async function ensureSchema(pool: AppContext['pool']): Promise<void> {
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
