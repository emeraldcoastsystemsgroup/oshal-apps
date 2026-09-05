/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Each user's own scrape-target list beside the admin's shared companies table: a pasted careers URL is accepted only when the engine's URL classifier matches a supported job-board pattern (rejected otherwise, never stored), then resolved into the shared corpus and scraped once so the nightly chain carries it from then on.
 */

/**
 * Per-user scrape targets.
 *
 * The shared `companies` corpus is the portal admin's table (Companies surface, CAREER_HUNTER_ADMIN_SUBS).
 * This module is the user's extension of it: `POST /settings/targets` asks the engine's own URL
 * classifier (`classify`, pattern-only, no DB, no render) whether the URL fits a supported job
 * board; a miss is a 400 with the supported list and nothing is stored. A hit is recorded in
 * `career_user_targets` (FORCE RLS) as `accepted`, answered 202, and resolved detached through
 * `add-target`, which registers the employer in the shared corpus with `user:<sub>` provenance and
 * scrapes it once — from then on the nightly chain treats it like any admin-added company.
 * @module career-targets
 */
import { type Request, type Response, type Router } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { runCareerCliAwait } from './career-engine-dispatch';
import { callerSub } from './career-user-store';

const logger = createChildLogger({ module: 'career-targets' });
const MAX_URL_LENGTH = 512;
/** Per-user ceiling on stored targets; a list is a curation, not a crawl frontier. */
const MAX_TARGETS_PER_USER = Math.max(1, Number(process.env.CAREER_TARGETS_MAX_PER_USER) || 200);
const ADMIN_TABLE_PATH = '/api/career-hunter/companies-admin';

/** @description One row of the caller's target list as the surface renders it. */
export interface TargetRow {
  id: number;
  url: string;
  ats_type: string;
  ats_token: string | null;
  status: 'accepted' | 'resolved' | 'unresolved';
  company_id: number | null;
  company_name: string | null;
  postings: number | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

/** @description The engine classifier's answer, already shaped for the route. */
export type Classification =
  | { ok: true; match: { atsType: string; token: string } | null; reason?: string; supported: string[] }
  | { ok: false; error: string };

/**
 * @description Normalises a pasted URL before it reaches the engine: http(s) only, no embedded
 * credentials, bounded length, fragment dropped, scheme added when the user pasted a bare host.
 * @param raw - Whatever the body carried
 * @returns The canonical URL string, or null when it cannot be a careers URL
 */
export function normalizeTargetUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  parsed.hash = '';
  return parsed.toString();
}

/**
 * @description The engine prints exactly one JSON object as its last stdout line; earlier lines
 * may be progress text. Anything that is not a JSON object is treated as a failure.
 * @param out - Engine stdout
 * @returns The parsed object, or null
 */
export function parseEngineJson(out: string): Record<string, unknown> | null {
  const lines = String(out || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const value = JSON.parse(lines[i]);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // not this line — keep looking upward
    }
  }
  return null;
}

/** Ask the engine's classifier; the answer is the only thing that decides accept versus reject. */
async function classifyUrl(ctx: AppContext, userSub: string, url: string): Promise<Classification> {
  const result = await runCareerCliAwait(ctx.pool, userSub, ['classify', '--url', url], {}, { slot: 'classify' });
  if (result.limitReason) {
    return { ok: false, error: result.limitReason === 'inflight' ? 'a classification is already running' : 'engine busy' };
  }
  const json = result.ok ? parseEngineJson(result.out) : null;
  if (!json || json.ok !== true) {
    const error = typeof json?.error === 'string' ? json.error : (result.err || '').slice(-200) || 'classification failed';
    return { ok: false, error };
  }
  const supported = Array.isArray(json.supported) ? json.supported.map(String) : [];
  const match = json.match as { ats_type?: unknown; token?: unknown } | null;
  if (match && typeof match.ats_type === 'string' && match.ats_type) {
    return { ok: true, match: { atsType: match.ats_type, token: String(match.token ?? '') }, supported };
  }
  return { ok: true, match: null, reason: typeof json.reason === 'string' ? json.reason : 'no supported job-board pattern', supported };
}

/** Resolve an accepted target into the shared corpus (detached from the request that accepted it). */
async function resolveTarget(ctx: AppContext, userSub: string, id: number, url: string): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await runCareerCliAwait(
      ctx.pool, userSub, ['add-target', '--url', url, '--source', `user:${userSub}`], {}, { slot: 'add-target' },
    );
    const json = result.ok ? parseEngineJson(result.out) : null;
    if (json && json.ok === true) {
      await ctx.pool.query(
        `UPDATE career_user_targets
            SET status='resolved', company_id=$3, company_name=$4, postings=$5, reason=$6, updated_at=NOW()
          WHERE id=$1 AND user_sub=$2`,
        [id, userSub, Number(json.company_id) || null, typeof json.name === 'string' ? json.name : null,
          Number.isFinite(Number(json.postings)) ? Number(json.postings) : null,
          typeof json.error === 'string' ? json.error : null],
      );
      logger.info({ userSub, id, companyId: json.company_id, postings: json.postings, durationMs: Date.now() - startedAt }, 'career target resolved');
      return;
    }
    const reason = typeof json?.error === 'string' ? json.error
      : result.limitReason ? `engine ${result.limitReason}` : (result.err || '').slice(-200) || 'engine run failed';
    await ctx.pool.query(
      `UPDATE career_user_targets SET status='unresolved', reason=$3, updated_at=NOW() WHERE id=$1 AND user_sub=$2`,
      [id, userSub, reason.slice(0, 400)],
    );
    logger.warn({ userSub, id, reason, durationMs: Date.now() - startedAt }, 'career target unresolved');
  } catch (err) {
    logger.error({ err, userSub, id }, 'career target resolution failed');
  }
}

