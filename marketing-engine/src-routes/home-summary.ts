/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Owner-scoped Home summary route (ADR-145): saved-content counts, publish counts from the run ledger, and recent content items with prepare-* integration actions. GET only, bounded queries, no side effects.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Readable, documented, and unit-tested: the shaping is split into exported pure helpers (functions under 50 lines), the footnote now fits the core 120-character item text cap whole (its explanation rides in detail, cap 400) instead of being clipped mid-sentence, tile values are bounded to the 16-character cap, and `as any` is replaced by a typed pg query config. Behaviour is otherwise unchanged. The module stays DELIBERATELY import-free at runtime (express only — the pg and AppContext imports are type-only): the store Home harness (scripts/creative-home.test.cjs) loads every summary with an express-only require, so a Home summary can never reach a logger, connector, or other capability. Do not add runtime imports here.
 *
 * @module home-summary
 */

import { Router, type Request, type Response } from 'express';
import type { QueryConfig } from 'pg';
import type { AppContext } from '@/app/composition/app-context';

/** Core Home caps (framework app-home-plan.ts). Anything longer is clipped by core, so never emit it. */
export const HOME_SUMMARY_LIMITS = {
  tiles: 4,
  items: 5,
  labelChars: 24,
  valueChars: 16,
  textChars: 120,
  detailChars: 400,
  notesChars: 2000,
  bodyChars: 1500,
} as const;

/** Package identity every item's `fix` link points back to. */
const FIX = 'marketing-engine';

/** Per-query ceiling so one slow table can never hold the Home view open. */
const QUERY_TIMEOUT_MS = 1800;

/** Integration offers a saved content item can hand to (each is declared in integrations.offers). */
export const CONTENT_ITEM_ACTIONS = ['prepare-document', 'prepare-post', 'prepare-social', 'prepare-video'] as const;

/**
 * The three owner-scoped, read-only queries, in result order. $1 = caller sub, $2 = request time
 * (rows newer than the request are excluded so the counts and the item list agree).
 */
export const HOME_SUMMARY_QUERIES: readonly string[] = [
  "SELECT count(*) FILTER (WHERE c.status='draft')::text AS drafts, count(*) FILTER (WHERE c.status='approved')::text AS approved FROM oshal_marketing_content c WHERE c.user_sub = $1 AND c.created_at <= $2 AND c.updated_at <= $2 AND (c.campaign_id IS NULL OR EXISTS (SELECT 1 FROM oshal_marketing_campaigns p WHERE p.campaign_id=c.campaign_id AND p.user_sub = $1))",
  "SELECT count(*) FILTER (WHERE outcome='published' AND ts > $2::timestamptz - interval '24 hours')::text AS day, count(*) FILTER (WHERE outcome='published')::text AS five FROM oshal_marketing_run_ledger WHERE user_sub = $1 AND ts <= $2 AND ts > $2::timestamptz - interval '120 hours'",
  "SELECT c.title, c.body, c.channel, c.status, c.updated_at FROM oshal_marketing_content c WHERE c.user_sub = $1 AND c.created_at <= $2 AND c.updated_at <= $2 AND (c.campaign_id IS NULL OR EXISTS (SELECT 1 FROM oshal_marketing_campaigns p WHERE p.campaign_id=c.campaign_id AND p.user_sub = $1)) ORDER BY (c.status IN ('draft','approved')) DESC, c.updated_at DESC, c.item_id LIMIT 3",
];

/** One query outcome: its rows when it succeeded, null when it failed. */
export type QueryRows = Array<Record<string, unknown>> | null;

/** @description One Home count tile. */
export interface HomeSummaryMetric {
  id: string;
  label: string;
  value: string;
}

/** @description One Home list line, optionally carrying prepare-* integration actions. */
export interface HomeSummaryItem {
  text: string;
  detail?: string;
  tone: 'neutral' | 'warn';
  fix: string;
  actions?: Array<{ integration: string; context: { title: string; notes: string } }>;
}

/** @description The HTTP status and JSON body the Home summary route answers with. */
export interface HomeSummaryResult {
  status: 200 | 503;
  body: { metrics: HomeSummaryMetric[]; tiles: HomeSummaryMetric[]; items: HomeSummaryItem[]; asOf: string; partial: boolean };
}

/** Tile definitions: [query index, column, id, label]. */
const METRICS: ReadonlyArray<readonly [number, string, string, string]> = [
  [0, 'drafts', 'content-drafts', 'Drafts to review'],
  [0, 'approved', 'content-approved', 'Approved content'],
  [1, 'day', 'published-24h', 'Published / 24h'],
  [1, 'five', 'published-5d', 'Published / 5 days'],
];

/** The standing footnote: a line that fits the text cap, with the full explanation in detail. */
const FOOTNOTE: HomeSummaryItem = {
  text: 'Counts come from saved content and recorded publish outcomes.',
  detail: 'Review counts reflect current saved content states. Publish counts come only from recorded '
    + 'published outcomes, not drafts or skipped attempts. Connected actions prepare editable drafts; '
    + 'destination consent and publishing controls still apply.',
  tone: 'neutral',
  fix: FIX,
};

