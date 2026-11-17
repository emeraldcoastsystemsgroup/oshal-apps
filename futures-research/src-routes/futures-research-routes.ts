/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Serve Futures Research's caller-authenticated responsive surface (/api/futures-research/app), concierge overview read (/api/futures-research/overview), and Today Home summary (/api/futures-research/home-summary) with Cache-Control: no-store and zero order execution authority.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';

const QUEUE_TYPE = 'futures-research';
const MAX_TICKET_FETCH = 100;
const MAX_QUEUE_SHOWN = 25;
const SUPPORTED_ROOTS = ['/MES', '/MNQ', '/ES', '/NQ', '/CL', '/GC'];
const CLOSED_STATUSES = new Set(['done', 'completed', 'failed', 'cancelled']);
const WAITING_STATUSES = new Set(['awaiting_approval', 'blocked']);

const UI_ASSETS: Record<string, { file: string; contentType: string }> = {
  '/futures-research.css': { file: 'futures-research.css', contentType: 'text/css; charset=utf-8' },
  '/futures-research.js': { file: 'futures-research.js', contentType: 'text/javascript; charset=utf-8' },
};

interface PortTicket {
  ticketId?: unknown;
  id?: unknown;
  ticketType?: unknown;
  kind?: unknown;
  title?: unknown;
  summary?: unknown;
  status?: unknown;
  position?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface FuturesResearchContext {
  appPackageDir?: string;
  ticketService?: {
    listTickets(filter: { ticketType: string; limit: number }): Promise<PortTicket[]>;
  };
}

interface CallerRequest {
  oidc?: {
    isAuthenticated?: () => boolean;
    user?: { sub?: unknown };
  };
}

interface QueueProjection {
  counts: {
    total: number;
    open: number;
    awaitingReview: number;
    running: number;
    completed: number;
    failed: number;
  };
  queue: Array<{
    ticketId: string;
    status: string;
    phase: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  }>;
}

function resolvePackageRoot(ctx: FuturesResearchContext): string {
  if (ctx.appPackageDir && ctx.appPackageDir.trim()) {
    return fs.realpathSync(ctx.appPackageDir);
  }
  return fs.realpathSync(path.resolve(__dirname, '..'));
}

function readBoundedToolAsset(packageRoot: string, fileName: string): string {
  const toolsRoot = path.join(packageRoot, 'tools');
  const candidate = fs.realpathSync(path.join(toolsRoot, fileName));
  const rel = path.relative(toolsRoot, candidate);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('tool asset escapes tools directory');
  }
  return fs.readFileSync(candidate, 'utf8');
}

interface HttpResponder {
  setHeader(name: string, value: string): unknown;
  status(code: number): { json(body: unknown): unknown };
}

function requireCallerSub(req: unknown, res: HttpResponder): string | null {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const oidc = (req as CallerRequest | null)?.oidc;
  if (!oidc || typeof oidc.isAuthenticated !== 'function' || oidc.isAuthenticated() !== true) {
    res.status(401).json({ error: 'not_authenticated' });
    return null;
  }
  const sub = oidc.user?.sub;
  if (typeof sub !== 'string' || !sub.trim()) {
    res.status(401).json({ error: 'not_authenticated' });
    return null;
  }
  return sub.trim();
}

