/**
 * Kid Lens Routes — the YouTube-Takeout "what is my kid into" app (ADR-036/037/038).
 *
 * PACKAGED (ADR-085 Wave 1 carve #2): this file is the package's src-routes source of
 * truth, compiled to routes/youtube-kids-routes.js by `oshal-app build`. The loader
 * mounts it at /api/youtube-kids (requiresAuth) and hands the factory the AppContext,
 * including `appPackageDir` — the surface HTML is served from this package's tools/.
 *
 * Split, same as the email/social/content swarms:
 *  - **Ingest + aggregate** (cheap, deterministic) runs here in the controller: the user
 *    uploads their Google Takeout `watch-history.json`, we parse it into a compact
 *    aggregate (youtube-takeout.ts) and store it in a `user_sub`-keyed table; the raw
 *    export is kept AES-256-GCM-encrypted at rest.
 *  - **Reasoning** (the parent brief: interests, decoded channels, gift ideas, talking
 *    points) ALWAYS runs on the accountable Kid Lens bot via BotNodeClient.execute, so
 *    per-call cost lands in chat_tasks under the bot's own agent_id (ADR-036). The bot is
 *    reason-only (no connector/CLI), so it runs inline on the api container — same path as
 *    deck-builder / social-writer.
 *
 * v1 scope: Takeout upload only. The live youtube.readonly API (subscriptions/likes) is a
 * later add-on — that scope is "sensitive" and needs Google app verification first.
 *
 * Every route is requiresAuth-gated at mount (auth is opt-in per route, CLAUDE.md).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-17 23:05:27 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — POST /upload-takeout (parse+aggregate+store, raw export encrypted), GET /status, GET /brief (bot reasons over the aggregate, cached, ?refresh=1 to regenerate), GET / + /upload surfaces. Reason-only bot runs inline on the api container.
 * 2026-07-05 19:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | Tier-1 RLS at the lazy-DDL chokepoint (A1.2 follow-up): ensureYoutubeKidsSchema now appends buildOwnerRlsPolicyStatements for oshal_youtube_activity so a fresh database is never left policy-less between table creation and a migration-060 re-run.
 * 2026-07-17 18:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | ADR-085 carve-out: moved into the youtube-kids store package. Factory is the standard (ctx) shape — the surface HTML now serves from the package's own tools/ dir (ctx.appPackageDir, portrait-studio pattern) instead of a passed-in apiDir; executeBotOrInline import rewritten to the @/app/routes alias (core helper, resolved by the loader at runtime). Logic unchanged.
 *
 * @module youtube-kids-routes
 */

import { Router, raw, type Request, type Response, type RequestHandler } from 'express';
import * as path from 'path';
import * as crypto from 'crypto';
import { createChildLogger } from '@/shared/logger';
import { buildOwnerRlsPolicyStatements, runRuntimeSchemaBootstrap } from '@/shared/services/database';
import type { AppContext } from '@/app/composition/app-context';
import { BotNodeClient, createRegistryEndpointResolver } from '@/features/agent-management';
import { executeBotOrInline } from '@/app/routes/inline-bot-execution';
import { parseTakeoutWatchHistory, type WatchAggregate } from './youtube-takeout';

const logger = createChildLogger({ module: 'youtube-kids-routes' });

/** Package install dir — set by the loader on the context; env fallback for tool-style callers. */
let packageDir = process.env.OSHAL_APP_PACKAGE_DIR || '';

/** The Kid Lens analyzer bot — reason-only, runs inline on the api container (claude-code). */
const KID_LENS_AGENT_ID = 'a0000000-0000-0000-0000-000000000043';
const botClient = new BotNodeClient(createRegistryEndpointResolver());
/** Watch-history exports get large; cap generously (a few years of viewing is ~tens of MB). */
const MAX_UPLOAD = 64 * 1024 * 1024;

/** Signed-in caller's OIDC sub. */
function callerSub(req: Request): string | null {
  const u = (req as { oidc?: { user?: { sub?: string } } }).oidc?.user;
  return u?.sub ? String(u.sub) : null;
}

/** Serve a static surface file from the package's tools dir. */
function servePage(surfaceDir: string, file: string): RequestHandler {
  return (_req, res) => {
    res.sendFile(path.join(surfaceDir, file), (err) => {
      if (err) { logger.error({ err, file }, 'serve failed'); res.status(404).send('Not found'); }
    });
  };
}

/** AES-256-GCM key = SHA256(SESSION_SECRET) — same scheme the connector tokens use. */
function aesKey(): Buffer {
  return crypto.createHash('sha256').update(process.env.SESSION_SECRET || 'oshal-dev-secret').digest();
}
/** Encrypt a UTF-8 string to the connectors' `iv:tag:enc` base64 envelope. */
function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', aesKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