/**
 * @description Collapse whitespace and bound a value to a character cap.
 * @param value - Any row value (null/undefined become '')
 * @param cap - Maximum characters kept
 * @returns The trimmed, single-spaced, bounded string
 */
export function clip(value: unknown, cap: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
}

/**
 * @description Render a row timestamp as ISO-8601, or an honest placeholder when it is unparseable.
 * @param value - A Date, ISO string, or anything else
 * @returns ISO timestamp or 'date unavailable'
 */
export function isoDate(value: unknown): string {
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : 'date unavailable';
}

/** Build the four count tiles; a failed query reads 'Unavailable', never a guessed zero. */
function metricTiles(results: QueryRows[]): HomeSummaryMetric[] {
  return METRICS.map(([index, column, id, label]) => {
    const rows = results[index];
    const value = rows === null ? 'Unavailable' : String(rows[0]?.[column] ?? '0');
    return { id, label, value: clip(value, HOME_SUMMARY_LIMITS.valueChars) };
  });
}

/** Shape one saved content row into a list line whose actions hand the draft to other apps. */
function contentItem(row: Record<string, unknown>): HomeSummaryItem {
  const text = clip(row.title || 'Untitled content', HOME_SUMMARY_LIMITS.textChars);
  const detail = `${clip(row.channel, 60)} · ${clip(row.status, 40)} · saved ${isoDate(row.updated_at)}`;
  const notes = clip(`${detail}\n${clip(row.body, HOME_SUMMARY_LIMITS.bodyChars)}`, HOME_SUMMARY_LIMITS.notesChars);
  return {
    text,
    detail: clip(detail, HOME_SUMMARY_LIMITS.detailChars),
    tone: 'neutral',
    fix: FIX,
    actions: CONTENT_ITEM_ACTIONS.map((integration) => ({ integration, context: { title: text, notes } })),
  };
}

/**
 * @description Shape the three query outcomes into the bounded ADR-145 Home summary. A failed
 * query degrades its tiles to 'Unavailable' and adds one warning line; when every query failed the
 * status is 503 so Home shows the app as unavailable rather than as empty.
 * @param results - Rows per HOME_SUMMARY_QUERIES entry, null where that query failed
 * @param now - The request time the queries were bounded by
 * @returns The status and JSON body for the route
 */
export function buildMarketingHomeSummary(results: QueryRows[], now: Date): HomeSummaryResult {
  const metrics = metricTiles(results);
  const items = (results[2] ?? []).slice(0, 3).map(contentItem);
  const failed = HOME_SUMMARY_QUERIES.filter((_query, index) => results[index] === null).length;
  if (failed > 0) items.push({ text: 'Some saved sources cannot be checked.', tone: 'warn', fix: FIX });
  else if (items.length === 0) items.push({ text: 'No saved work yet. Open the app to begin.', tone: 'neutral', fix: FIX });
  items.push(FOOTNOTE);
  return {
    status: failed === HOME_SUMMARY_QUERIES.length ? 503 : 200,
    body: { metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 },
  };
}

/** The caller's subject, only when the session reports itself authenticated (the store Home gate). */
function authenticatedSub(req: Request): string | null {
  const oidc = (req as { oidc?: { user?: { sub?: string; oid?: string }; isAuthenticated?: () => boolean } }).oidc;
  const sub = oidc?.user?.sub || oidc?.user?.oid;
  return sub && oidc?.isAuthenticated?.() === true ? String(sub) : null;
}

/** Run the three bounded queries for one owner; a failed query reads as null, never as zero. */
async function loadSummaryRows(ctx: AppContext, sub: string, now: Date): Promise<QueryRows[]> {
  const settled = await Promise.allSettled(HOME_SUMMARY_QUERIES.map((text) => {
    const config: QueryConfig & { query_timeout: number } = { text, values: [sub, now], query_timeout: QUERY_TIMEOUT_MS };
    return ctx.pool.query(config);
  }));
  return settled.map((outcome) => (outcome.status === 'fulfilled' ? outcome.value.rows as Array<Record<string, unknown>> : null));
}

/**
 * @description Mount the Home summary for the signed-in owner. Answers 401 unless the session is
 * authenticated; every query is filtered to that subject (FORCE RLS backs it), so one owner can
 * never read another's counts or drafts. Never writes.
 * @param ctx - Framework context (the controller pool)
 * @returns Router exposing GET /
 */
export function createHomeSummaryRoutes(ctx: AppContext): Router {
  const router = Router();
  router.get('/', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const sub = authenticatedSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const now = new Date();
    const summary = buildMarketingHomeSummary(await loadSummaryRows(ctx, sub, now), now);
    res.status(summary.status).json(summary.body);
  });
  return router;
}
