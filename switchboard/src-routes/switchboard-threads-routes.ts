/**
 * Switchboard Threads Routes — the unified per-person timeline (mounted under the
 * Switchboard app router at /threads → /api/switchboard/threads, requiresAuth).
 *
 * One thread per counterpart: everything the package has ALREADY ingested from a person —
 * mail plus the inbox-fed social mentions in the shared oshal_inbox_messages store — folded
 * into one chronological conversation view. Read-only first slice (ADR-113): the route reads
 * the store, the pure threads model groups by the package's existing from-address identity
 * (no new inference, no LLM), and the surface renders. Reply/DM actions are later slices.
 *
 *   • GET /        — serve the Threads surface (tools/switchboard-threads.html).
 *   • GET /items   — { threads:[{key,person,address,channels,count,lastTs,items[]}] },
 *                    ?days= lookback (default 30), ?workspace= scope (ADR-113 — the store is
 *                    Gmail-fed, so a desk that excludes the Google account sees no threads),
 *                    ?surface=1 → graceful "connect" payload instead of a 409.
 *
 * Controller/bot split (ADR-036): cheap data-access only — one SELECT over the caller's own
 * rows (owner-scoped user_sub filter), normalize + group + order. No LLM in this path.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-31 18:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Initial Threads module: GET / (surface) + GET /items (the already-ingested inbox store folded into per-counterpart chronological threads via the pure switchboard-threads-model — email-first identity, bulk senders excluded, workspace-scoped, read-only, no LLM). Aggregation lives in the pure module so store-CI tests the compiled bytes.
 *
 * @module switchboard-threads-routes
 */

import { Router, type Request, type Response, type RequestHandler } from 'express';
import * as path from 'path';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { buildThreads, type StoredInboxRow } from './switchboard-threads-model';

/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

const logger = createChildLogger({ module: 'switchboard-threads-routes' });

/** Store read bound — a board over recent conversation, not an archive browser. */
const MAX_ROWS = 400;

/** The signed-in user's OIDC subject, or null if unauthenticated. */
function callerSub(req: Request): string | null {
  const u = (req as { oidc?: { user?: { sub?: string } } }).oidc?.user;
  return u?.sub ? String(u.sub) : null;
}

/** Serve a static HTML surface from the package tools directory. */
function servePage(dir: string, file: string): RequestHandler {
  return (_req, res) => {
    res.sendFile(path.join(dir, file), (err) => {
      if (err) {
        logger.error({ err, file }, 'Failed to serve switchboard threads surface');
        res.status(404).send('Page not found');
      }
    });
  };
}

/**
 * @description Resolve the provider set backing a workspace's member connections (the same
 * read the sibling Inbox module does over the PARENT-owned tables — SELECT only, caller-scoped).
 * @param pool - GUC-wrapped Postgres pool. @param sub - Caller sub. @param workspaceId - Workspace to scope to.
 * @returns The provider set, or null when the workspace is empty/absent (= all accounts).
 */
async function workspaceProviders(pool: AppContext['pool'], sub: string, workspaceId: string): Promise<Set<string> | null> {
  const rows = (await pool.query(
    `SELECT c.provider AS provider
       FROM oshal_switchboard_workspace_accounts wa
       JOIN oshal_connections c ON c.connection_id = wa.connection_id AND c.user_sub = wa.user_sub
      WHERE wa.user_sub = $1 AND wa.workspace_id = $2`,
    [sub, workspaceId],
  )).rows as Array<{ provider: string }>;
  if (!rows.length) return null;
  return new Set(rows.map((r) => r.provider));
}

/** Read the caller's stored inbox rows (all categories except promotions) for the window. */
async function storedRows(pool: AppContext['pool'], sub: string, days: number): Promise<StoredInboxRow[]> {
  return (await pool.query(
    `SELECT msg_id, from_addr, subject, snippet, category, received_at FROM oshal_inbox_messages
      WHERE user_sub = $1 AND category <> 'promotions' AND received_at > NOW() - ($2 || ' days')::interval
      ORDER BY received_at DESC LIMIT ${MAX_ROWS}`,
    [sub, String(days)],
  )).rows as StoredInboxRow[];
}

/** True when the caller has a connected Google account (the store's feeding connection). */
async function hasGoogleConnection(pool: AppContext['pool'], sub: string): Promise<boolean> {
  const r = await pool.query(
    "SELECT 1 FROM oshal_connections WHERE user_sub = $1 AND provider = 'google' AND status = 'connected'",
    [sub],
  );
  return !!r.rowCount;
}

/**
 * @description Builds the Threads sub-router (mounted at /threads by the parent Switchboard
 * router, under requiresAuth). Serves the timeline surface and the grouped /items feed.
 * Cheap reads only — no LLM in this path (ADR-036). Surfaces serve from tools/ (D10).
 * @param ctx - App context (db pool for the stored inbox + workspace reads, appPackageDir for the surface).
 * @returns Express router to mount at /threads (auth-gated by the parent mounter).
 */
export function createThreadsRoutes(ctx: AppContext): Router {
  const router = Router();
  const assetRoot = ctx.appPackageDir ? path.join(ctx.appPackageDir, 'tools') : path.join(LOAD_TIME_PACKAGE_DIR, 'tools');

  // Surface: the per-person timeline board.
  router.get('/', servePage(assetRoot, 'switchboard-threads.html'));

  // Data: the grouped per-counterpart threads. surface=1 → graceful "connect" payload.
  router.get('/items', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const days = Math.min(Math.max(parseInt(String(req.query.days || '30'), 10) || 30, 1), 90);
    const workspaceId = typeof req.query.workspace === 'string' && req.query.workspace ? req.query.workspace : null;
    try {
      // Workspace scope (ADR-113): the store is Gmail-fed, so a desk whose accounts exclude
      // the Google connection reads no stored threads (mirrors the sibling Inbox gating).
      const providers = workspaceId ? await workspaceProviders(ctx.pool, sub, workspaceId) : null;
      const includeStore = !providers || providers.has('google');
      const rows = includeStore
        ? await storedRows(ctx.pool, sub, days).catch((err) => { logger.error({ err }, 'threads store read failed'); return [] as StoredInboxRow[]; })
        : [];
      const threads = buildThreads(rows);
      if (!threads.length && !(await hasGoogleConnection(ctx.pool, sub))) {
        if (req.query.surface === '1') { res.json({ connected: false, message: 'Connect your Google account at /utilities to build your threads.' }); return; }
        res.status(409).json({ error: 'no_connection', message: 'Connect your Google account at /utilities first.' });
        return;
      }
      res.json({
        connected: true,
        workspace: workspaceId,
        threads,
        counts: { threads: threads.length, items: threads.reduce((n, t) => n + t.count, 0) },
      });
    } catch (err) {
      logger.error({ err }, 'Switchboard threads items failed');
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