/** Create the per-user store if absent. Raw export kept encrypted; aggregate is JSONB. */
export async function ensureYoutubeKidsSchema(pool: AppContext['pool']): Promise<void> {
  await runRuntimeSchemaBootstrap({
    pool,
    moduleName: 'youtube kids routes',
    statements: [
      `CREATE TABLE IF NOT EXISTS oshal_youtube_activity (
        user_sub TEXT PRIMARY KEY,
        aggregate JSONB,
        raw_blob TEXT,
        total_watched INT,
        brief TEXT,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        brief_at TIMESTAMPTZ
      )`,

      /* ── owner-scoped RLS (A1.2): applied at the lazy-DDL chokepoint so a
         fresh database enforces isolation the moment this table is created,
         instead of waiting for migration 060 to re-run (it skips absent tables).
         Inert while the runtime connects as a superuser role. ─────────────── */
      ...buildOwnerRlsPolicyStatements('oshal_youtube_activity', 'user_sub'),
    ],
    requirements: [
      {
        table: 'oshal_youtube_activity',
        columns: ['user_sub', 'aggregate', 'raw_blob', 'total_watched', 'brief', 'uploaded_at', 'brief_at'],
      },
    ],
  });
}

/** Outcome of ingesting a watch-history.json — a small summary for the surface. */
export interface WatchIngestResult {
  totalWatched: number;
  distinctChannels: number;
  dateRange: WatchAggregate['dateRange'];
  topChannels: WatchAggregate['topChannels'];
}

/**
 * @description Parses a watch-history.json, stores the aggregate + encrypted raw export for
 * the user, and clears any stale brief so it regenerates. Shared by the direct upload route
 * AND (pre-carve) the Takeout-archive spine, so both entry points behave identically.
 * @param pool - Postgres pool.
 * @param sub - The caller's OIDC sub (owner of the store).
 * @param rawJson - The raw watch-history.json contents.
 * @returns A summary of what was ingested.
 * @throws Error with `code='no_watch_entries'` when the file has no watch rows.
 */
export async function ingestWatchHistory(pool: AppContext['pool'], sub: string, rawJson: string): Promise<WatchIngestResult> {
  const agg = parseTakeoutWatchHistory(rawJson);
  if (agg.totalWatched === 0) {
    const err = new Error('No watch entries found in the upload.') as Error & { code?: string };
    err.code = 'no_watch_entries';
    throw err;
  }
  await ensureYoutubeKidsSchema(pool);
  await pool.query(
    `INSERT INTO oshal_youtube_activity (user_sub, aggregate, raw_blob, total_watched, brief, uploaded_at, brief_at)
       VALUES ($1, $2, $3, $4, NULL, now(), NULL)
     ON CONFLICT (user_sub) DO UPDATE SET
       aggregate = EXCLUDED.aggregate, raw_blob = EXCLUDED.raw_blob,
       total_watched = EXCLUDED.total_watched, brief = NULL, uploaded_at = now(), brief_at = NULL`,
    [sub, JSON.stringify(agg), encrypt(rawJson), agg.totalWatched]);
  logger.info({ sub, totalWatched: agg.totalWatched, channels: agg.distinctChannels }, 'kid-lens watch history ingested');
  return { totalWatched: agg.totalWatched, distinctChannels: agg.distinctChannels, dateRange: agg.dateRange, topChannels: agg.topChannels.slice(0, 8) };
}

/**
 * @description Builds the self-contained analyzer prompt. The full output contract lives
 * here (not in a loaded persona) so behavior is deterministic regardless of inline prompt
 * assembly — the proven deck-builder pattern. The aggregate is embedded as JSON.
 * @param agg - The compact watch-history aggregate.
 * @returns The prompt string handed to the Kid Lens bot.
 */
function buildBriefPrompt(agg: WatchAggregate): string {
  return [
    'You are Kid Lens. A parent has handed you an aggregate of their child\'s YouTube watch',
    'history (top channels with watch counts + sample video titles, a per-month trend, and a',
    'recent-titles sample). Produce a warm, practical, parent-facing brief. Ground EVERY claim',
    'in the data below — never invent channels or interests. Use Markdown with these sections:',
    '',
    '## Top interests',
    'Ranked clusters (e.g. gaming → which games, a specific creator, music → which artists, a',
    'hobby), each one line in plain English a parent will understand.',
    '## What these channels are',
    'For the less-obvious channels: one line each — who they are and why a kid likes them.',
    '## Rising vs fading',
    'From the monthly trend: what is hot right now vs what has cooled off.',
    '## Gift ideas',
    'Concrete, specific gift ideas tied to the actual interests/channels above.',
    '## Talk to your kid',
    'A few ready-to-use conversation openers ("ask him about ...") referencing real channels.',
    '## Worth a glance',
    'Optional, brief, non-judgmental: anything a parent might want to be aware of re: age-fit.',
    '',
    'Be concise — short sentences and tight bullets. No preamble, no sign-off.',
    '',
    'WATCH-HISTORY AGGREGATE (JSON):',
    JSON.stringify(agg),
  ].join('\n');
}