async function listTargets(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  try {
    const result = await ctx.pool.query(
      `SELECT id, url, ats_type, ats_token, status, company_id, company_name, postings, reason, created_at, updated_at
         FROM career_user_targets WHERE user_sub=$1 ORDER BY created_at DESC`,
      [userSub],
    );
    res.json({ targets: result.rows as TargetRow[], max: MAX_TARGETS_PER_USER, adminTable: ADMIN_TABLE_PATH });
  } catch (err) {
    logger.error({ err, userSub }, 'career targets: list failed');
    res.status(500).json({ error: 'read failed' });
  }
}

async function countTargets(ctx: AppContext, userSub: string): Promise<number> {
  const result = await ctx.pool.query('SELECT COUNT(*) AS n FROM career_user_targets WHERE user_sub=$1', [userSub]);
  return Number(result.rows[0]?.n ?? 0);
}

async function acceptTarget(
  ctx: AppContext, userSub: string, url: string, match: { atsType: string; token: string },
): Promise<TargetRow> {
  const result = await ctx.pool.query(
    `INSERT INTO career_user_targets (user_sub, url, ats_type, ats_token, status)
       VALUES ($1, $2, $3, $4, 'accepted')
       ON CONFLICT (user_sub, url) DO UPDATE
         SET ats_type=EXCLUDED.ats_type, ats_token=EXCLUDED.ats_token, status='accepted',
             reason=NULL, updated_at=NOW()
       RETURNING id, url, ats_type, ats_token, status, company_id, company_name, postings, reason, created_at, updated_at`,
    [userSub, url, match.atsType, match.token || null],
  );
  return result.rows[0] as TargetRow;
}

async function addTarget(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const url = normalizeTargetUrl((req.body as { url?: unknown } | undefined)?.url);
  if (!url) { res.status(400).json({ ok: false, rejected: true, reason: 'invalid_url' }); return; }
  try {
    if (await countTargets(ctx, userSub) >= MAX_TARGETS_PER_USER) {
      res.status(409).json({ ok: false, error: 'too_many_targets', max: MAX_TARGETS_PER_USER });
      return;
    }
    const verdict = await classifyUrl(ctx, userSub, url);
    if (!verdict.ok) {
      logger.warn({ userSub, error: verdict.error }, 'career targets: classifier unavailable');
      res.status(503).json({ ok: false, error: verdict.error });
      return;
    }
    if (!verdict.match) {
      logger.info({ userSub, reason: verdict.reason }, 'career targets: url rejected');
      res.status(400).json({ ok: false, rejected: true, reason: verdict.reason, supported: verdict.supported });
      return;
    }
    const target = await acceptTarget(ctx, userSub, url, verdict.match);
    logger.info({ userSub, id: target.id, atsType: target.ats_type }, 'career targets: url accepted');
    res.status(202).json({ ok: true, accepted: true, target, supported: verdict.supported });
    void resolveTarget(ctx, userSub, target.id, url);
  } catch (err) {
    logger.error({ err, userSub }, 'career targets: add failed');
    res.status(500).json({ ok: false, error: 'add failed' });
  }
}

async function removeTarget(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ ok: false, error: 'id' }); return; }
  try {
    const result = await ctx.pool.query('DELETE FROM career_user_targets WHERE id=$1 AND user_sub=$2', [id, userSub]);
    logger.info({ userSub, id, removed: (result.rowCount ?? 0) > 0 }, 'career targets: removed');
    res.json({ ok: true, removed: (result.rowCount ?? 0) > 0 });
  } catch (err) {
    logger.error({ err, userSub, id }, 'career targets: remove failed');
    res.status(500).json({ ok: false, error: 'remove failed' });
  }
}

/**
 * @description Mounts the caller-scoped target-list routes on the career-hunter router
 * (parent-mounted behind requiresAuth; every handler derives its subject from the session).
 * @param router - The career-hunter router
 * @param ctx - App context (GUC-wrapped pool, engine dispatch)
 * @returns Nothing after the routes are mounted
 */
export function registerCareerTargetRoutes(router: Router, ctx: AppContext): void {
  router.get('/settings/targets', (req, res) => listTargets(ctx, req, res));
  router.post('/settings/targets', (req, res) => addTarget(ctx, req, res));
  router.delete('/settings/targets/:id', (req, res) => removeTarget(ctx, req, res));
}