function isoOrNull(value: unknown): string | null {
  const ms = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

/**
 * @description Project caller-scoped futures-research tickets into bounded counts and queue rows.
 * @param rawTickets - Tickets returned by the kernel ticket port.
 * @returns Normalized counts and newest queue items.
 */
export function projectFuturesQueue(rawTickets: PortTicket[]): QueueProjection {
  const mine = (Array.isArray(rawTickets) ? rawTickets : []).filter(
    t => t && (t.ticketType === QUEUE_TYPE || t.kind === QUEUE_TYPE),
  );
  const statusOf = (t: PortTicket) => (typeof t.status === 'string' && t.status.trim() ? t.status.trim() : 'queued');
  const counts = {
    total: mine.length,
    open: mine.filter(t => !CLOSED_STATUSES.has(statusOf(t))).length,
    awaitingReview: mine.filter(t => WAITING_STATUSES.has(statusOf(t))).length,
    running: mine.filter(t => ['queued', 'running'].includes(statusOf(t))).length,
    completed: mine.filter(t => ['done', 'completed'].includes(statusOf(t))).length,
    failed: mine.filter(t => statusOf(t) === 'failed').length,
  };
  const queue = mine.slice(0, MAX_QUEUE_SHOWN).map(t => {
    const pos = t.position && typeof t.position === 'object' ? (t.position as { name?: unknown }).name : null;
    return {
      ticketId: String(t.ticketId || t.id || ''),
      status: statusOf(t),
      phase: typeof pos === 'string' && pos.trim() ? pos.trim() : null,
      createdAt: isoOrNull(t.createdAt),
      updatedAt: isoOrNull(t.updatedAt),
    };
  });
  return { counts, queue };
}

function buildOverviewSummary(counts: QueueProjection['counts']): string {
  if (counts.total === 0) {
    return 'No Futures Research review tickets are queued for your account yet. Walk-forward studies and forward calls remain research-only with zero live order placement.';
  }
  return `${counts.total} Futures Research ticket${counts.total === 1 ? '' : 's'}: ${counts.open} open (${counts.awaitingReview} awaiting review), ${counts.completed} completed, ${counts.failed} failed. Proposals require explicit adoption in Intelligent Trades.`;
}

function buildHomeSummaryBody(projection: QueueProjection) {
  const { counts } = projection;
  const tiles = [
    { id: 'open-reviews', label: 'Open reviews', value: String(counts.open), tone: counts.failed > 0 ? 'warn' : 'neutral' },
    { id: 'awaiting-review', label: 'Awaiting review', value: String(counts.awaitingReview), tone: counts.awaitingReview > 0 ? 'warn' : 'neutral' },
    { id: 'completed-reviews', label: 'Completed reviews', value: String(counts.completed), tone: counts.completed > 0 ? 'good' : 'neutral' },
    { id: 'order-authority', label: 'Order authority', value: 'Research only', tone: 'neutral' },
  ];
  const items: Array<{ text: string; tone: 'neutral' | 'warn' | 'good'; fix: string }> = [];
  if (counts.failed > 0) {
    items.push({ text: `${counts.failed} study review ticket${counts.failed === 1 ? '' : 's'} failed; inspect queue status in Futures Research.`, tone: 'warn', fix: 'futures-research-home' });
  }
  if (counts.awaitingReview > 0) {
    items.push({ text: `${counts.awaitingReview} study review ticket${counts.awaitingReview === 1 ? '' : 's'} awaiting human review.`, tone: 'warn', fix: 'futures-research-home' });
  }
  if (items.length === 0) {
    items.push({
      text: counts.total > 0
        ? `${counts.completed} completed and ${counts.running} active Futures Research review${counts.total === 1 ? '' : 's'}.`
        : 'No study review tickets queued yet. Walk-forward studies and forward calls remain research-only.',
      tone: 'neutral',
      fix: 'futures-research-home',
    });
  }
  return { partial: false, tiles, metrics: tiles, items: items.slice(0, 5) };
}

function registerOverviewRoutes(router: Router, ctx: FuturesResearchContext): void {
  router.get('/overview', async (req, res) => {
    if (!requireCallerSub(req, res)) return;
    try {
      const tickets = ctx.ticketService?.listTickets
        ? await ctx.ticketService.listTickets({ ticketType: QUEUE_TYPE, limit: MAX_TICKET_FETCH })
        : [];
      const projection = projectFuturesQueue(tickets);
      res.json({
        package: QUEUE_TYPE,
        version: '1.2.0',
        posture: 'research-only',
        executionAuthorized: false,
        supportedRoots: SUPPORTED_ROOTS,
        ticketPortAvailable: Boolean(ctx.ticketService?.listTickets),
        summary: buildOverviewSummary(projection.counts),
        counts: projection.counts,
        queue: projection.queue,
      });
    } catch {
      res.status(503).json({ error: 'overview_unavailable', summary: 'Futures Research queue could not be read right now.' });
    }
  });

  router.get('/home-summary', async (req, res) => {
    if (!requireCallerSub(req, res)) return;
    try {
      const tickets = ctx.ticketService?.listTickets
        ? await ctx.ticketService.listTickets({ ticketType: QUEUE_TYPE, limit: MAX_TICKET_FETCH })
        : [];
      res.json(buildHomeSummaryBody(projectFuturesQueue(tickets)));
    } catch {
      const unavailable = [{ id: 'open-reviews', label: 'Open reviews', value: 'Unavailable', tone: 'warn' }];
      res.status(503).json({ partial: true, tiles: unavailable, metrics: unavailable, items: [] });
    }
  });
}

/**
 * @description Create caller-authenticated routes for Futures Research's surface, concierge overview, and Today Home summary.
 * @param ctx - Package runtime context providing appPackageDir and optional kernel ticketService.
 * @returns Express router mounted at /api/futures-research.
 */
export function createFuturesResearchRoutes(ctx: FuturesResearchContext = {}): Router {
  const router = Router();
  const packageRoot = resolvePackageRoot(ctx);

  router.get('/', (req, res) => {
    if (!requireCallerSub(req, res)) return;
    res.type('text/html; charset=utf-8').send(readBoundedToolAsset(packageRoot, 'futures-research.html'));
  });
  router.get('/app', (req, res) => {
    if (!requireCallerSub(req, res)) return;
    res.type('text/html; charset=utf-8').send(readBoundedToolAsset(packageRoot, 'futures-research.html'));
  });

  for (const [routePath, asset] of Object.entries(UI_ASSETS)) {
    router.get(routePath, (req, res) => {
      if (!requireCallerSub(req, res)) return;
      res.type(asset.contentType).send(readBoundedToolAsset(packageRoot, asset.file));
    });
  }

  registerOverviewRoutes(router, ctx);
  return router;
}