/** Run the Kid Lens bot over the aggregate. direct+agenticMode → cost auto-recorded to chat_tasks. */
async function runAnalyzer(ctx: AppContext, sub: string, agg: WatchAggregate): Promise<string> {
  const result = await executeBotOrInline(ctx, botClient, KID_LENS_AGENT_ID, {
    text: buildBriefPrompt(agg), taskId: `kidlens-${sub}`, workspaceFolderId: `kidlens-${sub}`,
    agentId: KID_LENS_AGENT_ID, agenticMode: true, direct: true, userSub: sub,
  });
  return String(result.response || '').trim();
}

/**
 * @description Builds the Kid Lens router (mounted at /api/youtube-kids behind requiresAuth
 * by the app loader). The surface HTML serves from this package's tools/ dir.
 * @param ctx - App context (Postgres pool for the per-user store + appPackageDir).
 * @returns Express router.
 */
export function createYoutubeKidsRoutes(ctx: AppContext): Router {
  if (ctx.appPackageDir) packageDir = ctx.appPackageDir;
  const surfaceDir = packageDir ? path.join(packageDir, 'tools') : path.resolve(process.cwd(), 'tools');
  const router = Router();

  router.get('/', servePage(surfaceDir, 'youtube-kids-dashboard.html'));
  router.get('/upload', servePage(surfaceDir, 'youtube-kids-dashboard.html'));

  /** GET /status — has the caller uploaded yet, and is a brief cached? Drives the surface. */
  router.get('/status', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      await ensureYoutubeKidsSchema(ctx.pool);
      const row = (await ctx.pool.query(
        `SELECT total_watched, aggregate->'dateRange' AS date_range,
                (brief IS NOT NULL) AS has_brief, uploaded_at, brief_at
           FROM oshal_youtube_activity WHERE user_sub = $1`, [sub])).rows[0];
      if (!row) { res.json({ hasData: false }); return; }
      res.json({
        hasData: true, totalWatched: row.total_watched, dateRange: row.date_range,
        hasBrief: row.has_brief, uploadedAt: row.uploaded_at, briefAt: row.brief_at,
      });
    } catch (err) {
      logger.error({ err }, 'kid-lens status failed');
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /** POST /upload-takeout — raw watch-history.json body → parse, aggregate, store (raw encrypted). */
  router.post('/upload-takeout', raw({ type: '*/*', limit: MAX_UPLOAD }), async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const body = req.body as Buffer;
    if (!body || !body.length) { res.status(400).json({ error: 'empty body' }); return; }
    try {
      const result = await ingestWatchHistory(ctx.pool, sub, body.toString('utf8'));
      res.json({ ok: true, ...result });
    } catch (err) {
      if ((err as { code?: string }).code === 'no_watch_entries') {
        res.status(422).json({ error: 'no_watch_entries', message: 'No watch entries found. Upload the watch-history.json from your YouTube Takeout (choose the JSON format).' });
        return;
      }
      logger.error({ err }, 'kid-lens upload failed');
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /** GET /brief — the parent brief. Cached after first run; ?refresh=1 regenerates. */
  router.get('/brief', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      await ensureYoutubeKidsSchema(ctx.pool);
      const row = (await ctx.pool.query(
        'SELECT aggregate, brief FROM oshal_youtube_activity WHERE user_sub = $1', [sub])).rows[0];
      if (!row || !row.aggregate) { res.status(404).json({ error: 'no_data', message: 'Upload your Takeout watch-history.json first.' }); return; }
      const refresh = String(req.query.refresh || '') === '1';
      if (row.brief && !refresh) { res.json({ brief: row.brief, cached: true }); return; }
      const brief = await runAnalyzer(ctx, sub, row.aggregate as WatchAggregate);
      if (!brief) { res.status(502).json({ error: 'empty_brief', message: 'The analyzer returned nothing — try again.' }); return; }
      await ctx.pool.query('UPDATE oshal_youtube_activity SET brief = $2, brief_at = now() WHERE user_sub = $1', [sub, brief]);
      res.json({ brief, cached: false });
    } catch (err) {
      logger.error({ err }, 'kid-lens brief failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
